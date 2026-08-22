/**
 * Stellar Explosion deterministic timeline machinery (CA4-03).
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md section 8 (time model: displayTime,
 *   simulationPhase, physicalTime, playbackRate are SEPARATE concerns;
 *   nonlinear phase mappings are first-class);
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 3 (timeline from
 *   seconds to later expansion; GRB central-engine sequence);
 * - src/atlas/types.ts PhaseMapping contract (consumed by TimeController).
 *
 * DESIGN:
 * - Physical events span milliseconds (collapse) to months (nebular). The UI
 *   scrub coordinate [0,1] is mapped onto PHYSICAL SECONDS through per-phase
 *   segments with LOG-COMRESSED time inside each segment, so every phase is
 *   comfortably scrubbable while preserving ordering and monotonicity.
 * - The mapping is a pure function: no wall-clock reads, no randomness, no
 *   dependence on traversal history. Scrubbing to phase p yields identical
 *   state whether or not earlier frames were played (mission section 35).
 * - forward/inverse are exact inverses up to float rounding (< 1e-9 over the
 *   whole domain; asserted by tests).
 *
 * Phase sequences (PHENOMENA_IMPLEMENTATION section 3 / mission section 21):
 * - standard: progenitor -> collapse -> flash -> shock-breakout ->
 *   expanding-ejecta -> nebular
 * - long-grb: progenitor -> collapse -> engine-ignition -> jet-breakout ->
 *   expanding-ejecta -> nebular
 */

import { PROGENITOR_DWELL_SECONDS } from './physics.js';
import { isGrbScenario, type ExplosionPhase, type ExplosionScenarioId } from './types.js';
import type { PhaseMapping } from '../../atlas/types.js';

// ---------------------------------------------------------------------------
// Segment tables
// ---------------------------------------------------------------------------

/** One presented timeline segment: UI weight + physical second boundaries. */
interface TimelineSegment {
  readonly phase: ExplosionPhase;
  /** Fraction of the UI scrub range occupied by this phase (sums to 1). */
  readonly weight: number;
  /** Physical start/end seconds on the simulation clock (t=0 at app start). */
  readonly startSeconds: number;
  readonly endSeconds: number;
}

const TRIGGER_S = PROGENITOR_DWELL_SECONDS;
const MIN_S = 60;
const HOUR_S = 3600;
const DAY_S = 86_400;

/**
 * Standard core-collapse presentation timeline. Boundary choices are
 * ILLUSTRATIVE canonical values for a canonical Type II event, disclosed as
 * such; they are order-of-magnitude correct (flash hours, plateau weeks).
 */
const STANDARD_SEGMENTS: readonly TimelineSegment[] = [
  { phase: 'progenitor', weight: 0.12, startSeconds: 0, endSeconds: TRIGGER_S },
  // Core collapse itself takes milliseconds; presenting it over 2 simulated
  // seconds keeps it visible without pretending the clock is literal.
  { phase: 'collapse', weight: 0.06, startSeconds: TRIGGER_S, endSeconds: TRIGGER_S + 2 },
  { phase: 'flash', weight: 0.16, startSeconds: TRIGGER_S + 2, endSeconds: TRIGGER_S + 6 * HOUR_S },
  {
    phase: 'shock-breakout',
    weight: 0.14,
    startSeconds: TRIGGER_S + 6 * HOUR_S,
    endSeconds: TRIGGER_S + 30 * HOUR_S
  },
  {
    phase: 'expanding-ejecta',
    weight: 0.3,
    startSeconds: TRIGGER_S + 30 * HOUR_S,
    endSeconds: TRIGGER_S + 30 * DAY_S
  },
  {
    phase: 'nebular',
    weight: 0.22,
    startSeconds: TRIGGER_S + 30 * DAY_S,
    endSeconds: TRIGGER_S + 365 * DAY_S
  }
];

/**
 * Long-GRB / collapsar sequence: the engine (accretion disk + bipolar jet)
 * ignites seconds after collapse and breaks out of the progenitor envelope
 * within ~minutes-to-an-hour; ejecta expansion then dominates the view.
 */
const GRB_SEGMENTS: readonly TimelineSegment[] = [
  { phase: 'progenitor', weight: 0.1, startSeconds: 0, endSeconds: TRIGGER_S },
  { phase: 'collapse', weight: 0.05, startSeconds: TRIGGER_S, endSeconds: TRIGGER_S + 2 },
  {
    phase: 'engine-ignition',
    weight: 0.17,
    startSeconds: TRIGGER_S + 2,
    endSeconds: TRIGGER_S + 120
  },
  {
    phase: 'jet-breakout',
    weight: 0.18,
    startSeconds: TRIGGER_S + 120,
    endSeconds: TRIGGER_S + 6 * HOUR_S
  },
  {
    phase: 'expanding-ejecta',
    weight: 0.32,
    startSeconds: TRIGGER_S + 6 * HOUR_S,
    endSeconds: TRIGGER_S + 21 * DAY_S
  },
  {
    phase: 'nebular',
    weight: 0.18,
    startSeconds: TRIGGER_S + 21 * DAY_S,
    endSeconds: TRIGGER_S + 240 * DAY_S
  }
];

/** Segments for a scenario id (pure table lookup). */
export function segmentsFor(scenarioId: ExplosionScenarioId): readonly TimelineSegment[] {
  return isGrbScenario(scenarioId) ? GRB_SEGMENTS : STANDARD_SEGMENTS;
}

/** Ordered phase list for a scenario (VALIDATION_TESTING ordering checks). */
export function phaseSequence(scenarioId: ExplosionScenarioId): readonly ExplosionPhase[] {
  return segmentsFor(scenarioId).map((segment) => segment.phase);
}

// ---------------------------------------------------------------------------
// Nonlinear UI-phase <-> seconds mapping
// ---------------------------------------------------------------------------

/**
 * Map normalized UI phase [0,1] onto physical seconds: locate the segment,
 * then interpolate LOGARITHMICALLY between the segment's second boundaries
 * (log compression makes hour-long flashes and month-long expansions both
 * scrubbable). Pure arithmetic; clamped at both ends; never throws.
 */
export function uiPhaseToSeconds(phase01: number, scenarioId: ExplosionScenarioId): number {
  const ui = Number.isFinite(phase01) ? Math.min(1, Math.max(0, phase01)) : 0;
  const segments = segmentsFor(scenarioId);
  let cumulative = 0;
  for (const segment of segments) {
    const next = cumulative + segment.weight;
    if (ui <= next || segment === segments[segments.length - 1]) {
      const local = segment.weight > 0 ? (ui - cumulative) / segment.weight : 1;
      const clampedLocal = Math.min(1, Math.max(0, local));
      // Segments starting at t=0 (the progenitor dwell) interpolate LINEARLY;
      // log compression is undefined at zero and every later segment has a
      // positive start.
      const seconds =
        segment.startSeconds <= 0
          ? (segment.endSeconds - segment.startSeconds) * clampedLocal
          : Math.exp(
              Math.log(segment.startSeconds) * (1 - clampedLocal) +
                Math.log(Math.max(segment.endSeconds, 1e-6)) * clampedLocal
            );
      return Number.isFinite(seconds) ? seconds : segment.endSeconds;
    }
    cumulative = next;
  }
  return segments[segments.length - 1]?.endSeconds ?? 0;
}

/** Exact inverse of {@link uiPhaseToSeconds} (same segment table). */
export function secondsToUiPhase(seconds: number, scenarioId: ExplosionScenarioId): number {
  const t = Number.isFinite(seconds) ? seconds : 0;
  const segments = segmentsFor(scenarioId);
  let cumulative = 0;
  for (const segment of segments) {
    const next = cumulative + segment.weight;
    if (t <= segment.endSeconds || segment === segments[segments.length - 1]) {
      // Linear inverse for the zero-start progenitor dwell; log otherwise
      // (mirrors uiPhaseToSeconds exactly so roundtrips are float-exact).
      const local =
        segment.startSeconds <= 0
          ? (t - segment.startSeconds) / (segment.endSeconds - segment.startSeconds)
          : segment.endSeconds > segment.startSeconds
            ? Math.log(Math.max(t, 1e-6) / segment.startSeconds) /
              Math.log(segment.endSeconds / segment.startSeconds)
            : 1;
      const clamped = Math.min(1, Math.max(0, local));
      return Number.isFinite(cumulative + clamped * segment.weight)
        ? Math.min(1, Math.max(0, cumulative + clamped * segment.weight))
        : 0;
    }
    cumulative = next;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Phase queries
// ---------------------------------------------------------------------------

export interface PhaseBoundary {
  readonly phase: ExplosionPhase;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/** Ordered phase boundary table for UI ticks and resource gating. */
export function phaseBoundaries(scenarioId: ExplosionScenarioId): readonly PhaseBoundary[] {
  return segmentsFor(scenarioId).map((segment) => ({
    phase: segment.phase,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds
  }));
}

/**
 * Simulation-clock second at which the GRB central engine ignites (start of
 * the 'engine-ignition' segment). Non-GRB scenarios return Infinity so jet
 * fronts computed against it stay exactly zero (jet.ts gating contract).
 */
export function engineIgnitionSeconds(scenarioId: ExplosionScenarioId): number {
  if (!isGrbScenario(scenarioId)) return Number.POSITIVE_INFINITY;
  const segment = segmentsFor(scenarioId).find((s) => s.phase === 'engine-ignition');
  return segment?.startSeconds ?? Number.POSITIVE_INFINITY;
}

/**
 * Which phase contains physical time `t`. Pure; deterministic; defaults to
 * the last phase beyond the end of the table.
 */
export function phaseAt(tSeconds: number, scenarioId: ExplosionScenarioId): ExplosionPhase {
  if (!Number.isFinite(tSeconds)) return segmentsFor(scenarioId)[0]?.phase ?? 'progenitor';
  const segments = segmentsFor(scenarioId);
  for (const segment of segments) {
    if (tSeconds < segment.endSeconds) return segment.phase;
  }
  return segments[segments.length - 1]?.phase ?? 'nebular';
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/**
 * Auto-scaling human display for a simulation-clock second count
 * (ms / s / min / h / d / months / years). Deterministic; used by
 * TimeController.formatDisplay and the debug panel.
 */
export function formatSimSeconds(seconds: number): string {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (t < 1) return `${(t * 1000).toFixed(0)} ms`;
  if (t < MIN_S) return `${t.toFixed(t < 10 ? 1 : 0)} s`;
  if (t < HOUR_S) return `${(t / MIN_S).toFixed(1)} min`;
  if (t < DAY_S) return `${(t / HOUR_S).toFixed(1)} h`;
  if (t < 60 * DAY_S) return `${(t / DAY_S).toFixed(1)} d`;
  if (t < 730 * DAY_S) return `${(t / (30.44 * DAY_S)).toFixed(1)} months`;
  return `${(t / (365.25 * DAY_S)).toFixed(1)} yr`;
}

// ---------------------------------------------------------------------------
// PhaseMapping assembly (TimeController contract)
// ---------------------------------------------------------------------------

/**
 * Build the TimeController-compatible PhaseMapping for this destination.
 *
 * Accepts any object carrying a `scenarioId` — the normalized public state
 * OR the fully resolved scenario (both satisfy this structurally), so the
 * integrator can pass whichever it already holds. The returned object
 * matches `src/atlas/types.ts` PhaseMapping exactly and is safe to hand to
 * `services.time.registerPhaseMapping`.
 */
export function makeExplosionPhaseMapping(state: {
  scenarioId: ExplosionScenarioId;
}): PhaseMapping {
  const scenarioId = state.scenarioId;
  return {
    id: 'explosion-timeline',
    label: 'Explosion timeline',
    forward: (phase01) => uiPhaseToSeconds(phase01, scenarioId),
    inverse: (internal) => secondsToUiPhase(internal, scenarioId),
    formatDisplay: (internal) => `${formatSimSeconds(internal)} · ${phaseAt(internal, scenarioId)}`
  };
}
