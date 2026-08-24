/**
 * TDE deterministic encounter trajectory (CA6-02).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 6 (encounter orbit;
 *   TrajectoryService reuse for the encounter);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 9 (star follows the
 *   configured encounter trajectory; periapsis behavior; scrub reversibility);
 * - mission CA6-02 (frame convention, explicit units, no non-finite states,
 *   position/velocity continuity, analytic invariants tested).
 *
 * MODEL (DIRECT reduced Newtonian two-body, parabolic):
 *
 *   Field stars arrive on near-parabolic orbits; we use the exact parabolic
 *   member (eccentricity e = 1). With periapsis q = r_p and gravitational
 *   parameter mu = G (M_BH + M_*), Barker's equation gives a CLOSED FORM in
 *   both directions (no iteration, perfectly scrubbable):
 *
 *     D     = tan(nu / 2)                       (nu = true anomaly)
 *     r(D)  = q (1 + D^2)
 *     t(D)  = sqrt(2 q^3 / mu) (D + D^3/3)
 *     D(t)  = cbrt(3M/2 + sqrt((3M/2)^2 + 1))
 *           + cbrt(3M/2 - sqrt((3M/2)^2 + 1)),   M = t / sqrt(2 q^3/mu)
 *
 *   Velocity from the parabolic elements:
 *     h = sqrt(mu p), p = 2q
 *     v_r = (mu/h) sin nu,  v_t = (mu/h)(1 + cos nu)
 *   then rotated into world axes. Periapsis speed is sqrt(2 mu/q).
 *
 * FRAME CONVENTION (matches compact-merger / stellar-explosion discipline):
 * - orbital plane = world XZ, +Y is the orbital polar axis;
 * - periapsis lies on +X at t = 0; motion proceeds clockwise when viewed
 *   from +Y (x = r cos nu, z = -r sin nu);
 * - internal coordinate is SECONDS RELATIVE TO PERIAPSIS PASSAGE
 *   (t < 0 inbound, t = 0 periapsis, t > 0 outbound).
 *
 * FIDELITY DISCLOSURE: Newtonian reduced trajectory. NOT a relativistic
 * stellar geodesic (no pericenter precession, no frame drag, no relativistic
 * timing correction); every supported preset keeps r_p >= ~40 r_g so
 * Newtonian presentation errors stay second order, and the destination
 * labels the model class accordingly.
 *
 * TrajectoryService note: ITrajectoryService.sampleKepler expects elliptic
 * elements (finite semi-major axis); a parabola has none, so this module
 * provides the authoritative closed-form sampler under the same frame
 * conventions. This mirrors the CA5 precedent where the quadrupole inspiral
 * law lives destination-local.
 */

import { METRES_PER_SCENE_UNIT, type ResolvedTdeEncounter } from './types.js';

/** Full trajectory sample: position (scene units) + velocity (units/s). */
export interface EncounterState {
  readonly timeSeconds: number;
  /** True anomaly, radians in (-pi, pi), sign matching the time sign. */
  readonly trueAnomaly: number;
  /** Barker variable D = tan(nu/2). */
  readonly barkerD: number;
  /** Orbital radius from the black hole, scene units. */
  readonly radiusUnits: number;
  /** Position relative to the black hole (origin), scene units. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Velocity components, scene units/s. */
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** Total speed, scene units/s. */
  readonly speedUnitsPerS: number;
}

/** Barker forward map: seconds since periapsis for Barker variable D. */
export function barkerSeconds(encounter: ResolvedTdeEncounter, d: number): number {
  return encounter.barkerSecondsPerD * (d + (d * d * d) / 3);
}

/** Radius r(D) = q (1 + D^2), scene units. */
export function encounterRadius(encounter: ResolvedTdeEncounter, d: number): number {
  return encounter.rpUnits * (1 + d * d);
}

/**
 * Inverse Barker's equation via Cardano's formula (exact for the depressed
 * cubic D^3 + 3D = 3M). Deterministic; never throws; NaN collapses to 0.
 */
export function inverseBarker(mPar: number): number {
  const m = Number.isFinite(mPar) ? mPar : 0;
  const half = (3 * m) / 2;
  const s = Math.sqrt(half * half + 1);
  // Math.cbrt handles negative operands natively.
  return Math.cbrt(half + s) + Math.cbrt(half - s);
}

/**
 * Evaluate the full encounter state at time `t` seconds relative to
 * periapsis. Pure; closed form in both directions; finite for any finite t.
 */
export function encounterStateAt(
  encounter: ResolvedTdeEncounter,
  tSeconds: number
): EncounterState {
  const t = Number.isFinite(tSeconds) ? tSeconds : 0;
  const mPar = t / Math.max(encounter.barkerSecondsPerD, 1e-300);
  const d = inverseBarker(mPar);

  const radius = encounterRadius(encounter, d);
  const nu = 2 * Math.atan(d);
  const cosNu = (1 - d * d) / (1 + d * d);
  const sinNu = (2 * d) / (1 + d * d);

  // Position in the orbital plane (+Y polar axis, periapsis on +X at t=0).
  const x = radius * cosNu;
  const z = -radius * sinNu;

  // Velocity in scene units: convert mu once through the unit length cube.
  const muUnits = encounter.muSiM3S2 / Math.pow(METRES_PER_SCENE_UNIT, 3);
  const pUnits = 2 * encounter.rpUnits;
  const vr = Math.sqrt(muUnits / pUnits) * sinNu;
  const vt = Math.sqrt(muUnits / pUnits) * (1 + cosNu);

  // Radial unit vector e_r = (cos nu, 0, -sin nu); transverse direction of
  // increasing nu e_nu = (-sin nu, 0, -cos nu) — consistent with z = -r sin.
  const vx = vr * cosNu - vt * sinNu;
  const vz = -vr * sinNu - vt * cosNu;

  return {
    timeSeconds: t,
    trueAnomaly: nu,
    barkerD: d,
    radiusUnits: radius,
    x,
    y: 0,
    z,
    vx,
    vy: 0,
    vz,
    speedUnitsPerS: Math.hypot(vr, vt)
  };
}

/**
 * Kepler-elements descriptor for diagnostics/tests. Documented
 * incompatibility with ITrajectoryService.sampleKepler: eccentricity 1 has
 * no finite semi-major axis, hence the destination-local closed-form
 * sampler above is authoritative.
 */
export function describeEncounterElements(encounter: ResolvedTdeEncounter): {
  eccentricity: 1;
  semiLatusRectumUnits: number;
  inclinationDeg: 0;
  periapsisUnits: number;
  muSiM3S2: number;
} {
  return {
    eccentricity: 1,
    semiLatusRectumUnits: 2 * encounter.rpUnits,
    inclinationDeg: 0,
    periapsisUnits: encounter.rpUnits,
    muSiM3S2: encounter.muSiM3S2
  };
}
