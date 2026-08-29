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
  it('marks scrub/reset and mapping changes as temporal discontinuities', () => {
    const time = new TimeController({ initialPhase: 0.4, paused: true });
    expect(time.consumeDiscontinuity()).toBe(true);
    expect(time.consumeDiscontinuity()).toBe(false);
    time.scrubTo(0.4);
    expect(time.consumeDiscontinuity()).toBe(true);
    time.reset(0.4);
    expect(time.consumeDiscontinuity()).toBe(true);
  });

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

/**
 * Cinematic pacing (phenomena-animation campaign): a destination's internal
 * coordinate is in its own units and its span varies by seven orders of
 * magnitude across the atlas (28 s for a compact merger, 1.5e7 s for a tidal
 * disruption). Advancing it at one unit per wall second is what made most
 * destinations look frozen. `PhaseMapping.playbackSeconds` states how long a
 * full traverse should take in WALL time; the UI's 0.25x-4x control stays a
 * pure multiplier on top of it. `loop` makes a finite event keep playing
 * instead of holding forever on its last frame.
 */
describe('TimeController: mapping-declared cinematic pacing', () => {
  /** Mapping over [0, span] internal units with optional pacing/loop. */
  const spanMapping = (span: number, playbackSeconds?: number, loop?: boolean) => ({
    id: 'span',
    label: 'Span',
    forward: (phase01: number) => phase01 * span,
    inverse: (internal: number) => internal / span,
    formatDisplay: (internal: number) => `${internal.toFixed(2)}`,
    ...(playbackSeconds === undefined ? {} : { playbackSeconds }),
    ...(loop === undefined ? {} : { loop })
  });

  const activate = (mapping: ReturnType<typeof spanMapping>): TimeController => {
    const time = new TimeController({ initialPhase: 0, playbackRate: 1, paused: false });
    time.registerPhaseMapping(mapping.id, mapping);
    time.setPhaseMapping(mapping.id);
    return time;
  };

  it('without playbackSeconds keeps the legacy one-unit-per-second rate', () => {
    const time = activate(spanMapping(1_000_000));
    expect(time.basePlaybackRate).toBe(1);
    time.update(1);
    expect(time.internalCoordinate).toBeCloseTo(1, 10);
  });

  it('with playbackSeconds a full traverse takes exactly that many seconds', () => {
    const time = activate(spanMapping(1.5e7, 45));
    expect(time.basePlaybackRate).toBeCloseTo(1.5e7 / 45, 6);
    for (let i = 0; i < 45 * 100; i += 1) time.update(0.01);
    expect(time.simulationPhase).toBeCloseTo(1, 6);
  });

  it('the user rate multiplies the mapping pace rather than replacing it', () => {
    const time = activate(spanMapping(600, 30));
    time.setRate(2);
    time.update(1);
    // 600/30 = 20 units/s at 1x, doubled by the user control.
    expect(time.internalCoordinate).toBeCloseTo(40, 10);
    expect(time.snapshot().playbackRate).toBe(2);
    expect(time.snapshot().basePlaybackRate).toBeCloseTo(20, 10);
  });

  it('holds at the end by default', () => {
    const time = activate(spanMapping(10, 1));
    time.update(5);
    expect(time.simulationPhase).toBe(1);
    expect(time.internalCoordinate).toBe(10);
    expect(time.loopEnabled).toBe(false);
  });

  it('loop wraps past the end instead of holding', () => {
    const time = activate(spanMapping(10, 1, true));
    expect(time.loopEnabled).toBe(true);
    expect(time.snapshot().loop).toBe(true);
    time.update(1.25); // 12.5 units into a 10-unit span
    expect(time.internalCoordinate).toBeCloseTo(2.5, 10);
    expect(time.simulationPhase).toBeCloseTo(0.25, 10);
  });

  it('loop wraps backwards for reverse playback', () => {
    const time = activate(spanMapping(10, 1, true));
    time.setRate(-1);
    time.update(0.25); // -2.5 from 0 wraps to 7.5
    expect(time.internalCoordinate).toBeCloseTo(7.5, 10);
  });

  it('a looping timeline keeps dirtying frames after its first traverse', () => {
    const time = activate(spanMapping(10, 1, true));
    time.update(2); // two full traverses
    time.consumeDirty();
    time.update(0.1);
    expect(time.consumeDirty()).toBe(true);
  });

  it('a non-looping saturated timeline stops dirtying (idle-render contract)', () => {
    const time = activate(spanMapping(10, 1));
    time.update(5);
    time.consumeDirty();
    time.update(0.1);
    expect(time.consumeDirty()).toBe(false);
  });

  it('scrubbing is unaffected by pacing and loop', () => {
    const time = activate(spanMapping(600, 30, true));
    time.scrubTo(0.5);
    expect(time.internalCoordinate).toBeCloseTo(300, 10);
    time.reset(0.25);
    expect(time.internalCoordinate).toBeCloseTo(150, 10);
  });

  it('a zero-width mapping span cannot produce a non-finite rate', () => {
    const time = activate(spanMapping(0, 30, true));
    expect(time.basePlaybackRate).toBe(1);
    time.update(1);
    expect(Number.isFinite(time.internalCoordinate)).toBe(true);
  });
});

/**
 * Phase-space pacing. A piecewise/log mapping deliberately gives some stages a
 * larger share of the phase axis than their physical duration would imply (the
 * tidal disruption's minutes-long disruption versus its multi-year fallback).
 * Advancing uniformly in PHYSICAL time throws that weighting away, so such
 * mappings declare `pacing: 'phase'`.
 */
describe('TimeController: phase-space pacing for nonlinear mappings', () => {
  /**
   * Two-segment mapping mimicking the shape that motivated this mode: the
   * first half of the phase axis covers 10 internal units, the second half
   * covers 10_000.
   */
  const piecewise = {
    id: 'piecewise',
    label: 'Piecewise',
    forward: (phase01: number) => {
      const p = Math.min(1, Math.max(0, phase01));
      return p <= 0.5 ? p * 2 * 10 : 10 + (p - 0.5) * 2 * 9990;
    },
    inverse: (internal: number) =>
      internal <= 10 ? internal / 20 : 0.5 + (internal - 10) / (2 * 9990),
    formatDisplay: (internal: number) => `${internal.toFixed(1)}`,
    playbackSeconds: 20,
    pacing: 'phase' as const,
    loop: true
  };

  const activate = (): TimeController => {
    const time = new TimeController({ initialPhase: 0, playbackRate: 1, paused: false });
    time.registerPhaseMapping(piecewise.id, piecewise);
    time.setPhaseMapping(piecewise.id);
    return time;
  };

  it('reports phase pacing and a per-second phase rate', () => {
    const time = activate();
    expect(time.pacing).toBe('phase');
    expect(time.basePlaybackRate).toBeCloseTo(1 / 20, 12);
  });

  it('spends equal wall time on each half of the phase axis', () => {
    const time = activate();
    for (let i = 0; i < 1000; i += 1) time.update(0.01); // 10 s = half the span
    expect(time.simulationPhase).toBeCloseTo(0.5, 4);
    // Physical time is still reported truthfully: half the PHASE, but only
    // 10 of 10_000 internal units.
    expect(time.internalCoordinate).toBeCloseTo(10, 3);
    for (let i = 0; i < 1000; i += 1) time.update(0.01);
    expect(time.simulationPhase).toBeCloseTo(1, 4);
  });

  it('the same mapping under internal pacing never leaves the first segment', () => {
    // This is the defect phase pacing exists to avoid, pinned as a contrast:
    // uniform physical-time advance spends the whole 20 s budget covering
    // 10_000/20 = 500 units/s ... which blows through the interesting first
    // segment in the first 0.02 s.
    const internalPaced = { ...piecewise, pacing: 'internal' as const };
    const time = new TimeController({ initialPhase: 0, playbackRate: 1, paused: false });
    time.registerPhaseMapping('internal-paced', internalPaced);
    time.setPhaseMapping('internal-paced');
    expect(time.basePlaybackRate).toBeCloseTo(10_000 / 20, 6);
    time.update(0.02);
    expect(time.simulationPhase).toBeGreaterThan(0.49);
  });

  it('wraps in phase space when looping', () => {
    const time = activate();
    for (let i = 0; i < 2500; i += 1) time.update(0.01); // 25 s: 1.25 traverses
    expect(time.simulationPhase).toBeCloseTo(0.25, 3);
  });

  it('reverse playback wraps backwards in phase space', () => {
    const time = activate();
    time.setRate(-1);
    time.update(5); // -0.25 from 0
    expect(time.simulationPhase).toBeCloseTo(0.75, 6);
  });

  it('keeps dirtying frames across a wrap', () => {
    const time = activate();
    time.update(20);
    time.consumeDirty();
    time.update(0.1);
    expect(time.consumeDirty()).toBe(true);
  });
});

/**
 * Arrival autoplay must not override a DELIBERATE pause. Two callers depend on
 * it: a viewer who paused and then navigated, and the visual-golden harness,
 * which pauses the clock BEFORE navigating so every destination is captured
 * frozen at phase 0.
 */
describe('TimeController: arrival autoplay respects an explicit pause', () => {
  it('resumes from the default (never-paused) state', () => {
    const time = new TimeController({ paused: true });
    expect(time.explicitlyPaused).toBe(false);
    expect(time.resumeUnlessExplicitlyPaused()).toBe(true);
    expect(time.paused).toBe(false);
  });

  it('stays paused after an explicit pause', () => {
    const time = new TimeController();
    time.pause();
    expect(time.explicitlyPaused).toBe(true);
    expect(time.resumeUnlessExplicitlyPaused()).toBe(false);
    expect(time.paused).toBe(true);
  });

  it('play() clears the explicit pause so later arrivals autoplay again', () => {
    const time = new TimeController();
    time.pause();
    time.play();
    expect(time.explicitlyPaused).toBe(false);
    time.pause();
    time.play();
    expect(time.resumeUnlessExplicitlyPaused()).toBe(true);
  });

  it('scrub and reset do not count as explicit pauses', () => {
    const time = new TimeController();
    time.scrubTo(0.4);
    time.reset(0.1);
    expect(time.explicitlyPaused).toBe(false);
    expect(time.resumeUnlessExplicitlyPaused()).toBe(true);
  });
});
