/**
 * Temporary campaign probe v3: measures TRUE serialized GPU frame cost on the
 * Kerr scene — submit one orchestrated frame, await full queue drain, repeat —
 * plus reads both timestamp pools and per-pass breakdowns.
 */
import { preview } from 'vite';
import { chromium } from '@playwright/test';

const server = await preview({ preview: { port: 4189, host: '127.0.0.1' } });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.goto('http://127.0.0.1:4189/atlas/black-hole?preset=kerr-high-prograde');
await page.waitForFunction(
  () => window.__ATLAS_APP__ && window.__ATLAS_APP__.host.state.atlas.transition.active === false,
  null,
  { timeout: 30000 }
);
await page.evaluate(() => {
  const app = window.__ATLAS_APP__;
  app.host.governor.configure({ qualityMode: 'medium' });
  app.host.setRenderScaleOverride(1);
  const rect = document.getElementById('viewport').getBoundingClientRect();
  app.host.handleResize(rect.width, rect.height);
  app.host.time.pause();
});
await page.waitForTimeout(9000);

const out = await page.evaluate(async () => {
  const app = window.__ATLAS_APP__;
  const host = app.host;
  const renderer = host.kernel.renderer;
  const device = renderer.backend ? renderer.backend.device : null;

  // A) Serialized submit->drain cycles (true end-to-end GPU frame cost).
  const cycles = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    host.frame(0);
    await device.queue.onSubmittedWorkDone();
    cycles.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 4));
  }

  // B) Passive rAF deltas afterwards.
  const deltas = [];
  let last = performance.now();
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    deltas.push(now - last);
    last = now;
  }

  // C) Timestamp pools + info surfaces.
  const info = renderer.info;
  const gpuRenderMean = await host.flushGpuTimestamps();

  function stats(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { n: xs.length, min: +s[0].toFixed(1), median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), mean: +mean.toFixed(1) };
  }
  return {
    serializedSubmitDrain: stats(cycles),
    passiveDeltas: stats(deltas),
    gpuRenderMeanMs: gpuRenderMean,
    infoRender: JSON.parse(JSON.stringify(info.render ?? null)),
    infoCompute: JSON.parse(JSON.stringify(info.compute ?? null))
  };
});
console.log(JSON.stringify(out, null, 1));

await browser.close();
await server.close();
process.exit(0);
