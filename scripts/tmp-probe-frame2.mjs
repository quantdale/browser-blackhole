/**
 * Temporary campaign probe v2: decomposes one orchestrated Kerr frame into
 * encode/submit (renderer.render), post present, passive rAF delta, GPU
 * timestamp mean, and queue-drain latency (device.queue.onSubmittedWorkDone).
 */
import { preview } from 'vite';
import { chromium } from '@playwright/test';

const server = await preview({ preview: { port: 4188, host: '127.0.0.1' } });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.goto('http://127.0.0.1:4188/atlas/black-hole?preset=kerr-high-prograde');
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

  // Instrument the shared renderer's render + present paths.
  const kernel = app.host.kernel;
  const renderer = kernel.renderer;
  window.__probe = { renderMs: [], presentMs: [], queueDrainMs: [], deltas: [] };
  const origRender = renderer.render.bind(renderer);
  renderer.render = (...args) => {
    const t0 = performance.now();
    const out = origRender(...args);
    window.__probe.renderMs.push(performance.now() - t0);
    return out;
  };
  const post = kernel['options'] ? kernel['options'].post : null;
  if (post) {
    const origPresent = post.present.bind(post);
    post.present = (...args) => {
      const t0 = performance.now();
      const out = origPresent(...args);
      window.__probe.presentMs.push(performance.now() - t0);
      return out;
    };
  }
});
await page.waitForTimeout(9000);

const result = await page.evaluate(async () => {
  const app = window.__ATLAS_APP__;
  const probe = window.__probe;

  // Sample 180 passive frames while timing queue drains between them.
  let last = performance.now();
  const device = app.host.kernel.renderer.backend
    ? app.host.kernel.renderer.backend.device
    : null;
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    probe.deltas.push(now - last);
    last = now;
    if (device && device.queue && i % 6 === 0) {
      const t0 = performance.now();
      await device.queue.onSubmittedWorkDone();
      probe.queueDrainMs.push(performance.now() - t0);
    }
  }
  const gpuMean = await app.host.flushGpuTimestamps();
  return { gpuMean, counts: { render: probe.renderMs.length, present: probe.presentMs.length } };
});

const stats = await page.evaluate(() => {
  function stats(xs) {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
      n: xs.length,
      min: +s[0].toFixed(2),
      median: +q(0.5).toFixed(2),
      p95: +q(0.95).toFixed(2),
      mean: +mean.toFixed(2)
    };
  }
  const p = window.__probe;
  return {
    deltas: stats(p.deltas),
    renderMs: stats(p.renderMs),
    presentMs: stats(p.presentMs),
    queueDrainMs: stats(p.queueDrainMs)
  };
});
console.log(JSON.stringify({ ...stats, gpuMean: result.gpuMean, counts: result.counts }, null, 1));

await browser.close();
await server.close();
process.exit(0);
