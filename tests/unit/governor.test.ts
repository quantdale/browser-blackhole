import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerformanceGovernor } from '../../src/atlas/governor.js';

/**
 * Deterministic-clock harness for the PerformanceGovernor.
 * performance.now() is mocked; frames are explicit begin/end pairs whose
 * sampled duration equals frameMs. Counts below are chosen so EMA decay
 * (alpha 0.1), sustain windows, the 3 s wall-clock grace, and the 2 s
 * anti-flap cooldown resolve unambiguously at frame granularity.
 */

let nowMs = 0;
let restoreClock: () => void = () => {};

beforeEach(() => {
  nowMs = 0;
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  restoreClock = () => {
    spy.mockRestore();
  };
});

afterEach(() => {
  restoreClock();
  vi.restoreAllMocks();
});

function step(governor: PerformanceGovernor, frameMs: number): void {
  governor.beginFrame();
  nowMs += frameMs;
  governor.endFrame();
}

function stepFrames(governor: PerformanceGovernor, count: number, frameMs: number): void {
  for (let i = 0; i < count; i += 1) step(governor, frameMs);
}

const VSYNC_60_MS = 1000 / 60; // smoothed -> 60 fps
const VSYNC_120_MS = 1000 / 120; // smoothed -> 120 fps
const OVERLOAD_25_MS = 40; // smoothed -> 25 fps (below 0.8 x 60)

/** Past the 3 s startup grace window on healthy 60 fps frames. */
function warmUpPastGrace(governor: PerformanceGovernor): void {
  stepFrames(governor, 190, VSYNC_60_MS);
}

function newAutoGovernor(): PerformanceGovernor {
  const governor = new PerformanceGovernor();
  governor.configure({ qualityMode: 'auto', targetFps: 60 });
  return governor;
}

describe('PerformanceGovernor auto-tier recovery (refresh-aware raise)', () => {
  it('climbs back after a downgrade on a vsync-locked 60 Hz display', () => {
    const governor = newAutoGovernor();
    const events: string[] = [];
    governor.onTierChanged((tier) => events.push(tier));

    warmUpPastGrace(governor);
    expect(events).toEqual([]);

    // Sustained overload forces exactly one downgrade (high -> medium):
    // EMA crosses 48 fps after 4 frames; 1 s of sustain lands ~30 frames in.
    stepFrames(governor, 45, OVERLOAD_25_MS);
    expect(events).toEqual(['medium']);
    expect(governor.currentTier).toBe('medium');

    // Back at compositor cadence the tier must recover: smoothed 60 fps
    // exceeds min(target x 1.15 = 69, estimated refresh 60 - 4) = 56, a bar
    // the raw factor could never clear on this display.
    stepFrames(governor, 260, VSYNC_60_MS);
    expect(events).toEqual(['medium', 'high']);
    expect(governor.currentTier).toBe('high');
  });

  it('keeps the raw raise factor on displays with real headroom', () => {
    const governor = newAutoGovernor();
    // 120 Hz cadence: estimated refresh 120 caps the raise bar at
    // min(69, 116) = 69; smoothed 120 fps clears it once grace expires.
    // Wall time: 800 frames x 8.33 ms covers grace (360 frames) plus the
    // 3 s raise sustain (another 360 frames).
    stepFrames(governor, 800, VSYNC_120_MS);
    expect(governor.currentTier).toBe('ultra');
  });
});

describe('PerformanceGovernor startup grace', () => {
  it('does not cascade tiers during warmup compilation spikes', () => {
    const governor = newAutoGovernor();
    const events: string[] = [];
    governor.onTierChanged((tier) => events.push(tier));

    // 2 s of pathological frames inside the 3 s grace window.
    stepFrames(governor, 5, 400);
    expect(governor.currentTier).toBe('high');

    // Recovery: grace expires ~60 frames in; EMA is back above the drop
    // threshold by then and has far less than 3 s above the raise bar.
    stepFrames(governor, 80, VSYNC_60_MS);
    expect(events).toEqual([]);
    expect(governor.currentTier).toBe('high');
  });

  it('still degrades when overload persists well past the grace window', () => {
    const governor = newAutoGovernor();
    warmUpPastGrace(governor);
    // 60 overloaded frames: enough for grace-free drop (~frame 30), short
    // enough that the anti-flap cooldown suppresses a second change.
    stepFrames(governor, 60, OVERLOAD_25_MS);
    expect(governor.currentTier).toBe('medium');
  });
});

describe('PerformanceGovernor work-multiplier lifecycle', () => {
  /** 26.5 fps sits in the comfort band of a 30 fps effective target. */
  const HEAVY_TARGET_FRAME_MS = 1000 / 26.5;

  it('uses the heaviest registered multiplier before any activation signal', () => {
    const governor = newAutoGovernor();
    const events: string[] = [];
    governor.onTierChanged((tier) => events.push(tier));
    governor.setWorkMultiplier('heavy', 2);
    stepFrames(governor, 250, HEAVY_TARGET_FRAME_MS);
    expect(events).toEqual([]);
    expect(governor.currentTier).toBe('high');
  });

  it('switches expectations with the active destination at constant fps', () => {
    const governor = newAutoGovernor();
    const events: string[] = [];
    governor.onTierChanged((tier) => events.push(tier));
    governor.setWorkMultiplier('heavy', 2);

    // Legacy phase: no activation signal yet, heaviest fallback applies.
    stepFrames(governor, 250, HEAVY_TARGET_FRAME_MS);
    expect(events).toEqual([]);

    // Host signals a light active destination: same fps now misses the
    // 60 fps expectation -> downgrade after the re-armed grace + sustain.
    governor.setActiveDestination('light');
    stepFrames(governor, 150, HEAVY_TARGET_FRAME_MS);
    expect(events).toEqual(['medium']);
    expect(governor.currentTier).toBe('medium');
  });

  it('reports the signaled active destination and defaults unregistered cost to 1', () => {
    const governor = newAutoGovernor();
    expect(governor.getWorkMultiplier('anything')).toBe(1);
    governor.setActiveDestination('a');
    expect(governor.activeDestinationId).toBe('a');
    governor.setActiveDestination(null);
    expect(governor.activeDestinationId).toBe(null);
  });
});

describe('PerformanceGovernor hysteresis accounting', () => {
  it('keeps accumulating through the anti-flap cooldown (second drop ~2 s later)', () => {
    const governor = newAutoGovernor();
    const changeTimes: number[] = [];
    governor.onTierChanged(() => changeTimes.push(nowMs));

    warmUpPastGrace(governor);
    stepFrames(governor, 150, OVERLOAD_25_MS);

    expect(changeTimes.length).toBeGreaterThanOrEqual(2);
    const first = changeTimes[0];
    const second = changeTimes[1];
    if (first === undefined || second === undefined) {
      throw new Error('expected two recorded tier changes');
    }
    const gap = second - first;
    // Accumulators grow during the cooldown, so the second change lands
    // right after the 2 s anti-flap interval instead of 2 s + full re-sustain.
    expect(gap).toBeGreaterThanOrEqual(1990);
    expect(gap).toBeLessThanOrEqual(2600);
  });
});

describe('PerformanceGovernor manual modes and forced tiers', () => {
  it('pins manual modes and ignores auto evaluation entirely', () => {
    const governor = newAutoGovernor();
    governor.configure({ qualityMode: 'low' });
    expect(governor.currentTier).toBe('low');
    stepFrames(governor, 300, OVERLOAD_25_MS);
    expect(governor.currentTier).toBe('low');
    expect(governor.renderScale).toBe(0.6);
  });

  it('forced tier overrides auto without overriding manual pins', () => {
    const governor = newAutoGovernor();
    governor.setForcedTier('low');
    expect(governor.currentTier).toBe('low');
    governor.setForcedTier(null);
    expect(governor.forcedTier).toBe(null);

    governor.configure({ qualityMode: 'ultra' });
    governor.setForcedTier('low');
    expect(governor.currentTier).toBe('ultra');
  });

  it('re-arms the grace window when a forced tier is released in auto mode', () => {
    const governor = newAutoGovernor();
    const events: string[] = [];
    governor.onTierChanged((tier) => events.push(tier));

    warmUpPastGrace(governor);
    governor.setForcedTier('medium');
    expect(events).toEqual(['medium']);

    stepFrames(governor, 10, VSYNC_60_MS);
    governor.setForcedTier(null); // resumes walking from 'medium'

    // Post-release warmup spikes must be ignored thanks to the re-armed
    // grace; without it they would push 'medium' down to 'low'.
    stepFrames(governor, 5, 400);
    stepFrames(governor, 40, VSYNC_60_MS);
    expect(events).toEqual(['medium']);
    expect(governor.currentTier).toBe('medium');
  });
});
