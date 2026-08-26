import { expect, test, type Page } from '@playwright/test';

import {
  collectErrors,
  expectDiagnosticVariance,
  gotoApp,
  readStatus,
  sampleFrameViaScreenshot,
  waitForTerminalPhase
} from './support/appHarness.js';
import './support/atlasHook.js';

/**
 * M11-01 compatibility-matrix suite (Gate F).
 *
 * Engine-agnostic by design: this is the suite the `firefox` Playwright
 * project runs (the default Chromium project runs it as its matrix row too).
 * It asserts the FALLBACK/UNSUPPORTED LOGIC, never a specific backend:
 * - the root experience reaches a terminal phase with a truthful backend
 *   (WebGPU when the engine provides it, WebGL2 fallback otherwise, or the
 *   useful terminal unsupported state — never a blank canvas);
 * - the Atlas shell boots on /atlas/black-hole with a truthful backend and
 *   live presented frames;
 * - reload restores a valid terminal state (no half-initialized graph);
 * - console/page error channels stay clean.
 *
 * A pass on a non-Chromium engine certifies the fallback/unsupported logic
 * on that engine ONLY — it makes no WebGPU or performance claim
 * (docs/COMPATIBILITY_MATRIX.md).
 */

async function gotoAtlas(page: Page): Promise<void> {
  await page.goto('/atlas/black-hole');
  await expect(
    page.locator('#scene'),
    'served page has no #scene — a foreign server is answering on the e2e port (set E2E_PORT)'
  ).toBeAttached({ timeout: 10_000 });
}

/**
 * Software-WebGL2 engines (headless Firefox) integrate the arrival
 * transition slowly; 90 s is an honest correctness ceiling, not a
 * performance claim.
 */
const ARRIVAL_TIMEOUT_MS = 90_000;

test.describe('compatibility matrix (engine-agnostic fallback logic)', () => {
  test('root experience boots to a truthful terminal state with live output', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await gotoApp(page);
    const status = await waitForTerminalPhase(page);

    if (status.phase === 'unsupported') {
      await expect(page.locator('.status-region')).toBeVisible();
      await expect(page.locator('.status-headline')).not.toHaveText('');
    } else {
      expect(status.phase, `errorCode=${status.errorCode ?? 'none'}`).toBe('ready');
      expect(['webgpu', 'webgl2']).toContain(status.backend);
      expectDiagnosticVariance(await sampleFrameViaScreenshot(page));
    }
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('atlas shell boots on /atlas/black-hole with a truthful backend and live frames', async ({
    page
  }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await gotoAtlas(page);
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

    const backendApi = await page.evaluate(
      () => window.__ATLAS_APP__?.host.debugInventory().backend?.api ?? 'none'
    );
    // Truthful for the engine: headless Firefox has no WebGPU, so the
    // fallback row is expected there — but never 'none' without an
    // explained terminal state.
    expect(['webgpu', 'webgl2']).toContain(backendApi);
    await expect(page.locator('.atlas-status')).toHaveText('Atlas ready');

    const samples = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    expect(samples).not.toBeNull();
    expect(new Set(samples!).size, 'presented frame should not be uniform').toBeGreaterThan(1);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('reload restores a valid terminal state (no half-initialized graph)', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await gotoAtlas(page);
    await page.reload();
    await gotoAtlas(page);
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
    const backendApi = await page.evaluate(
      () => window.__ATLAS_APP__?.host.debugInventory().backend?.api ?? 'none'
    );
    expect(['webgpu', 'webgl2']).toContain(backendApi);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('root route reload keeps the renderer healthy', async ({ page }) => {
    await gotoApp(page);
    await waitForTerminalPhase(page);
    await page.reload();
    const { consoleErrors, pageErrors } = collectErrors(page);
    await gotoApp(page);
    const status = await waitForTerminalPhase(page);
    expect(['ready', 'unsupported']).toContain(status.phase);
    const first = (await readStatus(page))?.phase;
    expect(['ready', 'unsupported']).toContain(first);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
