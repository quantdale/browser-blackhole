/**
 * Temporary campaign probe (not a committed tool): distinguishes CPU-side
 * orchestrated-frame cost from browser present/compositor pacing on the Kerr
 * scene. Measures synchronous wall time of manually driven host.frame() calls
 * versus passive rAF deltas at pinned conditions.
 */
import { preview } from 'vite';
import { chromium } from '@playwright/test';

const server = await preview({ preview: { port: 4187, host: '127.0.0.1' } });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.error('[console]', m.text().slice(0, 160));
});

await page.goto('http://127.0.0.1:4187/atlas/black-hole?preset=kerr-high-prograde');
await page.waitForFunction(
  () =>
    window.__ATLAS_APP__ &&
    window.__ATLAS_APP__.host.state.atlas.transition.active === false,
  null,
  { timeout: 30000 }
);
await page.evaluate(() => {
  const host = window.__ATLAS_APP__.host;
  host.governor.configure({ qualityMode: 'medium' });
  host.setRenderScaleOverride(1);
  const rect = document.getElementById('viewport').getBoundingClientRect();
  host.handleResize(rect.width, rect.height);
  host.time.pause();
});
await page.waitForTimeout(9000);

// Phase A: passive rAF deltas (the benchmark methodology).
const rafDeltas = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const deltas = [];
      let last = performance.now();
      function tick(now) {
        deltas.push(now - last);
        last = now;
        if (deltas.length >= 240) return resolve(deltas);
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })
);

// Phase B: synchronous manual frames — wall time of update+encode+submit.
const manualMs = await page.evaluate(async () => {
  const host = window.__ATLAS_APP__.host;
  const out = [];
  // Let the passive loop drain first: stop driving by hiding nothing — the
  // app keeps its own rAF loop running; manual frames add load. Measure anyway.
  await new Promise((r) => setTimeout(r, 500));
  for (let i = 0; i < 120; i++) {
    const t0 = performance.now();
    host.frame(0);
    const t1 = performance.now();
    out.push(t1 - t0);
    // Yield to the browser between manual frames.
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
});

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { min: +s[0].toFixed(2), median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), mean: +mean.toFixed(2) };
}
console.log('passive rAF deltas:', JSON.stringify(stats(rafDeltas)));
console.log('manual host.frame():', JSON.stringify(stats(manualMs)));

await browser.close();
await server.close();
process.exit(0);
