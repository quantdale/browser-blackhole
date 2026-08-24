import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';

/**
 * CA7-13 — Quasar/AGN browser validation.
 *
 * Covers: deep links for the production presets; scale-zone navigation
 * through the CANONICAL control channel (zoom01 / zone jumps); the CA7-12
 * double-render guard (exactly one visible zone group per frame; DIRECT GR
 * pass active ONLY in the inner zone); control persistence across
 * destination switches and revisits; quality-tier switching; repeated atlas
 * switching torture involving quasar-agn with bounded resources; clean
 * console and non-blank frames throughout.
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

async function waitForArrival(page: Page, destinationId: string, presetId?: string): Promise<void> {
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
      { timeout: 30_000, intervals: [250] }
    )
    .toBe('arrived');
}

interface AgnSnapshot {
  zone?: unknown;
  grPassActive?: unknown;
  visibleGroups?: unknown;
  doubleRenderGuard?: unknown;
  zoom01?: unknown;
  scenario?: unknown;
  observerAngleToJetDeg?: unknown;
  lobeBrightnessRatio?: unknown;
  scaleReadout?: { kpcInRg?: unknown };
}

async function agnSnapshot(page: Page): Promise<AgnSnapshot> {
  return page.evaluate(
    () => window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot() as AgnSnapshot | null
  ) as Promise<AgnSnapshot>;
}

test.describe('Quasar/AGN destination', () => {
  test('deep link loads the nuclear reference with truthful zone state', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=quasar-reference');
    await waitForArrival(page, 'quasar-agn', 'quasar-reference');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    const snap = await agnSnapshot(page);
    expect(snap.zone).toBe('nuclear');
    expect(snap.grPassActive).toBe(false);
    expect(snap.doubleRenderGuard).toBe('ok');
    // Exactly one visible group, and it is the active one.
    expect(snap.visibleGroups).toEqual(['nuclear']);
    expect(errors).toEqual([]);
  });

  test('inner preset activates the DIRECT pass exclusively', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=inner-engine');
    await waitForArrival(page, 'quasar-agn', 'inner-engine');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    const snap = await agnSnapshot(page);
    expect(snap.zone).toBe('inner');
    expect(snap.grPassActive).toBe(true);
    expect(snap.doubleRenderGuard).toBe('ok');
    expect(snap.visibleGroups).toEqual(['inner']);
    expect(errors).toEqual([]);
  });

  test('zone navigation rides the canonical channel with hysteresis truth', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=quasar-reference');
    await waitForArrival(page, 'quasar-agn', 'quasar-reference');

    // Jump to GALACTIC through the documented zoom target.
    await page.evaluate((z) => {
      window.__ATLAS_APP__!.host.setDestinationControl('quasar-agn', { zoom01: z });
    }, 0.88);
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    let snap = await agnSnapshot(page);
    expect(snap.zone).toBe('galactic');
    expect(snap.grPassActive).toBe(false);
    expect(snap.doubleRenderGuard).toBe('ok');
    expect(snap.visibleGroups).toEqual(['galactic']);

    // Back to INNER through the jump target.
    await page.evaluate((z) => {
      window.__ATLAS_APP__!.host.setDestinationControl('quasar-agn', { zoom01: z });
    }, ZONE_JUMP_INNER);
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    snap = await agnSnapshot(page);
    expect(snap.zone).toBe('inner');
    expect(snap.grPassActive).toBe(true);
    expect(snap.doubleRenderGuard).toBe('ok');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test('blazar preset reports orientation-driven beaming state', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=blazar-view');
    await waitForArrival(page, 'quasar-agn', 'blazar-view');
    const snap = await agnSnapshot(page);
    expect(snap.scenario).toBe('blazar-view');
    expect(snap.observerAngleToJetDeg).toBe(3);
    expect((snap.lobeBrightnessRatio as number) ?? 0).toBeGreaterThan(100);
    expect(snap.grPassActive).toBe(false);
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test('controls persist across destination switches and revisits', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=radio-galaxy');
    await waitForArrival(page, 'quasar-agn', 'radio-galaxy');
    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('quasar-agn', {
        jetTracerDensity: 0.25,
        torusVisible: false
      });
    });
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('neutron-star'));
    await waitForArrival(page, 'neutron-star');
    await page.evaluate((p) => {
      window.__ATLAS_APP__!.navigate('quasar-agn', p);
    }, 'radio-galaxy');
    await waitForArrival(page, 'quasar-agn', 'radio-galaxy');
    const share = await page.evaluate(
      () => window.__ATLAS_APP__!.host.state.destinations['quasar-agn']?.state ?? {}
    );
    expect(share['jetTracerDensity']).toBe(0.25);
    expect(share['torusVisible']).toBe(false);
    expect(share['scenario']).toBe('radio-loud');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test('tier switches keep every zone rendering without corruption', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=quasar-reference');
    await waitForArrival(page, 'quasar-agn', 'quasar-reference');
    for (const tier of ['low', 'ultra'] as const) {
      await page.evaluate((t) => {
        window.__ATLAS_APP__!.host.governor.setForcedTier(t);
      }, tier);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
      expect((await agnSnapshot(page)).doubleRenderGuard).toBe('ok');
    }
    expect(errors).toEqual([]);
  });

  test('repeated atlas switching involving quasar-agn stays bounded and clean', async ({
    page
  }) => {
    const errors = collectErrors(page);
    test.setTimeout(180_000);
    await page.goto('/atlas/quasar-agn?preset=quasar-reference');
    await waitForArrival(page, 'quasar-agn', 'quasar-reference');

    const route = ['black-hole', 'tidal-disruption', 'quasar-agn'] as const;
    let baselineScopes = -1;
    for (let round = 0; round < 3; round += 1) {
      for (const dest of route) {
        await page.evaluate((d) => {
          const app = window.__ATLAS_APP__!;
          if (d === 'quasar-agn') app.navigate(d, 'quasar-reference');
          else app.navigate(d);
        }, dest);
        await waitForArrival(page, dest);
      }
      const inventory = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
      if (round === 0) baselineScopes = inventory.liveScopeCount;
      else {
        expect(inventory.liveScopeCount).toBeLessThanOrEqual(baselineScopes + 1);
      }
    }
    const snap = await agnSnapshot(page);
    expect(snap.zone).toBe('nuclear');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    expect(errors).toEqual([]);
  });
});

const ZONE_JUMP_INNER = 0.18;
