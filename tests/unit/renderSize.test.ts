import { describe, expect, it } from 'vitest';
import { computeInternalRenderSize } from '../../src/renderer/renderSize.js';

const policy = { renderScale: 1, maxEffectiveDpr: 2 };

describe('computeInternalRenderSize: DPR cap policy', () => {
  it('caps native DPR at maxEffectiveDpr', () => {
    const size = computeInternalRenderSize(
      { cssWidth: 800, cssHeight: 600, devicePixelRatio: 3 },
      policy
    );
    expect(size).not.toBeNull();
    if (!size) return;
    expect(size.effectiveDpr).toBe(2);
    expect(size.width).toBe(1600);
    expect(size.height).toBe(1200);
  });

  it('keeps native DPR when below the cap', () => {
    const size = computeInternalRenderSize(
      { cssWidth: 800, cssHeight: 600, devicePixelRatio: 1.25 },
      policy
    );
    expect(size?.effectiveDpr).toBe(1.25);
  });

  it('scales internal resolution by renderScale', () => {
    const size = computeInternalRenderSize(
      { cssWidth: 1000, cssHeight: 500, devicePixelRatio: 1 },
      { renderScale: 0.5, maxEffectiveDpr: 4 }
    );
    expect(size?.width).toBe(500);
    expect(size?.height).toBe(250);
  });
});

describe('computeInternalRenderSize: guards', () => {
  it('returns null for zero/negative/non-finite CSS sizes', () => {
    expect(
      computeInternalRenderSize({ cssWidth: 0, cssHeight: 600, devicePixelRatio: 1 }, policy)
    ).toBeNull();
    expect(
      computeInternalRenderSize({ cssWidth: 800, cssHeight: -1, devicePixelRatio: 1 }, policy)
    ).toBeNull();
    expect(
      computeInternalRenderSize(
        { cssWidth: Number.NaN, cssHeight: 600, devicePixelRatio: 1 },
        policy
      )
    ).toBeNull();
  });

  it('treats non-positive DPR as 1', () => {
    const size = computeInternalRenderSize(
      { cssWidth: 800, cssHeight: 600, devicePixelRatio: 0 },
      policy
    );
    expect(size?.effectiveDpr).toBe(1);
  });

  it('never returns fewer than 1x1 pixels', () => {
    const size = computeInternalRenderSize(
      { cssWidth: 1, cssHeight: 1, devicePixelRatio: 0.5 },
      { renderScale: 0.25, maxEffectiveDpr: 0.5 }
    );
    expect(size?.width).toBeGreaterThanOrEqual(1);
    expect(size?.height).toBeGreaterThanOrEqual(1);
  });
});

describe('computeInternalRenderSize: orientation cases', () => {
  it('portrait and landscape preserve aspect ratio', () => {
    const portrait = computeInternalRenderSize(
      { cssWidth: 480, cssHeight: 800, devicePixelRatio: 2 },
      policy
    );
    const landscape = computeInternalRenderSize(
      { cssWidth: 800, cssHeight: 480, devicePixelRatio: 2 },
      policy
    );
    if (!portrait || !landscape) throw new Error('expected sizes');
    expect(portrait.width / portrait.height).toBeCloseTo(480 / 800, 2);
    expect(landscape.width / landscape.height).toBeCloseTo(800 / 480, 2);
  });
});
