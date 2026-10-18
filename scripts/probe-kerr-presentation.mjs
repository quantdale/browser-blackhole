/**
 * Presentation-amplification probe (Phase 5E).
 *
 * The failure mask is geometric: NUMERICAL_FAILURE_RGB lands on exactly the
 * failed rays. The visual complaint is a BAND, which could be that same
 * geometry enlarged by the display path (bloom bleed, temporal reprojection,
 * tone-map lift). This measures three nested populations per configuration:
 *
 *   core     - pixels matching the documented failure colour (strict)
 *   tinted   - purple-hued pixels (red+blue above green), any brightness
 *   measurable spread = tinted / core
 *
 * A spread near 1 means the indicator is honest and local. A large spread means
 * the display path is inflating it.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';
import { preview } from 'vite';

const outDir = resolve('artifacts/visual-fidelity-kerr-band/diagnostics');
mkdirSync(outDir, { recursive: true });
const port = 4305;
const BRAVE_PATH = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';

const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
})();

try {
  execSync('npm run build:e2e', { stdio: 'inherit' });
} catch (error) {
  console.error(`[presentation] build failed: ${String(error)}`);
  process.exit(1);
}

const server = await preview({ preview: { port, host: '127.0.0.1' } });
const browser = await chromium.launch({ executablePath: BRAVE_PATH, headless: true });

const CONFIGS = [
  { name: 'scientific-nobloom-linear', bloom: 0, exposure: 1, tonemap: 'linear' },
  { name: 'scientific-bloom-linear', bloom: 1, exposure: 1, tonemap: 'linear' },
  { name: 'cinematic-shipped', bloom: 1, exposure: 1.1, tonemap: 'aces-filmic' },
  { name: 'scientific-nobloom-aces', bloom: 0, exposure: 1, tonemap: 'aces-filmic' }
];

const rows = [];

for (const cfg of CONFIGS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(
    `http://127.0.0.1:${port}/atlas/black-hole?preset=kerr-high-prograde&backend=webgpu`
  );
  await page.locator('#scene').waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__ATLAS_APP__ !== undefined, { timeout: 30_000 });
  await page.waitForFunction(
    () => window.__ATLAS_APP__.host.state.atlas.transition.active === false,
    { timeout: 120_000 }
  );
  await page.waitForFunction(
    () => window.__ATLAS_APP__.host.activeDestinationDebugSnapshot() !== null,
    { timeout: 120_000 }
  );
  await page.evaluate(
    ([bloomOn, exposureValue, tonemap]) => {
      const host = window.__ATLAS_APP__.host;
      host.governor.setForcedTier('high');
      host.setRenderScaleOverride(1);
      host.time.pause();
      host.time.scrubTo(0.5);
      host.post.setBloom(bloomOn > 0.5, bloomOn > 0.5 ? 0.6 : 0);
      host.post.setExposure(exposureValue);
      host.post.setToneMapping(tonemap);
      const rect = document.getElementById('viewport')?.getBoundingClientRect();
      if (rect) host.handleResize(rect.width, rect.height);
      window.__ATLAS_APP__.captureFrame();
    },
    [cfg.bloom, cfg.exposure, cfg.tonemap]
  );
  await page.waitForTimeout(9000);

  const measured = await page.evaluate(() => {
    window.__ATLAS_APP__.host.frame(1 / 60, { force: true });
    const canvas = document.querySelector('canvas');
    const w = canvas.width;
    const h = canvas.height;
    const scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('no 2d');
    ctx.drawImage(canvas, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    let core = 0;
    let tinted = 0;
    let purpleDim = 0;
    for (let p = 0; p < w * h; p += 1) {
      const r = d[p * 4];
      const g = d[p * 4 + 1];
      const b = d[p * 4 + 2];
      // strict documented failure colour proximity (sRGB 80,0,80)
      const dr = r - 80;
      const dg = g;
      const db = b - 80;
      if (Math.sqrt(dr * dr + dg * dg + db * db) < 56) core += 1;
      // any purple tint (bloom bleed, tone-map lift, temporal smear)
      const m = Math.min(r, b);
      if (m > 10 && g < m * 0.85) {
        tinted += 1;
        if (m < 45) purpleDim += 1;
      }
    }
    return { total: w * h, core, tinted, purpleDim, internal: [w, h] };
  });

  rows.push({
    config: cfg.name,
    bloom: cfg.bloom,
    exposure: cfg.exposure,
    tonemap: cfg.tonemap,
    internal: measured.internal,
    corePercent: +((measured.core / measured.total) * 100).toFixed(4),
    tintedPercent: +((measured.tinted / measured.total) * 100).toFixed(4),
    dimPurplePercent: +((measured.purpleDim / measured.total) * 100).toFixed(4),
    spread: measured.core === 0 ? null : +(measured.tinted / measured.core).toFixed(3)
  });
  await page.close();
}

writeFileSync(
  join(outDir, 'presentation-amplification.json'),
  JSON.stringify({ commit, rows }, null, 2)
);
for (const row of rows) {
  console.log(
    `${String(row.config).padEnd(28)} core=${String(row.corePercent).padStart(7)}%  ` +
      `tinted=${String(row.tintedPercent).padStart(7)}%  spread=${row.spread}x`
  );
}

await browser.close();
server.httpServer.close();
process.exit(0);
