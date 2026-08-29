import { expect, test } from '@playwright/test';

import { sampleFrameViaScreenshot, type PixelSampleView } from './support/appHarness.js';

async function waitForAtlasArrival(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#scene').waitFor({ state: 'attached', timeout: 10_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          return app.host.state.atlas.transition.active ? 'transitioning' : 'arrived';
        }),
      { timeout: 30_000, intervals: [200] }
    )
    .toBe('arrived');
}

function totalSampleDelta(before: PixelSampleView[], after: PixelSampleView[]): number {
  return before.reduce((sum, sample, index) => {
    const next = after[index];
    if (!next) return sum;
    return (
      sum + Math.abs(sample.r - next.r) + Math.abs(sample.g - next.g) + Math.abs(sample.b - next.b)
    );
  }, 0);
}

test.describe('cinematic visual fidelity', () => {
  test('Cinematic display finishing changes presentation without changing model state', async ({
    page
  }) => {
    await page.goto('/atlas/stellar-explosion?preset=hypernova');
    await waitForAtlasArrival(page);

    const beforeState = await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host;
      host.time.pause();
      host.time.scrubTo(0.55);
      window.__ATLAS_APP__!.captureFrame();
      return JSON.stringify(host.activeDestinationDebugSnapshot());
    });
    const before = await sampleFrameViaScreenshot(page);

    await page.locator('input[value="cinematic"]').check();
    await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    const after = await sampleFrameViaScreenshot(page);
    const afterState = await page.evaluate(() =>
      JSON.stringify(window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot())
    );

    expect(
      totalSampleDelta(before, after),
      'cinematic mode must affect presented pixels'
    ).toBeGreaterThan(20);
    const beforeParsed = JSON.parse(beforeState) as Record<string, unknown>;
    const afterParsed = JSON.parse(afterState) as Record<string, unknown>;
    delete beforeParsed['emissionGainPresented'];
    delete afterParsed['emissionGainPresented'];
    delete beforeParsed['volumeWork'];
    delete afterParsed['volumeWork'];
    expect(afterParsed, 'cinematic display must not mutate model/debug state').toEqual(
      beforeParsed
    );
  });

  test('the first slice exposes governed work and static particle semantics', async ({ page }) => {
    await page.goto('/atlas/stellar-explosion?preset=hypernova');
    await waitForAtlasArrival(page);
    await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host;
      host.governor.setForcedTier('low');
      host.time.pause();
      host.time.scrubTo(0.55);
      window.__ATLAS_APP__!.captureFrame();
    });
    const explosion = await page.evaluate(() =>
      window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot()
    );
    const volumeWork = explosion?.volumeWork as { baseMaxSteps: number; activeSteps: number };
    const particleWork = explosion?.particleWork as {
      activity: string;
      simulationUpdates: number;
    };
    expect(volumeWork.activeSteps).toBeLessThan(volumeWork.baseMaxSteps);
    expect(particleWork.activity).toBe('dynamic');
    expect(particleWork.simulationUpdates).toBe(0);

    await page.goto('/atlas/quasar-agn?preset=quasar-reference');
    await waitForAtlasArrival(page);
    await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host;
      host.time.pause();
      window.__ATLAS_APP__!.captureFrame();
    });
    const agn = await page.evaluate(() =>
      window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot()
    );
    const agnParticles = agn?.particleWork as {
      host: { activity: string; simulationUpdates: number };
      knots: { activity: string; simulationUpdates: number };
    };
    expect(agnParticles.host.activity).toBe('static');
    expect(agnParticles.knots.activity).toBe('static');
    expect(agnParticles.host.simulationUpdates).toBe(0);
    expect(agnParticles.knots.simulationUpdates).toBe(0);
  });
});
