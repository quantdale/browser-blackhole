import { expect, test, type Page } from '@playwright/test';

import './support/atlasHook.js';
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';

/**
 * M11-04 lifecycle/resource-leak torture (Gate B/G).
 *
 * The existing destination suites assert processes stay interactive and
 * `pendingPrepares` drains; this suite adds the QUANTITATIVE ownership
 * evidence the M11 gate demands: after repeated enter/leave cycles the
 * renderer's live resource-scope count and estimated GPU bytes return to
 * (approximately) their arrival baseline — a process merely not crashing is
 * not leak proof.
 *
 * Instrumentation is the renderer's own debug inventory (resource scopes),
 * the same counters the debug panel exposes; no telemetry leaves the page.
 */

const REAL_ERROR_FILTER = /powerPreference|readback|Failed to load resource/;

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

async function waitArrived(page: Page, destinationId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((dest) => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return app.host.state.atlas.activeDestination === dest ? 'arrived' : 'at-other';
        }, destinationId),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
  // The destination's own prepare must have drained before counting.
  await expect
    .poll(
      async () => page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory().pendingPrepares),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe(0);
}

interface ScopeView {
  scopes: number;
  gpuBytes: number;
  textures: number;
}

async function scopes(page: Page): Promise<ScopeView> {
  return page.evaluate(() => {
    const inv = window.__ATLAS_APP__!.host.debugInventory();
    return {
      scopes: inv.liveScopeCount,
      gpuBytes: inv.totalEstimatedGpuBytes,
      textures: inv.totalResourceCounts.texture
    };
  });
}

test.describe('M11-04 lifecycle/resource-leak torture', () => {
  test('repeated cross-destination cycles return to the resource baseline', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitArrived(page, 'black-hole');
    const baseline = await scopes(page);
    expect(baseline.scopes).toBeGreaterThan(0);

    // BH -> NS -> BH -> CM -> BH x3: shared services hand off between more
    // than one destination family (compact + catastrophe + lab groups).
    const cycle = ['neutron-star', 'black-hole', 'compact-merger', 'black-hole'] as const;
    for (let round = 0; round < 3; round += 1) {
      for (const dest of cycle) {
        await page.evaluate((d) => window.__ATLAS_APP__!.host.navigate(d), dest);
        await waitArrived(page, dest);
      }
    }

    await page.evaluate(() => window.__ATLAS_APP__!.host.navigate('black-hole'));
    await waitArrived(page, 'black-hole');
    const final = await scopes(page);
    // Bounded growth: scopes may differ by O(1) (boot-scope churn), GPU bytes
    // within +15% of the same-destination baseline (tier jitter), textures
    // within a small absolute band.
    expect(final.scopes, 'resource scopes must not accumulate across cycles').toBeLessThanOrEqual(
      baseline.scopes + 2
    );
    expect(final.gpuBytes).toBeLessThanOrEqual(baseline.gpuBytes * 1.15 + 1_000_000);
    expect(Math.abs(final.textures - baseline.textures)).toBeLessThanOrEqual(4);
    expect(errors).toEqual([]);
  });

  test('rapid observer-mode churn keeps destination resources bounded', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitArrived(page, 'black-hole');
    const baseline = await scopes(page);
    for (let round = 0; round < 4; round += 1) {
      for (const mode of ['static', 'circular', 'flyby', 'freefall', 'camera']) {
        await page.evaluate((m) => {
          window.__ATLAS_APP__!.host.setDestinationControl('black-hole', {
            observer: { mode: m }
          });
        }, mode);
        await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
      }
    }
    const final = await scopes(page);
    expect(final.scopes).toBeLessThanOrEqual(baseline.scopes + 2);
    expect(final.gpuBytes).toBeLessThanOrEqual(baseline.gpuBytes * 1.15 + 1_000_000);
    expect(errors).toEqual([]);
  });

  test('resize storm during an active destination stays live and bounded', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitArrived(page, 'black-hole');
    const baseline = await scopes(page);
    const flips: [number, number][] = [
      [500, 700],
      [900, 500],
      [1280, 800],
      [390, 844],
      [1280, 800]
    ];
    for (const [w, h] of flips) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(120);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);
    const samples = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    expect(samples).not.toBeNull();
    expect(new Set(samples!).size, 'frame must stay live after resize storm').toBeGreaterThan(1);
    const final = await scopes(page);
    expect(final.scopes).toBeLessThanOrEqual(baseline.scopes + 2);
    expect(errors).toEqual([]);
  });

  test('quality changes keep temporal history targets bounded and reusable', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/stellar-explosion?preset=core-collapse');
    await waitArrived(page, 'stellar-explosion');
    const baseline = await scopes(page);
    const records: Array<Record<string, unknown>> = [];
    for (const tier of ['low', 'medium', 'high', 'ultra', 'high', 'medium', 'high'] as const) {
      await page.evaluate((nextTier) => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          governor: { setForcedTier(tier: typeof nextTier): void };
          handleResize(width: number, height: number): void;
        };
        host.governor.setForcedTier(nextTier);
        const rect = document.getElementById('viewport')?.getBoundingClientRect();
        if (rect) host.handleResize(rect.width, rect.height);
        app.captureFrame();
        app.captureFrame();
      }, tier);
      records.push(
        await page.evaluate(() => {
          const app = window.__ATLAS_APP__!;
          const inventory = app.host.debugInventory();
          const post = (
            app.host.post as unknown as {
              getDebugSnapshot?(): Record<string, unknown>;
            }
          ).getDebugSnapshot?.();
          return {
            tier: inventory.governor.tier,
            bytes: inventory.totalEstimatedGpuBytes,
            scopes: inventory.liveScopeCount,
            temporal: post?.temporal ?? null
          };
        })
      );
    }
    const final = await scopes(page);
    console.log(`QUALITY_HISTORY_TORTURE ${JSON.stringify({ baseline, records, final })}`);
    expect(errors).toEqual([]);
    expect(records.map((record) => record.tier)).toEqual([
      'low',
      'medium',
      'high',
      'ultra',
      'high',
      'medium',
      'high'
    ]);
    for (const record of records) {
      expect(record.scopes).toBeLessThanOrEqual(baseline.scopes + 2);
      expect(record.bytes).toBeLessThanOrEqual(baseline.gpuBytes * 2 + 4_000_000);
      expect(record.temporal).toMatchObject({ allocatedTargetCount: 2 });
    }
    expect(final.scopes).toBeLessThanOrEqual(baseline.scopes + 2);
    expect(final.gpuBytes).toBeLessThanOrEqual(baseline.gpuBytes * 2 + 4_000_000);
  });
});
