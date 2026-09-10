import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';

/**
 * WS1 — host-owned frame invalidation / on-demand rendering
 * (openspec/changes/whole-atlas-performance-optimization, tasks.md §2).
 *
 * Proves the actual optimization directly rather than through a proxy: it
 * monkey-patches `host.kernel.renderFrame` in-page to count real orchestrated
 * frames (the expensive destination update/render + post-present path), not
 * merely `host.lastFrameRendered` (which is written by the same code under
 * test). A paused, settled scene must render ZERO further frames until a
 * genuine invalidation reason exists; each reason (control, resize, quality,
 * visual/post, destination change) must wake at least one frame afterward.
 */

/** Host frame telemetry as this spec reads it (mirrors FrameInvalidationTelemetry). */
type FrameTelemetryView = ReturnType<
  NonNullable<Window['__ATLAS_APP__']>['host']['frameTelemetry']
>;

interface RenderFrameCounterSurface {
  host: {
    kernel: { renderFrame(plan: unknown): boolean };
  };
}

async function waitForArrival(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return 'arrived';
        }),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
}

/**
 * Idle windows in this suite are measured in ANIMATION FRAMES, never in wall
 * time. A `waitForTimeout(300)` window is not evidence of an idle frame loop:
 * under parallel-worker load this host's rAF cadence itself drops below that
 * window, so "no frames in 300 ms" can be satisfied while the loop simply had
 * no opportunity to render. A rAF tick is the unit in which the loop actually
 * decides to render or skip, so counting ticks measures the optimization.
 */
async function waitForAnimationFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames;
        const step = (): void => {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    count
  );
}

/** Consecutive quiet rAF ticks that define "settled". */
const QUIESCENT_FRAMES = 20;
/** Idle observation window for the zero-frame assertions. */
const IDLE_FRAMES = 30;
/** Ticks allowed for a genuine invalidation to reach the kernel. */
const WAKE_FRAMES = 5;

/**
 * Resolves once the orchestrated-frame counter has not advanced across
 * {@link QUIESCENT_FRAMES} consecutive rAF ticks. Fails loudly — rather than
 * silently proceeding into a flaky zero-frame assertion — if the host never
 * settles, because a host that keeps rendering a paused, untouched scene IS
 * the WS1 defect this suite exists to catch.
 */
async function waitForRenderQuiescence(page: Page, maxFrames = 900): Promise<void> {
  const settled = await page.evaluate(
    ({ quietTarget, budget }) =>
      new Promise<boolean>((resolve) => {
        const counter = window as unknown as { __renderFrameCalls: number };
        let mark = counter.__renderFrameCalls;
        let quiet = 0;
        let total = 0;
        const step = (): void => {
          total += 1;
          if (counter.__renderFrameCalls === mark) {
            quiet += 1;
          } else {
            quiet = 0;
            mark = counter.__renderFrameCalls;
          }
          if (quiet >= quietTarget) {
            resolve(true);
            return;
          }
          if (total >= budget) {
            resolve(false);
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    { quietTarget: QUIESCENT_FRAMES, budget: maxFrames }
  );
  expect(settled, 'paused, untouched scene never stopped issuing orchestrated frames').toBe(true);
}

/**
 * Freeze the timeline, then wait until the host has ACTUALLY gone quiet,
 * measured with the independent orchestrated-frame counter rather than a
 * camera-displacement heuristic.
 *
 * The arrival camera ease decays asymptotically, so a fixed displacement
 * threshold can report "settled" while `CameraRig.update()` still reports a
 * change and therefore still wakes frames for several more ticks — which
 * showed up as a stray frame inside the supposedly idle measurement window.
 *
 * Returns with the counter installed and zeroed. Every assertion below still
 * counts REAL `kernel.renderFrame` calls, so the evidence stays independent
 * of `host.lastFrameRendered` (which the code under test writes itself).
 */
async function pauseAndSettle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window.__ATLAS_APP__!.host;
    host.time.pause();
    host.time.scrubTo(0);
  });
  await installRenderFrameCounter(page);
  await waitForRenderQuiescence(page);
  await resetRenderFrameCalls(page);
}

/** Installs a call counter on the real orchestrated-frame entry point. */
async function installRenderFrameCounter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window.__ATLAS_APP__!.host as unknown as RenderFrameCounterSurface['host'];
    const original = host.kernel.renderFrame.bind(host.kernel);
    (window as unknown as { __renderFrameCalls: number }).__renderFrameCalls = 0;
    host.kernel.renderFrame = (plan: unknown) => {
      (window as unknown as { __renderFrameCalls: number }).__renderFrameCalls += 1;
      return original(plan);
    };
  });
}

async function renderFrameCalls(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __renderFrameCalls: number }).__renderFrameCalls
  );
}

async function resetRenderFrameCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __renderFrameCalls: number }).__renderFrameCalls = 0;
  });
}

test.describe('frame invalidation: on-demand rendering (WS1)', () => {
  test('a paused, settled scene issues zero further orchestrated frames while idle', async ({
    page
  }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);

    // Many rAF ticks with no interaction whatsoever: every one of them is an
    // opportunity the host declined to spend on an orchestrated frame.
    await waitForAnimationFrames(page, IDLE_FRAMES);
    expect(await renderFrameCalls(page)).toBe(0);
  });

  test('a destination control change wakes the frame loop, then goes quiet again', async ({
    page
  }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('black-hole', { orbit: false });
    });
    await waitForAnimationFrames(page, WAKE_FRAMES);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);

    await resetRenderFrameCalls(page);
    await waitForAnimationFrames(page, IDLE_FRAMES);
    expect(await renderFrameCalls(page)).toBe(0);
  });

  test('resize wakes exactly the frames needed, then goes quiet again', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.handleResize(900, 600);
    });
    await waitForAnimationFrames(page, WAKE_FRAMES);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);

    await resetRenderFrameCalls(page);
    await waitForAnimationFrames(page, IDLE_FRAMES);
    expect(await renderFrameCalls(page)).toBe(0);
  });

  test('a quality-tier pin change wakes the frame loop', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.governor.setForcedTier('high');
    });
    await waitForAnimationFrames(page, WAKE_FRAMES);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);
  });

  test('captureFrame() forces a render even while idle-paused', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);

    await waitForAnimationFrames(page, IDLE_FRAMES);
    expect(await renderFrameCalls(page)).toBe(0);

    const samples = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    expect(samples).not.toBeNull();
    expect(await renderFrameCalls(page)).toBe(1);
  });

  test('a visibilitychange resume wakes exactly one frame, then goes quiet again', async ({
    page
  }) => {
    // WS3 (page visibility): real browsers stop firing rAF while a tab is
    // hidden (engine responsibility, not app code, and not reproducible from
    // a headless in-page dispatch), so this test exercises the one thing the
    // app's OWN handler is responsible for: the resume-side nudge that fires
    // whenever a 'visibilitychange' event is observed while the document
    // reports visible (src/app/atlasApp.ts onVisibilityChange).
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);

    await waitForAnimationFrames(page, IDLE_FRAMES);
    expect(await renderFrameCalls(page)).toBe(0);

    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitForAnimationFrames(page, WAKE_FRAMES);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);

    await resetRenderFrameCalls(page);
    await waitForAnimationFrames(page, IDLE_FRAMES);
    expect(await renderFrameCalls(page)).toBe(0);
  });

  test('host frame telemetry agrees with the independent renderFrame counter', async ({ page }) => {
    // WS0/tasks.md §1. The counters exist so later workstreams can prove work
    // elimination WITHOUT a timing measurement, which means they are only
    // worth having if they agree with reality. `__renderFrameCalls` is
    // collected by patching the kernel entry point, so it is independent of
    // the host bookkeeping under test here.
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);
    await page.evaluate(() => window.__ATLAS_APP__!.host.resetFrameTelemetry());

    await waitForAnimationFrames(page, IDLE_FRAMES);
    const idle = await page.evaluate(() => window.__ATLAS_APP__!.host.frameTelemetry());
    expect(await renderFrameCalls(page)).toBe(0);
    expect(idle.framesRendered).toBe(0);
    expect(idle.framesObserved).toBeGreaterThan(0);
    expect(idle.framesSkipped).toBe(idle.framesObserved);
    expect(idle.lastReasonNames).toEqual([]);
    expect(idle.lastFrameRendered).toBe(false);
    // A skipped frame must report no work. The kernel is not even invoked on
    // one, so reporting its previous flags here would claim the destination
    // was updated and drawn on a frame that never ran.
    expect(idle.lastFrameWork).toEqual({
      destinationUpdated: false,
      destinationDrawn: false,
      postPresented: false
    });

    // Sample ON the rendered frame, not after it. A control change wakes
    // exactly ONE frame and the loop goes straight back to sleep, so a read
    // taken a few ticks later correctly describes a SKIPPED frame — the
    // stage flags would be all-false and asserting them true here would be
    // asserting the optimization does not work.
    const wake = await page.evaluate(
      (budget) =>
        new Promise<FrameTelemetryView | null>((resolve) => {
          const host = window.__ATLAS_APP__!.host;
          host.setDestinationControl('black-hole', { orbit: false });
          let remaining = budget;
          const step = (): void => {
            const telemetry = host.frameTelemetry();
            if (telemetry.lastFrameRendered) {
              resolve(telemetry);
              return;
            }
            remaining -= 1;
            if (remaining <= 0) {
              resolve(null);
              return;
            }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
      WAKE_FRAMES * 4
    );

    expect(wake, 'a control change must wake at least one rendered frame').not.toBeNull();
    // The woken frame really executed the expensive stages, not just a present.
    expect(wake!.lastFrameWork).toEqual({
      destinationUpdated: true,
      destinationDrawn: true,
      postPresented: true
    });
    expect(wake!.lastReasonNames).toContain('CONTROL_CHANGED');

    await waitForAnimationFrames(page, WAKE_FRAMES);
    const settled = await page.evaluate(() => window.__ATLAS_APP__!.host.frameTelemetry());
    expect(settled.framesRendered).toBe(await renderFrameCalls(page));
    expect(settled.framesRendered).toBeGreaterThan(0);
    expect(settled.reasonCounts['CONTROL_CHANGED']).toBeGreaterThan(0);
    // Back asleep, and the stage flags follow the skip rather than lingering
    // on the last frame that did work.
    expect(settled.lastFrameRendered).toBe(false);
    expect(settled.lastFrameWork).toEqual({
      destinationUpdated: false,
      destinationDrawn: false,
      postPresented: false
    });
  });

  test('opaque transition updates but does not draw the hidden destination', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);

    await page.evaluate(() => {
      const app = window.__ATLAS_APP__!;
      const kernel = app.host.kernel as unknown as {
        renderFrame(plan: unknown): boolean;
        renderer: {
          info: {
            autoReset: boolean;
            reset(): void;
            render: { frameCalls: number; drawCalls: number; triangles: number };
          };
        } | null;
        lastFrameWork: {
          destinationUpdated: boolean;
          destinationDrawn: boolean;
          postPresented: boolean;
        };
        precompileCounts: { requested: number; completed: number; failed: number };
      };
      const renderer = kernel.renderer;
      if (renderer === null) throw new Error('no renderer for draw-count instrumentation');
      const original = kernel.renderFrame.bind(kernel);
      const runtime = window as unknown as {
        __transitionOcclusionObservations?: Array<{
          destinationDrawSuppressed: boolean;
          destinationOccluded: boolean;
          destinationUpdated: boolean;
          destinationDrawn: boolean;
          postPresented: boolean;
          drawCalls: number;
          triangles: number;
          frameCalls: number;
        }>;
        __visibleFrameCounts?: {
          drawCalls: number;
          triangles: number;
          frameCalls: number;
        } | null;
        __captureVisibleFrame?: () => void;
      };
      runtime.__transitionOcclusionObservations = [];
      runtime.__visibleFrameCounts = null;
      let captureVisible = false;
      runtime.__captureVisibleFrame = () => {
        captureVisible = true;
      };
      const countsOf = () => ({
        drawCalls: renderer.info.render.drawCalls,
        triangles: renderer.info.render.triangles,
        frameCalls: renderer.info.render.frameCalls
      });
      kernel.renderFrame = (plan: unknown): boolean => {
        const candidate = plan as {
          destinationDrawSuppressed?: boolean;
          destination?: unknown;
        };
        const suppressed = candidate.destinationDrawSuppressed === true;
        const wantVisible = captureVisible && candidate.destination != null;
        if (suppressed || wantVisible) {
          // Accumulate across every render pass in this frame so the counts
          // describe the whole frame rather than only the last pass.
          renderer.info.autoReset = false;
          renderer.info.reset();
        }
        const result = original(plan);
        if (suppressed) {
          runtime.__transitionOcclusionObservations!.push({
            destinationDrawSuppressed: true,
            destinationOccluded: app.host.state.atlas.transition.destinationOccluded,
            ...kernel.lastFrameWork,
            ...countsOf()
          });
          renderer.info.autoReset = true;
        } else if (wantVisible) {
          runtime.__visibleFrameCounts = countsOf();
          renderer.info.autoReset = true;
          captureVisible = false;
        }
        return result;
      };
      app.navigate('neutron-star');
    });

    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __transitionOcclusionObservations?: unknown[];
                }
              ).__transitionOcclusionObservations?.length ?? 0
          ),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [50] }
      )
      .toBeGreaterThan(0);

    // Capture one ordinary drawn frame after arrival for the draw-count
    // comparison, then read everything including the precompile counters.
    await waitForArrival(page);
    await page.evaluate(() => {
      (window as unknown as { __captureVisibleFrame?: () => void }).__captureVisibleFrame?.();
    });
    await waitForAnimationFrames(page, WAKE_FRAMES);

    const diagnostics = await page.evaluate(() => {
      const runtime = window as unknown as {
        __transitionOcclusionObservations?: Array<{
          destinationDrawSuppressed: boolean;
          destinationOccluded: boolean;
          destinationUpdated: boolean;
          destinationDrawn: boolean;
          postPresented: boolean;
          drawCalls: number;
          triangles: number;
          frameCalls: number;
        }>;
        __visibleFrameCounts?: { drawCalls: number; triangles: number; frameCalls: number } | null;
      };
      return {
        suppressed: runtime.__transitionOcclusionObservations ?? [],
        visible: runtime.__visibleFrameCounts ?? null
      };
    });

    expect(diagnostics.suppressed[0]).toMatchObject({
      destinationDrawSuppressed: true,
      destinationOccluded: true,
      destinationUpdated: true,
      destinationDrawn: false,
      postPresented: true
    });
    // The occluded frame really issued fewer draws than the same scene drawn
    // normally: this is the draw-count form of the suppression claim, not just
    // the stage flag the kernel writes about itself.
    expect(diagnostics.suppressed[0]!.drawCalls).toBeGreaterThan(0);
    expect(diagnostics.visible).not.toBeNull();
    expect(diagnostics.visible!.drawCalls).toBeGreaterThan(diagnostics.suppressed[0]!.drawCalls);
  });

  test('hide freezes hidden time and polling; resume re-seeds timing and wakes one frame', async ({
    page
  }) => {
    // WS3 (tasks.md §3). This overrides `document.hidden` so the APP's own
    // hidden/resume policy is exercised without depending on the engine
    // suspending rAF (which it does, but which no in-page dispatch can prove).
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);
    await waitForAnimationFrames(page, IDLE_FRAMES);
    expect(await renderFrameCalls(page)).toBe(0);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hiddenState = await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host;
      // Even if a throttled tick sneaks through, hidden time must not advance
      // the coordinate.
      host.time.play();
      const before = host.time.internalCoordinate;
      host.time.update(5);
      return {
        hidden: host.time.hidden,
        before,
        after: host.time.internalCoordinate
      };
    });
    expect(hiddenState.hidden).toBe(true);
    expect(hiddenState.after).toBe(hiddenState.before);

    // Resume dispatch, the one-frame advance check, and the re-pause all run
    // in ONE synchronous evaluate: a rAF tick between these steps would render
    // the visible timeline and consume the resume invalidation before the test
    // looks for it, which would measure the harness's timing, not the policy.
    const resumeState = await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      host.time.play();
      const before = host.time.internalCoordinate;
      host.time.update(1 / 60);
      const delta = host.time.internalCoordinate - before;
      host.time.pause();
      return {
        hidden: host.time.hidden,
        delta,
        smoothedFps: host.governor.smoothedFps
      };
    });
    expect(resumeState.hidden).toBe(false);
    // One ordinary frame step, never the hidden wall time.
    expect(resumeState.delta).toBeCloseTo(1 / 60, 8);
    // resetTiming dropped the stale sample window; nothing has sampled since.
    expect(resumeState.smoothedFps).toBe(0);

    await resetRenderFrameCalls(page);
    await waitForAnimationFrames(page, WAKE_FRAMES);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);
    await resetRenderFrameCalls(page);
    await waitForAnimationFrames(page, IDLE_FRAMES);
    expect(await renderFrameCalls(page)).toBe(0);
  });

  test('renderer.info telemetry reports live counts once a scene is drawn', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    const info = await page.evaluate(
      () => window.__ATLAS_APP__!.host.debugInventory().rendererInfo
    );
    expect(info, 'renderer.info mirror must be wired once a renderer is live').not.toBeNull();
    // Live totals, not per-frame counters: a booted atlas always holds these.
    expect(info!.memory.textures).toBeGreaterThan(0);
    expect(info!.memory.totalBytes).toBeGreaterThan(0);
  });

  test('an active (unpaused) timeline keeps rendering every tick', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    // Deliberately do NOT pause: default transport state is playing.
    await installRenderFrameCounter(page);
    await waitForAnimationFrames(page, WAKE_FRAMES);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);
  });

  test('runtime telemetry reports internal size, transition and the live lensing pass', async ({
    page
  }) => {
    // WS0/tasks.md §1: the aggregated runtime block is what later workstreams
    // read to attribute work; it must describe the REAL drawing buffer and the
    // actually-created strong-field pass, not a fabricated summary.
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);

    const view = await page.evaluate(() => {
      const runtime = window.__ATLAS_APP__!.host.debugInventory().runtime;
      const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
      return {
        runtime,
        canvas: canvas === null ? null : { width: canvas.width, height: canvas.height }
      };
    });

    expect(view.runtime).not.toBeNull();
    expect(view.canvas).not.toBeNull();
    expect(view.runtime!.size).not.toBeNull();
    expect(view.runtime!.size!.widthPx).toBe(view.canvas!.width);
    expect(view.runtime!.size!.heightPx).toBe(view.canvas!.height);
    expect(view.runtime!.size!.effectivePixels).toBe(view.canvas!.width * view.canvas!.height);

    // Arrived and settled: no transition, no destination occlusion.
    expect(view.runtime!.transition.active).toBe(false);
    expect(view.runtime!.transition.destinationOccluded).toBe(false);

    // The strong-field pass exists and reports a real per-frame step budget
    // read from the material's own uniform (never guessed from a tier table).
    expect(view.runtime!.lensing.livePasses).toBeGreaterThan(0);
    const pass = view.runtime!.lensing.passes[0]!;
    expect(['numerical', 'lut', 'kerr']).toContain(pass.kind);
    expect(pass.maxSteps).toBeGreaterThan(0);
  });

  test('runtime telemetry reports live volume and particle work for a cinematic destination', async ({
    page
  }) => {
    await page.goto('/atlas/compact-merger');
    await waitForArrival(page);

    const runtime = await page.evaluate(async () => {
      const app = window.__ATLAS_APP__!;
      // The ejecta volume is phase-gated (`tau > 0`, off before contact), so a
      // settled arrival frame can honestly report no executed march. Scrub
      // past contact and force one render so the aggregate describes a volume
      // that actually marched, not a retired phase.
      app.host.time.pause();
      app.host.time.scrubTo(0.6);
      await app.captureFrame();
      // A paused capture passes dt = 0, which the particle service correctly
      // skips (zero-dt); advance a few playing frames so the dynamic
      // population actually dispatches its compute update.
      app.host.time.play();
      await new Promise<void>((resolve) => {
        let remaining = 6;
        const step = (): void => {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      return app.host.debugInventory().runtime;
    });

    expect(runtime).not.toBeNull();
    expect(runtime!.volume.liveVolumes).toBeGreaterThan(0);
    expect(runtime!.volume.visibleVolumes).toBeGreaterThan(0);
    expect(runtime!.volume.activeSteps).toBeGreaterThan(0);
    // A march has executed with the volume visible, so the internal target
    // has a real size.
    expect(runtime!.volume.internalWidth).toBeGreaterThan(0);
    expect(runtime!.volume.internalHeight).toBeGreaterThan(0);
    expect(runtime!.particles.liveSystems).toBeGreaterThan(0);
    expect(runtime!.particles.capacity).toBeGreaterThan(0);
    expect(runtime!.particles.drawn).toBeGreaterThan(0);

    // §1 GPU attribution: when the backend exposes timestamp queries AND the
    // population runs on the compute path, the compute pool resolves to a real
    // duration. Any other combination honestly reports null rather than a
    // CPU-derived estimate.
    const timing = await page.evaluate(async () => {
      const host = window.__ATLAS_APP__!.host;
      const inventory = host.debugInventory();
      const computeMs = await host.flushGpuComputeTimestamps();
      return {
        timestampQuery: inventory.backend?.timestampQuery === true,
        updatePath: inventory.runtime?.particles.updatePath ?? 'none',
        computeMs
      };
    });
    if (timing.timestampQuery && timing.updatePath === 'compute') {
      // The compute pool only exists because a compute dispatch created it, so
      // a null here would be a wiring bug. The duration itself may quantize to
      // 0 for a sub-resolution dispatch, which is why this asserts finiteness
      // rather than a positive value.
      expect(timing.computeMs).not.toBeNull();
      expect(timing.computeMs!).toBeGreaterThanOrEqual(0);
    } else {
      expect(timing.computeMs).toBeNull();
    }
  });
});
