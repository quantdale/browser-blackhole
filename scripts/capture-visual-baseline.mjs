/**
 * Immutable before-state capture for the Cinematic Visual Fidelity Overhaul.
 *
 * This deliberately lives outside the scientific golden harness. Scientific
 * goldens answer "did the controlled radiance path regress?"; this capture
 * answers "what did the user actually see before the overhaul?" across both
 * experience modes, representative phases, shot scales, and short motion
 * strips.
 *
 * The output is ignored under artifacts/ by repository policy. The manifest
 * contains the build SHA, browser/backend metadata, capture axes, hashes are
 * supplied by the follow-up freeze command, and display-space metrics. Never
 * overwrite a completed baseline directory: use a new dated directory for a
 * new campaign baseline.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { preview } from 'vite';
import { chromium } from '@playwright/test';

const WIDTH = 1280;
const HEIGHT = 800;
const PORT = Number(process.env.BASELINE_PORT ?? 4299);
const CHANNEL = process.env.BASELINE_CHANNEL ?? 'msedge';
const outputRoot = resolve(
  process.env.BASELINE_OUTPUT ??
    join('artifacts', 'cinematic-visual-fidelity', 'baseline-2026-08-29')
);

if (
  existsSync(outputRoot) &&
  existsSync(join(outputRoot, 'manifest.json')) &&
  process.env.BASELINE_OVERWRITE !== '1'
) {
  throw new Error(
    `Refusing to overwrite frozen baseline at ${outputRoot}. ` +
      'Choose a new BASELINE_OUTPUT or set BASELINE_OVERWRITE=1 deliberately.'
  );
}

const scenes = [
  {
    id: 'black-hole',
    preset: 'default',
    url: '/atlas/black-hole?preset=default',
    phases: [0],
    motionPhases: [0]
  },
  {
    id: 'neutron-star',
    preset: 'surface',
    url: '/atlas/neutron-star?preset=surface',
    phases: [0, 0.5, 0.9],
    motionPhases: [0, 0.2, 0.4, 0.6, 0.8]
  },
  {
    id: 'stellar-explosion',
    preset: 'core-collapse',
    url: '/atlas/stellar-explosion?preset=core-collapse',
    phases: [0.03, 0.24, 0.55],
    motionPhases: [0.03, 0.18, 0.34, 0.5, 0.66]
  },
  {
    id: 'compact-merger',
    preset: 'equal-mass-nsns',
    url: '/atlas/compact-merger?preset=equal-mass-nsns',
    phases: [0.05, 0.37, 0.7],
    motionPhases: [0.05, 0.2, 0.37, 0.55, 0.7]
  },
  {
    id: 'tidal-disruption',
    preset: 'solar-canonical',
    url: '/atlas/tidal-disruption?preset=solar-canonical',
    phases: [0.16, 0.36, 0.78],
    motionPhases: [0.16, 0.28, 0.4, 0.58, 0.78]
  },
  {
    id: 'quasar-agn',
    preset: 'quasar-reference',
    url: '/atlas/quasar-agn?preset=quasar-reference',
    phases: [0.2, 0.5, 0.8],
    motionPhases: [0.2, 0.35, 0.5, 0.65, 0.8]
  },
  {
    id: 'black-hole-merger',
    preset: 'sxs-bbh-0001-inspiral',
    url: '/atlas/black-hole-merger?preset=sxs-bbh-0001-inspiral',
    phases: [0.05, 0.56, 0.85],
    motionPhases: [0.05, 0.25, 0.45, 0.65, 0.85]
  },
  {
    id: 'galaxy-collision',
    preset: 'encounter',
    url: '/atlas/galaxy-collision?preset=encounter',
    phases: [0.1, 0.5, 0.9],
    motionPhases: [0.1, 0.3, 0.5, 0.7, 0.9]
  }
];

const modes = ['scientific', 'cinematic'];
const shots = [
  { id: 'wide', factor: 1.3 },
  { id: 'medium', factor: 1 },
  { id: 'detail', factor: 0.72 }
];

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

async function selectMode(page, mode) {
  await page.locator(`input[value="${mode}"]`).check();
  await page.waitForFunction(
    (expected) => window.__ATLAS_APP__?.host.experienceMode === expected,
    mode
  );
}

async function setCaptureState(page, mode, phase, shotFactor, baseOrbit) {
  await selectMode(page, mode);
  await page.evaluate(
    ({ phase, shotFactor, baseOrbit }) => {
      const app = window.__ATLAS_APP__;
      if (!app) throw new Error('Atlas hook unavailable');
      const host = app.host;
      host.governor.setForcedTier('high');
      host.time.pause();
      host.time.scrubTo(phase);
      const orbit = baseOrbit ?? host.cameraRig.getOrbit();
      host.cameraRig.setOrbit(orbit.azimuthDeg, orbit.polarDeg, orbit.distance * shotFactor);
      const rect = document.getElementById('viewport')?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) host.handleResize(rect.width, rect.height);
      app.captureFrame();
    },
    { phase, shotFactor, baseOrbit }
  );
  await settleCamera(page);
  await page.evaluate(() => window.__ATLAS_APP__?.captureFrame());
}

async function imageMetrics(page, dataUrl) {
  return page.evaluate(async (source) => {
    const response = await fetch(source);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D context unavailable for baseline metrics');
    context.drawImage(bitmap, 0, 0);
    const width = bitmap.width;
    const height = bitmap.height;
    const pixels = context.getImageData(0, 0, width, height).data;
    bitmap.close();

    const luminance = new Float32Array(width * height);
    let sum = 0;
    let sumSq = 0;
    let saturated = 0;
    let crushed = 0;
    for (let i = 0; i < luminance.length; i++) {
      const offset = i * 4;
      const r = pixels[offset] ?? 0;
      const g = pixels[offset + 1] ?? 0;
      const b = pixels[offset + 2] ?? 0;
      const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      luminance[i] = value;
      sum += value;
      sumSq += value * value;
      if (Math.max(r, g, b) >= 250) saturated++;
      if (value <= 3) crushed++;
    }
    const sorted = Array.from(luminance).sort((a, b) => a - b);
    const percentile = (q) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    return {
      width,
      height,
      displaySpace: 'sRGB 8-bit screenshot',
      meanLuma: sum / luminance.length,
      stdevLuma: Math.sqrt(Math.max(0, sumSq / luminance.length - (sum / luminance.length) ** 2)),
      saturationPercent: (saturated / luminance.length) * 100,
      blackCrushPercent: (crushed / luminance.length) * 100,
      luminancePercentiles: {
        p01: percentile(0.01),
        p05: percentile(0.05),
        p50: percentile(0.5),
        p90: percentile(0.9),
        p99: percentile(0.99),
        p999: percentile(0.999)
      }
    };
  }, dataUrl);
}

async function temporalMetrics(page, dataUrls) {
  if (dataUrls.length < 2)
    return { frames: dataUrls.length, meanLumaDelta: 0, edgeFlickerPercent: 0 };
  return page.evaluate(async (sources) => {
    const frames = [];
    for (const source of sources) {
      const response = await fetch(source);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D context unavailable for temporal metrics');
      context.drawImage(bitmap, 0, 0);
      frames.push({
        width: bitmap.width,
        height: bitmap.height,
        data: context.getImageData(0, 0, bitmap.width, bitmap.height).data
      });
      bitmap.close();
    }
    let lumaDelta = 0;
    let comparisons = 0;
    let edgePixels = 0;
    let edgeDelta = 0;
    const stride = 2;
    for (let f = 1; f < frames.length; f++) {
      const previous = frames[f - 1];
      const current = frames[f];
      for (let y = 1; y < current.height - 1; y += stride) {
        for (let x = 1; x < current.width - 1; x += stride) {
          const index = (y * current.width + x) * 4;
          const previousLuma =
            0.2126 * previous.data[index] +
            0.7152 * previous.data[index + 1] +
            0.0722 * previous.data[index + 2];
          const currentLuma =
            0.2126 * current.data[index] +
            0.7152 * current.data[index + 1] +
            0.0722 * current.data[index + 2];
          lumaDelta += Math.abs(currentLuma - previousLuma);
          comparisons++;

          const left = (y * current.width + x - 1) * 4;
          const right = (y * current.width + x + 1) * 4;
          const up = ((y - 1) * current.width + x) * 4;
          const down = ((y + 1) * current.width + x) * 4;
          const gradient =
            Math.abs(current.data[right] - current.data[left]) +
            Math.abs(current.data[up] - current.data[down]);
          if (gradient >= 80) {
            edgePixels++;
            const previousGradient =
              Math.abs(previous.data[right] - previous.data[left]) +
              Math.abs(previous.data[up] - previous.data[down]);
            edgeDelta += Math.abs(gradient - previousGradient);
          }
        }
      }
    }
    return {
      frames: frames.length,
      meanLumaDelta: comparisons > 0 ? lumaDelta / comparisons : 0,
      edgeFlickerPercent: edgePixels > 0 ? (edgeDelta / edgePixels / 255) * 100 : 0
    };
  }, dataUrls);
}

async function contactSheet(page, dataUrls, columns = 5) {
  return page.evaluate(
    async ({ sources, columns }) => {
      const decoded = [];
      for (const source of sources) {
        const response = await fetch(source);
        const bitmap = await createImageBitmap(await response.blob());
        decoded.push(bitmap);
      }
      const tileWidth = 320;
      const tileHeight = 200;
      const rows = Math.ceil(decoded.length / columns);
      const canvas = document.createElement('canvas');
      canvas.width = columns * tileWidth;
      canvas.height = rows * tileHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2D context unavailable for contact sheet');
      context.fillStyle = '#05060c';
      context.fillRect(0, 0, canvas.width, canvas.height);
      decoded.forEach((bitmap, index) => {
        context.drawImage(
          bitmap,
          (index % columns) * tileWidth,
          Math.floor(index / columns) * tileHeight,
          tileWidth,
          tileHeight
        );
        bitmap.close();
      });
      return canvas.toDataURL('image/png');
    },
    { sources: dataUrls, columns }
  );
}

function writeDataUrl(path, dataUrl) {
  writeFileSync(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
}

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

ensureDir(outputRoot);
const manifest = {
  schemaVersion: 1,
  kind: 'cinematic-visual-fidelity-before-state',
  capturedAt: new Date().toISOString(),
  commit: gitSha(),
  node: process.version,
  npm: (() => {
    try {
      return execSync('npm --version', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  })(),
  os: `${os.type()} ${os.release()} (${process.platform})`,
  browser: { channel: CHANNEL },
  viewportCss: [WIDTH, HEIGHT],
  devicePixelRatio: 1,
  scenes: [],
  consoleErrors: errors
};

for (const scene of scenes) {
  console.log(`BASELINE ${scene.id}`);
  await page.goto(`http://127.0.0.1:${PORT}${scene.url}`);
  await waitForArrival(page);
  const baseOrbit = await page.evaluate(
    () => window.__ATLAS_APP__?.host.cameraRig.getOrbit() ?? null
  );
  const initialInventory = await page.evaluate(() => {
    const app = window.__ATLAS_APP__;
    if (!app) return null;
    const inventory = app.host.debugInventory();
    return {
      backend: inventory.backend,
      governor: inventory.governor,
      rendererInfo: inventory.rendererInfo,
      resourceScopes: inventory.resourceScopes,
      totalResourceCounts: inventory.totalResourceCounts,
      totalEstimatedGpuBytes: inventory.totalEstimatedGpuBytes,
      internalRenderSize: [
        document.getElementById('scene')?.width ?? 0,
        document.getElementById('scene')?.height ?? 0
      ]
    };
  });
  const sceneRecord = {
    id: scene.id,
    preset: scene.preset,
    url: scene.url,
    baseOrbit,
    backend: initialInventory?.backend ?? null,
    initialInventory,
    modes: {}
  };

  for (const mode of modes) {
    console.log(`  mode=${mode}`);
    const modeRoot = join(outputRoot, scene.id, mode);
    ensureDir(modeRoot);
    const modeRecord = { phaseCaptures: [], shotCaptures: [], motion: null };

    for (const phase of scene.phases) {
      await setCaptureState(page, mode, phase, 1.3, baseOrbit);
      const file = join(modeRoot, `phase-${String(phase).replace('.', '_')}-wide.png`);
      const buffer = await page.locator('#viewport').screenshot();
      writeFileSync(file, buffer);
      const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      modeRecord.phaseCaptures.push({
        phase,
        shot: 'wide',
        file: file.slice(outputRoot.length + 1),
        metrics: await imageMetrics(page, dataUrl)
      });
    }

    const shotPhase = scene.phases[Math.floor(scene.phases.length / 2)] ?? 0;
    for (const shot of shots) {
      await setCaptureState(page, mode, shotPhase, shot.factor, baseOrbit);
      const file = join(modeRoot, `phase-${String(shotPhase).replace('.', '_')}-${shot.id}.png`);
      const buffer = await page.locator('#viewport').screenshot();
      writeFileSync(file, buffer);
      const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      modeRecord.shotCaptures.push({
        phase: shotPhase,
        shot: shot.id,
        factor: shot.factor,
        file: file.slice(outputRoot.length + 1),
        metrics: await imageMetrics(page, dataUrl)
      });
    }

    const motionUrls = [];
    const motionFiles = [];
    for (const phase of scene.motionPhases) {
      await setCaptureState(page, mode, phase, 1.3, baseOrbit);
      const file = join(modeRoot, `motion-${String(phase).replace('.', '_')}.png`);
      const buffer = await page.locator('#viewport').screenshot();
      writeFileSync(file, buffer);
      motionUrls.push(`data:image/png;base64,${buffer.toString('base64')}`);
      motionFiles.push(file.slice(outputRoot.length + 1));
    }
    const stripDataUrl = await contactSheet(page, motionUrls);
    const stripFile = join(modeRoot, 'motion-strip.png');
    writeDataUrl(stripFile, stripDataUrl);
    modeRecord.motion = {
      phases: scene.motionPhases,
      frames: motionFiles,
      contactSheet: stripFile.slice(outputRoot.length + 1),
      metrics: await temporalMetrics(page, motionUrls)
    };
    sceneRecord.modes[mode] = modeRecord;
  }
  sceneRecord.finalRuntime = await page.evaluate(async () => {
    const app = window.__ATLAS_APP__;
    if (!app) return null;
    const gpuFrameMs = await app.host.flushGpuTimestamps();
    const inventory = app.host.debugInventory();
    return {
      gpuFrameMs: Number.isFinite(gpuFrameMs) ? gpuFrameMs : null,
      governor: inventory.governor,
      rendererInfo: inventory.rendererInfo,
      resourceScopes: inventory.resourceScopes,
      totalResourceCounts: inventory.totalResourceCounts,
      totalEstimatedGpuBytes: inventory.totalEstimatedGpuBytes,
      frameTelemetry: inventory.frame,
      internalRenderSize: [
        document.getElementById('scene')?.width ?? 0,
        document.getElementById('scene')?.height ?? 0
      ]
    };
  });
  manifest.scenes.push(sceneRecord);
}

manifest.consoleErrors = errors;
writeFileSync(join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify(
    {
      outputRoot,
      commit: manifest.commit,
      scenes: manifest.scenes.length,
      consoleErrors: errors.length
    },
    null,
    2
  )
);

await browser.close();
await server.close();
