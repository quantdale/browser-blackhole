/**
 * Compact Merger short-GRB bipolar jet model (CA5-08/CA5-09).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 4 (short GRB;
 *   procedural jet with viewing-angle constraints);
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md section "Compact
 *   Merger" (jet opening SCENARIO, not a freeform physical slider);
 * - mission section 14 (on-axis response > off-axis; bipolar symmetry;
 *   bounded values; observer angle never mutates intrinsic state; no NaNs
 *   near angular extrema; intrinsic state vs orientation vs presentation
 *   gain clearly separated).
 *
 * MODEL (disclosed reduced kinematic jet with standard-beaming-inspired
 * viewing response):
 * - INTRINSIC STATE: front radius R_j(tau) = beta_j c (tau - tau0) capped at
 *   JET_FRONT_EJECTA_CAP x the contemporaneous ejecta radius (a beta*c
 *   outflow would outrun any bounded presentation volume; the cap encodes
 *   deceleration against the ejecta qualitatively and is disclosed here —
 *   same presentation-coherence pattern as the stellar-explosion jet).
 * - ORIENTATION: the jet axis is the orbital polar axis (+Y), fixed.
 * - PRESENTATION GAIN: viewing response is the inverse standard-beaming
 *   solid-angle factor,
 *       response(theta_v) = clamp( (1 - cos theta_j) / (1 - cos theta_v),
 *                                   RESPONSE_FLOOR, RESPONSE_MAX )
 *   ON-AXIS (theta_v -> 0) saturates at RESPONSE_MAX (the 0/0 extremum is
 *   guarded), OFF-axis falls to the floor; bounded and finite everywhere
 *   (mission section 14). The intrinsic state is NOT mutated by the viewing
 *   angle — only this presentation gain is.
 */

import { ejectaRadiusUnits } from './ejecta.js';
import type { ResolvedMergerScenario } from './types.js';

/** Jet-front cap relative to the contemporaneous ejecta radius (disclosed). */
export const JET_FRONT_EJECTA_CAP = 2.5;
/**
 * Presented jet-front speed, scene units/s (presentation scale — see the
 * ejecta module compression disclosure; NOT a physical beta*c claim).
 */
export const JET_FRONT_UNITS_S = 6;
/** Off-axis response floor (jet never fully invisible while active). */
export const RESPONSE_FLOOR = 0.04;
/** Maximum presentation gain applied to the on-axis lobe. */
export const RESPONSE_MAX = 1;

/** Seconds since contact (0 before contact). */
export function jetAgeSeconds(tSeconds: number, contactSeconds: number): number {
  const t = Number.isFinite(tSeconds) ? tSeconds : 0;
  const tc = Number.isFinite(contactSeconds) ? contactSeconds : 0;
  return Math.max(0, t - tc);
}

/**
 * Jet front radius, scene units. 0 before engine ignition; capped by the
 * contemporaneous ejecta envelope (presentation-coherence cap, disclosed).
 */
export function jetFrontRadiusUnits(tauSeconds: number, scenario: ResolvedMergerScenario): number {
  if (scenario.jetScenario === 'none') return 0;
  const tau = jetAgeSeconds(tauSeconds, scenario.contactSeconds);
  const sinceIgnition = tau - scenario.jetDelaySeconds;
  if (sinceIgnition <= 0) return 0;
  const raw = JET_FRONT_UNITS_S * sinceIgnition;
  const ejecta = ejectaRadiusUnits(tau);
  const capped = Math.min(raw, JET_FRONT_EJECTA_CAP * Math.max(ejecta, 1e-6));
  return Number.isFinite(capped) && capped > 0 ? capped : 0;
}

/**
 * Viewing response in [RESPONSE_FLOOR, RESPONSE_MAX]: presentation gain for
 * an observer at `viewingAngleDeg` from the jet (+polar) axis. Monotone
 * NON-INCREASING in the viewing angle (on-axis saturated, off-axis floor);
 * pure; bounded; finite at both extrema. The intrinsic state is NOT mutated
 * by the viewing angle — only this gain is.
 */
export function jetViewingResponse(
  viewingAngleDeg: number,
  scenario: ResolvedMergerScenario
): number {
  if (scenario.jetScenario === 'none') return 0;
  const halfOpeningRad =
    scenario.jetHalfOpeningRad > 0 ? scenario.jetHalfOpeningRad : (10 * Math.PI) / 180;
  const thetaV =
    (Number.isFinite(viewingAngleDeg) ? Math.min(90, Math.max(0, viewingAngleDeg)) : 75) *
    (Math.PI / 180);
  const numer = 1 - Math.cos(thetaV);
  const denom = Math.max(1 - Math.cos(halfOpeningRad), 1e-6);
  // Inverse beaming factor; the on-axis 0/0 extremum saturates at MAX.
  const raw = denom / Math.max(numer, 1e-6);
  const clamped = Math.min(RESPONSE_MAX, Math.max(RESPONSE_FLOOR, raw));
  return Number.isFinite(clamped) ? clamped : RESPONSE_FLOOR;
}

/** True when the jet presentation is active at time t (scenario + phase). */
export function jetActiveAt(tSeconds: number, scenario: ResolvedMergerScenario): boolean {
  if (scenario.jetScenario === 'none') return false;
  return jetFrontRadiusUnits(tSeconds, scenario) > 0;
}
