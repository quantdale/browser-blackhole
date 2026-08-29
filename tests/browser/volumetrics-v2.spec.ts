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

test.describe('Volumetrics V2 detail and composition', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} compiles structured detail and depth-aware upsample`, async ({
      page
    }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      await page.goto(`/atlas/stellar-explosion?preset=core-collapse&${backend.query}`);
      await waitForArrival(page);

      const result = await page.evaluate(() => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          activePrepared: { scene: { add(object: unknown): void; remove(object: unknown): void } };
          governor: { setForcedTier(tier: 'high'): void };
          handleResize(width: number, height: number): void;
          services: {
            post: { getDebugSnapshot?(): Record<string, unknown> };
            volumes: {
              createVolume(config: {
                bounds: { kind: 'sphere'; center: [number, number, number]; radius: number };
                density: () => number;
                baseMaxSteps: number;
                halfResolution: boolean;
                earlyAlphaTermination: boolean;
                temporalJitter: boolean;
                detail: {
                  seed: number;
                  octaves: number;
                  strength: number;
                  filamentStrength: number;
                  clumpStrength: number;
                  domainWarpStrength: number;
                };
                depthAwareUpsample: boolean;
                approximateSelfShadow: boolean;
                gradientShading: boolean;
              }): {
                object3d(): unknown;
                setDetailOctaves?(value: number): void;
                setLightingTaps?(value: number): void;
                setTemporalJitter?(value: boolean): void;
                getDebugSnapshot?(): Record<string, unknown>;
                dispose(): void;
              };
            };
          };
        };
        const scene = host.activePrepared?.scene;
        if (!scene) throw new Error('active scene unavailable');
        host.governor.setForcedTier('high');
        const rect = document.getElementById('viewport')?.getBoundingClientRect();
        if (rect) host.handleResize(rect.width, rect.height);
        const volume = host.services.volumes.createVolume({
          // The large probe sphere deliberately contains the auto-framed
          // camera, exercising the camera-inside-volume path.
          bounds: { kind: 'sphere', center: [0, 0, 0], radius: 2000 },
          density: () => 0.35,
          baseMaxSteps: 24,
          halfResolution: true,
          temporalJitter: true,
          earlyAlphaTermination: true,
          detail: {
            seed: 90210,
            octaves: 5,
            strength: 0.38,
            filamentStrength: 0.62,
            clumpStrength: 0.48,
            domainWarpStrength: 0.22
          },
          depthAwareUpsample: true,
          approximateSelfShadow: true,
          gradientShading: true
        });
        volume.setDetailOctaves?.(5);
        volume.setLightingTaps?.(2);
        volume.setTemporalJitter?.(true);
        scene.add(volume.object3d());
        app.captureFrame();
        const snapshot = volume.getDebugSnapshot?.() ?? {};
        scene.remove(volume.object3d());
        volume.dispose();
        return { volume: snapshot, post: host.services.post.getDebugSnapshot?.() ?? null };
      });

      console.log(`VOLUMETRICS_V2 ${backend.label}: ${JSON.stringify(result)}`);
      expect(errors).toEqual([]);
      expect(result.volume).toMatchObject({
        intermediateFormat: 'rgba16f',
        hdrIntermediate: true,
        temporalJitter: true,
        depthAwareUpsample: true
      });
      expect(result.volume.detailOctaves).toBeGreaterThanOrEqual(1);
      expect(result.volume.detailOctaves).toBeLessThanOrEqual(5);
      expect(result.volume.lightingTaps).toBeGreaterThanOrEqual(0);
      expect(result.volume.lightingTaps).toBeLessThanOrEqual(2);
      expect(result.post).toMatchObject({
        volumeDepthHistory: {
          valid: true,
          type: 1016,
          allocatedTargetCount: 2
        }
      });
    });
  }
});
