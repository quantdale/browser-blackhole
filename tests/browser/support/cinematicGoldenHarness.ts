import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

import './atlasHook.js';

const GOLDEN_DIR = fileURLToPath(new URL('../cinematic-goldens', import.meta.url));

export interface CinematicGoldenSpec {
  name: string;
  url: string;
  phase: number;
  /** Optional fixed review distance for very large-scale destination shots. */
  cameraDistance?: number;
  /** Optional presentation target for a fixed review shot. */
  cameraTarget?: [number, number, number];
  /** Sparse-on-black rows use a scene-specific radiance floor. */
  minimumMeanLuma?: number;
  backend?: 'webgpu' | 'webgl2';
  notes: string;
}

export interface CinematicMetrics {
  width: number;
  height: number;
  meanLuma: number;
  stdevLuma: number;
  saturationPercent: number;
  blackCrushPercent: number;
  luminancePercentiles: { p01: number; p50: number; p90: number; p99: number };
  temporal: { frames: number; meanLumaDelta: number; edgeFlickerPercent: number };
}

export interface CinematicGoldenResult {
  status: 'pass' | 'updated' | 'missing' | 'fail';
  file: string;
  metrics: CinematicMetrics;
  metadata: Record<string, unknown>;
  comparison?: {
    meanAbsDelta: number;
    pctPixelsBeyond: number;
    maxChannelDelta: number;
    ssim: number;
  };
  message?: string;
}

export const CINEMATIC_GOLDEN_SPECS: CinematicGoldenSpec[] = [
  {
    name: 'CIN_BH_CLASSIC',
    url: '/atlas/black-hole?preset=classic',
    phase: 0.2,
    notes: 'Flagship Schwarzschild shadow, critical curve and V2 lensed environment.'
  },
  {
    name: 'CIN_NS_SURFACE',
    url: '/atlas/neutron-star?preset=surface',
    phase: 0.5,
    notes: 'Neutron-star limb/hot-spot surface ray and lensed stellar field.'
  },
  {
    name: 'CIN_SN_EXPANSION',
    url: '/atlas/stellar-explosion?preset=core-collapse',
    phase: 0.55,
    notes: 'Structured ejecta shell, streak profile and selective highlight path.'
  },
  {
    name: 'CIN_TDE_DEBRIS',
    url: '/atlas/tidal-disruption?preset=solar-canonical',
    phase: 0.42,
    cameraDistance: 600,
    cameraTarget: [-3150, 0, -1150],
    minimumMeanLuma: 0.1,
    notes: 'High-tier transported strand against the authoritative debris family.'
  },
  {
    name: 'CIN_CM_KILONOVA',
    url: '/atlas/compact-merger?preset=equal-mass-nsns',
    phase: 0.7,
    notes: 'Kilonova volume, compact surfaces and bounded ejecta profile.'
  },
  {
    name: 'CIN_AGN_NUCLEAR',
    url: '/atlas/quasar-agn?preset=quasar-reference',
    phase: 0.5,
    notes: 'Nuclear AGN torus/corona/jet hierarchy.'
  },
  {
    name: 'CIN_BBH_INSPIRAL',
    url: '/atlas/black-hole-merger?preset=sxs-bbh-0001-inspiral',
    phase: 0.05,
    notes: 'Vacuum BBH trajectory-tied presentation without invented matter.'
  },
  {
    name: 'CIN_GALAXY_BRIDGE',
    url: '/atlas/galaxy-collision?preset=bridge-tail',
    phase: 0.5,
    notes: 'GC1 authoritative tracers plus bounded unresolved stellar density.'
  }
];

export async function runCinematicGoldenExpectation(
  page: Page,
  spec: CinematicGoldenSpec
): Promise<CinematicGoldenResult> {
  const query =
    spec.backend === undefined
      ? ''
      : `${spec.url.includes('?') ? '&' : '?'}backend=${spec.backend}`;
  await page.goto(`${spec.url}${query}`);
  await waitForArrival(page);
  await page.locator('input[value="cinematic"]').check();
  await page.evaluate(
    ({ phase, cameraDistance, cameraTarget }) => {
      const app = window.__ATLAS_APP__!;
      const host = app.host as unknown as {
        governor: { setForcedTier(tier: 'high'): void };
        time: { pause(): void; scrubTo(value: number): void };
        cameraRig: {
          getOrbit(): { azimuthDeg: number; polarDeg: number; distance: number };
          setOrbit(
            azimuthDeg: number,
            polarDeg: number,
            distance: number,
            source?: 'system' | 'user'
          ): void;
          setTarget(target: { x: number; y: number; z: number }, source?: 'system' | 'user'): void;
        };
        handleResize(width: number, height: number): void;
      };
      host.governor.setForcedTier('high');
      host.time.pause();
      host.time.scrubTo(phase);
      // Let the destination first materialize the scrubbed geometry and settle
      // any authored auto-framing. A fixed review shot is then a real viewer
      // takeover applied after that destination-owned pass, so its target and
      // orbit cannot be overwritten by the first frame's system cue.
      if (cameraTarget !== null || cameraDistance !== null) app.captureFrame();
      if (cameraTarget !== null) {
        host.cameraRig.setTarget(
          { x: cameraTarget[0], y: cameraTarget[1], z: cameraTarget[2] },
          'user'
        );
      }
      if (cameraDistance !== null) {
        const orbit = host.cameraRig.getOrbit();
        // A review shot is an explicit camera takeover. It disables the
        // destination auto-framer for this visit, just as a viewer drag does,
        // while leaving the physical observer/model state unchanged.
        host.cameraRig.setOrbit(orbit.azimuthDeg, orbit.polarDeg, cameraDistance, 'user');
      }
      const rect = document.getElementById('viewport')?.getBoundingClientRect();
      if (rect) host.handleResize(rect.width, rect.height);
      app.captureFrame();
    },
    {
      phase: spec.phase,
      cameraDistance: spec.cameraDistance ?? null,
      cameraTarget: spec.cameraTarget ?? null
    }
  );
  await expect
    .poll(
      () => page.evaluate(() => window.__ATLAS_APP__?.host.time.snapshot().simulationPhase ?? -1),
      { timeout: 15_000, intervals: [100] }
    )
    .toBeCloseTo(spec.phase, 4);
  await settleCamera(page);

  const frames: Buffer[] = [];
  for (let i = 0; i < 10; i += 1) {
    await page.evaluate(() => window.__ATLAS_APP__?.captureFrame());
    frames.push(await page.locator('#viewport').screenshot());
  }
  const current = frames[frames.length - 1]!;
  const metrics = await captureMetrics(page, frames);
  const runtimeMetadata = await page.evaluate(() => {
    const app = window.__ATLAS_APP__!;
    const post =
      (
        app.host.post as unknown as {
          getDebugSnapshot?(): Record<string, unknown>;
        }
      ).getDebugSnapshot?.() ?? {};
    const inventory = app.host.debugInventory?.() ?? null;
    const state = app.host.state as unknown as {
      sharedVisual: {
        exposure: number;
        toneMapping: string;
        bloomEnabled: boolean;
        bloomStrength: number;
      };
    };
    const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
    return {
      backend: inventory?.backend ?? null,
      browser: navigator.userAgent,
      viewportCss: [window.innerWidth, window.innerHeight],
      internalRenderSize: [canvas?.width ?? 0, canvas?.height ?? 0],
      tier: inventory?.governor?.tier ?? null,
      exposure: state.sharedVisual.exposure,
      toneMapping: state.sharedVisual.toneMapping,
      bloomEnabled: state.sharedVisual.bloomEnabled,
      bloomStrength: state.sharedVisual.bloomStrength,
      temporal: post.temporal ?? null,
      stages: post.stages ?? [],
      destination: app.host.activeDestinationDebugSnapshot?.() ?? null
    };
  });
  const temporalMetadata = runtimeMetadata.temporal as {
    historyAge?: number;
    historyFrames?: number;
  } | null;
  const metadata: Record<string, unknown> = {
    ...runtimeMetadata,
    commit: process.env.CINEMATIC_GOLDEN_COMMIT ?? 'uncommitted',
    settleProtocol: {
      captureFrames: frames.length,
      historySettleCount: temporalMetadata?.historyAge ?? 0,
      maximumHistoryFrames: temporalMetadata?.historyFrames ?? 0,
      finiteDeadlineSeconds: 15
    },
    reviewShot: {
      phase: spec.phase,
      cameraDistance: spec.cameraDistance ?? 'destination-authored/auto-framed',
      cameraTarget: spec.cameraTarget ?? 'destination-authored/auto-framed',
      minimumMeanLuma: spec.minimumMeanLuma ?? 0.5
    }
  };
  const suffix = spec.backend === undefined ? '' : `_${spec.backend.toUpperCase()}`;
  const fileName = `${spec.name}${suffix}.png`;
  const file = join(GOLDEN_DIR, fileName);
  const update = process.env.UPDATE_CINEMATIC_GOLDENS === '1';
  if (update) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, current);
    return { status: 'updated', file, metrics, metadata };
  }
  if (!existsSync(file)) {
    return {
      status: 'missing',
      file,
      metrics,
      metadata,
      message: 'Run with UPDATE_CINEMATIC_GOLDENS=1 after review.'
    };
  }

  const comparison = await comparePngs(page, current, readFileSync(file));
  const pass =
    comparison.meanAbsDelta <= 10 && comparison.pctPixelsBeyond <= 12 && comparison.ssim >= 0.88;
  const result: CinematicGoldenResult = {
    status: pass ? 'pass' : 'fail',
    file,
    metrics,
    metadata,
    comparison
  };
  if (!pass) result.message = `cinematic golden drift exceeds tolerance for ${spec.name}`;
  return result;
}

async function waitForArrival(page: Page): Promise<void> {
  await page.locator('#scene').waitFor({ state: 'attached', timeout: 30_000 });
  // Pause as soon as the host exists, before asynchronous destination prepare
  // and arrival can accumulate spin/flare time. TimeController.pause() is
  // sticky across enter(), making phase-sensitive captures independent of
  // shader compilation and transition duration.
  await expect
    .poll(() => page.evaluate(() => (window.__ATLAS_APP__ ? 'ready' : 'waiting')), {
      timeout: 30_000,
      intervals: [50]
    })
    .toBe('ready');
  await page.evaluate(() => window.__ATLAS_APP__?.host.time.pause());
  await expect
    .poll(
      () => page.evaluate(() => window.__ATLAS_APP__?.host.state.atlas.transition.active === false),
      { timeout: 60_000, intervals: [250] }
    )
    .toBe(true);
}

async function settleCamera(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const camera = window.__ATLAS_APP__?.host.camera;
        if (!camera) return resolve();
        let previous = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        let stable = 0;
        const deadline = performance.now() + 15_000;
        const poll = () => {
          const delta = Math.hypot(
            camera.position.x - previous.x,
            camera.position.y - previous.y,
            camera.position.z - previous.z
          );
          previous = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
          stable = delta < 1e-4 ? stable + 1 : 0;
          if (stable >= 3 || performance.now() >= deadline) resolve();
          else setTimeout(poll, 100);
        };
        setTimeout(poll, 100);
      })
  );
}

async function decodeImage(
  page: Page,
  buffer: Buffer
): Promise<{ width: number; height: number; data: number[] }> {
  return page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D context unavailable');
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const output = { width: bitmap.width, height: bitmap.height, data: Array.from(data) };
    bitmap.close();
    return output;
  }, buffer.toString('base64')) as Promise<{
    width: number;
    height: number;
    data: number[];
  }>;
}

async function captureMetrics(page: Page, frames: Buffer[]): Promise<CinematicMetrics> {
  const decoded = await Promise.all(frames.map((frame) => decodeImage(page, frame)));
  const first = decoded[0]!;
  const luma = new Float32Array(first.width * first.height);
  let sum = 0;
  let sumSq = 0;
  let saturated = 0;
  let crushed = 0;
  for (let i = 0; i < luma.length; i += 1) {
    const offset = i * 4;
    const r = first.data[offset] ?? 0;
    const g = first.data[offset + 1] ?? 0;
    const b = first.data[offset + 2] ?? 0;
    const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[i] = value;
    sum += value;
    sumSq += value * value;
    if (Math.max(r, g, b) >= 250) saturated += 1;
    if (value <= 3) crushed += 1;
  }
  const sorted = Array.from(luma).sort((a, b) => a - b);
  const percentile = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  let lumaDelta = 0;
  let edgeDelta = 0;
  let edgeCount = 0;
  for (let frame = 1; frame < decoded.length; frame += 1) {
    const previous = decoded[frame - 1]!;
    const current = decoded[frame]!;
    for (let y = 1; y < current.height - 1; y += 2) {
      for (let x = 1; x < current.width - 1; x += 2) {
        const offset = (y * current.width + x) * 4;
        const previousLuma =
          0.2126 * (previous.data[offset] ?? 0) +
          0.7152 * (previous.data[offset + 1] ?? 0) +
          0.0722 * (previous.data[offset + 2] ?? 0);
        const currentLuma =
          0.2126 * (current.data[offset] ?? 0) +
          0.7152 * (current.data[offset + 1] ?? 0) +
          0.0722 * (current.data[offset + 2] ?? 0);
        lumaDelta += Math.abs(currentLuma - previousLuma);
        const left = offset - 4;
        const right = offset + 4;
        const up = offset - current.width * 4;
        const down = offset + current.width * 4;
        const gradient =
          Math.abs((current.data[right] ?? 0) - (current.data[left] ?? 0)) +
          Math.abs((current.data[up] ?? 0) - (current.data[down] ?? 0));
        if (gradient >= 80) {
          edgeCount += 1;
          const previousGradient =
            Math.abs((previous.data[right] ?? 0) - (previous.data[left] ?? 0)) +
            Math.abs((previous.data[up] ?? 0) - (previous.data[down] ?? 0));
          edgeDelta += Math.abs(gradient - previousGradient);
        }
      }
    }
  }
  const comparisons = Math.max(
    1,
    (decoded.length - 1) * Math.ceil(first.width / 2) * Math.ceil(first.height / 2)
  );
  return {
    width: first.width,
    height: first.height,
    meanLuma: sum / luma.length,
    stdevLuma: Math.sqrt(Math.max(0, sumSq / luma.length - (sum / luma.length) ** 2)),
    saturationPercent: (saturated / luma.length) * 100,
    blackCrushPercent: (crushed / luma.length) * 100,
    luminancePercentiles: {
      p01: percentile(0.01),
      p50: percentile(0.5),
      p90: percentile(0.9),
      p99: percentile(0.99)
    },
    temporal: {
      frames: decoded.length,
      meanLumaDelta: lumaDelta / comparisons,
      edgeFlickerPercent: edgeCount > 0 ? (edgeDelta / edgeCount / 255) * 100 : 0
    }
  };
}

async function comparePngs(page: Page, current: Buffer, golden: Buffer) {
  return page.evaluate(
    async ({ currentBase64, goldenBase64 }) => {
      async function decode(base64: string): Promise<ImageData> {
        const response = await fetch(`data:image/png;base64,${base64}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('2D context unavailable');
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
        bitmap.close();
        return data;
      }
      const a = await decode(currentBase64);
      const b = await decode(goldenBase64);
      if (a.width !== b.width || a.height !== b.height) {
        return { meanAbsDelta: Infinity, pctPixelsBeyond: 100, maxChannelDelta: 255, ssim: 0 };
      }
      let sum = 0;
      let beyond = 0;
      let max = 0;
      let ssimSum = 0;
      let ssimBlocks = 0;
      for (let i = 0; i < a.width * a.height; i += 1) {
        const offset = i * 4;
        let pixelMax = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          const delta = Math.abs((a.data[offset + channel] ?? 0) - (b.data[offset + channel] ?? 0));
          sum += delta;
          pixelMax = Math.max(pixelMax, delta);
          max = Math.max(max, delta);
        }
        if (pixelMax > 32) beyond += 1;
      }
      const c1 = 6.5025;
      const c2 = 58.5225;
      for (let by = 0; by < a.height; by += 8) {
        for (let bx = 0; bx < a.width; bx += 8) {
          const valuesA: number[] = [];
          const valuesB: number[] = [];
          for (let y = by; y < Math.min(a.height, by + 8); y += 1) {
            for (let x = bx; x < Math.min(a.width, bx + 8); x += 1) {
              const offset = (y * a.width + x) * 4;
              valuesA.push(
                0.2126 * (a.data[offset] ?? 0) +
                  0.7152 * (a.data[offset + 1] ?? 0) +
                  0.0722 * (a.data[offset + 2] ?? 0)
              );
              valuesB.push(
                0.2126 * (b.data[offset] ?? 0) +
                  0.7152 * (b.data[offset + 1] ?? 0) +
                  0.0722 * (b.data[offset + 2] ?? 0)
              );
            }
          }
          const count = valuesA.length;
          if (count === 0) continue;
          const meanA = valuesA.reduce((sum, value) => sum + value, 0) / count;
          const meanB = valuesB.reduce((sum, value) => sum + value, 0) / count;
          let varianceA = 0;
          let varianceB = 0;
          let covariance = 0;
          for (let i = 0; i < count; i += 1) {
            const da = valuesA[i]! - meanA;
            const db = valuesB[i]! - meanB;
            varianceA += da * da;
            varianceB += db * db;
            covariance += da * db;
          }
          const divisor = Math.max(1, count - 1);
          varianceA /= divisor;
          varianceB /= divisor;
          covariance /= divisor;
          ssimSum +=
            ((2 * meanA * meanB + c1) * (2 * covariance + c2)) /
            ((meanA * meanA + meanB * meanB + c1) * (varianceA + varianceB + c2));
          ssimBlocks += 1;
        }
      }
      return {
        meanAbsDelta: sum / (a.width * a.height * 3),
        pctPixelsBeyond: (beyond / (a.width * a.height)) * 100,
        maxChannelDelta: max,
        ssim: ssimBlocks > 0 ? ssimSum / ssimBlocks : 1
      };
    },
    { currentBase64: current.toString('base64'), goldenBase64: golden.toString('base64') }
  );
}
