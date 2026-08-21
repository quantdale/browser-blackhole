/**
 * CODATA physical constants and the geometric-unit conversion layer.
 *
 * Spec sources implemented here (do not drift without updating docs):
 * - docs/NUMERICAL_METHODS.md section 1: core geometry uses geometric units
 *   G = c = 1 with lengths measured in r_g = GM/c^2; horizon at r = 2 r_g,
 *   photon sphere at r = 3 r_g, Schwarzschild ISCO at r = 6 r_g. UI-facing
 *   unit conversions live outside the integrator; this module IS that
 *   explicit conversion layer required by AGENTS.md ("Physics" principles).
 * - docs/NUMERICAL_METHODS.md section 11: critical impact parameter
 *   b_c = 3*sqrt(3)*M ~= 5.196152422706632 M.
 *
 * Pure TypeScript: no three.js imports, no shader code, so this module is
 * usable from CPU reference solvers, node-side fixture generators, and
 * browser code alike.
 *
 * Constant provenance (cited so every value is auditable):
 * - c is exact: it defines the SI metre (17th CGPM, 1983).
 * - G is the CODATA 2018 recommended value, retained unchanged by CODATA
 *   2022; relative standard uncertainty 2.2e-5. G is NOT an exact constant.
 * - GM_sun is the IAU 2015 Resolution B3 NOMINAL solar mass parameter, a
 *   defined nominal constant (hence exact by convention).
 * - The kilogram value of the solar mass is derived here as GM_sun / G and
 *   therefore inherits G's ~2.2e-5 relative uncertainty; treat it as nominal
 *   only. Conversions that multiply GM_sun directly (`metersPerRg`,
 *   `secondsPerRgTime`) do NOT inherit that uncertainty because GM_sun is
 *   defined.
 */

/**
 * Newtonian constant of gravitation, m^3 kg^-1 s^-2.
 * CODATA 2018 (retained CODATA 2022): 6.67430(15)e-11.
 */
export const GRAVITATIONAL_CONSTANT = 6.6743e-11;

/**
 * Speed of light in vacuum, m s^-1. Exact (definition of the SI metre,
 * 17th CGPM, 1983).
 */
export const SPEED_OF_LIGHT = 299792458;

/**
 * IAU 2015 Resolution B3 nominal solar mass parameter GM_sun^N, m^3 s^-2.
 * A defined nominal constant (exact by convention); measured heliocentric
 * values agree to ~10 digits.
 */
export const NOMINAL_SOLAR_MASS_PARAMETER = 1.3271244e20;

/**
 * Nominal solar mass in kilograms, derived as GM_sun^N / G. Inherits G's
 * ~2.2e-5 relative standard uncertainty (~1.98841e30 kg).
 */
export const SOLAR_MASS_KG = NOMINAL_SOLAR_MASS_PARAMETER / GRAVITATIONAL_CONSTANT;

/** Horizon radius of a Schwarzschild black hole, r = 2M in r_g units. */
export const horizonRadiusRg = 2;

/** Photon-sphere radius of a Schwarzschild black hole, r = 3M in r_g units. */
export const photonSphereRadiusRg = 3;

/** Schwarzschild ISCO radius, r = 6M in r_g units. */
export const iscoRadiusRg = 6;

/**
 * Gravitational radius r_g = GM/c^2 in metres for a hole of `massSolar`
 * solar masses. One solar-mass r_g ~= 1476.625 m (Schwarzschild radius
 * ~= 2.953 km). Returns NaN for negative or non-finite input.
 */
export function metersPerRg(massSolar: number): number {
  if (!Number.isFinite(massSolar) || massSolar < 0) return NaN;
  return (massSolar * NOMINAL_SOLAR_MASS_PARAMETER) / (SPEED_OF_LIGHT * SPEED_OF_LIGHT);
}

/**
 * Geometric unit of time t_g = GM/c^3 = r_g/c in seconds for a hole of
 * `massSolar` solar masses (~4.9255 microseconds per solar mass). Returns
 * NaN where {@link metersPerRg} does.
 */
export function secondsPerRgTime(massSolar: number): number {
  const meters = metersPerRg(massSolar);
  if (!Number.isFinite(meters)) return NaN;
  return meters / SPEED_OF_LIGHT;
}

/**
 * Convert a mass in solar masses to the geometric (G = c = 1) mass
 * parameter, which has dimension of length: M_geo = G*M/c^2 in metres.
 * Numerically identical to {@link metersPerRg} because r_g is DEFINED as
 * GM/c^2, i.e. the mass parameter equals one r_g; expressed in units of the
 * hole's own r_g the mass parameter is identically 1
 * (docs/NUMERICAL_METHODS.md section 1). Returns NaN for invalid input.
 */
export function solarMassToGeometricMass(massSolar: number): number {
  return metersPerRg(massSolar);
}

/**
 * Asymptotic critical impact parameter b_c = 3*sqrt(3)*M
 * ~= 5.196152422706632 * massRg (docs/NUMERICAL_METHODS.md section 11,
 * analytic form). Rays with b < b_c are captured, b > b_c escape; near b_c
 * deflection diverges logarithmically. Returns NaN for invalid input.
 */
export function criticalImpactParameter(massRg = 1): number {
  if (!Number.isFinite(massRg) || massRg < 0) return NaN;
  return 3 * Math.sqrt(3) * massRg;
}

/**
 * Schwarzschild lapse/metric factor f(r) = 1 - 2M/r for the static
 * spacetime (docs/NUMERICAL_METHODS.md sections 2 and 7).
 *
 * Guarded: returns NaN unless inputs are finite, massRg >= 0, and
 * r > 2*massRg strictly. Inside or on the horizon the static-observer
 * tetrad this factor supports does not exist and f <= 0, so callers receive
 * NaN instead of a silently wrong sign/magnitude.
 */
export function schwarzschildF(r: number, massRg: number): number {
  if (!Number.isFinite(r) || !Number.isFinite(massRg) || massRg < 0 || !(r > 2 * massRg)) {
    return NaN;
  }
  return 1 - (2 * massRg) / r;
}
