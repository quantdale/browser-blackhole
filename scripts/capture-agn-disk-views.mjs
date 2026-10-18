/**
 * Matched before/after capture for the AGN nuclear outer-disk photosphere POC.
 *
 * Captures the six review views at pinned conditions (same viewport, tier,
 * timeline phase, exposure and post settings) so runs at two commits can be
 * compared image-by-image. This is a REVIEW capture, not the scientific
 * golden harness: nothing here writes to tests/browser/goldens.
 *
 * Usage:
 *   node scripts/capture-agn-disk-views.mjs --out=artifacts/visual-fidelity-agn-disk/after \
 *        [--backend=webgpu|webgl2] [--phase=0.35] [--port=4290] [--channel=msedge]
 *
 * Run it once per tree (e.g. a clean worktree at the baseline commit and the
 * working tree) with different --out directories. Output: one PNG per view
 * plus manifest.json (commit, backend/adapter, viewport, tier, phase).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';
import { preview } from 'vite';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const outDir = resolve(String(arg('out', '')));
if (arg('out', '') === '') {
  console.error('[capture-agn-disk] --out=<dir> is required');
  process.exit(2);
}
const backend = String(arg('backend', 'webgpu'));
const phase = Number(arg('phase', 0.35));
const port = Number(arg('port', 4290));
const channel = String(arg('channel', 'msedge'));

mkdirSync(outDir, { recursive: true });

const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
})();

console.log('[capture-agn-disk] building e2e bundle...');
try {
  execSync('npm run build:e2e', { stdio: 'inherit' });
} catch (error) {
  console.error(`[capture-agn-disk] build:e2e failed: ${String(error)}`);
  process.exit(1);
}

const server = await preview({ preview: { port, host: '127.0.0.1' } });
const browser = await chromium.launch(channel === 'chromium' ? {} : { channel });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGE_ERROR: ${e.message}`));

async function waitForArrival() {
  await page.locator('#scene').waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__ATLAS_APP__ !== undefined, { timeout: 30_000 });
  for (let i = 0; i < 360; i += 1) {
    const active = await page.evaluate(
      () => window.__ATLAS_APP__.host.state.atlas.transition.active === true
    );
    if (!active) return;
    await page.waitForTimeout(250);
  }
  throw new Error('arrival timeout');
}

/** name, experience mode, [azimuthDeg, polarDeg, distance] or null for authored camera */
const VIEWS = [
  { name: '01-nuclear-default-cinematic', mode: 'cinematic', orbit: null },
  { name: '02-nuclear-inclined-cinematic', mode: 'cinematic', orbit: [35, 60, 196] },
  { name: '03-nuclear-edge-on-cinematic', mode: 'cinematic', orbit: [35, 87, 196] },
  { name: '03b-nuclear-edge-on-closeup-cinematic', mode: 'cinematic', orbit: [35, 88, 25] },
  { name: '04-nuclear-closeup-cinematic', mode: 'cinematic', orbit: [35, 75, 25] },
  { name: '05-nuclear-default-scientific', mode: 'scientific', orbit: null },
  { name: '06-nuclear-inclined-scientific', mode: 'scientific', orbit: [35, 60, 196] }
];

const manifest = {
  commit,
  backend: null,
  viewportCss: [1280, 800],
  quality: 'high (forced)',
  phase,
  exposure: 'destination default (scientific 1.0 / cinematic 1.1)',
  views: []
};

for (const view of VIEWS) {
  await page.goto(
    `http://127.0.0.1:${port}/atlas/quasar-agn?preset=quasar-reference&backend=${backend}`
  );
  await waitForArrival();
  await page.locator(`input[value="${view.mode}"]`).check();
  await page.evaluate((p) => {
    const app = window.__ATLAS_APP__;
    const host = app.host;
    host.governor.setForcedTier('high');
    host.time.pause();
    host.time.scrubTo(p);
    const rect = document.getElementById('viewport')?.getBoundingClientRect();
    if (rect) host.handleResize(rect.width, rect.height);
    app.captureFrame();
  }, phase);
  if (view.orbit !== null) {
    await page.evaluate(([az, polar, distance]) => {
      const host = window.__ATLAS_APP__.host;
      host.cameraRig.setOrbit(az, polar, distance, 'system');
      window.__ATLAS_APP__.captureFrame();
    }, view.orbit);
  }
  // Settle temporal accumulation at the frozen timeline.
  for (let i = 0; i < 6; i += 1) {
    await page.evaluate(() => window.__ATLAS_APP__.captureFrame());
  }
  if (manifest.backend === null) {
    manifest.backend = await page.evaluate(() => {
      const inv = window.__ATLAS_APP__.host.debugInventory();
      return inv?.backend ?? null;
    });
  }
  await page.locator('#viewport').screenshot({ path: join(outDir, `${view.name}.png`) });
  manifest.views.push({ name: view.name, mode: view.mode, orbit: view.orbit });
  console.log(`[capture-agn-disk] captured ${view.name}`);
}

manifest.consoleErrors = errors;
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`[capture-agn-disk] done -> ${outDir}`);
if (errors.length > 0) {
  console.error(`[capture-agn-disk] console errors: ${JSON.stringify(errors)}`);
}

await browser.close();
server.httpServer.close();
process.exit(errors.length > 0 ? 1 : 0);
