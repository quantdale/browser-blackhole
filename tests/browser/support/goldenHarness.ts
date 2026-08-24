/**
 * Golden-image regression harness (Gate D, campaign sections 15-17).
 *
 * Design contract (docs/cosmic-atlas/GOLDEN_IMAGES.md):
 * - Determinism is achieved by FIXING the documented axes rather than by
 *   trusting the app's defaults: viewport comes from playwright.config.ts
 *   (1280x800), the quality tier is pinned through
 *   `governor.setForcedTier()` (canvas sizing is then EXPLICITLY re-applied
 *   via `host.handleResize()` because nothing else re-fires it after a tier
 *   pin), the timeline is paused at phase 0, and the display chain is forced
 *   to exposure 1 / bloom off / linear tone mapping so presented pixels are a
 *   pure monotonic function of rendered radiance.
 * - Comparison is perceptual-tolerant, NOT pixel-exact: GPU scheduling,
 *   antialiasing of UI overlays and sub-frame transition timing make exact
 *   equality brittle across runs even on one machine. Metrics:
 *     meanAbsDelta      - mean per-pixel RGB delta magnitude (0..255 scale)
 *     pctPixelsBeyond   - % of pixels whose max-channel delta exceeds
 *                         `perChannelThreshold`
 *     maxChannelDelta   - worst single-channel delta (reported, not gated)
 * - Goldens are NEVER updated automatically on failure. Regeneration is an
 *   explicit reviewed act: UPDATE_GOLDENS=1 npx playwright test visual-goldens
 *
 * Screenshot target: the #viewport element only (render surface without UI
 * chrome), so control-panel text rendering cannot pollute physics goldens.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (single global augmentation).
import './atlasHook.js';

/** Root of this checkout; goldens live beside the specs that consume them. */
const GOLDEN_DIR = fileURLToPath(new URL('../goldens', import.meta.url));

/**
 * Structural superset of the shared AtlasHook view covering the host members
 * this harness drives (governor/timeline/navigate/handleResize). Declared
 * locally so the shared augmentation in atlasHook.ts stays minimal.
 */
interface GoldenControlSurface {
  governor: { setForcedTier(tier: 'low' | 'medium' | 'high' | 'ultra'): void };
  time: { pause(): void; scrubTo(phase01: number): void };
  navigate(destinationId: string, presetId?: string): unknown;
  handleResize(cssWidth: number, cssHeight: number): void;
}

export interface GoldenTolerance {
  /** Mean per-pixel RGB delta magnitude allowed (0..255 scale). */
  meanAbsDelta: number;
  /** Max percentage of pixels allowed beyond perChannelThreshold. */
  pctPixelsBeyond: number;
  /** Per-channel delta above which a pixel counts as "beyond". */
  perChannelThreshold: number;
}

export interface GoldenSpec {
  name: string;
  url: string;
  backendOverride?: 'webgpu' | 'webgl2';
  pinTier?: 'low' | 'medium' | 'high' | 'ultra';
  /**
   * When false the timeline is left running (transition capture); otherwise
   * it is paused and scrubbed to phase 0 for determinism.
   */
  pauseTimeline?: boolean;
  /** Deterministic timeline position captured while paused (default 0). */
  scrubPhase?: number;
  settleMs?: number;
  special?: 'hyperspace-mid';
  tolerance: GoldenTolerance;
  notes: string;
}

export interface GoldenMetrics {
  meanAbsDelta: number;
  pctPixelsBeyond: number;
  maxChannelDelta: number;
}

export interface GoldenResult {
  status: 'pass' | 'fail' | 'updated';
  metrics?: GoldenMetrics;
  message?: string;
}

interface DecodePayload {
  currentBase64: string;
  goldenBase64: string;
  perChannelThreshold: number;
}

/**
 * In-page PNG decode + metric computation. Both images are decoded through
 * createImageBitmap so no Node-side image dependency is required.
 */
async function compareInPage(
  page: Page,
  payload: DecodePayload
): Promise<GoldenMetrics & { widthMismatch: boolean }> {
  return page.evaluate(async ({ currentBase64, goldenBase64, perChannelThreshold }) => {
    async function decode(base64: string): Promise<ImageData> {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2d context unavailable');
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();
      return data;
    }

    const current = await decode(currentBase64);
    const golden = await decode(goldenBase64);
    if (current.width !== golden.width || current.height !== golden.height) {
      return {
        meanAbsDelta: Number.POSITIVE_INFINITY,
        pctPixelsBeyond: 100,
        maxChannelDelta: 255,
        widthMismatch: true
      };
    }

    let sumDelta = 0;
    let beyond = 0;
    let maxChannelDelta = 0;
    const pixels = current.width * current.height;
    for (let i = 0; i < pixels; i++) {
      const o = i * 4;
      let pixelMax = 0;
      for (let c = 0; c < 3; c++) {
        // Bitwise-ish absolute delta over RGB (alpha ignored: opaque canvas).
        const d = Math.abs((current.data[o + c] ?? 0) - (golden.data[o + c] ?? 0));
        sumDelta += d;
        if (d > pixelMax) pixelMax = d;
        if (d > maxChannelDelta) maxChannelDelta = d;
      }
      if (pixelMax > perChannelThreshold) beyond++;
    }
    return {
      meanAbsDelta: sumDelta / (pixels * 3),
      pctPixelsBeyond: (beyond / pixels) * 100,
      maxChannelDelta,
      widthMismatch: false
    };
  }, payload);
}

/** Poll until the atlas app reports arrival at a non-transitioning state. */
async function waitForArrival(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return 'arrived';
        }),
      { timeout: 30_000, intervals: [250] }
    )
    .toBe('arrived');
}

/**
 * Poll the live camera until its position stops moving (arrival-ease done).
 * Without this, screenshot content depends on how far the eased camera
 * travelled when the capture fired — machine-load-dependent.
 */
async function waitForCameraSettle(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.evaluate(
    (timeout) =>
      new Promise<void>((resolve) => {
        const host = window.__ATLAS_APP__!.host as unknown as {
          camera: { position: { x: number; y: number; z: number } };
        };
        let last = { ...host.camera.position };
        const startedAt = performance.now();
        const poll = (): void => {
          const now = host.camera.position;
          const delta = Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z);
          last = { ...now };
          if (delta < 1e-4 || performance.now() - startedAt > timeout) resolve();
          else setTimeout(poll, 100);
        };
        setTimeout(poll, 150);
      }),
    timeoutMs
  );
}

/**
 * Apply every documented determinism forcing inside the page. Returns the
 * CSS size that was re-applied so callers can assert sanity.
 */
async function applyDeterminismForcing(page: Page, spec: GoldenSpec): Promise<void> {
  await page.evaluate(
    ({ tier, pauseTimeline, scrubPhase }) => {
      const host = window.__ATLAS_APP__!.host as unknown as {
        governor: { setForcedTier(tier: 'low' | 'medium' | 'high' | 'ultra'): void };
        time: { pause(): void; scrubTo(phase01: number): void };
      };
      // Pin the tier under auto mode; nothing re-applies canvas sizing after
      // a tier change, so re-drive resize explicitly below.
      host.governor.setForcedTier(tier);
      if (pauseTimeline !== false) {
        host.time.pause();
        host.time.scrubTo(scrubPhase ?? 0);
      }
      // Pure monotonic display chain (mirrors integrator-parity.spec.ts).
      const post = window.__ATLAS_APP__!.host.post;
      post.setBloom(false, 0);
      post.setExposure(1);
      post.setToneMapping('linear');
    },
    {
      tier: spec.pinTier ?? 'low',
      pauseTimeline: spec.pauseTimeline ?? true,
      scrubPhase: spec.scrubPhase ?? 0
    }
  );
  // Re-apply sizing AFTER the tier pin (renderScale changes with the tier).
  const box = await page.locator('#viewport').boundingBox();
  if (box && box.width > 0 && box.height > 0) {
    await page.evaluate(
      ({ width, height }) => {
        (window.__ATLAS_APP__!.host as unknown as GoldenControlSurface).handleResize(width, height);
      },
      { width: box.width, height: box.height }
    );
  }
}

/**
 * Execute one golden expectation end-to-end: navigate, force determinism,
 * capture, compare against (or update) the committed baseline.
 *
 * DETERMINISM ORDERING (critical for destinations that integrate their own
 * clocks from frame dt — e.g. neutron-star rotation): boot on the neutral
 * default route, PAUSE the global clock FIRST, then navigate to the target.
 * The destination module seeds from preset state at enter() and integrates
 * dt only while playing, so it enters FROZEN at phase 0 regardless of machine
 * load. A camera-settle wait then removes arrival-ease timing variance.
 */
export async function runGoldenExpectation(page: Page, spec: GoldenSpec): Promise<GoldenResult> {
  const url =
    spec.backendOverride === undefined
      ? spec.url
      : `${spec.url}${spec.url.includes('?') ? '&' : '?'}backend=${spec.backendOverride}`;

  if (spec.special === 'hyperspace-mid') {
    await page.goto(url);
    await waitForArrival(page);
    // Transition capture: determinism forcing first, then depart and shoot
    // the moment the hyperspace field dominates. Timeline scrubbing is
    // skipped by design (pauseTimeline false in the spec row).
    await applyDeterminismForcing(page, spec);
    await page.evaluate(() => {
      (window.__ATLAS_APP__!.host as unknown as GoldenControlSurface).navigate('neutron-star');
    });
    await expect
      .poll(
        async () => page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.transition.phase),
        { timeout: 15_000, intervals: [50] }
      )
      .toBe('hyperspace');
    return writeOrCompare(page, spec, await page.locator('#viewport').screenshot());
  }

  // Standard flow: boot default -> pause clock -> navigate frozen -> settle.
  await page.goto('/atlas/black-hole');
  await waitForArrival(page);
  if (spec.pauseTimeline !== false) {
    await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host as unknown as {
        time: { pause(): void; scrubTo(phase01: number): void };
      };
      host.time.pause();
      host.time.scrubTo(0);
    });
  }
  const target = url.replace(/^.*\/atlas\//, '/atlas/');
  if (!target.startsWith('/atlas/black-hole')) {
    await page.evaluate((route) => {
      const [pathAndQuery] = [route];
      const withoutPrefix = pathAndQuery.replace(/^\/atlas\//, '');
      const [dest, query] = withoutPrefix.split('?');
      const preset = new URLSearchParams(query ?? '').get('preset') ?? undefined;
      (window.__ATLAS_APP__!.host as unknown as GoldenControlSurface).navigate(dest!, preset);
    }, target);
    await waitForArrival(page);
  }

  await applyDeterminismForcing(page, spec);
  await waitForCameraSettle(page);
  await page.waitForTimeout(spec.settleMs ?? 500);
  return writeOrCompare(page, spec, await page.locator('#viewport').screenshot());
}

/** Write-or-compare tail shared by both capture paths. */
async function writeOrCompare(page: Page, spec: GoldenSpec, buffer: Buffer): Promise<GoldenResult> {
  const goldenPath = join(GOLDEN_DIR, `${spec.name}.png`);
  if (process.env.UPDATE_GOLDENS === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, buffer);
    return { status: 'updated' };
  }
  return compareAgainstGolden(page, spec, buffer);
}

/**
 * Async comparison half — split from {@link runGoldenExpectation} because
 * Playwright screenshots are Buffers but the metric computation must run in
 * the page. The spec file awaits both halves back to back.
 */
export async function compareAgainstGolden(
  page: Page,
  spec: GoldenSpec,
  buffer: Buffer
): Promise<GoldenResult> {
  const goldenPath = join(GOLDEN_DIR, `${spec.name}.png`);
  if (!existsSync(goldenPath)) {
    return {
      status: 'fail',
      message: `golden missing: ${goldenPath} (run UPDATE_GOLDENS=1 once to establish)`
    };
  }
  const goldenBuffer = readFileSync(goldenPath);
  const metrics = await compareInPage(page, {
    currentBase64: buffer.toString('base64'),
    goldenBase64: goldenBuffer.toString('base64'),
    perChannelThreshold: spec.tolerance.perChannelThreshold
  });
  if (metrics.widthMismatch) {
    return {
      status: 'fail',
      message: 'dimension mismatch between captured frame and golden'
    };
  }
  const within =
    metrics.meanAbsDelta <= spec.tolerance.meanAbsDelta &&
    metrics.pctPixelsBeyond <= spec.tolerance.pctPixelsBeyond;
  return {
    status: within ? 'pass' : 'fail',
    metrics: {
      meanAbsDelta: +metrics.meanAbsDelta.toFixed(3),
      pctPixelsBeyond: +metrics.pctPixelsBeyond.toFixed(4),
      maxChannelDelta: metrics.maxChannelDelta
    },
    ...(within ? {} : { message: `tolerance exceeded for ${spec.name}` })
  };
}

/**
 * Initial golden set (campaign §16). Rows for destinations/presets landing
 * later in this campaign are appended here as they become available, e.g.
 *
 *   { name: 'BH_FACE_ON_DISK', url: '/atlas/black-hole?preset=face-on-disk',
 *     tolerance: BH_TOLERANCE, notes: '...' },
 *   { name: 'SN_PROGENITOR', url: '/atlas/stellar-explosion?preset=core-collapse',
 *     ... phase-scrubbed rows once CA4 lands ... }
 */
export const GOLDEN_SPECS: GoldenSpec[] = [
  {
    name: 'ATLAS_DIAGNOSTIC',
    url: '/atlas/diagnostic',
    tolerance: { meanAbsDelta: 2, pctPixelsBeyond: 0.5, perChannelThreshold: 24 },
    notes:
      'Deterministic camera-ray gradient pattern; catches boot/compositing regressions of the atlas shell itself. Tight tolerance: fully static scene.'
  },
  {
    name: 'BH_CLASSIC',
    url: '/atlas/black-hole',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 2, perChannelThreshold: 32 },
    notes:
      'Default Schwarzschild lensing + accretion disk view; catches gross lensing/disk/post regressions (shadow loss, disk disappearance, inverted beaming).'
  },
  {
    name: 'NS_SURFACE',
    url: '/atlas/neutron-star',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 2, perChannelThreshold: 32 },
    notes:
      'Neutron-star default preset (surface + hot spot + dipole lines); catches surface-emission and field-line regressions.'
  },
  {
    name: 'NS_PULSAR',
    url: '/atlas/neutron-star?preset=pulsar',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 2, perChannelThreshold: 32 },
    notes:
      'Pulsar preset at phase-0 rotation; catches hot-spot/beam geometry regressions (lighthouse pattern at t=0).'
  },
  {
    name: 'NS_MAGNETAR',
    url: '/atlas/neutron-star?preset=magnetar',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 2, perChannelThreshold: 32 },
    notes:
      'Magnetar preset with flare envelope active at fixed flarePhase; catches flare-envelope and tint regressions.'
  },
  {
    name: 'ATLAS_HYPERSPACE_BH_NS',
    url: '/atlas/black-hole',
    special: 'hyperspace-mid',
    pauseTimeline: false,
    tolerance: { meanAbsDelta: 25, pctPixelsBeyond: 48, perChannelThreshold: 35 },
    notes:
      'Mid-transition hyperspace field between Black Hole and Neutron Star. Generous tolerance: the exact frame captured depends on transition timing jitter; asserts the transition system renders AT ALL (streak field present, scene handoff not black).'
  },
  // --- Stellar Explosion goldens (CA4) --------------------------------------
  // Timeline positions are deterministic: the destination enters paused and
  // the harness scrubs to `scrubPhase` before capture; volume jitter is off.
  {
    name: 'SN_PROGENITOR',
    url: '/atlas/stellar-explosion?preset=core-collapse',
    scrubPhase: 0.03,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 4, pctPixelsBeyond: 1.5, perChannelThreshold: 32 },
    notes:
      'Red-supergiant progenitor before collapse; catches missing progenitor surface, tint/gain regressions, camera/preset breakage.'
  },
  {
    name: 'SN_FLASH',
    url: '/atlas/stellar-explosion?preset=core-collapse',
    scrubPhase: 0.24,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 2.5, perChannelThreshold: 40 },
    notes:
      'Shock-flash window (hot blue-white peak luminosity proxy); catches emissivity-evolution and volume-ignition regressions.'
  },
  {
    name: 'SN_EXPANSION',
    url: '/atlas/stellar-explosion?preset=core-collapse',
    scrubPhase: 0.55,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 3, perChannelThreshold: 40 },
    notes:
      'Expanding-ejecta phase (shell + clumping + particles); catches lost volume, broken particle population, gross morphology drift.'
  },
  {
    name: 'SN_HYPERNOVA',
    url: '/atlas/stellar-explosion?preset=hypernova',
    scrubPhase: 0.55,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 3, perChannelThreshold: 40 },
    notes:
      'Hypernova at matched phase — structurally distinct model state (higher velocity scale, stronger anisotropy), NOT a brightness scalar.'
  },
  {
    name: 'SN_GRB_ON',
    url: '/atlas/stellar-explosion?preset=long-grb-on-axis',
    scrubPhase: 0.42,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 4, perChannelThreshold: 48 },
    notes:
      'Long-GRB bipolar jet viewed on-axis (beamed response saturated); catches lost-jet and viewing-response regressions.'
  },
  {
    name: 'SN_GRB_OFF',
    url: '/atlas/stellar-explosion?preset=long-grb-off-axis',
    scrubPhase: 0.42,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 4, perChannelThreshold: 48 },
    notes:
      'Same GRB engine viewed off-axis — must differ from SN_GRB_ON geometrically; catches flat-multiplier regressions of viewing response.'
  },
  // --- Compact Merger goldens (CA5) ------------------------------------------
  // Timeline positions are deterministic: the destination enters paused and
  // the harness scrubs to `scrubPhase` before capture; volume jitter is off
  // and every model quantity is a pure function of the scrub position.
  {
    name: 'CM_INSPIRAL',
    url: '/atlas/compact-merger?preset=equal-mass-nsns',
    scrubPhase: 0.05,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 2, perChannelThreshold: 32 },
    notes:
      'Binary inspiral mid-window: two compact surfaces + closed-form orbit trails on dark sky. Catches star/trail loss, orbit-phase regressions, sky breakage.'
  },
  {
    name: 'CM_MERGER',
    url: '/atlas/compact-merger?preset=equal-mass-nsns',
    scrubPhase: 0.37,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 4, perChannelThreshold: 48 },
    notes:
      'Merger flash + early ejecta ignition. Catches flash-envelope and volume-ignition regressions; bloom-carrying frame needs moderate tolerance.'
  },
  {
    name: 'CM_KILONOVA',
    url: '/atlas/compact-merger?preset=equal-mass-nsns',
    scrubPhase: 0.7,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 5, perChannelThreshold: 48 },
    notes:
      'Kilonova light-curve peak: warm expanding shell + remnant. Catches emission/temperature-trend and shell-radius regressions.'
  },
  {
    name: 'CM_GRB_ON',
    url: '/atlas/compact-merger?preset=short-grb-on-axis',
    scrubPhase: 0.54,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 5, perChannelThreshold: 48 },
    notes:
      'Short-GRB bipolar jet viewed on-axis (response saturated). Catches lost-jet and viewing-response regressions on-axis.'
  },
  {
    name: 'CM_GRB_OFF',
    url: '/atlas/compact-merger?preset=short-grb-off-axis',
    scrubPhase: 0.54,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 5, perChannelThreshold: 48 },
    notes:
      'Identical engine viewed 68 deg off-axis — bipolar diamond geometry must differ from CM_GRB_ON; catches flat-multiplier response regressions.'
  },
  {
    name: 'CM_REMNANT',
    url: '/atlas/compact-merger?preset=kilonova-focus',
    scrubPhase: 0.9,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 5, perChannelThreshold: 48 },
    notes:
      'Afterglow with prompt-BH remnant scenario (faint accretion glow, fading ejecta). Catches remnant-scenario and late-timeline resource regressions.'
  },
  // --- Tidal Disruption goldens (CA6) -----------------------------------------
  // Timeline positions are deterministic: the destination enters paused and
  // the harness scrubs to `scrubPhase` before capture; volume jitter is off
  // and every model quantity is a pure function of the scrub position. The
  // arrival camera frames the boot-phase star; later-phase rows rely on the
  // star-anchored camera keeping the black-hole/shock region ~22 deg off-axis.
  {
    name: 'TDE_APPROACH',
    url: '/atlas/tidal-disruption?preset=solar-canonical',
    scrubPhase: 0.16,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 2, perChannelThreshold: 32 },
    notes:
      'Boot frame: tidally deformed star close-up on inbound corridor, BH marker near frame edge. Catches star-loss, deformation-graph, and arrival-framing regressions.'
  },
  {
    name: 'TDE_DEFORMATION',
    url: '/atlas/tidal-disruption?preset=solar-canonical',
    scrubPhase: 0.26,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 2, perChannelThreshold: 32 },
    notes:
      'Strong pre-disruption elongation (stretch well above 1). Catches deformation ordering/cap regressions and axis-orientation breaks.'
  },
  {
    name: 'TDE_DEBRIS',
    url: '/atlas/tidal-disruption?preset=solar-canonical',
    scrubPhase: 0.36,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 4, perChannelThreshold: 48 },
    notes:
      'Young debris: star faded, compact bound (warm) + unbound (cool) stream arcs near periapsis + accent particles. Catches stream-loss, handoff-fade and spine-crop regressions.'
  },
  {
    name: 'TDE_WINDING',
    url: '/atlas/tidal-disruption?preset=deep-penetration',
    scrubPhase: 0.77,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 4, perChannelThreshold: 48 },
    notes:
      'Deep-penetration first wraps: differential Kepler winding of the most-bound family around the BH (beta 2.5 morphology, early shock segment). Catches winding-phase and energy-spread regressions.'
  },
  {
    name: 'TDE_SHOCK',
    url: '/atlas/tidal-disruption?preset=solar-canonical',
    scrubPhase: 0.78,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 4, perChannelThreshold: 48 },
    notes:
      'Shock stage: equatorial emissivity volume active at the circularization radius. Catches volume-ignition and phase-gating regressions.'
  },
  {
    name: 'TDE_NASCENT_DISK',
    url: '/atlas/tidal-disruption?preset=solar-canonical',
    scrubPhase: 0.97,
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 5, perChannelThreshold: 48 },
    notes:
      'Nascent-disk stage: procedural annulus gain ramp, streams retired, volume off. Catches late-phase resource-retirement and disk-gain regressions.'
  },
  // --- Kerr goldens (M9) -------------------------------------------------------
  // Numerical Kerr backend frames; same determinism axes as the Schwarzschild
  // rows (paused timeline, pinned tier, monotonic display chain). Spinning
  // rows carry slightly looser tolerances than BH_CLASSIC because frame
  // dragging increases per-pixel trajectory winding (f32 sensitivity).
  {
    name: 'KERR_ZERO_SPIN',
    url: '/atlas/black-hole?preset=kerr-zero-spin',
    pinTier: 'low',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 2, perChannelThreshold: 32 },
    notes:
      'Numerical Kerr backend at a*=0 — the spin->0 convergence reference view. Must remain visually indistinguishable from the Schwarzschild path within documented tolerances; catches silent backend/fallback flips.'
  },
  {
    name: 'KERR_HIGH_PROGRADE',
    url: '/atlas/black-hole?preset=kerr-high-prograde',
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 3, perChannelThreshold: 40 },
    notes:
      'a*=+0.9 prograde thin disk down to the BPT ISCO; frame-dragged asymmetric photon ring. Catches lost spin dependence, ISCO-edge and dragging-direction regressions.'
  },
  {
    name: 'KERR_RETROGRADE',
    url: '/atlas/black-hole?preset=kerr-retrograde',
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 3, perChannelThreshold: 40 },
    notes:
      'a*=-0.7 with the disk still +Y-corotating (retrograde relative to spin): ISCO pushed to ~8 r_g, counter-dragging. Must differ geometrically from KERR_HIGH_PROGRADE.'
  },
  // --- Quasar / AGN goldens (CA7) ----------------------------------------------
  // One row per scale zone plus the blazar orientation: pins the zone
  // machine's boot state, the double-render guard, and the DIRECT-pass
  // exclusivity rule visually.
  {
    name: 'AGN_INNER_ENGINE',
    url: '/atlas/quasar-agn?preset=inner-engine',
    pinTier: 'low',
    tolerance: { meanAbsDelta: 6, pctPixelsBeyond: 2, perChannelThreshold: 32 },
    notes:
      'INNER zone: DIRECT lensing pass + corona proxy. Catches silent backend loss or corona disappearance in the close-range zone.'
  },
  {
    name: 'AGN_NUCLEAR',
    url: '/atlas/quasar-agn?preset=quasar-reference',
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 3, perChannelThreshold: 40 },
    notes:
      'NUCLEAR zone: outer disk + dusty torus + bipolar jet base at 45 deg from the axis; GR pass culled. Catches torus/jet loss and zone-boot regressions.'
  },
  {
    name: 'AGN_RADIO_GALAXY',
    url: '/atlas/quasar-agn?preset=radio-galaxy',
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 3, perChannelThreshold: 40 },
    notes:
      'GALACTIC zone: kpc-scale extended jets with knots over the procedural host. Catches host/jet-extension and cull-guard regressions.'
  },
  {
    name: 'AGN_BLAZAR_VIEW',
    url: '/atlas/quasar-agn?preset=blazar-view',
    pinTier: 'low',
    tolerance: { meanAbsDelta: 8, pctPixelsBeyond: 3, perChannelThreshold: 40 },
    notes:
      'Blazar orientation (~3 deg from the jet axis): approaching lobe dominates via the disclosed constant-sum beaming gains. Catches lobe-asymmetry regressions.'
  }
];
