/**
 * Compact Merger remnant scenarios (CA5-11).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md section "Compact
 *   Merger" (avoid continuous freeform remnant selection; scenario-based
 *   selection is the documented preference);
 * - mission section 15 (small validated preset set: long-lived massive NS,
 *   prompt BH-like, delayed collapse; no implied predictive mass mapping).
 *
 * MODEL: scenario-driven PRESENTATION state only. The application does NOT
 * predict a remnant from arbitrary continuous component masses — the
 * scenario is an explicit user/preset choice, and the fidelity note says so.
 * Each scenario defines a deterministic central-object presentation envelope
 * (tint/gain/radius behavior) evaluated from time since contact.
 */

import { REMNANT_TEMPERATURE_K } from './types.js';
import { kelvinToLinearRgb } from './emission.js';
import type { ResolvedMergerScenario } from './types.js';
import type { RemnantScenarioId } from './types.js';

export const REMNANT_SCENARIO_IDS: readonly RemnantScenarioId[] = [
  'massive-ns',
  'prompt-bh',
  'delayed-collapse'
];

/** Resolved remnant presentation at time t (pure; finite; bounded). */
export interface RemnantSample {
  /** 0 = invisible/dark, 1 = fully emissive. */
  readonly gain: number;
  /** Linear RGB tint (blackbody proxy for the hot remnant). */
  readonly tint: readonly [number, number, number];
  /** Central-object radius, scene units (contact radius baseline). */
  readonly radiusUnits: number;
  /** Faint accretion-glow gain (prompt/delayed BH presentation only). */
  readonly glowGain: number;
}

const HOT_TINT = kelvinToLinearRgb(REMNANT_TEMPERATURE_K);

/** Evaluate the remnant presentation at time t for the scenario. */
export function remnantSampleAt(
  tSeconds: number,
  scenario: ResolvedMergerScenario,
  baselineRadiusUnits: number
): RemnantSample {
  const t = Number.isFinite(tSeconds) ? Math.max(0, tSeconds) : 0;
  const tau = Math.max(0, t - scenario.contactSeconds);
  const radius = Math.max(0.1, baselineRadiusUnits);

  switch (scenario.remnantScenario) {
    case 'massive-ns':
      // Long-lived hot remnant: bright at merger, presentation-fades toward
      // the kilonova peak (the ejecta light curve takes over the view).
      return {
        gain: tau <= 0 ? 0 : Math.max(0.35, 1 - (0.65 * tau) / 86400),
        tint: HOT_TINT,
        radiusUnits: radius * 0.92,
        glowGain: 0
      };
    case 'prompt-bh':
      // Prompt black-hole-like remnant: dark core + faint accretion glow.
      return {
        gain: 0,
        tint: HOT_TINT,
        radiusUnits: radius * 0.6,
        glowGain: tau <= 0 ? 0 : Math.max(0, 0.5 - tau / 5000)
      };
    case 'delayed-collapse':
      // Hot remnant that collapses at the scripted scenario time.
      if (tau < scenario.delayedCollapseSeconds) {
        return { gain: 1, tint: HOT_TINT, radiusUnits: radius * 0.92, glowGain: 0 };
      }
      return {
        gain: 0,
        tint: HOT_TINT,
        radiusUnits: radius * 0.6,
        glowGain: Math.max(0, 0.5 - (tau - scenario.delayedCollapseSeconds) / 5000)
      };
    default:
      return { gain: 0, tint: HOT_TINT, radiusUnits: radius, glowGain: 0 };
  }
}

/** True when a hot remnant surface should be visible at time t. */
export function remnantVisibleAt(tSeconds: number, scenario: ResolvedMergerScenario): boolean {
  const t = Number.isFinite(tSeconds) ? Math.max(0, tSeconds) : 0;
  if (t < scenario.contactSeconds) return false;
  if (scenario.remnantScenario === 'massive-ns') return true;
  if (scenario.remnantScenario === 'prompt-bh') return false;
  return t - scenario.contactSeconds < scenario.delayedCollapseSeconds;
}
