import { expect, test } from '@playwright/test';

/**
 * U-04 — build hygiene for the `__ATLAS_APP__` test hook
 * (`docs/MASTER_PLAN.md`, change `destination-control-truthfulness`).
 *
 * The `__ATLAS_APP__` test hook hands the whole host — including the forced
 * continuous-render entry point and a synchronous framebuffer readback — to
 * any script on the page. It must not exist in a production build.
 *
 * Two complementary checks, with a deliberate division of labour:
 *
 * 1. THIS file asserts the invariant that holds for EVERY bundle: the build
 *    time `__ATLAS_TEST_HOOKS_OPT_IN__` define must always be substituted, so
 *    a `vite.config.ts` regression that stops applying it cannot ship silently.
 *
 * 2. `scripts/check-no-test-hook.mjs` — run by `npm run check` immediately
 *    after `npm run build` — asserts the production property itself: the
 *    artifact `npm run build` produces must not assign the hook. It is a
 *    separate command because a browser cannot observe a surface that must not
 *    exist, and because the Playwright webServer (see `playwright.config.ts`)
 *    now builds its own e2e bundle, which legitimately DOES contain the hook.
 */

test.describe('U-04 build hygiene', () => {
  test('the served bundle has the build-time define substituted', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const assetsDir = join(process.cwd(), 'dist', 'assets');

    let entries;
    try {
      entries = readdirSync(assetsDir);
    } catch {
      // No build at all: nothing is exposed, and the production gate in
      // `npm run check` would fail on the missing artifact instead.
      return;
    }
    const jsFiles = entries.filter((name) => name.endsWith('.js'));
    expect(jsFiles.length, 'dist/assets with no JS is not a build').toBeGreaterThan(0);

    for (const file of jsFiles) {
      const body = readFileSync(join(assetsDir, file), 'utf8');
      expect(
        body,
        `${file}: unsubstituted __ATLAS_TEST_HOOKS_OPT_IN__ leaked into the bundle`
      ).not.toContain('__ATLAS_TEST_HOOKS_OPT_IN__');
    }
  });

  test('the hook is reachable in the e2e bundle the suite runs against', async ({ page }) => {
    // The webServer builds with the opt-in, so the hook must be live for the
    // suite. If this row fails, the e2e build lost its opt-in and every other
    // spec will fail on a missing window.__ATLAS_APP__.
    await page.goto('/atlas/black-hole');
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const hook = (window as unknown as { __ATLAS_APP__?: { navigate?: unknown } })
              .__ATLAS_APP__;
            return typeof hook?.navigate === 'function';
          }),
        { timeout: 60_000, intervals: [250] }
      )
      .toBe(true);
  });
});
