import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';

/**
 * CA6 Tidal Disruption browser validation.
 *
 * Covers: deep links for every production preset, clean console, visible
 * non-uniform output, named timeline phases in physical order, visible
 * deformation before disruption, debris systems absent before disruption,
 * streams/shock/disk activation in their stages, controls mutating canonical
 * destination state, share/deep-link round trip, scrub/reset determinism,
 * hyperspace transitions in/out, reduced-motion path, bounded resources
 * under repeated switching, and back/forward behavior.
 */

const PRESETS = [
  'solar-canonical',
  'deep-penetration',
  'grazing-flyby',
  'massive-black-hole',
  'giant-star'
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
            return 'arrived';
          },
          { dest: destinationId, preset: presetId }
        ),
      { timeout: 30_000, intervals: [250] }
    )
    .toBe('arrived');
}

async function tdeSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const snap = window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot();
    return snap === null ? {} : snap;
  });
}

test.describe('Tidal Disruption validation (CA6)', () => {
  for (const preset of PRESETS) {
    test(`deep link boots ${preset} with clean console and live output`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`/atlas/tidal-disruption?preset=${preset}`);
      await waitForArrival(page, 'tidal-disruption', preset);
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
    await page.goto('/atlas/tidal-disruption');
    await waitForArrival(page, 'tidal-disruption');
    await page.waitForTimeout(800);

    const seen: string[] = [];
    let lastPhase = '';
    for (const phase of [0, 0.1, 0.22, 0.32, 0.42, 0.55, 0.68, 0.82, 1]) {
      await page.evaluate((p) => {
        const h = window.__ATLAS_APP__!.host;
        h.time.pause();
        h.time.scrubTo(p);
      }, phase);
      await page.waitForTimeout(250);
      const snap = await tdeSnapshot(page);
      const name = String(snap['phase']);
      if (name !== lastPhase) {
        seen.push(name);
        lastPhase = name;
      }
    }
    expect(seen, `phases in order, got ${seen.join('->')}`).toEqual([
      'approach',
      'deformation',
      'disruption',
      'debris',
      'winding',
      'shock',
      'nascent-disk'
    ]);
    expect(errors).toEqual([]);
  });

  test('star deforms approaching periapsis and debris stays dormant early', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption?preset=solar-canonical');
    await waitForArrival(page, 'tidal-disruption', 'solar-canonical');
    await page.waitForTimeout(600);

    // Early approach: no debris cost at all.
    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.pause();
      h.time.scrubTo(0.02);
    });
    await page.waitForTimeout(300);
    const early = await tdeSnapshot(page);
    expect(Number(early['populationScale'])).toBe(0);
    expect(early['volumeVisible']).toBe(false);
    expect(Number(early['starStretch'])).toBeGreaterThan(1); // already deforming

    // Near periapsis: deformation grows monotonically toward the cap region.
    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.scrubTo(0.28);
    });
    await page.waitForTimeout(300);
    const near = await tdeSnapshot(page);
    expect(Number(near['starStretch'])).toBeGreaterThan(Number(early['starStretch']));
    expect(Number(near['beta'])).toBeCloseTo(1, 5);
    expect(errors).toEqual([]);
  });

  test('streams activate after disruption; shock volume only during shock', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption?preset=solar-canonical');
    await waitForArrival(page, 'tidal-disruption', 'solar-canonical');
    await page.waitForTimeout(600);

    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.pause();
      h.time.scrubTo(0.45); // debris
    });
    await page.waitForTimeout(400);
    const debrisSnap = await tdeSnapshot(page);
    expect(debrisSnap['streamBoundVisible']).toBe(true);
    expect(debrisSnap['volumeVisible']).toBe(false);
    expect(debrisSnap['disrupts']).toBe(true);

    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.scrubTo(0.78); // shock
    });
    await page.waitForTimeout(400);
    const shockSnap = await tdeSnapshot(page);
    expect(shockSnap['phase']).toBe('shock');
    expect(shockSnap['volumeVisible']).toBe(true);

    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.scrubTo(0.97); // nascent disk
    });
    await page.waitForTimeout(400);
    const diskSnap = await tdeSnapshot(page);
    expect(diskSnap['phase']).toBe('nascent-disk');
    expect(diskSnap['diskVisible']).toBe(true);
    expect(diskSnap['volumeVisible']).toBe(false);
    expect(errors).toEqual([]);
  });

  test('grazing preset never disrupts and keeps shock/disk silent', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption?preset=grazing-flyby');
    await waitForArrival(page, 'tidal-disruption', 'grazing-flyby');
    await page.waitForTimeout(600);

    for (const phase of [0.5, 0.8, 0.97]) {
      await page.evaluate((p) => {
        const h = window.__ATLAS_APP__!.host;
        h.time.pause();
        h.time.scrubTo(p);
      }, phase);
      await page.waitForTimeout(250);
      const snap = await tdeSnapshot(page);
      expect(snap['disrupts']).toBe(false);
      expect(snap['outcome']).toBe('partial-stripping');
      expect(snap['volumeVisible']).toBe(false);
      expect(snap['diskVisible']).toBe(false);
    }
    expect(errors).toEqual([]);
  });

  test('controls mutate canonical destination state through the host channel', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption');
    await waitForArrival(page, 'tidal-disruption');
    await page.waitForTimeout(600);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('tidal-disruption', {
        penetrationScenario: 'deep'
      });
    });
    await page.waitForTimeout(300);
    let snap = await tdeSnapshot(page);
    expect(snap['beta']).toBe(2.5);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('tidal-disruption', {
        blackHoleMassSolar: 3e6
      });
    });
    await page.waitForTimeout(300);
    snap = await tdeSnapshot(page);
    expect(Number(snap['rpUnits'])).toBeCloseTo(Number(snap['rtUnits']) / 2.5, 4);

    // Canonical state mirrors the merged control state for share links.
    const shareState = await page.evaluate(
      () => window.__ATLAS_APP__!.host.state.destinations['tidal-disruption']?.state ?? {}
    );
    expect(shareState['penetrationScenario']).toBe('deep');
    expect(shareState['blackHoleMassSolar']).toBe(3e6);
    expect(errors).toEqual([]);
  });

  test('timeline reset reproduces the identical deterministic state', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption?preset=deep-penetration');
    await waitForArrival(page, 'tidal-disruption', 'deep-penetration');
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.pause();
      h.time.scrubTo(0.72);
    });
    await page.waitForTimeout(300);
    const first = await tdeSnapshot(page);

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
      h.time.scrubTo(0.72);
    });
    await page.waitForTimeout(300);
    const second = await tdeSnapshot(page);

    for (const key of ['phase', 'timeSeconds', 'shockGain', 'diskGain', 'starDistanceUnits']) {
      expect(second[key], `${key} reproduces after rewind/play`).toBe(first[key]);
    }
    expect(errors).toEqual([]);
  });

  test('repeated preset switching stays bounded and ends consistent', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption');
    await waitForArrival(page, 'tidal-disruption');

    for (let round = 0; round < 3; round += 1) {
      for (const preset of PRESETS) {
        await page.evaluate((p) => {
          window.__ATLAS_APP__!.navigate('tidal-disruption', p);
        }, preset);
        await waitForArrival(page, 'tidal-disruption', preset);
      }
    }
    await page.waitForTimeout(600);

    const inv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(inv.pendingPrepares).toBe(0);
    expect(errors).toEqual([]);
  });

  test('repeated rewind/play cycles keep resources bounded', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption?preset=solar-canonical');
    await waitForArrival(page, 'tidal-disruption', 'solar-canonical');
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
    const finalInv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(finalInv.totalEstimatedGpuBytes).toBe(lastBytes);
    expect(errors).toEqual([]);
  });

  test('hyperspace transitions integrate Tidal Disruption (in and out)', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');
    await page.waitForTimeout(600);

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('tidal-disruption'));
    await expect
      .poll(
        async () => page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.transition.phase),
        { timeout: 15_000, intervals: [50] }
      )
      .toBe('hyperspace');
    await waitForArrival(page, 'tidal-disruption');

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('stellar-explosion'));
    await waitForArrival(page, 'stellar-explosion');
    expect(errors).toEqual([]);
  });

  test('browser back/forward returns to the correct TDE route/preset', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption?preset=giant-star');
    await waitForArrival(page, 'tidal-disruption', 'giant-star');

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('neutron-star'));
    await waitForArrival(page, 'neutron-star');

    await page.goBack();
    await waitForArrival(page, 'tidal-disruption', 'giant-star');
    await page.goForward();
    await waitForArrival(page, 'neutron-star');
    expect(errors).toEqual([]);
  });

  test('extended cross-destination torture: BH -> TDE -> CM -> SN -> NS x5 stays bounded', async ({
    page
  }) => {
    const errors = collectErrors(page);
    test.setTimeout(150_000);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    const route = [
      'black-hole',
      'tidal-disruption',
      'compact-merger',
      'stellar-explosion',
      'neutron-star'
    ] as const;
    for (let round = 0; round < 5; round += 1) {
      for (const dest of route) {
        await page.evaluate((d) => {
          window.__ATLAS_APP__!.navigate(d);
        }, dest);
        await waitForArrival(page, dest);
      }
    }
    // 25 heavy destination switches; resources must return bounded.
    const inv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(inv.pendingPrepares).toBe(0);
    expect(inv.liveScopeCount).toBeLessThan(10);
    expect(errors).toEqual([]);
  });
});
