/**
 * M9-10 / BH-206 — Kerr numerical-backend characterization harness.
 *
 * Measures steady-state FRAME times (rAF deltas — NOT GPU timestamps; see the
 * frameGpuMs note in each record) of the black-hole destination while the
 * KERR numerical pass is active, at fully pinned conditions: metric+spin set
 * through the canonical control channel, preset, quality tier, viewport, and
 * a manual render scale for deterministic internal resolution. Prints ONE
 * JSON record per run conforming closely to docs/BENCHMARK_MATRIX.md §1.
 *
 * Usage:
 *   node scripts/bench-kerr.mjs [--preset=kerr-high-prograde]
 *        [--spin=0.9] [--quality=medium|low|high|ultra]
 *        [--width=1280] [--height=800] [--render-scale=1|0]
 *        [--frames=600] [--warmup-ms=9000] [--channel=msedge]
 *        [--label=run] [--port=4185]
 *
 * HONESTY GATE: before sampling, the destination debug snapshot must report
 * activePassKind 'kerr' and trajectoryBackendEffective 'numerical-kerr';
 * otherwise the run ABORTS rather than mislabeling Schwarzschild frames as
 * Kerr measurements.
 *
 * Machine-specific raw records are not committed by default; durable summary
 * records may live under benchmarks/ where repository policy allows.
 */

import { preview } from 'vite';
import { chromium } from '@playwright/test';
import os from 'node:os';
import execFileSync from 'node:child_process';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const QUALITIES = new Set(['auto', 'low', 'medium', 'high', 'ultra']);

const preset = String(arg('preset', 'kerr-high-prograde'));
const spin = Number(arg('spin', 'nan'));
const quality = String(arg('quality', 'medium'));
const width = Number(arg('width', '1280'));
const height = Number(arg('height', '800'));
const renderScale = Number(arg('render-scale', '0')); // 0 = governor-managed
const frames = Math.max(60, Number(arg('frames', '600')));
const warmupMs = Number(arg('warmup-ms', '9000'));
const channel = String(arg('channel', 'msedge'));
const label = String(arg('label', 'run'));
const port = Number(arg('port', '4185'));

if (!QUALITIES.has(quality)) {
  console.error(`[bench-kerr] invalid --quality=${quality}`);
  process.exit(2);
}

function currentCommit() {
  if (process.env.BENCH_COMMIT) return process.env.BENCH_COMMIT;
  try {
    const { execSync } = execFileSync;
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

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (/powerPreference|readback|Failed to load resource/.test(text)) return;
  consoleErrors.push(text.slice(0, 200));
});

await page.goto(`http://127.0.0.1:${port}/atlas/black-hole?preset=${encodeURIComponent(preset)}`);
await page.waitForFunction(
  () =>
    window.__ATLAS_APP__ &&
    window.__ATLAS_APP__.host.state.atlas.transition.active === false &&
    window.__ATLAS_APP__.host.activeDestinationDebugSnapshot() !== null,
  null,
  { timeout: 30000 }
);

// Pin measurement conditions through canonical state ONLY. An explicit spin
// argument overrides the preset through the control channel (normalizer).
await page.evaluate(
  ({ q, scale, spinOverride }) => {
    const host = window.__ATLAS_APP__.host;
    if (q !== 'auto') host.governor.configure({ qualityMode: q });
    if (scale > 0) host.setRenderScaleOverride(scale);
    if (Number.isFinite(spinOverride)) {
      host.setDestinationControl('black-hole', { metric: 'kerr', spin: spinOverride });
    }
    const rect = document.getElementById('viewport').getBoundingClientRect();
    host.handleResize(rect.width, rect.height);
    host.time.pause();
  },
  { q: quality, scale: renderScale, spinOverride: spin }
);
await page.waitForTimeout(warmupMs);

// HONESTY GATE: prove the Kerr backend actually executed before measuring.
const gate = await page.evaluate(() => {
  const snap = window.__ATLAS_APP__.host.activeDestinationDebugSnapshot() ?? {};
  return {
    pass: snap.activePassKind === 'kerr' && snap.metric === 'kerr',
    kind: snap.activePassKind ?? null,
    metric: snap.metric ?? null,
    effective: snap.trajectoryBackendEffective ?? null,
    spin: snap.spin ?? null,
    diskInner: snap.kerrDiskInnerRg ?? null
  };
});
if (!gate.pass) {
  console.error(
    `[bench-kerr] ABORT: Kerr backend not active (kind=${gate.kind} metric=${gate.metric} ` +
      `effective=${gate.effective}) — refusing to mislabel frames.`
  );
  await browser.close();
  await server.close();
  process.exit(3);
}

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
    activePreset: host.state.atlas.activePreset || '(default)',
    effectiveBackend: snap.trajectoryBackendEffective ?? null,
    metric: snap.metric ?? null,
    spin: snap.spin ?? null,
    kerrDiskInnerRg: snap.kerrDiskInnerRg ?? null,
    tier: inv.governor.tier,
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

const samples = await page.evaluate(
  (frameCount) =>
    new Promise((resolve) => {
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

const sorted = [...samples].sort((a, b) => a - b);
const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
const round2 = (v) => +v.toFixed(2);

const record = {
  schemaVersion: 1,
  kind: 'kerr-numerical-characterization',
  date: new Date().toISOString(),
  label,
  commit: currentCommit(),
  destination: 'black-hole',
  preset: info.activePreset,
  metric: info.metric,
  spin: { value: info.spin, convention: 'signed dimensionless a*; +Y axis; disk +Y-corotating' },
  kerrDiskInnerRg: info.kerrDiskInnerRg,
  trajectoryBackend: { requested: 'kerr', effective: info.effectiveBackend },
  browser: { name: browserName, version: info.browserVersion },
  os: `${os.type()} ${os.release()} (${process.platform})`,
  platform: info.platform,
  adapter: { name: info.adapterName },
  backend: info.backendApi,
  timestampQueryAvailable: info.timestampQuery,
  viewportCss: [width, height],
  devicePixelRatio: info.devicePixelRatio,
  effectiveRenderSize: info.internal,
  quality: { requested: quality, effectiveTier: info.tier },
  renderScale: info.renderScale,
  activityMode: info.activityMode,
  warmupMs,
  sampleFrames: sorted.length,
  frameCpuMs: {
    min: round2(sorted[0]),
    median: round2(pick(0.5)),
    p90: round2(pick(0.9)),
    p95: round2(pick(0.95)),
    p99: round2(pick(0.99)),
    max: round2(sorted[sorted.length - 1]),
    mean: round2(mean),
    stdev: round2(Math.sqrt(variance))
  },
  // Honest limitation: no GPU timestamp queries wired; CPU-side rAF deltas only.
  frameGpuMs: null,
  gpuTimingNote: 'not available: rAF frame deltas are CPU-side measurements, not GPU timestamps',
  memory: {
    estimatedGpuBytesTotal: info.totalEstimatedGpuBytes,
    textureCount: info.totalTextures,
    resourceScopes: info.resourceScopes
  },
  consoleErrors: consoleErrors.length,
  consoleErrorSamples: consoleErrors.slice(0, 5),
  notes:
    renderScale > 0
      ? `fixed internal resolution via render-scale=${renderScale}`
      : 'governor-managed dynamic resolution'
};
console.log(JSON.stringify(record, null, 1));

await browser.close();
await server.close();
process.exit(0);
