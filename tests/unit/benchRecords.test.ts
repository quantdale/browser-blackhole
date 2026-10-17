/**
 * Benchmark record-helper tests (benchmark-harness-integrity tasks 3.6/6.4).
 *
 * - 6.4/B-06: refusals ACCUMULATE — a record with two independent refusals
 *   must report BOTH (the old `record.refusal = x` overwrite lost the first).
 * - 3.6/B-02: the matrix's record normalisation is unit-tested so a shape
 *   drift fails here rather than silently measuring the wrong thing.
 */

import { describe, expect, it } from 'vitest';

import { accumulateRefusal, normalizeRecord } from '../../scripts/lib/bench-records.mjs';
import type { BenchRefusalRecord } from '../../scripts/lib/bench-records.mjs';

describe('accumulateRefusal (B-06)', () => {
  it('reports both reasons when two independent refusals fire (6.4)', () => {
    const record: BenchRefusalRecord = { refusal: null };
    accumulateRefusal(record, 'stationary cost window rendered 0 frames');
    accumulateRefusal(record, 'camera interaction window rendered 0 frames');
    expect(record.refusal).toContain('stationary cost window');
    expect(record.refusal).toContain('camera interaction window');
    expect(record.refusals).toHaveLength(2);
  });

  it('keeps a single reason readable', () => {
    const record: BenchRefusalRecord = { refusal: null };
    accumulateRefusal(record, 'only one');
    expect(record.refusal).toBe('only one');
    expect(record.refusals).toEqual(['only one']);
  });
});

describe('normalizeRecord (3.6)', () => {
  it('normalises the legacy shape (backend string, medianMs, quality tier)', () => {
    const normalized = normalizeRecord({
      backend: 'webgpu',
      quality: 'high',
      internal: [972, 727],
      medianMs: 6.1,
      consoleErrors: []
    });
    expect(normalized).toMatchObject({
      backend: 'webgpu',
      tier: 'high',
      internal: [972, 727],
      cpuMedian: 6.1
    });
    expect(normalized.consoleErrors).toBe(0);
  });

  it('normalises the schema-2 shape (nested api/tier, frameCpuMs, gpu timestamps)', () => {
    const normalized = normalizeRecord({
      backend: { api: 'webgl2' },
      quality: { effectiveTier: 'low' },
      effectiveRenderSize: [640, 360],
      frameCpuMs: { median: 4.2 },
      frameGpuMs: { lastResolvedFrame: 1.25 },
      memory: { estimatedGpuBytesTotal: 12345 },
      consoleErrors: ['boom', 'bang']
    });
    expect(normalized.backend).toBe('webgl2');
    expect(normalized.tier).toBe('low');
    expect(normalized.cpuMedian).toBe(4.2);
    expect(normalized.gpuMs).toBe(1.25);
    expect(normalized.estimatedGpuBytes).toBe(12345);
    expect(normalized.consoleErrors).toBe(2);
  });

  it('missing fields normalise to null rather than throwing', () => {
    const normalized = normalizeRecord({});
    expect(normalized).toEqual({
      backend: null,
      tier: null,
      internal: null,
      cpuMedian: null,
      gpuMs: null,
      estimatedGpuBytes: null,
      consoleErrors: 0
    });
  });
});
