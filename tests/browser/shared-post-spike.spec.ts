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

test.describe('pinned r185 SharedPost architecture spike', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} RenderPipeline and named MRT prototype`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      await page.goto(`/atlas/stellar-explosion?preset=core-collapse&${backend.query}`);
      await waitForArrival(page);

      const result = await page.evaluate(async () => {
        const app = window.__ATLAS_APP__!;
        app.captureFrame();
        const host = app.host as unknown as {
          post: {
            runArchitectureSpikeForTest?(): Promise<Record<string, unknown>>;
          };
        };
        return (await host.post.runArchitectureSpikeForTest?.()) ?? { status: 'missing' };
      });

      console.log(`SHARED_POST_SPIKE ${backend.label}: ${JSON.stringify(result)}`);
      expect(errors.filter((entry) => !/MRT.*blending/i.test(entry))).toEqual([]);
      expect(result.status).toBe('complete');
      expect((result.api as Record<string, unknown>).renderPipeline).toBe('r185 RenderPipeline');
      expect((result.api as Record<string, unknown>).mrt).toBe('r185 MRTNode/mrt()');

      const pipeline = result.renderPipeline as Record<string, unknown>;
      expect(pipeline.status, JSON.stringify(result)).toBe('pass');
      expect(pipeline.sourceType).toBe(pipeline.copyType);
      expect((pipeline.sourceChannels as number[])[0]).toBe((pipeline.copyChannels as number[])[0]);

      const mrt = result.mrt as Record<string, unknown>;
      expect(mrt.status, JSON.stringify(result)).toBe('pass');
      expect(mrt.textureNames).toEqual(['output', 'emissive']);
      expect((mrt.outputChannels as number[])[0], JSON.stringify(result)).not.toBe(
        (mrt.emissiveChannels as number[])[0]
      );
      expect((mrt.outputChannels as number[])[3], JSON.stringify(result)).toBe(
        (mrt.emissiveChannels as number[])[3]
      );
    });
  }
});
