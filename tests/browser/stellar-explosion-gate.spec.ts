import { expect, test } from '@playwright/test';

import './support/atlasHook.js';

const BACKENDS = [
  { label: 'webgpu', query: 'backend=webgpu' },
  { label: 'webgl2', query: 'backend=webgl2' }
] as const;

const SCENARIOS = ['core-collapse', 'hypernova', 'long-grb-on-axis', 'long-grb-off-axis'] as const;

async function waitForArrival(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#scene').waitFor({ state: 'attached', timeout: 30_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          window.__ATLAS_APP__?.host.state.atlas.transition.active === false
            ? 'arrived'
            : 'transitioning'
        ),
      { timeout: 60_000, intervals: [250] }
    )
    .toBe('arrived');
}

async function pin(
  page: import('@playwright/test').Page,
  tier: 'low' | 'medium' | 'high' | 'ultra'
) {
  await page.locator('input[value="cinematic"]').check();
  await page.evaluate((selectedTier) => {
    const app = window.__ATLAS_APP__!;
    const host = app.host as unknown as {
      governor: { setForcedTier(value: 'low' | 'medium' | 'high' | 'ultra'): void };
      time: { pause(): void; scrubTo(value: number): void };
      handleResize(width: number, height: number): void;
    };
    host.governor.setForcedTier(selectedTier);
    host.time.pause();
    host.time.scrubTo(0.55);
    const rect = document.getElementById('viewport')?.getBoundingClientRect();
    if (rect) host.handleResize(rect.width, rect.height);
    app.captureFrame();
  }, tier);
}

async function screenshotMetrics(page: import('@playwright/test').Page) {
  const screenshot = await page.locator('#viewport').screenshot();
  return page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D context unavailable');
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    let lumaSum = 0;
    let saturated = 0;
    let crushed = 0;
    for (let i = 0; i < width * height; i += 1) {
      const offset = i * 4;
      const value =
        0.2126 * (data[offset] ?? 0) +
        0.7152 * (data[offset + 1] ?? 0) +
        0.0722 * (data[offset + 2] ?? 0);
      lumaSum += value;
      if (Math.max(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0) >= 250) {
        saturated += 1;
      }
      if (value <= 3) crushed += 1;
    }
    return {
      meanLuma: lumaSum / (width * height),
      saturationPercent: (saturated / (width * height)) * 100,
      blackCrushPercent: (crushed / (width * height)) * 100
    };
  }, screenshot.toString('base64'));
}

test.describe('Stellar Explosion full-quality vertical slice', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} accepts authored scenarios and the full quality matrix`, async ({
      page
    }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));

      const scenarioRows: Array<Record<string, unknown>> = [];
      for (const scenario of SCENARIOS) {
        await page.goto(`/atlas/stellar-explosion?preset=${scenario}&${backend.query}`);
        await waitForArrival(page);
        await pin(page, 'high');
        const [metrics, debug] = await Promise.all([
          screenshotMetrics(page),
          page.evaluate(() => ({
            destination: window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot?.() ?? null,
            post:
              (
                window.__ATLAS_APP__!.host.post as unknown as {
                  getDebugSnapshot?(): Record<string, unknown>;
                }
              ).getDebugSnapshot?.() ?? null
          }))
        ]);
        scenarioRows.push({ scenario, metrics, debug });
        expect(metrics.meanLuma, `${scenario} should not render black`).toBeGreaterThan(1);
        expect(
          metrics.saturationPercent,
          `${scenario} should retain highlight headroom`
        ).toBeLessThan(40);
        expect(metrics.blackCrushPercent, `${scenario} should retain sparse detail`).toBeLessThan(
          99.9
        );
        expect(debug.destination).toMatchObject({
          volumeWork: { intermediateFormat: 'rgba16f', hdrIntermediate: true },
          particleWork: { profile: 'ejecta-streak' },
          shellDetailRepresentation: 'structured-shock-skin'
        });
      }

      const tierRows: Array<Record<string, unknown>> = [];
      for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
        await page.goto(`/atlas/stellar-explosion?preset=core-collapse&${backend.query}`);
        await waitForArrival(page);
        await pin(page, tier);
        const row = await page.evaluate(() => {
          const app = window.__ATLAS_APP__!;
          const post =
            (
              app.host.post as unknown as {
                getDebugSnapshot?(): Record<string, unknown>;
              }
            ).getDebugSnapshot?.() ?? {};
          return {
            destination: app.host.activeDestinationDebugSnapshot?.() ?? null,
            temporal: post.temporal ?? null,
            stages: post.stages ?? []
          };
        });
        tierRows.push({ tier, ...row });
        expect(row.destination).toMatchObject({ tier });
        if (tier === 'high' || tier === 'ultra') {
          expect((row.temporal as { enabled: boolean }).enabled).toBe(true);
          expect(row.stages).toContain('temporal-resolve');
        } else {
          expect((row.temporal as { enabled: boolean }).enabled).toBe(false);
          expect(row.stages).toContain('temporal-resolve:off');
        }
      }

      console.log(
        `STELLAR_GATE_BROWSER ${backend.label}: ${JSON.stringify({ scenarioRows, tierRows })}`
      );
      expect(errors).toEqual([]);
    });
  }
});
