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

test.describe('Volumetrics V2 depth composition', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} keeps a foreground remnant over the ejecta shell`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      await page.goto(`/atlas/compact-merger?preset=equal-mass-nsns&${backend.query}`);
      await waitForArrival(page);
      await page.locator('input[value="cinematic"]').check();

      await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          governor: { setForcedTier(tier: 'high'): void };
          time: { pause(): void; scrubTo(phase: number): void };
          handleResize(width: number, height: number): void;
        };
        host.governor.setForcedTier('high');
        host.time.pause();
        host.time.scrubTo(0.7);
        const rect = document.getElementById('viewport')?.getBoundingClientRect();
        if (rect) host.handleResize(rect.width, rect.height);
        app.captureFrame();
        app.captureFrame();
      });
      await expect
        .poll(
          () => page.evaluate(() => window.__ATLAS_APP__?.host.time.snapshot().simulationPhase),
          {
            timeout: 15_000,
            intervals: [100]
          }
        )
        .toBeCloseTo(0.7, 4);

      const frame = await page.locator('#viewport').screenshot();
      const pixels = await page.evaluate(async (base64) => {
        const response = await fetch(`data:image/png;base64,${base64}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('2D context unavailable');
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const lumaAt = (x: number, y: number): number => {
          const offset = (y * bitmap.width + x) * 4;
          return (
            0.2126 * (data[offset] ?? 0) +
            0.7152 * (data[offset + 1] ?? 0) +
            0.0722 * (data[offset + 2] ?? 0)
          );
        };
        const distinct = new Set<string>();
        let centralMaxLuma = 0;
        let shellMaxLuma = 0;
        let visiblePixels = 0;
        for (let y = 0; y < bitmap.height; y += 16) {
          for (let x = 0; x < bitmap.width; x += 16) {
            const offset = (y * bitmap.width + x) * 4;
            distinct.add(`${data[offset] ?? 0},${data[offset + 1] ?? 0},${data[offset + 2] ?? 0}`);
            const luma = lumaAt(x, y);
            if (luma > 8) visiblePixels += 1;
            if (
              x > bitmap.width * 0.4 &&
              x < bitmap.width * 0.6 &&
              y > bitmap.height * 0.4 &&
              y < bitmap.height * 0.6
            ) {
              centralMaxLuma = Math.max(centralMaxLuma, luma);
            } else {
              shellMaxLuma = Math.max(shellMaxLuma, luma);
            }
          }
        }
        bitmap.close();
        return {
          centralMaxLuma,
          shellMaxLuma,
          distinct: distinct.size,
          visiblePixels
        };
      }, frame.toString('base64'));
      const debug = await page.evaluate(() =>
        window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot()
      );
      const post = await page.evaluate(() => {
        const snapshot = (
          window.__ATLAS_APP__!.host.post as unknown as {
            getDebugSnapshot?(): Record<string, unknown>;
          }
        ).getDebugSnapshot?.();
        return snapshot ?? null;
      });

      console.log(
        `VOLUME_DEPTH_COMPOSITION ${backend.label}: ${JSON.stringify({ debug, post, pixels })}`
      );
      expect(errors).toEqual([]);
      expect(debug).toMatchObject({
        remnantVisible: true,
        volumeVisible: true,
        ejectaShellSkinVisible: true,
        volumeWork: {
          intermediateFormat: 'rgba16f',
          depthAwareUpsample: true,
          depthClipActive: true
        }
      });
      expect(post).toMatchObject({ volumeDepthHistory: { valid: true } });
      expect(pixels.distinct).toBeGreaterThan(8);
      expect(pixels.centralMaxLuma).toBeGreaterThan(8);
      expect(pixels.shellMaxLuma).toBeGreaterThan(0);
      expect(pixels.visiblePixels).toBeGreaterThan(20);
    });
  }
});
