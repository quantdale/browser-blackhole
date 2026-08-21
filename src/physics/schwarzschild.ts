/**
 * Canonical Schwarzschild physics core: stable ray classification,
 * static-observer tetrad mapping, geodesic-plane reduction, radius-event
 * classification, and reference-ray diagnostics.
 *
 * Spec sources (implemented exactly; do not drift without updating docs):
 * - docs/NUMERICAL_METHODS.md
 *     section 2   static-observer tetrad map          -> staticTetradMap
 *     section 3   geodesic-plane construction         -> rayInitialStateFromWorld
 *     section 6   normalized null-constraint residual -> diagnostics contract
 *     section 10  event detection                     -> classifyRadiusEvent
 *     section 11  critical impact parameter cross-reference
 *     section 13  dedicated stable handling of nearly radial rays
 *     section 18  binary64 CPU reference vs f32 GPU precision split
 *     section 19  required per-ray diagnostics shape  -> RayTraceResult
 * - docs/SHADER_CONTRACTS.md section 6: stable integer classification codes
 *   0..6 shared with GPU debug render targets; codes must not be renumbered.
 *
 * Integration policy: the Hamiltonian ODE loop itself is OWNED by
 * src/phenomena/black-hole/cpuReference.ts and is imported here, never
 * duplicated. This module layers the classification enum, the plane-basis
 * construction, and the diagnostic result shape around it.
 *
 * All radii and positions in this module are r_g-native: lengths measured in
 * r_g = GM/c^2 of the traced hole, hence the Schwarzschild mass parameter is
 * identically M = 1 (docs/NUMERICAL_METHODS.md section 1). SI conversions
 * live in ./constants.js.
 *
 * Honest limitations (detailed on each symbol):
 * - cpuReference aliases numerical failure (non-finite state,
 *   constraint-residual blowup) to 'max-steps', so code RAY_MAX_STEPS may
 *   mean any of MAX_STEPS/NON_FINITE unless its result distinguishes them;
 *   only its degenerate-input branch (steps === 0) is separable and maps to
 *   RAY_INVALID_INITIAL_STATE. RAY_NON_FINITE is therefore never emitted by
 *   traceReferenceRay, only by classifyRadiusEvent for its own inputs.
 * - minRadius/windingRadians are reconstructed from strided pathSamples:
 *   estimates, not continuous extrema. maxConstraintResidual is unavailable
 *   from cpuReference's public result and is NaN.
 * - DISK_HIT is never produced by this module until crossing refinement
 *   (docs/NUMERICAL_METHODS.md section 10.2) lands in the owned integrator.
 *
 * Pure TypeScript: no three.js imports.
 */

import {
  DEFAULT_PHOTON_INTEGRATION_OPTIONS,
  integratePhoton
} from '../phenomena/black-hole/cpuReference.js';
import type { PhotonIntegrationOptions, Vec3 } from '../phenomena/black-hole/cpuReference.js';
import { schwarzschildF } from './constants.js';

// ---------------------------------------------------------------------------
// Stable classification codes (docs/SHADER_CONTRACTS.md section 6)
// ---------------------------------------------------------------------------

/** Ray still integrating. */
export const RAY_ACTIVE = 0;
/** Segment entered the capture band around the horizon. */
export const RAY_CAPTURED = 1;
/** Conservative escape criteria satisfied. */
export const RAY_ESCAPED = 2;
/** Thin-disk crossing accepted by refinement. */
export const RAY_DISK_HIT = 3;
/** Step budget exhausted without another terminal event. */
export const RAY_MAX_STEPS = 4;
/** State or inputs became non-finite. */
export const RAY_NON_FINITE = 5;
/** Inputs could not define a valid photon state at all. */
export const RAY_INVALID_INITIAL_STATE = 6;

/** Union of the stable integer codes above. */
export type RayClassificationCode =
  | typeof RAY_ACTIVE
  | typeof RAY_CAPTURED
  | typeof RAY_ESCAPED
  | typeof RAY_DISK_HIT
  | typeof RAY_MAX_STEPS
  | typeof RAY_NON_FINITE
  | typeof RAY_INVALID_INITIAL_STATE;

const CLASSIFICATION_NAMES: Record<number, string> = {
  [RAY_ACTIVE]: 'ACTIVE',
  [RAY_CAPTURED]: 'CAPTURED',
  [RAY_ESCAPED]: 'ESCAPED',
  [RAY_DISK_HIT]: 'DISK_HIT',
  [RAY_MAX_STEPS]: 'MAX_STEPS',
  [RAY_NON_FINITE]: 'NON_FINITE',
  [RAY_INVALID_INITIAL_STATE]: 'INVALID_INITIAL_STATE'
};

/**
 * Numerical-failure bucket covering codes 4-6 (docs/SHADER_CONTRACTS.md
 * section 6: application-facing logic may combine them into a single
 * NUMERICAL_FAILURE while debug mode keeps the specific reason).
 */
export function isNumericalFailure(code: number): boolean {
  return code === RAY_MAX_STEPS || code === RAY_NON_FINITE || code === RAY_INVALID_INITIAL_STATE;
}

/** Human-readable name for a classification code; unknown codes pass through. */
export function classificationName(code: number): string {
  return CLASSIFICATION_NAMES[code] ?? `UNKNOWN(${code})`;
}

// ---------------------------------------------------------------------------
// Per-ray diagnostics shape (docs/NUMERICAL_METHODS.md section 19)
// ---------------------------------------------------------------------------

/**
 * Required per-ray diagnostics (docs/NUMERICAL_METHODS.md section 19), with
 * two documented deviations from that section's literal sketch:
 * - `classification` carries the stable integer codes of
 *   docs/SHADER_CONTRACTS.md section 6 instead of a string union, so debug
 *   render targets can consume it unrenumbered.
 * - `diskHit` carries plane-polar coordinates plus hit order instead of a
 *   world position + affine parameter; world re-embedding is recoverable via
 *   {@link rayInitialStateFromWorld}'s plane basis, and cpuReference does not
 *   track affine parameters.
 * Unavailable quantities are NaN, never silently zero.
 */
export interface RayTraceResult {
  /** One of the RAY_* codes above. Kept as plain `number` so render-target packing needs no casts. */
  classification: number;
  /** Integrator steps consumed. */
  steps: number;
  /**
   * Smallest radius reached, in r_g. Reconstructed from strided pathSamples
   * plus the terminal position: an estimate that underestimates nothing but
   * may miss the exact periapsis between samples; NaN if no samples exist.
   */
  minRadius: number;
  /** Terminal radius in r_g. */
  finalRadius: number;
  /**
   * Total absolute winding angle in radians, accumulated between consecutive
   * projected path samples. Reliable when consecutive samples subtend less
   * than pi (automatic stride normally ensures this); underestimates near
   * criticality when stride skips whole loops. NaN if unreconstructable.
   */
  windingRadians: number;
  /**
   * Maximum normalized null-constraint residual R_H seen along the ray
   * (docs/NUMERICAL_METHODS.md section 6). cpuReference monitors this
   * internally but does not expose it; NaN until it does.
   */
  maxConstraintResidual: number;
  /** Present only on DISK_HIT; not produced by the current wrapper. */
  diskHit?: {
    /** Crossing radius in r_g. */
    radiusRg: number;
    /** Plane azimuth of the crossing, radians. */
    phiRad: number;
    /** Crossing ordinal for multi-crossing disks (0 = first). */
    order: number;
  };
  /** Terminal local static-observer direction, present only on ESCAPED. */
  escapeDirection?: [number, number, number];
}

// ---------------------------------------------------------------------------
// Static-observer tetrad mapping (docs/NUMERICAL_METHODS.md section 2)
// ---------------------------------------------------------------------------

/** Tetrad-mapped coordinate components of one local photon direction. */
export interface StaticTetradMapResult {
  /** Coordinate time component k^t = 1/sqrt(f). */
  kt: number;
  /** Coordinate radial component k^r = sqrt(f) n_r. */
  kr: number;
  /** Coordinate polar component k^theta = n_theta / r. */
  kTheta: number;
  /** Coordinate azimuthal component k^phi = n_phi / (r sin(theta)); NaN on the axis. */
  kPhi: number;
  /** Conserved energy E = sqrt(f) for the k^(t)=1 local normalization. */
  energyE: number;
  /** Impact parameter b = L/E = r sqrt(1 - n_r^2) / sqrt(f); scaling-invariant. */
  impactParameterB: number;
  /**
   * Covariant initial radial momentum p_r = g_rr k^r = n_r / sqrt(f) in the
   * tetrad normalization. For the E=1 rescaling used inside cpuReference use
   * p_r/E = n_r / f instead (docs/NUMERICAL_METHODS.md section 7).
   */
  initialPr: number;
}

/** Direction magnitudes within this deviation of 1 are accepted as unit. */
const DIRECTION_UNIT_TOLERANCE = 1e-9;
/** |sin(theta)| at or below this counts as the coordinate pole for k^phi. */
const POLE_SIN_TOLERANCE = 1e-12;

function allFinite(values: readonly number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

/**
 * Map a local static-observer photon direction onto Schwarzschild coordinate
 * components exactly per docs/NUMERICAL_METHODS.md section 2, with
 * k^(t) = 1 chosen because affine rescaling cannot change the null trajectory.
 *
 * Guards (all failures NaN-fill every field rather than throw):
 * - observer strictly outside the horizon: f(r) > 0 required (section 2);
 * - direction must be unit within {@link DIRECTION_UNIT_TOLERANCE}; small
 *   float excursions of n_r outside [-1, 1] are clamped;
 * - pole handling: sin(theta) is taken from `observerThetaRad`, which the
 *   section-2 formulas need but which cannot be derived from the direction
 *   cosines alone; it defaults to pi/2 (equatorial observer, sin = 1). On the
 *   rotation axis (|sin| <= POLE_SIN_TOLERANCE) ONLY `kPhi` degrades to NaN:
 *   the azimuthal coordinate component is genuinely undefined there
 *   (coordinate singularity) while every other quantity stays well-defined.
 *   Axis observers should perturb theta slightly or work in the (r, theta)
 *   sub-plane.
 */
export function staticTetradMap(
  observerRadiusRg: number,
  nR: number,
  nTheta: number,
  nPhi: number,
  massRg = 1,
  observerThetaRad = Math.PI / 2
): StaticTetradMapResult {
  const invalid: StaticTetradMapResult = {
    kt: NaN,
    kr: NaN,
    kTheta: NaN,
    kPhi: NaN,
    energyE: NaN,
    impactParameterB: NaN,
    initialPr: NaN
  };
  if (
    !allFinite([observerRadiusRg, nR, nTheta, nPhi, massRg, observerThetaRad]) ||
    observerRadiusRg <= 0 ||
    massRg < 0
  ) {
    return invalid;
  }
  const f = schwarzschildF(observerRadiusRg, massRg);
  if (!(f > 0)) return invalid;
  const dirMagnitude = Math.sqrt(nR * nR + nTheta * nTheta + nPhi * nPhi);
  if (!(Math.abs(dirMagnitude - 1) <= DIRECTION_UNIT_TOLERANCE)) return invalid;

  const nRc = Math.min(1, Math.max(-1, nR));
  const sqrtF = Math.sqrt(f);
  const sinTheta = Math.sin(observerThetaRad);
  const tangentialSquared = Math.max(0, 1 - nRc * nRc);
  return {
    kt: 1 / sqrtF,
    kr: sqrtF * nRc,
    kTheta: nTheta / observerRadiusRg,
    // Coordinate singularity on the rotation axis: see docstring.
    kPhi: Math.abs(sinTheta) <= POLE_SIN_TOLERANCE ? NaN : nPhi / (observerRadiusRg * sinTheta),
    energyE: sqrtF,
    impactParameterB: (observerRadiusRg * Math.sqrt(tangentialSquared)) / sqrtF,
    initialPr: nRc / sqrtF
  };
}

// ---------------------------------------------------------------------------
// Geodesic-plane construction (docs/NUMERICAL_METHODS.md sections 3 and 13)
// ---------------------------------------------------------------------------

/** Tangent magnitude below which a ray is flagged near-radial. */
export const NEAR_RADIAL_EPSILON = 1e-8;

/**
 * Result of reducing a world-space ray to its geodesic plane.
 * World point reconstruction along the trajectory uses
 * w(r, phi) = r * (cos(phi) e0 + sin(phi) e1) — identical to cpuReference's
 * embed(), so phi = 0 at launch, phi increases from e0 toward e1, and the
 * CPU/GPU sign convention stays shared (docs/NUMERICAL_METHODS.md section 3).
 */
export interface RayPlaneState {
  /** Launch state [r, phi] in r_g/radians; phi is 0 by construction. */
  position: [number, number];
  /** Radial cosine of the normalized world direction, dot(dHat, e0), clamped to [-1, 1]. */
  nR: number;
  /** Magnitude of the tangential part dHat - nR*e0 (= sin of the launch angle). */
  tangentMagnitude: number;
  /**
   * Euclidean chord moment |cross(pos, dHat)| = r * sin(launch angle) =
   * b * sqrt(f): the campaign-pinned invariant. EXACT identity given a unit
   * direction (cross(pos,dHat) = r*cross(e0,dHat), |cross(e0,dHat)|^2 = 1-nR^2),
   * but it equals the conserved impact parameter only asymptotically where
   * f -> 1; see {@link impactParameterConserved} for the section-2 value.
   */
  bInvariant: number;
  /** Normalized geodesic-plane normal N = normalize(cross(e0, e1)). */
  planeNormal: [number, number, number];
  /** True when the ray is near-radial and must never be divided by L (section 13). */
  nearRadial: boolean;
  /** True when inputs are unusable or the origin violates the static-observer condition. */
  invalid: boolean;
  /** Machine-readable reason when invalid; null otherwise. */
  invalidReason: string | null;
  /** Plane basis: outward radial unit vector at launch. */
  e0: [number, number, number];
  /** Plane basis: launch-tangential unit vector (deterministic fallback when near-radial). */
  e1: [number, number, number];
  /**
   * Conserved impact parameter per docs/NUMERICAL_METHODS.md section 2 for
   * the canonical M = 1 geometry: b = r sin(psi)/sqrt(f) = bInvariant/sqrt(f).
   * NaN when the origin lies at or inside the horizon (f <= 0).
   */
  impactParameterConserved: number;
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** World axis least aligned with e; guarantees a perpendicular component >= sqrt(2/3). */
function leastAlignedAxis(e: Vec3): Vec3 {
  const ax = Math.abs(e[0]);
  const ay = Math.abs(e[1]);
  const az = Math.abs(e[2]);
  if (ax <= ay && ax <= az) return [1, 0, 0];
  if (ay <= az) return [0, 1, 0];
  return [0, 0, 1];
}

function makeInvalidPlaneState(reason: string): RayPlaneState {
  return {
    position: [NaN, NaN],
    nR: NaN,
    tangentMagnitude: NaN,
    bInvariant: NaN,
    planeNormal: [NaN, NaN, NaN],
    nearRadial: false,
    invalid: true,
    invalidReason: reason,
    e0: [NaN, NaN, NaN],
    e1: [NaN, NaN, NaN],
    impactParameterConserved: NaN
  };
}

/**
 * Reduce a world-space camera-style ray to its geodesic plane exactly per
 * docs/NUMERICAL_METHODS.md section 3:
 *
 *   e0 = normalize(origin);
 *   T  = dHat - (dot(dHat, e0)) e0;   e1 = normalize(T);
 *   N  = normalize(cross(e0, e1)).
 *
 * Positions are relative to the black-hole center (world-frame convention,
 * src/physics/worldFrame.ts: center at origin, default disk normal +Y — the
 * `diskNormalWorld` default mirrors worldFrame.DEFAULT_DISK_NORMAL without
 * importing it, keeping this module dependency-free).
 *
 * Near-radial rays (tangentMagnitude < NEAR_RADIAL_EPSILON) are FLAGGED, not
 * divided through: normalizing a ~1e-8 vector would amplify float noise into
 * the plane basis (docs/NUMERICAL_METHODS.md section 13). The threshold sits
 * far above cpuReference's internal 1e-12 hard-radial switch, so flagged rays
 * route callers to stable handling before ill-conditioning ever reaches the
 * integrator; a deterministic fallback basis orthogonal to e0, seeded by the
 * disk normal with a least-aligned-world-axis backup (always succeeds, since
 * the least-aligned axis keeps a >= sqrt(2/3) perpendicular component), keeps
 * embedding well-defined for the purely radial path too.
 *
 * Invalidity (`invalid` + `invalidReason`) covers non-finite components, a
 * zero origin, a zero direction, and origins at or inside the horizon
 * (r <= 2 in M=1 r_g-native units), where no static observer exists and
 * f <= 0 makes the conserved b undefined. Geometry fields remain filled
 * best-effort even then; only `impactParameterConserved` degrades to NaN.
 */
export function rayInitialStateFromWorld(
  originWorld: Vec3,
  dirWorld: Vec3,
  diskNormalWorld: Vec3 = [0, 1, 0]
): RayPlaneState {
  const r0 = Math.hypot(originWorld[0], originWorld[1], originWorld[2]);
  const dirLength = Math.hypot(dirWorld[0], dirWorld[1], dirWorld[2]);
  if (!allFinite([...originWorld, ...dirWorld])) {
    return makeInvalidPlaneState('origin or direction contains non-finite components');
  }
  if (!(r0 > 0)) return makeInvalidPlaneState('origin coincides with the black-hole center');
  if (!(dirLength > 0)) return makeInvalidPlaneState('direction vector has zero length');

  const e0: Vec3 = [originWorld[0] / r0, originWorld[1] / r0, originWorld[2] / r0];
  const dHat: Vec3 = [dirWorld[0] / dirLength, dirWorld[1] / dirLength, dirWorld[2] / dirLength];
  const nRaw = dot3(dHat, e0);
  const nR = Math.min(1, Math.max(-1, nRaw));
  const tx = dHat[0] - nR * e0[0];
  const ty = dHat[1] - nR * e0[1];
  const tz = dHat[2] - nR * e0[2];
  const tangentMagnitude = Math.hypot(tx, ty, tz);
  const nearRadial = tangentMagnitude < NEAR_RADIAL_EPSILON;

  let e1: Vec3;
  if (!nearRadial) {
    e1 = [tx / tangentMagnitude, ty / tangentMagnitude, tz / tangentMagnitude];
  } else {
    // Section 13: dedicated stable radial path; deterministic fallback plane.
    const dnLength = Math.hypot(diskNormalWorld[0], diskNormalWorld[1], diskNormalWorld[2]);
    e1 = [0, 0, 0];
    if (dnLength > 1e-12) {
      const seed: Vec3 = [
        diskNormalWorld[0] / dnLength,
        diskNormalWorld[1] / dnLength,
        diskNormalWorld[2] / dnLength
      ];
      const sd = dot3(seed, e0);
      const sx = seed[0] - sd * e0[0];
      const sy = seed[1] - sd * e0[1];
      const sz = seed[2] - sd * e0[2];
      const sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-12) e1 = [sx / sl, sy / sl, sz / sl];
    }
    if (e1[0] === 0 && e1[1] === 0 && e1[2] === 0) {
      // Mathematically guaranteed to succeed (see leastAlignedAxis).
      const seed = leastAlignedAxis(e0);
      const sd = dot3(seed, e0);
      const sx = seed[0] - sd * e0[0];
      const sy = seed[1] - sd * e0[1];
      const sz = seed[2] - sd * e0[2];
      const sl = Math.hypot(sx, sy, sz);
      e1 = [sx / sl, sy / sl, sz / sl];
    }
  }

  const rawN = cross3(e0, e1);
  const rawNLen = Math.hypot(rawN[0], rawN[1], rawN[2]);
  const planeNormal: Vec3 =
    rawNLen > 0 ? [rawN[0] / rawNLen, rawN[1] / rawNLen, rawN[2] / rawNLen] : [0, 0, 1];

  const f0 = schwarzschildF(r0, 1);
  const invalidOutsideHorizon = !(r0 > 2);

  return {
    position: [r0, 0],
    nR,
    tangentMagnitude,
    bInvariant: r0 * tangentMagnitude,
    planeNormal,
    nearRadial,
    invalid: invalidOutsideHorizon,
    invalidReason: invalidOutsideHorizon
      ? 'origin at or inside the horizon (r <= 2 in M=1 r_g-native units); static tetrad undefined'
      : null,
    e0,
    e1,
    impactParameterConserved: f0 > 0 ? (r0 * tangentMagnitude) / Math.sqrt(f0) : NaN
  };
}

// ---------------------------------------------------------------------------
// Radius-event classification (docs/NUMERICAL_METHODS.md section 10)
// ---------------------------------------------------------------------------

/** Options for {@link classifyRadiusEvent}; all values in canonical M=1 r_g units. */
export interface RadiusEventOptions {
  /** Capture band width ABOVE the horizon, absolute r_g: capture iff r <= 2 + captureEpsilon. */
  captureEpsilon: number;
  /** Conservative escape radius in r_g (section 10.3). */
  escapeRadiusRg: number;
  /** Maximum accepted remaining-deflection proxy, radians (section 10.3). */
  angularTolerance: number;
}

/**
 * Remaining-deflection proxy for escape testing (docs/NUMERICAL_METHODS.md
 * section 10.3). Weak-field deflection still ahead of a photon currently at
 * radius r with conserved impact parameter b is approximately
 * alpha_rem(b, r) = (4M/b) * (1 - sqrt(1 - (b/r)^2)), derived by integrating
 * the leading-order bending density 4M b / rho^3 along the straight chord
 * beyond the current radius. This bound is maximized over ALL b by grazing
 * trajectories (b -> r), where alpha_rem = 4M/r; smaller-b rays at the same r
 * have strictly less remaining bend. Using the b-independent supremum 4M/r
 * keeps the event test conservative without threading b through the event API.
 * Leading-order approximation by design; exact only far from the hole.
 */
function remainingDeflectionProxy(r: number): number {
  return 4 / r; // M = 1 in r_g-native units
}

/**
 * Classify one integration segment endpoint against the section-10 event
 * rules. Order matters and mirrors cpuReference: capture is checked BEFORE
 * escape (section 10.1 priority). Escape additionally requires outward radial
 * momentum across the WHOLE segment (prPrevious > 0 AND prNow > 0): a segment
 * straddling a radial turning point has its periapsis at or below r, realizes
 * exactly the grazing worst case, and must not escape yet. Non-finite state OR
 * non-finite options report RAY_NON_FINITE rather than silently ACTIVE.
 *
 * Returns one of RAY_CAPTURED, RAY_ESCAPED, RAY_ACTIVE, RAY_NON_FINITE.
 */
export function classifyRadiusEvent(
  r: number,
  prPrevious: number,
  prNow: number,
  opts: RadiusEventOptions
): number {
  if (
    !allFinite([
      r,
      prPrevious,
      prNow,
      opts.captureEpsilon,
      opts.escapeRadiusRg,
      opts.angularTolerance
    ])
  ) {
    return RAY_NON_FINITE;
  }
  if (r <= 2 + opts.captureEpsilon) return RAY_CAPTURED;
  const outwardThroughout = prPrevious > 0 && prNow > 0;
  if (
    r > opts.escapeRadiusRg &&
    outwardThroughout &&
    remainingDeflectionProxy(r) <= opts.angularTolerance
  ) {
    return RAY_ESCAPED;
  }
  return RAY_ACTIVE;
}

// ---------------------------------------------------------------------------
// Reference ray tracing wrapper over cpuReference.integratePhoton
// ---------------------------------------------------------------------------

/** Pass-through integrator controls (defaults from cpuReference). */
export type TraceReferenceRayOptions = Partial<PhotonIntegrationOptions>;

/** Wrap angle into (-pi, pi]. */
function wrapToPi(angle: number): number {
  const twoPi = 2 * Math.PI;
  let wrapped = (angle + Math.PI) % twoPi;
  if (wrapped < 0) wrapped += twoPi;
  return wrapped - Math.PI;
}

/**
 * Trace one reference ray with the owned double-precision integrator and
 * package the result as {@link RayTraceResult}
 * (docs/NUMERICAL_METHODS.md section 19, docs/SHADER_CONTRACTS.md section 7).
 *
 * Status mapping (documented honestly):
 * - 'captured'  -> RAY_CAPTURED
 * - 'escaped'   -> RAY_ESCAPED
 * - 'max-steps' -> RAY_INVALID_INITIAL_STATE when steps === 0 (cpuReference's
 *   degenerate-input branch: zero origin/direction, non-finite input, or
 *   observer at/inside the horizon), else RAY_MAX_STEPS. NOTE: cpuReference
 *   ALIASES numerical failure to 'max-steps' (non-finite state and
 *   constraint-residual blowup included, because its mandated status union
 *   has no distinct member), so RAY_MAX_STEPS may mean exhausted budget OR
 *   mid-flight numerical failure; RAY_NON_FINITE (5) is never produced here.
 *   Corner case: explicitly requesting maxSteps <= 0 also lands in
 *   RAY_MAX_STEPS rather than INVALID_INITIAL_STATE.
 *
 * Diagnostics provenance: steps/finalPosition/finalDirection/pathSamples come
 * straight from integratePhoton. minRadius and windingRadians are
 * reconstructed from the strided path samples (estimates; see field docs).
 * maxConstraintResidual is NaN (not exposed by cpuReference). diskHit is left
 * undefined: crossing refinement (section 10.2) is not implemented in the
 * owned integrator, so RAY_DISK_HIT never occurs from this wrapper yet.
 */
export function traceReferenceRay(
  originWorld: Vec3,
  dirWorld: Vec3,
  options: TraceReferenceRayOptions = {}
): RayTraceResult {
  const integration = integratePhoton(originWorld, dirWorld, options);
  const requestedMaxSteps = options.maxSteps ?? DEFAULT_PHOTON_INTEGRATION_OPTIONS.maxSteps;

  let classification: number;
  switch (integration.status) {
    case 'captured':
      classification = RAY_CAPTURED;
      break;
    case 'escaped':
      classification = RAY_ESCAPED;
      break;
    default:
      classification =
        integration.steps === 0 && requestedMaxSteps > 0
          ? RAY_INVALID_INITIAL_STATE
          : RAY_MAX_STEPS;
  }

  // Plane basis reused for winding reconstruction; invalid/degenerate rays
  // yield NaN-filled vectors and the guards below keep diagnostics NaN.
  const plane = rayInitialStateFromWorld(originWorld, dirWorld);
  const planeUsable =
    !plane.invalid && Number.isFinite(plane.e0[0]) && Number.isFinite(plane.e1[0]);

  let minRadius = NaN;
  let windingRadians = NaN;
  if (integration.pathSamples.length > 0) {
    for (const sample of integration.pathSamples) {
      const rr = Math.hypot(sample[0], sample[1], sample[2]);
      minRadius = Number.isFinite(minRadius) ? Math.min(minRadius, rr) : rr;
    }
    if (planeUsable) {
      windingRadians = 0;
      let hasPrevious = false;
      let previousAngle = 0;
      for (const sample of integration.pathSamples) {
        const angle = Math.atan2(dot3(sample, plane.e1), dot3(sample, plane.e0));
        if (hasPrevious) windingRadians += Math.abs(wrapToPi(angle - previousAngle));
        previousAngle = angle;
        hasPrevious = true;
      }
    }
  }

  const finalRadius = Math.hypot(
    integration.finalPosition[0],
    integration.finalPosition[1],
    integration.finalPosition[2]
  );

  const result: RayTraceResult = {
    classification,
    steps: integration.steps,
    minRadius,
    finalRadius,
    windingRadians,
    maxConstraintResidual: NaN
  };

  if (classification === RAY_ESCAPED) {
    const fd = integration.finalDirection;
    result.escapeDirection = [fd[0], fd[1], fd[2]];
  }

  return result;
}
