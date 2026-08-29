import { expect, test } from '@playwright/test';

import './support/atlasHook.js';

const BACKENDS = [
  { label: 'webgpu', query: 'backend=webgpu' },
  { label: 'webgl2', query: 'backend=webgl2' }
] as const;

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

async function pin(page: import('@playwright/test').Page, phase: number): Promise<void> {
  await page.locator('input[value="cinematic"]').check();
  await page.evaluate((phaseValue) => {
    const app = window.__ATLAS_APP__!;
    const host = app.host as unknown as {
      governor: { setForcedTier(tier: 'high'): void };
      time: { pause(): void; scrubTo(phase: number): void };
      handleResize(width: number, height: number): void;
    };
    host.governor.setForcedTier('high');
    host.time.pause();
    host.time.scrubTo(phaseValue);
    const rect = document.getElementById('viewport')?.getBoundingClientRect();
    if (rect) host.handleResize(rect.width, rect.height);
    app.captureFrame();
  }, phase);
}

test.describe('Compact Merger and Neutron Star V2', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} keeps compact surfaces and V2 ejecta truthful`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));

      const compactRows: Array<Record<string, unknown>> = [];
      for (const [preset, phase] of [
        ['equal-mass-nsns', 0.7],
        ['short-grb-on-axis', 0.54]
      ] as const) {
        await page.goto(`/atlas/compact-merger?preset=${preset}&${backend.query}`);
        await waitForArrival(page);
        await pin(page, phase);
        compactRows.push({
          preset,
          debug: await page.evaluate(() =>
            window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot()
          )
        });
      }

      const neutronRows: Array<Record<string, unknown>> = [];
      for (const [preset, phase] of [
        ['surface', 0.5],
        ['pulsar', 0.5],
        ['magnetar', 0.5]
      ] as const) {
        await page.goto(`/atlas/neutron-star?preset=${preset}&${backend.query}`);
        await waitForArrival(page);
        await pin(page, phase);
        neutronRows.push({
          preset,
          debug: await page.evaluate(() =>
            window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot()
          )
        });
      }

      console.log(
        `COMPACT_NS_V2 ${backend.label}: ${JSON.stringify({ compactRows, neutronRows })}`
      );
      expect(errors).toEqual([]);
      for (const row of compactRows) {
        expect(row.debug).toMatchObject({
          volumeWork: { intermediateFormat: 'rgba16f', hdrIntermediate: true },
          particleWork: { profile: 'ejecta-streak' }
        });
      }
      for (const row of neutronRows) {
        expect(row.debug).toMatchObject({
          surfaceLensingWired: true,
          rayClassificationPacking: {
            surfaceHit: 11,
            escaped: 12
          }
        });
      }
    });
  }
});
