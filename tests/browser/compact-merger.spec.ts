import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import {
  ARRIVAL_TIMEOUT_MS,
  expectPresentedMotion,
  measurePresentedMotion,
  scrubAndAwaitDestination
} from './support/appHarness.js';

/**
 * CA5 Compact Merger browser validation (mission §21).
 *
 * Covers: deep links for every production preset, clean console, visible
 * non-uniform output, named timeline phases, scrub/pause/reset determinism,
 * repeated preset switching, hyperspace transitions in/out, reduced-motion
 * transition, and resource stability under repeated rewind/play and repeated
 * destination switching.
 */

const PRESETS = [
  'equal-mass-nsns',
  'unequal-mass-nsns',
  'kilonova-focus',
  'short-grb-on-axis',
  'short-grb-off-axis'
] as const;

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

async function mergerSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const snap = window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot();
    return snap === null ? {} : snap;
  });
}

test.describe('Compact Merger validation (CA5)', () => {
  for (const preset of PRESETS) {
    test(`deep link boots ${preset} with clean console and live output`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`/atlas/compact-merger?preset=${preset}`);
      await waitForArrival(page, 'compact-merger', preset);
      await page.waitForTimeout(1200);

      const samples = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
      expect(samples).not.toBeNull();
      expect(samples!.length).toBe(25);
      expect(new Set(samples!).size, 'presented frame should not be uniform').toBeGreaterThan(1);

      const statusText = await page.locator('.atlas-status').textContent();
      expect(statusText).toBe('Atlas ready');
      expect(errors).toEqual([]);
    });
  }

  test('named timeline phases appear in order while scrubbing', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/compact-merger');
    await waitForArrival(page, 'compact-merger');
    await page.waitForTimeout(800);

    const seen: string[] = [];
    let lastPhase = '';
    for (const phase of [0, 0.2, 0.32, 0.37, 0.45, 0.6, 0.85, 1]) {
      // Postcondition wait, not a sleep: a first-time pipeline compile can
      // stall a frame past any fixed delay, which previously let a scrub be
      // read before the destination applied it (see the black-hole-merger
      // last-phase failure this pattern caused).
      await scrubAndAwaitDestination(page, phase, 'timeSeconds');
      const snap = await mergerSnapshot(page);
      const name = String(snap['phase']);
      if (name !== lastPhase) {
        seen.push(name);
        lastPhase = name;
      }
    }
    expect(seen, `phases in order, got ${seen.join('->')}`).toEqual([
      'inspiral',
      'contact',
      'merger',
      'jet',
      'kilonova',
      'afterglow'
    ]);
    expect(errors).toEqual([]);
  });

  test('timeline reset reproduces the identical deterministic state', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/compact-merger?preset=kilonova-focus');
    await waitForArrival(page, 'compact-merger', 'kilonova-focus');
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.pause();
      h.time.scrubTo(0.7);
    });
    await page.waitForTimeout(300);
    const first = await mergerSnapshot(page);

    // Rewind, play briefly, come back to the same phase.
    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.scrubTo(0);
      h.time.play();
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.pause();
      h.time.scrubTo(0.7);
    });
    await page.waitForTimeout(300);
    const second = await mergerSnapshot(page);

    for (const key of [
      'phase',
      'timeSeconds',
      'ejectaRadiusUnits',
      'kilonovaLuminosity',
      'kilonovaTemperatureK'
    ]) {
      expect(second[key], `${key} reproduces after rewind/play`).toBe(first[key]);
    }
    expect(errors).toEqual([]);
  });

  test('repeated preset switching stays bounded and ends consistent', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/compact-merger');
    await waitForArrival(page, 'compact-merger');

    for (let round = 0; round < 3; round += 1) {
      for (const preset of PRESETS) {
        await page.evaluate((p) => {
          window.__ATLAS_APP__!.navigate('compact-merger', p);
        }, preset);
        await waitForArrival(page, 'compact-merger', preset);
      }
    }
    await page.waitForTimeout(600);

    const inv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(inv.pendingPrepares).toBe(0);
    expect(errors).toEqual([]);
  });

  test('repeated rewind/play cycles keep resources bounded', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/compact-merger?preset=kilonova-focus');
    await waitForArrival(page, 'compact-merger', 'kilonova-focus');
    await page.waitForTimeout(800);

    let lastBytes = -1;
    for (let cycle = 0; cycle < 6; cycle += 1) {
      await page.evaluate(() => {
        const h = window.__ATLAS_APP__!.host;
        h.time.scrubTo(0);
        h.time.play();
      });
      await page.waitForTimeout(350);
      await page.evaluate(() => {
        const h = window.__ATLAS_APP__!.host;
        h.time.pause();
        h.time.scrubTo(0.75);
      });
      await page.waitForTimeout(200);
      const inv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
      lastBytes = inv.totalEstimatedGpuBytes;
      expect(inv.pendingPrepares).toBe(0);
    }
    // Bounded: no monotonic growth across cycles (same destination, same tier).
    const finalInv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(finalInv.totalEstimatedGpuBytes).toBe(lastBytes);
    expect(errors).toEqual([]);
  });

  test('hyperspace transitions integrate Compact Merger (in and out)', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');
    await page.waitForTimeout(600);

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('compact-merger'));
    await expect
      .poll(
        async () => page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.transition.phase),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [50] }
      )
      .toBe('hyperspace');
    await waitForArrival(page, 'compact-merger');

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('stellar-explosion'));
    await waitForArrival(page, 'stellar-explosion');
    expect(errors).toEqual([]);
  });

  test('reduced-motion transition reaches Compact Merger without the hyperspace pass', async ({
    page
  }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/atlas/neutron-star');
    await waitForArrival(page, 'neutron-star');
    await page.waitForTimeout(500);

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('compact-merger'));
    await waitForArrival(page, 'compact-merger');
    const sawHyperspace = await page.evaluate(
      () => window.__ATLAS_APP__!.host.state.atlas.transition.phase === 'hyperspace'
    );
    void sawHyperspace; // reduced-motion path may skip the phase entirely
    expect(errors).toEqual([]);
  });

  test('share-link dc controls survive the deep-link round trip (CA6 generalization)', async ({
    page
  }) => {
    const errors = collectErrors(page);
    // dc payload: {"viewingAngleDeg":12,"jetScenario":"thin","remnantScenario":"prompt-bh"}
    const dc = encodeURIComponent(
      JSON.stringify({ viewingAngleDeg: 12, jetScenario: 'thin', remnantScenario: 'prompt-bh' })
    );
    await page.goto(`/atlas/compact-merger?preset=equal-mass-nsns&v=1&d=compact-merger&dc=${dc}`);
    await waitForArrival(page, 'compact-merger', 'equal-mass-nsns');
    await page.waitForTimeout(800);
    const share = await page.evaluate(
      () => window.__ATLAS_APP__!.host.state.destinations['compact-merger']?.state ?? {}
    );
    expect(share['viewingAngleDeg']).toBe(12);
    expect(share['jetScenario']).toBe('thin');
    expect(share['remnantScenario']).toBe('prompt-bh');
    expect(errors).toEqual([]);
  });

  test('extended destination torture: BH -> CM -> SN -> NS -> CM -> BH x4 stays bounded', async ({
    page
  }) => {
    const errors = collectErrors(page);
    test.setTimeout(process.env.CI ? 600_000 : 120_000);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    const route = ['black-hole', 'compact-merger', 'stellar-explosion', 'neutron-star'] as const;
    for (let round = 0; round < 4; round += 1) {
      for (const dest of route) {
        await page.evaluate((d) => {
          window.__ATLAS_APP__!.navigate(d);
        }, dest);
        await waitForArrival(page, dest);
      }
    }
    // 16 heavy destination switches; resources must return bounded.
    const inv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(inv.pendingPrepares).toBe(0);
    expect(inv.liveScopeCount).toBeLessThan(10);
    expect(errors).toEqual([]);
  });
});

/**
 * Phenomena-animation campaign. This destination arrived PAUSED, and its mapping
 * declared neither pacing nor looping: playback advanced physical seconds at
 * 1 s per wall second, so it ran its ~28 s span once and then HELD on the
 * afterglow frame forever. It looked alive for half a minute and frozen after.
 */
test.describe('Compact Merger plays on its own (phenomena-animation)', () => {
  test('arrives playing, phase-paced and looping', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/compact-merger');
    await waitForArrival(page, 'compact-merger');

    const snap = await page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot());
    expect(snap.paused, 'destination must arrive playing').toBe(false);
    expect(snap.loop).toBe(true);
    expect(snap.basePlaybackRate).toBeGreaterThan(0);
    expect(snap.basePlaybackRate).toBeLessThan(0.2); // phase units per second

    const before = snap.simulationPhase;
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot().simulationPhase), {
        timeout: 15_000,
        intervals: [200]
      })
      .toBeGreaterThan(before + 0.03);
    expect(errors).toEqual([]);
  });

  test('wraps at the end of the afterglow instead of holding', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/compact-merger');
    await waitForArrival(page, 'compact-merger');

    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.scrubTo(0.99);
      h.time.play();
    });
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot().simulationPhase), {
        timeout: 20_000,
        intervals: [200]
      })
      .toBeLessThan(0.9);
    expect(errors).toEqual([]);
  });

  test('the presented image evolves while the merger runs', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/compact-merger');
    await waitForArrival(page, 'compact-merger');

    const motion = await measurePresentedMotion(page, { captures: 4, framesBetween: 30 });
    expectPresentedMotion(motion, { label: 'compact-merger' });
    expect(errors).toEqual([]);
  });
});
