/**
 * CA8-17 — Black-Hole Merger timeline determinism + source parity.
 *
 * Gates tested (mission §17):
 * - SOURCE EQUIVALENCE: the committed runtime binary reproduces the
 *   reduction's emitted float32 rows EXACTLY at fixture keyframes, and
 *   interpolates back to native-resolution source waveform samples within a
 *   documented tolerance;
 * - REDUCTION ERROR: the committed error report satisfies its own declared
 *   thresholds (a report that is generated but never asserted is a failure);
 * - TIMELINE: phase mapping round-trips, anchors land exactly on data-derived
 *   boundaries, and scrub/reset/replay are deterministic with no drift;
 * - SCIENTIFIC HONESTY: destination metadata carries the required
 *   "illustrative lensing / does not ray trace dynamical spacetime"
 *   disclosure language (SCIENTIFIC_FIDELITY §9).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decodeBbm1, type BbmDataset } from '../../src/phenomena/black-hole-merger/dataset.js';
import {
  bbmTimeSpanM,
  makeBbmPhaseMapping,
  phaseAt,
  sampleIndexAt,
  sampleBbmAt,
  strainAmplitudeAt,
  uiPhaseToTimeM,
  type BbmSampleOut
} from '../../src/phenomena/black-hole-merger/timeline.js';
import { BBM_DISCLOSURE } from '../../src/phenomena/black-hole-merger/presets.js';
import { BLACK_HOLE_MERGER_DESCRIPTOR } from '../../src/phenomena/black-hole-merger/presets.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ASSET_DIR = join(REPO_ROOT, 'public', 'data', 'black-hole-merger');
const FIXTURE_PATH = join(REPO_ROOT, 'tests', 'unit', 'fixtures', 'bbm-parity.json');

interface ParityFixture {
  readonly assetId: string;
  readonly runtimeSha256: string;
  readonly mergerIndex: number;
  readonly rows: ReadonlyArray<{
    readonly index: number;
    readonly timeM: number;
    readonly bhA: readonly [number, number, number];
    readonly bhB: readonly [number, number, number];
    readonly h22Re: number;
    readonly h22Im: number;
  }>;
  readonly sourceKeyframes: ReadonlyArray<{
    readonly sourceTimeM: number;
    readonly h22Re: number;
    readonly h22Im: number;
    readonly toleranceFractionOfPeak: number;
  }>;
  readonly expectedReductionErrors: {
    readonly trajectoryMaxNormalizedMax: number;
    readonly trajectoryMaxNormalizedRms: number;
    readonly waveformMaxNormalizedMax: number;
    readonly waveformMaxNormalizedRms: number;
  };
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as unknown as ParityFixture;

function loadDataset(): BbmDataset {
  const binBuffer = readFileSync(join(ASSET_DIR, 'sxs-bbh-0001-lev5-bbm1-v1.bin'));
  const arrayBuffer = binBuffer.buffer.slice(
    binBuffer.byteOffset,
    binBuffer.byteOffset + binBuffer.byteLength
  );
  return decodeBbm1(arrayBuffer, fixture.assetId, fixture.runtimeSha256);
}

describe('source-vs-runtime equivalence (CA8-17)', () => {
  const dataset = loadDataset();

  it('runtime binary is byte-for-byte the reduction output', () => {
    expect(dataset.assetId).toBe(fixture.assetId);
    expect(dataset.mergerIndex).toBe(fixture.mergerIndex);
  });

  it('fixture rows reproduce exactly in the decoded channels', () => {
    for (const row of fixture.rows) {
      const i = row.index;
      // timesM is stored as float32: compare within f32 resolution of ~2 kM.
      expect(dataset.timesM[i] as number).toBeCloseTo(row.timeM, 3);
      expect(dataset.bhAxyz[i * 3] as number).toBeCloseTo(row.bhA[0], 4);
      expect(dataset.bhAxyz[i * 3 + 1] as number).toBeCloseTo(row.bhA[1], 4);
      expect(dataset.bhAxyz[i * 3 + 2] as number).toBeCloseTo(row.bhA[2], 4);
      expect(dataset.bhBxyz[i * 3] as number).toBeCloseTo(row.bhB[0], 4);
      expect(dataset.bhBxyz[i * 3 + 1] as number).toBeCloseTo(row.bhB[1], 4);
      expect(dataset.bhBxyz[i * 3 + 2] as number).toBeCloseTo(row.bhB[2], 4);
      expect(dataset.h22Re[i] as number).toBeCloseTo(row.h22Re, 5);
      expect(dataset.h22Im[i] as number).toBeCloseTo(row.h22Im, 5);
    }
  });

  it('interpolation returns reduced samples EXACTLY at sample points', () => {
    const out: BbmSampleOut = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, hRe: 0, hIm: 0 };
    for (const row of fixture.rows) {
      const t = dataset.timesM[row.index] as number; // exact stored sample
      sampleBbmAt(dataset, t, out);
      expect(out.hRe).toBeCloseTo(row.h22Re, 5);
      expect(out.hIm).toBeCloseTo(row.h22Im, 5);
      expect(out.ax).toBeCloseTo(row.bhA[0], 4);
      expect(out.bx).toBeCloseTo(row.bhB[0], 4);
    }
  });

  it('waveform interpolates to NATIVE source samples within documented tolerance', () => {
    for (const keyframe of fixture.sourceKeyframes) {
      const re = interpReduced(dataset, dataset.h22Re, keyframe.sourceTimeM);
      const im = interpReduced(dataset, dataset.h22Im, keyframe.sourceTimeM);
      const tolerance = keyframe.toleranceFractionOfPeak * dataset.h22PeakAmplitude;
      expect(Math.abs(re - keyframe.h22Re)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(im - keyframe.h22Im)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('reduction error report stays within its declared thresholds', () => {
    interface ReductionReport {
      readonly errors: {
        readonly trajectoryA: {
          readonly maxAbsError: number;
          readonly rmsError: number;
          readonly normalizedBy: number;
        };
        readonly trajectoryB: {
          readonly maxAbsError: number;
          readonly rmsError: number;
          readonly normalizedBy: number;
        };
        readonly waveformH22: {
          readonly maxAbsError: number;
          readonly rmsError: number;
          readonly normalizedBy: number;
        };
        readonly peakShiftSamples: number;
      };
    }
    const report = JSON.parse(
      readFileSync(join(ASSET_DIR, 'reduction-report.json'), 'utf8')
    ) as unknown as ReductionReport;
    const expected = fixture.expectedReductionErrors;

    const trajMax = Math.max(
      report.errors.trajectoryA.maxAbsError / report.errors.trajectoryA.normalizedBy,
      report.errors.trajectoryB.maxAbsError / report.errors.trajectoryB.normalizedBy
    );
    const trajRms = Math.max(
      report.errors.trajectoryA.rmsError / report.errors.trajectoryA.normalizedBy,
      report.errors.trajectoryB.rmsError / report.errors.trajectoryB.normalizedBy
    );
    const waveMax = report.errors.waveformH22.maxAbsError / report.errors.waveformH22.normalizedBy;
    const waveRms = report.errors.waveformH22.rmsError / report.errors.waveformH22.normalizedBy;

    expect(trajMax).toBeLessThanOrEqual(expected.trajectoryMaxNormalizedMax);
    expect(trajRms).toBeLessThanOrEqual(expected.trajectoryMaxNormalizedRms);
    expect(waveMax).toBeLessThanOrEqual(expected.waveformMaxNormalizedMax);
    expect(waveRms).toBeLessThanOrEqual(expected.waveformMaxNormalizedRms);
    // Merger/ringdown alignment preserved through resampling.
    expect(report.errors.peakShiftSamples).toBe(0);
  });
});

/**
 * Linear interpolation on a decoded reduced channel (the runtime decoder
 * contract), mirroring the reducer's np.interp reconstruction used to
 * produce the native-source keyframe expectations.
 */
function interpReduced(dataset: BbmDataset, channel: Float32Array, t: number): number {
  const i = sampleIndexAt(dataset.timesM, t);
  const t0 = dataset.timesM[i] as number;
  const t1 = dataset.timesM[i + 1] as number;
  const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  const v0 = channel[i] as number;
  const v1 = channel[i + 1] as number;
  return v0 + (v1 - v0) * f;
}

describe('timeline determinism + phase anchoring', () => {
  const dataset = loadDataset();
  const mapping = makeBbmPhaseMapping(dataset);

  it('phase mapping round-trips across the whole UI range', () => {
    for (let step = 0; step <= 100; step += 1) {
      const phase01 = step / 100;
      const internal = mapping.forward(phase01);
      const back = mapping.inverse(internal);
      expect(Math.abs(back - phase01)).toBeLessThan(1e-9);
      expect(Number.isFinite(internal)).toBe(true);
    }
  });

  it('UI phase 0..1 spans exactly [tStartM, ringdownEndM + tail]', () => {
    expect(mapping.forward(0)).toBeCloseTo(dataset.tStartM, 3);
    const span = dataset.ringdownEndM + 160;
    expect(mapping.forward(1)).toBeCloseTo(span, 3);
    expect(bbmTimeSpanM(dataset)).toBeCloseTo(span - dataset.tStartM, 6);
  });

  it('phaseAt lands on data-derived boundaries exactly', () => {
    expect(phaseAt(dataset.tStartM - 10, dataset)).toBe('inspiral');
    expect(phaseAt(-1e-6, dataset)).toBe('inspiral');
    expect(phaseAt(0, dataset)).toBe('merger');
    expect(phaseAt(dataset.mergerEndM - 1e-6, dataset)).toBe('merger');
    expect(phaseAt(dataset.mergerEndM + 1e-6, dataset)).toBe('ringdown');
    expect(phaseAt(dataset.ringdownEndM + 1e-6, dataset)).toBe('remnant');
  });

  it('scrub -> reset -> replay reproduces identical samples (no drift)', () => {
    const out1: BbmSampleOut = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, hRe: 0, hIm: 0 };
    const out2: BbmSampleOut = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, hRe: 0, hIm: 0 };
    const probes = [0.05, 0.3, 0.55, 0.61, 0.68, 0.85, 0.99];
    for (const phase of probes) {
      const t = uiPhaseToTimeM(phase, dataset);
      sampleBbmAt(dataset, t, out1);
      // "Replay": same coordinate via the inverse->forward round trip.
      const rt = mapping.forward(mapping.inverse(t));
      sampleBbmAt(dataset, rt, out2);
      expect(out2.ax).toBeCloseTo(out1.ax, 12);
      expect(out2.hRe).toBeCloseTo(out1.hRe, 12);
      expect(Math.abs(rt - t)).toBeLessThan(1e-9);
    }
  });

  it('binary-search sampler agrees with a linear reference scan', () => {
    const out: BbmSampleOut = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, hRe: 0, hIm: 0 };
    for (let k = 0; k <= 200; k += 1) {
      const t = dataset.tStartM + (k / 200) * bbmTimeSpanM(dataset);
      const i = sampleIndexAt(dataset.timesM, t);
      let reference = 0;
      while (
        reference < dataset.sampleCount - 2 &&
        (dataset.timesM[reference + 1] as number) <= t
      ) {
        reference += 1;
      }
      expect(i).toBe(reference);
      sampleBbmAt(dataset, t, out);
      expect(Number.isFinite(out.ax)).toBe(true);
      expect(Number.isFinite(out.hIm)).toBe(true);
    }
  });

  it('strain amplitude is continuous under arbitrary scrubbing', () => {
    let previous = strainAmplitudeAt(dataset, dataset.tStartM);
    for (let k = 1; k <= 400; k += 1) {
      const t = dataset.tStartM + (k / 400) * bbmTimeSpanM(dataset);
      const value = strainAmplitudeAt(dataset, t);
      // No teleporting between adjacent scrub positions.
      expect(Math.abs(value - previous)).toBeLessThan(dataset.h22PeakAmplitude * 0.25);
      previous = value;
    }
  });

  it('formatting exposes units and phase without fake precision', () => {
    const label = mapping.formatDisplay(-123.45);
    expect(label).toContain('-123.5 M');
    expect(label).toContain('inspiral');
  });
});

describe('scientific honesty (CA8-16 automated check)', () => {
  it('destination fidelity metadata labels live lensing as illustrative', () => {
    expect(BLACK_HOLE_MERGER_DESCRIPTOR.fidelity).toBe('DATA_DRIVEN');
    expect(BBM_DISCLOSURE).toContain('numerical-relativity data');
    expect(BBM_DISCLOSURE).toContain('illustrative');
    expect(BBM_DISCLOSURE).toContain('does not ray trace the full dynamical spacetime');
    expect(BBM_DISCLOSURE).toContain('CC-BY-4.0');
  });
});
