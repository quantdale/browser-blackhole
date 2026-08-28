import { describe, expect, it } from 'vitest';

import {
  DRW_DAMPING_TIMESCALE_DAYS,
  STRUCTURE_FUNCTION_INDEX,
  VARIABILITY_RMS,
  buildVariabilityComponents,
  structureFunction,
  variabilityFactor
} from '../../src/phenomena/quasar-agn/variability.js';

/**
 * The AGN continuum surrogate makes three claims and no more (see the module
 * header): deterministic and scrubbable, fractional amplitude of order the
 * observed ~16% RMS, and a structure function that RISES with lag as a power
 * law before saturating above the damping timescale. These tests pin exactly
 * those, so a future "make it flicker harder" tweak cannot quietly turn the
 * disclosure into a false statement.
 */
describe('quasar-agn continuum variability surrogate', () => {
  const components = buildVariabilityComponents(7);

  it('is a pure function of the timeline coordinate', () => {
    // Determinism is the reason this is not a DRW: scrubbing must reproduce.
    for (const t of [0, 13.5, 199.9, 1234.75]) {
      expect(variabilityFactor(t, components)).toBe(variabilityFactor(t, components));
    }
    const rebuilt = buildVariabilityComponents(7);
    expect(variabilityFactor(88, rebuilt)).toBeCloseTo(variabilityFactor(88, components), 12);
  });

  it('different seeds give different curves, same statistics', () => {
    const other = buildVariabilityComponents(99);
    expect(variabilityFactor(88, other)).not.toBeCloseTo(variabilityFactor(88, components), 6);
    const rms = (set: ReturnType<typeof buildVariabilityComponents>): number =>
      Math.sqrt(set.reduce((a, c) => a + c.amplitude ** 2 / 2, 0));
    expect(rms(other)).toBeCloseTo(rms(components), 12);
  });

  it('has the declared fractional RMS', () => {
    // Analytic RMS of independent sinusoids: sqrt(sum a_k^2 / 2).
    const analytic = Math.sqrt(components.reduce((a, c) => a + c.amplitude ** 2 / 2, 0));
    expect(analytic).toBeCloseTo(VARIABILITY_RMS, 10);

    // And the sampled curve agrees with it over a long baseline.
    let sum = 0;
    let sumSq = 0;
    const samples = 20_000;
    for (let i = 0; i < samples; i += 1) {
      const f = variabilityFactor((i * 4001) / samples, components);
      sum += f;
      sumSq += f * f;
    }
    const mean = sum / samples;
    const sampledRms = Math.sqrt(sumSq / samples - mean * mean);
    expect(mean).toBeCloseTo(1, 2);
    expect(sampledRms).toBeGreaterThan(VARIABILITY_RMS * 0.7);
    expect(sampledRms).toBeLessThan(VARIABILITY_RMS * 1.3);
  });

  it('never returns a non-positive or non-finite brightness factor', () => {
    for (let t = -500; t <= 2000; t += 0.37) {
      const f = variabilityFactor(t, components);
      expect(Number.isFinite(f)).toBe(true);
      expect(f).toBeGreaterThan(0);
    }
    expect(variabilityFactor(Number.NaN, components)).toBe(1);
    expect(variabilityFactor(Number.POSITIVE_INFINITY, components)).toBe(1);
  });

  it('structure function rises with lag and saturates above the damping timescale', () => {
    const sf = (lag: number): number => structureFunction(lag, components);
    expect(sf(0)).toBeCloseTo(0, 12);
    expect(sf(2)).toBeGreaterThan(0);
    expect(sf(10)).toBeGreaterThan(sf(2));
    expect(sf(50)).toBeGreaterThan(sf(10));

    // Above tau there is no longer any power to add, so SF stops growing. For a
    // sinusoid sum it oscillates about sqrt(2)*RMS with a hard ceiling of
    // 2*RMS (every component's (1 - cos) term simultaneously at 2). Both are
    // pinned: the ceiling can never be exceeded, and the long-lag AVERAGE must
    // sit at the saturated level rather than continuing to climb.
    const saturated = Math.SQRT2 * VARIABILITY_RMS;
    const ceiling = 2 * VARIABILITY_RMS;
    const longLags: number[] = [];
    for (let m = 1; m <= 6; m += 0.1) longLags.push(sf(DRW_DAMPING_TIMESCALE_DAYS * m));
    for (const value of longLags) {
      expect(value).toBeLessThanOrEqual(ceiling + 1e-12);
    }
    const meanLong = longLags.reduce((a, b) => a + b, 0) / longLags.length;
    expect(meanLong).toBeGreaterThan(saturated * 0.75);
    expect(meanLong).toBeLessThan(saturated * 1.25);
  });

  it('amplitudes follow the observed structure-function power law', () => {
    // a_k proportional to P_k^gamma: consecutive octave ratio must be 2^gamma.
    const expectedRatio = 2 ** STRUCTURE_FUNCTION_INDEX;
    for (let k = 1; k < components.length; k += 1) {
      const ratio = components[k - 1]!.amplitude / components[k]!.amplitude;
      expect(ratio).toBeCloseTo(expectedRatio, 10);
    }
    expect(components[0]!.periodDays).toBe(DRW_DAMPING_TIMESCALE_DAYS);
    expect(components[components.length - 1]!.periodDays).toBeCloseTo(
      DRW_DAMPING_TIMESCALE_DAYS / 2 ** (components.length - 1),
      10
    );
  });
});
