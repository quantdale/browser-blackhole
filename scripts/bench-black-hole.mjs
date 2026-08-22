/**
 * Repeatable black-hole performance harness (performance campaign §28).
 *
 * Measures steady-state frame times of /atlas/black-hole on whatever backend
 * the browser provides (records the ACTUAL adapter/backend from the host),
 * after pipeline warm-up, at fixed viewport and quality settings.
 *
 * Usage:
 *   node scripts/bench-black-hole.mjs [--frames=600] [--warmupMs=9000]
 *        [--port=4183] [--quality=low|medium|high] [--label=before]
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
const port = Number(arg('port', '4183'));
const label = String(arg('label', 'run'));

const server = await preview({ preview: { port, host: '127.0.0.1' } });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/powerPreference|readback|Failed to load resource/.test(m.text())) {
    consoleErrors.push(m.text().slice(0, 120));
  }
});

await page.goto(`http://127.0.0.1:${port}/atlas/black-hole`);
await page.waitForFunction(
  () => window.__ATLAS_APP__ && window.__ATLAS_APP__.host.state.atlas.transition.active === false,
  null,
  { timeout: 30000 }
);
// Pipeline warm-up: shader compiles, governor settles, texture uploads.
await page.waitForTimeout(warmupMs);

const info = await page.evaluate(() => {
  const app = window.__ATLAS_APP__;
  const inv = app.host.debugInventory();
  const canvas = document.getElementById('scene');
  const glInfo = navigator.userAgent.match(/Edg\/([\d.]+)/);
  return {
    activeDestination: app.host.state.atlas.activeDestination,
    tier: inv.governor.tier,
    renderScale: inv.governor.renderScale,
    activityMode: inv.governor.activityMode,
    internal: [canvas.width, canvas.height],
    browserVersion: glInfo ? glInfo[1] : 'unknown'
  };
});
void info.browserVersion;

// Steady-state sampling inside the page: rAF deltas over `frames` frames.
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
const pick = (q) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(2);

const adapter = await page.evaluate(
  () => window.__ATLAS_APP__.host.debugInventory().backend.adapterName
);
const backendApi = await page.evaluate(
  () => window.__ATLAS_APP__.host.debugInventory().backend.api
);

const record = {
  label,
  commit: process.env.BENCH_COMMIT ?? 'uncommitted',
  browser: `Edge ${info.browserVersion}`,
  adapter,
  backend: backendApi,
  scene: 'BENCH_BLACK_HOLE_TYPICAL',
  viewport: [1280, 800],
  internal: info.internal,
  quality: info.tier,
  renderScale: info.renderScale,
  activityMode: info.activityMode,
  diskEnabled: true,
  medianMs: pick(0.5),
  p90Ms: pick(0.9),
  p95Ms: pick(0.95),
  p99Ms: pick(0.99),
  samples: sorted.length,
  consoleErrors: consoleErrors.length
};
console.log(JSON.stringify(record, null, 1));

await browser.close();
await server.close();
process.exit(0);
