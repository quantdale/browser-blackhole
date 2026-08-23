import { expect, test, type Page } from '@playwright/test';
import { integratePhoton } from '../../src/phenomena/black-hole/cpuReference.js';
// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import { collectErrors, sampleColorsAtNdc, type NdcPoint } from './support/appHarness.js';

/**
 * M2/Gate-C CPU-vs-GPU integrator parity corpus (docs/TESTING.md §5,
 * QUALITY_GATES Gate C "GPU selected rays agree within quantity-specific
 * f32 tolerances").
 *
 * The black-hole destination's `debug-parity` preset renders a dedicated
 * encoding instead of environment radiance:
 *
 *   ESCAPED  -> rgb = finalDirection * 0.5 + 0.5   (LINEAR space)
 *   CAPTURED -> pure black
 *   failure  -> NUMERICAL_FAILURE magenta
 *
 * With presentation forced to exposure 1 / bloom off / 'linear' tone mapping,
 * the displayed pixel is exactly sRGB-encode(linear), so sampled channels
 * decode back to linear values that are directly comparable against the
 * binary64 CPU oracle (cpuReference.integratePhoton) run with the SAME
 * termination policy as the GPU pass (escape radius 32 r_g, capture epsilon
 * 0.01 M). Tolerances below budget for: 8-bit output quantization, f32 vs
 * f64 trajectory drift over <= 32 r_g, and half-float HDR intermediate
 * storage; they would catch a wrong sign, swapped basis vector, inverted
 * falloff, or classification flip away from the critical boundary.
 *
 * M8 validation-debt closure: the corpus runs against BOTH trajectory
 * execution paths on BOTH renderer APIs. The ?trajectory= dev override pins
 * the execution path (precedence-1 policy, docs/LUT_BACKEND_SPEC §15); the
 * module debug snapshot is asserted so an ignored override can never make a
 * row vacuously pass.
 */

/** GPU escape radius driven by the destination (blackHoleDestination.ts). */
const ESCAPE_RADIUS_RG = 32;
/** GPU capture epsilon driven by the integrator default (units of M). */
const CAPTURE_EPSILON_M = 0.01;
/** Asymptotic critical impact parameter b_c = 3 sqrt(3) M (PHYSICS §2). */
const B_CRITICAL = 3 * Math.sqrt(3);
/**
 * Per-channel tolerance on recovered LINEAR direction components
 * (recovered = srgbDecode(pixel) * 2 - 1).
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

type Vec3 = [number, number, number];

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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

/** NDC point of a world direction (pixel-center exact inverse mapping). */
function ndcForDir(basis: CameraBasis, d: Vec3): NdcPoint {
  const df = dot(d, basis.forward);
  return {
    x: dot(d, basis.right) / df / (basis.tanHalfFovY * basis.aspect),
    y: dot(d, basis.up) / df / basis.tanHalfFovY
  };
}

/** Straight-line impact parameter |P x d| for the E-normalized plane mapping. */
function impactParameter(pos: Vec3, dir: Vec3): number {
  return norm(cross(pos, dir));
}

/** Bisection: screen-plane angle a so that ray P->dir(a) has impact bTarget. */
function angleForImpact(pos: Vec3, forward: Vec3, axis: Vec3, bTarget: number): number {
  let lo = 1e-6;
  let hi = 1.35;
  const bOf = (a: number): number => {
    const d = add(scale(forward, Math.cos(a)), scale(axis, Math.sin(a)));
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
  // Identical construction to cameraLensingState (blackHoleDestination.ts):
  // basis rows of matrixWorld; forward = -third row.
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

/** Waits until the arrival camera animation has fully settled. */
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
      { timeout: 20_000, intervals: [500] }
    )
    .toBeLessThan(1e-4);
}

/** One full corpus execution against one (api backend, trajectory path) pair. */
async function runParityCorpus(page: Page, backend: string, trajectory: string): Promise<void> {
  const errors = collectErrors(page);

  await page.goto(
    `/atlas/black-hole?preset=debug-parity&backend=${backend}&trajectory=${trajectory}`
  );
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
      { timeout: 30_000, intervals: [250] }
    )
    .toBe('arrived');

  // Guard against a silently ignored trajectory override: the debug snapshot
  // must report exactly the requested execution path after a rendered frame.
  expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
  const snap = await page.evaluate(() =>
    window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot()
  );
  expect(snap?.['trajectoryBackendRequested'], 'requested path recorded').toBe(trajectory);
  expect(snap?.['trajectoryBackendEffective'], 'requested path actually executed').toBe(
    trajectory === 'lut' ? 'lut' : 'numerical'
  );

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
  // Impact parameters bracketing b_c on both sides along two screen axes,
  // deliberately AWAY from the critical boundary (classification there is
  // step-budget sensitive by design); radial-in via the exact center ray.
  const ratios = [0.35, 0.7, 1.25, 2.0];
  const axes: Array<{ axis: Vec3; name: string }> = [
    { axis: basis.right, name: 'screen-x' },
    { axis: basis.up, name: 'screen-y' }
  ];
  interface CorpusRay {
    label: string;
    ndc: NdcPoint;
    cpuClass: string;
    cpuDir: Vec3;
  }
  const rays: CorpusRay[] = [];
  const centerDir: Vec3 = scale(basis.forward, -1); // camera looks at origin
  const centerNdc = ndcForDir(basis, centerDir);
  const centerCpu = integratePhoton(basis.position, centerDir, {
    escapeRadius: ESCAPE_RADIUS_RG,
    captureEpsilon: CAPTURE_EPSILON_M
  });
  if (
    Math.abs(centerNdc.x) < 0.9 &&
    Math.abs(centerNdc.y) < 0.9 &&
    centerCpu.status === 'captured'
  ) {
    rays.push({
      label: 'radial-center',
      ndc: centerNdc,
      cpuClass: 'captured',
      cpuDir: [0, 0, 0]
    });
  }
  for (const { axis, name } of axes) {
    for (const ratio of ratios) {
      const alpha = angleForImpact(basis.position, basis.forward, axis, ratio * B_CRITICAL);
      const d = add(scale(basis.forward, Math.cos(alpha)), scale(axis, Math.sin(alpha)));
      const dn = norm(d);
      const dir: Vec3 = [d[0] / dn, d[1] / dn, d[2] / dn];
      const ndc = ndcForDir(basis, dir);
      if (Math.abs(ndc.x) > 0.9 || Math.abs(ndc.y) > 0.9) continue; // off-viewport
      const result = integratePhoton(basis.position, dir, {
        escapeRadius: ESCAPE_RADIUS_RG,
        captureEpsilon: CAPTURE_EPSILON_M
      });
      if (result.status === 'max-steps') continue; // never assert budget artifacts
      const expected = ratio < 1 ? 'captured' : 'escaped';
      expect(
        result.status,
        `${name} b/b_c=${ratio}: CPU class must match analytic expectation`
      ).toBe(expected);
      rays.push({
        label: `${name}-b${ratio}`,
        ndc,
        cpuClass: result.status,
        cpuDir: result.finalDirection
      });
    }
  }
  expect(rays.length, 'corpus must retain enough in-viewport rays').toBeGreaterThanOrEqual(6);
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

    // Escaped: decode to linear and compare against the CPU terminal
    // direction component-by-component.
    if (px.r > 40 && px.g < px.r - 15 && Math.abs(px.b - px.r) < 25) {
      magentaish += 1;
    }
    const recovered: Vec3 = [
      decodeSrgbChannel(px.r) * 2 - 1,
      decodeSrgbChannel(px.g) * 2 - 1,
      decodeSrgbChannel(px.b) * 2 - 1
    ];
    for (let c = 0; c < 3; c += 1) {
      const delta = Math.abs(recovered[c]! - ray.cpuDir[c]!);
      expect(
        delta,
        `${ray.label}: direction[${'xyz'[c]}] gpu=${recovered[c]!.toFixed(4)} ` +
          `cpu=${ray.cpuDir[c]!.toFixed(4)}`
      ).toBeLessThan(DIRECTION_TOLERANCE);
    }
  }
  expect(magentaish, 'no failure-colored pixels expected in the corpus').toBe(0);
  // Known benign noise (context-creation preference hints, readback
  // warnings, resource 404s) is filtered exactly like the other suites.
  const realErrors = [
    ...errors.consoleErrors.filter(
      (t) => !/powerPreference|readback|Failed to load resource/.test(t)
    ),
    ...errors.pageErrors
  ];
  expect(realErrors, `${backend}/${trajectory}: console/page errors must stay clean`).toEqual([]);
}

test.describe('Schwarzschild integrator CPU/GPU parity corpus', () => {
  for (const backend of ['webgpu', 'webgl2'] as const) {
    for (const trajectory of ['numerical', 'lut'] as const) {
      test(`selected rays agree with the binary64 reference (${backend}, ${trajectory})`, async ({
        page
      }) => {
        test.setTimeout(120_000);
        await runParityCorpus(page, backend, trajectory);
      });
    }
  }
});
