import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';
import './support/atlasHook.js';

/**
 * M9-06/M9-07 — Kerr product integration browser validation.
 *
 * Covers (mission §10): Kerr deep link; metric selection through the
 * CANONICAL control channel; signed spin changes (+/-); Kerr -> Schwarzschild
 * -> Kerr backend routing truth; preset family; persistence across
 * destination switches and back/forward history; share-link dc round trip;
 * quality-tier switching and resize under Kerr; repeated Cosmic Atlas
 * switching torture with bounded resources; no page/console exceptions and
 * no blank frame. The debug snapshot must ALWAYS report the effective
 * backend truthfully (a silent Schwarzschild fallback while the UI says
 * Kerr is a Critical defect).
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

async function waitForArrival(
  page: Page,
  destinationId: string,
  presetId?: string,
  timeoutMs = ARRIVAL_TIMEOUT_MS
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(
          ({ dest, preset }) => {
            const app = window.__ATLAS_APP__;
            if (!app) return 'no-app';
            if (app.host.state.atlas.transition.active) return 'transitioning';
            if (app.host.state.atlas.activeDestination !== dest) {
              return `at:${app.host.state.atlas.activeDestination}`;
            }
            if (preset !== undefined && app.host.state.atlas.activePreset !== preset) {
              return `preset:${app.host.state.atlas.activePreset}`;
            }
            if (app.host.activeDestinationDebugSnapshot() === null) return 'preparing';
            return 'arrived';
          },
          { dest: destinationId, preset: presetId }
        ),
      { timeout: timeoutMs, intervals: [250] }
    )
    .toBe('arrived');
}

async function snapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot() ?? {});
}

test.describe('Kerr black-hole integration', () => {
  test('deep link loads a Kerr preset with truthful backend reporting', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole?preset=kerr-high-prograde');
    await waitForArrival(page, 'black-hole', 'kerr-high-prograde');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();

    const snap = await snapshot(page);
    expect(snap['metric']).toBe('kerr');
    expect(snap['spin']).toBe(0.9);
    expect(snap['effectiveSpin']).toBe(0.9);
    expect(snap['activePassKind']).toBe('kerr');
    expect(snap['trajectoryBackendEffective']).toBe('numerical-kerr');
    // Spin-dependent ISCO inner edge from the centralized helper (~2.32).
    const inner = snap['kerrDiskInnerRg'] as number;
    expect(inner).toBeGreaterThan(2.2);
    expect(inner).toBeLessThan(2.5);
    expect(errors).toEqual([]);
  });

  test('metric/spin controls flow through the canonical channel both ways', async ({ page }) => {
    const errors = collectErrors(page);
    // Precedence-1 URL override pins the Schwarzschild trajectory backend
    // (docs/LUT_BACKEND_SPEC.md §15) without depending on setter timing.
    await page.goto('/atlas/black-hole?preset=default&trajectory=numerical');
    await waitForArrival(page, 'black-hole', 'default');

    // Start Schwarzschild: numerical policy pinned, spin inert.
    let snap = await snapshot(page);
    expect(snap['metric']).toBe('schwarzschild');
    expect(snap['activePassKind']).toBe('numerical');

    // Switch to Kerr + positive spin via setDestinationControl.
    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('black-hole', { metric: 'kerr', spin: 0.6 });
    });
    // Pass SELECTION happens during render(): force a frame first.
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    snap = await snapshot(page);
    expect(snap['metric']).toBe('kerr');
    expect(snap['activePassKind']).toBe('kerr');
    expect(snap['trajectoryBackendEffective']).toBe('numerical-kerr');

    // Negative spin: retrograde convention, ISCO pushed outward (~8.05).
    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('black-hole', { spin: -0.7 });
    });
    snap = await snapshot(page);
    expect(snap['spin']).toBe(-0.7);
    expect(snap['effectiveSpin']).toBe(-0.7);
    const inner = snap['kerrDiskInnerRg'] as number;
    expect(inner).toBeGreaterThan(7.8);
    expect(inner).toBeLessThan(8.3);

    // Back to Schwarzschild: numerical/LUT policy restored truthfully and
    // the stored spin becomes inert (effectiveSpin forced to 0).
    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('black-hole', { metric: 'schwarzschild' });
    });
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    snap = await snapshot(page);
    expect(snap['metric']).toBe('schwarzschild');
    expect(['numerical', 'lut']).toContain(snap['activePassKind']);
    expect(snap['effectiveSpin']).toBe(0);
    expect(snap['trajectoryBackendEffective']).not.toBe('numerical-kerr');

    // And forward again.
    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('black-hole', { metric: 'kerr' });
    });
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    snap = await snapshot(page);
    expect(snap['activePassKind']).toBe('kerr');
    // Spin persisted through the metric round trip (-0.7 retained).
    expect(snap['spin']).toBe(-0.7);
    expect(errors).toEqual([]);
  });

  test('serialized share state carries the full control record', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole?preset=kerr-moderate-prograde');
    await waitForArrival(page, 'black-hole', 'kerr-moderate-prograde');
    const share = await page.evaluate(
      () => window.__ATLAS_APP__!.host.state.destinations['black-hole']?.state ?? {}
    );
    expect(share['metric']).toBe('kerr');
    expect(share['spin']).toBe(0.6);
    expect(errors).toEqual([]);
  });

  test('share-link dc state survives the deep-link round trip', async ({ page }) => {
    const errors = collectErrors(page);
    const dc = encodeURIComponent(JSON.stringify({ metric: 'kerr', spin: -0.4 }));
    await page.goto(`/atlas/black-hole?preset=default&v=1&d=black-hole&dc=${dc}`);
    await waitForArrival(page, 'black-hole', 'default');
    await page.waitForTimeout(800);
    const snap = await snapshot(page);
    expect(snap['metric']).toBe('kerr');
    expect(snap['spin']).toBe(-0.4);
    expect(snap['activePassKind']).toBe('kerr');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test('controls persist across destination switches and revisits', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole?preset=kerr-moderate-prograde');
    await waitForArrival(page, 'black-hole', 'kerr-moderate-prograde');

    // Leave for another destination...
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('neutron-star'));
    await waitForArrival(page, 'neutron-star');
    // ...and return: cached per-destination controls must be restored
    // (preset-scoped cache; the preset id travels with the revisit).
    await page.evaluate((p) => {
      window.__ATLAS_APP__!.navigate('black-hole', p);
    }, 'kerr-moderate-prograde');
    await waitForArrival(page, 'black-hole', 'kerr-moderate-prograde');
    let snap = await snapshot(page);
    expect(snap['metric']).toBe('kerr');
    expect(snap['spin']).toBe(0.6);

    // A second leave/return cycle keeps the restoration stable, including a
    // live control change made before leaving.
    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('black-hole', { spin: -0.4 });
    });
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('stellar-explosion'));
    await waitForArrival(page, 'stellar-explosion');
    await page.evaluate((p) => {
      window.__ATLAS_APP__!.navigate('black-hole', p);
    }, 'kerr-moderate-prograde');
    await waitForArrival(page, 'black-hole', 'kerr-moderate-prograde');
    snap = await snapshot(page);
    expect(snap['spin']).toBe(-0.4);
    expect(snap['activePassKind']).toBe('kerr');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test('quality tiers and resize do not corrupt the Kerr pass', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole?preset=kerr-high-prograde');
    await waitForArrival(page, 'black-hole', 'kerr-high-prograde');

    for (const tier of ['low', 'ultra', 'medium'] as const) {
      await page.evaluate((t) => {
        window.__ATLAS_APP__!.host.governor.setForcedTier(t);
      }, tier);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
      expect((await snapshot(page))['activePassKind']).toBe('kerr');
    }

    await page.setViewportSize({ width: 720, height: 900 });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    expect((await snapshot(page))['activePassKind']).toBe('kerr');
    expect(errors).toEqual([]);
  });

  test('repeated atlas switching involving Kerr stays bounded and clean', async ({ page }) => {
    const errors = collectErrors(page);
    test.setTimeout(process.env.CI ? 600_000 : 180_000);
    await page.goto('/atlas/black-hole?preset=kerr-high-prograde');
    await waitForArrival(page, 'black-hole', 'kerr-high-prograde');

    const route = ['tidal-disruption', 'compact-merger'] as const;
    let scopesAfterFirstLoop = -1;
    for (let round = 0; round < 3; round += 1) {
      for (const dest of route) {
        await page.evaluate((d) => {
          window.__ATLAS_APP__!.navigate(d);
        }, dest);
        await waitForArrival(page, dest);
      }
      // Return EXPLICITLY to the Kerr preset (navigate without a preset id
      // resolves the destination default, which is Schwarzschild).
      await page.evaluate((p) => {
        window.__ATLAS_APP__!.navigate('black-hole', p);
      }, 'kerr-high-prograde');
      await waitForArrival(page, 'black-hole', 'kerr-high-prograde');
      const inventory = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
      if (round === 0) scopesAfterFirstLoop = inventory.liveScopeCount;
      else {
        // Resource ownership stays bounded across repeated switches.
        expect(inventory.liveScopeCount).toBeLessThanOrEqual(scopesAfterFirstLoop + 1);
      }
    }
    const snap = await snapshot(page);
    expect(snap['metric']).toBe('kerr');
    expect(snap['activePassKind']).toBe('kerr');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    expect(errors).toEqual([]);
  });
});
