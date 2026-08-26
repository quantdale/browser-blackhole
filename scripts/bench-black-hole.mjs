/**
 * Repeatable black-hole numerical-vs-LUT matched-comparison harness
 * (M8-08 / campaign §2.1).
 *
 * Measures steady-state FRAME times (rAF deltas — NOT GPU timestamps; see the
 * frameGpuMs note in the record) of /atlas/black-hole after pipeline warm-up
 * at fully pinned conditions: trajectory backend (set through canonical state,
 * not URL scraping), preset, quality tier, viewport, and a manual render scale
 * for deterministic internal resolution. Prints ONE JSON record per run
 * conforming closely to docs/BENCHMARK_MATRIX.md §1.
 *
 * Usage:
 *   node scripts/bench-black-hole.mjs [--backend=numerical|lut|auto]
 *        [--preset=default] [--quality=medium|low|high|ultra|auto]
 *        [--width=1280] [--height=800] [--render-scale=1|0]
 *        [--frames=600] [--warmup-ms=9000] [--channel=msedge|chrome|chromium]
 *        [--label=run] [--port=4183]
 *        [--observer=camera|static|circular|flyby|freefall]
 *        [--observer-radius=12] [--observer-sense=1]
 *        [--observer-beta=0.6] [--observer-impact=8] [--observer-release=14]
 *
 * M11 (WS1B): --observer drives the M10 physical observer through the
 * canonical control channel as a FIRST-CLASS benchmark input. The atlas
 * transport is PAUSED, so the worldline sits at its deterministic tau = 0
 * epoch for the whole run (matched moving-observer comparisons measure the
 * same spacetime/view state). The record's `observer` block carries the
 * mode plus the live readout (radius/beta) so a mis-applied mode fails the
 * comparison honestly instead of silently benchmarking the wrong scene.
 * Moving-observer Kerr workloads run the scaled step budget (see
 * blackHoleDestination) — the record's quality block reports the tier, and
 * the preset contract (recommendedQuality) should be respected when a
 * comparison intends to represent the shipped experience.
 *
 * --render-scale=0 keeps governor-managed dynamic resolution; any value in
 * [0.25, 2] pins a FIXED internal resolution (dynamicResolution off), which is
 * what matched backend comparisons must use.
 *
 * Paired convenience scripts live in package.json
 * (bench:black-hole:numerical / bench:black-hole:lut). Machine-specific raw
 * records are NOT committed by default; small durable summaries may live under
 * benchmarks/ where repository policy allows (BENCHMARK_MATRIX §11).
 */

import { preview } from 'vite';
import { chromium } from '@playwright/test';
import os from 'node:os';
import { execSync } from 'node:child_process';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const BACKENDS = new Set(['numerical', 'lut', 'auto']);
const QUALITIES = new Set(['auto', 'low', 'medium', 'high', 'ultra']);

const backend = String(arg('backend', 'auto'));
const preset = String(arg('preset', 'default'));
const quality = String(arg('quality', 'medium'));
const width = Number(arg('width', '1280'));
const height = Number(arg('height', '800'));
const renderScale = Number(arg('render-scale', '0')); // 0 = governor-managed
const frames = Math.max(60, Number(arg('frames', '600')));
const warmupMs = Number(arg('warmup-ms', '9000'));
const channel = String(arg('channel', 'msedge'));
const label = String(arg('label', 'run'));
const port = Number(arg('port', '4183'));
const observer = String(arg('observer', ''));
const observerRadius = Number(arg('observer-radius', '12'));
const observerSense = Number(arg('observer-sense', '1'));
const observerBeta = Number(arg('observer-beta', '0.6'));
const observerImpact = Number(arg('observer-impact', '8'));
const observerRelease = Number(arg('observer-release', '14'));

const OBSERVER_MODES = new Set(['', 'camera', 'static', 'circular', 'flyby', 'freefall']);
if (!OBSERVER_MODES.has(observer)) {
  console.error(`[bench] invalid --observer=${observer} (camera|static|circular|flyby|freefall)`);
  process.exit(2);
}

if (!BACKENDS.has(backend)) {
  console.error(`[bench] invalid --backend=${backend} (numerical|lut|auto)`);
  process.exit(2);
}
if (!QUALITIES.has(quality)) {
  console.error(`[bench] invalid --quality=${quality} (auto|low|medium|high|ultra)`);
  process.exit(2);
}

function currentCommit() {
  if (process.env.BENCH_COMMIT) return process.env.BENCH_COMMIT;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
}

const server = await preview({ preview: { port, host: '127.0.0.1' } });
const launchOptions = channel === 'chromium' ? {} : { channel };
const browser = await chromium.launch(launchOptions);
const browserName = channel === 'chromium' ? 'chromium' : channel;
const page = await browser.newPage({ viewport: { width, height } });

/** Console errors that indicate real trouble (same filter class as e2e). */
const consoleErrors = [];
const suppressedConsoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (/powerPreference|readback|Failed to load resource/.test(text)) {
    suppressedConsoleErrors.push(text.slice(0, 120));
    return;
  }
  consoleErrors.push(text.slice(0, 200));
});

await page.goto(`http://127.0.0.1:${port}/atlas/black-hole?preset=${encodeURIComponent(preset)}`);
await page.waitForFunction(
  () => window.__ATLAS_APP__ && window.__ATLAS_APP__.host.state.atlas.transition.active === false,
  null,
  { timeout: 30000 }
);

// Pin ALL measurement conditions through canonical state (never uniforms):
// trajectory backend preference, quality tier, manual render scale. Resize is
// driven by the REAL #viewport rect so internal resolution is deterministic
// regardless of UI layout; the re-applied resize applies tier/scale cleanly.
await page.evaluate(
  ({ q, scale }) => {
    const host = window.__ATLAS_APP__.host;
    if (q !== 'auto') host.governor.configure({ qualityMode: q });
    if (scale > 0) host.setRenderScaleOverride(scale);
    const rect = document.getElementById('viewport').getBoundingClientRect();
    host.handleResize(rect.width, rect.height);
    host.time.pause();
  },
  { q: quality, scale: renderScale }
);
await page.waitForTimeout(warmupMs / 2);

// Trajectory backend rides canonical state (M8-09); 'auto' keeps the default.
if (backend !== 'auto') {
  await page.evaluate((pref) => {
    window.__ATLAS_APP__.host.setTrajectoryBackend(pref);
  }, backend);
}

// M11 WS1B: first-class observer selection through the canonical control
// channel. Applied AFTER the backend so a Kerr destination override (which
// forces the numerical backend) still reports its truthful effective backend
// below. The transport stays PAUSED: the worldline sits at tau = 0.
if (observer !== '') {
  await page.evaluate(
    ({ mode, radius, sense, beta, impact, release }) => {
      const patch = { mode };
      if (mode === 'circular') {
        patch.circularRadiusRg = radius;
        patch.circularSense = sense >= 0 ? 1 : -1;
      }
      if (mode === 'flyby') {
        patch.flybyBetaInfinity = beta;
        patch.flybyImpactParameterRg = impact;
      }
      if (mode === 'freefall') {
        patch.freefallReleaseRadiusRg = release;
      }
      const host = window.__ATLAS_APP__.host;
      // Deterministic epoch: a preset-borne observer starts integrating at
      // destination ENTER, which precedes the transition-inactive signal the
      // harness waits on, so tau may already have advanced by a
      // machine-load-dependent amount. Observer control changes reseed tau
      // to 0 (M10-07), so route through 'camera' and back — the final
      // signature is the requested one and the worldline sits at tau = 0
      // under the paused transport.
      host.setDestinationControl('black-hole', { observer: { mode: 'camera' } });
      host.setDestinationControl('black-hole', { observer: patch });
    },
    {
      mode: observer,
      radius: observerRadius,
      sense: observerSense,
      beta: observerBeta,
      impact: observerImpact,
      release: observerRelease
    }
  );
  await page.waitForTimeout(warmupMs / 4);
}
await page.waitForTimeout(warmupMs / 2);

const info = await page.evaluate(() => {
  const app = window.__ATLAS_APP__;
  const host = app.host;
  const inv = host.debugInventory();
  const canvas = document.getElementById('scene');
  const snap = host.activeDestinationDebugSnapshot() ?? {};
  const uaEdge = navigator.userAgent.match(/Edg\/([\d.]+)/);
  const uaChrome = navigator.userAgent.match(/Chrome\/([\d.]+)/);
  const scopes = inv.resourceScopes.map((s) => ({
    name: s.name,
    textures: s.counters.texture,
    bytes: s.counters.estimatedGpuBytes
  }));
  return {
    activeDestination: host.state.atlas.activeDestination,
    activePreset: host.state.atlas.activePreset || '(default)',
    observerMode: snap.observerMode ?? null,
    observerReadout: (() => {
      const ro = snap.observerReadout ?? {};
      return {
        valid: ro.valid ?? null,
        invalidReason: ro.invalidReason ?? null,
        radiusRg: ro.radiusRg ?? null,
        betaMagnitude: ro.betaMagnitude ?? null,
        properTimeTau: ro.properTimeTau ?? null
      };
    })(),
    requestedBackend: snap.trajectoryBackendRequested ?? null,
    effectiveBackend: snap.trajectoryBackendEffective ?? null,
    fallbackReason: snap.lutFallbackReason ?? null,
    lutFamilyLoaded: snap.lutFamilyLoaded ?? false,
    lutFamilyDir: snap.lutFamilyDir ?? null,
    lutWebgl2Filterable: snap.lutWebgl2Filterable ?? null,
    tier: inv.governor.tier,
    // Effective scale actually driving internal resolution right now.
    renderScale: host.renderScaleOverride ?? inv.governor.renderScale,
    activityMode: inv.governor.activityMode,
    internal: [canvas.width, canvas.height],
    devicePixelRatio: window.devicePixelRatio,
    adapterName: inv.backend ? inv.backend.adapterName : null,
    backendApi: inv.backend ? inv.backend.api : null,
    timestampQuery: inv.backend ? inv.backend.timestampQuery : false,
    totalEstimatedGpuBytes: inv.totalEstimatedGpuBytes,
    totalTextures: inv.totalResourceCounts.texture,
    resourceScopes: scopes,
    browserVersion: uaEdge ? uaEdge[1] : uaChrome ? uaChrome[1] : 'unknown',
    platform: navigator.platform
  };
});

const qualityMismatch =
  quality !== 'auto' && info.tier !== quality ? `${quality}->${info.tier}` : null;

// Steady-state sampling INSIDE the page: rAF deltas over `frames` frames while
// PAUSED (rendering continues; simulation time frozen). These are FRAME times
// measured on the CPU side of the rAF loop — never label them GPU timestamps.
const samples = await page.evaluate(
  (frameCount) =>
    new Promise((resolve) => {
      /** @type {number[]} */
      const deltas = [];
      let last = performance.now();
      function tick(now) {
        deltas.push(now - last);
        last = now;
        if (deltas.length >= frameCount) {
          resolve(deltas);
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }),
  frames
);

// BH-121: resolve the GPU timestamp pool after sampling and read the window
// mean (null when this backend does not expose timestamp queries).
const gpuFrameMs = await page.evaluate(async () => {
  const app = window.__ATLAS_APP__;
  if (!app || typeof app.host.flushGpuTimestamps !== 'function') return null;
  try {
    return await app.host.flushGpuTimestamps();
  } catch {
    return null;
  }
});

const sorted = [...samples].sort((a, b) => a - b);
const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
const round2 = (v) => +v.toFixed(2);

const record = {
  schemaVersion: 1,
  kind: 'black-hole-backend-comparison',
  date: new Date().toISOString(),
  label,
  commit: currentCommit(),
  destination: info.activeDestination,
  preset: info.activePreset,
  trajectoryBackend: {
    requested: info.requestedBackend,
    effective: info.effectiveBackend,
    fallbackReason: info.fallbackReason
  },
  // M11 WS1B: first-class observer evidence. `requested` is the harness
  // input; `effectiveMode`/`readout` come from the destination debug
  // snapshot so a mis-applied mode is visible in the record itself.
  observer: {
    requested: observer === '' ? null : observer,
    effectiveMode: info.observerMode,
    readout: info.observerReadout
  },
  lut: {
    familyLoaded: info.lutFamilyLoaded,
    familyDir: info.lutFamilyDir,
    webgl2Filterable: info.lutWebgl2Filterable
  },
  browser: { name: browserName, version: info.browserVersion },
  os: `${os.type()} ${os.release()} (${process.platform})`,
  platform: info.platform,
  adapter: { name: info.adapterName },
  backend: info.backendApi,
  timestampQueryAvailable: info.timestampQuery,
  viewportCss: [width, height],
  devicePixelRatio: info.devicePixelRatio,
  effectiveRenderSize: info.internal,
  quality: { requested: quality, effectiveTier: info.tier, mismatch: qualityMismatch },
  renderScale: info.renderScale,
  activityMode: info.activityMode,
  warmupMs,
  sampleFrames: sorted.length,
  frameCpuMs: {
    // rAF wall deltas around the whole orchestrated frame (update+render+
    // present). Percentiles over the sorted sample set.
    min: round2(sorted[0]),
    median: round2(pick(0.5)),
    p90: round2(pick(0.9)),
    p95: round2(pick(0.95)),
    p99: round2(pick(0.99)),
    max: round2(sorted[sorted.length - 1]),
    mean: round2(mean),
    stdev: round2(Math.sqrt(variance))
  },
  // BH-121: real GPU timestamp reading when the backend exposes timestamp
  // queries; otherwise honestly null — never inferred from CPU rAF deltas.
  // The value is the LAST resolved frame's summed render-pass time.
  frameGpuMs:
    gpuFrameMs === null || !Number.isFinite(gpuFrameMs)
      ? null
      : { lastResolvedFrame: round2(gpuFrameMs) },
  gpuTimingNote:
    gpuFrameMs === null || !Number.isFinite(gpuFrameMs)
      ? 'not available: rAF frame deltas are CPU-side measurements, not GPU timestamps'
      : 'GPU milliseconds from hardware timestamp queries (three trackTimestamp): summed render-pass time of the final resolved frame',
  memory: {
    estimatedGpuBytesTotal: info.totalEstimatedGpuBytes,
    textureCount: info.totalTextures,
    resourceScopes: info.resourceScopes
  },
  consoleErrors: consoleErrors.length,
  suppressedConsoleErrors: suppressedConsoleErrors.length,
  consoleErrorSamples: consoleErrors.slice(0, 5),
  notes:
    renderScale > 0
      ? `fixed internal resolution via render-scale=${renderScale}`
      : 'governor-managed dynamic resolution'
};
console.log(JSON.stringify(record, null, 1));

await browser.close();
await server.close();

const backendMismatch =
  backend !== 'auto' && info.effectiveBackend !== backend
    ? `[bench] WARNING: requested ${backend}, effective ${info.effectiveBackend} (${info.fallbackReason})`
    : null;
const observerMismatch =
  observer !== '' && info.observerMode !== observer
    ? `[bench] WARNING: requested observer ${observer}, effective ${info.observerMode}`
    : null;
if (qualityMismatch !== null) {
  console.error(`[bench] WARNING: quality tier mismatch ${qualityMismatch}`);
}
if (backendMismatch !== null) console.error(backendMismatch);
if (observerMismatch !== null) console.error(observerMismatch);
process.exit(0);
