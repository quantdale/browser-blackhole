/**
 * M11 — moving-observer photon initial conditions (binary64 reference layer).
 *
 * Gates tested here (mirrors of the corrected GPU init in
 * schwarzschildIntegrator / lut/lensingGpu / kerrIntegrator):
 * - NULL: g(k,k) = 0 for every mode/pixel sample (Schwarzschild + Kerr);
 * - STATIC EQUIVALENCE: the covariant init reduces EXACTLY to the validated
 *   legacy static-tetrad formulas (pr = n_r/f, b = r0 n_t/sqrt(f)) for a
 *   static observer — the compatibility anchor for the camera/static path;
 * - ANGULAR-MOMENTUM IDENTITY: b matches r0^2 sqrt(k_th^2 + sin^2 th k_ph^2)/E;
 * - KERR: raw-Hamiltonian constants reproduce the GPU extraction with ~zero
 *   null residual and correct prograde/retrograde structure;
 * - TRACE: injected-constant plane traces are deterministic and classify
 *   plausibly (center-forward tangential rays escape; b < 3 sqrt(3) captures).
 */

import { describe, expect, it } from 'vitest';

import { metricInner, type MetricContext } from '../../src/phenomena/black-hole/observer/metric.js';
import { buildObserverFrameSnapshot } from '../../src/phenomena/black-hole/observer/snapshot.js';
import {
  kerrMovingConstants,
  movingPhotonMomentum,
  schwarzschildMovingPlaneInit,
  traceSchwarzschildPlane
} from '../../src/phenomena/black-hole/observer/photonInit.js';
import type { CameraAxisDirections } from '../../src/phenomena/black-hole/observer/tetrad.js';

function sub3(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize3(v: readonly [number, number, number]): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Camera axes looking from `position` toward the origin (+Y-ish up). */
function axesLookingAt(position: readonly [number, number, number]): CameraAxisDirections {
  const forward = normalize3(sub3([0, 0, 0], position));
  const right = normalize3(cross3(forward, Math.abs(forward[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]));
  const up = cross3(right, forward);
  return { right, up, forward };
}

const PIXELS: readonly [number, number][] = [
  [0, 0],
  [0.35, 0],
  [-0.35, 0],
  [0, 0.25],
  [0, -0.25],
  [0.5, 0.3],
  [-0.5, -0.3]
];

/** Pixel-local frame components (right/up/forward weights), GPU convention. */
function localPixelDirs(tanHalf: number): [number, number, number][] {
  return PIXELS.map(([x, y]) => {
    const nx = x * tanHalf;
    const ny = y * tanHalf;
    const len = Math.hypot(nx, ny, 1);
    return [nx / len, ny / len, 1 / len];
  });
}

/** World unit direction for a pixel-local component triple. */
function worldDirOfLocal(
  axes: CameraAxisDirections,
  n: readonly [number, number, number]
): [number, number, number] {
  return normalize3([
    axes.right[0] * n[0] + axes.up[0] * n[1] + axes.forward[0] * n[2],
    axes.right[1] * n[0] + axes.up[1] * n[1] + axes.forward[1] * n[2],
    axes.right[2] * n[0] + axes.up[2] * n[1] + axes.forward[2] * n[2]
  ]);
}

describe('M11 moving-observer photon init', () => {
  it('photon momentum is null for every sampled pixel (circular, Schwarzschild)', () => {
    const pos: [number, number, number] = [0, 0.5, 13.5];
    const axes = axesLookingAt(pos);
    const snap = buildObserverFrameSnapshot({
      mode: 'circular',
      metricId: 'schwarzschild',
      effectiveSpin: 0,
      properTimeTau: 0,
      cameraPositionWorld: pos,
      cameraAxes: axes,
      circularRadiusRg: 12,
      circularSense: 1,
      circularPhi0Rad: 0,
      geodesicWorldline: null,
      seedFailureReason: null
    });
    expect(snap.snapshot.valid).toBe(true);
    const ctx: MetricContext = {
      metric: 'schwarzschild',
      effectiveSpin: 0,
      r: snap.snapshot.radiusRg,
      theta: snap.snapshot.thetaRad,
      phiWorldRad: snap.snapshot.phiWorldRad
    };
    for (const n of localPixelDirs(Math.tan((30 * Math.PI) / 180))) {
      const k = movingPhotonMomentum(snap, n)!;
      const residual = metricInner(ctx, k, k);
      expect(Math.abs(residual)).toBeLessThan(1e-9);
    }
  });

  it('covariant init reduces EXACTLY to legacy static formulas for a static observer', () => {
    const pos: [number, number, number] = [0, 2.5, 16];
    const axes = axesLookingAt(pos);
    const snap = buildObserverFrameSnapshot({
      mode: 'static',
      metricId: 'schwarzschild',
      effectiveSpin: 0,
      properTimeTau: 0,
      cameraPositionWorld: pos,
      cameraAxes: axes,
      circularRadiusRg: 12,
      circularSense: 1,
      circularPhi0Rad: 0,
      geodesicWorldline: null,
      seedFailureReason: null
    });
    const r0 = snap.snapshot.radiusRg;
    const f0 = 1 - 2 / r0;
    // World radial direction at the static observer event:
    const pw = snap.snapshot.positionWorld;
    const e0: [number, number, number] = [pw[0] / r0, pw[1] / r0, pw[2] / r0];
    for (const n of localPixelDirs(Math.tan((30 * Math.PI) / 180))) {
      const init = schwarzschildMovingPlaneInit(snap, n)!;
      // Legacy: pr = n_r/f0, b = r0 * n_t/sqrt(f0) with n the world direction.
      const worldN = worldDirOfLocal(axes, n);
      const nRadial = worldN[0] * e0[0] + worldN[1] * e0[1] + worldN[2] * e0[2];
      const tVec: [number, number, number] = [
        worldN[0] - e0[0] * nRadial,
        worldN[1] - e0[1] * nRadial,
        worldN[2] - e0[2] * nRadial
      ];
      const nTangential = Math.hypot(tVec[0], tVec[1], tVec[2]);
      expect(init.pr0).toBeCloseTo(nRadial / f0, 12);
      expect(init.b).toBeCloseTo((r0 * nTangential) / Math.sqrt(f0), 12);
    }
  });

  it('in-plane b equals the covariant total angular momentum identity', () => {
    const pos: [number, number, number] = [0, 0.5, 13.5];
    const snap = buildObserverFrameSnapshot({
      mode: 'circular',
      metricId: 'schwarzschild',
      effectiveSpin: 0,
      properTimeTau: 0,
      cameraPositionWorld: pos,
      cameraAxes: axesLookingAt(pos),
      circularRadiusRg: 12,
      circularSense: 1,
      circularPhi0Rad: 0,
      geodesicWorldline: null,
      seedFailureReason: null
    });
    const r0 = snap.snapshot.radiusRg;
    const f0 = 1 - 2 / r0;
    for (const n of localPixelDirs(Math.tan((30 * Math.PI) / 180))) {
      const k = movingPhotonMomentum(snap, n)!;
      const init = schwarzschildMovingPlaneInit(snap, n)!;
      const lTotal = r0 * r0 * Math.sqrt(k.th * k.th + k.ph * k.ph);
      expect(init.b).toBeCloseTo(lTotal / (f0 * k.t), 12);
      expect(init.energy).toBeCloseTo(f0 * k.t, 12);
    }
  });

  it('Kerr constants are near-null and structurally correct (prograde circular)', () => {
    const pos: [number, number, number] = [0, 0.8, 9.5];
    const snap = buildObserverFrameSnapshot({
      mode: 'circular',
      metricId: 'kerr',
      effectiveSpin: 0.6,
      properTimeTau: 0,
      cameraPositionWorld: pos,
      cameraAxes: axesLookingAt(pos),
      circularRadiusRg: 8,
      circularSense: 1,
      circularPhi0Rad: 0,
      geodesicWorldline: null,
      seedFailureReason: null
    });
    expect(snap.snapshot.valid).toBe(true);
    let sawNegativeLz = false;
    for (const n of localPixelDirs(Math.tan((30 * Math.PI) / 180))) {
      const c = kerrMovingConstants(snap, n, 0.6)!;
      // Null residual relative to the largest metric term (~E^2 scale):
      expect(Math.abs(c.nullResidual)).toBeLessThan(1e-7);
      if (!(c.energy > 0)) throw new Error(`non-positive photon energy ${c.energy}`);
      if (c.lZ < 0) sawNegativeLz = true;
    }
    // Backward-traced photons from a prograde observer must span both axial
    // senses across the view (the sky wraps around the orbit plane).
    expect(sawNegativeLz).toBe(true);
  });

  it('injected-constant plane traces are deterministic and classify physically', () => {
    const pos: [number, number, number] = [0, 0.5, 13.5];
    const snap = buildObserverFrameSnapshot({
      mode: 'circular',
      metricId: 'schwarzschild',
      effectiveSpin: 0,
      properTimeTau: 0,
      cameraPositionWorld: pos,
      cameraAxes: axesLookingAt(pos),
      circularRadiusRg: 12,
      circularSense: 1,
      circularPhi0Rad: 0,
      geodesicWorldline: null,
      seedFailureReason: null
    });
    const center = schwarzschildMovingPlaneInit(snap, [0, 0, 1])!;
    const runA = traceSchwarzschildPlane(12, center.pr0, center.b);
    const runB = traceSchwarzschildPlane(12, center.pr0, center.b);
    expect(runA.status).toBe(runB.status);
    expect(runA.terminalDirection).toEqual(runB.terminalDirection);
    // Center-forward tangential ray carries b >> b_crit: escapes.
    expect(center.b).toBeGreaterThan(3 * Math.sqrt(3));
    expect(runA.status).toBe('escaped');
    expect(runA.terminalDirection).not.toBeNull();
    // A strongly subcritical impact parameter must capture:
    const capturedRun = traceSchwarzschildPlane(12, -0.5, 3);
    expect(capturedRun.status).toBe('captured');
  });
});
