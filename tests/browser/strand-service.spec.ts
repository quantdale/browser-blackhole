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

test.describe('TDE StrandService V2', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} uses the tube at high quality and ribbon fallback below it`, async ({
      page
    }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      await page.goto(`/atlas/tidal-disruption?preset=solar-canonical&${backend.query}`);
      await waitForArrival(page);

      const high = await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          governor: { setForcedTier(tier: 'high'): void };
          time: { pause(): void; scrubTo(phase: number): void };
          handleResize(width: number, height: number): void;
        };
        host.governor.setForcedTier('high');
        host.time.pause();
        host.time.scrubTo(0.36);
        const rect = document.getElementById('viewport')?.getBoundingClientRect();
        if (rect) host.handleResize(rect.width, rect.height);
        app.captureFrame();
        return app.host.activeDestinationDebugSnapshot();
      });
      const low = await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          governor: { setForcedTier(tier: 'low'): void };
          handleResize(width: number, height: number): void;
        };
        host.governor.setForcedTier('low');
        const rect = document.getElementById('viewport')?.getBoundingClientRect();
        if (rect) host.handleResize(rect.width, rect.height);
        app.captureFrame();
        return app.host.activeDestinationDebugSnapshot();
      });

      console.log(`STRAND_V2 ${backend.label}: ${JSON.stringify({ high, low })}`);
      expect(errors).toEqual([]);
      expect(high?.strandRepresentation).toBe('tube');
      expect(high?.strandQuality).toBeGreaterThanOrEqual(0.5);
      expect(
        (high?.spineBoundPoints as number) + (high?.spineUnboundPoints as number)
      ).toBeGreaterThan(1);
      expect(low?.strandRepresentation).toBe('ribbon-fallback');
    });
  }
});
