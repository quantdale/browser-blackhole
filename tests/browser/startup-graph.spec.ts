import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';

/**
 * WS3 / tasks.md §5 — startup module graph.
 *
 * The atlas registry needs only descriptor + preset METADATA to build routes,
 * the destination selector and the preset catalogue. Every destination's
 * implementation must therefore stay out of the boot graph until that
 * destination is actually routed to.
 *
 * This asserts the property empirically — from the JavaScript the browser
 * really requests — rather than from the bundler's chunk table, because the
 * regression this replaces was invisible in that table: five `presets.ts`
 * modules statically imported their own render module, so the implementation
 * was FUSED INTO the metadata chunk and the chunk list still looked lazy.
 */

/** Implementation chunk name fragments, by destination route. */
const IMPLEMENTATION_CHUNKS: Record<string, string> = {
  'black-hole': 'blackHoleDestination',
  'neutron-star': 'neutronStarModule',
  'stellar-explosion': 'stellarExplosionModule',
  'compact-merger': 'compactMergerModule',
  'tidal-disruption': 'tidalDisruptionModule',
  'quasar-agn': 'quasarAgnModule',
  'black-hole-merger': 'blackHoleMergerModule',
  'galaxy-collision': 'galaxyCollisionModule'
};

function recordScriptRequests(page: Page): string[] {
  const requested: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/\/assets\/.*\.js(\?|$)/.test(url)) requested.push(url.split('/').pop() ?? url);
  });
  return requested;
}

async function waitForArrival(page: Page, destinationId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((dest) => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          if (app.host.state.atlas.activeDestination !== dest) {
            return `at:${app.host.state.atlas.activeDestination}`;
          }
          if (app.host.activeDestinationDebugSnapshot() === null) return 'preparing';
          return 'arrived';
        }, destinationId),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
}

test.describe('startup module graph (WS3)', () => {
  for (const route of Object.keys(IMPLEMENTATION_CHUNKS)) {
    test(`booting ${route} loads no other destination's implementation`, async ({ page }) => {
      const requested = recordScriptRequests(page);
      await page.goto(`/atlas/${route}`);
      await waitForArrival(page, route);

      const foreign = Object.entries(IMPLEMENTATION_CHUNKS)
        .filter(([id]) => id !== route)
        .filter(([, chunk]) => requested.some((name) => name.includes(chunk)))
        .map(([id]) => id);

      expect(foreign, `booting /atlas/${route} fetched: ${requested.join(', ')}`).toEqual([]);

      // The routed destination's own implementation must of course arrive.
      const own = IMPLEMENTATION_CHUNKS[route]!;
      expect(
        requested.some((name) => name.includes(own)),
        `booting /atlas/${route} never fetched its own ${own} chunk`
      ).toBe(true);
    });
  }

  test('a genuine implementation-chunk failure is still reported truthfully', async ({ page }) => {
    // Lazy destination chunks introduce a failure mode that did not exist when
    // every implementation was fetched at boot: the chunk can be missing
    // (stale deploy) or unreachable (offline). The host silences transition
    // errors only while the DOCUMENT ITSELF is unloading — it must not
    // silence this one.
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.route(/blackHoleDestination.*\.js/, (route) => route.abort('failed'));
    await page.goto('/atlas/black-hole');

    await expect
      .poll(() => consoleErrors.filter((text) => /transition error/.test(text)), {
        timeout: ARRIVAL_TIMEOUT_MS,
        intervals: [250]
      })
      .not.toEqual([]);
    expect(consoleErrors.join(' | ')).toContain("Preparation of 'black-hole' failed");
  });

  test('startup JavaScript weight is recorded for the campaign baseline', async ({ page }) => {
    const requested = recordScriptRequests(page);
    await page.goto('/atlas/galaxy-collision');
    await waitForArrival(page, 'galaxy-collision');

    // Transferred bytes as the browser saw them (compressed where the server
    // compresses). Reported, not asserted: a byte threshold here would be a
    // machine-specific claim, and the campaign wants a recorded comparison.
    const weight = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry): entry is PerformanceResourceTiming => 'encodedBodySize' in entry)
        .filter((entry) => /\/assets\/.*\.js(\?|$)/.test(entry.name))
        .map((entry) => ({
          name: entry.name.split('/').pop() ?? entry.name,
          encodedBytes: entry.encodedBodySize,
          decodedBytes: entry.decodedBodySize
        }))
    );
    const total = weight.reduce((sum, entry) => sum + entry.decodedBytes, 0);
    console.log(
      `STARTUP_GRAPH galaxy-collision: ${requested.length} JS requests, ` +
        `${total} decoded bytes\n` +
        weight.map((w) => `  ${w.name} ${w.decodedBytes}`).join('\n')
    );
    expect(weight.length).toBeGreaterThan(0);
  });
});
