/**
 * CA8-18 — Black-Hole Merger characterization harness.
 *
 * Measures steady-state FRAME times (rAF CPU-side deltas — NOT GPU
 * timestamps) of /atlas/black-hole-merger at pinned conditions, once per
 * requested PHASE window. The record's `phase` comes from the destination
 * debug snapshot and the harness ABORTS if the requested phase is not the
 * one actually active before sampling (honesty-gate pattern of
 * scripts/bench-quasar-agn.mjs).
 *
 * Phases:
 *   inspiral   - two markers + trails + accents over reduced NR paths
 *   merger     - flash envelope active around the h22 peak
 *   remnant    - exclusive Kerr numerical pass with source-derived spin/mass
 *   waveform   - inspiral WITH the waveform panel forced visible (UI cost)
 *
 * Usage:
 *   node scripts/bench-black-hole-merger.mjs [--phase=inspiral|merger|remnant]
 *        [--preset=...] [--quality=low|medium|high|ultra]
 *        [--width=1280] [--height=800] [--render-scale=0]
 *        [--frames=400] [--warmup-ms=9000] [--channel=msedge]
 *        [--label=run] [--port=4192] [--force-backend=webgpu|webgl2]
 */

import { preview } from 'vite';
import { chromium } from '@playwright/test';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const QUALITIES = new Set(['auto', 'low', 'medium', 'high', 'ultra']);
const PHASES = new Set(['inspiral', 'near-merger', 'merger', 'ringdown', 'remnant', 'waveform']);

const preset = String(arg('preset', 'sxs-bbh-0001-inspiral'));
const phase = String(arg('phase', 'inspiral'));
const quality = String(arg('quality', 'low'));
const width = Number(arg('width', '1280'));
const height = Number(arg('height', '800'));
const renderScale = Number(arg('render-scale', '0'));
const frames = Math.max(60, Number(arg('frames', '400')));
const warmupMs = Number(arg('warmup-ms', '9000'));
const channel = String(arg('channel', 'msedge'));
const label = String(arg('label', 'run'));
const port = Number(arg('port', '4192'));
const forceBackend = String(arg('force-backend', ''));

if (!QUALITIES.has(quality)) {
  console.error(`[bench-bbm] invalid --quality=${quality}`);
  process.exit(2);
}
if (!PHASES.has(phase)) {
  console.error(`[bench-bbm] invalid --phase=${phase}`);
  process.exit(2);
}

const FORCE_BACKENDS = new Set(['', 'webgpu', 'webgl2']);
if (!FORCE_BACKENDS.has(forceBackend)) {
  console.error(`[bench-bbm] invalid --force-backend=${forceBackend} (webgpu|webgl2)`);
  process.exit(2);
}

// Scrub positions chosen INSIDE each data-derived phase segment.
const PHASE_SCRUB = {
  inspiral: 0.08,
  'near-merger': 0.56,
  merger: 0.615,
  ringdown: 0.68,
  remnant: 0.9,
  waveform: 0.08
};
const PHASE_EXPECT = {
  inspiral: 'inspiral',
  'near-merger': 'inspiral',
  merger: 'merger',
  ringdown: 'ringdown',
  remnant: 'remnant',
  waveform: 'inspiral'
};

function currentCommit() {
  if (process.env.BENCH_COMMIT) return process.env.BENCH_COMMIT;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
}

// Dataset version from the committed manifest (recorded in every row).
const manifest = JSON.parse(
  readFileSync(new URL('../public/data/black-hole-merger/manifest.json', import.meta.url), 'utf8')
);

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
  `http://127.0.0.1:${port}/atlas/black-hole-merger?preset=${encodeURIComponent(preset)}${backendSuffix}`
);
await page.waitForFunction(
  () =>
    window.__ATLAS_APP__ &&
    window.__ATLAS_APP__.host.state.atlas.transition.active === false &&
    window.__ATLAS_APP__.host.activeDestinationDebugSnapshot() !== null,
  null,
  { timeout: 30000 }
);
await page.waitForTimeout(1500); // let the waveform panel bind

await page.evaluate(
  ({ q, scale, scrub, wave }) => {
    const host = window.__ATLAS_APP__.host;
    if (q !== 'auto') host.governor.configure({ qualityMode: q });
    if (scale > 0) host.setRenderScaleOverride(scale);
    host.time.pause();
    host.time.scrubTo(scrub);
    const rect = document.getElementById('viewport').getBoundingClientRect();
    host.handleResize(rect.width, rect.height);
    if (wave) {
      // Force the Waveform section open so its canvas participates in layout
      // and redraw cost (the panel itself is open by default; this guards it).
      const section = [...document.querySelectorAll('.atlas-section-toggle')].find((b) =>
        b.textContent?.includes('Waveform')
      );
      if (section && section.getAttribute('aria-expanded') !== 'true') section.click();
    }
  },
  { q: quality, scale: renderScale, scrub: PHASE_SCRUB[phase], wave: phase === 'waveform' }
);
await page.waitForTimeout(warmupMs);

// HONESTY GATE: the requested phase must be the ACTIVE phase before sampling.
const gate = await page.evaluate((expectedPhase) => {
  const snap = window.__ATLAS_APP__.host.activeDestinationDebugSnapshot() ?? {};
  return {
    pass: snap.phase === expectedPhase && snap.doubleRenderGuard === 'ok',
    activePhase: snap.phase ?? null,
    guard: snap.doubleRenderGuard ?? null,
    visibleSystems: snap.visibleSystems ?? null
  };
}, PHASE_EXPECT[phase]);
if (!gate.pass) {
  console.error(
    `[bench-bbm] ABORT: requested phase '${PHASE_EXPECT[phase]}' not active (active=${gate.activePhase} ` +
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
    phase: snap.phase ?? null,
    datasetId: snap.datasetId ?? null,
    kerrSpinDimensionless: snap.kerrSpinDimensionless ?? null,
    visibleSystems: snap.visibleSystems ?? null,
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
  kind: 'black-hole-merger-phase-characterization',
  date: new Date().toISOString(),
  label,
  commit: currentCommit(),
  destination: 'black-hole-merger',
  preset: info.activePreset,
  dataset: {
    id: manifest.id,
    sha256: manifest.runtime.checksumSha256,
    bytes: manifest.runtime.bytes,
    sourceSimulation: manifest.source.datasetId
  },
  phase: { requested: phase, active: info.phase },
  visibleSystems: info.visibleSystems,
  kerrSpinDimensionless: info.kerrSpinDimensionless,
  waveformPanelActive: phase === 'waveform',
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

// Persist under benchmarks/results/<campaign>/ alongside prior campaigns.
const outDir = new URL(
  `../benchmarks/results/${arg('outdir', '2026-08-25-ca8')}/`,
  import.meta.url
);
mkdirSync(outDir, { recursive: true });
const outFile = new URL(`${phase}-${quality}-${label}.json`.replace(/\+/g, 'p'), outDir);
writeFileSync(outFile, JSON.stringify(record, null, 1) + '\n');
console.log(`[bench-bbm] record written: ${outFile.pathname}`);

await browser.close();
await server.close();

if (forceBackend !== '' && info.backendApi !== forceBackend) {
  console.error(
    `[bench-bbm] WARNING: requested backend ${forceBackend}, effective ${info.backendApi}`
  );
}
process.exit(0);
