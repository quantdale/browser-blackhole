/**
 * TDE nonlinear phase-aware timeline (CA6-12).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 6 (phase sequence
 *   approach -> elongation -> disruption -> debris -> winding -> shock ->
 *   nascent flow; physical durations differ by orders of magnitude);
 * - src/atlas/types.ts PhaseMapping contract; compact-merger timeline
 *   discipline (pure functions, anchored segments, exact round-trip).
 *
 * DESIGN: every segment boundary is a PURE FUNCTION OF THE MODEL — Barker
 * timing of the encounter for the pre-disruption windows, and the model's
 * own fallback time (first periapsis return of the most-bound element) for
 * the post-disruption evolution. No invented constants beyond the disclosed
 * radius thresholds and segment weights. forward/inverse are exact inverses
 * up to float rounding; scrubbing is history-free.
 *
 * Non-disrupting scenarios (fly-by / grazing): the phase STRUCTURE is kept
 * uniform so tests/UI stay stable, but everything after the disruption
 * window presents nothing (disclosed in those presets' fidelity notes). The
 * post-disruption anchor then falls back to a pure encounter-timescale
 * proxy (see POST_ANCHOR_OUTBOUND_FACTOR) instead of fabricating debris.
 *
 * Pure module: no wall clock, no randomness, no traversal history.
 */

import type { ResolvedTdeEncounter } from './types.js';
import type { TdePhase } from './types.js';
import { barkerSeconds } from './trajectory.js';
import type { PhaseMapping } from '../../atlas/types.js';

/** One presented timeline segment: UI weight + log-compression flag. */
interface TimelineSegment {
  readonly phase: TdePhase;
  /** Fraction of the UI scrub range occupied by this phase (sums to 1). */
  readonly weight: number;
  /** Log-compress inside the segment (false = linear). */
  readonly log: boolean;
}

// Segment weights only: boundaries derive per scenario in segmentsFor()
// from Barker timing (pre-disruption) and the fallback anchor (post).
const SEGMENTS: readonly TimelineSegment[] = [
  { phase: 'approach', weight: 0.1, log: false },
  { phase: 'deformation', weight: 0.14, log: false },
  { phase: 'disruption', weight: 0.12, log: false },
  { phase: 'debris', weight: 0.1, log: true },
  { phase: 'winding', weight: 0.07, log: true },
  { phase: 'shock', weight: 0.28, log: true },
  { phase: 'nascent-disk', weight: 0.19, log: true }
];

/**
 * Canonical weight lookup. `segmentsFor` used to repeat these numbers, and the
 * duplication silently desynchronised the two tables (their sum stopped being 1
 * and the phase mapping's forward/inverse round-trip broke at the top end).
 * SEGMENTS is the single source of truth.
 */
function weightOf(phase: TdePhase): number {
  return SEGMENTS.find((segment) => segment.phase === phase)?.weight ?? 0;
}

/**
 * Absolute (simulation-clock) segment boundaries for one scenario.
 * Pre-disruption boundaries come from Barker timing at radius thresholds;
 * post-disruption boundaries are factors times the fallback anchor.
 */
interface AbsoluteSegment {
  readonly phase: TdePhase;
  readonly weight: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly log: boolean;
}

/**
 * Post-disruption anchor S (seconds): fallback time when the encounter
 * disrupts; otherwise a presentation-only multiple of the outbound Barker
 * window so non-disrupting presets keep a valid clock (never presented as
 * debris physics).
 */
/** Radius-threshold conventions defining the pre-disruption windows. */
/** Deformation window opens where the tidal amplitude reaches this value. */
const DEFORMATION_XI_OPEN = 0.08;
/** Disruption window = |t| while r < DISRUPT_RADIUS_FACTOR * q. */
const DISRUPT_RADIUS_FACTOR = 1.44;

function fallbackAnchor(encounter: ResolvedTdeEncounter): number {
  if (encounter.disrupts && encounter.fallbackSeconds > 0) {
    return encounter.fallbackSeconds;
  }
  return barkerSeconds(encounter, Math.sqrt(7)) * 4000;
}

/** Pre-disruption window boundaries derived from the encounter geometry. */
export function tdeTimelineBounds(encounter: ResolvedTdeEncounter): {
  approachStartSeconds: number;
  deformationStartSeconds: number;
  disruptEdgeSeconds: number;
  fallbackAnchorSeconds: number;
} {
  const dIn = Math.sqrt(8); // r = 9 q inbound boundary (r = q(1+D^2))
  const xiOpenD = Math.cbrt(1 / DEFORMATION_XI_OPEN); // r where xi reaches open threshold
  const dDef = Math.sqrt(Math.max((xiOpenD * encounter.rtUnits) / encounter.rpUnits - 1, 0.04));
  const dDisrupt = Math.sqrt(Math.max(DISRUPT_RADIUS_FACTOR - 1, 0.01));
  return {
    approachStartSeconds: -barkerSeconds(encounter, dIn),
    deformationStartSeconds: -barkerSeconds(encounter, dDef),
    disruptEdgeSeconds: barkerSeconds(encounter, dDisrupt),
    fallbackAnchorSeconds: fallbackAnchor(encounter)
  };
}

function segmentsFor(encounter: ResolvedTdeEncounter): readonly AbsoluteSegment[] {
  const b = tdeTimelineBounds(encounter);
  const s = b.fallbackAnchorSeconds;
  const edge = b.disruptEdgeSeconds;
  // Monotone post-disruption boundaries derived from ONE anchor S.
  const debrisEnd = Math.max(edge * 1.000001, s * 0.3);
  const windingEnd = Math.max(debrisEnd * 1.000001, s * 0.85);
  // Stage weights = share of the PHASE axis, hence of wall-clock playback time
  // (the mapping is phase-paced). They are a presentation choice and the
  // physical-time readout is unaffected. Rebalanced during the
  // phenomena-animation campaign: the debris/winding stages are a long,
  // near-empty coast while the gas is out on its orbits, and the shock and
  // nascent-disk stages are where the observable flare and disc assembly
  // happen, so weight follows what there is to SEE rather than duration.
  return [
    {
      phase: 'approach',
      weight: weightOf('approach'),
      startSeconds: b.approachStartSeconds,
      endSeconds: b.deformationStartSeconds,
      log: false
    },
    {
      phase: 'deformation',
      weight: weightOf('deformation'),
      startSeconds: b.deformationStartSeconds,
      endSeconds: -edge,
      log: false
    },
    {
      phase: 'disruption',
      weight: weightOf('disruption'),
      startSeconds: -edge,
      endSeconds: edge,
      log: false
    },
    {
      phase: 'debris',
      weight: weightOf('debris'),
      startSeconds: edge,
      endSeconds: debrisEnd,
      log: true
    },
    {
      phase: 'winding',
      weight: weightOf('winding'),
      startSeconds: debrisEnd,
      endSeconds: windingEnd,
      log: true
    },
    {
      phase: 'shock',
      weight: weightOf('shock'),
      startSeconds: windingEnd,
      endSeconds: s * 2.4,
      log: true
    },
    {
      phase: 'nascent-disk',
      weight: weightOf('nascent-disk'),
      startSeconds: s * 2.4,
      endSeconds: s * 9,
      log: true
    }
  ];
}

/** Ordered phase list (VALIDATION_TESTING ordering checks). */
export function tdePhaseSequence(): readonly TdePhase[] {
  return SEGMENTS.map((s) => s.phase);
}

/**
 * Map normalized UI phase [0,1] onto physical seconds. Pure; clamped; never
 * throws. Log segments interpolate geometrically; linear segments directly.
 */
export function uiPhaseToSeconds(phase01: number, encounter: ResolvedTdeEncounter): number {
  const ui = Number.isFinite(phase01) ? Math.min(1, Math.max(0, phase01)) : 0;
  const segments = segmentsFor(encounter);
  let cumulative = 0;
  for (const segment of segments) {
    const next = cumulative + segment.weight;
    if (ui <= next || segment === segments[segments.length - 1]) {
      const local =
        segment.weight > 0 ? Math.min(1, Math.max(0, (ui - cumulative) / segment.weight)) : 1;
      let seconds: number;
      if (segment.log && segment.startSeconds > 0 && segment.endSeconds > 0) {
        seconds = Math.exp(
          Math.log(segment.startSeconds) * (1 - local) + Math.log(segment.endSeconds) * local
        );
      } else {
        seconds = segment.startSeconds + (segment.endSeconds - segment.startSeconds) * local;
      }
      return Number.isFinite(seconds) ? seconds : segment.endSeconds;
    }
    cumulative = next;
  }
  return segments[segments.length - 1]?.endSeconds ?? 0;
}

/** Exact inverse of {@link uiPhaseToSeconds} (same segment table). */
export function secondsToUiPhase(seconds: number, encounter: ResolvedTdeEncounter): number {
  const t = Number.isFinite(seconds) ? seconds : 0;
  const segments = segmentsFor(encounter);
  let cumulative = 0;
  for (const segment of segments) {
    const next = cumulative + segment.weight;
    if (t <= segment.endSeconds || segment === segments[segments.length - 1]) {
      let local: number;
      if (segment.log && segment.startSeconds > 0 && segment.endSeconds > segment.startSeconds) {
        local =
          Math.log(Math.max(t, 1e-9) / segment.startSeconds) /
          Math.log(segment.endSeconds / segment.startSeconds);
      } else if (segment.endSeconds > segment.startSeconds) {
        local = (t - segment.startSeconds) / (segment.endSeconds - segment.startSeconds);
      } else {
        local = 1;
      }
      const clamped = Math.min(1, Math.max(0, local));
      return Math.min(1, Math.max(0, cumulative + clamped * segment.weight));
    }
    cumulative = next;
  }
  return 1;
}

/** Which phase contains physical time `t`. Pure; deterministic. */
export function tdePhaseAt(tSeconds: number, encounter: ResolvedTdeEncounter): TdePhase {
  const t = Number.isFinite(tSeconds) ? tSeconds : 0;
  const segments = segmentsFor(encounter);
  for (const segment of segments) {
    if (t < segment.endSeconds) return segment.phase;
  }
  return segments[segments.length - 1]?.phase ?? 'nascent-disk';
}

/** Auto-scaling human display for an encounter-clock second count. */
export function formatEncounterSeconds(seconds: number): string {
  const t = Number.isFinite(seconds) ? seconds : 0;
  const sign = t < 0 ? '−' : '+';
  const a = Math.abs(t);
  if (a < 60) return `${sign}${a.toFixed(1)} s`;
  if (a < 3600) return `${sign}${(a / 60).toFixed(1)} min`;
  if (a < 86400) return `${sign}${(a / 3600).toFixed(1)} h`;
  if (a < 120 * 86400) return `${sign}${(a / 86400).toFixed(1)} d`;
  if (a < 730 * 86400) return `${sign}${(a / (30.44 * 86400)).toFixed(1)} months`;
  return `${sign}${(a / (365.25 * 86400)).toFixed(1)} yr`;
}

/**
 * Wall-clock seconds for one full traverse of the encounter at 1x. The stage
 * weights in `segmentsFor` then decide how much of it each stage gets: ~13% for
 * the deformation, ~8% across periapsis, and the rest spread logarithmically
 * over debris, winding, shock and nascent disk.
 */
export const TIMELINE_PLAYBACK_SECONDS = 60;

/** Build the TimeController-compatible PhaseMapping for this destination. */
export function makeTdePhaseMapping(encounter: ResolvedTdeEncounter): PhaseMapping {
  return {
    id: 'tidal-disruption-timeline',
    label: 'TDE timeline',
    forward: (phase01) => uiPhaseToSeconds(phase01, encounter),
    inverse: (internal) => secondsToUiPhase(internal, encounter),
    formatDisplay: (internal) =>
      `${formatEncounterSeconds(internal)} · ${tdePhaseAt(internal, encounter)}`,
    // The encounter spans ~-3 h to ~+3 yr of physical time and the disruption
    // itself lasts minutes, which is exactly why the segment table above
    // weights the phase axis by STAGE rather than by duration. Pace playback in
    // that phase coordinate so each stage gets the share of wall time it was
    // given: advancing uniformly in seconds instead needed ~173 real DAYS for
    // one traverse, which is why this destination looked frozen.
    playbackSeconds: TIMELINE_PLAYBACK_SECONDS,
    pacing: 'phase',
    loop: true
  };
}
