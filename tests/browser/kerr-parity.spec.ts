import { expect, test, type Page } from '@playwright/test';
import { integrateKerrPhoton, type Vec3 } from '../../src/phenomena/black-hole/kerr/reference.js';
// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import {
  ARRIVAL_TIMEOUT_MS,
  collectErrors,
  sampleColorsAtNdc,
  type NdcPoint
} from './support/appHarness.js';

/**
 * M9-09 / BH-205 — Kerr selected-ray GPU/reference parity corpus
 * (docs/TESTING.md §5 pattern extended to the Kerr backend).
 *
 * The black-hole destination's `debug-parity` preset renders the dedicated
 * encoding for whichever strong-field pass is active:
 *
 *   ESCAPED  -> rgb = finalDirection * 0.5 + 0.5   (LINEAR space)
 *   CAPTURED -> pure black
 *   failure  -> NUMERICAL_FAILURE magenta
 *
 * This suite pins metric = 'kerr' through the CANONICAL control channel
 * (host.setDestinationControl) and asserts the debug snapshot proves the
 * Kerr backend actually executed (activePassKind 'kerr', effective backend
 * 'numerical-kerr') so a silent fallback to Schwarzschild can never make a
 * row pass vacuously. Selected rays are compared against the binary64
 * reference integrateKerrPhoton under the SAME termination policy as the
 * GPU pass (escape radius 32 r_g, capture epsilon 0.01 M).
 */

const ESCAPE_RADIUS_RG = 32;
const CAPTURE_EPSILON_M = 0.01;
const PARITY_SPIN = 0.9;
/**
 * Per-channel tolerance on recovered LINEAR direction components — identical
 * budget rationale to the Schwarzschild corpus (8-bit quantization + f32/f64
 * drift over <= 32 r_g + half-float HDR intermediates).
 */
const DIRECTION_TOLERANCE = 0.06;
/** Captured rays must present near-black through any monotonic display chain. */
const BLACK_CHANNEL_MAX = 24;

function decodeSrgbChannel(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

interface CameraBasis {
  position: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
  tanHalfFovY: number;
  aspect: number;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function ndcForDir(basis: CameraBasis, d: Vec3): NdcPoint {
  const df = dot(d, basis.forward);
  return {
    x: dot(d, basis.right) / df / (basis.tanHalfFovY * basis.aspect),
    y: dot(d, basis.up) / df / basis.tanHalfFovY
  };
}

function impactParameter(pos: Vec3, dir: Vec3): number {
  const c: Vec3 = [
    pos[1] * dir[2] - pos[2] * dir[1],
    pos[2] * dir[0] - pos[0] * dir[2],
    pos[0] * dir[1] - pos[1] * dir[0]
  ];
  return norm(c);
}

/** Bisection: screen-plane angle a so that ray P->dir(a) has flat-chord b. */
function angleForImpact(pos: Vec3, forward: Vec3, axis: Vec3, bTarget: number): number {
  let lo = 1e-6;
  let hi = 1.35;
  const bOf = (ang: number): number => {
    const d = add(scale(forward, Math.cos(ang)), scale(axis, Math.sin(ang)));
    const n = norm(d);
    return impactParameter(pos, [d[0] / n, d[1] / n, d[2] / n]);
  };
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (bOf(mid) < bTarget) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

async function readCameraBasis(page: Page): Promise<CameraBasis> {
  const raw = await page.evaluate(() => {
    const c = window.__ATLAS_APP__!.host.camera;
    c.updateMatrixWorld();
    const e = c.matrixWorld.elements;
    return {
      position: { x: c.position.x, y: c.position.y, z: c.position.z },
      elements: Array.from(e),
      fovDeg: c.fov,
      aspect: c.aspect
    };
  });
  const normalizeRow = (i: number): Vec3 => {
    const v: Vec3 = [raw.elements[i] ?? 0, raw.elements[i + 1] ?? 0, raw.elements[i + 2] ?? 0];
    const n = norm(v);
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  const right = normalizeRow(0);
  const up = normalizeRow(4);
  const fwdRaw = normalizeRow(8);
  const forward: Vec3 = [-fwdRaw[0], -fwdRaw[1], -fwdRaw[2]];
  return {
    position: [raw.position.x, raw.position.y, raw.position.z],
    right,
    up,
    forward,
    tanHalfFovY: Math.tan((raw.fovDeg * Math.PI) / 360),
    aspect: raw.aspect > 0 ? raw.aspect : 1
  };
}

async function waitForCameraSettled(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const a = await page.evaluate(() => ({
          ...window.__ATLAS_APP__!.host.camera.position
        }));
        await page.waitForTimeout(250);
        const b = await page.evaluate(() => ({
          ...window.__ATLAS_APP__!.host.camera.position
        }));
        return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      },
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [500] }
    )
    .toBeLessThan(1e-4);
}

async function runKerrCorpus(page: Page, backend: string): Promise<void> {
  const errors = collectErrors(page);

  await page.goto(`/atlas/black-hole?preset=debug-parity&backend=${backend}`);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return app.host.state.atlas.activeDestination === 'black-hole' &&
            app.host.state.atlas.activePreset === 'debug-parity'
            ? 'arrived'
            : 'waiting';
        }),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');

  // Pin Kerr THROUGH THE CANONICAL CONTROL CHANNEL (never uniforms directly).
  await page.evaluate((spin) => {
    window.__ATLAS_APP__!.host.setDestinationControl('black-hole', {
      metric: 'kerr',
      spin
    });
  }, PARITY_SPIN);
  expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();

  // NON-VACUOUS EXECUTION PROOF: the snapshot must report the Kerr pass.
  const snap = await page.evaluate(() =>
    window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot()
  );
  expect(snap?.['metric'], 'metric recorded').toBe('kerr');
  expect(snap?.['activePassKind'], 'kerr pass selected').toBe('kerr');
  expect(snap?.['trajectoryBackendEffective'], 'effective backend truth').toBe('numerical-kerr');
  expect(snap?.['effectiveSpin'], 'spin applied').toBe(PARITY_SPIN);

  // Deterministic display chain: identity-ish post so presented pixels are
  // sRGB(linear) and direction components decode numerically.
  await page.evaluate(() => {
    const post = window.__ATLAS_APP__!.host.post;
    post.setBloom(false, 0);
    post.setExposure(1);
    post.setToneMapping('linear');
  });
  await waitForCameraSettled(page);
  const basis = await readCameraBasis(page);

  // --- corpus selection ---------------------------------------------------
  // Impact parameters bracketing the a*=+0.9 corotating critical offset
  // (~2.6-3M) along THREE screen axes; escaped-side offsets stay >= ~1.5x
  // critical. Rows are kept only when the ORACLE certifies good conditioning:
  // clear of coordinate-pole passages (min|sin(theta)| >= 0.06) and of heavy
  // winding — the two regimes where f32 cannot meet the shared tolerance
  // budget (docs/KERR_BACKEND_ADR.md §1.19, docs/NUMERICAL_METHODS §11).
  const offsets = [1.6, 2.2, 3.4, 4.6];
  const diag: Vec3 = [
    (basis.right[0] + basis.up[0]) / Math.SQRT2,
    (basis.right[1] + basis.up[1]) / Math.SQRT2,
    (basis.right[2] + basis.up[2]) / Math.SQRT2
  ];
  // NOTE: screen-RIGHT offsets from this camera give BL L_z < 0 (retrograde
  // under the locked azimuth convention); screen-LEFT gives the corotating
  // (prograde-relative-to-positive-spin) family the corpus targets.
  const left: Vec3 = [-basis.right[0], -basis.right[1], -basis.right[2]];
  const axes: Array<{ axis: Vec3; name: string }> = [
    { axis: left, name: 'corotating' },
    { axis: basis.up, name: 'screen-y' },
    { axis: diag, name: 'diag' }
  ];
  interface CorpusRay {
    label: string;
    ndc: NdcPoint;
    cpuClass: string;
    cpuDir: Vec3;
  }
  const rays: CorpusRay[] = [];
  for (const { axis, name } of axes) {
    for (const b of offsets) {
      const alpha = angleForImpact(basis.position, basis.forward, axis, b);
      const d = add(scale(basis.forward, Math.cos(alpha)), scale(axis, Math.sin(alpha)));
      const dn = norm(d);
      const dir: Vec3 = [d[0] / dn, d[1] / dn, d[2] / dn];
      const ndc = ndcForDir(basis, dir);
      if (Math.abs(ndc.x) > 0.9 || Math.abs(ndc.y) > 0.9) continue; // off-viewport
      const result = integrateKerrPhoton(basis.position, dir, {
        aStar: PARITY_SPIN,
        escapeRadiusRg: ESCAPE_RADIUS_RG,
        captureEpsilon: CAPTURE_EPSILON_M,
        maxSteps: 250_000
      });
      if (result.classification === 'numerical-failure') continue; // never assert budget rows
      // Conditioning filter (ADR §1.19): keep only rays the oracle certifies
      // stayed clear of BOTH the critical boundary regime and coordinate-pole
      // passages — the regimes where f32 cannot meet the shared budget.
      if ((result.minSinTheta ?? 1) < 0.06) continue;
      if (
        result.outcome.kind === 'escaped' &&
        result.turnCounts.radial + result.turnCounts.angular > 6
      ) {
        continue; // heavy-winding rows have logarithmically amplified drift
      }
      const expectedClass =
        result.outcome.kind === 'captured'
          ? 'captured'
          : result.outcome.kind === 'escaped'
            ? 'escaped'
            : 'numerical-failure';
      expect(expectedClass, `${name} b=${b}: CPU outcome`).not.toBe('numerical-failure');
      rays.push({
        label: `${name}-b${b}`,
        ndc,
        cpuClass: expectedClass,
        cpuDir: result.finalDirection ?? [0, 0, 0]
      });
    }
  }
  expect(rays.length, 'corpus must retain enough in-viewport rays').toBeGreaterThanOrEqual(5);
  expect(rays.some((r) => r.cpuClass === 'captured')).toBe(true);
  expect(rays.some((r) => r.cpuClass === 'escaped')).toBe(true);

  // --- presented-frame evidence --------------------------------------------
  const samples = await sampleColorsAtNdc(
    page,
    rays.map((r) => r.ndc)
  );
  expect(samples.length).toBe(rays.length);

  let magentaish = 0;
  for (let i = 0; i < rays.length; i += 1) {
    const ray = rays[i]!;
    const px = samples[i]!;
    const channels = [px.r, px.g, px.b];

    if (ray.cpuClass === 'captured') {
      for (const c of channels) {
        expect(c, `${ray.label}: captured ray must present near-black`).toBeLessThanOrEqual(
          BLACK_CHANNEL_MAX
        );
      }
      continue;
    }

    if (px.r > 40 && px.g < px.r - 15 && Math.abs(px.b - px.r) < 25) {
      magentaish += 1;
    }
    const recovered: Vec3 = [
      decodeSrgbChannel(px.r) * 2 - 1,
      decodeSrgbChannel(px.g) * 2 - 1,
      decodeSrgbChannel(px.b) * 2 - 1
    ];
    for (let c = 0; c < 3; c += 1) {
      const delta = Math.abs((recovered[c] as number) - (ray.cpuDir[c] as number));
      expect(
        delta,
        `${ray.label}: direction[${'xyz'[c]}] gpu=${(recovered[c] as number).toFixed(4)} ` +
          `cpu=${(ray.cpuDir[c] as number).toFixed(4)}`
      ).toBeLessThan(DIRECTION_TOLERANCE);
    }
  }
  expect(magentaish, 'no failure-colored pixels expected in the corpus').toBe(0);
  const realErrors = [
    ...errors.consoleErrors.filter(
      (t) => !/powerPreference|readback|Failed to load resource/.test(t)
    ),
    ...errors.pageErrors
  ];
  expect(realErrors, `${backend}: console/page errors must stay clean`).toEqual([]);
}

test.describe('Kerr integrator CPU/GPU parity corpus', () => {
  for (const backend of ['webgpu', 'webgl2'] as const) {
    test(`selected rays agree with the binary64 Kerr reference (${backend})`, async ({ page }) => {
      test.setTimeout(process.env.CI ? 600_000 : 180_000);
      await runKerrCorpus(page, backend);
    });
  }
});
