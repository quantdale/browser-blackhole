/**
 * Neutron-star surface-ray reference — backwards Schwarzschild integration
 * terminating on the material stellar surface (M12-NS).
 *
 * Spec sources implemented here (do not drift without updating docs):
 * - openspec/changes/m12-neutron-star-surface-lensing/design.md
 *     §3   ray semantics: SURFACE_HIT / ESCAPED / NUMERICAL_FAILURE /
 *          INVALID_INITIAL_STATE — neutron-star-local outcomes; the black-hole
 *          stable integer codes 0..6 are NOT renumbered or reused here.
 *     §3.1 material-surface event: a backwards segment crossing from r > R_rg
 *          to r <= R_rg terminates the ray; the crossing is refined on the
 *          accepted segment before any would-be horizon logic could bind.
 *     §3.2 escape reuses the canonical conservative policy verbatim.
 *     §3.3 failures stay diagnosable; never mapped onto success.
 *     §5   this file IS the pure reference layer suggested there (three-free).
 * - docs/NUMERICAL_METHODS.md §2/§3/§4/§7/§9/§10/§13/§18: geodesic-plane
 *   reduction, E-normalized Hamiltonian RK4, radius-aware step policy,
 *   conservative escape, stable radial path, binary64 oracle role.
 *
 * Reuse architecture (design.md §4, architecture B): the Hamiltonian RHS,
 * the classical RK4 step, and the radius-aware step-size policy are IMPORTED
 * from the canonical owner src/phenomena/black-hole/cpuReference.ts — never
 * duplicated. Only the destination-local event wrapper lives here. The null-
 * constraint monitor (docs/NUMERICAL_METHODS.md §6) is a three-line documented
 * formula mirrored locally because cpuReference does not export it.
 *
 * Units: r_g-native (M = 1 by default), positions relative to the star center
 * at the world origin — the same convention as cpuReference. Callers convert
 * scene kilometres once via gravitationalRadiusKm(massSolar).
 *
 * Fidelity class: DIRECT (exterior Schwarzschild photon trajectory to a
 * static spherical material surface). Deliberate omissions disclosed in
 * ../physics.ts carry over unchanged: no Doppler/aberration, no frame
 * dragging, no atmosphere transfer, no interior solution.
 *
 * Determinism: no randomness anywhere; identical inputs produce bit-identical
 * outputs (binary64 IEEE-754, fixed iteration counts).
 */

import {
  DEFAULT_PHOTON_INTEGRATION_OPTIONS,
  rk4PlaneStep,
  stepSizeAt,
  type PhotonIntegrationOptions,
  type Vec3
} from '../black-hole/cpuReference.js';

// ---------------------------------------------------------------------------
// Classification contract (openspec design.md §3)
// ---------------------------------------------------------------------------

/** Terminal outcomes of a neutron-star surface ray. */
export type NeutronStarSurfaceClassification =
  'surface-hit' | 'escaped' | 'numerical-failure' | 'invalid-initial-state';

/** Normalized null-constraint residual failure threshold (NM §6). */
const CONSTRAINT_FAILURE_THRESHOLD = 1e-4;

/**
 * Tangential magnitude below which a ray takes the dedicated radial path
 * (NM §13); mirrors cpuReference's internal RADIAL_EPSILON so CPU reference
 * and GPU pass agree on the branch point.
 */
const RADIAL_EPSILON = 1e-12;

/**
 * Minimum sanctioned compact-surface radius, margin ABOVE the horizon in
 * r_g. At or inside 2 r_g no static material surface exists (physics.ts
 * compactness already rejects R <= 2 r_g); the extra margin keeps the
 * surface-crossing event numerically separated from the horizon band.
 */
export const MIN_SURFACE_RADIUS_RG = 2 + 1e-3;

/** Fixed default refinement iterations (same discipline as disk crossings). */
export const DEFAULT_BISECTION_ITERATIONS = 24;

function requireFinite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(
      `neutron-star/surfaceRayReference: ${label} must be a finite number (got ${String(value)}).`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Result / option shapes (openspec design.md §5; names are illustrative,
// semantics are contractual)
// ---------------------------------------------------------------------------

export interface NeutronStarSurfaceRayResult {
  classification: NeutronStarSurfaceClassification;
  /** Integrator steps consumed (0 for invalid initial states). */
  steps: number;
  /** Smallest radius reached, r_g (refined hit included). */
  minRadiusRg: number;
  /** Terminal radius, r_g (equals the surface radius on surface-hit). */
  finalRadiusRg: number;
  /** Total absolute planar winding accumulated per accepted step, radians. */
  windingRadians: number;
  /** Refined hit point, r_g, present only on surface-hit. */
  hitPositionRg?: Vec3;
  /** Unit outward surface normal at the hit, present only on surface-hit. */
  hitNormal?: Vec3;
  /**
   * Terminal local static-observer direction (tetrad projection, cpuReference
   * convention), present only on escaped.
   */
  escapeDirection?: Vec3;
  diagnostics: {
    /** Final refinement bracket width in segment parameter s; NaN otherwise. */
    refinementSpan: number;
    /** E-normalized conserved impact parameter b = L/E; NaN when undefined. */
    impactParameterB: number;
    /** True when the dedicated near-radial path was taken (NM §13). */
    radialMode: boolean;
  };
}

export interface SurfaceRayOptions extends Partial<PhotonIntegrationOptions> {
  /** Material surface radius in r_g. REQUIRED; must exceed MIN_SURFACE_RADIUS_RG. */
  surfaceRadiusRg: number;
  /** Refinement iterations for the bracketed surface crossing. */
  bisectionIterations?: number;
}

const DEFAULT_SURFACE_SETTINGS = {
  ...DEFAULT_PHOTON_INTEGRATION_OPTIONS,
  bisectionIterations: DEFAULT_BISECTION_ITERATIONS
};

// ---------------------------------------------------------------------------
// Analytic references
// ---------------------------------------------------------------------------

/**
 * Asymptotic apparent-limb impact parameter of a static spherical surface,
 * b_limb = R / sqrt(1 - 2M/R), valid ONLY in the regime R > 3 M (outside the
 * photon sphere; openspec design.md §6). Returns NaN outside that regime —
 * callers must not generalize the formula to ultra-compact radii.
 */
export function analyticLimbImpactParameter(surfaceRadiusRg: number, massRg = 1): number {
  requireFinite(surfaceRadiusRg, 'surfaceRadiusRg');
  requireFinite(massRg, 'massRg');
  if (!(surfaceRadiusRg > 3 * massRg)) return NaN;
  const f = 1 - (2 * massRg) / surfaceRadiusRg;
  return surfaceRadiusRg / Math.sqrt(f);
}

/**
 * Normalized null-constraint residual R_H of docs/NUMERICAL_METHODS.md §6
 * with E = 1 (local mirror; cpuReference owns the formulation, not an export).
 */
function constraintResidual(r: number, pr: number, m: number, b: number): number {
  const f = 1 - (2 * m) / r;
  const kinetic = f * pr * pr + (b * b) / (r * r);
  const twoH = Math.abs(kinetic - 1 / f);
  const denominator = Math.max(1 / f, kinetic, 1e-30);
  return twoH / denominator;
}

function wrapToPi(angle: number): number {
  const twoPi = 2 * Math.PI;
  let wrapped = (angle + Math.PI) % twoPi;
  if (wrapped < 0) wrapped += twoPi;
  return wrapped - Math.PI;
}

// ---------------------------------------------------------------------------
// Core tracer
// ---------------------------------------------------------------------------

/**
 * Trace one backwards camera ray through the exterior Schwarzschild spacetime
 * until it terminates on the material surface at `surfaceRadiusRg`, escapes
 * to the background, or fails diagnosably.
 *
 * Event priority per accepted step (openspec design.md §3):
 *   1. material-surface crossing (r_prev > R >= r) -> refine -> terminate hit
 *   2. defensive horizon-band check -> numerical-failure (unreachable while
 *      R > MIN_SURFACE_RADIUS_RG because event 1 fires strictly earlier; kept
 *      so a future caller error can never silently render a fake image)
 *   3. conservative escape (r > escapeRadius AND pr > 0) — cpuReference §10.3
 *      policy verbatim
 * Non-finite state or constraint blowup -> numerical-failure at any point.
 *
 * Refinement (§3.1): the crossing is bracketed on the accepted segment and
 * bisected in the segment parameter against the LINEARLY interpolated planar
 * state (r, phi) — the exact method the validated GPU disk-crossing path uses
 * (fixed iteration count; accuracy bounded by intra-segment curvature, never
 * concealed by normalization afterwards).
 */
export function traceSurfaceRay(
  posWorld: Vec3,
  dirWorld: Vec3,
  options: SurfaceRayOptions
): NeutronStarSurfaceRayResult {
  if (typeof options.surfaceRadiusRg !== 'number' || !Number.isFinite(options.surfaceRadiusRg)) {
    throw new TypeError(
      'neutron-star/surfaceRayReference: surfaceRadiusRg must be a finite number.'
    );
  }
  const R = options.surfaceRadiusRg;
  if (!(R > MIN_SURFACE_RADIUS_RG)) {
    throw new RangeError(
      `neutron-star/surfaceRayReference: surfaceRadiusRg ${R} must exceed ` +
        `MIN_SURFACE_RADIUS_RG (${MIN_SURFACE_RADIUS_RG}) r_g — no static material ` +
        'surface exists at or inside the horizon.'
    );
  }
  const o = { ...DEFAULT_SURFACE_SETTINGS, ...options };
  const m = o.massRg;
  const bisections = Math.max(1, Math.floor(o.bisectionIterations));

  const dirLength = Math.hypot(dirWorld[0], dirWorld[1], dirWorld[2]);
  const r0 = Math.hypot(posWorld[0], posWorld[1], posWorld[2]);
  // Static observer outside BOTH the horizon and the material surface.
  const degenerate =
    !Number.isFinite(dirLength) ||
    dirLength === 0 ||
    !Number.isFinite(r0) ||
    r0 === 0 ||
    !(r0 > 2 * m) ||
    !(r0 > R);
  if (degenerate) {
    return invalidResult();
  }

  // Geodesic-plane reduction (NM §3) — mirrors cpuReference.integratePhoton.
  const e0: Vec3 = [posWorld[0] / r0, posWorld[1] / r0, posWorld[2] / r0];
  const nx = dirWorld[0] / dirLength;
  const ny = dirWorld[1] / dirLength;
  const nz = dirWorld[2] / dirLength;
  const nRadial = nx * e0[0] + ny * e0[1] + nz * e0[2];
  const tx = nx - nRadial * e0[0];
  const ty = ny - nRadial * e0[1];
  const tz = nz - nRadial * e0[2];
  const tangential = Math.hypot(tx, ty, tz);
  const radialMode = tangential < RADIAL_EPSILON;

  const f0 = 1 - (2 * m) / r0;
  const angularMomentum = radialMode ? 0 : (r0 * tangential) / Math.sqrt(f0);
  const pr0 = nRadial / f0;
  const e1: Vec3 = radialMode ? [0, 0, 0] : [tx / tangential, ty / tangential, tz / tangential];

  const embed = (r: number, phi: number): Vec3 => {
    if (radialMode) return [r * e0[0], r * e0[1], r * e0[2]];
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    return [r * (c * e0[0] + s * e1[0]), r * (c * e0[1] + s * e1[1]), r * (c * e0[2] + s * e1[2])];
  };

  /** Terminal local static-observer direction (cpuReference.localDirection mirror). */
  const localDirection = (r: number, phi: number, pr: number): Vec3 => {
    const f = 1 - (2 * m) / r;
    const vr = f * pr;
    const vt = angularMomentum / r;
    const norm = Math.sqrt((vr * vr) / f + vt * vt);
    if (!(norm > 0)) return radialMode ? [...e0] : [...e0];
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

  let r = r0;
  let phi = 0;
  let pr = pr0;
  let steps = 0;
  let minRadius = r0;
  let winding = 0;

  while (steps < o.maxSteps) {
    const h = stepSizeAt(r, o);
    const rPrev = r;
    const phiPrev = phi;
    const next = rk4PlaneStep({ r, phi, pr }, h, m, angularMomentum);
    r = next.r;
    phi = next.phi;
    pr = next.pr;
    steps += 1;

    if (!Number.isFinite(r) || !Number.isFinite(phi) || !Number.isFinite(pr)) {
      return failureResult(steps, minRadius, r, angularMomentum, radialMode);
    }
    if (constraintResidual(r, pr, m, angularMomentum) > CONSTRAINT_FAILURE_THRESHOLD) {
      return failureResult(steps, minRadius, r, angularMomentum, radialMode);
    }

    winding += Math.abs(wrapToPi(phi - phiPrev));
    if (r < minRadius) minRadius = r;

    // --- 1. Material-surface event: terminate BEFORE any horizon logic.
    if (rPrev > R && r <= R) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < bisections; i += 1) {
        const mid = 0.5 * (lo + hi);
        const rMid = rPrev + mid * (r - rPrev);
        if (rMid > R) lo = mid;
        else hi = mid;
      }
      const sCross = 0.5 * (lo + hi);
      const rHit = rPrev + sCross * (r - rPrev);
      const phiHit = phiPrev + sCross * (phi - phiPrev);
      const hit = embed(rHit, phiHit);
      const hitLen = Math.hypot(hit[0], hit[1], hit[2]);
      const normal: Vec3 = [hit[0] / hitLen, hit[1] / hitLen, hit[2] / hitLen];
      return {
        classification: 'surface-hit',
        steps,
        minRadiusRg: Math.min(minRadius, rHit),
        finalRadiusRg: rHit,
        windingRadians: winding,
        hitPositionRg: hit,
        hitNormal: normal,
        diagnostics: {
          refinementSpan: hi - lo,
          impactParameterB: angularMomentum,
          radialMode
        }
      };
    }

    // --- 2. Defensive horizon band: unreachable for sanctioned surfaces.
    if (r <= 2 * m + o.captureEpsilon * m) {
      return failureResult(steps, minRadius, r, angularMomentum, radialMode);
    }

    // --- 3. Conservative escape (cpuReference §10.3 policy verbatim).
    if (r > o.escapeRadius && pr > 0) {
      return {
        classification: 'escaped',
        steps,
        minRadiusRg: minRadius,
        finalRadiusRg: r,
        windingRadians: winding,
        escapeDirection: localDirection(r, phi, pr),
        diagnostics: {
          refinementSpan: NaN,
          impactParameterB: angularMomentum,
          radialMode
        }
      };
    }
  }

  return failureResult(steps, minRadius, r, angularMomentum, radialMode);
}

function invalidResult(): NeutronStarSurfaceRayResult {
  return {
    classification: 'invalid-initial-state',
    steps: 0,
    minRadiusRg: NaN,
    finalRadiusRg: NaN,
    windingRadians: NaN,
    diagnostics: { refinementSpan: NaN, impactParameterB: NaN, radialMode: false }
  };
}

function failureResult(
  steps: number,
  minRadius: number,
  finalRadius: number,
  b: number,
  radialMode: boolean
): NeutronStarSurfaceRayResult {
  return {
    classification: 'numerical-failure',
    steps,
    minRadiusRg: minRadius,
    finalRadiusRg: finalRadius,
    windingRadians: NaN,
    diagnostics: { refinementSpan: NaN, impactParameterB: b, radialMode }
  };
}

// ---------------------------------------------------------------------------
// Impact-parameter launcher (cpuReference.launchFromImpactParameter mirror
// with surface termination) — used by the analytic limb validation and the
// CPU/GPU parity corpus construction.
// ---------------------------------------------------------------------------

export interface SurfaceImpactLaunchOptions extends SurfaceRayOptions {
  /** Source distance from the center in r_g; default max(100|b|, 1e4)*massRg. */
  startRadiusRg?: number;
}

/**
 * Fire a photon from far away whose conserved impact parameter b = L/E equals
 * `bInvariant` exactly (NM §2): the flat-chord perpendicular distance is
 * scaled by sqrt(f) at the source radius. Incoming direction is +x; the
 * source sits at (-x0, bFlat, 0).
 */
export function launchSurfaceRayFromImpactParameter(
  bInvariant: number,
  options: SurfaceImpactLaunchOptions
): NeutronStarSurfaceRayResult {
  const m = options.massRg ?? DEFAULT_PHOTON_INTEGRATION_OPTIONS.massRg;
  const r0 = options.startRadiusRg ?? Math.max(100 * Math.abs(bInvariant), 1e4) * m;
  const f0 = 1 - (2 * m) / r0;
  const bFlat = bInvariant * Math.sqrt(f0);
  const x0 = Math.sqrt(Math.max(0, r0 * r0 - bFlat * bFlat));
  const { startRadiusRg: _ignored, ...rest } = options;
  void _ignored;
  return traceSurfaceRay([-x0, bFlat, 0], [1, 0, 0], rest);
}

/**
 * Locate the hit/miss transition in impact parameter by bisection between a
 * known captured-side and escaped-side bracket. Deterministic; returns the
 * midpoint of the collapsed interval. Intended for reference/validation use
 * (not on the render path).
 */
export function findLimbTransitionBisection(
  capturedSideB: number,
  escapedSideB: number,
  options: SurfaceImpactLaunchOptions,
  iterations = 60
): number {
  let lo = capturedSideB;
  let hi = escapedSideB;
  for (let i = 0; i < iterations && hi - lo > 1e-9 * lo; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (launchSurfaceRayFromImpactParameter(mid, options).classification === 'surface-hit') {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
}
