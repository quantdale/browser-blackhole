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

test.describe('SharedPost V2 snapshot and HDR transition lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} captures an FP16 snapshot before transition composite`, async ({
      page
    }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      await page.goto(`/atlas/stellar-explosion?preset=core-collapse&${backend.query}`);
      await waitForArrival(page);

      const result = await page.evaluate(async () => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          governor: { setForcedTier(tier: 'high'): void };
          time: { pause(): void; scrubTo(phase: number): void };
          handleResize(width: number, height: number): void;
          post: {
            captureSnapshot(): {
              renderTarget?: { width: number; height: number; texture?: { type: number } };
            } | null;
            releaseSnapshot(): void;
            getDebugSnapshot?(): Record<string, unknown>;
          };
          kernel: {
            renderer: {
              readRenderTargetPixelsAsync(
                target: unknown,
                x: number,
                y: number,
                width: number,
                height: number
              ): Promise<ArrayLike<number>>;
            } | null;
          };
        };
        host.governor.setForcedTier('high');
        host.time.pause();
        host.time.scrubTo(0.55);
        const rect = document.getElementById('viewport')?.getBoundingClientRect();
        if (rect) host.handleResize(rect.width, rect.height);
        app.captureFrame();
        const before = host.post.getDebugSnapshot?.() ?? null;
        const snapshot = host.post.captureSnapshot();
        const target = snapshot?.renderTarget;
        if (!target || !host.kernel.renderer) throw new Error('snapshot target unavailable');
        const raw = await host.kernel.renderer.readRenderTargetPixelsAsync(
          target,
          Math.floor(target.width / 2),
          Math.floor(target.height / 2),
          1,
          1
        );
        host.post.releaseSnapshot();
        const duringTransition = await new Promise<Record<string, unknown>>((resolve) => {
          app.host.navigate('tidal-disruption', 'solar-canonical');
          const poll = () => {
            const state = app.host.state.atlas.transition;
            if (state.active) {
              app.captureFrame();
              resolve(host.post.getDebugSnapshot?.() ?? {});
            } else setTimeout(poll, 25);
          };
          poll();
        });
        return {
          snapshotType: target.texture?.type ?? null,
          snapshotSize: [target.width, target.height],
          raw: Array.from(raw).slice(0, 4),
          beforeStages: before?.stages ?? [],
          stageTimingMs: before?.stageTimingMs ?? null,
          transitionStages: duringTransition.stages ?? [],
          resourcesAfterRelease: app.host.debugInventory().totalResourceCounts
        };
      });

      console.log(`SHARED_POST_LIFECYCLE ${backend.label}: ${JSON.stringify(result)}`);
      expect(errors).toEqual([]);
      expect(result.snapshotType).toBe(1016);
      expect(result.snapshotSize).toEqual([973, 727]);
      expect(result.raw).toHaveLength(4);
      expect(result.beforeStages as string[]).toContain('transition-composite');
      expect(result.transitionStages as string[]).toContain('transition-composite');
      expect(result.stageTimingMs).toMatchObject({
        depthCopy: expect.any(Number),
        selectiveHighlights: expect.any(Number),
        temporalResolve: expect.any(Number),
        displayPresent: expect.any(Number)
      });
    });
  }
});
