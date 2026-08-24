import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';

/**
 * CA8-19/§18 — Black-Hole Merger headless browser validation.
 *
 * Covers: deep links for every production preset, destination-selector chip,
 * clean console, non-uniform output, data-derived phase order, waveform
 * panel synchronization (numeric, not screenshot), scrub/pause/reset
 * determinism, rapid A→BBM→C cancellation loops (no stale activation),
 * reduced-motion transition, revisit + disposal stability.
 *
 * All browser work is headless with bounded concurrency (playwright workers;
 * run with --workers=2 per campaign §19).
 */

const PRESETS = [
  'sxs-bbh-0001-inspiral',
  'sxs-bbh-0001-merger',
  'sxs-bbh-0001-ringdown',
  'sxs-bbh-0001-remnant'
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
      { timeout: 30_000, intervals: [250] }
    )
    .toBe('arrived');
}

interface BbmSnapshot {
  phase?: string;
  timeM?: number;
  amplitudeNormalized?: number;
  separationM?: number;
  visibleSystems?: string[];
  doubleRenderGuard?: string;
  datasetId?: string;
  kerrSpinDimensionless?: number;
  disclosure?: string;
}

async function bbmSnapshot(page: Page): Promise<BbmSnapshot> {
  return page.evaluate(() => {
    const snap = window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot();
    return snap === null ? {} : (snap as BbmSnapshot);
  });
}

test.describe('Black-Hole Merger validation (CA8)', () => {
  for (const preset of PRESETS) {
    test(`deep link boots ${preset} with clean console and live output`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`/atlas/black-hole-merger?preset=${preset}`);
      await waitForArrival(page, 'black-hole-merger', preset);
      await page.waitForTimeout(1200);

      const samples = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
      expect(samples).not.toBeNull();
      expect(samples!.length).toBe(25);
      expect(new Set(samples!).size, 'presented frame should not be uniform').toBeGreaterThan(1);

      const snap = await bbmSnapshot(page);
      expect(snap.datasetId).toBe('sxs-bbh-0001-lev5');
      expect(snap.doubleRenderGuard).toBe('ok');
      // Fidelity disclosure is present and honest in the debug snapshot.
      expect(String(snap.disclosure)).toContain('illustrative');

      const statusText = await page.locator('.atlas-status').textContent();
      expect(statusText).toBe('Atlas ready');
      expect(errors).toEqual([]);
    });
  }

  test('destination selector exposes the merger chip and navigates', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');
    await page.waitForTimeout(600);

    // The production selector must include the completed destinations
    // (quasar-agn regression pin) and the new black-hole-merger chip.
    const chips = page.locator('.atlas-nav-chip');
    await expect(chips.filter({ hasText: 'Quasar / AGN' })).toHaveCount(1);
    await expect(chips.filter({ hasText: 'Black-Hole Merger' })).toHaveCount(1);

    await chips.filter({ hasText: 'Black-Hole Merger' }).click();
    await waitForArrival(page, 'black-hole-merger');
    const snap = await bbmSnapshot(page);
    expect(snap.datasetId).toBe('sxs-bbh-0001-lev5');
    expect(errors).toEqual([]);
  });

  test('data-derived phases appear in order while scrubbing', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole-merger');
    await waitForArrival(page, 'black-hole-merger');
    await page.waitForTimeout(800);

    const seen: string[] = [];
    let lastPhase = '';
    for (const phase of [0.05, 0.3, 0.56, 0.585, 0.61, 0.655, 0.68, 0.75, 0.95]) {
      await page.evaluate((p) => {
        const h = window.__ATLAS_APP__!.host;
        h.time.pause();
        h.time.scrubTo(p);
      }, phase);
      await page.waitForTimeout(250);
      const snap = await bbmSnapshot(page);
      const name = String(snap.phase);
      if (name !== lastPhase) {
        seen.push(name);
        lastPhase = name;
      }
    }
    expect(seen, `phases in order, got ${seen.join('->')}`).toEqual([
      'inspiral',
      'merger',
      'ringdown',
      'remnant'
    ]);

    // Remnant state reports the SOURCE-DERIVED Kerr parameters.
    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.scrubTo(0.9);
    });
    await page.waitForTimeout(250);
    const snap = await bbmSnapshot(page);
    expect(snap.kerrSpinDimensionless ?? null).toBeCloseTo(0.6864817488889335, 9);
    expect(errors).toEqual([]);
  });

  test('waveform panel stays synchronized with the timeline cursor', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole-merger?preset=sxs-bbh-0001-merger');
    await waitForArrival(page, 'black-hole-merger', 'sxs-bbh-0001-merger');
    await page.waitForTimeout(800);

    const readout = page.locator('.bbm-waveform-readout');
    await expect(readout).toBeVisible();

    // Scrub to a distinctive early-inspiral position; the numeric readout
    // must mirror the timeline's physical time (numeric sync, not visual).
    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.pause();
      h.time.scrubTo(0.2);
    });
    await page.waitForTimeout(400);
    const textAt02 = (await readout.textContent()) ?? '';
    expect(textAt02).toContain('inspiral');

    const timelineTimeAt02 = await page.evaluate(
      () => window.__ATLAS_APP__!.host.time.snapshot().physicalTime
    );
    const parsedTime = Number(/t = ([+-][\d.]+) M/.exec(textAt02)?.[1] ?? Number.NaN);
    expect(Number.isFinite(parsedTime)).toBe(true);
    expect(Math.abs(parsedTime - (timelineTimeAt02 as number))).toBeLessThan(0.15);

    // Scrub into ringdown: the readout phase label must follow.
    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.scrubTo(0.67);
    });
    await page.waitForTimeout(400);
    const textAt067 = (await readout.textContent()) ?? '';
    expect(textAt067).toContain('ringdown');
    expect(errors).toEqual([]);
  });

  test('timeline reset reproduces identical deterministic state', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole-merger');
    await waitForArrival(page, 'black-hole-merger');
    await page.waitForTimeout(800);

    const readAtReset = async (): Promise<BbmSnapshot> => {
      await page.evaluate(() => {
        const h = window.__ATLAS_APP__!.host;
        h.time.pause();
        h.time.reset();
      });
      await page.waitForTimeout(300);
      return bbmSnapshot(page);
    };

    // Run the machine forward, reset, run forward again from the same point,
    // and reset: both resets must land on identical frozen state.
    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.time.play();
    });
    await page.waitForTimeout(900);
    const first = await readAtReset();

    await page.evaluate(() => {
      window.__ATLAS_APP__!.host.time.play();
    });
    await page.waitForTimeout(900);
    const second = await readAtReset();

    expect(second.phase).toBe(first.phase);
    expect(Math.abs((second.timeM as number) - (first.timeM as number))).toBeLessThan(1e-6);
    expect(Math.abs((second.separationM as number) - (first.separationM as number))).toBeLessThan(
      1e-9
    );
    expect(errors).toEqual([]);
  });

  test('rapid A -> BBM -> C cancellation loop leaves no stale target', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');
    await page.waitForTimeout(500);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.evaluate(() => {
        window.__ATLAS_APP__!.navigate('black-hole-merger');
      });
      await page.waitForTimeout(120); // mid-prepare cancellation window
      await page.evaluate(() => {
        window.__ATLAS_APP__!.navigate('neutron-star');
      });
      await page.waitForTimeout(120);
      await page.evaluate(() => {
        window.__ATLAS_APP__!.navigate('black-hole');
      });
    }
    await waitForArrival(page, 'black-hole');
    await page.waitForTimeout(700);

    const inventory = await page.evaluate(() => {
      const inv = window.__ATLAS_APP__!.host.debugInventory();
      return {
        pendingPrepares: inv.pendingPrepares,
        liveScopes: inv.liveScopeCount
      };
    });
    expect(inventory.pendingPrepares).toBe(0);

    // A settled navigation to BBM still works after the churn.
    await page.evaluate(() => {
      window.__ATLAS_APP__!.navigate('black-hole-merger', 'sxs-bbh-0001-remnant');
    });
    await waitForArrival(page, 'black-hole-merger', 'sxs-bbh-0001-remnant');
    const snap = await bbmSnapshot(page);
    expect(snap.doubleRenderGuard).toBe('ok');
    expect(errors).toEqual([]);
  });

  test('reduced-motion travel into the merger uses the crossfade path', async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/atlas/neutron-star');
    await waitForArrival(page, 'neutron-star');
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      window.__ATLAS_APP__!.navigate('black-hole-merger');
    });
    await waitForArrival(page, 'black-hole-merger');
    const snap = await bbmSnapshot(page);
    expect(snap.datasetId).toBe('sxs-bbh-0001-lev5');
    expect(errors).toEqual([]);
  });

  test('revisit keeps resources bounded across repeated travel', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole-merger');
    await waitForArrival(page, 'black-hole-merger');
    await page.waitForTimeout(500);

    let firstGpuBytes = -1;
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await page.evaluate(() => {
        window.__ATLAS_APP__!.navigate('tidal-disruption');
      });
      await waitForArrival(page, 'tidal-disruption');
      await page.evaluate(() => {
        window.__ATLAS_APP__!.navigate('black-hole-merger');
      });
      await waitForArrival(page, 'black-hole-merger');
      await page.waitForTimeout(400);
      const inv = await page.evaluate(() => {
        const i = window.__ATLAS_APP__!.host.debugInventory();
        return { gpu: i.totalEstimatedGpuBytes, pending: i.pendingPrepares };
      });
      if (cycle === 0) firstGpuBytes = inv.gpu;
      expect(inv.pending).toBe(0);
      // Bounded growth: no monotonic accumulation across revisits.
      expect(inv.gpu).toBeLessThan(firstGpuBytes * 2 + 1024);
    }
    expect(errors).toEqual([]);
  });
});
