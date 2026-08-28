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

  test('an active (unpaused) timeline keeps rendering every tick', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    // Deliberately do NOT pause: default transport state is playing.
    await installRenderFrameCounter(page);
    await waitForAnimationFrames(page, WAKE_FRAMES);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);
  });
});
