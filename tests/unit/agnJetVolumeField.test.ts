/**
 * AGN jet volume field — morphology contract for the cylinder replacement.
 *
 * Locks the properties a mesh silhouette cannot satisfy and a march can:
 * soft edge, spine brighter than the geometric axis once the helix moves,
 * documented length/collimation still the inputs, hidden-zone layouts never
 * claim the inner diorama, and the field stays finite and deterministic.
 */
import { describe, expect, it } from 'vitest';

import {
  JET_BOUNDS_OVER_COCOON,
  JET_COCOON_SIGMA_SCALE,
  JET_VOLUME_DISCLOSURE,
  agnJetVolumeLayout,
  sampleAgnJetField,
  sampleAgnJetMacro
} from '../../src/phenomena/quasar-agn/jetVolumeField.js';
import {
  JET_BASE_HALF_WIDTH_RG,
  JET_BASE_LENGTH_RG,
  JET_EXTENDED_HALF_WIDTH_RG,
  JET_EXTENDED_LENGTH_RG,
  ZONE_UNIT_RG
} from '../../src/phenomena/quasar-agn/types.js';

describe('AGN jet volume layout', () => {
  it('keeps documented length and collimation as inputs, and never targets the inner zone', () => {
    const base = agnJetVolumeLayout('base', 'plus', 307, 'high');
    const extended = agnJetVolumeLayout('extended', 'minus', 313, 'high');
    expect(base.zone).toBe('nuclear');
    expect(extended.zone).toBe('galactic');
    expect(base.lengthUnits).toBeCloseTo(JET_BASE_LENGTH_RG / ZONE_UNIT_RG.nuclear);
    expect(extended.lengthUnits).toBeCloseTo(JET_EXTENDED_LENGTH_RG / ZONE_UNIT_RG.galactic);
    expect(base.collimatedHalfWidthUnits).toBeCloseTo(
      JET_BASE_HALF_WIDTH_RG / ZONE_UNIT_RG.nuclear
    );
    expect(extended.collimatedHalfWidthUnits).toBeCloseTo(
      JET_EXTENDED_HALF_WIDTH_RG / ZONE_UNIT_RG.galactic
    );
    expect(base.cocoonSigmaUnits).toBeCloseTo(
      base.collimatedHalfWidthUnits * JET_COCOON_SIGMA_SCALE.base
    );
    expect(base.spineSigmaUnits).toBeGreaterThanOrEqual(base.collimatedHalfWidthUnits);
    expect(extended.spineSigmaUnits).toBeGreaterThan(extended.collimatedHalfWidthUnits);
    expect(base.bounds.halfExtents[0]).toBeCloseTo(base.cocoonSigmaUnits * JET_BOUNDS_OVER_COCOON);
    expect(base.bounds.center[1]).toBeGreaterThan(0);
    expect(extended.bounds.center[1]).toBeLessThan(0);
    expect(JET_VOLUME_DISCLOSURE).toContain('not GRMHD');
    expect(JET_VOLUME_DISCLOSURE).toContain('not a revision of the launch');
  });

  it('gives the extended jet a coarser march budget at low tier without dropping the spine floor', () => {
    const low = agnJetVolumeLayout('extended', 'plus', 1, 'low');
    const high = agnJetVolumeLayout('extended', 'plus', 1, 'high');
    expect(low.baseMaxSteps).toBeLessThan(high.baseMaxSteps);
    expect(low.spineSigmaUnits).toBe(high.spineSigmaUnits);
    expect(low.baseMaxSteps).toBeGreaterThanOrEqual(24);
  });
});

describe('AGN jet volume morphology', () => {
  const layout = agnJetVolumeLayout('extended', 'plus', 313, 'high');
  const midY = layout.lengthUnits * 0.45;

  it('falls off before the box edge, so the proxy is not a new cylinder silhouette', () => {
    const onSpine = sampleAgnJetMacro(0, midY, 0, layout);
    const edge = sampleAgnJetMacro(layout.bounds.halfExtents[0], midY, 0, layout);
    const outside = sampleAgnJetMacro(0, layout.lengthUnits * 1.2, 0, layout);
    expect(onSpine.density).toBeGreaterThan(0);
    expect(edge.density).toBeLessThan(onSpine.density * 0.08);
    expect(outside.density).toBe(0);
    expect(Number.isFinite(edge.density)).toBe(true);
  });

  it('is not a circular cylinder: opposite sides of the cocoon do not match', () => {
    const r = layout.cocoonSigmaUnits * 0.35;
    const left = sampleAgnJetMacro(-r, midY, 0, layout);
    const right = sampleAgnJetMacro(r, midY, 0, layout);
    const front = sampleAgnJetMacro(0, midY, r, layout);
    expect(Math.abs(left.density - right.density)).toBeGreaterThan(left.density * 0.04);
    expect(Math.abs(left.spineWeight - front.spineWeight)).toBeGreaterThan(0.02);
  });

  it('is deterministic, seed-dependent, and non-negative on a small grid', () => {
    const a = sampleAgnJetField(1.2, midY, -0.4, layout);
    const b = sampleAgnJetField(1.2, midY, -0.4, layout);
    expect(a).toEqual(b);
    const other = agnJetVolumeLayout('extended', 'plus', 99, 'high');
    const c = sampleAgnJetField(1.2, midY, -0.4, other);
    expect(c.density).not.toBe(a.density);
    for (let i = 0; i < 9; i += 1) {
      const sample = sampleAgnJetField((i - 4) * 3, midY, (i % 3) - 1, layout);
      expect(sample.density).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(sample.density)).toBe(true);
      expect(sample.spineWeight).toBeGreaterThanOrEqual(0);
      expect(sample.spineWeight).toBeLessThanOrEqual(1);
    }
  });

  it('measures light-travel distance outward on both lobes and is dark on the midplane', () => {
    const plus = agnJetVolumeLayout('base', 'plus', 307, 'medium');
    const minus = agnJetVolumeLayout('base', 'minus', 307, 'medium');
    const y = plus.lengthUnits * 0.3;
    const up = sampleAgnJetMacro(0.2, y, -0.1, plus);
    const down = sampleAgnJetMacro(0.2, -y, -0.1, minus);
    // Sides do not share a noise seed, so the lobes are not copies. The
    // delay coordinate is still the outward distance on both.
    expect(up.density).toBeGreaterThan(0);
    expect(down.density).toBeGreaterThan(0);
    expect(up.outwardUnits).toBeCloseTo(y);
    expect(down.outwardUnits).toBeCloseTo(y);
    expect(sampleAgnJetMacro(0, 0, 0, plus).axialWindow).toBe(0);
    expect(sampleAgnJetMacro(0, -plus.lengthUnits * 1.2, 0, minus).density).toBe(0);
  });
});
