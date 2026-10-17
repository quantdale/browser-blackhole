/**
 * Benchmark comparator tests (benchmark-harness-integrity 5.6/B-07).
 *
 * docs/BENCHMARK_MATRIX.md §12: only comparable runs produce a percentage.
 * A mismatched pair must be REFUSED and must NAME the differing dimensions;
 * a cross-schema pair is refused; an explicit override must state that
 * comparability was overridden and which dimensions differed.
 */

import { describe, expect, it } from 'vitest';

import { compareRecords } from '../../scripts/compare-benchmarks.mjs';

/** Local structural type for dimension differences (tooling-proof). */
interface DimDiff {
  dimension: string;
  baseline: string;
  candidate: string;
}

const BASE = {
  schemaVersion: 2,
  kind: 'destination-bench',
  label: 'ns-baseline',
  commit: 'aaaa',
  preset: 'surface',
  scene: 'NS_SURFACE',
  backend: 'webgpu',
  quality: 'high',
  internal: [972, 727],
  browser: 'Edge 151',
  adapter: 'nvidia lovelace',
  samples: 600,
  medianMs: 10
};

describe('compare-benchmarks (5.6)', () => {
  it('refuses a mismatched pair and names every differing dimension', () => {
    const result = compareRecords(BASE, {
      ...BASE,
      commit: 'bbbb',
      backend: 'webgl2',
      internal: [640, 360],
      adapter: 'intel gen-12lp',
      medianMs: 20
    });
    expect(result.status).toBe('refused');
    const dims = result.differing.map((d: DimDiff) => d.dimension);
    expect(dims).toContain('backend');
    expect(dims).toContain('internalResolution');
    expect(dims).toContain('adapter');
    expect(result.message).toContain('backend');
    expect(result.message).toContain('internalResolution');
    expect(result.deltaPct).toBeUndefined(); // no percentage across incomparable runs
  });

  it('a matched pair reports a percentage', () => {
    const result = compareRecords(BASE, { ...BASE, commit: 'bbbb', medianMs: 12 });
    expect(result.status).toBe('comparable');
    expect(result.deltaPct).toBeCloseTo(20, 6);
  });

  it('refuses a cross-schema pair', () => {
    const result = compareRecords(BASE, { ...BASE, schemaVersion: 1, medianMs: 12 });
    expect(result.status).toBe('refused');
    expect(result.differing.map((d: DimDiff) => d.dimension)).toContain('schemaVersion');
  });

  it('an explicit override states that comparability was overridden and names the dimensions', () => {
    const result = compareRecords(BASE, { ...BASE, backend: 'webgl2', medianMs: 5 }, true);
    expect(result.status).toBe('overridden');
    expect(result.overrideNote).toContain('OVERRIDDEN');
    expect(result.overrideNote).toContain('backend');
    expect(result.deltaPct).toBeCloseTo(-50, 6);
  });

  it('refuses when no comparable median exists', () => {
    const result = compareRecords({ ...BASE, medianMs: null }, { ...BASE, medianMs: null });
    expect(result.status).toBe('refused');
    expect(result.message).toContain('no comparable median');
  });
});
