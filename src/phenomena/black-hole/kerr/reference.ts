/**
 * Binary64 CPU reference solver for Kerr null geodesics (M9-02/BH-201).
 *
 * Spec sources (implemented exactly; do not drift without updating docs):
 * - docs/KERR_BACKEND_ADR.md — LOCKED conventions:
 *     §1.1  signature (-,+,+,+), geometric units M = 1, lengths in r_g
 *     §1.4  Boyer-Lindquist <-> world mapping (+Y symmetry axis; phi is the
 *           world azimuth measured from +X toward +Z)
 *     §1.6  backwards-ray momentum orientation; sign-invariant observables
 *     §1.8  static-observer tetrad initialization
 *     §1.10 first-order BL Hamiltonian over (r, theta, phi, p_r, p_theta)
 *           with fixed parameters E and L_z; classical RK4 baseline
 *     §1.12 capture policy (horizon band + coordinate-stall analog)
 *     §1.13 failure taxonomy (distinct reasons, never aliased to captured)
 *     §1.14 disk-plane crossing convention (curved-trajectory refinement)
 *     §1.15 conserved quantities/diagnostics (null residual, Carter Q)
 * - docs/NUMERICAL_METHODS.md §8.1/§9/§20 (RK4 baseline, step-policy shape,
 *   convergence protocol) and cpuReference.ts philosophy: clarity and
 *   diagnostic correctness outrank speed.
 *
 * Formulation notes:
 * - The null Hamiltonian H = 1/2 g^{mu nu} p_mu p_nu with p_t = -E,
 *   p_phi = L_z yields dr/dl = Delta p_r/Sigma, dtheta/dl = p_theta/Sigma;
 *   turning points are crossed smoothly by the momenta (no sign bookkeeping).
 * - Closed-form partial derivatives dH/dr, dH/dtheta are implemented in
 *   {@link kerrRhs} and VERIFIED against central finite differences of
 *   {@link kerrHamiltonian2} in tests/unit/kerrReference.test.ts — an algebra
 *   slip cannot survive that check.
 * - Carter constant diagnostic Q = p_theta^2 - a^2 E^2 cos^2theta
 *   + L_z^2 cos^2theta/sin^2theta is constant on exact solutions; its
 *   monitored drift is a first-class failure reason (ADR §1.13/§1.15).
 *
 * Determinism: no randomness anywhere; identical inputs produce bit-identical
 * outputs. Fidelity class DIRECT (docs/NUMERICAL_METHODS.md §18 oracle).
 */

import { kerrErgosphereRadius, kerrHorizonRadii, kerrFragments } from './characteristics.js';

/** 3-vector tuple in r_g units, relative to the black-hole center. */
export type Vec3 = [number, number, number];

/** All integration controls for {@link integrateKerrPhoton}. */
export interface KerrPhotonOptions {
  /** SIGNED dimensionless spin a* = Jc/(GM^2). */
  aStar: number;
  /**
   * Geometric mass in r_g units (default 1). Radius-valued options are
   * absolute r_g quantities; step sizes scale by massRg like cpuReference.
   */
  massRg: number;
  /** Hard RK4 step budget; exhaustion reports 'max-steps'. */
  maxSteps: number;
  /** Base RK4 step applied throughout the strong field r <= 10*massRg. */
  stepSize: number;
  /** Global lower step bound in r_g. */
  minStep: number;
  /** Global upper step bound in r_g. */
  maxStep: number;
  /** Conservative escape radius in r_g (ADR §1.12/§1.13). */
  escapeRadiusRg: number;
  /** Capture band width above the outer horizon, in units of massRg. */
  captureEpsilon: number;
  /**
   * Infalling coordinate-stall threshold on Delta/(r^2+a^2) (ADR §1.12
   * condition 2; the BL analog of the Schwarzschild f < 1e-3 resolution).
   */
  stallBandDelta: number;
  /** Normalized null-constraint residual above which integration fails. */
  constraintThreshold: number;
  /** Carter-drift measure |Q-Q0|/(1+|Q0|) above which integration fails. */
  carterThreshold: number;
  /** Disk annulus inner radius in r_g; null disables crossing detection. */
  diskInnerRg: number | null;
  /** Disk annulus outer radius in r_g; ignored when diskInnerRg is null. */
  diskOuterRg: number | null;
  /** Record every Nth step into pathSamples; 0 selects an automatic stride. */
  pathStride: number;
}

/** Defaults mirror the reference settings used to derive fixtures. */
export const DEFAULT_KERR_PHOTON_OPTIONS: Readonly<KerrPhotonOptions> = {
  aStar: 0,
  massRg: 1,
  maxSteps: 250_000,
  stepSize: 0.005,
  minStep: 1e-9,
  maxStep: 250,
  escapeRadiusRg: 1000,
  captureEpsilon: 1e-6,
  stallBandDelta: 1e-3,
  constraintThreshold: 1e-4,
  carterThreshold: 1e-5,
  diskInnerRg: null,
  diskOuterRg: null,
  pathStride: 0
};

// ---------------------------------------------------------------------------
// Outcome taxonomy (ADR §1.13 — reasons stay distinct and inspectable)
// ---------------------------------------------------------------------------

/** Detailed, inspectable terminal reason for every non-physical outcome. */
export type KerrRayOutcome =
  | { kind: 'captured'; reason: 'horizon-band' | 'coordinate-stall' }
  | { kind: 'escaped' }
  | {
      kind: 'numerical-failure';
      reason:
        'non-finite' | 'null-constraint' | 'carter-drift' | 'max-steps' | 'invalid-initial-state';
      detail: string;
    };

/** Compact external classification for aggregation surfaces. */
export type KerrRayClassification = 'captured' | 'escaped' | 'numerical-failure';

export interface KerrDiskHit {
  /** World-frame position of the crossing (r_g, relative to center). */
  positionWorld: Vec3;
  /** Equatorial radius of the crossing in r_g. */
  radiusRg: number;
  /** World azimuth phi_w of the crossing, wrapped to (-PI, PI]. */
  worldAzimuthRad: number;
  /** Affine parameter (accumulated lambda) at the crossing. */
  affineParameter: number;
  /** 1-based index among ACCEPTED crossings along this ray. */
  order: number;
}

export interface KerrPhotonResult {
  outcome: KerrRayOutcome;
  classification: KerrRayClassification;
  steps: number;
  /** Minimum Boyer-Lindquist radius reached in r_g. */
  minRadiusRg: number;
  /** Terminal embedded world position; null when initialization failed. */
  finalPosition: Vec3 | null;
  /**
   * Terminal local static-observer direction expressed in world axes
   * (tetrad projection of the terminal coordinate velocity); defined for
   * escaped rays, null otherwise.
   */
  finalDirection: Vec3 | null;
  diskHits: KerrDiskHit[];
  conserved: {
    energy: number;
    angularMomentumZ: number;
    carterConstantQ: number;
    /** max |Q - Q0|/(1 + |Q0|) observed along the trace. */
    carterDrift: number;
    /** max normalized null-constraint residual observed along the trace. */
    nullResidualMax: number;
  };
  turnCounts: { radial: number; angular: number };
  /** Total signed BL azimuthal travel phi(end) - phi(start), radians. */
  signedPhiTravelRad: number;
  /** Total unsigned azimuthal travel |phi(end) - phi(start)|, radians. */
  windingRadians: number;
  pathSamples: Vec3[];
}

// ---------------------------------------------------------------------------
// Low-level pure pieces (exported for independent verification tests)
// ---------------------------------------------------------------------------

/** Integration state: Boyer-Lindquist position + covariant momenta. */
export interface KerrState {
  readonly r: number;
  readonly theta: number;
  readonly phi: number;
  readonly pr: number;
  readonly ptheta: number;
}

const STATE_FLOOR = 1e-300;
/** sin^2(theta) floor guarding the 1/sin terms near the poles (ADR §1.19). */
const SIN2_FLOOR = 1e-12;

interface RhsDerivatives {
  readonly dr: number;
  readonly dtheta: number;
  readonly dphi: number;
  readonly dpr: number;
  readonly dptheta: number;
}

/**
 * Null-Hamiltonian RHS (ADR §1.10) at state x with fixed (E, L_z, a*, M).
 * Pure; no guards beyond denominator floors, so tests can finite-difference
 * H through exactly this algebra.
 */
export function kerrRhs(
  x: KerrState,
  energy: number,
  lZ: number,
  aStar: number,
  massRg: number
): RhsDerivatives {
  const m = massRg;
  const a = aStar * m;
  const fr = kerrFragments(x.r, x.theta, aStar);
  const sigma = Math.max(fr.sigma, STATE_FLOOR);
  const delta = Math.max(fr.delta, STATE_FLOOR);
  const s2 = Math.max(fr.sin2, SIN2_FLOOR);
  const sinTheta = Math.sqrt(s2);
  const cosTheta = fr.cosTheta;
  const aSq = a * a;
  const r2 = x.r * x.r;
  const bigA = (r2 + aSq) * (r2 + aSq) - aSq * delta * s2;

  const w =
    -bigA * energy * energy + 4 * m * a * x.r * energy * lZ + ((delta - aSq * s2) * lZ * lZ) / s2;

  const sigmaDelta = sigma * delta;
  const kinetic = delta * x.pr * x.pr + x.ptheta * x.ptheta;

  const dr = (delta * x.pr) / sigma;
  const dtheta = x.ptheta / sigma;
  const dphi = (2 * m * a * x.r * energy + ((delta - aSq * s2) * lZ) / s2) / sigmaDelta;

  const sigmaR = 2 * x.r;
  const deltaR = 2 * (x.r - m);
  const bigAR = 4 * x.r * (r2 + aSq) - aSq * deltaR * s2;
  const wR = -bigAR * energy * energy + 4 * m * a * energy * lZ + (deltaR * lZ * lZ) / s2;
  const dhdr =
    0.5 * (wR / sigmaDelta - (w * (sigmaR * delta + sigma * deltaR)) / (sigmaDelta * sigmaDelta)) +
    0.5 * ((deltaR * x.pr * x.pr) / sigma - (kinetic * sigmaR) / (sigma * sigma));

  const sin2theta2 = Math.sin(2 * x.theta);
  const sigmaTh = -aSq * sin2theta2;
  const bigATh = -aSq * delta * sin2theta2;
  const sin3 = Math.max(sinTheta * s2, SIN2_FLOOR);
  const wTh = -bigATh * energy * energy - (2 * delta * lZ * lZ * cosTheta) / sin3;
  const dhdtheta =
    0.5 * (wTh / sigmaDelta - (w * sigmaTh * delta) / (sigmaDelta * sigmaDelta)) -
    0.5 * ((kinetic * sigmaTh) / (sigma * sigma));

  return { dr, dtheta, dphi, dpr: -dhdr, dptheta: -dhdtheta };
}

/**
 * Raw null-Hamiltonian value 2H (the sum of metric terms; H = (2H)/2).
 * Exported so tests can finite-difference H and verify {@link kerrRhs}.
 */
export function kerrHamiltonian2(
  x: KerrState,
  energy: number,
  lZ: number,
  aStar: number,
  massRg: number
): number {
  const m = massRg;
  const a = aStar * m;
  const fr = kerrFragments(x.r, x.theta, aStar);
  const sigma = Math.max(fr.sigma, STATE_FLOOR);
  const delta = Math.max(fr.delta, STATE_FLOOR);
  const s2 = Math.max(fr.sin2, SIN2_FLOOR);
  const aSq = a * a;
  const r2 = x.r * x.r;
  const bigA = (r2 + aSq) * (r2 + aSq) - aSq * delta * s2;
  return (
    (-bigA * energy * energy) / (sigma * delta) +
    (4 * m * a * x.r * energy * lZ) / (sigma * delta) +
    ((delta - aSq * s2) * lZ * lZ) / (s2 * sigma * delta) +
    (delta * x.pr * x.pr) / sigma +
    (x.ptheta * x.ptheta) / sigma
  );
}

/**
 * Normalized null-constraint residual (ADR §1.15): |2H| divided by the
 * largest absolute contributing metric term, so the value is scale-free and
 * comparable across rays.
 */
export function kerrNullResidual(
  x: KerrState,
  energy: number,
  lZ: number,
  aStar: number,
  massRg: number
): number {
  const m = massRg;
  const a = aStar * m;
  const fr = kerrFragments(x.r, x.theta, aStar);
  const sigma = Math.max(fr.sigma, STATE_FLOOR);
  const delta = Math.max(fr.delta, STATE_FLOOR);
  const s2 = Math.max(fr.sin2, SIN2_FLOOR);
  const aSq = a * a;
  const r2 = x.r * x.r;
  const bigA = (r2 + aSq) * (r2 + aSq) - aSq * delta * s2;
  const sigmaDelta = sigma * delta;
  // Signed contributions to 2H: the g^tt piece carries the MINUS sign.
  const terms = [
    -(bigA * energy * energy) / sigmaDelta,
    (4 * m * a * x.r * energy * lZ) / sigmaDelta,
    ((delta - aSq * s2) * lZ * lZ) / (s2 * sigmaDelta),
    (delta * x.pr * x.pr) / sigma,
    (x.ptheta * x.ptheta) / sigma
  ];
  let twoH = 0;
  let largest = 0;
  for (const term of terms) {
    twoH += term;
    const magnitude = Math.abs(term);
    if (magnitude > largest) largest = magnitude;
  }
  return Math.abs(twoH) / Math.max(largest, 1e-30);
}

/**
 * Carter constant of a null geodesic (ADR §1.15):
 * Q = p_theta^2 - a^2 E^2 cos^2theta + L_z^2 cos^2theta / sin^2theta.
 * Constant on exact solutions; equatorial rays give exactly 0; the
 * Schwarzschild limit reduces to Q = L^2 - L_z^2.
 */
export function kerrCarterConstant(
  theta: number,
  ptheta: number,
  energy: number,
  lZ: number,
  aStar: number
): number {
  if (!Number.isFinite(aStar)) {
    throw new RangeError(`kerr reference: aStar must be finite, got ${String(aStar)}`);
  }
  const cosTheta = Math.cos(theta);
  const s2 = Math.max(Math.sin(theta) * Math.sin(theta), SIN2_FLOOR);
  return (
    ptheta * ptheta -
    aStar * aStar * energy * energy * cosTheta * cosTheta +
    (lZ * lZ * cosTheta * cosTheta) / s2
  );
}

/** World -> Boyer-Lindquist polar data shared by init and helpers. */
function worldToPolar(pos: Vec3): {
  r: number;
  theta: number;
  sinTheta: number;
  cosTheta: number;
} {
  const r = Math.hypot(pos[0], pos[1], pos[2]);
  const rho = Math.hypot(pos[0], pos[2]);
  return {
    r,
    theta: Math.atan2(rho, pos[1]),
    sinTheta: r > 0 ? rho / r : 0,
    cosTheta: r > 0 ? pos[1] / r : 1
  };
}

/**
 * BL (r, theta, phi_w) -> world position (ADR §1.4 locked mapping:
 * x = r sin(theta) cos(phi), y = r cos(theta), z = r sin(theta) sin(phi)).
 */
export function embedKerr(r: number, theta: number, phiWorld: number): Vec3 {
  const sinTheta = Math.sin(theta);
  return [
    r * sinTheta * Math.cos(phiWorld),
    r * Math.cos(theta),
    r * sinTheta * Math.sin(phiWorld)
  ];
}

/** Observer-colatitude below which the static tetrad is degenerate (axis). */
const MIN_SIN_THETA = 1e-9;

/** Internal shape produced by {@link initKerrRay}; exported for tetrad tests. */
export interface KerrRayInit {
  state: KerrState;
  energy: number;
  lZ: number;
  carterQ0: number;
  /** BL radius of the observer in r_g. */
  radiusRg: number;
  /** World azimuth the ray starts from. */
  phiWorld0: number;
}

/**
 * Builds Hamiltonian initial data for a photon at world position `pos`
 * (relative to the center, r_g) traveling along the local STATIC-OBSERVER
 * unit direction `dir` (toward the scene), per ADR §1.8.
 *
 * Throws RangeError with an inspectable message on invalid initial states:
 * non-finite inputs, zero direction, observer at/inside the outer horizon or
 * inside the ergosphere, or on the symmetry axis where the static tetrad is
 * degenerate ({@link integrateKerrPhoton} converts these into the structured
 * invalid-initial-state outcome).
 */
export function initKerrRay(pos: Vec3, dir: Vec3, aStar: number, massRg = 1): KerrRayInit {
  requireFinite(aStar, 'aStar');
  requireFinite(massRg, 'massRg');
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(pos[i]) || !Number.isFinite(dir[i])) {
      throw new RangeError(`kerr init: non-finite input component ${i}`);
    }
  }
  const dirLength = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(dirLength > 0)) {
    throw new RangeError('kerr init: zero-direction');
  }
  const polar = worldToPolar(pos);
  // Horizon guard uses the SPIN-DEPENDENT outer horizon (not 2M): cameras
  // legitimately sit between r+(a*) and 2M when a* != 0.
  if (!(polar.r > kerrHorizonRadii(aStar).outerRg * massRg)) {
    throw new RangeError('kerr init: observer-at-or-inside-horizon');
  }
  if (!(polar.r > kerrErgosphereRadius(aStar, polar.theta) * massRg)) {
    throw new RangeError('kerr init: observer-inside-ergosphere');
  }
  if (polar.sinTheta < MIN_SIN_THETA) {
    throw new RangeError('kerr init: observer-on-axis');
  }

  // Local static-frame direction components: project onto the spherical
  // orthonormal axes at the observer (world frame, ADR §1.4).
  const nx = dir[0] / dirLength;
  const ny = dir[1] / dirLength;
  const nz = dir[2] / dirLength;
  const erX = pos[0] / polar.r;
  const ezX = pos[2] / polar.r;
  // e_r = (sin(th)cos(ph), cos(th), sin(th)sin(ph)); its dot with dir:
  const nR = nx * erX + ny * polar.cosTheta + nz * ezX;
  // e_theta = (cos(th)cos(ph), -sin(th), cos(th)sin(ph)):
  const cOverS = polar.cosTheta / polar.sinTheta;
  const nTh = cOverS * (nx * erX + nz * ezX) - ny * polar.sinTheta;
  // e_phi = (-sin(ph), 0, cos(ph)) with sin(ph)=z/(rho), cos(ph)=x/(rho):
  const nPh = (nz * erX - nx * ezX) / polar.sinTheta;

  const fr = kerrFragments(polar.r, polar.theta, aStar);
  const sigma = fr.sigma;
  const delta = fr.delta;
  const s2 = Math.max(fr.sin2, SIN2_FLOOR);
  const a = aStar * massRg;

  // Conserved quantities from the STATIC tetrad decomposition (ADR §1.8).
  // The phi-leg must be orthogonalized against the timelike leg (g_tphi !=
  // 0), giving the exact covariant extraction below — machine-null by
  // construction and exact in the a -> 0 limit:
  //   E   = sqrt(f_s),  f_s = (Sigma - 2Mr)/Sigma
  //   L_z = nPhi * sin(theta) * sqrt(Delta / f_s) + g_tphi / f_s
  //   p_r = sqrt(Sigma/Delta) n_r,   p_theta = sqrt(Sigma) n_theta
  const fS = (sigma - 2 * massRg * polar.r) / sigma; // > 0 outside ergosphere
  const gTphi = (-2 * massRg * a * polar.r * s2) / sigma;
  const energy = Math.sqrt(fS);
  const lZ = nPh * polar.sinTheta * Math.sqrt(delta / fS) + gTphi / Math.sqrt(fS);
  const pr = Math.sqrt(sigma / delta) * nR;
  const ptheta = Math.sqrt(sigma) * nTh;

  const phiWorld0 = Math.atan2(pos[2], pos[0]);
  return {
    state: { r: polar.r, theta: polar.theta, phi: phiWorld0, pr, ptheta },
    energy,
    lZ,
    carterQ0: kerrCarterConstant(polar.theta, ptheta, energy, lZ, aStar),
    radiusRg: polar.r,
    phiWorld0
  };
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`kerr reference: ${label} must be finite, got ${String(value)}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Step policy + integrator (NM §9 shape, ADR §1.10/§1.12)
// ---------------------------------------------------------------------------

/** Step-size heuristic: base resolution in the strong field, r^1.5 far out, */
/** shrink towards the OUTER HORIZON, clamped to [minStep, maxStep] * massRg. */
export function kerrStepSizeAt(r: number, o: KerrPhotonOptions): number {
  const m = o.massRg;
  const rPlus = kerrHorizonRadii(o.aStar).outerRg * m;
  const farScale = Math.max(1, Math.pow(r / (10 * m), 1.5));
  const nearScale = Math.min(1, Math.max(0.02, (r - rPlus) / m));
  const h = o.stepSize * m * farScale * nearScale;
  const minH = o.minStep * m;
  const maxH = o.maxStep * m;
  return Math.min(maxH, Math.max(minH, h));
}

interface KerrStateMutable {
  r: number;
  theta: number;
  phi: number;
  pr: number;
  ptheta: number;
}

/** One classical RK4 step over the 5-variable Kerr state (NM §8.1). */
export function rk4KerrStep(
  x: KerrState,
  h: number,
  energy: number,
  lZ: number,
  aStar: number,
  massRg: number
): KerrState {
  const d1 = kerrRhs(x, energy, lZ, aStar, massRg);
  const mid1: KerrState = {
    r: x.r + (h / 2) * d1.dr,
    theta: x.theta + (h / 2) * d1.dtheta,
    phi: x.phi + (h / 2) * d1.dphi,
    pr: x.pr + (h / 2) * d1.dpr,
    ptheta: x.ptheta + (h / 2) * d1.dptheta
  };
  const d2 = kerrRhs(mid1, energy, lZ, aStar, massRg);
  const mid2: KerrState = {
    r: x.r + (h / 2) * d2.dr,
    theta: x.theta + (h / 2) * d2.dtheta,
    phi: x.phi + (h / 2) * d2.dphi,
    pr: x.pr + (h / 2) * d2.dpr,
    ptheta: x.ptheta + (h / 2) * d2.dptheta
  };
  const d3 = kerrRhs(mid2, energy, lZ, aStar, massRg);
  const mid3: KerrState = {
    r: x.r + h * d3.dr,
    theta: x.theta + h * d3.dtheta,
    phi: x.phi + h * d3.dphi,
    pr: x.pr + h * d3.dpr,
    ptheta: x.ptheta + h * d3.dptheta
  };
  const d4 = kerrRhs(mid3, energy, lZ, aStar, massRg);
  const sixth = h / 6;
  return {
    r: x.r + sixth * (d1.dr + 2 * d2.dr + 2 * d3.dr + d4.dr),
    theta: x.theta + sixth * (d1.dtheta + 2 * d2.dtheta + 2 * d3.dtheta + d4.dtheta),
    phi: x.phi + sixth * (d1.dphi + 2 * d2.dphi + 2 * d3.dphi + d4.dphi),
    pr: x.pr + sixth * (d1.dpr + 2 * d2.dpr + 2 * d3.dpr + d4.dpr),
    ptheta: x.ptheta + sixth * (d1.dptheta + 2 * d2.dptheta + 2 * d3.dptheta + d4.dptheta)
  };
}

/** Bisection iterations for curved-trajectory disk-crossing refinement. */
const DISK_BISECTION_ITERATIONS = 48;

function wrapAzimuth(phi: number): number {
  const twoPi = 2 * Math.PI;
  let wrapped = phi % twoPi;
  if (wrapped <= -Math.PI) wrapped += twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  return wrapped;
}

/**
 * Terminal local static-observer direction in WORLD axes: project the
 * terminal coordinate velocity through the inverse static tetrad and express
 * it on the spherical basis at the terminal point. Returns null when the
 * state is non-finite (callers keep their own failure classification).
 */
export function terminalLocalDirection(
  x: KerrState,
  energy: number,
  lZ: number,
  aStar: number,
  massRg: number
): Vec3 | null {
  if (
    !Number.isFinite(x.r) ||
    !Number.isFinite(x.theta) ||
    !Number.isFinite(x.phi) ||
    !Number.isFinite(x.pr) ||
    !Number.isFinite(x.ptheta)
  ) {
    return null;
  }
  // Inverse static-tetrad projection works from the covariant momenta; no
  // RHS evaluation is needed here.
  const fr = kerrFragments(Math.max(x.r, STATE_FLOOR), x.theta, aStar);
  const sigma = Math.max(fr.sigma, STATE_FLOOR);
  const delta = Math.max(fr.delta, STATE_FLOOR);
  const s2 = Math.max(fr.sin2, SIN2_FLOOR);
  const sinTheta = Math.sqrt(s2);
  const a = aStar * massRg;

  // Inverse static-tetrad projection at the terminal point (ADR §1.8):
  // the conserved scale is kappa = E / sqrt(f_s), so local components read
  //   n_r  = kappa^-1 p_r sqrt(Delta/Sigma)
  //   n_th = kappa^-1 p_theta / sqrt(Sigma)
  //   n_ph = [ (L_z/E) sqrt(f_s) - g_tphi/f_s ] sqrt(f_s/Delta) / sin(theta)
  const fS = (sigma - 2 * massRg * x.r) / sigma;
  if (!(fS > 0)) return null; // projection undefined inside the ergosphere
  const kappaInv = Math.sqrt(fS) / energy;
  const gTphi = (-2 * massRg * a * x.r * s2) / sigma;
  const nR = x.pr * Math.sqrt(delta / sigma) * kappaInv;
  const nTh = (x.ptheta / Math.sqrt(sigma)) * kappaInv;
  const nPhRaw =
    (((lZ / energy) * Math.sqrt(fS) - gTphi / Math.sqrt(fS)) * Math.sqrt(fS / delta)) / sinTheta;
  const norm = Math.hypot(nR, nTh, nPhRaw);
  if (!(norm > 0)) return null;

  // Spherical world basis at (theta, phi_w).
  const st = sinTheta;
  const ct = fr.cosTheta;
  const cp = Math.cos(x.phi);
  const sp = Math.sin(x.phi);
  const eR: Vec3 = [st * cp, ct, st * sp];
  const eTh: Vec3 = [ct * cp, -st, ct * sp];
  const ePh: Vec3 = [-sp, 0, cp];
  const dx = (nR * eR[0] + nTh * eTh[0] + nPhRaw * ePh[0]) / norm;
  const dy = (nR * eR[1] + nTh * eTh[1] + nPhRaw * ePh[1]) / norm;
  const dz = (nR * eR[2] + nTh * eTh[2] + nPhRaw * ePh[2]) / norm;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) return null;
  return [dx / len, dy / len, dz / len];
}

/**
 * Integrate one backwards-or-forwards photon in the Kerr geometry
 * (formulation and event policy per docs/KERR_BACKEND_ADR.md; see module
 * header). Invalid initial states produce the structured
 * 'invalid-initial-state' numerical-failure outcome — this entry point never
 * throws for malformed cameras.
 */
export function integrateKerrPhoton(
  pos: Vec3,
  dir: Vec3,
  opts: Partial<KerrPhotonOptions> = {}
): KerrPhotonResult {
  const failure = (
    reason: Extract<KerrRayOutcome, { kind: 'numerical-failure' }>['reason'],
    detail: string
  ): KerrPhotonResult => ({
    outcome: { kind: 'numerical-failure', reason, detail },
    classification: 'numerical-failure',
    steps: 0,
    minRadiusRg: Number.NaN,
    finalPosition: null,
    finalDirection: null,
    diskHits: [],
    conserved: {
      energy: Number.NaN,
      angularMomentumZ: Number.NaN,
      carterConstantQ: Number.NaN,
      carterDrift: Number.NaN,
      nullResidualMax: Number.NaN
    },
    turnCounts: { radial: 0, angular: 0 },
    windingRadians: 0,
    signedPhiTravelRad: 0,
    pathSamples: []
  });

  let init: KerrRayInit;
  try {
    init = initKerrRay(
      pos,
      dir,
      opts.aStar ?? DEFAULT_KERR_PHOTON_OPTIONS.aStar,
      opts.massRg ?? DEFAULT_KERR_PHOTON_OPTIONS.massRg
    );
  } catch (error) {
    return failure('invalid-initial-state', error instanceof Error ? error.message : String(error));
  }

  const o: KerrPhotonOptions = {
    ...DEFAULT_KERR_PHOTON_OPTIONS,
    ...opts,
    aStar: opts.aStar ?? DEFAULT_KERR_PHOTON_OPTIONS.aStar,
    massRg: opts.massRg ?? DEFAULT_KERR_PHOTON_OPTIONS.massRg
  };
  const m = o.massRg;
  const energy = init.energy;
  const lZ = init.lZ;
  const q0 = init.carterQ0;
  const rPlus = kerrHorizonRadii(o.aStar).outerRg * m;
  const captureRadius = rPlus + o.captureEpsilon * m;
  const diskActive = o.diskInnerRg !== null && o.diskOuterRg !== null;

  const stride =
    o.pathStride > 0
      ? Math.max(1, Math.floor(o.pathStride))
      : Math.max(1, Math.floor(o.maxSteps / 1024));

  const pathSamples: Vec3[] = [embedKerr(init.state.r, init.state.theta, init.state.phi)];
  const diskHits: KerrDiskHit[] = [];

  let cur: KerrStateMutable = {
    r: init.state.r,
    theta: init.state.theta,
    phi: init.state.phi,
    pr: init.state.pr,
    ptheta: init.state.ptheta
  };
  let prev: KerrState = { ...cur };
  let minRadius = cur.r;
  let steps = 0;
  let lambda = 0;
  let carterDriftMax = 0;
  let residualMax = 0;
  let radialTurns = 0;
  let angularTurns = 0;
  let prevDrSign = Math.sign(kerrRhs(cur, energy, lZ, o.aStar, m).dr);
  let prevDthSign = Math.sign(kerrRhs(cur, energy, lZ, o.aStar, m).dtheta);
  let outcome: KerrRayOutcome = {
    kind: 'numerical-failure',
    reason: 'max-steps',
    detail: 'step budget exhausted before any terminal event'
  };
  let sampledLastStep = false;

  while (steps < o.maxSteps) {
    const h = kerrStepSizeAt(cur.r, o);
    prev = { ...cur };
    const next = rk4KerrStep(cur, h, energy, lZ, o.aStar, m);
    cur = { ...next };
    lambda += h;
    steps += 1;

    // Non-finite guard (ADR §1.13) — reported distinctly, never as capture.
    if (
      !Number.isFinite(cur.r) ||
      !Number.isFinite(cur.theta) ||
      !Number.isFinite(cur.phi) ||
      !Number.isFinite(cur.pr) ||
      !Number.isFinite(cur.ptheta)
    ) {
      outcome = { kind: 'numerical-failure', reason: 'non-finite', detail: `step ${steps}` };
      break;
    }

    // Null-constraint monitor (ADR §1.15).
    const residual = kerrNullResidual(cur, energy, lZ, o.aStar, m);
    if (residual > residualMax) residualMax = residual;
    if (residual > o.constraintThreshold) {
      outcome = {
        kind: 'numerical-failure',
        reason: 'null-constraint',
        detail: `step ${steps}, residual ${residual.toExponential(3)}`
      };
      break;
    }

    // Carter-drift monitor (ADR §1.15).
    const q = kerrCarterConstant(cur.theta, cur.ptheta, energy, lZ, o.aStar);
    const drift = Math.abs(q - q0) / (1 + Math.abs(q0));
    if (drift > carterDriftMax) carterDriftMax = drift;
    if (drift > o.carterThreshold) {
      outcome = {
        kind: 'numerical-failure',
        reason: 'carter-drift',
        detail: `step ${steps}, drift ${drift.toExponential(3)}`
      };
      break;
    }

    if (cur.r < minRadius) minRadius = cur.r;

    // Turning-point counts (diagnostic; smooth crossings, no handling needed).
    const rhsHere = kerrRhs(cur, energy, lZ, o.aStar, m);
    const drSign = Math.sign(rhsHere.dr);
    const dthSign = Math.sign(rhsHere.dtheta);
    if (drSign !== 0 && prevDrSign !== 0 && drSign !== prevDrSign) radialTurns += 1;
    if (dthSign !== 0 && prevDthSign !== 0 && dthSign !== prevDthSign) angularTurns += 1;
    if (drSign !== 0) prevDrSign = drSign;
    if (dthSign !== 0) prevDthSign = dthSign;

    if (steps % stride === 0) {
      pathSamples.push(embedKerr(cur.r, cur.theta, cur.phi));
      sampledLastStep = true;
    } else {
      sampledLastStep = false;
    }

    // --- Disk-plane crossing on the CURVED trajectory (ADR §1.14): world-y
    // sign change between consecutive embedded segment endpoints.
    if (diskActive) {
      const yPrev = prev.r * Math.cos(prev.theta);
      const yCur = cur.r * Math.cos(cur.theta);
      if (yPrev * yCur < 0) {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < DISK_BISECTION_ITERATIONS; i += 1) {
          const mid = 0.5 * (lo + hi);
          const rMid = prev.r + (cur.r - prev.r) * mid;
          const thMid = prev.theta + (cur.theta - prev.theta) * mid;
          const yMid = rMid * Math.cos(thMid);
          if (yPrev * yMid > 0) lo = mid;
          else hi = mid;
        }
        const sCross = 0.5 * (lo + hi);
        const rHit = prev.r + (cur.r - prev.r) * sCross;
        const thHit = prev.theta + (cur.theta - prev.theta) * sCross;
        const phHit = prev.phi + (cur.phi - prev.phi) * sCross;
        if (rHit >= (o.diskInnerRg as number) && rHit <= (o.diskOuterRg as number)) {
          diskHits.push({
            positionWorld: embedKerr(rHit, thHit, phHit),
            radiusRg: rHit,
            worldAzimuthRad: wrapAzimuth(phHit),
            affineParameter: lambda - h + h * sCross,
            order: diskHits.length + 1
          });
        }
      }
    }

    // --- Horizon capture (ADR §1.12), priority over escape.
    if (cur.r <= captureRadius) {
      outcome = { kind: 'captured', reason: 'horizon-band' };
      break;
    }
    const frHere = kerrFragments(cur.r, cur.theta, o.aStar);
    if (
      cur.pr < 0 &&
      frHere.delta / (cur.r * cur.r + o.aStar * o.aStar * m * m) < o.stallBandDelta
    ) {
      outcome = { kind: 'captured', reason: 'coordinate-stall' };
      break;
    }

    // --- Conservative escape (ADR §1.12): beyond the radius AND outward.
    if (cur.r > o.escapeRadiusRg && cur.pr > 0) {
      outcome = { kind: 'escaped' };
      break;
    }
  }

  if (!sampledLastStep) {
    pathSamples.push(embedKerr(cur.r, cur.theta, cur.phi));
  }

  const classification: KerrRayClassification =
    outcome.kind === 'escaped'
      ? 'escaped'
      : outcome.kind === 'captured'
        ? 'captured'
        : 'numerical-failure';

  return {
    outcome,
    classification,
    steps,
    minRadiusRg: minRadius,
    finalPosition: embedKerr(cur.r, cur.theta, cur.phi),
    finalDirection:
      outcome.kind === 'escaped' ? terminalLocalDirection(cur, energy, lZ, o.aStar, m) : null,
    diskHits,
    conserved: {
      energy,
      angularMomentumZ: lZ,
      carterConstantQ: q0,
      carterDrift: carterDriftMax,
      nullResidualMax: residualMax
    },
    turnCounts: { radial: radialTurns, angular: angularTurns },
    windingRadians: Math.abs(cur.phi - init.phiWorld0),
    signedPhiTravelRad: cur.phi - init.phiWorld0,
    pathSamples
  };
}
