import { describe, expect, it } from 'vitest';

import { collectInventory, formatInventoryText } from '../../src/atlas/debugInventory.js';
import {
  describeInvalidationReasons,
  INVALIDATION_REASON,
  INVALIDATION_REASON_NAMES
} from '../../src/atlas/types.js';
import type {
  FrameInvalidationTelemetry,
  InvalidationReasonName,
  RendererInfoTelemetry,
  RuntimeTelemetry
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
  const runtime: RuntimeTelemetry = {
    size: {
      widthPx: 973,
      heightPx: 727,
      effectivePixels: 973 * 727,
      devicePixelRatio: 1,
      renderScale: 0.76
    },
    transition: { active: false, phase: null, progress: 0, destinationOccluded: false },
    volume: {
      liveVolumes: 2,
      visibleVolumes: 1,
      baseMaxSteps: 80,
      activeSteps: 40,
      internalScale: 0.5,
      internalWidth: 400,
      internalHeight: 300,
      detailOctaves: 2,
      lightingTaps: 1,
      temporalJitter: true,
      depthClipActive: true
    },
    particles: {
      liveSystems: 1,
      capacity: 100,
      drawn: 50,
      updatePath: 'cpu',
      simulationUpdates: 12,
      skippedUpdates: 3,
      lastSkipReason: 'zero-population'
    },
    lensing: {
      livePasses: 1,
      passes: [{ kind: 'kerr', qualityTier: 'high', maxSteps: 1024 }],
      environmentDetail: 0.5,
      environmentLayer: 'cinematic-diffuse+dense-stars+dust'
    }
  };

  it('passes frame, renderer and runtime telemetry through unchanged', () => {
    const view = collectInventory({
      resources: null,
      activeDestinationId: 'black-hole',
      rendererGeneration: 1,
      pendingPrepares: 0,
      governor: null,
      backend: null,
      gpuFrameMs: null,
      frame,
      rendererInfo,
      runtime
    });
    expect(view.frame).toEqual(frame);
    expect(view.rendererInfo).toEqual(rendererInfo);
    expect(view.runtime).toEqual(runtime);
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
    expect(view.runtime).toBeNull();
  });

  it('keeps skipped = observed - rendered, the work-elimination measure', () => {
    expect(frame.framesSkipped).toBe(frame.framesObserved - frame.framesRendered);
  });

  it('renders the runtime telemetry into the human-readable dump', () => {
    const view = collectInventory({
      resources: null,
      activeDestinationId: 'black-hole',
      rendererGeneration: 1,
      pendingPrepares: 0,
      governor: null,
      backend: null,
      gpuFrameMs: null,
      frame: null,
      rendererInfo: null,
      runtime
    });
    const text = formatInventoryText(view);
    expect(text).toContain(
      'internal size:'.padEnd(24) + '973x727 (707371 px, dpr 1.00, scale 0.760)'
    );
    expect(text).toContain('transition:'.padEnd(24) + 'idle active=no occluded=no progress=0.000');
    expect(text).toContain(
      'volumes:'.padEnd(24) + 'live=2 visible=1 steps=40/80 internal=400x300 octaves=2 taps=1'
    );
    expect(text).toContain(
      'particles:'.padEnd(24) + 'drawn=50/100 systems=1 path=cpu updates=12 skipped=3'
    );
    expect(text).toContain('lensing passes:'.padEnd(24) + 'kerr@high:1024');
  });
});
