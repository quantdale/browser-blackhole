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

test.describe('Celestial Environment V2', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} adds deterministic HDR environment detail to lensed rays`, async ({
      page
    }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      await page.goto(`/atlas/black-hole?preset=classic&${backend.query}`);
      await waitForArrival(page);

      const result = await page.evaluate(async () => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          governor: { setForcedTier(tier: 'medium'): void };
          time: { pause(): void; scrubTo(phase: number): void };
          handleResize(width: number, height: number): void;
          setExperienceMode(mode: 'scientific' | 'cinematic'): void;
          post: { getHdrTarget(): { renderTarget?: { width: number; height: number } } | null };
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
          services: { lensing: { getDebugSnapshot?(): Record<string, unknown> } };
        };
        const renderer = host.kernel.renderer;
        if (!renderer) throw new Error('environment HDR probe renderer unavailable');
        host.governor.setForcedTier('medium');
        host.time.pause();
        host.time.scrubTo(0.2);
        const rect = document.getElementById('viewport')?.getBoundingClientRect();
        if (rect) host.handleResize(rect.width, rect.height);

        const read = async (mode: 'scientific' | 'cinematic') => {
          host.setExperienceMode(mode);
          app.captureFrame();
          const target = host.post.getHdrTarget()?.renderTarget;
          if (!target) throw new Error('environment HDR probe target unavailable');
          const width = Math.min(32, target.width);
          const height = Math.min(32, target.height);
          const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
          const decodeHalf = (value: number): number => {
            const sign = (value & 0x8000) !== 0 ? -1 : 1;
            const exponent = (value >>> 10) & 0x1f;
            const fraction = value & 0x3ff;
            if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
            if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN;
            return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
          };
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) {
            const value = data instanceof Uint16Array ? decodeHalf(data[i] ?? 0) : Number(data[i]);
            if (Number.isFinite(value)) sum += value;
          }
          return { sum, pixels: width * height };
        };

        const scientific = await read('scientific');
        const cinematic = await read('cinematic');
        return {
          scientific,
          cinematic,
          lensing: host.services.lensing.getDebugSnapshot?.() ?? null
        };
      });

      console.log(`ENVIRONMENT_V2 ${backend.label}: ${JSON.stringify(result)}`);
      expect(errors).toEqual([]);
      expect(result.lensing).toMatchObject({
        environmentDetail: expect.any(Number),
        environmentLayer: 'cinematic-diffuse+dense-stars+dust'
      });
      expect((result.lensing as { environmentDetail: number }).environmentDetail).toBeGreaterThan(
        0
      );
      expect(result.cinematic.sum).toBeGreaterThan(result.scientific.sum);
    });
  }
});
