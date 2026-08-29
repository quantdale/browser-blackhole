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
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const camera = window.__ATLAS_APP__!.host.camera;
        let last = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        let stable = 0;
        const deadline = performance.now() + 15_000;
        const poll = () => {
          const current = camera.position;
          const delta = Math.hypot(current.x - last.x, current.y - last.y, current.z - last.z);
          last = { x: current.x, y: current.y, z: current.z };
          stable = delta < 1e-4 ? stable + 1 : 0;
          if (stable >= 3 || performance.now() >= deadline) resolve();
          else setTimeout(poll, 100);
        };
        setTimeout(poll, 100);
      })
  );
}

async function lumaDelta(
  page: import('@playwright/test').Page,
  dataUrls: string[]
): Promise<number> {
  if (dataUrls.length < 2) return 0;
  return page.evaluate(async (sources) => {
    const frames: ImageData[] = [];
    for (const source of sources) {
      const response = await fetch(source);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D context unavailable for temporal stability');
      context.drawImage(bitmap, 0, 0);
      frames.push(context.getImageData(0, 0, bitmap.width, bitmap.height));
      bitmap.close();
    }
    let sum = 0;
    let count = 0;
    for (let frame = 1; frame < frames.length; frame++) {
      const previous = frames[frame - 1]!.data;
      const current = frames[frame]!.data;
      for (let i = 0; i < current.length; i += 8) {
        const previousLuma =
          0.2126 * (previous[i] ?? 0) +
          0.7152 * (previous[i + 1] ?? 0) +
          0.0722 * (previous[i + 2] ?? 0);
        const currentLuma =
          0.2126 * (current[i] ?? 0) +
          0.7152 * (current[i + 1] ?? 0) +
          0.0722 * (current[i + 2] ?? 0);
        sum += Math.abs(currentLuma - previousLuma);
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }, dataUrls);
}

test.describe('bounded temporal reconstruction', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} converges settled frames and rejects discontinuities`, async ({
      page
    }) => {
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

      const frames: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
        const image = await page.locator('#viewport').screenshot();
        frames.push(`data:image/png;base64,${image.toString('base64')}`);
      }
      const settledDelta = await lumaDelta(page, frames);
      const post = await page.evaluate(() => {
        const value = window.__ATLAS_APP__!.host.post as unknown as {
          getDebugSnapshot?(): Record<string, unknown>;
        };
        return value.getDebugSnapshot?.() ?? null;
      });
      const temporal = post?.temporal as {
        enabled: boolean;
        valid: boolean;
        historyAge: number;
        historyFrames: number;
        resolvedFrames: number;
        allocatedTargetCount: number;
        lastResetReason: string;
        previousCameraMatrix: number[] | null;
        currentCameraMatrix: number[] | null;
      };

      console.log(
        `TEMPORAL_SETTLE ${backend.label}: delta=${settledDelta.toFixed(4)} ` +
          JSON.stringify(temporal)
      );
      expect(errors).toEqual([]);
      expect(temporal.enabled).toBe(true);
      expect(temporal.valid).toBe(true);
      expect(temporal.historyAge).toBe(8);
      expect(temporal.historyFrames).toBe(8);
      expect(temporal.resolvedFrames).toBeGreaterThanOrEqual(8);
      expect(temporal.allocatedTargetCount).toBe(2);
      expect(temporal.previousCameraMatrix).not.toBeNull();
      expect(temporal.currentCameraMatrix).not.toBeNull();
      expect(settledDelta).toBeLessThan(8);

      await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        app.host.time.scrubTo(0.2);
        app.captureFrame();
      });
      const scrubTemporal = await page.evaluate(() => {
        const post = window.__ATLAS_APP__!.host.post as unknown as {
          getDebugSnapshot?(): Record<string, unknown>;
        };
        return post.getDebugSnapshot?.().temporal as {
          historyAge: number;
          lastResetReason: string;
          recentResetReasons: string[];
        };
      });
      console.log(`TEMPORAL_SCRUB ${backend.label}: ${JSON.stringify(scrubTemporal)}`);
      expect(scrubTemporal.recentResetReasons).toContain('timeline-discontinuity');
      expect(scrubTemporal.historyAge).toBe(1);

      await page.evaluate(() => {
        const host = window.__ATLAS_APP__!.host as unknown as {
          cameraRig: {
            getOrbit(): { azimuthDeg: number; polarDeg: number; distance: number };
            setOrbit(azimuth: number, polar: number, distance: number): void;
          };
        };
        const orbit = host.cameraRig.getOrbit();
        host.cameraRig.setOrbit(orbit.azimuthDeg + 35, orbit.polarDeg, orbit.distance * 1.8);
        window.__ATLAS_APP__!.captureFrame();
      });
      const cutTemporal = await page.evaluate(() => {
        const post = window.__ATLAS_APP__!.host.post as unknown as {
          getDebugSnapshot?(): Record<string, unknown>;
        };
        return post.getDebugSnapshot?.().temporal as {
          historyAge: number;
          lastResetReason: string;
          recentResetReasons: string[];
        };
      });
      expect(cutTemporal.recentResetReasons).toContain('camera-cut');
      expect(cutTemporal.historyAge).toBe(1);

      await page.evaluate(() => {
        const host = window.__ATLAS_APP__!.host as unknown as {
          handleResize(width: number, height: number): void;
        };
        host.handleResize(900, 600);
        window.__ATLAS_APP__!.captureFrame();
      });
      const resizeTemporal = await page.evaluate(() => {
        const post = window.__ATLAS_APP__!.host.post as unknown as {
          getDebugSnapshot?(): Record<string, unknown>;
        };
        return post.getDebugSnapshot?.().temporal as {
          historyAge: number;
          lastResetReason: string;
          recentResetReasons: string[];
        };
      });
      expect(resizeTemporal.recentResetReasons).toContain('resize');
      expect(resizeTemporal.historyAge).toBe(1);
    });
  }
});
