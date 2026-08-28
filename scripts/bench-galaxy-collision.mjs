/**
 * Galaxy Collision performance harness (CA9, campaign §38).
 *
 * Measures steady-state frame times of /atlas/galaxy-collision at a
 * representative timeline position, after pipeline warm-up, at fixed viewport
 * and quality settings — the same methodology as scripts/bench-black-hole.mjs.
 *
 * Usage:
 *   node scripts/bench-galaxy-collision.mjs [--preset=bridge-tail]
 *        [--phase=0.5] [--frames=600] [--warmupMs=9000] [--port=4187]
 *        [--quality=low|medium|high|ultra|auto] [--label=gc-baseline]
 *        [--force-backend=webgpu|webgl2]
 *
 * Prints one JSON record (stdout) matching the campaign benchmark schema;
 * machine-specific runs are NOT committed by default.
 */

import { preview } from 'vite';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const frames = Number(arg('frames', '600'));
const warmupMs = Number(arg('warmupMs', '9000'));
const port = Number(arg('port', '4187'));
const label = String(arg('label', 'run'));
const preset = String(arg('preset', 'bridge-tail'));
const phase = Math.min(Math.max(Number(arg('phase', '0.5')), 0), 1);
const quality = String(arg('quality', 'medium'));
const forceBackend = String(arg('force-backend', ''));

const FORCE_BACKENDS = new Set(['', 'webgpu', 'webgl2']);
if (!FORCE_BACKENDS.has(forceBackend)) {
  console.error(`[bench] invalid --force-backend=${forceBackend} (webgpu|webgl2)`);
  process.exit(2);
}

const server = await preview({ preview: { port, host: '127.0.0.1' } });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/powerPreference|readback|Failed to load resource/.test(m.text())) {
    consoleErrors.push(m.text().slice(0, 120));
  }
});

const backendSuffix = forceBackend === '' ? '' : `&backend=${forceBackend}`;
await page.goto(
  `http://127.0.0.1:${port}/atlas/galaxy-collision?preset=${encodeURIComponent(preset)}${backendSuffix}`
);
await page.waitForFunction(
  () => window.__ATLAS_APP__ && window.__ATLAS_APP__.host.state.atlas.transition.active === false,
  null,
  { timeout: 30000 }
);

// Deterministic measurement conditions: pinned tier (auto allowed explicitly),
// paused timeline scrubbed to the requested phase so every sample renders the
// same workload. Re-applies canvas sizing AFTER the pin (renderScale changes
// with the tier but nothing else re-drives resize).
await page.evaluate(
  ({ q, width, height }) => {
    const host = window.__ATLAS_APP__.host;
    if (q !== 'auto') {
      host.governor.configure({ qualityMode: q });
    }
    host.handleResize(width, height);
    host.time.pause();
    // WS1 (frame invalidation, openspec whole-atlas-performance-optimization)
    // landed AFTER this harness was written: a paused, stationary scene now
    // legitimately renders NOTHING, so sampling rAF deltas here would time an
    // empty loop and report a plausible-looking millisecond number for work
    // that never happened. Pin continuous rendering for the measurement
    // window — that escape hatch exists for exactly this — and let
    // `renderTelemetry` in the record prove it took effect.
    host.forceContinuousRenderForTest(true);
  },
  { q: quality, width: 1280 - 320, height: 800 }
);
await page.waitForTimeout(warmupMs / 2);
await page.evaluate((p) => {
  window.__ATLAS_APP__.host.time.scrubTo(p);
}, phase);
await page.waitForTimeout(warmupMs / 2);

const info = await page.evaluate(() => {
  const app = window.__ATLAS_APP__;
  const inv = app.host.debugInventory();
  const canvas = document.getElementById('scene');
  const glInfo = navigator.userAgent.match(/Edg\/([\d.]+)/);
  const snap = app.host.time.snapshot();
  return {
    activeDestination: app.host.state.atlas.activeDestination,
    activePreset: app.host.state.atlas.activePreset,
    tier: inv.governor.tier,
    renderScale: inv.governor.renderScale,
    activityMode: inv.governor.activityMode,
    internal: [canvas.width, canvas.height],
    paused: snap.paused,
    browserVersion: glInfo ? glInfo[1] : 'unknown'
  };
});

if (!info.paused) {
  console.error('timeline unexpectedly playing during measurement');
}

// Steady-state sampling inside the page: rAF deltas over `frames` frames while
// PAUSED (rendering continues; simulation time is frozen).
// Zero the frame counters so `renderTelemetry` in the record describes THIS
// measurement window and nothing before it.
await page.evaluate(() => {
  const host = window.__ATLAS_APP__.host;
  if (typeof host.resetFrameTelemetry === 'function') host.resetFrameTelemetry();
});

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

// BH-121: resolve the GPU timestamp pool after sampling (null when unsupported).
const gpuFrameMs = await page.evaluate(async () => {
  const app = window.__ATLAS_APP__;
  if (!app || typeof app.host.flushGpuTimestamps !== 'function') return null;
  try {
    return await app.host.flushGpuTimestamps();
  } catch {
    return null;
  }
});

// WS0/§1 self-check. A harness that is not actually rendering reports
// framesRendered 0 and all-false stage flags, so a broken measurement can no
// longer emit a plausible millisecond number alongside it.
const renderTelemetry = await page.evaluate(() => {
  const host = window.__ATLAS_APP__.host;
  return typeof host.frameTelemetry === 'function' ? host.frameTelemetry() : null;
});
if (renderTelemetry !== null && renderTelemetry.framesRendered === 0) {
  console.error(
    '[bench] REFUSING TO REPORT: the sampled window rendered 0 frames, so the ' +
      'timings below would describe an idle loop, not this scene. Check that ' +
      'forceContinuousRenderForTest(true) is still reaching the host.'
  );
  process.exitCode = 1;
}

const sorted = [...samples].sort((a, b) => a - b);
const pick = (q) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(2);
const round2 = (v) => +v.toFixed(2);

const adapter = await page.evaluate(
  () => window.__ATLAS_APP__.host.debugInventory().backend.adapterName
);
const backendApi = await page.evaluate(
  () => window.__ATLAS_APP__.host.debugInventory().backend.api
);

const record = {
  label,
  commit: process.env.BENCH_COMMIT ?? 'uncommitted',
  preset,
  timelinePhase: phase,
  browser: `Edge ${info.browserVersion}`,
  adapter,
  backend: backendApi,
  forcedBackend: forceBackend === '' ? null : forceBackend,
  scene: `GALAXY_COLLISION_${String(preset).toUpperCase().replace(/-/g, '_')}`,
  viewport: [1280, 800],
  internal: info.internal,
  quality: info.tier,
  requestedQuality: quality,
  renderScale: info.renderScale,
  activityMode: info.activityMode,
  medianMs: pick(0.5),
  p90Ms: pick(0.9),
  p95Ms: pick(0.95),
  p99Ms: pick(0.99),
  samples: sorted.length,
  // BH-121: real GPU timestamp reading when the backend exposes timestamp
  // queries; otherwise honestly null — never inferred from CPU rAF deltas.
  // The value is the LAST resolved frame's summed render-pass time.
  // WS0/§1: work actually executed during the sampled window. Counts, not
  // timings, so they mean the same thing on every machine — and they are what
  // makes the timings above trustworthy rather than merely plausible.
  renderTelemetry:
    renderTelemetry === null
      ? null
      : {
          framesObserved: renderTelemetry.framesObserved,
          framesRendered: renderTelemetry.framesRendered,
          framesSkipped: renderTelemetry.framesSkipped,
          lastFrameWork: renderTelemetry.lastFrameWork
        },
  frameGpuMs:
    gpuFrameMs === null || !Number.isFinite(gpuFrameMs)
      ? null
      : { lastResolvedFrame: round2(gpuFrameMs) },
  gpuTimingNote:
    gpuFrameMs === null || !Number.isFinite(gpuFrameMs)
      ? 'not available: rAF frame deltas are CPU-side measurements, not GPU timestamps'
      : 'GPU milliseconds from hardware timestamp queries (three trackTimestamp): summed render-pass time of the final resolved frame',
  consoleErrors: consoleErrors.length
};
console.log(JSON.stringify(record, null, 1));

await browser.close();
await server.close();

if (forceBackend !== '' && backendApi !== forceBackend) {
  console.error(`[bench] WARNING: requested backend ${forceBackend}, effective ${backendApi}`);
}
process.exit(0);
