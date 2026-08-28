import { describe, expect, it } from 'vitest';

import { collectInventory } from '../../src/atlas/debugInventory.js';
import {
  describeInvalidationReasons,
  INVALIDATION_REASON,
  INVALIDATION_REASON_NAMES
} from '../../src/atlas/types.js';
import type {
  FrameInvalidationTelemetry,
  InvalidationReasonName,
  RendererInfoTelemetry
} from '../../src/atlas/types.js';

/**
 * WS0/tasks.md §1 — shared telemetry.
 *
 * These assert the DECODING and TRANSPORT of the new counters, which is the
 * part that can be wrong silently: a mask decoded in the wrong bit order or a
 * field dropped on its way into the debug inventory would make every later
 * workstream's "work eliminated" evidence meaningless while still looking
 * plausible.
 */

function zeroReasonCounts(): Record<InvalidationReasonName, number> {
  return Object.fromEntries(INVALIDATION_REASON_NAMES.map((name) => [name, 0])) as Record<
    InvalidationReasonName,
    number
  >;
}

describe('describeInvalidationReasons', () => {
  it('decodes an empty mask as no reasons (the skippable-frame case)', () => {
    expect(describeInvalidationReasons(0)).toEqual([]);
  });

  it('decodes every single-bit mask back to exactly its own name', () => {
    for (const name of INVALIDATION_REASON_NAMES) {
      expect(describeInvalidationReasons(INVALIDATION_REASON[name])).toEqual([name]);
    }
  });

  it('decodes a combined mask in canonical bit order, not insertion order', () => {
    const mask =
      INVALIDATION_REASON.POST_CHANGED |
      INVALIDATION_REASON.TIME_ADVANCED |
      INVALIDATION_REASON.RESIZE;
    expect(describeInvalidationReasons(mask)).toEqual(['TIME_ADVANCED', 'RESIZE', 'POST_CHANGED']);
  });

  it('ignores bits that no reason claims', () => {
    const unusedBit = 1 << 30;
    expect(describeInvalidationReasons(unusedBit | INVALIDATION_REASON.RESIZE)).toEqual(['RESIZE']);
  });

  it('assigns every reason a distinct bit', () => {
    const bits = INVALIDATION_REASON_NAMES.map((name) => INVALIDATION_REASON[name]);
    expect(new Set(bits).size).toBe(bits.length);
    for (const bit of bits) {
      // Exactly one bit set: a reason that overlapped another would silently
      // attribute frames to the wrong cause.
      expect(bit & (bit - 1)).toBe(0);
    }
  });
});

describe('debug inventory telemetry transport', () => {
  const frame: FrameInvalidationTelemetry = {
    lastReasons: INVALIDATION_REASON.CONTROL_CHANGED,
    lastReasonNames: ['CONTROL_CHANGED'],
    lastFrameRendered: true,
    lastFrameWork: { destinationUpdated: true, destinationDrawn: true, postPresented: true },
    framesObserved: 120,
    framesRendered: 3,
    framesSkipped: 117,
    reasonCounts: { ...zeroReasonCounts(), CONTROL_CHANGED: 3 }
  };
  const rendererInfo: RendererInfoTelemetry = {
    render: { frameCalls: 1, drawCalls: 7, triangles: 42, points: 0, lines: 12 },
    compute: { frameCalls: 2 },
    memory: {
      geometries: 5,
      textures: 9,
      programs: 11,
      renderTargets: 3,
      storageAttributes: 1,
      uniformBuffers: 4,
      totalBytes: 123456
    }
  };

  it('passes frame and renderer telemetry through unchanged', () => {
    const view = collectInventory({
      resources: null,
      activeDestinationId: 'black-hole',
      rendererGeneration: 1,
      pendingPrepares: 0,
      governor: null,
      backend: null,
      gpuFrameMs: null,
      frame,
      rendererInfo
    });
    expect(view.frame).toEqual(frame);
    expect(view.rendererInfo).toEqual(rendererInfo);
  });

  it('reports nulls rather than fabricated zeros before the host wires them', () => {
    const view = collectInventory({
      resources: null,
      activeDestinationId: null,
      rendererGeneration: 0,
      pendingPrepares: 0,
      governor: null,
      backend: null,
      gpuFrameMs: null,
      frame: null,
      rendererInfo: null
    });
    // A zeroed record would read as "measured, and everything was zero".
    expect(view.frame).toBeNull();
    expect(view.rendererInfo).toBeNull();
  });

  it('keeps skipped = observed - rendered, the work-elimination measure', () => {
    expect(frame.framesSkipped).toBe(frame.framesObserved - frame.framesRendered);
  });
});
