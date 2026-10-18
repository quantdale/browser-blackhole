/**
 * Probe the actual pixel values at physical-magenta coordinates in BOTH views.
 *
 * The aggregate census left a 1.15% "unclassified" bucket in the status view
 * that almost exactly equals the physical magenta population. This probe asks
 * the direct question: at the coordinates where the physical render is magenta,
 * what exact RGB does the ?kerrstatus view emit? If those values are neither a
 * valid class nor a documented failure color, the status classifier (not the
 * physics) is what needs fixing first.
 *
 * Emits a histogram of exact RGB triples for both views.
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

const outDir = resolve(String(arg('out', 'artifacts/visual-fidelity-kerr-band/diagnostics')));
const backend = String(arg('backend', 'webgpu'));
const tier = String(arg('tier', 'high'));
const preset = String(arg('preset', 'kerr-high-prograde'));
const port = Number(arg('port', 4303));
mkdirSync(outDir, { recursive: true });

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
  console.error(`[probe] build failed: ${String(error)}`);
  process.exit(1);
}

const server = await preview({ preview: { port, host: '127.0.0.1' } });
const browser = await chromium.launch({ executablePath: BRAVE_PATH, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function waitForArrival() {
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
}

async function pin() {
  return page.evaluate(
    ([tierName]) => {
      const host = window.__ATLAS_APP__.host;
      host.governor.setForcedTier(tierName);
      host.setRenderScaleOverride(1);
      host.time.pause();
      host.time.scrubTo(0.5);
      host.post.setBloom(false, 0);
      host.post.setExposure(1);
      host.post.setToneMapping('linear');
      const rect = document.getElementById('viewport')?.getBoundingClientRect();
      if (rect) host.handleResize(rect.width, rect.height);
      window.__ATLAS_APP__.captureFrame();
      const canvas = document.querySelector('canvas');
      return { internal: canvas ? [canvas.width, canvas.height] : null };
    },
    [tier]
  );
}

/**
 * Read raw RGBA and return a per-pixel histogram of exact triples for the
 * requested pixel indices (or the whole frame when indices are null).
 */
async function readRaw() {
  return page.evaluate(() => {
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
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < d.length; i += chunk)
      s += String.fromCharCode.apply(null, d.subarray(i, i + chunk));
    return { width: w, height: h, rgba: btoa(s) };
  });
}

await page.goto(`http://127.0.0.1:${port}/atlas/black-hole?preset=${preset}&backend=${backend}`);
await waitForArrival();
await pin();
await page.waitForTimeout(9000);
const rawPhysical = await readRaw();

await page.goto(
  `http://127.0.0.1:${port}/atlas/black-hole?preset=${preset}&kerrstatus&backend=${backend}`
);
await waitForArrival();
await pin();
await page.waitForTimeout(9000);
const rawStatus = await readRaw();

const A = Buffer.from(rawPhysical.rgba, 'base64');
const B = Buffer.from(rawStatus.rgba, 'base64');
const W = rawPhysical.width;
const H = rawPhysical.height;

// Identify physical-magenta pixels, then read the status color at those coords.
const magentaIdx = [];
const physHist = new Map();
for (let p = 0; p < W * H; p += 1) {
  const r = A[p * 4];
  const g = A[p * 4 + 1];
  const b = A[p * 4 + 2];
  const key = `${r},${g},${b}`;
  if (r > 24 && b > 24 && g < Math.min(r, b) * 0.75) {
    magentaIdx.push(p);
    physHist.set(key, (physHist.get(key) ?? 0) + 1);
  }
}

const statusHistAtMagenta = new Map();
const statusHistGlobal = new Map();
for (let p = 0; p < W * H; p += 1) {
  const key = `${B[p * 4]},${B[p * 4 + 1]},${B[p * 4 + 2]}`;
  statusHistGlobal.set(key, (statusHistGlobal.get(key) ?? 0) + 1);
}
for (const p of magentaIdx) {
  const key = `${B[p * 4]},${B[p * 4 + 1]},${B[p * 4 + 2]}`;
  statusHistAtMagenta.set(key, (statusHistAtMagenta.get(key) ?? 0) + 1);
}

const top = (map, n = 15) =>
  [...map.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([k, v]) => ({ rgb: k, count: v }));

const report = {
  commit,
  backend,
  tier,
  internal: [W, H],
  physicalMagentaPixels: magentaIdx.length,
  physicalMagentaPercent: +((magentaIdx.length / (W * H)) * 100).toFixed(4),
  // Exact physical colors that my magenta detector matched:
  physicalMagentaTop: top(physHist),
  // What the status view emits at exactly those pixels:
  statusColorsAtMagentaPixels: top(statusHistAtMagenta),
  // And the status view's overall palette, for reference:
  statusPaletteGlobal: top(statusHistGlobal)
};

writeFileSync(join(outDir, 'pixel-probe.json'), JSON.stringify(report, null, 2));
console.log('[probe] ' + JSON.stringify(report, null, 2));

await browser.close();
server.httpServer.close();
process.exit(0);
