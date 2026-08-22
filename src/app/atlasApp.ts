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
  QUALITY_MODE_VALUES
} from '../atlas/atlasState.js';
import type { ExperienceMode } from '../atlas/types.js';
import { CosmicAtlasHost, type CosmicAtlasHostOptions } from '../atlas/host.js';
import type { NavigationIntent } from '../atlas/navigation.js';
import {
  createButtonRow,
  createCollapsibleSection,
  createModeSwitch,
  createReadoutList,
  createSelectRow,
  createSliderRow,
  createToggleRow,
  createTimelineTransport,
  type ReadoutListHandle,
  type TimelineTransportHandle
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

/** Top-bar production destinations, in taxonomy order (campaign §7). */
const PRODUCTION_DESTINATIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'black-hole', label: 'Black Hole' },
  { id: 'neutron-star', label: 'Neutron Star' },
  { id: 'stellar-explosion', label: 'Stellar Explosion' }
];

/** Developer destination — surfaced ONLY while Debug mode is active. */
const DEBUG_DESTINATION: { id: string; label: string } = {
  id: 'diagnostic',
  label: 'Diagnostic'
};

const EXPERIENCE_MODES: ReadonlyArray<{ id: ExperienceMode; label: string }> = [
  { id: 'scientific', label: 'Scientific' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'debug', label: 'Debug' }
];

const QUALITY_OPTIONS = QUALITY_MODE_VALUES.map((value) => ({ value, label: value }));
const TONE_MAPPING_OPTIONS = TONE_MAPPING_VALUES.map((value) => ({ value, label: value }));
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
  /** Rebuild chips from registry state; Diagnostic only under Debug mode. */
  const refreshNav = (): void => {
    const activeId = host.state.atlas.activeDestination;
    nav.replaceChildren();
    const entries = host.registry.has('stellar-explosion')
      ? [...PRODUCTION_DESTINATIONS]
      : PRODUCTION_DESTINATIONS.filter((d) => d.id !== 'stellar-explosion');
    if (host.experienceMode === 'debug') entries.push(DEBUG_DESTINATION);
    for (const destination of entries) {
      if (!host.registry.has(destination.id)) continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-nav-chip';
      chip.textContent = destination.label;
      chip.setAttribute('aria-pressed', activeId === destination.id ? 'true' : 'false');
      if (activeId === destination.id) chip.classList.add('is-active');
      chip.addEventListener('click', () => {
        host.navigate(destination.id);
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
      }).root
    );

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

  /** Debug telemetry readouts (bounded, no GPU readback). */
  function updateReadouts(): void {
    if (readouts === null) return;
    const inv = host.debugInventory();
    const backend = inv.backend;
    readouts.set([
      { label: 'Backend', value: backend ? `${backend.api} ${backend.adapterName}` : '—' },
      { label: 'Quality tier', value: host.governor.currentTier },
      { label: 'Render scale', value: host.governor.renderScale.toFixed(2) },
      { label: 'FPS (smoothed)', value: host.governor.smoothedFps.toFixed(0) },
      { label: 'Activity', value: host.governor.activityMode },
      { label: 'Destination', value: host.state.atlas.activeDestination },
      { label: 'Preset', value: host.state.atlas.activePreset || '(default)' },
      {
        label: 'Transition',
        value: host.state.atlas.transition.phase ?? 'idle'
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
  const tick = (nowMs: number): void => {
    const dtSeconds = Math.min((nowMs - lastMs) / 1000, 0.25);
    lastMs = nowMs;
    host.frame(dtSeconds);

    uiTimer += dtSeconds;
    if (uiTimer >= UI_SYNC_INTERVAL_SECONDS) {
      uiTimer = 0;
      const { destId, presetId } = activeSelection();
      const signature = `${destId}|${presetId}|${host.experienceMode}|${String(host.diagnosticsEnabled)}`;
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
      updateReadouts();
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  const unsubscribeStatus = host.status.subscribe((snapshot) => {
    if (snapshot.failed) {
      status.textContent = `Atlas error [${snapshot.errorCode ?? 'UNKNOWN'}]: ${snapshot.message}`;
    } else if (!snapshot.ready) {
      status.textContent = `Atlas: ${snapshot.message}`;
    }
  });

  // Test/inspection hook (mirrors __BLACKHOLE_TEST__ convention from main.ts).
  // Shape is load-bearing for tests/browser/support/atlasHook.ts — do not change
  // without updating that declaration and the specs that consume it.
  const captureFrame = (): string[] | null => {
    const rect = viewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    host.frame(1 / 60); // one deterministic frame, same-task readback
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
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      unsubscribeStatus();
      delete (window as unknown as Record<string, unknown>)['__ATLAS_APP__'];
      host.dispose();
      panelElement.replaceChildren();
    }
  };
}
