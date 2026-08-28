import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import {
  ARRIVAL_TIMEOUT_MS,
  expectPresentedMotion,
  measurePresentedMotion
} from './support/appHarness.js';

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
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
}

interface AgnSnapshot {
  zone?: unknown;
  timeDays?: unknown;
  continuumFactor?: unknown;
  keplerOmegaScalePerDay?: unknown;
  nuclearDelayDaysPerUnit?: unknown;
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
    test.setTimeout(process.env.CI ? 600_000 : 180_000);
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

/**
 * Phenomena-animation campaign. Before it, this destination:
 * - registered NO phase mapping, so its timeline saturated one second after
 *   arrival and every uniform froze;
 * - never fed the INNER-zone DIRECT lensing pass a camera, so the advertised
 *   "GR reuse" view was a flat constant-colour wash with no black hole in it;
 * - drew the dusty torus as a uniform unit-density shell whose accumulated
 *   alpha became an opaque wall covering the entire default view.
 *
 * Every test below fails on any of those regressions.
 */
test.describe('Quasar/AGN is a live scene, not a still life', () => {
  test('nuclear view evolves on its own while the timeline plays', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=quasar-reference');
    await waitForArrival(page, 'quasar-agn', 'quasar-reference');

    // Window matched to THIS destination's timescales: at ~13 observer-days per
    // wall second, 90 animation frames is ~20 d — long enough for the continuum
    // surrogate's faster components and the disc shear to move the frame, short
    // enough to keep the test quick. Measuring an AGN over 0.5 s would be like
    // asking whether a quasar varied during one exposure.
    const motion = await measurePresentedMotion(page, { captures: 4, framesBetween: 90 });
    expectPresentedMotion(motion, { label: 'quasar-agn nuclear' });
    expect(errors).toEqual([]);
  });

  test('timeline is paced in observer-frame days and loops', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=quasar-reference');
    await waitForArrival(page, 'quasar-agn', 'quasar-reference');

    const snap = await page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot());
    expect(snap.basePlaybackRate, 'must declare a wall-clock pace').toBeGreaterThan(1);
    expect(snap.loop).toBe(true);

    // The destination consumes physical time (days), not the raw phase.
    const before = (await agnSnapshot(page)).timeDays;
    expect(typeof before).toBe('number');
    await expect
      .poll(async () => (await agnSnapshot(page)).timeDays as number, {
        timeout: 15_000,
        intervals: [200]
      })
      .toBeGreaterThan((before as number) + 5);
    expect(errors).toEqual([]);
  });

  test('continuum surrogate and mass-derived rates reach the shader uniforms', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=quasar-reference');
    await waitForArrival(page, 'quasar-agn', 'quasar-reference');

    const snap = await agnSnapshot(page);
    // Keplerian shear coefficient: (c/r_g) expressed per day. For the 1e8 Msun
    // reference engine r_g/c is ~493 s, so the coefficient is ~175 rad/day at
    // r = 1 r_g. A zero here means the disc pattern cannot shear at all.
    expect(snap.keplerOmegaScalePerDay as number).toBeGreaterThan(100);
    expect(snap.keplerOmegaScalePerDay as number).toBeLessThan(300);
    // Light-travel delay per nuclear scene unit (1e3 r_g) in days: ~5.7 d.
    expect(snap.nuclearDelayDaysPerUnit as number).toBeGreaterThan(1);
    expect(snap.nuclearDelayDaysPerUnit as number).toBeLessThan(30);

    // The continuum factor must actually vary over the timeline, and stay in a
    // physically sane band (the surrogate is ~16% RMS, never negative).
    const samples: number[] = [];
    for (const phase of [0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84]) {
      await page.evaluate((p) => {
        const h = window.__ATLAS_APP__!.host;
        h.time.pause();
        h.time.scrubTo(p);
      }, phase);
      await expect
        .poll(async () => (await agnSnapshot(page)).timeDays as number, {
          timeout: 10_000,
          intervals: [100]
        })
        .toBeCloseTo(phase * 400, 0);
      samples.push((await agnSnapshot(page)).continuumFactor as number);
    }
    for (const value of samples) {
      expect(value).toBeGreaterThan(0.2);
      expect(value).toBeLessThan(2.2);
    }
    const spread = Math.max(...samples) - Math.min(...samples);
    expect(spread, 'continuum must vary across the timeline').toBeGreaterThan(0.05);
    expect(errors).toEqual([]);
  });

  test('inner zone renders the lensed engine, not a flat wash', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=inner-engine');
    await waitForArrival(page, 'quasar-agn', 'inner-engine');

    const snap = await agnSnapshot(page);
    expect(snap.zone).toBe('inner');
    expect(snap.grPassActive).toBe(true);

    // A pass that never receives the live camera outputs a CONSTANT colour, so
    // spatial variance across the frame is the direct evidence that the ray
    // reconstruction is actually running. The lensed disc/shadow produces a
    // large spread; a flat wash produces ~0.
    const grid = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    expect(grid).not.toBeNull();
    const luma = (grid as string[]).map((cell) => {
      const [r, g, b] = cell.split(',').map(Number);
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    });
    const mean = luma.reduce((a, b) => a + b, 0) / luma.length;
    const std = Math.sqrt(luma.reduce((a, b) => a + (b - mean) ** 2, 0) / luma.length);
    expect(std, 'INNER zone frame is uniform: the GR pass has no camera state').toBeGreaterThan(2);
    expect(new Set((grid as string[]).map((c) => c)).size).toBeGreaterThan(3);
    expect(errors).toEqual([]);
  });

  test('the dusty torus does not block the whole nuclear view', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/quasar-agn?preset=quasar-reference');
    await waitForArrival(page, 'quasar-agn', 'quasar-reference');

    const grid = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    expect(grid).not.toBeNull();
    const cells = (grid as string[]).map((cell) => {
      const [r, g, b] = cell.split(',').map(Number);
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
    });
    // The torus previously saturated into a single flat colour across the frame.
    // Two independent facts rule that out: several distinct colours, and at
    // least one genuinely dark cell (sky or the obscured funnel) alongside a
    // bright one (the illuminated inner rim / engine).
    const keys = new Set(cells.map((c) => `${c.r},${c.g},${c.b}`));
    expect(keys.size, 'nuclear frame is a single flat colour').toBeGreaterThan(4);
    const luma = cells.map((c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
    expect(Math.min(...luma), 'no dark sky anywhere: the torus fills the frame').toBeLessThan(24);
    expect(Math.max(...luma), 'nothing bright: the engine is not visible').toBeGreaterThan(30);
    expect(errors).toEqual([]);
  });
});
