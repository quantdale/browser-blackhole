/**
 * Full-quality Stellar Explosion vertical-slice gate.
 *
 * This is intentionally separate from the immutable before-state capture and
 * the scientific golden harness. It records the restored campaign's showcase
 * evidence: authored scenario variants, Scientific/Cinematic presentation,
 * every governed tier, settled temporal metadata, display-space statistics,
 * and reviewable PNGs. The output is ignored under artifacts/ and must be
 * pointed at a new directory for every final-SHA run.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from '@playwright/test';

const WIDTH = 1280;
const HEIGHT = 800;
const PORT = Number(process.env.STELLAR_GATE_PORT ?? 4399);
const CHANNEL = process.env.STELLAR_GATE_CHANNEL ?? 'msedge';
const outputRoot = resolve(
  process.env.STELLAR_GATE_OUTPUT ??
    join('artifacts', 'cinematic-visual-fidelity', `stellar-gate-${gitSha().slice(0, 12)}`)
);

if (existsSync(join(outputRoot, 'manifest.json')) && process.env.STELLAR_GATE_OVERWRITE !== '1') {
  throw new Error(`Refusing to overwrite existing Stellar gate at ${outputRoot}`);
}

const backends = (process.env.STELLAR_GATE_BACKENDS ?? 'webgpu,webgl2')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const tiers = ['low', 'medium', 'high', 'ultra'];
const modes = ['scientific', 'cinematic'];
const scenarios = [
  { id: 'core-collapse', label: 'core-collapse', phases: [0.24, 0.55, 0.8] },
  { id: 'hypernova', label: 'hypernova', phases: [0.24, 0.55, 0.8] },
  { id: 'long-grb-on-axis', label: 'long-grb-on-axis', phases: [0.28, 0.55, 0.78] },
  { id: 'long-grb-off-axis', label: 'long-grb-off-axis', phases: [0.28, 0.55, 0.78] }
];
const allPhases = process.env.STELLAR_GATE_PHASES === 'all';
const selectedScenarioIds = new Set(
  (process.env.STELLAR_GATE_SCENARIOS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
const selectedTierIds = new Set(
  (process.env.STELLAR_GATE_TIERS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
const selectedScenarios =
  selectedScenarioIds.size === 0
    ? scenarios
    : scenarios.filter((scenario) => selectedScenarioIds.has(scenario.id));
const selectedTiers =
  selectedTierIds.size === 0 ? tiers : tiers.filter((tier) => selectedTierIds.has(tier));

function gitSha() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

async function waitForArrival(page) {
  await page.locator('#scene').waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => window.__ATLAS_APP__?.host.state.atlas.transition.active === false,
    undefined,
    { timeout: 60_000 }
  );
  await settleCamera(page);
}

async function settleCamera(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const camera = window.__ATLAS_APP__?.host.camera;
        if (!camera) {
          resolve();
          return;
        }
        let previous = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        let stable = 0;
        const deadline = performance.now() + 15_000;
        const poll = () => {
          const current = camera.position;
          const delta = Math.hypot(
            current.x - previous.x,
            current.y - previous.y,
            current.z - previous.z
          );
          previous = { x: current.x, y: current.y, z: current.z };
          stable = delta < 1e-4 ? stable + 1 : 0;
          if (stable >= 3 || performance.now() >= deadline) resolve();
          else setTimeout(poll, 100);
        };
        setTimeout(poll, 100);
      })
  );
}

async function setState(page, mode, tier, phase) {
  await page.locator(`input[value="${mode}"]`).check();
  await page.waitForFunction(
    (expected) => window.__ATLAS_APP__?.host.experienceMode === expected,
    mode
  );
  await page.evaluate(
    ({ tier, phase }) => {
      const app = window.__ATLAS_APP__;
      if (!app) throw new Error('Atlas hook unavailable');
      const host = app.host;
      host.governor.setForcedTier(tier);
      host.time.pause();
      host.time.scrubTo(phase);
      const rect = document.getElementById('viewport')?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) host.handleResize(rect.width, rect.height);
      app.captureFrame();
    },
    { tier, phase }
  );
  await settleCamera(page);
  // High/Ultra have bounded temporal history. A finite, tier-aware settle
  // count makes the capture reproducible without waiting indefinitely.
  const settleFrames = tier === 'ultra' ? 6 : tier === 'high' ? 8 : 2;
  for (let i = 0; i < settleFrames; i += 1) {
    await page.evaluate(() => window.__ATLAS_APP__?.captureFrame());
  }
}

async function metrics(page, buffer) {
  return page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D context unavailable');
    context.drawImage(bitmap, 0, 0);
    const width = bitmap.width;
    const height = bitmap.height;
    const data = context.getImageData(0, 0, width, height).data;
    bitmap.close();
    const luma = new Float32Array(width * height);
    let sum = 0;
    let sumSq = 0;
    let saturated = 0;
    let crushed = 0;
    for (let i = 0; i < luma.length; i += 1) {
      const offset = i * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      luma[i] = value;
      sum += value;
      sumSq += value * value;
      if (Math.max(r, g, b) >= 250) saturated += 1;
      if (value <= 3) crushed += 1;
    }
    const sorted = Array.from(luma).sort((a, b) => a - b);
    const percentile = (q) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    return {
      width,
      height,
      meanLuma: sum / luma.length,
      stdevLuma: Math.sqrt(Math.max(0, sumSq / luma.length - (sum / luma.length) ** 2)),
      saturationPercent: (saturated / luma.length) * 100,
      blackCrushPercent: (crushed / luma.length) * 100,
      p01: percentile(0.01),
      p50: percentile(0.5),
      p90: percentile(0.9),
      p99: percentile(0.99)
    };
  }, buffer.toString('base64'));
}

ensureDir(outputRoot);
const server = await preview({ preview: { host: '127.0.0.1', port: PORT, strictPort: true } });
const browser = await chromium.launch({ channel: CHANNEL, headless: true });
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1
});
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));

const manifest = {
  schemaVersion: 1,
  kind: 'stellar-explosion-full-quality-vertical-slice',
  commit: gitSha(),
  browser: CHANNEL,
  viewportCss: [WIDTH, HEIGHT],
  backends,
  tiers,
  modes,
  scenarios,
  captures: [],
  consoleErrors: errors
};

for (const backend of backends) {
  for (const scenario of selectedScenarios) {
    await page.goto(
      `http://127.0.0.1:${PORT}/atlas/stellar-explosion?preset=${scenario.id}&backend=${backend}`
    );
    await waitForArrival(page);
    for (const mode of modes) {
      for (const tier of selectedTiers) {
        const phases = allPhases
          ? scenario.phases
          : [scenario.phases[Math.floor(scenario.phases.length / 2)] ?? 0];
        for (const phase of phases) {
          await setState(page, mode, tier, phase);
          const safePhase = String(phase).replace('.', '_');
          const relative = join(backend, scenario.label, mode, tier, `phase-${safePhase}.png`);
          const file = join(outputRoot, relative);
          ensureDir(resolve(file, '..'));
          const buffer = await page.locator('#viewport').screenshot();
          writeFileSync(file, buffer);
          const debug = await page.evaluate(() => {
            const app = window.__ATLAS_APP__;
            return {
              destination: app?.host.activeDestinationDebugSnapshot?.() ?? null,
              post: app?.host.post?.getDebugSnapshot?.() ?? null,
              inventory: app?.host.debugInventory?.() ?? null
            };
          });
          manifest.captures.push({
            backend,
            scenario: scenario.id,
            mode,
            tier,
            phase,
            file: relative,
            metrics: await metrics(page, buffer),
            debug
          });
          console.log(`STELLAR_GATE ${backend} ${scenario.id} ${mode} ${tier} phase=${phase}`);
        }
      }
    }
  }
}

writeFileSync(join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
await page.close();
await browser.close();
await server.close();
console.log(`Wrote ${manifest.captures.length} Stellar captures to ${outputRoot}`);
console.log(`Console/page errors: ${manifest.consoleErrors.length}`);
