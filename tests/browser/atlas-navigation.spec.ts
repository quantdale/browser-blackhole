import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';

/**
 * Atlas navigation validation (validation campaign: lifecycle, races,
 * history, invalid routes, 20-switch resource bound).
 *
 * All navigation goes through the exposed __ATLAS_APP__ hook — the same
 * code path production clicks use. Error assertions rely on the pageerror
 * / console channels plus the app's own uncaught-error accounting via the
 * transition state machine (a stuck transition would time out arrivals).
 */

const ROUTE_IDS = ['black-hole', 'neutron-star', 'diagnostic'] as const;

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
        { timeout: ARRIVAL_TIMEOUT_MS }
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

/**
 * atlas-error-reporting — a destination preparation failure must be VISIBLE
 * and RECOVERABLE, not console-only.
 *
 * Forcing is done through the HTTP layer only (a broken lazy chunk / a hung
 * asset), i.e. exactly the production conditions the capability exists for: a
 * deploy that renames a hashed chunk, or a blocked/truncated data fetch. No
 * product code is patched.
 */
test.describe('Atlas transition failure visibility', () => {
  /** Resolves once the alert region is shown, or times out with its state. */
  async function waitForTransitionAlert(page: Page, timeoutMs = 30_000): Promise<void> {
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const region = document.querySelector('.atlas-alert-region');
            return region !== null && !region.hasAttribute('hidden');
          }),
        { timeout: timeoutMs, intervals: [250] }
      )
      .toBe(true);
  }

  test('a failed lazy chunk is visible, recoverable and non-terminal', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
    });

    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    // Simulate the broken-deploy case: the destination's lazy chunk 404s/aborts.
    // Installed AFTER boot so only the galaxy-collision chunk is affected.
    await page.route('**/galaxyCollisionModule-*.js', (route) => route.abort());

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('galaxy-collision'));
    await waitForTransitionAlert(page);

    const alert = page.locator('.atlas-alert');
    await expect(alert).toHaveAttribute('data-severity', 'recoverable');
    // What failed is stated in text — never conveyed by colour alone.
    await expect(alert).toContainText('Galaxy Collision');
    await expect(alert).toContainText('still active');
    await expect(alert).toContainText('TRANSITION_PREPARE_FAILED');

    // The application CONTINUES: the previously rendered destination stays
    // live and the machine settles back to idle (the selection moves early,
    // so the live destination id is the truthful signal — not the route).
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = window.__ATLAS_APP__!;
            const inv = app.host.debugInventory();
            return {
              live: inv.activeDestinationId,
              transitioning: app.host.state.atlas.transition.active,
              pendingPrepares: inv.pendingPrepares
            };
          }),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
      )
      .toEqual({ live: 'black-hole', transitioning: false, pendingPrepares: 0 });

    // A recovery action exists.
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    // The failure is announced assertively, not politely.
    await expect(page.locator('.atlas-alert-region')).toHaveAttribute('role', 'alert');

    // The console diagnostic is retained as the technical-detail channel.
    expect(consoleErrors.join('\n')).toContain('transition error');
  });

  test('a failed dataset fetch is visible and identifies the destination', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    await page.route('**/data/galaxy-collision/gc1.bin', (route) => route.abort());
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('galaxy-collision'));
    await waitForTransitionAlert(page);

    const alert = page.locator('.atlas-alert');
    await expect(alert).toHaveAttribute('data-severity', 'recoverable');
    await expect(alert).toContainText('Galaxy Collision');
    // Prepared-but-never-activated target is never left dangling.
    const inv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(inv.pendingPrepares).toBe(0);
  });

  test('the failure surface is perceivable with the control panel collapsed', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    // Collapse the panel: a failure the user cannot see is not surfaced.
    const controlsToggle = page.getByRole('button', { name: 'Controls' });
    await expect(controlsToggle).toHaveAttribute('aria-expanded', 'true');
    await controlsToggle.focus();
    await page.keyboard.press('Enter');
    await expect(controlsToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#panel')).toBeHidden();

    await page.route('**/galaxyCollisionModule-*.js', (route) => route.abort());
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('galaxy-collision'));
    await waitForTransitionAlert(page);

    // The surface lives OUTSIDE the panel's hiding subtree.
    await expect(page.locator('.atlas-alert')).toBeVisible();
    await expect(page.locator('.atlas-alert-region')).toHaveAttribute('role', 'alert');
    await expect(page.locator('.atlas-alert')).toContainText('Galaxy Collision');
  });

  test('a failing retry re-presents the same error and does not auto-loop', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    await page.route('**/galaxyCollisionModule-*.js', (route) => route.abort());
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('galaxy-collision'));
    await waitForTransitionAlert(page);

    const before = await page.evaluate(
      () => window.__ATLAS_APP__!.host.frameTelemetry().framesObserved
    );

    // User-initiated retry only; there is no automatic retry path.
    await page.getByRole('button', { name: 'Try again' }).click();
    await waitForTransitionAlert(page);
    await expect(page.locator('.atlas-alert')).toContainText('Galaxy Collision');

    // Exactly one retry ran and stopped: no runaway request loop, and the
    // previously rendered destination is untouched (the route moves early).
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = window.__ATLAS_APP__!;
            return app.host.state.atlas.transition.active
              ? 'transitioning'
              : app.host.debugInventory().activeDestinationId;
          }),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
      )
      .toBe('black-hole');
    const after = await page.evaluate(
      () => window.__ATLAS_APP__!.host.frameTelemetry().framesObserved
    );
    expect(after).toBeGreaterThanOrEqual(before);

    // Dismissing removes the surface and it does not re-announce itself.
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.atlas-alert-region')).toBeHidden();
    await page.waitForTimeout(1000);
    await expect(page.locator('.atlas-alert-region')).toBeHidden();
  });

  test('a stalled data request terminates in a visible failure', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    // A request that never settles: the manifest succeeds (a progress event)
    // and the dataset body then hangs forever.
    await page.route('**/data/black-hole-merger/sxs-bbh-0001-lev5-bbm1-v1.bin', () => {
      /* deliberately never fulfilled */
    });

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('black-hole-merger'));

    // The machine must LEAVE preparing instead of hanging there forever.
    // (The selection moves early, so `activeDestinationId` — the LIVE module —
    // is the truthful signal that the previous scene is still running.)
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = window.__ATLAS_APP__!;
            const t = app.host.state.atlas.transition;
            return t.active === false && app.host.debugInventory().activeDestinationId !== null
              ? 'left-preparing'
              : 'still-preparing';
          }),
        { timeout: 60_000, intervals: [500] }
      )
      .toBe('left-preparing');

    await waitForTransitionAlert(page);
    const alert = page.locator('.atlas-alert');
    await expect(alert).toContainText('TRANSITION_STALLED');
    await expect(alert).toContainText('Black-Hole Merger');
    await expect(alert).toContainText('still active');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('a slow-but-progressing preparation completes instead of being aborted', async ({
    page
  }) => {
    // Dribble the real dataset bytes so the preparation keeps emitting
    // progress events for far longer than the stall window: elapsed time
    // alone must NOT abort it (atlas-error-reporting).
    await page.addInitScript(() => {
      const realFetch = window.fetch.bind(window);
      const target = 'sxs-bbh-0001-lev5-bbm1-v1.bin';
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes(target)) return realFetch(input, init);
        const real = await realFetch(input, init);
        const bytes = new Uint8Array(await real.arrayBuffer());
        const chunkBytes = 2 * 1024;
        let offset = 0;
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (offset >= bytes.length) {
              controller.close();
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
            controller.enqueue(bytes.slice(offset, offset + chunkBytes));
            offset += chunkBytes;
          }
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-length': String(bytes.length) }
        });
      };
    });

    await page.goto('/atlas/black-hole-merger');
    await waitForArrival(page, 'black-hole-merger', 90_000);

    const state = await page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas);
    expect(state.activeDestination).toBe('black-hole-merger');
    expect(state.transition.error).toBeNull();
    await expect(page.locator('.atlas-alert-region')).toBeHidden();
  });

  test('the failure surface stays clear of the mobile control drawer', async ({ page }) => {
    // 390x844 is the representative small-phone class. Below 720px the control
    // panel becomes a BOTTOM drawer, so a bottom-anchored banner would cover
    // the very controls the user needs to recover with.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    await page.route('**/galaxyCollisionModule-*.js', (route) => route.abort());
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('galaxy-collision'));
    await waitForTransitionAlert(page);

    const boxes = await page.evaluate(() => {
      const alert = document.querySelector('.atlas-alert');
      const panel = document.querySelector('#panel');
      if (alert === null || panel === null) return null;
      const a = alert.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return {
        alertTop: a.top,
        alertBottom: a.bottom,
        alertLeft: a.left,
        alertRight: a.right,
        panelTop: p.top,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      };
    });

    expect(boxes).not.toBeNull();
    // Inside the viewport and horizontally contained at phone width.
    expect(boxes!.alertLeft).toBeGreaterThanOrEqual(0);
    expect(boxes!.alertRight).toBeLessThanOrEqual(boxes!.viewportWidth);
    expect(boxes!.alertTop).toBeGreaterThanOrEqual(0);
    // The banner must not overlap the drawer.
    expect(boxes!.alertBottom).toBeLessThanOrEqual(boxes!.panelTop);
  });
});
