/**
 * TDE disruption criterion and diagnostics proxy (CA6-04).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md (penetration scenario
 *   semantics; no free slider implying exact TDE hydrodynamics);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 9 (encounter geometry,
 *   deterministic classification);
 * - mission CA6-04 (centralized criterion, derived from documented stellar/
 *   BH/encounter parameters, deterministic, explainable, distinguishes the
 *   scientific proxy from relativistic capture/plunge physics).
 *
 * CRITERION (centralized conventions, see types.ts):
 * - beta = r_t / r_p with r_t = R_* (M_BH/M_*)^(1/3);
 * - beta >= 1            -> full disruption;
 * - BETA_PARTIAL_STRIPPING <= beta < 1 -> partial stripping (star survives);
 * - beta < PARTIAL       -> fly-by (no significant stripping in this model);
 * - periapsis inside the horizon -> "direct capture" flag. This is a NEWTONIAN
 *   geometric statement about where our trajectory model is no longer a
 *   meaningful presentation; it is NOT a relativistic plunge/capture
 *   computation. Supported presets never enter this regime silently: the
 *   normalizer bounds M_BH far below the Hills limit.
 */

import {
  BETA_FULL_DISRUPTION,
  BETA_PARTIAL_STRIPPING,
  type ResolvedTdeEncounter
} from './types.js';

/** Outcome class of an encounter under the reduced criterion. */
export type DisruptionOutcome =
  'full-disruption' | 'partial-stripping' | 'fly-by' | 'direct-capture';

export interface DisruptionVerdict {
  readonly outcome: DisruptionOutcome;
  /** Penetration factor of the encounter. */
  readonly beta: number;
  /** Tidal radius / periapsis / horizon, scene units. */
  readonly rtUnits: number;
  readonly rpUnits: number;
  readonly horizonUnits: number;
  /**
   * Human-explainable reason string (debug snapshot / tests): states which
   * threshold decided the outcome and the numeric margins.
   */
  readonly reason: string;
}

/**
 * Deterministic disruption decision for a resolved encounter. Pure; total;
 * every field finite for any resolved encounter.
 */
export function disruptionVerdict(encounter: ResolvedTdeEncounter): DisruptionVerdict {
  if (!encounter.outsideHorizon) {
    return {
      outcome: 'direct-capture',
      beta: encounter.beta,
      rtUnits: encounter.rtUnits,
      rpUnits: encounter.rpUnits,
      horizonUnits: encounter.horizonUnits,
      reason:
        `periapsis r_p=${encounter.rpUnits.toPrecision(4)} units lies inside the ` +
        `horizon ${encounter.horizonUnits.toPrecision(4)} units: the Newtonian encounter ` +
        `model is not meaningful there (relativistic capture regime, not modeled).`
    };
  }
  if (encounter.beta >= BETA_FULL_DISRUPTION) {
    return {
      outcome: 'full-disruption',
      beta: encounter.beta,
      rtUnits: encounter.rtUnits,
      rpUnits: encounter.rpUnits,
      horizonUnits: encounter.horizonUnits,
      reason:
        `beta=${encounter.beta.toFixed(2)} >= full-disruption threshold ` +
        `${BETA_FULL_DISRUPTION.toFixed(2)} (r_t=${encounter.rtUnits.toFixed(1)} units, ` +
        `r_p=${encounter.rpUnits.toFixed(1)} units).`
    };
  }
  if (encounter.beta >= BETA_PARTIAL_STRIPPING) {
    return {
      outcome: 'partial-stripping',
      beta: encounter.beta,
      rtUnits: encounter.rtUnits,
      rpUnits: encounter.rpUnits,
      horizonUnits: encounter.horizonUnits,
      reason:
        `beta=${encounter.beta.toFixed(2)} is in the partial-stripping band ` +
        `[${BETA_PARTIAL_STRIPPING.toFixed(2)}, ${BETA_FULL_DISRUPTION.toFixed(2)}): envelope ` +
        `strips partially, star survives in the reduced model.`
    };
  }
  return {
    outcome: 'fly-by',
    beta: encounter.beta,
    rtUnits: encounter.rtUnits,
    rpUnits: encounter.rpUnits,
    horizonUnits: encounter.horizonUnits,
    reason:
      `beta=${encounter.beta.toFixed(2)} < partial-stripping threshold ` +
      `${BETA_PARTIAL_STRIPPING.toFixed(2)}: tidal distortion without significant stripping.`
  };
}
