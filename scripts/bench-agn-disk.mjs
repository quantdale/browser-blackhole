/**
 * Matched GPU/CPU timing for the AGN nuclear outer-disk photosphere POC.
 *
 * Measures REAL GPU timestamp samples (host.flushGpuTimestamps() after a
 * forced frame) and CPU frame cost SEPARATELY (host.frame() wall time). CPU
 * values are never labelled GPU time. Zero-render GPU samples are counted and
 * rejected, not averaged in. Dynamic resolution is pinned by the forced tier
 * and the render scale is recorded before/after to prove it did not move.
 *
 * Usage:
 *   node scripts/bench-agn-disk.mjs --backend=webgpu|webgl2 [--mode=cinematic|scientific]
 *        [--frames=60] [--warmup=20] [--runs=2] [--port=4291] [--channel=msedge]
 *
 * Output: one JSON line per run plus a pooled summary (median, p95, mean,
 * min, max, sample counts, variance).
 */
import { execSync } from 'node:child_process';

import { chromium } from '@playwright/test';
import { preview } from 'vite';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const backend = String(arg('backend', 'webgpu'));
const mode = String(arg('mode', 'cinematic'));
const frames = Number(arg('frames', 60));
const warmup = Number(arg('warmup', 20));
const runs = Number(arg('runs', 2));
const port = Number(arg('port', 4291));
const channel = String(arg('channel', 'msedge'));
// Windows hybrid graphics can hand the iGPU to a browser process; matched
// before/after runs must land on the reference adapter or be retried.
const expectAdapter = String(arg('expect-adapter', 'nvidia'));
const adapterAttempts = 4;
const BRAVE_PATH = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
let launchOptions;
if (channel === 'brave') {
  launchOptions = { executablePath: BRAVE_PATH, headless: true };
} else if (channel === 'chromium') {
  launchOptions = {};
} else {
  launchOptions = { channel };
}

const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
})();

console.log('[bench-agn-disk] building e2e bundle...');
try {
  execSync('npm run build:e2e', { stdio: 'inherit' });
} catch (error) {
  console.error(`[bench-agn-disk] build:e2e failed: ${String(error)}`);
  process.exit(1);
}

const server = await preview({ preview: { port, host: '127.0.0.1' } });
const browser = await chromium.launch(launchOptions);

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const variance =
    sorted.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / Math.max(1, sorted.length - 1);
  return {
    count: sorted.length,
    median: +pick(0.5).toFixed(2),
    p95: +pick(0.95).toFixed(2),
    mean: +mean.toFixed(2),
    min: +sorted[0].toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
    variance: +variance.toFixed(3)
  };
}

const pooled = { gpu: [], cpu: [], rejectedZeroGpu: 0 };
const runRows = [];

for (let run = 0; run < runs; run += 1) {
  let attempt = 0;
  for (;;) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('console', (m) => {
      if (
        m.type() === 'error' &&
        !/powerPreference|readback|Failed to load resource/.test(m.text())
      )
        errors.push(m.text());
    });
    await page.goto(
      `http://127.0.0.1:${port}/atlas/quasar-agn?preset=quasar-reference&backend=${backend}`
    );
    await page.locator('#scene').waitFor({ state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => window.__ATLAS_APP__ !== undefined, { timeout: 30_000 });
    for (let i = 0; i < 360; i += 1) {
      const active = await page.evaluate(
        () => window.__ATLAS_APP__.host.state.atlas.transition.active === true
      );
      if (!active) break;
      await page.waitForTimeout(250);
    }
    const adapterName = await page.evaluate(() => {
      const inv = window.__ATLAS_APP__.host.debugInventory();
      const named = inv?.backend?.adapterName ?? '';
      if (named !== '') return named;
      // The WebGL2 path leaves backend.adapterName empty; fall back to the
      // ANGLE renderer string so adapter matching still holds it to the GPU.
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    const adapterMatch =
      adapterName !== null && adapterName.toLowerCase().includes(expectAdapter.toLowerCase());
    if (!adapterMatch) {
      attempt += 1;
      console.error(
        `[bench-agn-disk] adapter mismatch (${adapterName}), attempt ${attempt}/${adapterAttempts}`
      );
      await page.close();
      if (attempt >= adapterAttempts) {
        console.error(`[bench-agn-disk] FATAL: no ${expectAdapter} adapter after retries`);
        process.exit(1);
      }
      continue;
    }
    await page.locator(`input[value="${mode}"]`).check();
    const setup = await page.evaluate((p) => {
      const app = window.__ATLAS_APP__;
      app.host.governor.setForcedTier('high');
      app.host.time.pause();
      app.host.time.scrubTo(p);
      const rect = document.getElementById('viewport')?.getBoundingClientRect();
      if (rect) app.host.handleResize(rect.width, rect.height);
      for (let i = 0; i < 4; i += 1) app.captureFrame();
      const inv = app.host.debugInventory();
      return {
        renderScale: inv?.governor?.renderScale ?? null,
        tier: inv?.governor?.tier ?? null,
        backend: inv?.backend ?? null,
        canvas: [
          document.querySelector('canvas')?.width ?? 0,
          document.querySelector('canvas')?.height ?? 0
        ]
      };
    }, 0.35);

    for (let i = 0; i < warmup; i += 1) {
      await page.evaluate(() => window.__ATLAS_APP__.host.frame(1 / 60, { force: true }));
      await page.evaluate(() => window.__ATLAS_APP__.host.flushGpuTimestamps());
    }

    const samples = await page.evaluate(async (n) => {
      const app = window.__ATLAS_APP__;
      const gpu = [];
      const cpu = [];
      let rejected = 0;
      for (let i = 0; i < n; i += 1) {
        const t0 = performance.now();
        app.host.frame(1 / 60, { force: true });
        cpu.push(performance.now() - t0);
        const g = await app.host.flushGpuTimestamps();
        if (typeof g === 'number' && Number.isFinite(g) && g > 0) gpu.push(g);
        else rejected += 1;
      }
      return { gpu, cpu, rejected };
    }, frames);

    const end = await page.evaluate(() => {
      const inv = window.__ATLAS_APP__.host.debugInventory();
      return { renderScale: inv?.governor?.renderScale ?? null };
    });

    pooled.gpu.push(...samples.gpu);
    pooled.cpu.push(...samples.cpu);
    pooled.rejectedZeroGpu += samples.rejected;
    runRows.push({
      run,
      attempt,
      backend,
      mode,
      commit,
      canvas: setup.canvas,
      tier: setup.tier,
      adapter: setup.backend?.adapterName ?? null,
      renderScaleStart: setup.renderScale,
      renderScaleEnd: end.renderScale,
      gpu: stats(samples.gpu),
      cpu: stats(samples.cpu),
      rejectedZeroGpu: samples.rejected,
      consoleErrors: errors
    });
    await page.close();
    break;
  }
}

console.log(`[bench-agn-disk] RUNS ${JSON.stringify(runRows)}`);
console.log(
  `[bench-agn-disk] POOLED ${JSON.stringify({ backend, mode, commit, gpu: stats(pooled.gpu), cpu: stats(pooled.cpu), rejectedZeroGpu: pooled.rejectedZeroGpu })}`
);

await browser.close();
server.httpServer.close();
process.exit(0);
