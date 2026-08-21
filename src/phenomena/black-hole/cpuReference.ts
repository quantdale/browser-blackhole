/**
 * Double-precision CPU reference solver for Schwarzschild null geodesics.
 *
 * Spec sources (implemented exactly; do not drift without updating docs):
 * - docs/NUMERICAL_METHODS.md
 *     §1   geometric units r_g = GM/c^2; horizon 2, photon sphere 3, ISCO 6
 *     §2   static-observer tetrad mapping, b = L/E
 *     §3   geodesic-plane construction and world re-embedding
 *     §4   Hamiltonian first-order system — the formulation integrated here
 *     §6   normalized null-constraint monitor
 *     §7   initial covariant radial momentum p_r = n_r/sqrt(f), E-normalized
 *     §8.1 classical RK4 reference baseline
 *     §9   radius-aware step policy honoring minStep/maxStep/maxSteps
 *     §10  event detection: horizon capture, conservative escape, failure
 *     §11  critical impact parameter b_c = 3*sqrt(3)*M via boundary bisection
 *     §12  weak-field check alpha ~= 4M/b
 *     §13  dedicated stable radial path for L ~= 0
 *     §16  frequency shift convention g = nu_obs/nu_emit
 * - docs/VALIDATION_VECTORS.md (fixtures built in ./validationVectors)
 *
 * Fidelity class: DIRECT — IEEE-754 binary64 reference for the f32 GPU path
 * (docs/NUMERICAL_METHODS.md §18). Cross-implementation tolerances are owned
 * by the validation vectors; nothing is claimed implicitly here.
 *
 * Conventions:
 * - Positions are relative to the black-hole center (origin), in r_g units.
 * - `dir` is a unit local static-observer spatial direction; the tetrad
 *   mapping of docs/NUMERICAL_METHODS.md §2/§7 derives (E, L, p_r) from it.
 * - Returned `finalDirection` is again a local static-observer direction
 *   (tetrad projection of the terminal coordinate velocity), so far-field
 *   results converge to the flat-space asymptotic direction.
 * - Momenta are normalized to E = 1 after deriving b = L/E, as permitted by
 *   §4; this only rescales the affine parameter, never the spatial path.
 * - Status mapping: the mandated result union has no distinct numerical-
 *   failure member, so non-finite state, constraint-residual blowup, and
 *   exhausted step budgets are all reported as 'max-steps' (docs §10.4
 *   forbids aliasing failure into 'captured'/'escaped').
 *
 * Determinism: no randomness is used anywhere; identical inputs produce
 * bit-identical outputs.
 */

/** 3-vector tuple in r_g units, relative to the black-hole center. */
export type Vec3 = [number, number, number];

/** Horizon radius in r_g units (docs/NUMERICAL_METHODS.md §1). */
export const HORIZON_RG = 2;
/** Photon sphere radius in r_g units (docs/NUMERICAL_METHODS.md §1). */
export const PHOTON_SPHERE_RG = 3;
/** Schwarzschild ISCO radius in r_g units (docs/NUMERICAL_METHODS.md §1). */
export const ISCO_RG = 6;
/**
 * Analytic asymptotic critical impact parameter `3*sqrt(3)*M` in r_g
 * (docs/NUMERICAL_METHODS.md §11). {@link criticalImpactParameter} locates
 * the same boundary numerically; the two are compared by validation vectors.
 */
export const CRITICAL_IMPACT_PARAMETER_ANALYTIC_RG = 3 * Math.sqrt(3);

/** Normalized null-constraint residual above which integration fails (§6). */
const CONSTRAINT_FAILURE_THRESHOLD = 1e-4;
/** Tangential direction magnitude below which a ray is treated as radial (§13). */
const RADIAL_EPSILON = 1e-12;

/** Integration controls for {@link integratePhoton}. */
export interface PhotonIntegrationOptions {
  /** Mass in geometric units r_g = GM/c^2. */
  massRg: number;
  /** Hard step budget; exhaustion reports 'max-steps' (docs §9/§10.4). */
  maxSteps: number;
  /** Base RK4 step (r_g) applied throughout the strong field r <= 10*massRg. */
  stepSize: number;
  /** Global lower step bound in r_g (docs §9). */
  minStep: number;
  /** Global upper step bound in r_g (docs §9). */
  maxStep: number;
  /** Conservative escape radius in r_g (docs §10.3). */
  escapeRadius: number;
  /** Capture band width above the horizon, in units of massRg (docs §10.1). */
  captureEpsilon: number;
  /** Record every Nth step into pathSamples; 0 selects an automatic stride. */
  pathStride: number;
}

/** Defaults mirror the reference settings used to derive validation vectors. */
export const DEFAULT_PHOTON_INTEGRATION_OPTIONS: Readonly<PhotonIntegrationOptions> = {
  massRg: 1,
  maxSteps: 250_000,
  stepSize: 0.005,
  minStep: 1e-9,
  maxStep: 250,
  escapeRadius: 1000,
  captureEpsilon: 1e-6,
  pathStride: 0,
};

export interface PhotonIntegrationResult {
  status: 'captured' | 'escaped' | 'max-steps';
  steps: number;
  finalPosition: [number, number, number];
  finalDirection: [number, number, number];
  pathSamples: Array<[number, number, number]>;
}

interface PlaneState {
  readonly r: number;
  readonly phi: number;
  readonly pr: number;
}

interface PlaneDerivatives {
  readonly dr: number;
  readonly dphi: number;
  readonly dpr: number;
}

/**
 * Right-hand side of the Hamiltonian first-order system of
 * docs/NUMERICAL_METHODS.md §4 with E normalized to 1:
 *
 *   dr/dlambda  = f p_r
 *   dphi/dlambda = L / r^2
 *   dp_r/dlambda = -0.5 E^2 f'/f^2 - 0.5 f' p_r^2 + L^2/r^3,  f' = 2M/r^2
 */
function planeDerivatives(r: number, pr: number, massRg: number, angularMomentum: number): PlaneDerivatives {
  const r2 = r * r;
  const f = 1 - (2 * massRg) / r;
  const fPrime = (2 * massRg) / r2;
  const dr = f * pr;
  const dphi = angularMomentum / r2;
  const dpr = -0.5 * (fPrime / (f * f)) - 0.5 * fPrime * pr * pr + (angularMomentum * angularMomentum) / (r2 * r);
  return { dr, dphi, dpr };
}

/** One classical RK4 step over (r, phi, p_r) — docs/NUMERICAL_METHODS.md §8.1. */
function rk4PlaneStep(state: PlaneState, h: number, massRg: number, angularMomentum: number): PlaneState {
  const d1 = planeDerivatives(state.r, state.pr, massRg, angularMomentum);
  const d2 = planeDerivatives(state.r + (h / 2) * d1.dr, state.pr + (h / 2) * d1.dpr, massRg, angularMomentum);
  const d3 = planeDerivatives(state.r + (h / 2) * d2.dr, state.pr + (h / 2) * d2.dpr, massRg, angularMomentum);
  const d4 = planeDerivatives(state.r + h * d3.dr, state.pr + h * d3.dpr, massRg, angularMomentum);
  const r = state.r + (h / 6) * (d1.dr + 2 * d2.dr + 2 * d3.dr + d4.dr);
  const phi = state.phi + (h / 6) * (d1.dphi + 2 * d2.dphi + 2 * d3.dphi + d4.dphi);
  const pr = state.pr + (h / 6) * (d1.dpr + 2 * d2.dpr + 2 * d3.dpr + d4.dpr);
  return { r, phi, pr };
}

/**
 * Normalized null-constraint residual R_H of docs/NUMERICAL_METHODS.md §6
 * with E = 1: R_H = |2H| / max(E^2/f, f p_r^2 + L^2/r^2, eps).
 */
function constraintResidual(r: number, pr: number, massRg: number, angularMomentum: number): number {
  const f = 1 - (2 * massRg) / r;
  const kinetic = f * pr * pr + (angularMomentum * angularMomentum) / (r * r);
  const twoH = Math.abs(kinetic - 1 / f);
  const denominator = Math.max(1 / f, kinetic, 1e-30);
  return twoH / denominator;
}

/**
 * Step-size heuristic of docs/NUMERICAL_METHODS.md §9: base resolution in the
 * strong field, growing with r^1.5 far away, shrinking towards the horizon,
 * always clamped to [minStep, maxStep] (scaled by massRg).
 */
function stepSizeAt(r: number, o: PhotonIntegrationOptions): number {
  const m = o.massRg;
  const farScale = Math.max(1, Math.pow(r / (10 * m), 1.5));
  const nearScale = Math.min(1, Math.max(0.02, (r - 2 * m) / m));
  const h = o.stepSize * m * farScale * nearScale;
  const minH = o.minStep * m;
  const maxH = o.maxStep * m;
  return Math.min(maxH, Math.max(minH, h));
}

function clampUnit(x: number): number {
  return Math.min(1, Math.max(-1, x));
}

function copyVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

/**
 * Integrate one backwards-or-forwards photon in the Schwarzschild geometry.
 *
 * The ray is reduced to its geodesic plane (docs/NUMERICAL_METHODS.md §3),
 * integrated there with fixed-formula RK4 over the §4 Hamiltonian state, and
 * re-embedded into world space at every recorded sample (§14). Nearly radial
 * rays take the dedicated stable radial path (§13) instead of building a
 * tangent basis from a near-zero vector.
 *
 * Event policy (docs §10): capture at r <= 2M + captureEpsilon*massRg;
 * escape only when r > escapeRadius AND radial momentum is outward;
 * non-finite state, constraint-residual failure, or step-budget exhaustion
 * report 'max-steps'.
 */
export function integratePhoton(
  pos: Vec3,
  dir: Vec3,
  opts: Partial<PhotonIntegrationOptions> = {},
): PhotonIntegrationResult {
  const o: PhotonIntegrationOptions = { ...DEFAULT_PHOTON_INTEGRATION_OPTIONS, ...opts };
  const m = o.massRg;

  const dirLength = Math.hypot(dir[0], dir[1], dir[2]);
  const r0 = Math.hypot(pos[0], pos[1], pos[2]);
  const degenerate =
    !Number.isFinite(dirLength) ||
    dirLength === 0 ||
    !Number.isFinite(r0) ||
    r0 === 0 ||
    !(r0 > 2 * m); // static observer requires r > 2M (docs §2)
  if (degenerate) {
    return {
      status: 'max-steps',
      steps: 0,
      finalPosition: copyVec3(pos),
      finalDirection: copyVec3(dir),
      pathSamples: [],
    };
  }

  // Tetrad mapping of docs/NUMERICAL_METHODS.md §2/§7, E-normalized to 1.
  const e0: Vec3 = [pos[0] / r0, pos[1] / r0, pos[2] / r0];
  const nx = dir[0] / dirLength;
  const ny = dir[1] / dirLength;
  const nz = dir[2] / dirLength;
  const nRadial = nx * e0[0] + ny * e0[1] + nz * e0[2];
  const tx = nx - nRadial * e0[0];
  const ty = ny - nRadial * e0[1];
  const tz = nz - nRadial * e0[2];
  const tangential = Math.hypot(tx, ty, tz);
  const radialMode = tangential < RADIAL_EPSILON;

  const f0 = 1 - (2 * m) / r0;
  const angularMomentum = radialMode ? 0 : (r0 * tangential) / Math.sqrt(f0);
  const pr0 = nRadial / f0;

  // Stable plane basis (docs §3): e1 spans the initial tangential direction.
  const e1: Vec3 = radialMode
    ? [0, 0, 0]
    : [tx / tangential, ty / tangential, tz / tangential];

  const embed = (r: number, phi: number): Vec3 => {
    if (radialMode) return [r * e0[0], r * e0[1], r * e0[2]];
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    return [
      r * (c * e0[0] + s * e1[0]),
      r * (c * e0[1] + s * e1[1]),
      r * (c * e0[2] + s * e1[2]),
    ];
  };

  /**
   * Terminal local static-observer direction: tetrad-project the coordinate
   * velocity (v_r, v_t) = (f p_r, L/r) back to orthonormal components
   * (docs §2 inverse map), then express in world axes.
   */
  const localDirection = (r: number, phi: number, pr: number): Vec3 => {
    const f = 1 - (2 * m) / r;
    const vr = f * pr;
    const vt = angularMomentum / r;
    const norm = Math.sqrt((vr * vr) / f + vt * vt);
    if (!(norm > 0)) return radialMode ? copyVec3(e0) : [e0[0], e0[1], e0[2]];
    const nR = vr / (Math.sqrt(f) * norm);
    const nT = vt / norm;
    if (radialMode) {
      const sign = nR >= 0 ? 1 : -1;
      return [sign * e0[0], sign * e0[1], sign * e0[2]];
    }
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const dx = nR * (c * e0[0] + s * e1[0]) + nT * (-s * e0[0] + c * e1[0]);
    const dy = nR * (c * e0[1] + s * e1[1]) + nT * (-s * e0[1] + c * e1[1]);
    const dz = nR * (c * e0[2] + s * e1[2]) + nT * (-s * e0[2] + c * e1[2]);
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 0)) return [e0[0], e0[1], e0[2]];
    return [dx / len, dy / len, dz / len];
  };

  const stride =
    o.pathStride > 0 ? Math.max(1, Math.floor(o.pathStride)) : Math.max(1, Math.floor(o.maxSteps / 1024));

  const pathSamples: Vec3[] = [embed(r0, 0)];
  let lastSampleStep = 0;

  const captureRadius = 2 * m + o.captureEpsilon * m;
  let r = r0;
  let phi = 0;
  let pr = pr0;
  let steps = 0;
  let status: PhotonIntegrationResult['status'] = 'max-steps';

  while (steps < o.maxSteps) {
    const h = stepSizeAt(r, o);
    const next = rk4PlaneStep({ r, phi, pr }, h, m, angularMomentum);
    r = next.r;
    phi = next.phi;
    pr = next.pr;
    steps += 1;

    // Non-finite guard (docs §10.4) — reported as 'max-steps', see header.
    if (!Number.isFinite(r) || !Number.isFinite(phi) || !Number.isFinite(pr)) {
      status = 'max-steps';
      break;
    }
    // Null-constraint monitor (docs §6): persistent growth is a failure.
    if (constraintResidual(r, pr, m, angularMomentum) > CONSTRAINT_FAILURE_THRESHOLD) {
      status = 'max-steps';
      break;
    }

    if (steps % stride === 0) {
      pathSamples.push(embed(r, phi));
      lastSampleStep = steps;
    }

    // Horizon capture (docs §10.1), checked before escape.
    if (r <= captureRadius) {
      status = 'captured';
      break;
    }
    // Conservative escape (docs §10.3): outside radius AND outward momentum.
    if (r > o.escapeRadius && pr > 0) {
      status = 'escaped';
      break;
    }
  }

  if (lastSampleStep !== steps) {
    pathSamples.push(embed(r, phi));
  }

  return {
    status,
    steps,
    finalPosition: embed(r, phi),
    finalDirection: localDirection(r, phi, pr),
    pathSamples,
  };
}

/** Options for {@link launchFromImpactParameter}. */
export interface ImpactParameterLaunchOptions extends Partial<PhotonIntegrationOptions> {
  /** Source distance from the center in r_g; default max(100*|b|, 1e4)*massRg. */
  startRadiusRg?: number;
}

/**
 * Fire a photon from far away such that its conserved impact parameter
 * b = L/E equals `bInvariant` exactly (docs/NUMERICAL_METHODS.md §2:
 * b = r sin(psi)/sqrt(f)). The flat-chord perpendicular distance is scaled by
 * sqrt(f) at the source radius so the invariant matches the asymptotic b.
 * Incoming direction is +x; the source sits at (-x0, bFlat, 0).
 */
export function launchFromImpactParameter(
  bInvariant: number,
  opts: ImpactParameterLaunchOptions = {},
): PhotonIntegrationResult {
  const m = opts.massRg ?? DEFAULT_PHOTON_INTEGRATION_OPTIONS.massRg;
  const r0 = opts.startRadiusRg ?? Math.max(100 * Math.abs(bInvariant), 1e4) * m;
  const f0 = 1 - (2 * m) / r0;
  const bFlat = bInvariant * Math.sqrt(f0);
  const x0 = Math.sqrt(Math.max(0, r0 * r0 - bFlat * bFlat));
  const { startRadiusRg: _ignored, ...integrationOpts } = opts;
  void _ignored;
  return integratePhoton([-x0, bFlat, 0], [1, 0, 0], integrationOpts);
}

/**
 * Numeric total deflection angle (radians) for a photon arriving from and
 * leaving to infinity with impact parameter `b`, measured between asymptotic
 * incoming (+x) and outgoing local directions (docs/NUMERICAL_METHODS.md §12).
 *
 * The ray starts/ends at a large but finite radius r0; the first-order
 * weak-field tail beyond +/-r0, (4M/b)(1 - sqrt(1 - (b/r0)^2)), is added back
 * so results converge to the analytic asymptotic deflection. Returns NaN when
 * the ray is captured or integration fails — near b_c the deflection diverges
 * logarithmically (docs §11) and is genuinely undefined there.
 */
export function deflectionAngleNumeric(impactParameter: number, opts: ImpactParameterLaunchOptions = {}): number {
  const m = opts.massRg ?? DEFAULT_PHOTON_INTEGRATION_OPTIONS.massRg;
  if (!Number.isFinite(impactParameter) || impactParameter <= 0) return NaN;
  const r0 = opts.startRadiusRg ?? Math.max(100 * impactParameter, 1e4) * m;
  const result = launchFromImpactParameter(impactParameter, {
    ...opts,
    massRg: m,
    startRadiusRg: r0,
    stepSize: opts.stepSize ?? 0.002,
    minStep: opts.minStep ?? 1e-9,
    maxStep: opts.maxStep ?? 250,
    maxSteps: opts.maxSteps ?? 2_000_000,
    escapeRadius: opts.escapeRadius ?? 2.2 * r0,
  });
  if (result.status !== 'escaped') return NaN;
  const measured = Math.acos(clampUnit(result.finalDirection[0]));
  const tail =
    ((4 * m) / impactParameter) *
    (1 - Math.sqrt(Math.max(0, 1 - (impactParameter * impactParameter) / (r0 * r0))));
  return measured + tail;
}

/**
 * Leading-order weak-field deflection 4GM/(c^2 b) = 4*massRg/b in r_g units
 * (docs/NUMERICAL_METHODS.md §12). Sanity reference only — not valid near the
 * hole. Returns NaN for non-positive b.
 */
export function deflectionAngleWeakField(impactParameter: number, massRg = 1): number {
  if (!Number.isFinite(impactParameter) || impactParameter <= 0) return NaN;
  return (4 * massRg) / impactParameter;
}

const BISECTION_TIGHT_SETTINGS = {
  stepSize: 0.002,
  minStep: 1e-9,
  maxStep: 250,
  maxSteps: 2_000_000,
} as const;

let cachedCriticalImpactParameter: { readonly massRg: number; readonly value: number } | null = null;

/**
 * Locate the critical impact parameter numerically by bisecting the capture
 * boundary in invariant b (docs/NUMERICAL_METHODS.md §11). Runs from
 * r0 = 2000*massRg with tight RK4 settings; runs that neither capture nor
 * escape within budget count as captured-side (they wind indefinitely near
 * the boundary). Memoized per mass. Returns NaN if no boundary is bracketed.
 */
export function criticalImpactParameter(massRg = 1): number {
  if (cachedCriticalImpactParameter && cachedCriticalImpactParameter.massRg === massRg) {
    return cachedCriticalImpactParameter.value;
  }
  const r0 = 2000 * massRg;
  const capturedSide = (b: number): boolean =>
    launchFromImpactParameter(b, {
      massRg,
      startRadiusRg: r0,
      escapeRadius: 2.2 * r0,
      ...BISECTION_TIGHT_SETTINGS,
    }).status !== 'escaped';

  let lo = 4.5 * massRg; // safely below b_c: captured
  let hi = 6 * massRg; // safely above b_c: escapes
  if (!(capturedSide(lo) && !capturedSide(hi))) {
    lo = 3.2 * massRg;
    hi = 9 * massRg;
    if (!(capturedSide(lo) && !capturedSide(hi))) {
      cachedCriticalImpactParameter = { massRg, value: NaN };
      return NaN;
    }
  }
  for (let i = 0; i < 100 && hi - lo > 1e-9 * lo; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (!(mid > lo && mid < hi)) break; // interval collapsed in binary64
    if (capturedSide(mid)) lo = mid;
    else hi = mid;
  }
  const value = 0.5 * (lo + hi);
  cachedCriticalImpactParameter = { massRg, value };
  return value;
}

/**
 * Exact Schwarzschild static-to-static gravitational frequency ratio
 * g = nu_obs/nu_emit = sqrt(f_emit/f_obs) with f = 1 - 2M/r
 * (docs/NUMERICAL_METHODS.md §16; docs/VALIDATION_VECTORS.md §12).
 * Returns NaN if either radius is at/inside the horizon.
 */
export function gravitationalRedshiftStatic(emitRadiusRg: number, obsRadiusRg: number, massRg = 1): number {
  const fEmit = 1 - (2 * massRg) / emitRadiusRg;
  const fObs = 1 - (2 * massRg) / obsRadiusRg;
  if (!(fEmit > 0) || !(fObs > 0)) return NaN;
  return Math.sqrt(fEmit / fObs);
}
