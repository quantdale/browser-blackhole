import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';
import './support/atlasHook.js';

/**
 * Atlas forced-WebGL2 validation (Gate F compatibility debt).
 *
 * The atlas integrator historically crashed three r185's GLSL flow stage
 * under forced WebGL2 ("addToStack" TypeError from nested and()/or()
 * IsolateNode chains — the same defect class fixed for the root route in
 * 9a152f6). These tests deep-link every atlas destination with the backend
 * override engaged and assert: the override actually selected WebGL2 (via
 * debugInventory), no init/render error surfaced, presented frames are live
 * (non-uniform pixels), and the console/page error channels stay clean.
 */

const DESTINATIONS = ['black-hole', 'neutron-star', 'diagnostic'] as const;

async function waitForArrival(
  page: Page,
  destinationId: string,
  timeoutMs = ARRIVAL_TIMEOUT_MS
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((dest) => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return app.host.state.atlas.activeDestination === dest
            ? 'arrived'
            : `at:${app.host.state.atlas.activeDestination}`;
        }, destinationId),
      { timeout: timeoutMs, intervals: [250] }
    )
    .toBe('arrived');
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !/powerPreference|readback|Failed to load resource/.test(text)) {
      errors.push(`console: ${text.slice(0, 200)}`);
    }
  });
  return errors;
}

test.describe('Atlas on forced WebGL2', () => {
  for (const id of DESTINATIONS) {
    test(`deep link /atlas/${id}?backend=webgl2 boots, renders, and stays clean`, async ({
      page
    }) => {
      const errors = collectErrors(page);
      await page.goto(`/atlas/${id}?backend=webgl2`);
      await waitForArrival(page, id);

      // The override must actually select WebGL2 — a silent WebGPU fallback
      // would make this whole suite vacuous.
      const backendApi = await page.evaluate(
        () => window.__ATLAS_APP__?.host.debugInventory().backend?.api ?? 'none'
      );
      expect(backendApi).toBe('webgl2');

      // Truthful init status line: never an Atlas error/failed copy.
      const statusText = await page.locator('.atlas-status').textContent();
      expect(statusText).toBe('Atlas ready');

      // Presented-frame evidence: one deterministic frame sampled through the
      // app hook. Live frames have >1 distinct color; a dead canvas or a
      // shader that failed to build shows as uniform black.
      const samples = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
      expect(samples).not.toBeNull();
      expect(samples!.length).toBe(25);
      const distinct = new Set(samples!);
      expect(distinct.size, 'presented frame should not be uniform').toBeGreaterThan(1);

      expect(errors).toEqual([]);
    });
  }

  test('black-hole shadow is dark, not failure magenta, under forced WebGL2', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole?backend=webgl2');
    await waitForArrival(page, 'black-hole');

    // NUMERICAL_FAILURE renders dim magenta (linear 0.08,0,0.08). A healthy
    // frame contains near-black shadow pixels and non-trivial lit pixels,
    // but no dominant uniform-magenta population.
    const samples = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    expect(samples).not.toBeNull();
    let magentaish = 0;
    let blackish = 0;
    for (const point of samples!) {
      const [r, g, b] = point.split(',').map(Number);
      if ((g ?? 1) < 8 && Math.abs((r ?? 0) - (b ?? 0)) < 8 && (r ?? 0) >= 8) magentaish += 1;
      if ((r ?? 0) < 8 && (g ?? 0) < 8 && (b ?? 0) < 8) blackish += 1;
    }
    expect(magentaish, 'no failure-colored pixels expected').toBeLessThan(samples!.length / 2);
    expect(blackish, 'shadow should contribute dark pixels').toBeGreaterThanOrEqual(1);

    expect(errors).toEqual([]);
  });
});
