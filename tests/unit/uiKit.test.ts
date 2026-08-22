/**
 * Unit tests for the pure (DOM-free) helpers of the Atlas UI kit.
 * DOM components themselves are covered by browser suites; these pin the
 * numeric guard contracts every interactive control relies on
 * (docs/UI_UX.md §5: bounded validated inputs, clamp never reject).
 */

import { describe, expect, it } from 'vitest';

import {
  clamp01,
  decimalsFromStep,
  finiteClamp,
  finiteOrNull,
  formatSliderValue
} from '../../src/ui/atlas/util.js';

describe('finiteOrNull', () => {
  it('passes finite numbers through', () => {
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull(-3.5)).toBe(-3.5);
    expect(finiteOrNull(Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
  });

  it('collapses NaN, Infinity and non-numbers to null', () => {
    expect(finiteOrNull(Number.NaN)).toBeNull();
    expect(finiteOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteOrNull(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(finiteOrNull('2')).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
    expect(finiteOrNull(null)).toBeNull();
  });
});

describe('finiteClamp', () => {
  it('clamps into [min, max]', () => {
    expect(finiteClamp(5, 0, 10)).toBe(5);
    expect(finiteClamp(-1, 0, 10)).toBe(0);
    expect(finiteClamp(11, 0, 10)).toBe(10);
  });

  it('collapses non-finite input to min', () => {
    expect(finiteClamp(Number.NaN, 1, 9)).toBe(1);
    expect(finiteClamp(Number.POSITIVE_INFINITY, 1, 9)).toBe(1);
  });

  it('returns min for values below an (degenerate) inverted range', () => {
    // Documented degenerate behavior: when max < min every value falls on one
    // side of the empty range; below-min values collapse to min.
    expect(finiteClamp(5, 10, 0)).toBe(10);
    expect(finiteClamp(-5, 10, 0)).toBe(10);
  });
});

describe('clamp01', () => {
  it('maps into the unit interval', () => {
    expect(clamp01(-0.25)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1.5)).toBe(1);
  });

  it('collapses non-finite input to 0', () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('decimalsFromStep', () => {
  it('derives decimal places from the step magnitude', () => {
    expect(decimalsFromStep(1)).toBe(0);
    expect(decimalsFromStep(0.5)).toBe(1);
    expect(decimalsFromStep(0.01)).toBe(2);
    expect(decimalsFromStep(0.001)).toBe(3);
  });

  it('returns 0 for non-positive, non-finite or integer steps', () => {
    expect(decimalsFromStep(0)).toBe(0);
    expect(decimalsFromStep(-0.1)).toBe(0);
    expect(decimalsFromStep(Number.NaN)).toBe(0);
    expect(decimalsFromStep(4)).toBe(0);
  });

  it('caps pathological precision at 6 decimals', () => {
    expect(decimalsFromStep(0.0000001)).toBeLessThanOrEqual(6);
  });
});

describe('formatSliderValue', () => {
  it('formats with step-derived precision and optional unit', () => {
    expect(formatSliderValue(1.5, 0.1)).toBe('1.5');
    expect(formatSliderValue(1.5, 0.1, 'eV')).toBe('1.5 eV');
    expect(formatSliderValue(2, 1)).toBe('2');
  });

  it('renders non-finite values as zero rather than "NaN"', () => {
    expect(formatSliderValue(Number.NaN, 0.1)).toBe('0.0');
  });
});
