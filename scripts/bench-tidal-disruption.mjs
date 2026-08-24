/**
 * Tidal Disruption phase-aware performance harness (CA6-14).
 *
 * Measures steady-state FRAME times (rAF deltas — CPU-side, NOT GPU
 * timestamps) of /atlas/tidal-disruption at a representative timeline
 * position, after pipeline warm-up, at fixed viewport/quality — the same
 * methodology as the other destination harnesses. The workload differs
 * dramatically per phase (star-only vs streams vs volume vs disk), so runs
 * are taken PER PHASE and compared per phase:
 *
 *   node scripts/bench-tidal-disruption.mjs --phase=0.16  (deformation)
 *   node scripts/bench-tidal-disruption.mjs --phase=0.36  (debris)
 *   node scripts/bench-tidal-disruption.mjs --phase=0.62  (winding)
 *   node scripts/bench-tidal-disruption.mjs --phase=0.78  (shock/volume)
 *   node scripts/bench-tidal-disruption.mjs --phase=0.97  (nascent disk)
 *
 * The record includes the phase's resource state (stream/volume/disk
 * visibility, particle population, angular gate) so phase-aware activation
 * can be verified empirically: approach/deformation must NOT pay for
 * debris systems; only the shock phase pays for the volume march.
 */

import { preview } from 'vite';
import { chromium } from '@playwright/test';
import os from 'node:os';
import { execSync } from 'node:child_process';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const preset = String(arg('preset', 'solar-canonical'));
const phase = Math.min(Math.max(Number(arg('phase', '0.78')), 0), 1);
const quality = String(arg('quality', 'medium'));
const width = Number(arg('width', '1280'));
const height = Number(arg('height', '800'));
const frames = Math.max(60, Number(arg('frames', '480')));
const warmupMs = Number(arg('warmup-ms', '9000'));
const channel = String(arg('channel', 'msedge'));
const label = String(arg('label', 'tde-run'));
const port = Number(arg('port', '4187'));

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

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/powerPreference|readback|Failed to load resource/.test(m.text())) {
    consoleErrors.push(m.text().slice(0, 200));
  }
});

await page.goto(
  `http://127.0.0.1:${port}/atlas/tidal-disruption?preset=${encodeURIComponent(preset)}`
);
await page.waitForFunction(
  () => window.__ATLAS_APP__ && window.__ATLAS_APP__.host.state.atlas.transition.active === false,
  null,
  { timeout: 30000 }
);

// Pin measurement conditions: tier, paused timeline at the requested phase,
// real viewport-rect sizing (deterministic internal resolution).
await page.evaluate(
  ({ q, p }) => {
    const host = window.__ATLAS_APP__.host;
    if (q !== 'auto') host.governor.configure({ qualityMode: q });
    const rect = document.getElementById('viewport').getBoundingClientRect();
    host.handleResize(rect.width, rect.height);
    host.time.pause();
    host.time.scrubTo(p);
  },
  { q: quality, p: phase }
);
await page.waitForTimeout(warmupMs);

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
    timeSeconds: snap.timeSeconds ?? null,
    tier: inv.governor.tier,
    renderScale: host.renderScaleOverride ?? inv.governor.renderScale,
    internal: [canvas.width, canvas.height],
    devicePixelRatio: window.devicePixelRatio,
    adapterName: inv.backend ? inv.backend.adapterName : null,
    backendApi: inv.backend ? inv.backend.api : null,
    totalEstimatedGpuBytes: inv.totalEstimatedGpuBytes,
    streamBoundVisible: snap.streamBoundVisible ?? null,
    volumeVisible: snap.volumeVisible ?? null,
    volumeRadius: snap.volumeRadiusUnits ?? null,
    diskVisible: snap.diskVisible ?? null,
    populationScale: snap.populationScale ?? null,
    accentAngularGate: snap.accentAngularGate ?? null,
    spineBoundPoints: snap.spineBoundPoints ?? null,
    starDistance: snap.starDistanceUnits ?? null,
    beta: snap.beta ?? null,
    browserVersion: uaEdge ? uaEdge[1] : uaChrome ? uaChrome[1] : 'unknown',
    platform: navigator.platform
  };
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

const sorted = [...samples].sort((a, b) => a - b);
const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
const round2 = (v) => +v.toFixed(2);

const record = {
  schemaVersion: 1,
  kind: 'tidal-disruption-phase-benchmark',
  date: new Date().toISOString(),
  label,
  commit: currentCommit(),
  destination: 'tidal-disruption',
  preset: info.activePreset,
  timelinePhase: phase,
  resolvedPhase: info.phase,
  resolvedTimeSeconds: info.timeSeconds,
  browser: { name: browserName, version: info.browserVersion },
  os: `${os.type()} ${os.release()} (${process.platform})`,
  platform: info.platform,
  adapter: { name: info.adapterName },
  backend: info.backendApi,
  viewportCss: [width, height],
  devicePixelRatio: info.devicePixelRatio,
  effectiveRenderSize: info.internal,
  quality: { requested: quality, effectiveTier: info.tier },
  renderScale: info.renderScale,
  warmupMs,
  sampleFrames: sorted.length,
  // rAF wall deltas around the whole orchestrated frame — CPU-side numbers.
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
  frameGpuMs: null,
  gpuTimingNote: 'not available: rAF frame deltas are CPU-side measurements, not GPU timestamps',
  phaseResources: {
    streamBoundVisible: info.streamBoundVisible,
    spineBoundPoints: info.spineBoundPoints,
    volumeVisible: info.volumeVisible,
    volumeRadiusUnits: info.volumeRadius,
    diskVisible: info.diskVisible,
    particlePopulationScale: info.populationScale,
    accentAngularGate: info.accentAngularGate,
    starDistanceUnits: info.starDistance,
    beta: info.beta
  },
  memory: { estimatedGpuBytesTotal: info.totalEstimatedGpuBytes },
  consoleErrors: consoleErrors.length,
  consoleErrorSamples: consoleErrors.slice(0, 5)
};
console.log(JSON.stringify(record, null, 1));

await browser.close();
await server.close();
process.exit(0);
