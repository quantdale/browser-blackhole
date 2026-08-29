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

async function temporalMetrics(page: import('@playwright/test').Page, frames: Buffer[]) {
  return page.evaluate(
    async (encodedFrames) => {
      const decoded: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [];
      for (const encoded of encodedFrames) {
        const response = await fetch(`data:image/png;base64,${encoded}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('2D context unavailable');
        context.drawImage(bitmap, 0, 0);
        decoded.push({
          width: bitmap.width,
          height: bitmap.height,
          data: context.getImageData(0, 0, bitmap.width, bitmap.height).data
        });
        bitmap.close();
      }
      let lumaDelta = 0;
      let comparisons = 0;
      let edgeDelta = 0;
      let edges = 0;
      for (let frame = 1; frame < decoded.length; frame += 1) {
        const previous = decoded[frame - 1]!;
        const current = decoded[frame]!;
        for (let y = 1; y < current.height - 1; y += 3) {
          for (let x = 1; x < current.width - 1; x += 3) {
            const offset = (y * current.width + x) * 4;
            const previousLuma =
              0.2126 * (previous.data[offset] ?? 0) +
              0.7152 * (previous.data[offset + 1] ?? 0) +
              0.0722 * (previous.data[offset + 2] ?? 0);
            const currentLuma =
              0.2126 * (current.data[offset] ?? 0) +
              0.7152 * (current.data[offset + 1] ?? 0) +
              0.0722 * (current.data[offset + 2] ?? 0);
            lumaDelta += Math.abs(currentLuma - previousLuma);
            comparisons += 1;

            const left = offset - 4;
            const right = offset + 4;
            const up = offset - current.width * 4;
            const down = offset + current.width * 4;
            const gradient =
              Math.abs((current.data[right] ?? 0) - (current.data[left] ?? 0)) +
              Math.abs((current.data[up] ?? 0) - (current.data[down] ?? 0));
            if (gradient >= 80) {
              edges += 1;
              const previousGradient =
                Math.abs((previous.data[right] ?? 0) - (previous.data[left] ?? 0)) +
                Math.abs((previous.data[up] ?? 0) - (previous.data[down] ?? 0));
              edgeDelta += Math.abs(gradient - previousGradient);
            }
          }
        }
      }
      return {
        frames: decoded.length,
        meanLumaDelta: comparisons > 0 ? lumaDelta / comparisons : 0,
        edgeFlickerPercent: edges > 0 ? (edgeDelta / edges / 255) * 100 : 0
      };
    },
    frames.map((frame) => frame.toString('base64'))
  );
}

test.describe('ParticleService V2 settled subpixel stability', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} keeps subpixel ejecta stable after convergence`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      await page.goto(`/atlas/stellar-explosion?preset=core-collapse&${backend.query}`);
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
        host.time.scrubTo(0.55);
        const rect = document.getElementById('viewport')?.getBoundingClientRect();
        if (rect) host.handleResize(rect.width, rect.height);
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
        .toBeCloseTo(0.55, 4);

      const frames: Buffer[] = [];
      for (let i = 0; i < 10; i += 1) {
        await page.evaluate(() => window.__ATLAS_APP__?.captureFrame());
        frames.push(await page.locator('#viewport').screenshot());
      }
      const metrics = await temporalMetrics(page, frames);
      const debug = await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        const post = (
          app.host.post as unknown as {
            getDebugSnapshot?(): Record<string, unknown>;
          }
        ).getDebugSnapshot?.();
        return {
          destination: app.host.activeDestinationDebugSnapshot(),
          temporal: post?.temporal ?? null
        };
      });

      console.log(`PARTICLE_TEMPORAL ${backend.label}: ${JSON.stringify({ metrics, debug })}`);
      expect(errors).toEqual([]);
      expect(debug.destination).toMatchObject({
        particleWork: {
          drawnCount: expect.any(Number),
          profileQuality: expect.any(Number)
        }
      });
      expect(
        (debug.destination as { particleWork: { drawnCount: number } }).particleWork.drawnCount
      ).toBeGreaterThan(0);
      expect(debug.temporal).toMatchObject({ enabled: true, historyAge: 8 });
      expect(metrics.meanLumaDelta).toBeLessThan(12);
      expect(metrics.edgeFlickerPercent).toBeLessThan(45);
    });
  }
});
