import { describe, expect, it } from 'vitest';

import { resolveVisualWorkBudget } from '../../src/atlas/visualWorkBudget.js';

describe('global visual work budget', () => {
  it('maps the tier ladder to bounded, monotone quality controls', () => {
    const low = resolveVisualWorkBudget('low', 'stable');
    const medium = resolveVisualWorkBudget('medium', 'stable');
    const high = resolveVisualWorkBudget('high', 'stable');
    const ultra = resolveVisualWorkBudget('ultra', 'stable');

    expect(low.temporalEnabled).toBe(false);
    expect(high.temporalEnabled).toBe(true);
    expect(ultra.glareEnabled).toBe(true);
    expect(low.volumeDetailOctaves).toBeLessThan(medium.volumeDetailOctaves);
    expect(medium.volumeDetailOctaves).toBeLessThan(high.volumeDetailOctaves);
    expect(high.volumeDetailOctaves).toBeLessThan(ultra.volumeDetailOctaves);
    for (const budget of [low, medium, high, ultra]) {
      expect(budget.volumeActiveSteps).toBeGreaterThan(0);
      expect(budget.volumeActiveSteps).toBeLessThanOrEqual(1);
      expect(budget.particlePopulationScale).toBeGreaterThan(0);
      expect(budget.particlePopulationScale).toBeLessThanOrEqual(1);
      expect(budget.temporalHistoryFrames).toBeGreaterThanOrEqual(1);
      expect(budget.temporalHistoryFrames).toBeLessThanOrEqual(64);
    }
  });

  it('reduces expensive work during interaction without creating a second tier', () => {
    const stable = resolveVisualWorkBudget('ultra', 'stable');
    const settling = resolveVisualWorkBudget('ultra', 'settling');
    const interaction = resolveVisualWorkBudget('ultra', 'interaction');

    expect(interaction.tier).toBe('ultra');
    expect(interaction.activityMode).toBe('interaction');
    expect(interaction.volumeDetailOctaves).toBeLessThanOrEqual(settling.volumeDetailOctaves);
    expect(settling.volumeDetailOctaves).toBeLessThanOrEqual(stable.volumeDetailOctaves);
    expect(interaction.temporalHistoryFrames).toBe(1);
    expect(interaction.glareEnabled).toBe(false);
    expect(stable.glareEnabled).toBe(true);
  });
});
