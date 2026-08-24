/**
 * Centralized Kerr characteristic quantities — THE single authority for
 * horizons, ergosurface, spin-dependent ISCO, circular equatorial emitters,
 * and the emitter frequency ratio (M9-02/BH-203).
 *
 * Spec sources (implemented exactly; do not drift without updating docs):
 * - docs/KERR_BACKEND_ADR.md (locked conventions; every formula below cites
 *   its section):
 *     §1.9  horizons r+- = M +- sqrt(M^2 - a^2),
 *           ergosurface r_E(theta) = M + sqrt(M^2 - a^2 cos^2 theta)
 *     §1.16 circular equatorial emitters (Bardeen-Press-Teukolsky 1972,
 *           ApJ 178, 347, eqs. 2.16-2.20) in the LOCKED disk-corotating
 *           signed-spin form:
 *             Omega   = 1/(r^(3/2) + a*)            [+Y-corotating disk]
 *             u^t     = (r^(3/2) + a*)/sqrt(r^3 - 3r^2 + 2 a* r^(3/2))
 *             r_ph    = 2(1 + cos(2/3 arccos(-a*)))  [existence boundary]
 *             r_isco  = 3 + Z2 - sign(a*) sqrt((3-Z1)(3+Z1+2Z2))
 *     §1.15 Carter constant (diagnostic form)
 *
 * Convention highlights (see ADR §1.5):
 * - `aStar` is the SIGNED dimensionless spin a* = Jc/(GM^2). Positive spin =
 *   angular momentum parallel to world +Y; the thin disk ALWAYS orbits
 *   +Y-corotating (Omega > 0), so a* < 0 describes a retrograde disk and all
 *   formulas above automatically move the existence boundary outward.
 * - Geometric units G = c = 1, M = 1 internally: every returned radius is in
 *   r_g. Callers multiply by massRg where an absolute scene length is needed.
 * - No-circular-orbit radii return 0 (NOT Infinity/NaN) from the emitter
 *   functions — same caller contract as accretionDisk.emitterUt.
 *
 * Fidelity class: DIRECT — these are exact closed-form Kerr results, tested
 * against published reference vectors and the raw metric (normalization and
 * conservation checks live in tests/unit/kerrCharacteristics.test.ts and
 * tests/unit/kerrReference.test.ts).
 */

/** Hard mathematical domain boundary (extremal); production clamps lower. */
export const KERR_ABS_SPIN_EXTREMAL = 1;

/** Production spin clamp (mirrors src/app/state.ts STATE_RANGES.absSpin). */
export const KERR_ABS_SPIN_MAX = 0.998;

function requireFiniteSpin(aStar: number): number {
  if (!Number.isFinite(aStar)) {
    throw new RangeError(`kerr: spin must be finite, got ${String(aStar)}`);
  }
  if (Math.abs(aStar) > KERR_ABS_SPIN_EXTREMAL) {
    throw new RangeError(
      `kerr: sub-extremal spin required (|a*| <= ${KERR_ABS_SPIN_EXTREMAL}), got ${String(aStar)}`
    );
  }
  return aStar;
}

function requirePositiveRadius(rOverRg: number): number {
  if (!Number.isFinite(rOverRg) || rOverRg <= 0) {
    throw new RangeError(`kerr: radius must be finite and > 0, got ${String(rOverRg)}`);
  }
  return rOverRg;
}

// ---------------------------------------------------------------------------
// Horizons and ergosurface (ADR §1.9)
// ---------------------------------------------------------------------------

export interface KerrHorizonRadii {
  /** Outer event horizon r+ in r_g. */
  outerRg: number;
  /** Inner (Cauchy) horizon r- in r_g. */
  innerRg: number;
}

/**
 * Outer/inner event horizon radii in r_g for signed spin aStar (M = 1):
 * r+- = 1 +- sqrt(1 - a*^2). At a* = 0 this is the Schwarzschild result
 * (outer horizon 2, inner horizon collapsed onto r = 0); both radii meet
 * at r = M in the extremal |a*| -> 1 limit.
 */
export function kerrHorizonRadii(aStar: number): KerrHorizonRadii {
  const a = requireFiniteSpin(aStar);
  const root = Math.sqrt(Math.max(0, KERR_ABS_SPIN_EXTREMAL * KERR_ABS_SPIN_EXTREMAL - a * a));
  return { outerRg: 1 + root, innerRg: 1 - root };
}

/**
 * Outer ergosurface radius r_E(theta) = 1 + sqrt(1 - a*^2 cos^2 theta) in
 * r_g at the GIVEN polar angle theta from the spin axis (radians).
 * Distinct from the horizon everywhere off-axis (ADR §1.9: never visualize
 * the ergosurface as the horizon).
 */
export function kerrErgosphereRadius(aStar: number, thetaRad: number): number {
  const a = requireFiniteSpin(aStar);
  if (!Number.isFinite(thetaRad)) {
    throw new RangeError(`kerr: theta must be finite, got ${String(thetaRad)}`);
  }
  const cosTheta = Math.cos(thetaRad);
  return 1 + Math.sqrt(Math.max(0, 1 - a * a * cosTheta * cosTheta));
}

// ---------------------------------------------------------------------------
// Spin-dependent ISCO (ADR §1.16; Bardeen-Press-Teukolsky 1972 eq. 2.20)
// ---------------------------------------------------------------------------

/**
 * Radius (r_g) of the marginally stable circular equatorial orbit for the
 * +Y-COROTATING disk sense at SIGNED spin aStar (M = 1).
 *
 * Locked disk-corotating resolution of the BPT +- branch: the disk sense is
 * FIXED (+Y corotating) while the spin sign flips, so
 *
 *   r_isco(a*) = 3 + Z2 - sign(a*) sqrt((3-Z1)(3+Z1+2Z2)),
 *   Z1 = 1 + (1-a*^2)^(1/3)[(1+a*)^(1/3) + (1-a*)^(1/3)],
 *   Z2 = sqrt(3a*^2 + Z1^2),
 *
 * i.e. the prograde root for positive spin, the retrograde root for negative
 * spin, and exactly 6 at a* = 0 (the Schwarzschild ISCO). Monotone
 * non-increasing in a* over the supported domain (tested).
 */
export function kerrIscoRadius(aStar: number): number {
  const a = requireFiniteSpin(aStar);
  const cbrt = Math.cbrt;
  const z1 =
    1 +
    cbrt(KERR_ABS_SPIN_EXTREMAL * KERR_ABS_SPIN_EXTREMAL - a * a) *
      (cbrt(KERR_ABS_SPIN_EXTREMAL + a) + cbrt(KERR_ABS_SPIN_EXTREMAL - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  const root = Math.sqrt(Math.max(0, (3 - z1) * (3 + z1 + 2 * z2)));
  const sign = a === 0 ? 0 : Math.sign(a);
  return 3 + z2 - sign * root;
}

// ---------------------------------------------------------------------------
// Circular equatorial emitters (ADR §1.16; BPT eqs. 2.16-2.18)
// ---------------------------------------------------------------------------

/**
 * Equatorial circular PHOTON orbit radius for the +Y-corotating sense at
 * signed spin aStar (M = 1): r_ph = 2(1 + cos(2/3 arccos(-a*))).
 *
 * This is the hard existence boundary of the corotating circular family:
 * circular timelike/null orbits exist only for r > r_ph. At a* = 0 it equals
 * the Schwarzschild photon sphere 3; at a* -> +1 it tends to 1 (prograde) and
 * at a* -> -1 it tends to 4 (retrograde relative to the spin).
 */
export function kerrPhotonOrbitRadius(aStar: number): number {
  const a = requireFiniteSpin(aStar);
  const angle = (2 / 3) * Math.acos(Math.min(1, Math.max(-1, -a)));
  return 2 * (1 + Math.cos(angle));
}

/**
 * Coordinate angular velocity Omega (> 0) of the +Y-COROTATING circular
 * equatorial geodesic at radius rOverRg for signed spin aStar (M = 1):
 * Omega = 1/(r^(3/2) + a*). Returns 0 below the existence boundary
 * ({@link kerrPhotonOrbitRadius}) — same "no orbit" contract as
 * accretionDisk.emitterAngularVelocity consumers expect via {@link kerrEmitterUt}.
 */
export function kerrDiskAngularVelocity(aStar: number, rOverRg: number): number {
  const a = requireFiniteSpin(aStar);
  requirePositiveRadius(rOverRg);
  if (rOverRg <= kerrPhotonOrbitRadius(a)) {
    return 0;
  }
  return 1 / (Math.pow(rOverRg, 1.5) + a);
}

/**
 * Time component dt/dtau of the +Y-corotating circular equatorial
 * four-velocity at radius rOverRg, signed spin aStar (M = 1):
 *
 *   u^t = (r^(3/2) + a*) / sqrt(r^3 - 3r^2 + 2 a* r^(3/2)).
 *
 * Returns 0 when no circular orbit exists (denominator non-positive, i.e.
 * r <= r_ph(a*)) or input is non-finite. Normalization u.mu u^mu = -1 is
 * asserted against the RAW metric by tests (independent derivation check).
 */
export function kerrEmitterUt(aStar: number, rOverRg: number): number {
  const a = requireFiniteSpin(aStar);
  if (!Number.isFinite(rOverRg) || rOverRg <= 0) {
    return 0;
  }
  const r32 = Math.pow(rOverRg, 1.5);
  const denominator = rOverRg * rOverRg * (rOverRg - 3) + 2 * a * r32;
  if (!(denominator > 0)) {
    return 0;
  }
  return (r32 + a) / Math.sqrt(denominator);
}

/**
 * Combined gravitational + special-Doppler frequency ratio
 * g = nu_obs/nu_emit for a +Y-corotating circular equatorial emitter viewed
 * by a static observer at infinity, expressed through the conserved axial
 * impact parameter b_z = L_z/E of the TRACED ray (ADR §1.5/§1.16):
 *
 *   g = 1 / ( u^t (1 - Omega b_z) ).
 *
 * Structural mirror of accretionDisk.diskRedshiftFactor with the Kerr
 * emitter model; identical guards (no orbit -> 0; non-positive denominator
 * -> 0 meaning the emitter state is INVISIBLE, never extrapolated).
 */
export function kerrDiskRedshiftFactor(
  aStar: number,
  rOverRg: number,
  bzImpactParameter: number
): number {
  const ut = kerrEmitterUt(aStar, rOverRg);
  if (ut === 0 || !Number.isFinite(bzImpactParameter)) {
    return 0;
  }
  const omega = kerrDiskAngularVelocity(aStar, rOverRg);
  const denominator = ut * (1 - omega * bzImpactParameter);
  if (!(denominator > 0)) {
    return 0;
  }
  return 1 / denominator;
}

// ---------------------------------------------------------------------------
// Shared metric fragments (used by reference solver + tests)
// ---------------------------------------------------------------------------

/**
 * Boyer-Lindquist metric fragments at (r, theta) for signed spin aStar,
 * M = 1 (ADR §1.10; verified against Chandrasekhar Ch. III and multiple
 * independent tables):
 *
 *   Sigma = r^2 + a^2 cos^2theta
 *   Delta = r^2 - 2r + a^2
 *   A     = (r^2 + a^2)^2 - a^2 Delta sin^2theta
 */
export interface KerrMetricFragments {
  sigma: number;
  delta: number;
  aSq: number;
  sinTheta: number;
  cosTheta: number;
  sin2: number;
}

export function kerrFragments(
  rOverRg: number,
  thetaRad: number,
  aStar: number
): KerrMetricFragments {
  const a = requireFiniteSpin(aStar);
  requirePositiveRadius(rOverRg);
  if (!Number.isFinite(thetaRad)) {
    throw new RangeError(`kerr: theta must be finite, got ${String(thetaRad)}`);
  }
  const sinTheta = Math.sin(thetaRad);
  const cosTheta = Math.cos(thetaRad);
  return {
    sigma: rOverRg * rOverRg + a * a * cosTheta * cosTheta,
    delta: rOverRg * rOverRg - 2 * rOverRg + a * a,
    aSq: a * a,
    sinTheta,
    cosTheta,
    sin2: sinTheta * sinTheta
  };
}
