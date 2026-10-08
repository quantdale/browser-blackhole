import { describe, expect, it } from 'vitest';

import { TransitionDirector } from '../../src/atlas/TransitionDirector.js';
import type {
  TransitionDeps,
  TransitionDirectorOptions
} from '../../src/atlas/TransitionDirector.js';
import { ResourceScope } from '../../src/renderer/shared/ResourceScope.js';
import type {
  DestinationId,
  PhenomenonDescriptor,
  PresetDescriptor,
  PreparedPhenomenon,
  QualityTier
} from '../../src/atlas/types.js';
import type { TransitionPrepareRequest } from '../../src/atlas/TransitionDirector.js';

/**
 * atlas-error-reporting — transition failure publication + stall gate.
 *
 * Pins the two behaviours that the product shell depends on and that no other
 * unit test can reach: the error is part of the PUBLIC state (never director
 * internals), a superseded attempt never publishes, a successful transition
 * clears it, and an outstanding preparation with no progress event for the
 * stall window terminates in a recoverable failure instead of hanging.
 *
 * The director is driven with minimal stubs through its real code path
 * (`requestTransition` → `runPrepare` → `update`); nothing here re-implements
 * director logic.
 */

interface Harness {
  director: TransitionDirector;
  errors: Array<{ message: string; code: string; fatal: boolean }>;
  /** Resolve/reject the OLDEST in-flight prepare promise. */
  settlePrepare(payload?: unknown, error?: unknown): void;
  /** Advance the director by `ms` of REAL time (the stall gate reads the wall clock). */
  tick(ms: number): Promise<void>;
  /** Directly invoke the newest prepare request's progress reporter. */
  reportProgress(fraction01: number, label?: string): void;
  /** The newest prepare request the director issued. */
  lastRequest(): TransitionPrepareRequest | null;
}

const DESTINATION_ID: DestinationId = 'galaxy-collision';

function descriptor(id: DestinationId = DESTINATION_ID): PhenomenonDescriptor {
  return {
    id,
    title: 'Galaxy Collision',
    group: 'galactic',
    fidelity: 'DATA_DRIVEN',
    route: 'galaxy-collision',
    defaultPreset: 'encounter',
    requiredCapabilities: [],
    estimatedGpuMemoryMB: { low: 16, medium: 32, high: 64, ultra: 96 },
    load: async () => (): never => {
      throw new Error('not used');
    }
  };
}

function preset(id: DestinationId = DESTINATION_ID): PresetDescriptor {
  return {
    id: 'encounter',
    displayName: 'Encounter',
    destinationId: id,
    stateSchemaVersion: 1,
    fidelityNote: '',
    state: {},
    camera: { position: [0, 0, 10], target: [0, 0, 0] },
    seed: 1,
    timelineInitialPhase: 0
  };
}

function createHarness(
  options: {
    /** Slow-load reporting threshold; the stall window defaults to 10x this. */
    slowLoadThresholdMs?: number;
    /** Explicit stall window override. */
    stallThresholdMs?: number;
  } = {}
): Harness {
  const errors: Array<{ message: string; code: string; fatal: boolean }> = [];
  /** One entry per prepare attempt, in request order. */
  const pending: Array<{
    request: TransitionPrepareRequest;
    resolve: (value: PreparedPhenomenon) => void;
    reject: (reason: unknown) => void;
  }> = [];

  const prepared = (): PreparedPhenomenon =>
    ({
      module: { descriptor: descriptor(), prepare: async () => prepared() },
      scope: new ResourceScope('dest'),
      scene: {},
      preset: preset()
    }) as unknown as PreparedPhenomenon;

  const deps: TransitionDeps = {
    resources: {
      createScope: (name: string) => new ResourceScope(name),
      // Unused by these paths.
      getScope: () => undefined,
      scopes: () => []
    } as unknown as TransitionDeps['resources'],
    post: {
      captureSnapshot: () => null,
      releaseSnapshot: () => undefined,
      present: () => undefined
    } as unknown as TransitionDeps['post'],
    governor: {
      currentTier: 'high' as QualityTier,
      configure: () => undefined
    } as unknown as TransitionDeps['governor'],
    cameraRig: {
      captureTransform: () => ({ position: [0, 0, 1], target: [0, 0, 0] }),
      setControlsEnabled: () => undefined,
      applyArrivalPreset: () => undefined
    } as unknown as TransitionDeps['cameraRig'],
    getRenderer: () => null,
    callbacks: {
      getActiveDestination: () => null,
      resolveTarget: (destinationId) => ({
        descriptor: descriptor(destinationId),
        preset: preset(destinationId)
      }),
      prepare: (request) =>
        new Promise<PreparedPhenomenon>((resolve, reject) => {
          pending.push({ request, resolve, reject });
          // Production abort semantics: the outstanding request is aborted, so
          // the in-flight promise REJECTS. Modelling that here is what lets the
          // stall gate and a retarget both be observed end to end.
          request.signal.addEventListener('abort', () => {
            reject(new DOMException(`aborted: ${request.descriptor.id}`, 'AbortError'));
          });
        }),
      activate: () => undefined,
      exitActive: () => undefined,
      disposeActive: () => undefined,
      disposePrepared: () => undefined
    }
  };

  const director = new TransitionDirector(deps, {
    ...(options.slowLoadThresholdMs === undefined
      ? {}
      : { slowLoadThresholdMs: options.slowLoadThresholdMs }),
    ...(options.stallThresholdMs === undefined
      ? {}
      : { stallThresholdMs: options.stallThresholdMs })
  } satisfies TransitionDirectorOptions);
  director.onError((event) => {
    errors.push({ message: event.message, code: event.code, fatal: event.fatal });
  });

  return {
    director,
    errors,
    settlePrepare(payload, error) {
      const entry = pending.shift();
      if (entry === undefined) return;
      if (error !== undefined) entry.reject(error);
      else entry.resolve((payload as PreparedPhenomenon | undefined) ?? prepared());
    },
    async tick(ms) {
      // The stall gate reads the WALL clock, so a purely synchronous loop would
      // never expire it: wait real time, then advance the deterministic frame.
      await new Promise((resolve) => setTimeout(resolve, ms));
      director.update(ms / 1000);
    },
    reportProgress(fraction01, label) {
      pending[pending.length - 1]?.request.reportProgress(fraction01, label);
    },
    lastRequest() {
      return pending[pending.length - 1]?.request ?? null;
    }
  };
}

describe('transition error publication', () => {
  it('publishes a completing failure on the public state with code and destination', async () => {
    const h = createHarness();
    h.director.requestTransition({ destinationId: DESTINATION_ID });

    // No error while the preparation is merely in flight.
    expect(h.director.getPublicState().error).toBeNull();

    h.settlePrepare(undefined, new Error('manifest fetch failed: 404'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const state = h.director.getPublicState();
    expect(state.error).not.toBeNull();
    expect(state.error?.code).toBe('TRANSITION_PREPARE_FAILED');
    expect(state.error?.destinationId).toBe('galaxy-collision');
    expect(state.error?.fatal).toBe(false);
    // The transition returns to idle rather than staying in `preparing`.
    expect(state.active).toBe(false);
    expect(state.phase).toBeNull();
    // The published message is authored copy, not the raw loader string.
    expect(state.error?.message).toContain('Galaxy Collision');
    expect(state.error?.message).not.toContain('manifest fetch failed');
    // The technical detail still reaches the event channel.
    expect(h.errors[0]?.message).toContain('manifest fetch failed: 404');
  });

  it('does not publish an error for a superseded attempt', async () => {
    const h = createHarness();
    h.director.requestTransition({ destinationId: DESTINATION_ID });

    // Retarget: the director aborts attempt A's controller, so A rejects with
    // AbortError while attempt B owns the machine. A's catch must see
    // `stale(gen)` and discard it — publishing it would attribute attempt B's
    // request to attempt A's failure.
    h.director.requestTransition({ destinationId: 'neutron-star' });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    expect(h.director.getPublicState().error).toBeNull();
    expect(h.errors).toHaveLength(0);
  });

  it('clears a published error when a transition completes successfully', async () => {
    const h = createHarness();
    h.director.requestTransition({ destinationId: DESTINATION_ID });
    h.settlePrepare(undefined, new Error('transient'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.director.getPublicState().error).not.toBeNull();

    // Retry succeeds.
    h.director.requestTransition({ destinationId: DESTINATION_ID });
    expect(h.director.getPublicState().error).toBeNull();
    h.settlePrepare();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Drive the motion phases to completion.
    for (let i = 0; i < 400 && h.director.getPublicState().active; i += 1) {
      await h.tick(16);
      await Promise.resolve();
    }
    expect(h.director.getPublicState().active).toBe(false);
    expect(h.director.getPublicState().error).toBeNull();
  });

  it('clears the published error when a new request supersedes it', async () => {
    const h = createHarness();
    h.director.requestTransition({ destinationId: DESTINATION_ID });
    h.settlePrepare(undefined, new Error('boom'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.director.getPublicState().error).not.toBeNull();

    h.director.requestTransition({ destinationId: 'neutron-star' });
    expect(h.director.getPublicState().error).toBeNull();
  });
});

describe('preparation stall gate', () => {
  // A small window keeps these rows fast; the production default is 10x the
  // 900 ms slow-load threshold. The constructor guard (stall > slow-load) is
  // still exercised by the first row.
  const SLOW = 5;
  const STALL = 30;
  const TICK = 10;

  it('rejects a stall threshold that does not exceed the slow-load threshold', () => {
    expect(() => createHarness({ slowLoadThresholdMs: 20, stallThresholdMs: 20 })).toThrow(
      /must exceed slowLoadThresholdMs/
    );
  });

  it('terminates an outstanding preparation that emits no progress event', async () => {
    const h = createHarness({ slowLoadThresholdMs: SLOW, stallThresholdMs: STALL });
    h.director.requestTransition({ destinationId: DESTINATION_ID });

    // No reportProgress at all: only the start event the director records at
    // request time. Drive well past the window.
    for (let i = 0; i < 12; i += 1) await h.tick(TICK);

    const state = h.director.getPublicState();
    expect(state.active, 'the machine must leave preparing').toBe(false);
    expect(state.error?.code).toBe('TRANSITION_STALLED');
    expect(state.error?.fatal).toBe(false);
    expect(state.error?.message).toContain('cancelled');
    // The underlying prepare was aborted through the existing path.
    expect(h.lastRequest()?.signal.aborted).toBe(true);
  });

  it('does not abort a preparation that keeps emitting progress events', async () => {
    const h = createHarness({ slowLoadThresholdMs: SLOW, stallThresholdMs: STALL });
    h.director.requestTransition({ destinationId: DESTINATION_ID });

    // A strictly increasing finite fraction every tick — inside the window —
    // for far longer than the stall duration would allow.
    for (let i = 1; i <= 60; i += 1) {
      h.reportProgress(i / 100, `step ${i}`);
      await h.tick(TICK);
    }

    const state = h.director.getPublicState();
    expect(state.active, 'a progressing preparation is never aborted').toBe(true);
    expect(state.error).toBeNull();
    expect(h.lastRequest()?.signal.aborted).toBe(false);
  });

  it('aborts a preparation whose reports only change the label', async () => {
    const h = createHarness({ slowLoadThresholdMs: SLOW, stallThresholdMs: STALL });
    h.director.requestTransition({ destinationId: DESTINATION_ID });

    // The first 0.5 arms the clock; every later 0.5 is a LABEL change, not a
    // progress event, so the window is never re-armed.
    for (let i = 0; i < 12; i += 1) {
      h.reportProgress(0.5, `still working ${i}`);
      await h.tick(TICK);
    }

    expect(h.director.getPublicState().error?.code).toBe('TRANSITION_STALLED');
  });

  it('aborts when a later report goes backwards', async () => {
    const h = createHarness({ slowLoadThresholdMs: SLOW, stallThresholdMs: STALL });
    h.director.requestTransition({ destinationId: DESTINATION_ID });

    h.reportProgress(0.9, 'downloaded');
    await h.tick(TICK);
    // A LOWER fraction is a label change, not progress.
    h.reportProgress(0.6, 'building');

    for (let i = 0; i < 12; i += 1) await h.tick(TICK);

    expect(h.director.getPublicState().error?.code).toBe('TRANSITION_STALLED');
  });

  it('ignores non-finite reports as progress events', async () => {
    const h = createHarness({ slowLoadThresholdMs: SLOW, stallThresholdMs: STALL });
    h.director.requestTransition({ destinationId: DESTINATION_ID });

    for (let i = 0; i < 12; i += 1) {
      h.reportProgress(Number.NaN, 'indeterminate');
      await h.tick(TICK);
    }

    expect(h.director.getPublicState().error?.code).toBe('TRANSITION_STALLED');
  });
});
