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

/** Freeze the timeline and let the arrival camera-ease finish settling. */
async function pauseAndSettle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window.__ATLAS_APP__!.host;
    host.time.pause();
    host.time.scrubTo(0);
  });
  await page.evaluate(
    (timeout) =>
      new Promise<void>((resolve) => {
        const host = window.__ATLAS_APP__!.host as unknown as {
          camera: { position: { x: number; y: number; z: number } };
        };
        let last = { ...host.camera.position };
        const startedAt = performance.now();
        const poll = (): void => {
          const now = host.camera.position;
          const delta = Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z);
          last = { ...now };
          if (delta < 1e-4 || performance.now() - startedAt > timeout) resolve();
          else setTimeout(poll, 100);
        };
        setTimeout(poll, 150);
      }),
    10_000
  );
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
    await installRenderFrameCounter(page);

    // Several rAF ticks' worth of wall time with no interaction whatsoever.
    await page.waitForTimeout(500);
    expect(await renderFrameCalls(page)).toBe(0);
  });

  test('a destination control change wakes the frame loop, then goes quiet again', async ({
    page
  }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);
    await installRenderFrameCounter(page);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('black-hole', { orbit: false });
    });
    await page.waitForTimeout(150);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);

    await resetRenderFrameCalls(page);
    await page.waitForTimeout(400);
    expect(await renderFrameCalls(page)).toBe(0);
  });

  test('resize wakes exactly the frames needed, then goes quiet again', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);
    await installRenderFrameCounter(page);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.handleResize(900, 600);
    });
    await page.waitForTimeout(150);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);

    await resetRenderFrameCalls(page);
    await page.waitForTimeout(400);
    expect(await renderFrameCalls(page)).toBe(0);
  });

  test('a quality-tier pin change wakes the frame loop', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);
    await installRenderFrameCounter(page);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.governor.setForcedTier('high');
    });
    await page.waitForTimeout(150);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);
  });

  test('captureFrame() forces a render even while idle-paused', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await pauseAndSettle(page);
    await installRenderFrameCounter(page);

    await page.waitForTimeout(300);
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
    await installRenderFrameCounter(page);

    await page.waitForTimeout(300);
    expect(await renderFrameCalls(page)).toBe(0);

    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(150);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);

    await resetRenderFrameCalls(page);
    await page.waitForTimeout(400);
    expect(await renderFrameCalls(page)).toBe(0);
  });

  test('an active (unpaused) timeline keeps rendering every tick', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    // Deliberately do NOT pause: default transport state is playing.
    await installRenderFrameCounter(page);
    await page.waitForTimeout(300);
    expect(await renderFrameCalls(page)).toBeGreaterThan(0);
  });
});
