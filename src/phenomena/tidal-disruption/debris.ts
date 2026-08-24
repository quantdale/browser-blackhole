/**
 * TDE debris initialization and bound/unbound proxy (CA6-05 / CA6-07).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 6 (bound/unbound
 *   stream split approximation; ParticleService for gas accents);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 9 (deterministic
 *   classification proxy; no debris before disruption);
 * - docs/cosmic-atlas/RENDERING_SERVICES.md section 3 (particle fields);
 * - mission CA6-05/CA6-07 (seeded deterministic init, positions/velocities
 *   derived from the disruption state, bounded populations, reduced
 *   energy-based classification with exposed fractions).
 *
 * MODEL (disclosed reduced proxy):
 * - Debris elements are sampled INSIDE the stellar volume at the disruption
 *   moment (t = 0, periapsis) using a deterministic spherical-Fibonacci +
 *   golden-ratio radial sequence: NO random number generator is involved,
 *   so element i has identical coordinates for every seed/time evaluation.
 *   A seed-dependent fixed rotation gives presets distinct morphology.
 * - Specific-energy offset of element i (tidal-tensor first-order picture):
 *       d_eps_i = (d_i / R_*) * spread/2,
 *   where d_i is the signed distance along the star->BH axis (positive
 *   toward the BH). The near side gains energy (unbound tail), the far side
 *   loses it (bound tail) — the classical leading-order result. eps_com ~= 0
 *   for the exact parabolic encounter.
 * - Velocity assignment keeps each element on its OWN Keplerian energy:
 *       |v_i| = sqrt(|v_com|^2 + 2 d_eps_i), direction = v_com direction.
 *   Bound elements are slower (fall back), unbound faster (escape) — a
 *   continuous, monotone mapping of position to energy.
 * - Classification: bound <=> d_eps_i < 0 (parabolic COM energy).
 * - Partial stripping scales the effective spread by PARTIAL_SPREAD_FRACTION
 *   (disclosed proxy); fly-by encounters produce NO debris population.
 *
 * NOT claimed: hydrodynamic accuracy, self-gravity of the stream, realistic
 * mass distribution. The classification is an energy-ordering PROXY.
 */

import { mulberry32 } from '../../renderer/shared/ParticleService.js';
import { PARTIAL_SPREAD_FRACTION, type ResolvedTdeEncounter } from './types.js';

/**
 * Deterministic reference-plan size used for classification diagnostics
 * (CA6-07): fixed count, independent of quality tier, so debug fractions
 * are stable across tiers and machines.
 */
export const REFERENCE_PLAN_COUNT = 1024;

/** Deterministic debris-element record (scene units; SI-derived speeds). */
export interface DebrisElement {
  /** Position offset from the star centre at t=0, scene units. */
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  /** Signed distance toward the BH along the encounter axis, scene units. */
  readonly axisOffsetUnits: number;
  /** Specific-energy offset, J/kg (signed). */
  readonly deltaEpsJPerKg: number;
  /** Speed magnitude, scene units/s (v_com scaled by its energy offset). */
  readonly speedUnitsPerS: number;
  /** True when deltaEps < 0 (bound population). */
  readonly bound: boolean;
}

/**
 * Deterministic point inside the unit ball: spherical-Fibonacci direction i
 * combined with a golden-ratio radial fraction (cube-root for uniform volume
 * density). Pure function of the index — infinitely reproducible.
 */
export function debrisSampleDirection(
  count: number,
  index: number
): {
  x: number;
  y: number;
  z: number;
} {
  const n = Math.max(2, count);
  const ga = Math.PI * (3 - Math.sqrt(5)); // golden angle
  const z = 1 - (2 * (index + 0.5)) / n;
  const radiusXY = Math.sqrt(Math.max(0, 1 - z * z));
  const theta = ga * index;
  return { x: Math.cos(theta) * radiusXY, y: z, z: Math.sin(theta) * radiusXY };
}

/**
 * Build the deterministic debris plan at the disruption state.
 *
 * @param encounter resolved encounter (must be evaluated at t=0 geometry)
 * @param capacity element count to generate (bounded by caller/tier)
 * @param vComX,vComZ COM velocity components at disruption, units/s
 * @param starToBhX,Z unit vector from star toward the black hole (world)
 */
export function buildDebrisPlan(
  encounter: ResolvedTdeEncounter,
  capacity: number,
  vComX: number,
  vComZ: number,
  starToBhX: number,
  starToBhZ: number
): { elements: DebrisElement[]; boundCount: number; unboundCount: number } {
  const count = Math.max(0, Math.floor(capacity));
  const vCom = Math.hypot(vComX, vComZ);
  const elements: DebrisElement[] = [];
  let boundCount = 0;
  let unboundCount = 0;

  if (!(encounter.disrupts || encounter.partialStripping) || count === 0) {
    return { elements, boundCount, unboundCount };
  }

  // Seeded rigid rotation of the sampling lattice (preset variety without
  // per-element randomness): one angle drawn once per plan.
  const rng = mulberry32(encounter.seed >>> 0);
  const rot = rng() * Math.PI * 2;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  // Partial stripping narrows the energy band around zero.
  const spread =
    encounter.energySpreadJPerKg * (encounter.partialStripping ? PARTIAL_SPREAD_FRACTION : 1);

  for (let i = 0; i < count; i += 1) {
    const dir = debrisSampleDirection(count, i);
    // Radial fraction: golden-ratio sequence, cube root for uniform density.
    const frac = Math.cbrt(((i * 0.6180339887498949) % 1) * 0.98 + 0.01);
    // Rotate the lattice in XZ only (encounter plane); Y stays intact.
    const lx0 = dir.x;
    const lz0 = dir.z;
    const lx = lx0 * cosR - lz0 * sinR;
    const lz = lx0 * sinR + lz0 * cosR;
    const ly = dir.y;

    const offsetRadius = frac * encounter.rStarUnits;
    const ox = lx * offsetRadius;
    const oy = ly * offsetRadius;
    const oz = lz * offsetRadius;

    // Signed offset along star->BH axis (positive toward the BH).
    const axisOffset = ox * starToBhX + oz * starToBhZ;
    const deltaEps = (axisOffset / encounter.rStarUnits) * (spread / 2);
    const speed = Math.sqrt(Math.max(vCom * vCom + 2 * deltaEps, (0.05 * vCom) ** 2));
    const bound = deltaEps < 0;
    if (bound) boundCount += 1;
    else unboundCount += 1;

    elements.push({
      ox,
      oy,
      oz,
      axisOffsetUnits: axisOffset,
      deltaEpsJPerKg: deltaEps,
      speedUnitsPerS: speed,
      bound
    });
  }

  return { elements, boundCount, unboundCount };
}

/** Aggregate classification fractions (exposed in the debug snapshot). */
export function classificationFractions(
  boundCount: number,
  total: number
): {
  boundFraction: number;
  unboundFraction: number;
} {
  const totalSafe = Math.max(1, total);
  return {
    boundFraction: boundCount / totalSafe,
    unboundFraction: Math.max(0, total - boundCount) / totalSafe
  };
}
