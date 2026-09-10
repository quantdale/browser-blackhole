/**
 * Whole-atlas performance campaign, tasks.md §0 — non-stationary scenario
 * matrix (MASTER_PLAN §5.3).
 *
 * One record per (destination, backend) covering the scenario rows the nine
 * steady-state harnesses cannot express:
 *
 * - cold navigation (fresh context, module chunk genuinely cold);
 * - warm navigation (round trip in the same document, module cached);
 * - stationary IDLE (paused + settled: proves the frame loop declines to
 *   render, which is WS1's actual product) and stationary COST (forced
 *   continuous render: steady-state per-frame timing);
 * - active timeline (playing);
 * - camera interaction (per-frame user orbit writes);
 * - settling (rAF ticks until the orchestrated-frame counter goes quiet);
 * - transition out of and into the destination (arrival ms + phases seen);
 * - low/medium/high/ultra tier ladder (stationary cost per tier);
 * - WebGPU and forced-WebGL2 (run twice with --backends).
 *
 * Every sampled window records `renderTelemetry`; a window that was supposed
 * to render and rendered nothing exits non-zero with a refusal message, so a
 * broken measurement cannot masquerade as a result (same policy as the other
 * harnesses). All timings are CPU-side rAF deltas and wall-clock arrival ms,
 * NEVER GPU timestamps; `frameGpuMs` is recorded separately when the backend
 * exposes timestamp queries.
 *
 * Usage:
 *   node scripts/bench-scenarios.mjs [--backends=webgpu,webgl2]
 *     [--destinations=black-hole,...] [--channel=msedge|chrome|chromium]
 *     [--headed=0|1] [--width=1280] [--height=800] [--frames=120]
 *     [--warmup-ms=1500] [--port=4600] [--out=<path>]
 */

import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const csv = (value) =>
  String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const DESTINATIONS = [
  'black-hole',
  'neutron-star',
  'stellar-explosion',
  'compact-merger',
  'tidal-disruption',
  'quasar-agn',
  'black-hole-merger',
  'galaxy-collision'
];

const backends = csv(arg('backends', 'webgpu'));
const destinations = csv(arg('destinations', DESTINATIONS.join(',')));
const channel = String(arg('channel', process.env.BENCH_CHANNEL ?? 'msedge'));
const headed = arg('headed', process.env.BENCH_HEADED ?? '0') === '1';
const width = Number(arg('width', '1280'));
const height = Number(arg('height', '800'));
const frames = Math.max(30, Number(arg('frames', '120')));
const warmupMs = Math.max(0, Number(arg('warmup-ms', '1500')));
const startPort = Number(arg('port', '4600'));
const commit =
  process.env.BENCH_COMMIT ??
  (() => {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'uncommitted';
    }
  })();

const validBackends = new Set(['webgpu', 'webgl2']);
if (backends.length === 0 || backends.some((backend) => !validBackends.has(backend))) {
  console.error('[scenarios] --backends must contain webgpu and/or webgl2');
  process.exit(2);
}
for (const destination of destinations) {
  if (!DESTINATIONS.includes(destination)) {
    console.error(`[scenarios] unknown destination ${destination}`);
    process.exit(2);
  }
}
if (!existsSync(resolve(root, 'dist', 'index.html'))) {
  console.error('[scenarios] dist/ is missing; run `npm run build` first');
  process.exit(2);
}

const outPath = resolve(
  root,
  arg('out', `benchmarks/results/${new Date().toISOString().slice(0, 10)}-scenarios/matrix.json`)
);

/** Constants mirrored from tests/browser/frame-invalidation.spec.ts. */
const QUIESCENT_FRAMES = 20;
const IDLE_TICKS = 30;

/** In-page helpers installed once per document. Kept as strings for clarity. */
const INSTALL_HELPERS = () => {
  const runtime = window;
  // Idempotent: re-running must NOT replace the state object, because an
  // already-patched kernel.renderFrame closure lives in this document and
  // reads through it. Replacing it would null out the captured original.
  if (runtime.__scenarios !== undefined && runtime.__scenarios.version === 1) return;
  runtime.__scenarios = {
    version: 1,
    renderFrameCalls: 0,
    rafTicks: 0,
    originalRenderFrame: null,
    installCounter() {
      runtime.__scenarios.rafTicks = 0;
      const countTick = () => {
        runtime.__scenarios.rafTicks += 1;
        requestAnimationFrame(countTick);
      };
      requestAnimationFrame(countTick);
      if (runtime.__scenarios.originalRenderFrame !== null) return;
      const host = window.__ATLAS_APP__.host;
      const original = host.kernel.renderFrame.bind(host.kernel);
      runtime.__scenarios.originalRenderFrame = original;
      host.kernel.renderFrame = (plan) => {
        window.__scenarios.renderFrameCalls += 1;
        return original(plan);
      };
    },
    resetCounter() {
      runtime.__scenarios.renderFrameCalls = 0;
    },
    /** Sample rAF deltas + telemetry for a window while `before` runs each tick. */
    async sample(frameCount, beforeEach) {
      const host = window.__ATLAS_APP__.host;
      host.resetFrameTelemetry();
      const deltas = [];
      let last = performance.now();
      await new Promise((resolvePromise) => {
        const tick = (now) => {
          if (beforeEach) beforeEach();
          deltas.push(Math.max(0, now - last));
          last = now;
          if (deltas.length >= frameCount) resolvePromise();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const telemetry = host.frameTelemetry();
      const inventory = host.debugInventory();
      const gpuMs = await (host.flushGpuTimestamps?.() ?? Promise.resolve(null));
      const sorted = [...deltas].sort((a, b) => a - b);
      const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const variance = deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length;
      const round2 = (v) => +v.toFixed(2);
      return {
        frames: deltas.length,
        frameCpuMs: {
          min: round2(sorted[0]),
          median: round2(pick(0.5)),
          p90: round2(pick(0.9)),
          p95: round2(pick(0.95)),
          p99: round2(pick(0.99)),
          max: round2(sorted[sorted.length - 1]),
          mean: round2(mean),
          stdev: round2(Math.sqrt(variance))
        },
        frameGpuMs:
          gpuMs === null || !Number.isFinite(gpuMs) ? null : { lastResolvedFrame: round2(gpuMs) },
        gpuComputeMs: inventory.gpuComputeMs ?? null,
        renderTelemetry: {
          framesObserved: telemetry.framesObserved,
          framesRendered: telemetry.framesRendered,
          framesSkipped: telemetry.framesSkipped,
          lastFrameWork: telemetry.lastFrameWork,
          lastReasonNames: telemetry.lastReasonNames
        },
        rendererInfo: inventory.rendererInfo,
        memory: {
          estimatedGpuBytesTotal: inventory.totalEstimatedGpuBytes,
          textureCount: inventory.totalResourceCounts.texture
        },
        runtime: inventory.runtime,
        tier: inventory.governor?.tier ?? null,
        renderScale: inventory.governor?.renderScale ?? null
      };
    },
    /** Count rAF ticks until the orchestrated-frame counter is quiet. */
    async settle(maxTicks) {
      const runtimeState = window.__scenarios;
      let mark = runtimeState.renderFrameCalls;
      let quiet = 0;
      let total = 0;
      await new Promise((resolvePromise) => {
        const step = () => {
          total += 1;
          if (runtimeState.renderFrameCalls === mark) quiet += 1;
          else {
            quiet = 0;
            mark = runtimeState.renderFrameCalls;
          }
          if (quiet >= 20 || total >= maxTicks) resolvePromise();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      return { ticks: total, settled: quiet >= 20 };
    },
    /** Idle observation: count ticks and whether any orchestrated frame ran. */
    async idle(ticks) {
      const runtimeState = window.__scenarios;
      const host = window.__ATLAS_APP__.host;
      runtimeState.resetCounter();
      host.resetFrameTelemetry();
      await new Promise((resolvePromise) => {
        let remaining = ticks;
        const step = () => {
          remaining -= 1;
          if (remaining <= 0) resolvePromise();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      const telemetry = host.frameTelemetry();
      return {
        ticks,
        renderFrameCalls: runtimeState.renderFrameCalls,
        framesObserved: telemetry.framesObserved,
        framesRendered: telemetry.framesRendered
      };
    }
  };
};

async function waitForArrival(page, destinationId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const app = window.__ATLAS_APP__;
      if (!app) return { app: false };
      const inventory = app.host.debugInventory();
      return {
        app: true,
        selection: app.host.state.atlas.activeDestination,
        active: inventory.activeDestinationId,
        transition: app.host.state.atlas.transition,
        pendingPrepares: inventory.pendingPrepares,
        rendererGeneration: inventory.rendererGeneration,
        hidden: document.hidden,
        visibility: document.visibilityState,
        rafTicks: window.__scenarios?.rafTicks ?? null,
        frameTelemetry: app.host.frameTelemetry()
      };
    });
    if (last.app && last.active === destinationId && last.transition.active === false) return;
    await page.waitForTimeout(250);
  }
  throw new Error(
    'arrival timeout waiting for ' + destinationId + ': last=' + JSON.stringify(last)
  );
}

async function installHelpers(page) {
  await page.evaluate(INSTALL_HELPERS);
}

async function readBackend(page) {
  return page.evaluate(() => {
    const inventory = window.__ATLAS_APP__.host.debugInventory();
    const canvas = document.getElementById('scene');
    const uaEdge = navigator.userAgent.match(/Edg\/([\d.]+)/);
    const uaChrome = navigator.userAgent.match(/Chrome\/([\d.]+)/);
    return {
      api: inventory.backend ? inventory.backend.api : null,
      adapterName: inventory.backend ? inventory.backend.adapterName : null,
      timestampQuery: inventory.backend ? inventory.backend.timestampQuery : false,
      internal: canvas === null ? null : [canvas.width, canvas.height],
      devicePixelRatio: window.devicePixelRatio,
      browserVersion: uaEdge ? uaEdge[1] : uaChrome ? uaChrome[1] : 'unknown'
    };
  });
}

/** Cold + warm + scenario record for one destination on one backend. */
async function measureDestination(browser, destination, backend, port) {
  const suffix = `?backend=${backend}`;
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const consoleErrors = [];
  const suppressedConsoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/powerPreference|readback|Failed to load resource/.test(text)) {
      suppressedConsoleErrors.push(text.slice(0, 120));
      return;
    }
    consoleErrors.push(text.slice(0, 200));
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error).slice(0, 400));
  });

  const record = {
    destination,
    backend,
    forcedBackend: backend,
    coldMs: null,
    warmMs: null,
    cold: null,
    warm: null,
    stationaryIdle: null,
    stationaryCost: null,
    activeTimeline: null,
    cameraInteraction: null,
    settling: null,
    transitionOut: null,
    transitionIn: null,
    tierLadder: {},
    backendInfo: null,
    consoleErrors: 0,
    suppressedConsoleErrors: 0,
    consoleErrorSamples: [],
    pageErrors: [],
    refusal: null
  };

  try {
    // ---- cold navigation ----------------------------------------------------
    const coldStart = Date.now();
    await page.goto(`http://127.0.0.1:${port}/atlas/${destination}${suffix}`);
    await waitForArrival(page, destination);
    record.coldMs = Date.now() - coldStart;
    record.backendInfo = await readBackend(page);
    await installHelpers(page);
    record.cold = await page.evaluate(() => {
      const inventory = window.__ATLAS_APP__.host.debugInventory();
      return {
        internal: inventory.runtime?.size ?? null,
        transition: inventory.runtime?.transition ?? null,
        renderTelemetry: window.__ATLAS_APP__.host.frameTelemetry()
      };
    });

    // A reference destination for the warm round trip; never the same id.
    const reference = destination === 'black-hole' ? 'neutron-star' : 'black-hole';

    // ---- stationary (paused + settled) -------------------------------------
    await page.evaluate(() => {
      const host = window.__ATLAS_APP__.host;
      host.time.pause();
      host.time.scrubTo(0.5);
    });
    await page.evaluate(() => window.__scenarios.installCounter());
    await page.evaluate(() => window.__scenarios.settle(900));

    record.stationaryIdle = await page.evaluate(async (ticks) => {
      const idle = await window.__scenarios.idle(ticks);
      return idle;
    }, IDLE_TICKS);
    // A paused, settled scene must not issue orchestrated frames; this is the
    // WS1 product, not a failure.
    if (record.stationaryIdle.renderFrameCalls !== 0) {
      record.refusal = `stationary idle issued ${record.stationaryIdle.renderFrameCalls} orchestrated frames`;
    }

    // ---- stationary cost (forced continuous render) ------------------------
    record.stationaryCost = await page.evaluate(async (frameCount) => {
      const host = window.__ATLAS_APP__.host;
      host.forceContinuousRenderForTest(true);
      const result = await window.__scenarios.sample(frameCount);
      host.forceContinuousRenderForTest(false);
      return result;
    }, frames);
    if (record.stationaryCost.renderTelemetry.framesRendered === 0) {
      record.refusal = 'stationary cost window rendered 0 frames';
    }

    // ---- active timeline ---------------------------------------------------
    await page.evaluate(() => window.__ATLAS_APP__.host.time.play());
    await page.waitForTimeout(Math.min(1000, warmupMs));
    record.activeTimeline = await page.evaluate(
      (frameCount) => window.__scenarios.sample(frameCount),
      frames
    );
    if (record.activeTimeline.renderTelemetry.framesRendered === 0) {
      record.refusal = 'active timeline window rendered 0 frames';
    }

    // ---- camera interaction + settling ------------------------------------
    record.cameraInteraction = await page.evaluate(
      async ({ frameCount }) => {
        const rig = window.__ATLAS_APP__.host.cameraRig;
        const orbit = rig.getOrbit();
        let index = 0;
        return window.__scenarios.sample(frameCount, () => {
          index += 1;
          rig.setOrbit(
            orbit.azimuthDeg + index * 0.6,
            orbit.polarDeg + Math.sin(index * 0.05) * 2,
            orbit.distance * (1 + Math.sin(index * 0.03) * 0.02),
            'user'
          );
        });
      },
      { frameCount: Math.min(frames, 90) }
    );
    if (record.cameraInteraction.renderTelemetry.framesRendered === 0) {
      record.refusal = 'camera interaction window rendered 0 frames';
    }
    // Settling is measured from a paused transport: a playing timeline keeps
    // TIME_ADVANCED dirty forever by design, so it can never be "settled".
    await page.evaluate(() => window.__ATLAS_APP__.host.time.pause());
    record.settling = await page.evaluate(() => window.__scenarios.settle(900));

    // ---- transition out + back (warm) -------------------------------------
    const outStart = Date.now();
    await page.evaluate((target) => {
      window.__ATLAS_APP__.navigate(target);
    }, reference);
    await waitForArrival(page, reference);
    record.transitionOut = { arrivalMs: Date.now() - outStart };
    await installHelpers(page);

    const inStart = Date.now();
    await page.evaluate((target) => {
      window.__ATLAS_APP__.navigate(target);
    }, destination);
    await waitForArrival(page, destination);
    record.warmMs = Date.now() - inStart;
    record.transitionIn = await page.evaluate(() => {
      const inventory = window.__ATLAS_APP__.host.debugInventory();
      return {
        transition: inventory.runtime?.transition ?? null,
        internal: inventory.runtime?.size ?? null
      };
    });
    record.warm = await page.evaluate(() => {
      const telemetry = window.__ATLAS_APP__.host.frameTelemetry();
      return { framesObserved: telemetry.framesObserved, framesRendered: telemetry.framesRendered };
    });

    // ---- tier ladder (stationary cost per tier) ----------------------------
    for (const tier of ['low', 'medium', 'high', 'ultra']) {
      await page.evaluate(
        ({ requestedTier }) => {
          const host = window.__ATLAS_APP__.host;
          host.time.pause();
          host.time.scrubTo(0.5);
          host.governor.setForcedTier(requestedTier);
        },
        { requestedTier: tier }
      );
      await page.waitForTimeout(warmupMs);
      record.tierLadder[tier] = await page.evaluate(
        async (frameCount) => {
          const host = window.__ATLAS_APP__.host;
          host.forceContinuousRenderForTest(true);
          const result = await window.__scenarios.sample(frameCount);
          host.forceContinuousRenderForTest(false);
          return result;
        },
        Math.min(frames, 90)
      );
      if (record.tierLadder[tier].renderTelemetry.framesRendered === 0) {
        record.refusal = `tier ${tier} window rendered 0 frames`;
      }
    }

    record.backendInfo = await readBackend(page);
  } catch (error) {
    record.refusal = record.refusal ?? (error instanceof Error ? error.message : String(error));
  } finally {
    record.consoleErrors = consoleErrors.length;
    record.suppressedConsoleErrors = suppressedConsoleErrors.length;
    record.consoleErrorSamples = consoleErrors.slice(0, 5);
    record.pageErrors = pageErrors.slice(0, 5);
    await context.close();
  }

  return record;
}

const server = await preview({ preview: { port: startPort, host: '127.0.0.1' } });
const browser = await chromium.launch({
  headless: !headed,
  ...(channel === 'chromium' ? {} : { channel })
});
const browserName = channel === 'chromium' ? 'chromium' : channel;

const records = [];
const failures = [];
const port = startPort;
for (const backend of backends) {
  for (const destination of destinations) {
    console.log(`SCENARIO ${backend} ${destination}`);
    const record = await measureDestination(browser, destination, backend, port);
    if (record.refusal !== null) {
      failures.push({ backend, destination, error: record.refusal });
      console.error(`[scenarios] REFUSING ${backend}/${destination}: ${record.refusal}`);
    }
    if (record.consoleErrors > 0) {
      failures.push({
        backend,
        destination,
        error: `consoleErrors=${record.consoleErrors}`,
        samples: record.consoleErrorSamples
      });
    }
    records.push(record);
  }
}

await browser.close();
await server.close();

const manifest = {
  schemaVersion: 2,
  kind: 'whole-atlas-scenario-matrix',
  commit,
  capturedAt: new Date().toISOString(),
  node: process.version,
  os: `${os.type()} ${os.release()} (${process.platform})`,
  browser: { name: browserName, headed },
  viewportCss: [width, height],
  devicePixelRatio: records[0]?.backendInfo?.devicePixelRatio ?? null,
  backends,
  destinations,
  sampleFrames: frames,
  warmupMs,
  quiescentFrames: QUIESCENT_FRAMES,
  idleTicks: IDLE_TICKS,
  records,
  failures
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(manifest, null, 1));
console.log(
  JSON.stringify(
    {
      outPath,
      commit,
      records: records.length,
      failures: failures.length,
      backend: browserName,
      headed
    },
    null,
    1
  )
);

if (failures.length > 0) {
  console.error(JSON.stringify({ failures }, null, 1));
  process.exitCode = 1;
}
