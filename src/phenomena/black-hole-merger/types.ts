/**
 * Black-Hole Merger public state schema and derived contracts (CA8).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DATA_SOURCES_BBH_MERGER.md (provenance lock CA-ADR-021,
 *   trajectory gauge-dependence boundary, waveform representation);
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md §5 (minimum viable
 *   visualization; "Do not simulate numerical relativity live");
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md §9 (binary black-hole policy);
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §6 (one normalizer, clamp rules).
 *
 * FIDELITY CLASS (destination): DATA_DRIVEN dynamics (orbital progression,
 * waveform, metadata) with PROCEDURAL_SCIENTIFIC illustrative visuals and a
 * DIRECT Kerr reuse for the remnant phase. Every class boundary is disclosed
 * in presets.ts and the About/Fidelity panel.
 *
 * UNITS: the runtime timeline coordinate is NR geometric time in units of
 * the binary total mass M ("M"), aligned so t=0 is the source h22 amplitude
 * peak. NR data are scale-free — no absolute physical mass is claimed
 * anywhere; readouts use fractions of M.
 */

import type { QualityTier } from '../../atlas/types.js';

/** Reference datasets shipped for this destination (currently exactly one). */
export type ReferenceEventId = 'SXS-BBH-0001';

export const REFERENCE_EVENT_IDS: readonly ReferenceEventId[] = ['SXS-BBH-0001'];

/** Product phases (CA8-12). Anchors are DATA-DERIVED (see dataset.ts). */
export type BbmPhase = 'inspiral' | 'merger' | 'ringdown' | 'remnant';

export const BBM_PHASE_ORDER: readonly BbmPhase[] = ['inspiral', 'merger', 'ringdown', 'remnant'];

// ---------------------------------------------------------------------------
// Public state schema
// ---------------------------------------------------------------------------

export interface BlackHoleMergerPublicState {
  /** Pinned reference dataset id (validated against REFERENCE_EVENT_IDS). */
  referenceEvent: ReferenceEventId;
  /** Illustrative orbit-trail ribbons (presentation only). */
  showOrbitTrails: boolean;
  /**
   * Labeled ILLUSTRATIVE lensing proxies during inspiral/merger (dark-core +
   * photon-ring accents). Toggling never touches data-derived state.
   */
  illustrativeLensing: boolean;
}

export const DEFAULT_BBM_STATE: BlackHoleMergerPublicState = {
  referenceEvent: 'SXS-BBH-0001',
  showOrbitTrails: true,
  illustrativeLensing: true
};

/** The ONE normalizer every public value flows through (STATE_AND_ROUTES §6). */
export function normalizeBlackHoleMergerState(
  raw: Record<string, unknown>
): BlackHoleMergerPublicState {
  const referenceEvent =
    typeof raw['referenceEvent'] === 'string' &&
    (REFERENCE_EVENT_IDS as readonly string[]).includes(raw['referenceEvent'])
      ? (raw['referenceEvent'] as ReferenceEventId)
      : DEFAULT_BBM_STATE.referenceEvent;
  return {
    referenceEvent,
    showOrbitTrails:
      typeof raw['showOrbitTrails'] === 'boolean'
        ? raw['showOrbitTrails']
        : DEFAULT_BBM_STATE.showOrbitTrails,
    illustrativeLensing:
      typeof raw['illustrativeLensing'] === 'boolean'
        ? raw['illustrativeLensing']
        : DEFAULT_BBM_STATE.illustrativeLensing
  };
}

// ---------------------------------------------------------------------------
// Quality-tier mapping (single global governor -> destination workload)
// ---------------------------------------------------------------------------

/** Kerr numerical pass step budget per tier (active in RINGDOWN/REMNANT). */
/**
 * Kerr integration step budget per tier for the REMNANT pass.
 *
 * These now match the budgets the black-hole destination runs the same
 * integrator with (256/512/1024/2048). The previous 140-380 was 2-5x too small
 * for this configuration: rays that exhaust the budget terminate as
 * RAY_MAX_STEPS, which the product path paints NUMERICAL_FAILURE magenta ("a
 * failure must never masquerade as the shadow"), so the remnant view rendered
 * as a large purple field with the shadow inside it — most of the frame was
 * literally an error color.
 */
export const TIER_KERR_STEPS: Record<QualityTier, number> = {
  low: 256,
  medium: 512,
  high: 1024,
  ultra: 2048
};

/** Trail ribbon samples per tier (bounded; compact-merger precedent). */
export const TIER_TRAIL_SAMPLES: Record<QualityTier, number> = {
  low: 72,
  medium: 112,
  high: 160,
  ultra: 220
};
