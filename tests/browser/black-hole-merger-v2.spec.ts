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

test.describe('Black-Hole Merger vacuum presentation V2', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} uses trajectory-tied caustics and no remnant disk`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      await page.goto(`/atlas/black-hole-merger?preset=sxs-bbh-0001-inspiral&${backend.query}`);
      await waitForArrival(page);

      const result = await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          governor: { setForcedTier(tier: 'high'): void };
          time: { pause(): void; scrubTo(phase: number): void };
          handleResize(width: number, height: number): void;
        };
        host.governor.setForcedTier('high');
        host.time.pause();
        host.time.scrubTo(0.05);
        const rect = document.getElementById('viewport')?.getBoundingClientRect();
        if (rect) host.handleResize(rect.width, rect.height);
        const mode = app.host as unknown as {
          setExperienceMode(value: 'cinematic'): void;
        };
        mode.setExperienceMode('cinematic');
        app.captureFrame();
        const inspiral = app.host.activeDestinationDebugSnapshot();
        host.time.scrubTo(0.67);
        app.captureFrame();
        const ringdown = app.host.activeDestinationDebugSnapshot();
        return { inspiral, ringdown };
      });

      console.log(`BBH_V2 ${backend.label}: ${JSON.stringify(result)}`);
      expect(errors).toEqual([]);
      expect(result.inspiral).toMatchObject({
        lensingRepresentation: 'trajectory-tied-vacuum-caustics'
      });
      expect(result.ringdown).toMatchObject({
        lensingRepresentation: 'validated-kerr-remnant',
        wavefrontRepresentation: 'illustrative-spacetime-wavefront',
        remnantDiskEnabled: false
      });
    });
  }
});
