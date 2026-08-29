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

test.describe('SharedPost V2 named stages and selective highlights', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} uses selective highlights without changing model state`, async ({
      page
    }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));

      await page.goto(`/atlas/stellar-explosion?preset=core-collapse&${backend.query}`);
      await waitForArrival(page);
      const beforeState = await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          time: { pause(): void; scrubTo(phase: number): void };
          activeDestinationDebugSnapshot(): Record<string, unknown> | null;
        };
        host.time.pause();
        host.time.scrubTo(0.55);
        app.captureFrame();
        return JSON.stringify(host.activeDestinationDebugSnapshot());
      });

      await page.locator('input[value="cinematic"]').check();
      await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
      const cinematicPost = await page.evaluate(() => {
        const post = window.__ATLAS_APP__!.host.post as unknown as {
          getDebugSnapshot?(): Record<string, unknown>;
        };
        return post.getDebugSnapshot?.() ?? null;
      });
      const afterState = await page.evaluate(() =>
        JSON.stringify(window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot())
      );

      console.log(`SHARED_POST_V2 ${backend.label}: ${JSON.stringify(cinematicPost)}`);
      expect(errors.filter((entry) => !/MRT.*blending/i.test(entry))).toEqual([]);
      expect(cinematicPost).not.toBeNull();
      expect(cinematicPost!.stages).toEqual([
        'scene-hdr',
        'temporal-resolve:off',
        'selective-bloom',
        'transition-composite',
        'display-transform',
        'cinematic-grade'
      ]);
      expect(cinematicPost!.bloomEnabled).toBe(true);
      expect(cinematicPost!.highlightRendered).toBe(true);
      expect(cinematicPost!.bloomSource).toBe('selective-emissive');
      expect((cinematicPost!.highlightTarget as { type: number }).type).toBe(1016);
      expect((cinematicPost!.highlightTarget as { colorSpace: string }).colorSpace).toBe('');
      {
        const beforeParsed = JSON.parse(beforeState) as Record<string, unknown>;
        const afterParsed = JSON.parse(afterState) as Record<string, unknown>;
        delete beforeParsed['emissionGainPresented'];
        delete afterParsed['emissionGainPresented'];
        delete beforeParsed['volumeWork'];
        delete afterParsed['volumeWork'];
        expect(afterParsed).toEqual(beforeParsed);
      }

      await page.evaluate(() => {
        const host = window.__ATLAS_APP__!.host as unknown as {
          setExperienceMode(mode: 'scientific' | 'cinematic' | 'debug'): void;
        };
        host.setExperienceMode('scientific');
        window.__ATLAS_APP__!.captureFrame();
      });
      const scientificPost = await page.evaluate(() => {
        const post = window.__ATLAS_APP__!.host.post as unknown as {
          getDebugSnapshot?(): Record<string, unknown>;
        };
        return post.getDebugSnapshot?.() ?? null;
      });
      expect(scientificPost!.bloomEnabled).toBe(false);
      expect(scientificPost!.highlightRendered).toBe(false);
      expect(scientificPost!.bloomSource).toBe('legacy-scene-threshold');
    });
  }
});
