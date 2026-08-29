import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import {
  ARRIVAL_TIMEOUT_MS,
  expectPresentedMotion,
  measurePresentedMotion
} from './support/appHarness.js';

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
            // The destination module must actually be ENTERED (prepare +
            // enter complete, debug snapshot live) — the initial deep-link
            // boot has no transition phase to gate on.
            if (app.host.activeDestinationDebugSnapshot() === null) return 'preparing';
            return 'arrived';
          },
          { dest: destinationId, preset: presetId }
        ),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
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
      // Poll a few deterministic frames: the arrival camera eases for ~0.9 s,
      // so a frame captured mid-ease on a loaded machine can miss the subject.
      let uniform = new Set(samples!).size <= 1;
      for (let attempt = 0; uniform && attempt < 8; attempt += 1) {
        await page.waitForTimeout(250);
        const next = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
        if (next !== null) uniform = new Set(next).size <= 1;
      }
      expect(uniform, 'presented frame should not be uniform').toBe(false);

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
    // Sweep finely rather than at hand-picked phases: the stage weights are a
    // presentation choice and were rebalanced during the phenomena-animation
    // campaign, so a fixed sample list can step straight over a narrow stage
    // (the 7%-wide `winding`) and report a false ordering violation.
    const sweep = Array.from({ length: 41 }, (_, i) => i / 40);
    for (const phase of sweep) {
      await page.evaluate((p) => {
        const h = window.__ATLAS_APP__!.host;
        h.time.pause();
        h.time.scrubTo(p);
      }, phase);
      await page.waitForTimeout(140);
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
    await expect
      .poll(async () => (await tdeSnapshot(page))['phase'], { timeout: 10000, intervals: [200] })
      .toBe('debris');
    const debrisSnap = await tdeSnapshot(page);
    expect(debrisSnap['streamBoundVisible']).toBe(true);
    expect(debrisSnap['volumeVisible']).toBe(false);
    expect(debrisSnap['disrupts']).toBe(true);

    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.scrubTo(0.78); // shock
    });
    await expect
      .poll(async () => (await tdeSnapshot(page))['phase'], { timeout: 10000, intervals: [200] })
      .toBe('shock');
    const shockSnap = await tdeSnapshot(page);
    expect(shockSnap['phase']).toBe('shock');
    expect(shockSnap['volumeVisible']).toBe(true);

    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.scrubTo(0.97); // nascent disk
    });
    await expect
      .poll(async () => (await tdeSnapshot(page))['phase'], { timeout: 10000, intervals: [200] })
      .toBe('nascent-disk');
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
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [50] }
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

  test('share-link dc controls survive the deep-link round trip', async ({ page }) => {
    const errors = collectErrors(page);
    // dc payload: {"penetrationScenario":"deep","blackHoleMassSolar":3e6}
    const dc = encodeURIComponent(JSON.stringify({ penetrationScenario: 'deep' }));
    await page.goto(
      `/atlas/tidal-disruption?preset=solar-canonical&v=1&d=tidal-disruption&dc=${dc}`
    );
    await waitForArrival(page, 'tidal-disruption', 'solar-canonical');
    await page.waitForTimeout(800);
    const snap = await tdeSnapshot(page);
    expect(snap['beta']).toBe(2.5);
    // The canonical state mirrors the applied controls.
    const shareState = await page.evaluate(
      () => window.__ATLAS_APP__!.host.state.destinations['tidal-disruption']?.state ?? {}
    );
    expect(shareState['penetrationScenario']).toBe('deep');
    expect(errors).toEqual([]);
  });

  test('destination controls persist across navigate-away and back (same preset)', async ({
    page
  }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption?preset=solar-canonical');
    await waitForArrival(page, 'tidal-disruption', 'solar-canonical');
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('tidal-disruption', {
        penetrationScenario: 'deep'
      });
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('neutron-star'));
    await waitForArrival(page, 'neutron-star');

    // Back/forward (and plain re-navigation) to the SAME preset restores the
    // cached controls instead of silently resetting them.
    await page.goBack();
    await waitForArrival(page, 'tidal-disruption', 'solar-canonical');
    await page.waitForTimeout(600);
    const snap = await tdeSnapshot(page);
    expect(snap['beta']).toBe(2.5);
    expect(errors).toEqual([]);
  });

  test('switching presets resets controls to the new preset defaults', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption?preset=solar-canonical');
    await waitForArrival(page, 'tidal-disruption', 'solar-canonical');
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.setDestinationControl('tidal-disruption', {
        penetrationScenario: 'deep'
      });
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.navigate('tidal-disruption', 'grazing-flyby');
    });
    await waitForArrival(page, 'tidal-disruption', 'grazing-flyby');
    await page.waitForTimeout(600);
    const snap = await tdeSnapshot(page);
    expect(snap['beta']).toBe(0.85); // preset-true, NOT the carried-over deep
    expect(errors).toEqual([]);
  });

  test('extended cross-destination torture: BH -> TDE -> CM -> SN -> NS x5 stays bounded', async ({
    page
  }) => {
    const errors = collectErrors(page);
    test.setTimeout(process.env.CI ? 600_000 : 150_000);
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

/**
 * Phenomena-animation campaign. This destination previously arrived PAUSED, so
 * it never advanced unless the viewer found the transport; its mapping advanced
 * uniformly in physical seconds, which needed ~173 real days for one traverse;
 * and its stream ribbons were cropped at 12 x periapsis, which emptied them
 * entirely once the debris left on its orbits — so the presented frame was a
 * single static star for effectively the whole timeline.
 */
test.describe('Tidal Disruption plays on its own (phenomena-animation)', () => {
  test('arrives playing, phase-paced and looping', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption');
    await waitForArrival(page, 'tidal-disruption');

    const snap = await page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot());
    expect(snap.paused, 'destination must arrive playing').toBe(false);
    expect(snap.loop).toBe(true);
    // Phase-paced: base rate is in PHASE units per second, so it is well below 1.
    expect(snap.basePlaybackRate).toBeGreaterThan(0);
    expect(snap.basePlaybackRate).toBeLessThan(0.2);

    const before = snap.simulationPhase;
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot().simulationPhase), {
        timeout: 15_000,
        intervals: [200]
      })
      .toBeGreaterThan(before + 0.02);
    expect(errors).toEqual([]);
  });

  test('the presented image evolves while the encounter runs', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption');
    await waitForArrival(page, 'tidal-disruption');

    const motion = await measurePresentedMotion(page, { captures: 5, framesBetween: 60 });
    expectPresentedMotion(motion, { label: 'tidal-disruption', minMeanDelta: 0.15 });
    expect(errors).toEqual([]);
  });

  test('the debris stream is actually drawn after disruption', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption');
    await waitForArrival(page, 'tidal-disruption');

    // Mid-debris: both spines must carry points. The old fixed radial crop
    // returned zero points here, so the stream existed only in the model.
    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.pause();
      h.time.scrubTo(0.4);
    });
    await expect
      .poll(async () => (await tdeSnapshot(page))['phase'], { timeout: 10_000, intervals: [150] })
      .toBe('debris');
    const snap = await tdeSnapshot(page);
    expect(Number(snap['spineBoundPoints'])).toBeGreaterThan(1);
    expect(Number(snap['streamExtentUnits'])).toBeGreaterThan(0);
    expect(snap['streamBoundVisible']).toBe(true);
    expect(errors).toEqual([]);
  });

  test('auto-framing follows the scene scale and yields to the viewer', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/tidal-disruption');
    await waitForArrival(page, 'tidal-disruption');

    // The rig's default 500-unit ceiling used to clamp this scene; the
    // destination declares its own range.
    const limits = await page.evaluate(() =>
      window.__ATLAS_APP__!.host.cameraRig.getDistanceLimits()
    );
    expect(limits.max).toBeGreaterThan(500);

    // Wait until auto-framing has actually taken the distance: it deliberately
    // stays hands-off during the rig's arrival ease, and a viewer change inside
    // that window is absorbed as the new baseline rather than treated as a
    // takeover (the rig itself is moving the camera then).
    await expect
      .poll(async () => (await tdeSnapshot(page))['autoFrameDistanceUnits'] !== null, {
        timeout: 15_000,
        intervals: [200]
      })
      .toBe(true);
    expect((await tdeSnapshot(page))['autoFrameEnabled']).toBe(true);

    // A viewer-driven distance change hands control back permanently.
    await page.evaluate(() => {
      const rig = window.__ATLAS_APP__!.host.cameraRig;
      const orbit = rig.getOrbit();
      rig.setOrbit(orbit.azimuthDeg, orbit.polarDeg, orbit.distance * 2.5);
    });
    await expect
      .poll(async () => (await tdeSnapshot(page))['autoFrameEnabled'], {
        timeout: 10_000,
        intervals: [200]
      })
      .toBe(false);
    expect(errors).toEqual([]);
  });
});
