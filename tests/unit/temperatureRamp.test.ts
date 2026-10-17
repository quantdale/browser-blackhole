/**
 * Unit tests for the shared temperature -> linear-light RGB ramp (U-19).
 *
 * U-19 collapsed three divergent temperature->RGB implementations into ONE
 * interpolation algorithm with disclosed per-destination calibrations
 * (src/phenomena/shared/temperatureRamp.ts). These rows pin the shared
 * algorithm's total-function contract AND the exact output identity of the
 * two consolidated call sites at their calibration anchors, so the
 * consolidation can never silently restyle either destination.
 */

import { describe, expect, it } from 'vitest';

import {
  interpolateTemperatureRamp,
  type TemperatureRampAnchor
} from '../../src/phenomena/shared/temperatureRamp.js';

/** The neutron-star calibration, copied verbatim from neutronStarModule.ts. */
const NS_ANCHORS: ReadonlyArray<TemperatureRampAnchor> = [
  { logT: 3.48, rgb: [1.0, 0.36, 0.09] },
  { logT: 3.78, rgb: [1.0, 0.87, 0.72] },
  { logT: 4.0, rgb: [0.86, 0.91, 1.0] },
  { logT: 4.3, rgb: [0.68, 0.79, 1.0] },
  { logT: 6.5, rgb: [0.55, 0.68, 1.0] }
];

/** The stellar-explosion calibration, copied verbatim from emission.ts. */
const SE_ANCHORS: ReadonlyArray<TemperatureRampAnchor> = [
  { logT: 3.0, rgb: [1.0, 0.18, 0.02] },
  { logT: 3.48, rgb: [1.0, 0.36, 0.09] },
  { logT: 3.78, rgb: [1.0, 0.87, 0.72] },
  { logT: 4.0, rgb: [0.86, 0.91, 1.0] },
  { logT: 4.48, rgb: [0.68, 0.79, 1.0] },
  { logT: 7.0, rgb: [0.55, 0.66, 1.0] }
];

describe('shared temperature ramp (U-19)', () => {
  it('returns exact anchor colours at anchor temperatures', () => {
    for (const anchors of [NS_ANCHORS, SE_ANCHORS]) {
      for (const anchor of anchors) {
        const kelvin = 10 ** anchor.logT;
        const rgb = interpolateTemperatureRamp(anchors, kelvin);
        expect(rgb[0]).toBeCloseTo(anchor.rgb[0], 12);
        expect(rgb[1]).toBeCloseTo(anchor.rgb[1], 12);
        expect(rgb[2]).toBeCloseTo(anchor.rgb[2], 12);
      }
    }
  });

  it('interpolates linearly at the midpoint between two anchors', () => {
    const a = NS_ANCHORS[0]!;
    const b = NS_ANCHORS[1]!;
    const midLogT = (a.logT + b.logT) / 2;
    const rgb = interpolateTemperatureRamp(NS_ANCHORS, 10 ** midLogT);
    expect(rgb[0]).toBeCloseTo((a.rgb[0] + b.rgb[0]) / 2, 12);
    expect(rgb[1]).toBeCloseTo((a.rgb[1] + b.rgb[1]) / 2, 12);
    expect(rgb[2]).toBeCloseTo((a.rgb[2] + b.rgb[2]) / 2, 12);
  });

  it('clamps out-of-domain input to the first/last anchor (never extrapolates)', () => {
    const first = NS_ANCHORS[0]!;
    const last = NS_ANCHORS[NS_ANCHORS.length - 1]!;
    expect(interpolateTemperatureRamp(NS_ANCHORS, 1)).toEqual([
      first.rgb[0],
      first.rgb[1],
      first.rgb[2]
    ]);
    expect(interpolateTemperatureRamp(NS_ANCHORS, 1e12)).toEqual([
      last.rgb[0],
      last.rgb[1],
      last.rgb[2]
    ]);
  });

  it('is total: non-finite kelvin falls back to the coldest anchor', () => {
    const first = SE_ANCHORS[0]!;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(interpolateTemperatureRamp(SE_ANCHORS, bad)).toEqual([
        first.rgb[0],
        first.rgb[1],
        first.rgb[2]
      ]);
    }
  });

  it('never returns non-finite components for finite input', () => {
    for (const kelvin of [0, 1e-3, 273, 3000, 2e6, 1e9]) {
      const rgb = interpolateTemperatureRamp(NS_ANCHORS, kelvin);
      for (const channel of rgb) expect(Number.isFinite(channel)).toBe(true);
    }
  });
});
