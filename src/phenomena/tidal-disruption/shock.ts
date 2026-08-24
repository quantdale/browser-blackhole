/**
 * TDE shock emissivity and nascent-disk presentation models (CA6-09/CA6-10).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 6 (VolumeService
 *   for the shock region; forming accretion flow presentation);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 9 (phase-based resource
 *   systems turn off when not needed);
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md section 10 (TDE policy:
 *   procedural stream/shock/disk approximations, never SPH/GRMHD).
 *
 * SHOCK MODEL (disclosed reduced proxy): stream self-intersection shocks
 * circularize debris near the periapsis region. The presented emissivity is
 * an equatorial shell centered on the black hole whose characteristic
 * radius is the CIRCULARIZATION PROXY R_c = 2 q (classical order-of-
 * magnitude result for parabolic encounters: circularization near twice the
 * periapsis). The volume activates only during the shock phase; visual gain
 * is separated from the geometric state.
 *
 * NASCENT DISK MODEL (procedural, disclosed): after several fallback times
 * the bound flow presents as a thin equatorial annulus spreading between
 * the inner edge and R_c. This is NOT an accretion-disk simulation; inner
 * radius is PRESENTATIONAL (the reduced model has no viscous spreading law).
 */

import type { ResolvedTdeEncounter } from './types.js';

/** Circularization proxy: R_c = CIRCULARIZATION_FACTOR * q, scene units. */
export const CIRCULARIZATION_FACTOR = 2;

/** Characteristic shock-shell radius, scene units. */
export function shockRadiusUnits(encounter: ResolvedTdeEncounter): number {
  return CIRCULARIZATION_FACTOR * encounter.rpUnits;
}

/** Volume bounds radius for the shock region (shell + margin), scene units. */
export function shockBoundsRadiusUnits(encounter: ResolvedTdeEncounter): number {
  return shockRadiusUnits(encounter) * 1.25;
}

/** Deterministic shock ignition time: the model's own fallback time. */
export function shockStartSeconds(encounter: ResolvedTdeEncounter): number {
  return encounter.fallbackSeconds;
}

/**
 * Shock envelope gain envelope over elapsed time since disruption (pure;
 * 0 before ignition; smooth rise; slow decay). Presentation-only — the
 * geometric state is `shockRadiusUnits`, this multiplier is display gain.
 */
export function shockGainAt(
  encounter: ResolvedTdeEncounter,
  tSinceDisruptionSeconds: number,
  disrupts: boolean
): number {
  if (!disrupts) return 0;
  const t0 = shockStartSeconds(encounter);
  if (!(t0 > 0)) return 0;
  const tau = tSinceDisruptionSeconds / t0;
  if (tau < 0.85) return 0; // matches the timeline's shock-segment entry
  const rise = Math.min(1, (tau - 0.85) / 0.35);
  const decay = Math.exp(-Math.max(0, tau - 1.2) / 2.5);
  return Math.max(0, rise * decay);
}

/**
 * Nascent-disk geometry: [inner, outer] radii in scene units and the
 * ramp-in window start. The disk appears after several fallback times —
 * the disclosed procedural transition from the shocked stream.
 */
export function nascentDiskGeometry(encounter: ResolvedTdeEncounter): {
  innerRadiusUnits: number;
  outerRadiusUnits: number;
  startSeconds: number;
} {
  // Inner edge stays outside the ISCO landmark for every supported mass.
  const inner = Math.max(2 * encounter.iscoUnits, encounter.rpUnits * 0.6);
  return {
    innerRadiusUnits: inner,
    outerRadiusUnits: shockRadiusUnits(encounter),
    startSeconds: encounter.fallbackSeconds * 2.4
  };
}

/**
 * Disk gain ramp (pure; presentation-only multiplier in [0,1]).
 */
export function nascentDiskGainAt(
  encounter: ResolvedTdeEncounter,
  tSinceDisruptionSeconds: number,
  disrupts: boolean
): number {
  if (!disrupts) return 0;
  const start = nascentDiskGeometry(encounter).startSeconds;
  if (!(start > 0)) return 0;
  const tau = tSinceDisruptionSeconds / start;
  if (tau < 1) return 0;
  return Math.min(1, (tau - 1) / 1.5);
}
