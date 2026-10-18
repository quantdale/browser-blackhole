import { expect, test } from '@playwright/test';
import { ARRIVAL_TIMEOUT_MS, collectErrors } from './support/appHarness.js';

/**
 * Product-entry smoke (hosted-product-boot-coverage 2.1-2.2).
 *
 * The product is the Cosmic Atlas; `main.ts` mounts the atlas shell for every
 * non-legacy root entry. This check enters through the BARE ROOT — the real
 * product entry, no `legacy=1` — and asserts the redirect target and the
 * atlas shell. Entering `/atlas/black-hole` directly would only prove a deep
 * link works, not that the product entry does — capability
 * `hosted-smoke-coverage` insists the hosted browser job carries
 * product-entry evidence, not only the legacy diagnostic smoke.
 *
 * Stability bound on a GPU-less hosted runner (design D1): the check asserts
 * the shell and a truthful terminal status — ready, the WebGL2 fallback
 * (also severity ok), or the unsupported boot-failure terminal — and NEVER
 * waits for a lensed pixel or a hyperspace phase. No canvas readback either.
 */

test.describe('product-entry smoke', () => {
  test('enters through the bare root without legacy=1 and observes the atlas shell', async ({
    page
  }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await page.goto('/');

    // Product entry proof (main.ts redirectRootToAtlas): the bare root must
    // rewrite to the flagship atlas route before boot; a regression that boots
    // the legacy root on `/` has to fail here.
    await expect(page).toHaveURL(/\/atlas\/black-hole(\?|$)/, { timeout: 10_000 });

    // Product shell proof. `atlasApp` adds `atlas-shell` to `#app` and builds
    // the `.atlas-topbar`/`.atlas-brand` skeleton; the legacy diagnostic app
    // (which would set neither) is what this check must not mistake for the
    // shell.
    await expect(page.locator('#app.atlas-shell')).toBeAttached({ timeout: 10_000 });
    await expect(page.locator('#app .atlas-brand')).toHaveText('Cosmic Atlas');
    // Legacy-only status region is not the mounted application.
    await expect(page.locator('#app .status-region')).toHaveCount(0);

    // Truthful terminal state, bounded by the shared arrival ceiling (never a
    // lensed frame): `.atlas-status` flips busy -> ok ('Atlas ready', plain or
    // fallback-backend wording) or error; a failing/unsupported device renders
    // the `.atlas-terminal` surface. Either is acceptable evidence here.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const terminal = document.querySelector('.atlas-terminal');
            const status = document.querySelector('.atlas-status');
            if (terminal instanceof HTMLElement && !terminal.hidden) return 'unsupported';
            const severity = status?.getAttribute('data-severity') ?? 'busy';
            if (severity === 'ok') return 'ready';
            if (severity === 'error') return 'unsupported';
            return 'waiting';
          }),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [500] }
      )
      .not.toBe('waiting');

    // Console noise filtered with the same allow-list atlas-navigation.spec
    // applies for this class of environment noise (it filters in the listener;
    // this check filters at assertion time): hosted software-WebGL2 runners
    // legitimately log readback/preference warnings.
    const realConsoleErrors = consoleErrors.filter(
      (text) => !/powerPreference|readback|Failed to load resource/.test(text)
    );
    expect(realConsoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
