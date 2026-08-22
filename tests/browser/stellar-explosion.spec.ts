import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';

/**
 * Stellar Explosion destination validation (CA4, campaign sections 40-42).
 *
 * Coverage: deep links for every production preset on BOTH backends,
 * mid-timeline ejecta visibility, GRB on-axis/off-axis geometric distinction,
 * timeline scrub/reset determinism, transition integration with the existing
 * hyperspace system, and the extended 32-switch resource stress including
 * the new heavy destination.
 */

async function waitForArrival(page: Page, timeoutMs = 30_000): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__!;
          if (!app) return 'no-app';
          const t = app.host.state.atlas.transition;
          if (t.active) return 'transitioning';
          return 'arrived';
        }),
      { timeout: timeoutMs, intervals: [250] }
    )
    .toBe('arrived');
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on('console', (m) => {
    const text = m.text();
    if (
      m.type() === 'error' &&
      !/powerPreference|readback|Failed to load resource|webgl.*warning/i.test(text)
    ) {
      errors.push(`console: ${text.slice(0, 160)}`);
    }
  });
  return errors;
}

/** Pause the shared clock and scrub to a deterministic timeline position. */
async function freezeAt(page: Page, phase01: number): Promise<void> {
  await page.evaluate((phase) => {
    const host = window.__ATLAS_APP__!.host;
    host.time.pause();
    host.time.scrubTo(phase);
  }, phase01);
}

/**
 * Poll the 5x5 capture grid until the frame is non-uniform. First frames
 * after arrival can still be pipeline-compile black frames — dramatically so
 * on the forced-WebGL2 backend where TSL->GLSL compilation lands lazily.
 */
async function waitForNonUniformFrame(page: Page, timeoutMs = 20_000): Promise<number> {
  let unique = 0;
  await expect
    .poll(
      async () => {
        const value = await page.evaluate(() => {
          const pts = window.__ATLAS_APP__!.captureFrame();
          return pts ? new Set(pts).size : 0;
        });
        unique = value;
        return value;
      },
      { timeout: timeoutMs, intervals: [400] }
    )
    .toBeGreaterThan(2);
  return unique;
}

test.describe('Stellar Explosion validation', () => {
  let errors: string[];

  test.beforeEach(({ page }) => {
    errors = collectErrors(page);
  });

  for (const backend of [undefined, 'webgl2'] as const) {
    const query = backend === undefined ? '' : ` (+forced ${backend})`;

    test(`deep link boots core-collapse with visible ejecta mid-timeline${query}`, async ({
      page
    }) => {
      await page.goto(
        `/atlas/stellar-explosion?preset=core-collapse${backend === undefined ? '' : `&backend=${backend}`}`
      );
      await waitForArrival(page);
      // Deterministic mid-expansion inspection point.
      await freezeAt(page, 0.55);
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        const pts = app.captureFrame();
        return {
          dest: app.host.state.atlas.activeDestination,
          preset: app.host.state.atlas.activePreset,
          uniqueColors: pts ? new Set(pts).size : 0,
          snapshot: app.host.state.destinations['stellar-explosion']?.state ?? null
        };
      });
      expect(state.dest).toBe('stellar-explosion');
      expect(state.preset).toBe('core-collapse');
      expect(state.uniqueColors).toBeGreaterThan(2); // non-uniform frame
      const snap = state.snapshot as Record<string, unknown> | null;
      expect(snap).not.toBeNull();
      expect(snap?.['scenarioId']).toBe('core-collapse');
      expect(errors).toEqual([]);
    });

    for (const preset of ['hypernova', 'long-grb-on-axis', 'long-grb-off-axis']) {
      test(`deep link boots ${preset}${query}`, async ({ page }) => {
        await page.goto(
          `/atlas/stellar-explosion?preset=${preset}${backend === undefined ? '' : `&backend=${backend}`}`
        );
        await waitForArrival(page);
        await freezeAt(page, 0.5);
        await page.waitForTimeout(600);
        const state = await page.evaluate(() => {
          const app = window.__ATLAS_APP__!;
          return {
            dest: app.host.state.atlas.activeDestination,
            preset: app.host.state.atlas.activePreset,
            frame: app.captureFrame()
          };
        });
        expect(state.dest).toBe('stellar-explosion');
        expect(state.preset).toBe(preset);
        expect(state.frame).not.toBeNull();
        expect(errors).toEqual([]);
      });
    }
  }

  test('GRB on-axis and off-axis views differ geometrically at the same phase', async ({
    page
  }) => {
    const captureAt = async (preset: string): Promise<string[]> => {
      await page.goto(`/atlas/stellar-explosion?preset=${preset}`);
      await waitForArrival(page);
      await freezeAt(page, 0.42); // jet-breakout / early expansion window
      await page.waitForTimeout(900);
      const frame = await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        void app.captureFrame(); // advance one deterministic frame in-task
        return app.captureFrame();
      });
      expect(frame).not.toBeNull();
      return frame as string[];
    };
    const onAxis = await captureAt('long-grb-on-axis');
    const offAxis = await captureAt('long-grb-off-axis');
    // The two observer geometries must produce DIFFERENT images — a flat
    // brightness multiplier would scale channels uniformly; we assert the
    // sampled grid actually diverges structurally.
    const differingPoints = onAxis.filter((p, i) => p !== offAxis[i]).length;
    expect(differingPoints).toBeGreaterThan(4);
    expect(errors).toEqual([]);
  });

  test('timeline reset reproduces the identical deterministic state', async ({ page }) => {
    await page.goto('/atlas/stellar-explosion?preset=core-collapse');
    await waitForArrival(page);
    // Pin quality so auto-tier drift cannot change internal resolution.
    await page.evaluate(() =>
      window.__ATLAS_APP__!.host.governor.configure({ qualityMode: 'medium' })
    );
    await freezeAt(page, 0.6);
    await waitForNonUniformFrame(page);
    const first = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    // Scrub elsewhere then RESET to the same phase; the model must reproduce
    // the same image. Volume temporal jitter is seeded (frame-indexed), so we
    // allow small per-channel noise but no structural divergence.
    await freezeAt(page, 0.2);
    await page.waitForTimeout(400);
    await freezeAt(page, 0.6);
    await waitForNonUniformFrame(page);
    const second = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const maxDelta = Math.max(
      ...(first as string[]).map((p, i) => {
        const a = p.split(',').map(Number);
        const b = (second as string[])[i]!.split(',').map(Number);
        return Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!), Math.abs(a[2]! - b[2]!));
      })
    );
    expect(maxDelta).toBeLessThanOrEqual(8);
    expect(errors).toEqual([]);
  });

  test('hyperspace transitions integrate Stellar Explosion (in and out)', async ({ page }) => {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('stellar-explosion'));
    await waitForArrival(page, 40_000);
    let dest = await page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activeDestination);
    expect(dest).toBe('stellar-explosion');
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('neutron-star'));
    await waitForArrival(page, 40_000);
    dest = await page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activeDestination);
    expect(dest).toBe('neutron-star');
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('stellar-explosion'));
    await waitForArrival(page, 40_000);
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('black-hole'));
    await waitForArrival(page, 40_000);
    dest = await page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activeDestination);
    expect(dest).toBe('black-hole');
    expect(errors).toEqual([]);
  });

  test('extended resource stress: BH -> NS -> SN -> Diagnostic x8 stays bounded', async ({
    page
  }) => {
    test.setTimeout(120_000);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    const baseline = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());

    const sequence: ReadonlyArray<string> = [
      'neutron-star',
      'stellar-explosion',
      'diagnostic',
      'black-hole'
    ];
    let switches = 0;
    for (let cycle = 0; cycle < 8; cycle += 1) {
      for (const dest of sequence) {
        switches += 1;
        await page.evaluate((d) => window.__ATLAS_APP__!.navigate(d), dest);
        await page.waitForTimeout(200);
      }
    }
    expect(switches).toBeGreaterThanOrEqual(32);

    // Whatever wins the retarget race must still complete cleanly.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = window.__ATLAS_APP__!;
            return app && !app.host.state.atlas.transition.active ? 'idle' : 'busy';
          }),
        { timeout: 60_000 }
      )
      .toBe('idle');

    const final = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(final.pendingPrepares).toBe(0);
    expect(final.liveScopeCount).toBeLessThanOrEqual(baseline.liveScopeCount + 1);
    expect(final.totalEstimatedGpuBytes).toBeLessThan(baseline.totalEstimatedGpuBytes * 1.75);
    expect(errors).toEqual([]);
  });
});
