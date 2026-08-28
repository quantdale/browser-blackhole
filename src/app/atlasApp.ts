/**
 * Cosmic Atlas application shell — boots the CosmicAtlasHost into the product
 * UI skeleton and drives exactly one frame loop (CA0-01 integration surface,
 * CA0-07 deep links, CA1 transitions, M5 productization).
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §3 (host topology), §7 (frame lifecycle)
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §3 (routes), §14 (history)
 * - docs/cosmic-atlas/PRODUCT_UX_AND_TRANSITIONS.md §2/§13 (selector, persistent shell)
 * - docs/UI_UX.md §1/§3 (layout, collapsible panel structure), §5 (parameter safety)
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md (control classification)
 *
 * One application, one renderer lifecycle: this shell never constructs a
 * second renderer; the host owns SharedRendererKernel, and destinations are
 * modules inside it. Boot path selection lives in main.ts: `/atlas/*` routes
 * mount THIS shell; the bare root keeps the legacy M0 diagnostic app.
 *
 * Product shell (M5): top bar (brand / destination chips / experience-mode
 * switch / panel toggle) over a canvas-dominant content row with a compact
 * collapsible control panel. Panel sections are rebuilt from REGISTRY state
 * whenever the active destination/preset/debug-visibility changes; controls
 * write only canonical host state (never uniforms directly).
 *
 * Control scoping decision (documented deviation from DESTINATION_CONTROL_
 * CATALOG aspirational sections): only controls with defined semantics in the
 * CURRENT implementation are exposed — Preset, Observer (fov/reset), Visual,
 * Rendering, Diagnostics (debug), About/Fidelity, plus the shared timeline
 * transport. Physical sliders that destinations do not live-update yet would
 * violate "do not expose a control that has no defined physical or visual
 * semantics"; they arrive with their destinations.
 *
 * Determinism note: the rAF loop clamps dt the same way the host does
 * (<= 0.25 s) so background-tab pauses cannot inject huge time steps.
 */

import '../ui/atlas/atlasPanel.css';
import {
  BLOOM_STRENGTH_RANGE,
  EXPOSURE_RANGE,
  RENDER_SCALE_OVERRIDE_RANGE,
  TONE_MAPPING_VALUES,
  QUALITY_MODE_VALUES,
  parseFromUrl
} from '../atlas/atlasState.js';
import { INVALIDATION_REASON } from '../atlas/types.js';
import type { ExperienceMode } from '../atlas/types.js';
import { CosmicAtlasHost, type CosmicAtlasHostOptions } from '../atlas/host.js';
import { DEBUG_DESTINATION_ID, productionDestinationIds } from '../atlas/launchCatalog.js';
import type { NavigationIntent } from '../atlas/navigation.js';
import { getCachedDataset } from '../phenomena/black-hole-merger/dataset.js';
import {
  createButtonRow,
  createCollapsibleSection,
  createModeSwitch,
  createReadoutList,
  createSelectRow,
  createSliderRow,
  createTimelineTransport,
  createToggleRow,
  createWaveformPanel,
  type ReadoutListHandle,
  type TimelineTransportHandle,
  type WaveformPanelHandle
} from '../ui/atlas/index.js';
import { readForcedBackend } from './testHooks.js';

export interface AtlasAppHandle {
  dispose(): void;
}

interface AtlasAppWindowHook {
  host: CosmicAtlasHost;
  navigate(destinationId: string, presetId?: string): NavigationIntent | null;
  /** Renders one frame synchronously and samples a 5x5 grid (same-task readback). */
  captureFrame(): string[] | null;
}

/**
 * Top-bar destination chips are derived from the LAUNCH CATALOG + the live
 * registry (CA8 integration-debt fix). Labels come from registry descriptors;
 * the debug-only Diagnostic chip is appended under Debug mode only.
 */
const EXPERIENCE_MODES: ReadonlyArray<{ id: ExperienceMode; label: string }> = [
  { id: 'scientific', label: 'Scientific' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'debug', label: 'Debug' }
];

const QUALITY_OPTIONS = QUALITY_MODE_VALUES.map((value) => ({ value, label: value }));
const TONE_MAPPING_OPTIONS = TONE_MAPPING_VALUES.map((value) => ({ value, label: value }));
const TRAJECTORY_BACKEND_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'numerical', label: 'Numerical' },
  { value: 'lut', label: 'LUT' }
];
const TARGET_FPS_OPTIONS = [
  { value: '30', label: '30 FPS' },
  { value: '60', label: '60 FPS' }
];

/** UI reflection cadence: scrubber/readouts refresh at 4 Hz, not per frame. */
const UI_SYNC_INTERVAL_SECONDS = 0.25;

export async function createAtlasApp(root: HTMLElement): Promise<AtlasAppHandle> {
  const canvas = root.querySelector<HTMLCanvasElement>('#scene');
  const viewport = root.querySelector<HTMLElement>('#viewport');
  const panelHost = root.querySelector<HTMLElement>('#panel');
  if (!canvas || !viewport || !panelHost) {
    throw new Error('required DOM skeleton (#scene, #viewport, #panel) not found');
  }

  /** Non-null alias: TS narrowing does not carry into nested closures. */
  const panelElement: HTMLElement = panelHost;

  // --- product shell skeleton ----------------------------------------------
  // Restructures the legacy #app > (#viewport, #panel) skeleton into
  // #app.atlas-shell > (.atlas-topbar, .atlas-content > (#viewport, #panel)).
  root.classList.add('atlas-shell');

  const topbar = document.createElement('header');
  topbar.className = 'atlas-topbar';

  const brand = document.createElement('p');
  brand.className = 'atlas-brand';
  brand.textContent = 'Cosmic Atlas';

  const nav = document.createElement('nav');
  nav.className = 'atlas-nav';
  nav.setAttribute('aria-label', 'Cosmic Atlas destinations');

  const modeHost = document.createElement('div');
  modeHost.className = 'atlas-mode-host';

  const panelToggle = document.createElement('button');
  panelToggle.type = 'button';
  panelToggle.className = 'atlas-panel-toggle';
  panelToggle.textContent = 'Controls';
  panelToggle.setAttribute('aria-controls', panelHost.id);
  let panelOpen = true;
  const applyPanelVisibility = (): void => {
    panelElement.classList.toggle('atlas-panel--collapsed', !panelOpen);
    panelElement.classList.toggle('atlas-panel--open', panelOpen);
    panelToggle.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
  };
  panelToggle.addEventListener('click', () => {
    panelOpen = !panelOpen;
    applyPanelVisibility();
  });
  applyPanelVisibility();

  topbar.append(brand, nav, modeHost, panelToggle);

  const content = document.createElement('div');
  content.className = 'atlas-content';
  root.insertBefore(topbar, viewport);
  content.append(viewport, panelHost);
  root.append(content);

  // Truthful single-line status fed by the InitStatusTracker (kept first in
  // the panel so screen readers announce boot progress before sections).
  const status = document.createElement('p');
  status.className = 'atlas-status';
  status.setAttribute('role', 'status');

  // Dev/test-only ?backend= override (docs/CI_CD.md §6): forward webgpu|webgl2
  // to the kernel so the atlas fallback path is exercisable on capable machines.
  // 'unsupported' is a root-app terminal-UX concept; the atlas shell reports
  // its own boot failures through the InitStatusTracker instead.
  const forcedBackend = readForcedBackend(window.location.search);
  const hostOptions: CosmicAtlasHostOptions = {};
  if (forcedBackend === 'webgpu' || forcedBackend === 'webgl2') {
    hostOptions.forcedBackend = forcedBackend;
  }
  const host = new CosmicAtlasHost(canvas, hostOptions);

  // --- destination chips -----------------------------------------------------
  /** Rebuild chips from launch catalog + registry state; Diagnostic only under Debug mode. */
  const refreshNav = (): void => {
    const activeId = host.state.atlas.activeDestination;
    nav.replaceChildren();
    for (const destination of productionDestinationIds()) {
      if (!host.registry.has(destination)) continue;
      const descriptor = host.registry.get(destination)?.descriptor;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-nav-chip';
      chip.textContent = descriptor?.title ?? destination;
      chip.setAttribute('aria-pressed', activeId === destination ? 'true' : 'false');
      if (activeId === destination) chip.classList.add('is-active');
      chip.addEventListener('click', () => {
        host.navigate(destination);
      });
      nav.append(chip);
    }
    if (host.experienceMode === 'debug' && host.registry.has(DEBUG_DESTINATION_ID)) {
      const descriptor = host.registry.get(DEBUG_DESTINATION_ID)?.descriptor;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-nav-chip';
      chip.textContent = descriptor?.title ?? DEBUG_DESTINATION_ID;
      chip.setAttribute('aria-pressed', activeId === DEBUG_DESTINATION_ID ? 'true' : 'false');
      if (activeId === DEBUG_DESTINATION_ID) chip.classList.add('is-active');
      chip.addEventListener('click', () => {
        host.navigate(DEBUG_DESTINATION_ID);
      });
      nav.append(chip);
    }
  };

  // --- experience-mode switch (top bar) ---------------------------------------
  const modeSwitch = createModeSwitch({
    modes: EXPERIENCE_MODES.map((m) => ({ id: m.id, label: m.label })),
    value: host.experienceMode,
    onChange: (modeId) => {
      if (modeId === 'scientific' || modeId === 'cinematic' || modeId === 'debug') {
        host.setExperienceMode(modeId);
        markPanelDirty();
      }
    }
  });
  modeHost.append(modeSwitch.root);

  // --- control panel -----------------------------------------------------------
  // Sections are rebuilt from registry/host state whenever the signature
  // (destination|preset|mode|diagnostics) changes. Handles needing periodic
  // refresh survive rebuilds through the closures below.
  let transport: TimelineTransportHandle | null = null;
  let readouts: ReadoutListHandle | null = null;
  /** M11: per-tick observer-control value sync (set by the BH panel build). */
  let observerSync: (() => void) | null = null;
  /** CA8-13 waveform panel (Black-Hole Merger only); rebuilt with the panel. */
  let waveformPanel: WaveformPanelHandle | null = null;
  /** Asset id currently bound into the panel (null = unbound). */
  let waveformBoundAssetId: string | null = null;

  /**
   * Bind the waveform panel once the destination's dataset has landed in
   * the validated cache (navigation flips activeDestination BEFORE prepare
   * completes, so the first bind attempt can legitimately miss).
   */
  function bindWaveformPanel(): void {
    if (waveformPanel === null || host.state.atlas.activeDestination !== 'black-hole-merger') {
      return;
    }
    const snapshot = host.activeDestinationDebugSnapshot();
    const raw = snapshot?.['datasetId'];
    const assetId = typeof raw === 'string' ? raw : null;
    if (assetId === null || assetId === waveformBoundAssetId) return;
    const ds = getCachedDataset(assetId);
    if (ds === null) return;
    waveformPanel.setSeries({
      assetId: ds.assetId,
      timesM: ds.timesM,
      h22Re: ds.h22Re,
      h22Im: ds.h22Im,
      tStartM: ds.tStartM,
      tEndM: ds.tEndM,
      h22PeakAmplitude: ds.h22PeakAmplitude,
      mergerEndM: ds.mergerEndM,
      ringdownEndM: ds.ringdownEndM
    });
    waveformBoundAssetId = assetId;
  }
  /** Empty signature forces a rebuild on the next UI sync tick. */
  let panelSignature = '';
  const markPanelDirty = (): void => {
    panelSignature = '';
  };

  function activeSelection(): { destId: string; presetId: string } {
    const s = host.state.atlas;
    return { destId: s.activeDestination, presetId: s.activePreset };
  }

  function buildPanel(): void {
    transport = null;
    readouts = null;
    observerSync = null;
    waveformPanel?.dispose();
    waveformPanel = null;
    waveformBoundAssetId = null;
    panelElement.replaceChildren(status);

    const { destId, presetId } = activeSelection();
    const entry = host.registry.get(destId);
    if (entry === undefined) return; // pre-registration boot window; retried by sync

    // -- Preset -------------------------------------------------------------
    const presetSection = createCollapsibleSection({ title: 'Preset', open: true });
    const presetOptions = entry.presets.map((preset) => ({
      value: preset.id,
      label: preset.displayName.replace(new RegExp(`^${entry.descriptor.title} — `), '')
    }));
    presetSection.body.append(
      createSelectRow({
        label: 'Scenario',
        options: presetOptions,
        value: presetId,
        onChange: (value) => {
          host.navigate(destId, value);
        }
      }).root
    );

    // -- Observer -------------------------------------------------------------
    const observerSection = createCollapsibleSection({ title: 'Observer', open: false });
    observerSection.body.append(
      createSliderRow({
        label: 'Field of view',
        min: 20,
        max: 120,
        step: 1,
        value: host.camera.fov,
        unit: '°',
        onInput: (value) => {
          host.cameraRig.setFov(value);
        }
      }).root,
      createButtonRow([
        {
          text: 'Reset camera',
          onClick: () => {
            const preset = entry.presetById.get(activeSelection().presetId);
            if (preset !== undefined) {
              host.cameraRig.applyArrivalPreset(preset.camera, host.reducedMotion ? 0 : 0.9);
            }
          }
        }
      ])
    );

    // -- Visual (display domain only; never physics) --------------------------
    const visualSection = createCollapsibleSection({ title: 'Visual', open: false });
    const bloomToggle = createToggleRow({
      label: 'Bloom',
      checked: host.state.sharedVisual.bloomEnabled,
      onChange: (checked) => {
        host.setVisual({ bloomEnabled: checked });
      }
    });
    visualSection.body.append(
      createSliderRow({
        label: 'Exposure',
        min: EXPOSURE_RANGE.min,
        max: EXPOSURE_RANGE.max,
        step: 0.05,
        value: host.state.sharedVisual.exposure,
        onInput: (value) => {
          host.setVisual({ exposure: value });
        }
      }).root,
      createSelectRow({
        label: 'Tone mapping',
        options: TONE_MAPPING_OPTIONS,
        value: host.state.sharedVisual.toneMapping,
        onChange: (value) => {
          host.setVisual({
            toneMapping: value as (typeof TONE_MAPPING_VALUES)[number]
          });
        }
      }).root,
      bloomToggle.root,
      createSliderRow({
        label: 'Bloom strength',
        min: BLOOM_STRENGTH_RANGE.min,
        max: BLOOM_STRENGTH_RANGE.max,
        step: 0.05,
        value: host.state.sharedVisual.bloomStrength,
        onInput: (value) => {
          host.setVisual({ bloomStrength: value });
        }
      }).root
    );

    // -- Rendering --------------------------------------------------------------
    const renderingSection = createCollapsibleSection({ title: 'Rendering', open: false });
    renderingSection.body.append(
      createSelectRow({
        label: 'Quality',
        options: QUALITY_OPTIONS,
        value: host.state.rendering.qualityMode,
        onChange: (value) => {
          if (
            value === 'auto' ||
            value === 'low' ||
            value === 'medium' ||
            value === 'high' ||
            value === 'ultra'
          ) {
            host.setQualityMode(value);
          }
        }
      }).root,
      createSelectRow({
        label: 'Target',
        options: TARGET_FPS_OPTIONS,
        value: String(host.state.rendering.targetFps),
        onChange: (value) => {
          const fps = Number.parseInt(value, 10);
          if (fps === 30 || fps === 60) host.setTargetFps(fps);
        }
      }).root,
      createToggleRow({
        label: 'Dynamic resolution',
        checked: host.state.rendering.dynamicResolution,
        onChange: (checked) => {
          host.setRenderScaleOverride(checked ? null : host.governor.renderScale);
        }
      }).root,
      createSliderRow({
        label: 'Render scale',
        min: RENDER_SCALE_OVERRIDE_RANGE.min,
        max: RENDER_SCALE_OVERRIDE_RANGE.max,
        step: 0.05,
        value: host.renderScaleOverride ?? host.governor.renderScale,
        onInput: (value) => {
          host.setRenderScaleOverride(value);
        }
      }).root,
      createSelectRow({
        label: 'Trajectory backend',
        options: TRAJECTORY_BACKEND_OPTIONS,
        value: host.state.rendering.trajectoryBackend,
        onChange: (value) => {
          if (value === 'auto' || value === 'numerical' || value === 'lut') {
            host.setTrajectoryBackend(value);
            markPanelDirty();
          }
        }
      }).root
    );

    // -- Destination controls (only semantics that actually exist) ------------
    // Compact Merger exposes scenario/observer controls backed by its
    // canonical applyControlState normalizer (CA5); other destinations keep
    // preset-bound state only (documented control-scoping decision).
    if (destId === 'compact-merger') {
      const mergerSection = createCollapsibleSection({ title: 'Merger', open: false });
      const share = (host.state.destinations['compact-merger']?.state ?? {}) as Record<
        string,
        unknown
      >;
      mergerSection.body.append(
        createSliderRow({
          label: 'Viewing angle',
          min: 0,
          max: 90,
          step: 1,
          value: typeof share['viewingAngleDeg'] === 'number' ? share['viewingAngleDeg'] : 75,
          unit: '°',
          onInput: (value) => {
            host.setDestinationControl('compact-merger', { viewingAngleDeg: value });
          }
        }).root,
        createSelectRow({
          label: 'Remnant',
          options: [
            { value: 'massive-ns', label: 'Massive NS' },
            { value: 'prompt-bh', label: 'Prompt BH' },
            { value: 'delayed-collapse', label: 'Delayed collapse' }
          ],
          value:
            typeof share['remnantScenario'] === 'string' ? share['remnantScenario'] : 'massive-ns',
          onChange: (value) => {
            host.setDestinationControl('compact-merger', { remnantScenario: value });
            markPanelDirty();
          }
        }).root,
        createSelectRow({
          label: 'Jet',
          options: [
            { value: 'none', label: 'None' },
            { value: 'thin', label: 'Thin (8°)' },
            { value: 'wide', label: 'Wide (20°)' }
          ],
          value: typeof share['jetScenario'] === 'string' ? share['jetScenario'] : 'none',
          onChange: (value) => {
            host.setDestinationControl('compact-merger', { jetScenario: value });
            markPanelDirty();
          }
        }).root
      );
      panelElement.append(mergerSection.root);
    }

    // -- Black-hole M10 observer controls (canonical applyControlState) ------
    if (destId === 'black-hole') {
      const bhSection = createCollapsibleSection({ title: 'Observer (relativistic)', open: false });
      const readObs = (): Record<string, unknown> => {
        const share = (host.state.destinations['black-hole']?.state ?? {}) as Record<
          string,
          unknown
        >;
        const raw = share['observer'];
        return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
      };
      const num = (key: string, fallback: number): number => {
        const v = readObs()[key];
        return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      };
      const setObserver = (patch: Record<string, unknown>): void => {
        // NOTE: no markPanelDirty here — dragging a slider must not rebuild
        // the panel mid-gesture (M11 defect fix). External mode changes reach
        // the panel through the observer-mode term in the panel signature;
        // value-only changes are reflected by the per-tick sync closure.
        host.setDestinationControl('black-hole', { observer: { ...readObs(), ...patch } });
      };
      const modeRaw = readObs()['mode'];
      const modeValue =
        modeRaw === 'static' ||
        modeRaw === 'circular' ||
        modeRaw === 'flyby' ||
        modeRaw === 'freefall'
          ? modeRaw
          : 'camera';
      const modeSelect = createSelectRow({
        label: 'Observer mode',
        options: [
          { value: 'camera', label: 'Camera (legacy)' },
          { value: 'static', label: 'Static' },
          { value: 'circular', label: 'Physical Circular' },
          { value: 'flyby', label: 'Flyby' },
          { value: 'freefall', label: 'Freefall / Plunge' }
        ],
        value: modeValue,
        onChange: (value) => {
          setObserver({ mode: value });
        }
      });
      bhSection.body.append(modeSelect.root);
      /** Live value handles refreshed from canonical state each UI tick. */
      const liveRows: { apply(value: string): void; read(): string }[] = [];
      if (modeValue === 'circular') {
        const radius = createSliderRow({
          label: 'Orbit radius',
          min: 3.2,
          max: 40,
          step: 0.1,
          unit: ' r_g',
          value: num('circularRadiusRg', 9),
          onInput: (value) => setObserver({ circularRadiusRg: value })
        });
        const sense = createSelectRow({
          label: 'Orbit sense',
          options: [
            { value: '1', label: 'Prograde (+phi)' },
            { value: '-1', label: 'Retrograde' }
          ],
          value: String(readObs()['circularSense'] === -1 ? -1 : 1),
          onChange: (value) => setObserver({ circularSense: Number(value) })
        });
        bhSection.body.append(radius.root, sense.root);
        liveRows.push(
          {
            apply: (v) => radius.setValue(Number(v)),
            read: () => String(num('circularRadiusRg', 9))
          },
          {
            apply: (v) => sense.setValue(v),
            read: () => String(readObs()['circularSense'] === -1 ? -1 : 1)
          }
        );
      }
      if (modeValue === 'flyby') {
        const beta = createSliderRow({
          label: 'Asymptotic speed',
          min: 0.05,
          max: 0.95,
          step: 0.01,
          unit: ' c',
          value: num('flybyBetaInfinity', 0.5),
          onInput: (value) => setObserver({ flybyBetaInfinity: value })
        });
        const impact = createSliderRow({
          label: 'Impact parameter',
          min: -40,
          max: 40,
          step: 0.5,
          unit: ' r_g',
          value: num('flybyImpactParameterRg', 7),
          onInput: (value) => setObserver({ flybyImpactParameterRg: value })
        });
        bhSection.body.append(beta.root, impact.root);
        liveRows.push(
          {
            apply: (v) => beta.setValue(Number(v)),
            read: () => String(num('flybyBetaInfinity', 0.5))
          },
          {
            apply: (v) => impact.setValue(Number(v)),
            read: () => String(num('flybyImpactParameterRg', 7))
          }
        );
      }
      if (modeValue === 'freefall') {
        const release = createSliderRow({
          label: 'Release radius',
          min: 1.2,
          max: 60,
          step: 0.1,
          unit: ' r_g',
          value: num('freefallReleaseRadiusRg', 14),
          onInput: (value) => setObserver({ freefallReleaseRadiusRg: value })
        });
        bhSection.body.append(release.root);
        liveRows.push({
          apply: (v) => release.setValue(Number(v)),
          read: () => String(num('freefallReleaseRadiusRg', 14))
        });
      }
      if (modeValue !== 'camera' && modeValue !== 'static') {
        const rate = createSliderRow({
          label: 'Proper-time rate',
          min: -5,
          max: 5,
          step: 0.1,
          unit: 'x',
          value: num('timeScale', 1),
          onInput: (value) => setObserver({ timeScale: value })
        });
        bhSection.body.append(rate.root);
        liveRows.push({
          apply: (v) => rate.setValue(Number(v)),
          read: () => String(num('timeScale', 1))
        });
      }
      // Per-tick reflection: preset/control changes made OUTSIDE this panel
      // (preset load, share state, reset) update the visible values without a
      // rebuild. Mode changes rebuild via the signature term below.
      observerSync = (): void => {
        const modeNow = String(readObs()['mode'] ?? 'camera');
        modeSelect.setValue(
          modeNow === 'static' ||
            modeNow === 'circular' ||
            modeNow === 'flyby' ||
            modeNow === 'freefall'
            ? modeNow
            : 'camera'
        );
        for (const row of liveRows) row.apply(row.read());
      };
      panelElement.append(bhSection.root);
    }

    // -- Tidal Disruption controls (canonical applyControlState channel) ------
    if (destId === 'tidal-disruption') {
      const tdeSection = createCollapsibleSection({ title: 'Encounter', open: false });
      const share = (host.state.destinations['tidal-disruption']?.state ?? {}) as Record<
        string,
        unknown
      >;
      const bhLog10 =
        typeof share['blackHoleMassSolar'] === 'number'
          ? Math.log10(share['blackHoleMassSolar'])
          : 6;
      tdeSection.body.append(
        createSliderRow({
          label: 'BH mass (log10 solar)',
          min: 5,
          max: 7.7,
          step: 0.01,
          value: bhLog10,
          onInput: (value) => {
            host.setDestinationControl('tidal-disruption', {
              blackHoleMassSolar: Number((10 ** value).toPrecision(4))
            });
          }
        }).root,
        createSelectRow({
          label: 'Star',
          options: [
            { value: 'solar-type', label: 'Solar type' },
            { value: 'low-mass-k', label: 'Low-mass K dwarf' },
            { value: 'evolved-subgiant', label: 'Evolved subgiant' }
          ],
          value: typeof share['stellarPreset'] === 'string' ? share['stellarPreset'] : 'solar-type',
          onChange: (value) => {
            host.setDestinationControl('tidal-disruption', { stellarPreset: value });
          }
        }).root,
        createSelectRow({
          label: 'Penetration',
          options: [
            { value: 'grazing', label: 'Grazing (β 0.85)' },
            { value: 'canonical', label: 'Canonical (β 1.0)' },
            { value: 'deep', label: 'Deep (β 2.5)' }
          ],
          value:
            typeof share['penetrationScenario'] === 'string'
              ? share['penetrationScenario']
              : 'canonical',
          onChange: (value) => {
            host.setDestinationControl('tidal-disruption', { penetrationScenario: value });
          }
        }).root,
        createSliderRow({
          label: 'Observer orientation',
          min: 0,
          max: 90,
          step: 1,
          value:
            typeof share['observerInclinationDeg'] === 'number'
              ? share['observerInclinationDeg']
              : 62,
          unit: '°',
          onInput: (value) => {
            host.setDestinationControl('tidal-disruption', { observerInclinationDeg: value });
          }
        }).root
      );
      panelElement.append(tdeSection.root);
    }

    // -- Black-Hole Merger controls + synchronized waveform (CA8-13/16) ------
    if (destId === 'black-hole-merger') {
      const share = (host.state.destinations['black-hole-merger']?.state ?? {}) as Record<
        string,
        unknown
      >;
      const mergerSection = createCollapsibleSection({ title: 'Merger', open: false });
      mergerSection.body.append(
        createToggleRow({
          label: 'Orbit trails',
          checked: share['showOrbitTrails'] !== false,
          onChange: (checked) => {
            host.setDestinationControl('black-hole-merger', { showOrbitTrails: checked });
          }
        }).root,
        createToggleRow({
          label: 'Illustrative lens accents',
          checked: share['illustrativeLensing'] !== false,
          onChange: (checked) => {
            host.setDestinationControl('black-hole-merger', { illustrativeLensing: checked });
          }
        }).root
      );
      const note = document.createElement('p');
      note.className = 'atlas-note';
      note.textContent =
        'Reference-event view: orbital paths and timing come from the pinned ' +
        'numerical-relativity dataset; the lens accents are illustrative.';
      mergerSection.body.append(note);
      panelElement.append(mergerSection.root);

      const waveSection = createCollapsibleSection({ title: 'Waveform (h22)', open: true });
      waveformPanel = createWaveformPanel();
      waveSection.body.append(waveformPanel.root);
      panelElement.append(waveSection.root);
      bindWaveformPanel();
    }

    // -- Diagnostics (Debug domain; opt-in) ------------------------------------
    if (host.diagnosticsEnabled) {
      const diagSection = createCollapsibleSection({ title: 'Diagnostics', open: true });
      readouts = createReadoutList();
      diagSection.body.append(readouts.root);
      panelElement.append(diagSection.root);
    }

    // -- About / Fidelity ---------------------------------------------------------
    const aboutSection = createCollapsibleSection({ title: 'About / Fidelity', open: false });
    const activePreset = entry.presetById.get(presetId);
    const note = document.createElement('p');
    note.className = 'atlas-note';
    note.textContent =
      (activePreset?.fidelityNote ?? '') + ` Fidelity class: ${entry.descriptor.fidelity}.`;
    aboutSection.body.append(note);

    // -- Timeline (shared transport) ----------------------------------------------
    const timelineSection = createCollapsibleSection({ title: 'Timeline', open: true });
    transport = createTimelineTransport({
      onPlay: (playing) => {
        if (playing) host.time.play();
        else host.time.pause();
      },
      onReset: () => {
        host.time.reset(activePreset?.timelineInitialPhase ?? 0);
      },
      onScrub: (phase01) => {
        host.time.scrubTo(phase01);
      },
      onRate: (rate) => {
        host.time.setRate(rate);
      }
    });
    timelineSection.body.append(transport.root);

    panelElement.append(
      presetSection.root,
      timelineSection.root,
      observerSection.root,
      visualSection.root,
      renderingSection.root,
      aboutSection.root
    );
  }

  /** One-line trajectory-backend truth for the diagnostics readout. */
  function formatTrajectoryReadout(snapshot: Record<string, unknown> | null): string {
    if (snapshot === null || snapshot['trajectoryBackendEffective'] === undefined) return '—';
    const requested = String(snapshot['trajectoryBackendRequested']);
    const effective = String(snapshot['trajectoryBackendEffective']);
    const reason = snapshot['lutFallbackReason'];
    return typeof reason === 'string' && reason.length > 0
      ? `${effective} (requested ${requested}; ${reason})`
      : `${effective} (requested ${requested})`;
  }

  /** Debug telemetry readouts (bounded, no GPU readback). */
  function updateReadouts(): void {
    if (readouts === null) return;
    const inv = host.debugInventory();
    const backend = inv.backend;
    readouts.set([
      { label: 'Backend', value: backend ? `${backend.api} ${backend.adapterName}` : '—' },
      { label: 'Quality tier', value: host.governor.currentTier },
      { label: 'Render scale', value: host.governor.renderScale.toFixed(2) },
      {
        label: 'FPS (smoothed)',
        // WS1: the governor only samples endFrame() on frames the host
        // actually rendered — while idle-skipped this reads the last live
        // value, not a live measurement, so say so (measurement-honesty
        // invariant, MASTER_PLAN §3.4) instead of implying a fresh number.
        value: host.lastFrameRendered
          ? host.governor.smoothedFps.toFixed(0)
          : `${host.governor.smoothedFps.toFixed(0)} (idle)`
      },
      { label: 'Activity', value: host.governor.activityMode },
      { label: 'Destination', value: host.state.atlas.activeDestination },
      { label: 'Preset', value: host.state.atlas.activePreset || '(default)' },
      {
        label: 'Transition',
        value: host.state.atlas.transition.phase ?? 'idle'
      },
      {
        label: 'Trajectory',
        value: formatTrajectoryReadout(host.activeDestinationDebugSnapshot())
      },
      { label: 'Live scopes', value: String(inv.liveScopeCount) },
      { label: 'GPU bytes (est.)', value: String(inv.totalEstimatedGpuBytes) },
      { label: 'Pending prepares', value: String(inv.pendingPrepares) }
    ]);
  }

  // --- boot -------------------------------------------------------------------
  try {
    await host.init();
  } catch (err) {
    status.textContent = `Atlas failed to initialize: ${String(err)}`;
    throw err;
  }
  status.textContent = 'Atlas ready';

  // Share-link subset application (STATE_AND_ROUTES §9): the compact query
  // keys ride the SAME normalizer as runtime state. Applied once after init
  // so presentation surfaces exist; route identity stays authoritative via
  // parseRoute (unknown keys here are ignored by the parser).
  const share = parseFromUrl(window.location.search);
  if (share.rendering !== undefined) {
    host.setQualityMode(share.rendering.qualityMode);
    host.setTrajectoryBackend(share.rendering.trajectoryBackend);
  }
  if (share.sharedVisual !== undefined) {
    host.setVisual({
      exposure: share.sharedVisual.exposure,
      bloomEnabled: share.sharedVisual.bloomEnabled,
      bloomStrength: share.sharedVisual.bloomStrength,
      toneMapping: share.sharedVisual.toneMapping
    });
  }
  if (share.experience !== undefined && share.experience.mode !== host.experienceMode) {
    host.setExperienceMode(share.experience.mode);
  }

  // Destination-control deep links (CA6 persistence generalization): dc=
  // payloads parse into share.destinations and are applied through the
  // canonical setDestinationControl channel once each target destination is
  // ACTIVE AND PREPARED. Application is verified against the serialized
  // canonical state (the call is a silent no-op before prepare completes),
  // with bounded 200 ms polling cleared on dispose.
  const pendingControlTargets = new Map(Object.entries(share.destinations ?? {}));
  const appliedControlTargets = new Set<string>();
  const controlPayloadMatches = (id: string, payload: Record<string, unknown>): boolean => {
    const state = host.state.destinations[id]?.state ?? {};
    return Object.entries(payload).every(([k, v]) => {
      const actual = state[k];
      if (typeof v === 'number' && typeof actual === 'number') {
        return Math.abs(actual - v) <= 1e-6;
      }
      return actual === v;
    });
  };
  let controlPollTimer: ReturnType<typeof setInterval> | null = null;
  if (pendingControlTargets.size > 0) {
    controlPollTimer = setInterval(() => {
      for (const [id, entry] of pendingControlTargets) {
        if (appliedControlTargets.has(id)) continue;
        if (host.state.atlas.activeDestination !== id) continue;
        if (!controlPayloadMatches(id, entry.state)) {
          host.setDestinationControl(id, entry.state);
          if (controlPayloadMatches(id, entry.state)) appliedControlTargets.add(id);
          continue;
        }
        appliedControlTargets.add(id);
      }
      if (appliedControlTargets.size >= pendingControlTargets.size && controlPollTimer !== null) {
        clearInterval(controlPollTimer);
        controlPollTimer = null;
      }
    }, 200);
    // Hard budget: stop polling after ~30 s regardless.
    setTimeout(() => {
      if (controlPollTimer !== null) {
        clearInterval(controlPollTimer);
        controlPollTimer = null;
      }
    }, 30_000);
  }

  refreshNav();
  buildPanel();

  // --- resize plumbing ----------------------------------------------------------
  // Mirrors the M0 ResizeController policy (CSS-size driven, DPR handled
  // inside the kernel) at atlas scope.
  const applyResize = (): void => {
    const rect = viewport.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      host.handleResize(rect.width, rect.height);
    }
  };
  const resizeObserver = new ResizeObserver(applyResize);
  resizeObserver.observe(viewport);
  applyResize();

  // --- single frame loop + 4 Hz UI reflection -------------------------------------
  let rafId = 0;
  let lastMs = performance.now();
  let uiTimer = 0;
  let wasTransitioning = false;
  const tick = (nowMs: number): void => {
    const dtSeconds = Math.min((nowMs - lastMs) / 1000, 0.25);
    lastMs = nowMs;
    if (!host.isFatalDeviceLoss) {
      host.frame(dtSeconds);
    }

    uiTimer += dtSeconds;
    if (uiTimer >= UI_SYNC_INTERVAL_SECONDS) {
      uiTimer = 0;
      // M11: destination state is seeded from preset/share state when the
      // arrival transition completes — AFTER the first panel build. Deep-link
      // boots (/?preset=...) would otherwise show stale control values forever
      // (the signature is already final). Force exactly one rebuild per
      // completed arrival so the panel reflects the landed canonical state.
      const transitioning = host.state.atlas.transition.active;
      if (wasTransitioning && !transitioning) markPanelDirty();
      wasTransitioning = transitioning;
      const { destId, presetId } = activeSelection();
      // Observer MODE participates in the signature: mode changes swap the
      // mode-specific control rows (preset loads, share state, mode select).
      const bhObs = host.state.destinations['black-hole']?.state as
        Record<string, unknown> | undefined;
      const bhObsMode =
        bhObs && typeof bhObs['observer'] === 'object' && bhObs['observer'] !== null
          ? String((bhObs['observer'] as Record<string, unknown>)['mode'] ?? 'camera')
          : 'camera';
      const signature = `${destId}|${presetId}|${host.experienceMode}|${String(host.diagnosticsEnabled)}|${
        destId === 'black-hole' ? bhObsMode : ''
      }`;
      if (signature !== panelSignature) {
        panelSignature = signature;
        modeSwitch.setValue(host.experienceMode);
        refreshNav();
        buildPanel();
      }
      if (transport !== null) {
        transport.setPlaying(!host.time.snapshot().paused);
        transport.setPhase01(host.time.simulationPhase);
      }
      if (observerSync !== null) observerSync();
      if (waveformPanel !== null) {
        bindWaveformPanel();
        const physicalTime = host.time.snapshot().physicalTime;
        waveformPanel.update(typeof physicalTime === 'number' ? physicalTime : 0);
      }
      updateReadouts();
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  // --- page visibility (WS3, whole-atlas performance campaign) -------------
  // Browsers already suspend rAF callbacks for hidden tabs, so `tick` simply
  // stops firing while hidden — the shared timeline and every ctx.time.dt-
  // driven destination freeze exactly where they were (no wall-clock reads
  // anywhere in this codebase makes that safe: TimeController's documented
  // hidden-time semantics are "does not advance while hidden; resumes from
  // the same coordinate with a normal per-frame dt, never a catch-up jump").
  // Two things still need an explicit handler on resume: `lastMs` must not
  // be left pointing at the pre-hide timestamp (that would present as one
  // artificially-maxed-out MAX_FRAME_DT_SECONDS frame instead of a normal
  // one), and WS1's on-demand skip needs a one-shot nudge in case a resize or
  // other externally-driven change happened while no frames were rendering.
  const onVisibilityChange = (): void => {
    if (document.hidden) return;
    lastMs = performance.now();
    host.invalidate(INVALIDATION_REASON.FORCED_CAPTURE);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // --- page teardown (WS3, whole-atlas performance campaign) ---------------
  // Destination implementations are lazy chunks, so a reload can interrupt a
  // module fetch mid-flight. Abandon the attempt rather than let the
  // browser's cancelled request be reported as a preparation failure on a
  // page that is already unloading. `persisted` true means the page went to
  // the bfcache and may come back, so that case is deliberately left alone.
  // `beforeunload` fires at navigation START, before the engine aborts the
  // in-flight module fetch, so it is the one that actually wins the race;
  // `pagehide` is kept as the belt-and-braces signal for paths that skip it.
  // `persisted` true means the page went to the bfcache and may come back, so
  // that case is deliberately left alone.
  //
  // bfcache note: a `beforeunload` listener has historically cost bfcache
  // eligibility in some engines. Measured here with and without the listener,
  // headless Firefox and Chromium both reported `pageshow.persisted === false`
  // on a back-navigation either way — this app is already ineligible in that
  // environment (it holds a live GPU context), so the listener is not the
  // deciding factor. Real-browser eligibility is UNVERIFIED.
  const onTeardown = (): void => {
    host.abandonPendingTransition();
  };
  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) onTeardown();
  };
  window.addEventListener('beforeunload', onTeardown);
  window.addEventListener('pagehide', onPageHide);

  const unsubscribeStatus = host.status.subscribe((snapshot) => {
    if (snapshot.failed) {
      status.textContent = `Atlas error [${snapshot.errorCode ?? 'UNKNOWN'}]: ${snapshot.message}`;
    } else if (!snapshot.ready) {
      status.textContent = `Atlas: ${snapshot.message}`;
    }
  });

  // M11-03 device-loss terminal state: the status line is the app's
  // user-visible error surface (same presentation as boot failures). Frame
  // submission stops — the kernel refuses work on a lost device and the
  // tick skips host.frame so the governor stops sampling a dead pipeline.
  const unsubscribeFatal = host.onFatal(() => {
    status.textContent =
      'Atlas error [GPU_DEVICE_LOST]: Graphics device was lost — reload the page to restart with a fresh device.';
  });

  // Test/inspection hook (mirrors __BLACKHOLE_TEST__ convention from main.ts).
  // Shape is load-bearing for tests/browser/support/atlasHook.ts — do not change
  // without updating that declaration and the specs that consume it.
  const captureFrame = (): string[] | null => {
    const rect = viewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // force: true — WS1 frame invalidation (src/atlas/host.ts) skips
    // rendering when nothing changed and the timeline is paused; this test
    // hook must always produce a fresh same-task readback regardless.
    host.frame(1 / 60, { force: true });
    const cw = canvas.width;
    const ch = canvas.height;
    if (cw <= 0 || ch <= 0) return null;
    const scratch = document.createElement('canvas');
    scratch.width = cw;
    scratch.height = ch;
    const ctx = scratch.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    const pts: string[] = [];
    for (let gy = 0; gy < 5; gy += 1) {
      for (let gx = 0; gx < 5; gx += 1) {
        const d = ctx.getImageData(
          Math.floor(((gx + 0.5) / 5) * cw),
          Math.floor(((gy + 0.5) / 5) * ch),
          1,
          1
        ).data;
        pts.push(`${d[0]},${d[1]},${d[2]}`);
      }
    }
    return pts;
  };
  const hook: AtlasAppWindowHook = {
    host,
    navigate: (destinationId, presetId) => host.navigate(destinationId, presetId),
    captureFrame
  };
  (window as unknown as Record<string, unknown>)['__ATLAS_APP__'] = hook;

  return {
    dispose(): void {
      if (controlPollTimer !== null) {
        clearInterval(controlPollTimer);
        controlPollTimer = null;
      }
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onTeardown);
      window.removeEventListener('pagehide', onPageHide);
      unsubscribeStatus();
      unsubscribeFatal();
      delete (window as unknown as Record<string, unknown>)['__ATLAS_APP__'];
      waveformPanel?.dispose();
      waveformPanel = null;
      host.dispose();
      panelElement.replaceChildren();
    }
  };
}
