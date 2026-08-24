/**
 * TDE reduced stellar-deformation model (CA6-03).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 6 (tidal
 *   elongation increases near periapsis; renderer consumes derived model
 *   state);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 9 (deformation increases
 *   near the tidal encounter; bounded; deterministic);
 * - mission CA6-03 (bounded deformation, orientation follows geometry,
 *   explicit volume behavior, no disguised scale animation).
 *
 * MODEL (disclosed reduced proxy):
 * - Tidal-tensor amplitude at separation r: xi(r) = (r_t / r)^3 — the exact
 *   scaling of the quadrupole tide across a stellar diameter. Clamped to a
 *   bounded presentation cap so deep-penetration presets stay stable.
 * - Shape response: stretch along the star->BH axis
 *       s = 1 + DEFORMATION_GAIN * min(xi, XI_CAP)
 *   with transverse compression 1/sqrt(s), which preserves the ellipsoid
 *   VOLUME EXACTLY (a*b*c = R^3). Real disruptions strip mass instead of
 *   conserving volume; our presentation conserves it until the debris
 *   handoff — disclosed as a presentation choice, not physics.
 * - Orientation: long axis = unit vector from star toward the black hole.
 * - No disruption: gains collapse back toward spherical after periapsis for
 *   sub-threshold encounters (xi decreases outbound by construction).
 *
 * NOT claimed: fluid hydrodynamic ellipsoid evolution, Roche-envelope
 * overflow modeling, mass loss. The gain/cap constants are presentation
 * parameters chosen once, centrally, and tested for ordering/bounds.
 */

import { DEFORMATION_GAIN, DEFORMATION_STRETCH_CAP, type ResolvedTdeEncounter } from './types.js';

/** xi cap expressed through the shared stretch cap (single tuning point). */
export const XI_CAP = (DEFORMATION_STRETCH_CAP - 1) / DEFORMATION_GAIN;

/** Bounded tidal amplitude xi(r) = min((rt/r)^3, XI_CAP); finite at r -> 0. */
export function tidalAmplitude(encounter: ResolvedTdeEncounter, radiusUnits: number): number {
  const r = Number.isFinite(radiusUnits) && radiusUnits > 1e-9 ? radiusUnits : 1e-9;
  const rt = encounter.rtUnits;
  const xi = Math.pow(rt / r, 3);
  return Number.isFinite(xi) ? Math.min(xi, XI_CAP) : XI_CAP;
}

export interface DeformationState {
  /** Stretch factor along the long axis (>= 1, bounded). */
  readonly stretch: number;
  /** Transverse compression factor (<= 1) preserving volume with `stretch`. */
  readonly transverse: number;
  /** Unit vector of the long axis in world space (star -> black hole). */
  readonly axisX: number;
  readonly axisY: number;
  readonly axisZ: number;
  /** Raw clamped tidal amplitude used to derive the stretch. */
  readonly amplitude: number;
}

/**
 * Evaluate deformation from the CURRENT encounter geometry. Pure function
 * of (encounter, position relative to BH); renderer consumes this state,
 * never inventing deformation itself. Finite everywhere; bounded by
 * DEFORMATION_STRETCH_CAP by construction.
 */
export function deformationAt(
  encounter: ResolvedTdeEncounter,
  relX: number,
  relY: number,
  relZ: number
): DeformationState {
  const r = Math.hypot(relX, relY, relZ);
  const amplitude = tidalAmplitude(encounter, r);
  const stretchRaw = 1 + DEFORMATION_GAIN * amplitude;
  // Hard numeric guard (XI_CAP arithmetic can exceed the declared cap by
  // float rounding only); keeps the contract exact under all inputs.
  const stretch = Math.min(stretchRaw, DEFORMATION_STRETCH_CAP);
  const inv = r > 1e-9 ? -1 / r : 0; // NEGATED: axis points star -> BH
  return {
    stretch,
    transverse: 1 / Math.sqrt(Math.max(stretch, 1)),
    axisX: relX * inv,
    axisY: relY * inv,
    axisZ: relZ * inv,
    amplitude
  };
}
