/**
 * Black-Hole Merger timeline: phase model + allocation-free sampling (CA8-11/12).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DATA_SOURCES_BBH_MERGER.md §4/§5 (representation
 *   contracts consumed here);
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md §5 ("Data interpolation is
 *   cheap"; phases anchored to source data);
 * - src/atlas/types.ts PhaseMapping contract; compact-merger timeline
 *   discipline (pure functions, exact round trip, no wall clock).
 *
 * INTERNAL COORDINATE: NR geometric time in units of total mass M, t=0 at
 * the source h22 amplitude peak (the merger anchor). The UI phase mapping is
 * piecewise-linear in the DATA-DERIVED anchors so scrubbing lands exactly on
 * the merger/ringdown boundaries:
 *
 *   INSPIRAL [tStart .. 0]  weight 0.55
 *   MERGER   [0 .. mergerEndM]     weight 0.12
 *   RINGDOWN [mergerEndM .. ringdownEndM]  weight 0.10
 *   REMNANT  [ringdownEndM .. remnantEndM] weight 0.23
 *
 * remnantEndM extends past the data into a short held-remnant tail
 * (presentation policy, documented) so the REMNANT state is scrubbable.
 */

import type { PhaseMapping } from '../../atlas/types.js';
import type { BbmDataset } from './dataset.js';
import type { BbmPhase } from './types.js';

/** Presentation tail after ringdownEndM that holds the remnant state. */
export const REMNANT_TAIL_M = 160;

const WEIGHT_INSPIRAL = 0.55;
const WEIGHT_MERGER = 0.12;
const WEIGHT_RINGDOWN = 0.1;
// REMNANT gets the remainder.

interface Segment {
  readonly phase: BbmPhase;
  readonly t0: number;
  readonly t1: number;
  readonly w0: number;
  readonly w1: number;
}

function segmentsFor(dataset: BbmDataset): Segment[] {
  const remnantEnd = dataset.ringdownEndM + REMNANT_TAIL_M;
  return [
    { phase: 'inspiral', t0: dataset.tStartM, t1: 0, w0: 0, w1: WEIGHT_INSPIRAL },
    {
      phase: 'merger',
      t0: 0,
      t1: dataset.mergerEndM,
      w0: WEIGHT_INSPIRAL,
      w1: WEIGHT_INSPIRAL + WEIGHT_MERGER
    },
    {
      phase: 'ringdown',
      t0: dataset.mergerEndM,
      t1: dataset.ringdownEndM,
      w0: WEIGHT_INSPIRAL + WEIGHT_MERGER,
      w1: WEIGHT_INSPIRAL + WEIGHT_MERGER + WEIGHT_RINGDOWN
    },
    {
      phase: 'remnant',
      t0: dataset.ringdownEndM,
      t1: remnantEnd,
      w0: WEIGHT_INSPIRAL + WEIGHT_MERGER + WEIGHT_RINGDOWN,
      w1: 1
    }
  ];
}

export function bbmTimeSpanM(dataset: BbmDataset): number {
  return dataset.ringdownEndM + REMNANT_TAIL_M - dataset.tStartM;
}

/** UI phase [0,1] -> internal M time. Pure; clamped; exact at anchors. */
export function uiPhaseToTimeM(phase01: number, dataset: BbmDataset): number {
  const ui = Number.isFinite(phase01) ? Math.min(1, Math.max(0, phase01)) : 0;
  for (const segment of segmentsFor(dataset)) {
    if (ui <= segment.w1 || segment.w1 === 1) {
      const span = segment.t1 - segment.t0;
      const local =
        segment.w1 > segment.w0 ? Math.min(1, Math.max(0, (ui - segment.w0) / (segment.w1 - segment.w0))) : 1;
      const value = segment.t0 + span * local;
      return Number.isFinite(value) ? value : segment.t1;
    }
  }
  return segmentsFor(dataset)[segmentsFor(dataset).length - 1]?.t1 ?? 0;
}

/** Exact inverse of {@link uiPhaseToTimeM} over the same segments. */
export function timeMToUiPhase(timeM: number, dataset: BbmDataset): number {
  const t = Number.isFinite(timeM) ? timeM : 0;
  for (const segment of segmentsFor(dataset)) {
    if (t <= segment.t1 || segment.w1 === 1) {
      const local =
        segment.t1 > segment.t0 ? Math.min(1, Math.max(0, (t - segment.t0) / (segment.t1 - segment.t0))) : 1;
      return Math.min(1, Math.max(0, segment.w0 + local * (segment.w1 - segment.w0)));
    }
  }
  return 1;
}

/** Which product phase contains internal time `t`. Pure; deterministic. */
export function phaseAt(timeM: number, dataset: BbmDataset): BbmPhase {
  if (!Number.isFinite(timeM)) return 'inspiral';
  for (const segment of segmentsFor(dataset)) {
    if (timeM < segment.t1) return segment.phase;
  }
  return 'remnant';
}

/** Auto-scaling human display for an M-relative simulation time. */
export function formatBbmTime(timeM: number): string {
  const t = Number.isFinite(timeM) ? timeM : 0;
  const sign = t < 0 ? '-' : '+';
  const abs = Math.abs(t);
  if (abs < 1000) return `${sign}${abs.toFixed(1)} M`;
  if (abs < 10000) return `${sign}${(abs / 1000).toFixed(2)} kM`;
  return `${sign}${(abs / 1000).toFixed(1)} kM`;
}

/** TimeController-compatible PhaseMapping for this destination. */
export function makeBbmPhaseMapping(dataset: BbmDataset): PhaseMapping {
  return {
    id: 'bbm-timeline',
    label: 'NR timeline (M units)',
    forward: (phase01) => uiPhaseToTimeM(phase01, dataset),
    inverse: (internal) => timeMToUiPhase(internal, dataset),
    formatDisplay: (internal) =>
      `${formatBbmTime(internal)} · ${phaseAt(internal, dataset)}`
  };
}

// ---------------------------------------------------------------------------
// Sampling (allocation-free; binary search + linear interpolation)
// ---------------------------------------------------------------------------

/** Index of the last sample with times[i] <= t (clamped to [0, n-2]). */
export function sampleIndexAt(times: Float32Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (t <= (times[lo] as number)) return 0;
  if (t >= (times[hi] as number)) return hi - 1;
  // Binary search on a strictly monotonic channel.
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface BbmSampleOut {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  hRe: number;
  hIm: number;
}

/**
 * Sample every channel at internal time `t` into `out` (no allocations).
 * Positions/strain are linear between reduced samples — exactly what the
 * reduction-error report quantifies.
 */
export function sampleBbmAt(
  dataset: BbmDataset,
  t: number,
  out: BbmSampleOut
): void {
  const i = sampleIndexAt(dataset.timesM, t);
  const t0 = dataset.timesM[i] as number;
  const t1 = dataset.timesM[i + 1] as number;
  const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;

  const base3i = i * 3;
  const base3j = (i + 1) * 3;
  out.ax = lerp(dataset.bhAxyz[base3i] as number, dataset.bhAxyz[base3j] as number, f);
  out.ay = lerp(dataset.bhAxyz[base3i + 1] as number, dataset.bhAxyz[base3j + 1] as number, f);
  out.az = lerp(dataset.bhAxyz[base3i + 2] as number, dataset.bhAxyz[base3j + 2] as number, f);
  out.bx = lerp(dataset.bhBxyz[base3i] as number, dataset.bhBxyz[base3j] as number, f);
  out.by = lerp(dataset.bhBxyz[base3i + 1] as number, dataset.bhBxyz[base3j + 1] as number, f);
  out.bz = lerp(dataset.bhBxyz[base3i + 2] as number, dataset.bhBxyz[base3j + 2] as number, f);
  out.hRe = lerp(dataset.h22Re[i] as number, dataset.h22Re[i + 1] as number, f);
  out.hIm = lerp(dataset.h22Im[i] as number, dataset.h22Im[i + 1] as number, f);
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/**
 |h22| at internal time t (for cursor readouts), allocation-free.
 */
export function strainAmplitudeAt(dataset: BbmDataset, t: number): number {
  const i = sampleIndexAt(dataset.timesM, t);
  const t0 = dataset.timesM[i] as number;
  const t1 = dataset.timesM[i + 1] as number;
  const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  const re = lerp(dataset.h22Re[i] as number, dataset.h22Re[i + 1] as number, f);
  const im = lerp(dataset.h22Im[i] as number, dataset.h22Im[i + 1] as number, f);
  return Math.sqrt(re * re + im * im);
}
