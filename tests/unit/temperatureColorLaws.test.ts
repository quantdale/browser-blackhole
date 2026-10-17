/**
 * temperature-color-law-contract — the three temperature→linear-RGB laws
 * are three distinct named presentation contracts (capability:
 * temperature-color-laws). They are deliberately NOT unified:
 *
 * - accretion-disk law: blackbodyRgb (accretionDisk.ts) — closed-form
 *   chromaticity fit over [1000, 40000] K clamped, unit-luminance × (T/6500)^4
 *   relative bolometric energy (HDR triple, components can exceed 1);
 * - stellar-explosion ramp: kelvinToLinearRgb (stellar-explosion/emission.ts)
 *   — shared anchor-ramp interpolation over [1000, 1e7] K clamped;
 * - compact-merger locus: kelvinToLinearRgb (compact-merger/emission.ts) —
 *   closed-form Planckian-locus fit over [1000, 40000] K clamped, gamma-2.2
 *   shaped, components in [0, 1].
 *
 * These rows fail if two laws silently merge, if a capped law stops
 * returning the endpoint color above its ceiling, or if the stellar-explosion
 * ramp stops distinguishing temperatures within 4e4..1e7 K. Sample
 * temperatures are test-local choices (design D1) — no new production
 * constants. No golden is touched; this locks existing behavior.
 */

import { describe, expect, it } from 'vitest';

import { blackbodyRgb } from '../../src/phenomena/black-hole/accretionDisk.js';
import {
  KILONOVA_T0_K,
  kelvinToLinearRgb as mergerLocusRgb
} from '../../src/phenomena/compact-merger/emission.js';
import { REMNANT_TEMPERATURE_K } from '../../src/phenomena/compact-merger/types.js';
import {
  KELVIN_RAMP_MAX_K,
  kelvinToLinearRgb as explosionRampRgb
} from '../../src/phenomena/stellar-explosion/emission.js';

/** Interior sample inside ALL three stated domains. */
const INTERIOR_K = 6000;
/** The shared cap of the disk law and the merger-locus law. */
const DISK_MERGER_CEILING_K = 4e4;

describe('three temperature color laws (temperature-color-laws)', () => {
  it('names the accretion-disk law and keeps it finite HDR output', () => {
    const rgb = blackbodyRgb(INTERIOR_K);
    for (const channel of rgb) {
      expect(Number.isFinite(channel)).toBe(true);
      expect(channel).toBeGreaterThan(0);
    }
  });

  it('names the stellar-explosion ramp and keeps it inside its anchor range', () => {
    const rgb = explosionRampRgb(INTERIOR_K);
    for (const channel of rgb) {
      expect(Number.isFinite(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0.18);
      expect(channel).toBeLessThanOrEqual(1.0);
    }
  });

  it('names the compact-merger locus and keeps it inside [0, 1]', () => {
    const rgb = mergerLocusRgb(INTERIOR_K);
    for (const channel of rgb) {
      expect(Number.isFinite(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });

  it('returns pairwise-unequal colors at one interior temperature (design D1)', () => {
    const disk = blackbodyRgb(INTERIOR_K);
    const explosion = explosionRampRgb(INTERIOR_K);
    const merger = mergerLocusRgb(INTERIOR_K);
    const maxAbsDiff = (
      a: readonly [number, number, number],
      b: readonly [number, number, number]
    ): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    // 6e3 K: the disk law is unit-luminance-normalized with an SB energy
    // factor, the ramp interpolates an anchor table, and the merger locus
    // applies a gamma-2.2 shaped closed form — every pair already differs
    // far above noise at the same temperature.
    expect(maxAbsDiff(disk, explosion)).toBeGreaterThan(1e-3);
    expect(maxAbsDiff(disk, merger)).toBeGreaterThan(1e-3);
    expect(maxAbsDiff(explosion, merger)).toBeGreaterThan(1e-3);
  });
});

describe('capped laws clamp to the domain endpoint color', () => {
  it('accretion-disk law: above 40000 K returns the 40000 K endpoint exactly', () => {
    const atCeiling = blackbodyRgb(DISK_MERGER_CEILING_K);
    expect(blackbodyRgb(DISK_MERGER_CEILING_K + 1)).toEqual(atCeiling);
    expect(blackbodyRgb(REMNANT_TEMPERATURE_K)).toEqual(atCeiling);
    // Below the floor: same clamp rule, coldest endpoint.
    expect(blackbodyRgb(999)).toEqual(blackbodyRgb(1000));
  });

  it('compact-merger locus: above 40000 K returns the 40000 K endpoint exactly', () => {
    const atCeiling = mergerLocusRgb(DISK_MERGER_CEILING_K);
    expect(mergerLocusRgb(DISK_MERGER_CEILING_K + 1)).toEqual(atCeiling);
    expect(mergerLocusRgb(REMNANT_TEMPERATURE_K)).toEqual(atCeiling);
    expect(mergerLocusRgb(999)).toEqual(mergerLocusRgb(1000));
  });

  it('stellar-explosion ramp: still distinguishes temperatures in 4e4..1e7 K', () => {
    // Interior of the ramp's extra range: 1e6 K sits strictly between the
    // logT 4.48 and logT 7 anchors, so it is an interpolated color, NOT the
    // 1e7 K endpoint — the ramp truly accepts 40000 K..1e7 K.
    const mid = explosionRampRgb(1e6);
    const top = explosionRampRgb(KELVIN_RAMP_MAX_K);
    expect(mid).not.toEqual(top);
    expect(mid[0]).toBeGreaterThan(top[0]); // cooling below 1e7 moves redward
    // Above 1e7 K the ramp clamps to that endpoint (its own ceiling).
    expect(explosionRampRgb(KELVIN_RAMP_MAX_K + 1)).toEqual(top);
  });

  it('a call site above a ceiling does not claim a distinguishable hotter tint', () => {
    // remnant.ts HOT_TINT now passes the ceiling explicitly (temperature-
    // color-law-contract task 2.2): the 1.2e9 K remnant proxy clamps to the
    // locus endpoint, so the tint is the 4e4 K ceiling color and nothing
    // else. The kilonova film peaks at KILONOVA_T0_K (in-domain) and the
    // star tint sits AT the ceiling by design — both covered by the
    // endpoint-equality rows above.
    expect(mergerLocusRgb(REMNANT_TEMPERATURE_K)).toEqual(mergerLocusRgb(DISK_MERGER_CEILING_K));
    const filmPeak = mergerLocusRgb(KILONOVA_T0_K);
    for (const channel of filmPeak) expect(Number.isFinite(channel)).toBe(true);
  });
});
