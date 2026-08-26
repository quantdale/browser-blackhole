/**
 * M11 — moving-observer photon INITIAL CONDITIONS (binary64 CPU reference).
 *
 * Mirrors the corrected GPU initialization in schwarzschildIntegrator /
 * lut/lensingGpu exactly (M11 defect fix: the first M10 GPU implementation
 * derived moving-observer constants from static-emitter DIRECTION formulas,
 * which drop u's spatial drift and mis-derive L — moving modes rendered an
 * empty sky).
 *
 * Physics (OBSERVER_FRAME_ADR §5): pixel direction n (observer rest frame,
 * |n| = 1) builds the contravariant BL photon momentum
 *
 *   k^mu = u^mu + sum_a n_a A_a^mu          (null by tetrad construction)
 *
 * Schwarzschild plane-solver constants (E-normalized, affine-invariant):
 *
 *   E   = -k_t = f(r0) k^t                  (g_tphi = 0)
 *   k_r = g_rr k^r = k^r / f(r0)
 *   pr  = k_r / E
 *   L   = r0 * |world tangential spatial rate|
 *   b   = L / E
 *
 * The world tangential rate is measured on the UNNORMALIZED world embedding
 * of k's spatial part (the spherical->cartesian map is linear, so the world
 * direction is Wu + sum(n_a W_a)); e1 is aligned with it, making the in-plane
 * b non-negative while planeNormal carries the axial sign.
 *
 * Kerr constants (raw Hamiltonian normalization, mirrors kerrIntegrator):
 *
 *   E   = f_s k^t - g_tphi k^phi
 *   L_z = g_tphi k^t + g_phiphi k^phi
 *   p_r = (Sigma/Delta) k^r
 *   p_theta = Sigma k^theta
 */

import type { CoordinateFourVector } from './types.js';
import { metricInner, type MetricContext } from './metric.js';
import { coordinateVectorToWorldDirection } from './tetrad.js';
import { rk4PlaneStep, stepSizeAt } from '../cpuReference.js';
import type { PhotonIntegrationOptions } from '../cpuReference.js';
import type { SnapshotWithUniforms } from './snapshot.js';

/** Unit local-frame pixel direction (right, up, forward components). */
export type LocalDirection = readonly [number, number, number];

function component(
  snap: SnapshotWithUniforms,
  leg: 0 | 1 | 2,
  index: 't' | 'r' | 'th' | 'ph'
): number {
  const source = leg === 0 ? snap.legA1 : leg === 1 ? snap.legA2 : snap.legA3;
  return index === 't'
    ? source[0]
    : index === 'r'
      ? source[1]
      : index === 'th'
        ? source[2]
        : source[3];
}

/**
 * Contravariant BL photon momentum for a pixel direction. Returns null when
 * the snapshot is inactive or any component is non-finite.
 */
export function movingPhotonMomentum(
  snap: SnapshotWithUniforms,
  n: LocalDirection
): CoordinateFourVector | null {
  if (snap.observerActive !== 1) return null;
  const [nx, ny, nz] = n;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 0)) return null;
  const ux = nx / len;
  const uy = ny / len;
  const uz = nz / len;
  const k: CoordinateFourVector = {
    t:
      snap.legU[0] +
      ux * component(snap, 0, 't') +
      uy * component(snap, 1, 't') +
      uz * component(snap, 2, 't'),
    r:
      snap.legU[1] +
      ux * component(snap, 0, 'r') +
      uy * component(snap, 1, 'r') +
      uz * component(snap, 2, 'r'),
    th:
      snap.legU[2] +
      ux * component(snap, 0, 'th') +
      uy * component(snap, 1, 'th') +
      uz * component(snap, 2, 'th'),
    ph:
      snap.legU[3] +
      ux * component(snap, 0, 'ph') +
      uy * component(snap, 1, 'ph') +
      uz * component(snap, 2, 'ph')
  };
  if (![k.t, k.r, k.th, k.ph].every(Number.isFinite)) return null;
  return k;
}

/** World cartesian spatial direction of a contravariant spatial triple. */
export function worldSpatialDirection(
  spatial: { r: number; th: number; ph: number },
  ctx: MetricContext
): [number, number, number] {
  return coordinateVectorToWorldDirection(
    { t: 0, r: spatial.r, th: spatial.th, ph: spatial.ph },
    ctx
  );
}

export interface MovingPlaneInit {
  /** Conserved energy E = -k_t (comoving normalization: -k.u = 1). */
  readonly energy: number;
  /** E-normalized covariant radial momentum k_r / E. */
  readonly pr0: number;
  /** E-normalized in-plane impact parameter L / E (non-negative in basis). */
  readonly b: number;
  /** Unit WORLD direction of k's spatial part (plane geometry input). */
  readonly worldDirection: readonly [number, number, number];
}

/**
 * Corrected Schwarzschild moving-observer plane-solver init. Returns null for
 * non-positive-energy photons (no stationary image — the GPU gates these out
 * identically via observerValidGate).
 */
export function schwarzschildMovingPlaneInit(
  snap: SnapshotWithUniforms,
  n: LocalDirection,
  massRg = 1
): MovingPlaneInit | null {
  const k = movingPhotonMomentum(snap, n);
  if (!k) return null;
  const r0 = snap.snapshot.radiusRg;
  const f0 = 1 - (2 * massRg) / r0;
  if (!(f0 > 0)) return null;
  const energy = f0 * k.t;
  if (!(energy > 1e-12)) return null;
  const ctx: MetricContext = {
    metric: 'schwarzschild',
    effectiveSpin: 0,
    r: r0,
    theta: snap.snapshot.thetaRad,
    phiWorldRad: snap.snapshot.phiWorldRad
  };
  const kWorld = worldSpatialDirection(k, ctx);
  // Radial/tangential split against e0 (unit world radial direction):
  const posWorld: [number, number, number] = [
    r0 * Math.sin(ctx.theta) * Math.cos(ctx.phiWorldRad),
    r0 * Math.cos(ctx.theta),
    r0 * Math.sin(ctx.theta) * Math.sin(ctx.phiWorldRad)
  ];
  const e0: [number, number, number] = [posWorld[0] / r0, posWorld[1] / r0, posWorld[2] / r0];
  const dotKW = kWorld[0] * e0[0] + kWorld[1] * e0[1] + kWorld[2] * e0[2];
  const tangentialRate = Math.hypot(
    kWorld[0] - e0[0] * dotKW,
    kWorld[1] - e0[1] * dotKW,
    kWorld[2] - e0[2] * dotKW
  );
  const worldLen = Math.hypot(kWorld[0], kWorld[1], kWorld[2]);
  if (!(worldLen > 0)) return null;
  return {
    energy,
    pr0: k.r / (f0 * energy),
    b: (r0 * tangentialRate) / energy,
    worldDirection: [kWorld[0] / worldLen, kWorld[1] / worldLen, kWorld[2] / worldLen]
  };
}

export interface MovingTraceResult {
  readonly status: 'escaped' | 'captured' | 'max-steps';
  /** Terminal STATIC-observer local direction in WORLD axes (legacy convention). */
  readonly terminalDirection: readonly [number, number, number] | null;
  readonly steps: number;
}

/**
 * Plane trace with INJECTED conserved quantities (pr0, b) — the binary64
 * mirror of what the corrected GPU feeds its integrators for a moving
 * observer. Reuses the validated cpuReference RHS/RK4/step policy.
 */
export function traceSchwarzschildPlane(
  r0: number,
  pr0: number,
  b: number,
  opts: Partial<PhotonIntegrationOptions> = {},
  massRg = 1
): MovingTraceResult {
  const o = {
    stepSize: 0.3,
    minStep: 0.001,
    maxStep: 100,
    escapeRadius: 1000,
    captureEpsilon: 0.01,
    maxSteps: 20000,
    pathStride: 0,
    massRg,
    ...opts
  };
  const captureRadius = 2 * massRg + o.captureEpsilon * massRg;
  let r = r0;
  let phi = 0;
  let pr = pr0;
  for (let steps = 1; steps <= o.maxSteps; steps += 1) {
    const h = stepSizeAt(r, o as PhotonIntegrationOptions);
    const next = rk4PlaneStep({ r, phi, pr }, h, massRg, b);
    r = next.r;
    phi = next.phi;
    pr = next.pr;
    if (!Number.isFinite(r) || !Number.isFinite(phi) || !Number.isFinite(pr)) {
      return { status: 'max-steps', terminalDirection: null, steps };
    }
    if (r <= captureRadius) {
      return { status: 'captured', terminalDirection: null, steps };
    }
    if (r > o.escapeRadius && pr > 0) {
      return {
        status: 'escaped',
        terminalDirection: terminalLocalDirection(r, phi, pr, b, massRg),
        steps
      };
    }
  }
  return { status: 'max-steps', terminalDirection: null, steps: o.maxSteps };
}

/** Terminal static-observer direction (inverse tetrad, cpuReference parity). */
function terminalLocalDirection(
  r: number,
  phi: number,
  pr: number,
  b: number,
  massRg: number
): [number, number, number] {
  const f = 1 - (2 * massRg) / r;
  const vr = f * pr;
  const vt = b / r;
  const norm = Math.sqrt((vr * vr) / f + vt * vt);
  if (!(norm > 0)) return [1, 0, 0];
  const nR = vr / (Math.sqrt(f) * norm);
  const nT = vt / norm;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  // Plane basis of the caller is embedded by the consumer; here expressed on
  // (e0, e1) with e0=x, e1=y of the canonical plane frame:
  const dx = nR * c - nT * s;
  const dy = nR * s + nT * c;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return [1, 0, 0];
  return [dx / len, dy / len, 0];
}

export interface KerrMovingConstants {
  readonly energy: number;
  readonly lZ: number;
  readonly pR: number;
  readonly pTheta: number;
  /** Raw null-Hamiltonian value 2H at the initial event (~0 for null k). */
  readonly nullResidual: number;
}

/**
 * Kerr conserved quantities of the pixel photon under the raw Hamiltonian
 * normalization used by kerrIntegrator/kerrRhs (mirrors its extraction).
 */
export function kerrMovingConstants(
  snap: SnapshotWithUniforms,
  n: LocalDirection,
  aStar: number,
  massRg = 1
): KerrMovingConstants | null {
  const k = movingPhotonMomentum(snap, n);
  if (!k) return null;
  const r = snap.snapshot.radiusRg;
  const st = Math.sin(snap.snapshot.thetaRad);
  const ct = Math.cos(snap.snapshot.thetaRad);
  const sigma = r * r + aStar * aStar * ct * ct;
  const delta = r * r - 2 * massRg * r + aStar * aStar;
  const s2 = st * st;
  const bigA = (r * r + aStar * aStar) ** 2 - aStar * aStar * delta * s2;
  const gTT = -(1 - (2 * massRg * r) / sigma);
  const gTPh = (-2 * massRg * aStar * r * s2) / sigma;
  const gPhPh = (bigA * s2) / sigma;
  const energy = -(gTT * k.t + gTPh * k.ph);
  const lZ = gTPh * k.t + gPhPh * k.ph;
  const pR = (sigma / delta) * k.r;
  const pTheta = sigma * k.th;
  // 2H with the raw (E, L_z, p_r, p_theta) normalization:
  const twoH =
    (-bigA * energy * energy) / (sigma * delta) +
    (4 * massRg * aStar * r * energy * lZ) / (sigma * delta) +
    ((delta - aStar * aStar * s2) * lZ * lZ) / (s2 * sigma * delta) +
    (delta * pR * pR) / sigma +
    (pTheta * pTheta) / sigma;
  return { energy, lZ, pR, pTheta, nullResidual: twoH };
}

/**
 * Null-constraint check g(k,k) for a pixel photon (tetrad construction must
 * yield exactly-null k to roundoff).
 */
export function photonNullResidual(
  snap: SnapshotWithUniforms,
  n: LocalDirection,
  ctx: MetricContext
): number | null {
  const k = movingPhotonMomentum(snap, n);
  if (!k) return null;
  return metricInner(ctx, k, k);
}
