import { expect, test } from '@playwright/test';
import {
  collectErrors,
  expectDiagnosticVariance,
  gotoApp,
  readStatus,
  sampleFrameViaScreenshot,
  waitForTerminalPhase,
  type StatusView
} from './support/appHarness.js';

/**
 * M0 browser smoke (Gate B).
 *
 * These tests are backend-agnostic on purpose: headless environments often
 * lack WebGPU, so they assert READY-or-fallback status (or a useful terminal
 * unsupported state), positive canvas dimensions, a rendered diagnostic
 * frame, safe interaction/resize, and zero uncaught page/console errors.
 */

test.describe('M0 smoke', () => {
  test('boots to ready/fallback with valid canvas and clean console', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await gotoApp(page);
    const status = await waitForTerminalPhase(page);

    if (status.phase === 'unsupported') {
      // Useful terminal unsupported state is acceptable per Gate B, but it
      // must be visible and explained, never a blank canvas.
      await expect(page.locator('.status-region')).toBeVisible();
      await expect(page.locator('.status-headline')).not.toHaveText('');
      return;
    }
    expect(status.phase, `errorCode=${status.errorCode ?? 'none'}`).toBe('ready');
    expect(['webgpu', 'webgl2']).toContain(status.backend);

    const dims = await page.evaluate(() => {
      const c = document.querySelector('#scene') as HTMLCanvasElement | null;
      return c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null;
    });
    expect(dims).not.toBeNull();
    expect(dims?.w).toBeGreaterThan(0);
    expect(dims?.h).toBeGreaterThan(0);
    expect(dims?.cw).toBeGreaterThan(0);
    expect(dims?.ch).toBeGreaterThan(0);

    expectDiagnosticVariance(await sampleFrameViaScreenshot(page));

    await page.screenshot({ path: 'artifacts/m0-diagnostic.png' });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('camera interaction does not throw and keeps rendering', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await gotoApp(page);
    const status = await waitForTerminalPhase(page);
    if (status.phase !== 'ready') test.skip(true, 'no usable backend in this environment');

    const canvas = page.locator('#scene');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');

    // Orbit drag.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(box.x + box.width / 2 + i * 6, box.y + box.height / 2 + i * 3, {
        steps: 1
      });
    }
    await page.mouse.up();

    // Wheel zoom.
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(500);

    const uncaught: unknown = await page.evaluate(() => {
      const hooks = (window as unknown as Record<string, unknown>)['__BLACKHOLE_TEST__'];
      if (typeof hooks !== 'object' || hooks === null) return null;
      return (hooks as { getUncaughtErrors(): string[] }).getUncaughtErrors();
    });
    expect(uncaught).toEqual([]);
    expectDiagnosticVariance(await sampleFrameViaScreenshot(page));
    expect((await readStatus(page))?.phase).toBe('ready');
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('resize portrait/landscape keeps rendering without errors', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await gotoApp(page);
    const status = await waitForTerminalPhase(page);
    if (status.phase !== 'ready') test.skip(true, 'no usable backend in this environment');

    for (const viewport of [
      { width: 480, height: 800 }, // portrait
      { width: 900, height: 500 } // landscape
    ]) {
      await page.setViewportSize(viewport);
      const deadline = Date.now() + 5_000;
      let internal: StatusView | null = null;
      while (Date.now() < deadline) {
        internal = await readStatus(page);
        if (
          internal?.internalWidth != null &&
          internal.internalHeight != null &&
          Math.abs(
            internal.internalWidth / internal.internalHeight - viewport.width / viewport.height
          ) < 0.05
        ) {
          break;
        }
        await page.waitForTimeout(200);
      }
      expect(internal?.internalWidth).toBeGreaterThan(0);
      expect(internal?.internalHeight).toBeGreaterThan(0);
      expectDiagnosticVariance(await sampleFrameViaScreenshot(page));
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('forced webgl2 fallback renders the diagnostic gradient', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await gotoApp(page, '?backend=webgl2');
    const status = await waitForTerminalPhase(page);
    expect(status.phase, `errorCode=${status.errorCode ?? 'none'}`).toBe('ready');
    expect(status.backend).toBe('webgl2');
    expectDiagnosticVariance(await sampleFrameViaScreenshot(page));
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('forced unsupported shows terminal unsupported UX', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await gotoApp(page, '?backend=unsupported');
    const status = await waitForTerminalPhase(page);
    expect(status.phase).toBe('unsupported');
    await expect(page.locator('.status-region')).toBeVisible();
    await expect(page.locator('.status-headline')).not.toHaveText('');
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
