/**
 * CA7-14 — Quasar/AGN scale-zone characterization harness.
 *
 * Measures steady-state FRAME times (rAF CPU-side deltas — NOT GPU
 * timestamps) of /atlas/quasar-agn at pinned conditions, once per SCALE
 * ZONE. The record's `zone` comes from the destination debug snapshot and
 * the harness ABORTS if the requested zone is not the one actually active
 * (same honesty-gate pattern as scripts/bench-kerr.mjs).
 *
 * Usage:
 *   node scripts/bench-quasar-agn.mjs [--zone=inner|nuclear|galactic]
 *        [--preset=...] [--quality=low|medium|high|ultra]
 *        [--width=1280] [--height=800] [--render-scale=1|0]
 *        [--frames=400] [--warmup-ms=9000] [--channel=msedge]
 *        [--label=run] [--port=4187] [--force-backend=webgpu|webgl2]
 */

import { preview } from 'vite';
import { chromium } from '@playwright/test';
import os from 'node:os';
import { execSync } from 'node:child_process';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const QUALITIES = new Set(['auto', 'low', 'medium', 'high', 'ultra']);
const ZONES = new Set(['inner', 'nuclear', 'galactic']);
const ZONE_JUMP_ZOOM = { inner: 0.18, nuclear: 0.58, galactic: 0.88 };

const preset = String(arg('preset', 'quasar-reference'));
const zone = String(arg('zone', 'nuclear'));
const quality = String(arg('quality', 'low'));
const width = Number(arg('width', '1280'));
const height = Number(arg('height', '800'));
const renderScale = Number(arg('render-scale', '0'));
const frames = Math.max(60, Number(arg('frames', '400')));
const warmupMs = Number(arg('warmup-ms', '9000'));
const channel = String(arg('channel', 'msedge'));
const label = String(arg('label', 'run'));
const port = Number(arg('port', '4187'));
const forceBackend = String(arg('force-backend', ''));

if (!QUALITIES.has(quality)) {
  console.error(`[bench-agn] invalid --quality=${quality}`);
  process.exit(2);
}
if (!ZONES.has(zone)) {
  console.error(`[bench-agn] invalid --zone=${zone}`);
  process.exit(2);
}

const FORCE_BACKENDS = new Set(['', 'webgpu', 'webgl2']);
if (!FORCE_BACKENDS.has(forceBackend)) {
  console.error(`[bench-agn] invalid --force-backend=${forceBackend} (webgpu|webgl2)`);
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

let consoleErrors = 0;
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/powerPreference|readback|Failed to load resource/.test(m.text())) return;
  consoleErrors += 1;
});

const backendSuffix = forceBackend === '' ? '' : `&backend=${forceBackend}`;
await page.goto(
  `http://127.0.0.1:${port}/atlas/quasar-agn?preset=${encodeURIComponent(preset)}${backendSuffix}`
);
await page.waitForFunction(
  () =>
    window.__ATLAS_APP__ &&
    window.__ATLAS_APP__.host.state.atlas.transition.active === false &&
    window.__ATLAS_APP__.host.activeDestinationDebugSnapshot() !== null,
  null,
  { timeout: 30000 }
);

await page.evaluate(
  ({ q, scale, jumpZoom }) => {
    const host = window.__ATLAS_APP__.host;
    if (q !== 'auto') host.governor.configure({ qualityMode: q });
    if (scale > 0) host.setRenderScaleOverride(scale);
    host.setDestinationControl('quasar-agn', { zoom01: jumpZoom });
    const rect = document.getElementById('viewport').getBoundingClientRect();
    host.handleResize(rect.width, rect.height);
    host.time.pause();
  },
  { q: quality, scale: renderScale, jumpZoom: ZONE_JUMP_ZOOM[zone] ?? 0.58 }
);
await page.waitForTimeout(warmupMs);

// HONESTY GATE: the requested zone must be the ACTIVE zone before sampling.
const gate = await page.evaluate((targetZone) => {
  const snap = window.__ATLAS_APP__.host.activeDestinationDebugSnapshot() ?? {};
  return {
    pass: snap.zone === targetZone && snap.doubleRenderGuard === 'ok',
    activeZone: snap.zone ?? null,
    guard: snap.doubleRenderGuard ?? null,
    grPassActive: snap.grPassActive ?? null
  };
}, zone);
if (!gate.pass) {
  console.error(
    `[bench-agn] ABORT: requested zone '${zone}' not active (active=${gate.activeZone} ` +
      `guard=${gate.guard}) — refusing to mislabel frames.`
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
  return {
    activePreset: host.state.atlas.activePreset || '(default)',
    zone: snap.zone ?? null,
    grPassActive: snap.grPassActive ?? null,
    tier: inv.governor.tier,
    renderScale: host.renderScaleOverride ?? inv.governor.renderScale,
    internal: [canvas.width, canvas.height],
    devicePixelRatio: window.devicePixelRatio,
    adapterName: inv.backend ? inv.backend.adapterName : null,
    backendApi: inv.backend ? inv.backend.api : null,
    timestampQuery: inv.backend ? inv.backend.timestampQuery : false,
    totalEstimatedGpuBytes: inv.totalEstimatedGpuBytes,
    totalTextures: inv.totalResourceCounts.texture,
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

const sorted = [...samples].sort((a, b) => a - b);
const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
const round2 = (v) => +v.toFixed(2);

const record = {
  schemaVersion: 1,
  kind: 'quasar-agn-zone-characterization',
  date: new Date().toISOString(),
  label,
  commit: currentCommit(),
  destination: 'quasar-agn',
  preset: info.activePreset,
  zone: { requested: zone, active: info.zone },
  grPassActive: info.grPassActive,
  browser: { name: browserName, version: info.browserVersion },
  os: `${os.type()} ${os.release()} (${process.platform})`,
  platform: info.platform,
  adapter: { name: info.adapterName },
  backend: info.backendApi,
  forcedBackend: forceBackend === '' ? null : forceBackend,
  timestampQueryAvailable: info.timestampQuery,
  viewportCss: [width, height],
  devicePixelRatio: info.devicePixelRatio,
  effectiveRenderSize: info.internal,
  quality: { requested: quality, effectiveTier: info.tier },
  renderScale: info.renderScale,
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
    textureCount: info.totalTextures
  },
  consoleErrors,
  notes:
    renderScale > 0
      ? `fixed internal resolution via render-scale=${renderScale}`
      : 'governor-managed dynamic resolution'
};
console.log(JSON.stringify(record, null, 1));

await browser.close();
await server.close();

if (forceBackend !== '' && info.backendApi !== forceBackend) {
  console.error(
    `[bench-agn] WARNING: requested backend ${forceBackend}, effective ${info.backendApi}`
  );
}
process.exit(0);
