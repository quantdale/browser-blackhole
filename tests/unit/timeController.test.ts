import { describe, expect, it } from 'vitest';
import { TimeController } from '../../src/atlas/TimeController.js';

/**
 * WS1 frame invalidation (openspec/changes/whole-atlas-performance-
 * optimization): `consumeDirty()` is the TIME_ADVANCED signal host.frame()
 * reads once per tick. These tests pin the exact contract other invalidation
 * wiring depends on: dirty starts true (first frame must render), consuming
 * clears it, playback/scrub/reset only re-dirty when the internal coordinate
 * actually moves, and a paused or already-clamped controller never re-dirties
 * on its own.
 */
describe('TimeController: consumeDirty invalidation signal', () => {
  it('starts dirty so the very first frame renders', () => {
    const time = new TimeController();
    expect(time.consumeDirty()).toBe(true);
  });

  it('consumeDirty clears the flag until something changes again', () => {
    const time = new TimeController();
    time.consumeDirty(); // discard the initial dirty
    expect(time.consumeDirty()).toBe(false);
    expect(time.consumeDirty()).toBe(false);
  });

  it('update() while playing at a nonzero rate dirties every tick that moves the coordinate', () => {
    const time = new TimeController({ initialPhase: 0, playbackRate: 1, paused: false });
    time.consumeDirty();
    time.update(0.1);
    expect(time.consumeDirty()).toBe(true);
  });

  it('update() while paused never dirties', () => {
    const time = new TimeController({ initialPhase: 0.5, paused: true });
    time.consumeDirty();
    time.update(0.1);
    expect(time.consumeDirty()).toBe(false);
  });

  it('update() at rate 0 never dirties', () => {
    const time = new TimeController({ initialPhase: 0.5, playbackRate: 0, paused: false });
    time.consumeDirty();
    time.update(0.1);
    expect(time.consumeDirty()).toBe(false);
  });

  it('update() clamped at the timeline boundary stops dirtying once settled', () => {
    // Identity mapping range is [0, 1]; rate 1 reaches the boundary in 1s.
    const time = new TimeController({ initialPhase: 0, playbackRate: 1, paused: false });
    time.consumeDirty();
    time.update(2); // overshoots past 1, clamps
    expect(time.consumeDirty()).toBe(true); // moved 0 -> 1: one last dirty frame
    time.update(0.1); // already at the clamped boundary; no further movement
    expect(time.consumeDirty()).toBe(false);
  });

  it('scrubTo dirties even though it is not called from update()', () => {
    const time = new TimeController({ initialPhase: 0, paused: true });
    time.consumeDirty();
    time.scrubTo(0.7);
    expect(time.consumeDirty()).toBe(true);
  });

  it('scrubTo to the same phase does not dirty', () => {
    const time = new TimeController({ initialPhase: 0.4, paused: true });
    time.consumeDirty();
    time.scrubTo(0.4);
    expect(time.consumeDirty()).toBe(false);
  });

  it('reset() dirties when it moves the coordinate', () => {
    const time = new TimeController({ initialPhase: 0.9, paused: true });
    time.consumeDirty();
    time.reset(0);
    expect(time.consumeDirty()).toBe(true);
  });

  it('a scrub between two frame() ticks is not lost by a same-tick before/after comparison', () => {
    // Regression guard for the bug this design deliberately avoids: comparing
    // internalCoordinate immediately before/after update() misses a mutation
    // (scrubTo) that already happened earlier in the same tick, before
    // update() runs. The sticky dirty flag must survive across that gap.
    const time = new TimeController({ initialPhase: 0, paused: true });
    time.consumeDirty();
    time.scrubTo(0.3); // external mutation, e.g. a UI slider onInput handler
    time.update(0.016); // host's per-frame update() call; paused, so a no-op
    expect(time.consumeDirty()).toBe(true);
  });
});
