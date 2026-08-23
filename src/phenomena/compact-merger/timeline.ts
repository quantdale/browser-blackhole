/**
 * Compact Merger nonlinear phase timeline (CA5-02).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 4 (phase-aware
 *   mapping INSPIRAL -> CONTACT -> MERGER -> JET -> KILONOVA -> AFTERGLOW;
 *   physical durations differ by orders of magnitude -> nonlinear
 *   compression);
 * - src/atlas/types.ts PhaseMapping contract; stellar-explosion timeline
 *   discipline (pure functions, log-compressed segments, exact round-trip).
 *
 * DESIGN: segment boundaries are defined RELATIVE TO THE MODEL'S DETERMINISTIC
 * CONTACT TIME (which depends on the masses through the quadrupole law), so
 * the timeline stays physically anchored for every preset. The inspiral
 * segment interpolates LINEARLY (it is already the scrubbable sub-second
 * dynamic window); post-contact segments use LOG compression across
 * milliseconds (contact/merger), seconds (jet), days (kilonova) and months
 * (afterglow). forward/inverse are exact inverses up to float rounding.
 *
 * Pure module: no wall clock, no randomness, no traversal history.
 */

import type { ResolvedMergerScenario } from './types.js';
import type { MergerPhase } from './types.js';
import type { PhaseMapping } from '../../atlas/types.js';

/** One presented timeline segment: UI weight + physical-second boundaries. */
interface TimelineSegment {
  readonly phase: MergerPhase;
  /** Fraction of the UI scrub range occupied by this phase (sums to 1). */
  readonly weight: number;
  /** Physical start/end seconds, RELATIVE to the deterministic contact time. */
  readonly startOffset: number;
  readonly endOffset: number;
  /** Log-compress inside the segment (false = linear). */
  readonly log: boolean;
}

/**
 * Presentation timeline. Boundary offsets are ILLUSTRATIVE canonical values
 * for a canonical BNS event, disclosed as such: contact/merger are
 * millisecond-scale, the short-GRB engine acts within ~seconds, kilonova
 * emission peaks around a day, afterglow fades over months. The inspiral
 * segment is special-cased to [0, contactSeconds] (it is the ONLY segment
 * that precedes contact); all other offsets are relative to contact.
 */
const SEGMENTS: readonly TimelineSegment[] = [
  { phase: 'inspiral', weight: 0.3, startOffset: 0, endOffset: 0, log: false },
  { phase: 'contact', weight: 0.05, startOffset: 0, endOffset: 0.004, log: false },
  { phase: 'merger', weight: 0.07, startOffset: 0.004, endOffset: 0.02, log: false },
  { phase: 'jet', weight: 0.13, startOffset: 0.02, endOffset: 2, log: true },
  { phase: 'kilonova', weight: 0.25, startOffset: 2, endOffset: 7 * 86400, log: true },
  { phase: 'afterglow', weight: 0.2, startOffset: 7 * 86400, endOffset: 180 * 86400, log: true }
];

/** Absolute (simulation-clock) segment boundaries for one scenario. */
interface AbsoluteSegment {
  readonly phase: MergerPhase;
  readonly weight: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly log: boolean;
}

function segmentsFor(scenario: ResolvedMergerScenario): readonly AbsoluteSegment[] {
  const tc = scenario.contactSeconds;
  return SEGMENTS.map((s) => ({
    phase: s.phase,
    weight: s.weight,
    startSeconds: s.phase === 'inspiral' ? 0 : tc + s.startOffset,
    endSeconds: s.phase === 'inspiral' ? tc : tc + s.endOffset,
    log: s.log
  }));
}

/** Ordered phase list (VALIDATION_TESTING ordering checks). */
export function mergerPhaseSequence(): readonly MergerPhase[] {
  return SEGMENTS.map((s) => s.phase);
}

/**
 * Map normalized UI phase [0,1] onto physical seconds. Pure; clamped; never
 * throws. Log segments interpolate geometrically; the zero-start inspiral
 * segment interpolates linearly.
 */
export function uiPhaseToSeconds(phase01: number, scenario: ResolvedMergerScenario): number {
  const ui = Number.isFinite(phase01) ? Math.min(1, Math.max(0, phase01)) : 0;
  const segments = segmentsFor(scenario);
  let cumulative = 0;
  for (const segment of segments) {
    const next = cumulative + segment.weight;
    if (ui <= next || segment === segments[segments.length - 1]) {
      const local =
        segment.weight > 0 ? Math.min(1, Math.max(0, (ui - cumulative) / segment.weight)) : 1;
      const seconds = segment.log
        ? Math.exp(
            Math.log(Math.max(segment.startSeconds, 1e-9)) * (1 - local) +
              Math.log(Math.max(segment.endSeconds, 1e-9)) * local
          )
        : segment.startSeconds + (segment.endSeconds - segment.startSeconds) * local;
      return Number.isFinite(seconds) ? seconds : segment.endSeconds;
    }
    cumulative = next;
  }
  return segments[segments.length - 1]?.endSeconds ?? 0;
}

/** Exact inverse of {@link uiPhaseToSeconds} (same segment table). */
export function secondsToUiPhase(seconds: number, scenario: ResolvedMergerScenario): number {
  const t = Number.isFinite(seconds) ? seconds : 0;
  const segments = segmentsFor(scenario);
  let cumulative = 0;
  for (const segment of segments) {
    const next = cumulative + segment.weight;
    if (t <= segment.endSeconds || segment === segments[segments.length - 1]) {
      const local = segment.log
        ? segment.endSeconds > segment.startSeconds
          ? Math.log(Math.max(t, 1e-9) / Math.max(segment.startSeconds, 1e-9)) /
            Math.log(Math.max(segment.endSeconds, 1e-9) / Math.max(segment.startSeconds, 1e-9))
          : 1
        : segment.endSeconds > segment.startSeconds
          ? (t - segment.startSeconds) / (segment.endSeconds - segment.startSeconds)
          : 1;
      const clamped = Math.min(1, Math.max(0, local));
      return Math.min(1, Math.max(0, cumulative + clamped * segment.weight));
    }
    cumulative = next;
  }
  return 1;
}

/** Which phase contains physical time `t`. Pure; deterministic. */
export function phaseAt(tSeconds: number, scenario: ResolvedMergerScenario): MergerPhase {
  if (!Number.isFinite(tSeconds)) return 'inspiral';
  const t = Math.max(0, tSeconds);
  const segments = segmentsFor(scenario);
  for (const segment of segments) {
    if (t < segment.endSeconds) return segment.phase;
  }
  return segments[segments.length - 1]?.phase ?? 'afterglow';
}

/** Auto-scaling human display for a simulation-clock second count. */
export function formatMergerSeconds(seconds: number): string {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (t < 0.001) return `${(t * 1e6).toFixed(0)} µs`;
  if (t < 1) return `${(t * 1000).toFixed(1)} ms`;
  if (t < 60) return `${t.toFixed(2)} s`;
  if (t < 3600) return `${(t / 60).toFixed(1)} min`;
  if (t < 86400) return `${(t / 3600).toFixed(1)} h`;
  if (t < 60 * 86400) return `${(t / 86400).toFixed(1)} d`;
  return `${(t / (30.44 * 86400)).toFixed(1)} months`;
}

/** Build the TimeController-compatible PhaseMapping for this destination. */
export function makeMergerPhaseMapping(scenario: ResolvedMergerScenario): PhaseMapping {
  return {
    id: 'merger-timeline',
    label: 'Merger timeline',
    forward: (phase01) => uiPhaseToSeconds(phase01, scenario),
    inverse: (internal) => secondsToUiPhase(internal, scenario),
    formatDisplay: (internal) => `${formatMergerSeconds(internal)} · ${phaseAt(internal, scenario)}`
  };
}
