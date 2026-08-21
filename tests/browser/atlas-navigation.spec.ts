import { expect, test, type Page } from '@playwright/test';

/**
 * Atlas navigation validation (validation campaign: lifecycle, races,
 * history, invalid routes, 20-switch resource bound).
 *
 * All navigation goes through the exposed __ATLAS_APP__ hook — the same
 * code path production clicks use. Error assertions rely on the pageerror
 * / console channels plus the app's own uncaught-error accounting via the
 * transition state machine (a stuck transition would time out arrivals).
 */

interface AtlasStateView {
  atlas: {
    activeDestination: string;
    activePreset: string;
    transition: { active: boolean; phase: string | null; progress: number };
  };
}

interface InventoryView {
  liveScopeCount: number;
  totalEstimatedGpuBytes: number;
  pendingPrepares: number;
}

interface AtlasHook {
  host: {
    state: AtlasStateView;
    debugInventory(): InventoryView;
  };
  navigate(destinationId: string, presetId?: string): unknown;
}

declare global {
  interface Window {
    __ATLAS_APP__?: AtlasHook;
  }
}

const ROUTE_IDS = ['black-hole', 'neutron-star', 'diagnostic'] as const;

async function waitForArrival(
  page: Page,
  destinationId: string,
  timeoutMs = 25_000
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((dest) => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          const t = app.host.state.atlas.transition;
          if (t.active) return 'transitioning';
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
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !/powerPreference|readback|Failed to load resource/.test(text)) {
      errors.push(`console: ${text.slice(0, 160)}`);
    }
  });
  return errors;
}

test.describe('Atlas navigation validation', () => {
  let errors: string[];

  test.beforeEach(({ page }) => {
    errors = collectErrors(page);
  });

  test('deep links boot each destination directly', async ({ page }) => {
    for (const id of ROUTE_IDS) {
      await page.goto(`/atlas/${id}`);
      await waitForArrival(page, id);
      const state = await page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas);
      expect(state.activePreset.length).toBeGreaterThan(0);
      // URL and destination stay synchronized on direct entry.
      expect(page.url()).toContain(`/atlas/${id}`);
    }
    expect(errors).toEqual([]);
  });

  test('in-app transitions arrive at each destination through the hyperspace pass', async ({
    page
  }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('neutron-star'));
    // The transition state machine must actually engage at some point.
    await page.waitForFunction(
      () => window.__ATLAS_APP__!.host.state.atlas.transition.active === true
    );
    await waitForArrival(page, 'neutron-star');

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('diagnostic'));
    await waitForArrival(page, 'diagnostic');

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('black-hole'));
    await waitForArrival(page, 'black-hole');
    expect(errors).toEqual([]);
  });

  test('rapid retarget race: last intent wins, no stuck transition', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    // Fire B then C without waiting for B to finish preparing.
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('neutron-star'));
    await page.waitForTimeout(120); // mid-prepare
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('diagnostic'));

    await waitForArrival(page, 'diagnostic');
    const inv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(inv.pendingPrepares).toBe(0);
    expect(errors).toEqual([]);
  });

  test('invalid route falls back to the default destination', async ({ page }) => {
    await page.goto('/atlas/does-not-exist');
    await waitForArrival(page, 'black-hole');
    const state = await page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas);
    expect(state.activePreset.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('browser Back/Forward keeps URL and destination synchronized', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('neutron-star'));
    await waitForArrival(page, 'neutron-star');
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('diagnostic'));
    await waitForArrival(page, 'diagnostic');

    await page.goBack();
    await waitForArrival(page, 'neutron-star');
    await page.goBack();
    await waitForArrival(page, 'black-hole');
    await page.goForward();
    await waitForArrival(page, 'neutron-star');
    expect(page.url()).toContain('/atlas/neutron-star');
    expect(errors).toEqual([]);
  });

  test('20 rapid switches stay bounded in resources and end consistent', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('diagnostic'));
    await waitForArrival(page, 'diagnostic');

    const baseline = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());

    // Fire 20 switches with short gaps — harsher than polite clicking and
    // much faster than waiting out every transition.
    const sequence: ReadonlyArray<string> = ['neutron-star', 'diagnostic', 'black-hole'];
    for (let i = 0; i < 20; i += 1) {
      const dest = sequence[i % sequence.length] as string;
      await page.evaluate((d) => window.__ATLAS_APP__!.navigate(d), dest);
      await page.waitForTimeout(150);
    }

    // Whatever wins the retarget race must still complete.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = window.__ATLAS_APP__;
            return app && !app.host.state.atlas.transition.active ? 'idle' : 'busy';
          }),
        { timeout: 40_000 }
      )
      .toBe('idle');

    const final = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(final.pendingPrepares).toBe(0);
    // Live scopes are bounded: shared-post + director + ONE destination scope
    // (+ transient churn already disposed). Growth per switch would break this.
    expect(final.liveScopeCount).toBeLessThanOrEqual(baseline.liveScopeCount + 1);
    // Byte growth allowed only for a small legitimate one-time cache.
    expect(final.totalEstimatedGpuBytes).toBeLessThan(baseline.totalEstimatedGpuBytes * 1.5);
    expect(errors).toEqual([]);
  });

  test('repeated navigation to the active destination stays interactive', async ({ page }) => {
    await page.goto('/atlas/diagnostic');
    await waitForArrival(page, 'diagnostic');
    for (let i = 0; i < 5; i += 1) {
      await page.evaluate(() => window.__ATLAS_APP__!.navigate('diagnostic'));
      await page.waitForTimeout(80);
    }
    await waitForArrival(page, 'diagnostic');
    const inv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(inv.pendingPrepares).toBe(0);
    expect(errors).toEqual([]);
  });
});
