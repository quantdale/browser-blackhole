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
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          return app?.host.state.atlas.transition.active === false ? 'arrived' : 'transitioning';
        }),
      { timeout: 60_000, intervals: [250] }
    )
    .toBe('arrived');
}

test.describe('HDR continuity through volume and SharedPost', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} preserves radiance above 1 through the volume intermediate`, async ({
      page
    }) => {
      const consoleErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(`PAGE_ERROR: ${error.message}`));

      await page.goto(`/atlas/stellar-explosion?preset=core-collapse&${backend.query}`);
      await waitForArrival(page);

      const result = await page.evaluate(async () => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          activePrepared: { scene: { add(object: unknown): void; remove(object: unknown): void } };
          services: {
            volumes: {
              createVolume(config: {
                bounds: { kind: 'sphere'; center: [number, number, number]; radius: number };
                density: () => number;
                baseMaxSteps: number;
                halfResolution: boolean;
                earlyAlphaTermination: boolean;
                temporalJitter: boolean;
              }): {
                object3d(): unknown;
                getIntermediateRenderTargetForTest?(): {
                  width: number;
                  height: number;
                } | null;
                getDebugSnapshot?(): Record<string, unknown>;
                dispose(): void;
              };
            };
          };
          post: { getHdrTarget(): { renderTarget?: unknown } | null };
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
        const renderer = host.kernel.renderer;
        if (!renderer) throw new Error('renderer unavailable for HDR probe');

        const scene = host.activePrepared?.scene;
        if (!scene) throw new Error('active scene unavailable for HDR probe');
        const decodeHalf = (value: number): number => {
          const sign = (value & 0x8000) !== 0 ? -1 : 1;
          const exponent = (value >>> 10) & 0x1f;
          const fraction = value & 0x3ff;
          if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
          if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN;
          return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
        };
        const decodeChannels = (data: ArrayLike<number>): number[] => {
          const values = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
          return data instanceof Uint16Array ? values.map(decodeHalf) : values;
        };

        const readProbe = async (radiance: number) => {
          const volume = host.services.volumes.createVolume({
            // This probe-only constant distinguishes an LDR clamp from the
            // required HDR transport; it is not destination physics.
            bounds: { kind: 'sphere', center: [0, 0, 0], radius: 200 },
            density: () => radiance,
            baseMaxSteps: 16,
            halfResolution: true,
            earlyAlphaTermination: false,
            temporalJitter: false
          });
          scene.add(volume.object3d());
          app.captureFrame();

          const volumeTarget = volume.getIntermediateRenderTargetForTest?.();
          const hdrTexture = host.post.getHdrTarget();
          const hdrTarget = hdrTexture?.renderTarget;
          if (!volumeTarget || !hdrTarget) {
            throw new Error(
              `HDR probe targets unavailable: volume=${String(!!volumeTarget)} ` +
                `texture=${String(!!hdrTexture)} target=${String(!!hdrTarget)} ` +
                `volumeSnapshot=${JSON.stringify(volume.getDebugSnapshot?.() ?? {})}`
            );
          }
          const volumeData = await renderer.readRenderTargetPixelsAsync(
            volumeTarget,
            Math.floor(volumeTarget.width / 2),
            Math.floor(volumeTarget.height / 2),
            1,
            1
          );
          const hdrWidth = (hdrTarget as { width: number }).width;
          const hdrHeight = (hdrTarget as { height: number }).height;
          const hdrData = await renderer.readRenderTargetPixelsAsync(
            hdrTarget,
            Math.floor(hdrWidth / 2),
            Math.floor(hdrHeight / 2),
            1,
            1
          );
          const volumeChannels = decodeChannels(volumeData);
          const hdrChannels = decodeChannels(hdrData);
          const snapshot = volume.getDebugSnapshot?.() ?? {};
          const volumeTargetType = (volumeTarget as { texture?: { type?: number } }).texture?.type;
          const hdrTargetType = (hdrTarget as { textures?: Array<{ type?: number }> }).textures?.[0]
            ?.type;
          scene.remove(volume.object3d());
          volume.dispose();
          return {
            volumeSample: volumeChannels[0] ?? 0,
            hdrSample: hdrChannels[0] ?? 0,
            volumeChannels,
            hdrChannels,
            intermediateFormat: snapshot['intermediateFormat'],
            intermediateType: snapshot['intermediateType'],
            hdrIntermediate: snapshot['hdrIntermediate'],
            volumeTargetType,
            hdrTargetType
          };
        };

        const one = await readProbe(1);
        const four = await readProbe(4);
        return {
          one,
          four
        };
      });

      expect(consoleErrors, `console errors during ${backend.label} HDR probe`).toEqual([]);
      console.log(`HDR_PROBE ${backend.label}: ${JSON.stringify(result)}`);
      expect(result.four.intermediateFormat).toBe('rgba16f');
      expect(result.four.hdrIntermediate).toBe(true);
      expect(result.four.volumeSample, JSON.stringify(result)).toBeGreaterThan(1.1);
      expect(result.four.hdrSample, JSON.stringify(result)).toBeGreaterThan(1.1);
      expect(result.four.volumeSample, JSON.stringify(result)).toBeGreaterThan(
        result.one.volumeSample * 2
      );
      expect(result.four.hdrSample, JSON.stringify(result)).toBeGreaterThan(
        result.one.hdrSample * 2
      );
    });
  }
});
