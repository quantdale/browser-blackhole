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

test.describe('Galaxy Collision V2 unresolved environment', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} preserves GC1 tracers and bounds secondary stars`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      await page.goto(`/atlas/galaxy-collision?preset=bridge-tail&${backend.query}`);
      await waitForArrival(page);

      const result = await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          governor: { setForcedTier(tier: 'high'): void };
          time: { pause(): void; scrubTo(phase: number): void };
          handleResize(width: number, height: number): void;
          setExperienceMode(mode: 'scientific' | 'cinematic'): void;
        };
        host.governor.setForcedTier('high');
        host.time.pause();
        host.time.scrubTo(0.5);
        const rect = document.getElementById('viewport')?.getBoundingClientRect();
        if (rect) host.handleResize(rect.width, rect.height);
        host.setExperienceMode('cinematic');
        app.captureFrame();
        const cinematic = app.host.activeDestinationDebugSnapshot();
        host.setExperienceMode('scientific');
        app.captureFrame();
        const scientific = app.host.activeDestinationDebugSnapshot();
        return { cinematic, scientific };
      });

      console.log(`GALAXY_V2 ${backend.label}: ${JSON.stringify(result)}`);
      expect(errors).toEqual([]);
      expect(result.cinematic).toMatchObject({
        authoritativeTracerCount: 1600,
        unresolvedEmitterCapacity: 3200,
        unresolvedEmitterSource: 'deterministic offsets around GC1 tracers'
      });
      expect(
        (result.cinematic as { unresolvedEmitterCount: number }).unresolvedEmitterCount
      ).toBeGreaterThan(0);
      expect(
        (result.cinematic as { unresolvedEmitterCount: number }).unresolvedEmitterCount
      ).toBeLessThanOrEqual(3200);
      expect((result.scientific as { unresolvedEmitterCount: number }).unresolvedEmitterCount).toBe(
        0
      );
    });
  }
});
