import { expect, test } from '@playwright/test';

import './support/atlasHook.js';

const BACKENDS = [
  { label: 'webgpu', query: 'backend=webgpu' },
  { label: 'webgl2', query: 'backend=webgl2' }
] as const;

const PROFILES = [
  'generic-soft',
  'star',
  'ejecta-streak',
  'debris-streak',
  'dust-clump',
  'emissive-core'
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

test.describe('ParticleService V2 profiles', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} compiles all representation profiles`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      await page.goto(`/atlas/stellar-explosion?preset=core-collapse&${backend.query}`);
      await waitForArrival(page);

      const snapshots = await page.evaluate((profiles) => {
        const app = window.__ATLAS_APP__!;
        const host = app.host as unknown as {
          activePrepared: { scene: { add(object: unknown): void; remove(object: unknown): void } };
          services: {
            particles: {
              createSystem(config: {
                capacity: number;
                emitters: Array<{ kind: 'point'; origin: [number, number, number]; speed: number }>;
                lifetimeSeconds: [number, number];
                sizePx: [number, number];
                colorRamp: Array<{ t: number; color: [number, number, number]; alpha: number }>;
                blending: 'additive';
                seed: number;
                preferCompute: boolean;
                activity: 'dynamic';
                profile: (typeof profiles)[number];
                emissiveIntensity: number;
              }): {
                object3d(): unknown;
                update(dt: number): void;
                setProfileQuality?(quality: number): void;
                getDebugSnapshot(): Record<string, unknown>;
                dispose(): void;
              };
            };
          };
        };
        const scene = host.activePrepared?.scene;
        if (!scene) throw new Error('active scene unavailable');
        const handles = profiles.map((profile, index) =>
          host.services.particles.createSystem({
            capacity: 8,
            emitters: [{ kind: 'point', origin: [index * 0.5 - 1, 0, 0], speed: 3 + index }],
            lifetimeSeconds: [5, 7],
            sizePx: [1, 3],
            colorRamp: [
              { t: 0, color: [1, 0.2, 0.05], alpha: 0.8 },
              { t: 1, color: [0.1, 0.3, 1], alpha: 0.1 }
            ],
            blending: 'additive',
            seed: 9000 + index,
            preferCompute: false,
            activity: 'dynamic',
            profile,
            emissiveIntensity: 2
          })
        );
        for (const handle of handles) {
          handle.setProfileQuality?.(1);
          handle.update(1 / 60);
          scene.add(handle.object3d());
        }
        app.captureFrame();
        const output = handles.map((handle) => handle.getDebugSnapshot());
        for (const handle of handles) {
          scene.remove(handle.object3d());
          handle.dispose();
        }
        return output;
      }, PROFILES);

      expect(errors).toEqual([]);
      expect(snapshots.map((snapshot) => snapshot.profile)).toEqual([...PROFILES]);
      for (const snapshot of snapshots) {
        expect(snapshot.profileQuality).toBeGreaterThanOrEqual(0.25);
        expect(snapshot.profileQuality).toBeLessThanOrEqual(1);
        expect(snapshot.emissiveIntensity).toBe(2);
        expect(snapshot.bufferBytes).toBe(8 * 48);
      }
    });
  }
});
