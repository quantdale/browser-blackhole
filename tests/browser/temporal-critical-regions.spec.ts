import { expect, test } from '@playwright/test';

import './support/atlasHook.js';

const BACKENDS = [
  { label: 'webgpu', query: 'backend=webgpu' },
  { label: 'webgl2', query: 'backend=webgl2' }
] as const;

const REGIONS = [
  { id: 'black-hole-critical-curve', url: '/atlas/black-hole?preset=classic', phase: 0.2 },
  { id: 'neutron-star-limb', url: '/atlas/neutron-star?preset=surface', phase: 0.5 },
  {
    id: 'stellar-volume-edge',
    url: '/atlas/stellar-explosion?preset=core-collapse',
    phase: 0.55
  },
  { id: 'tde-strand-edge', url: '/atlas/tidal-disruption?preset=solar-canonical', phase: 0.36 }
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

async function lumaAndEdgeFlicker(page: import('@playwright/test').Page, frames: string[]) {
  return page.evaluate(async (sources) => {
    const decoded: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [];
    for (const source of sources) {
      const response = await fetch(source);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D context unavailable for temporal critical-region test');
      context.drawImage(bitmap, 0, 0);
      decoded.push({
        width: bitmap.width,
        height: bitmap.height,
        data: context.getImageData(0, 0, bitmap.width, bitmap.height).data
      });
      bitmap.close();
    }
    let luma = 0;
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
          luma += Math.abs(currentLuma - previousLuma);
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
      meanLumaDelta: comparisons > 0 ? luma / comparisons : 0,
      edgeFlickerPercent: edges > 0 ? (edgeDelta / edges / 255) * 100 : 0
    };
  }, frames);
}

test.describe('Temporal reconstruction critical regions', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(300_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} settles critical curves, limbs, volumes and strands`, async ({
      page
    }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      const rows: Array<Record<string, unknown>> = [];

      for (const region of REGIONS) {
        await page.goto(`${region.url}${region.url.includes('?') ? '&' : '?'}${backend.query}`);
        await waitForArrival(page);
        await page.locator('input[value="cinematic"]').check();
        await page.evaluate((phase) => {
          const app = window.__ATLAS_APP__!;
          const host = app.host as unknown as {
            governor: { setForcedTier(tier: 'high'): void };
            time: { pause(): void; scrubTo(value: number): void };
            handleResize(width: number, height: number): void;
          };
          host.governor.setForcedTier('high');
          host.time.pause();
          host.time.scrubTo(phase);
          const rect = document.getElementById('viewport')?.getBoundingClientRect();
          if (rect) host.handleResize(rect.width, rect.height);
          app.captureFrame();
        }, region.phase);

        const frames: string[] = [];
        for (let i = 0; i < 10; i += 1) {
          await page.evaluate(() => window.__ATLAS_APP__?.captureFrame());
          const image = await page.locator('#viewport').screenshot();
          frames.push(`data:image/png;base64,${image.toString('base64')}`);
        }
        const flicker = await lumaAndEdgeFlicker(page, frames);
        const temporal = await page.evaluate(() => {
          const post = window.__ATLAS_APP__!.host.post as unknown as {
            getDebugSnapshot?(): Record<string, unknown>;
          };
          return post.getDebugSnapshot?.().temporal ?? null;
        });
        rows.push({ region: region.id, flicker, temporal });
        expect((temporal as { enabled: boolean }).enabled, region.id).toBe(true);
        expect((temporal as { historyAge: number }).historyAge, region.id).toBe(8);
        expect(flicker.meanLumaDelta, `${region.id} luma`).toBeLessThan(12);
        expect(flicker.edgeFlickerPercent, `${region.id} edge`).toBeLessThan(45);
      }

      console.log(`TEMPORAL_CRITICAL ${backend.label}: ${JSON.stringify(rows)}`);
      expect(errors).toEqual([]);
    });
  }
});
