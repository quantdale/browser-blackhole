import { expect, test, type Page } from '@playwright/test';

import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';
import './support/atlasHook.js';

/**
 * M11-03 renderer/device-loss recovery torture (Gate B/G).
 *
 * Deterministic fault injection through the kernel's PRODUCTION loss path
 * (`host.simulateDeviceLoss()` -> `notifyDeviceLoss` -> subscribers), not a
 * parallel fake state machine. Real GPU device loss cannot be triggered
 * reliably in headless CI; the injected fault exercises the identical
 * notify -> host terminal-state -> UI presentation chain.
 *
 * Locked product contract (M11): a lost device is TERMINAL for the session
 * with an explicit user-visible "reload required" state — never a misleading
 * READY, never a silent fake. Repeated injection must stay bounded (the
 * terminal state latches; listeners/resources do not grow).
 */

const REAL_ERROR_FILTER = /powerPreference|readback|Failed to load resource|GPU_DEVICE_LOST/;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !REAL_ERROR_FILTER.test(text)) {
      errors.push(`console: ${text.slice(0, 200)}`);
    }
  });
  return errors;
}

async function gotoAtlasBlackHole(page: Page): Promise<void> {
  await page.goto('/atlas/black-hole');
  await expect(
    page.locator('#scene'),
    'served page has no #scene — a foreign server is answering on the e2e port (set E2E_PORT)'
  ).toBeAttached({ timeout: 10_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return app.host.activeDestinationDebugSnapshot() === null ? 'preparing' : 'arrived';
        }),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
}

test.describe('M11-03 device-loss recovery', () => {
  test('injected device loss surfaces the explicit terminal reload state', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    const generationBefore = await page.evaluate(
      () => window.__ATLAS_APP__!.host.debugInventory().rendererGeneration
    );
    await page.evaluate(() => window.__ATLAS_APP__!.host.simulateDeviceLoss());
    await page.waitForTimeout(300);

    // Terminal, user-visible, truthful — on the app's error surface.
    await expect(page.locator('.atlas-status')).toContainText('GPU_DEVICE_LOST');
    await expect(page.locator('.atlas-status')).toContainText('reload the page');

    // The kernel latched the loss and the generation advanced exactly once.
    const state = await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host;
      return {
        generation: host.debugInventory().rendererGeneration,
        fatal: host.isFatalDeviceLoss
      };
    });
    expect(state.generation).toBe(generationBefore + 1);
    expect(state.fatal).toBe(true);
    expect(errors).toEqual([]);
  });

  test('repeated loss injection stays bounded: terminal state latches, generation advances once', async ({
    page
  }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    const generationBefore = await page.evaluate(
      () => window.__ATLAS_APP__!.host.debugInventory().rendererGeneration
    );
    for (let i = 0; i < 5; i += 1) {
      await page.evaluate(() => window.__ATLAS_APP__!.host.simulateDeviceLoss());
    }
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host;
      const inv = host.debugInventory();
      return {
        generation: inv.rendererGeneration,
        fatal: host.isFatalDeviceLoss,
        pending: inv.pendingPrepares
      };
    });
    // Deduplicated loss notification: one generation bump for the physical
    // loss event, latched terminal state, no pending prepare churn.
    expect(state.generation).toBe(generationBefore + 1);
    expect(state.fatal).toBe(true);
    expect(state.pending).toBe(0);
    await expect(page.locator('.atlas-status')).toContainText('GPU_DEVICE_LOST');
    expect(errors).toEqual([]);
  });

  test('navigation after device loss does not resurrect a dead renderer', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    await page.evaluate(() => window.__ATLAS_APP__!.host.simulateDeviceLoss());
    await page.waitForTimeout(200);
    // A user (or history echo) navigating after the terminal state must not
    // produce uncaught errors or clear the truthful status.
    await page.evaluate(() => window.__ATLAS_APP__!.host.navigate('diagnostic'));
    await page.waitForTimeout(500);
    await expect(page.locator('.atlas-status')).toContainText('GPU_DEVICE_LOST');
    expect(errors).toEqual([]);
  });
});
