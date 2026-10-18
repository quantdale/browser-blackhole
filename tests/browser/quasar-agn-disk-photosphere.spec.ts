/**
 * AGN nuclear outer-disk photosphere POC.
 *
 * The NUCLEAR outer disk must be a finite-thickness photospheric shell, not a
 * flat additive annulus: correct zone-only visibility, preserved continuum
 * response and Keplerian timeline determinism, finite geometry inputs, and no
 * temporal sparkling at a frozen timeline. WebGPU and forced WebGL2 both.
 */
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
      { timeout: 90_000, intervals: [250] }
    )
    .toBe('arrived');
}

type DiskWork = {
  representation: string;
  innerRg: number;
  outerRg: number;
  thicknessAtOuterUnits: number;
  thicknessAtInnerUnits: number;
  azimuthSegments: number;
  radialSegments: number;
  vertexCount: number;
  triangleCount: number;
  zoneVisible: boolean;
  disposed: boolean;
};

test.describe('AGN nuclear outer-disk photosphere', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} renders the photospheric shell with preserved disk laws`, async ({
      page
    }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));

      const load = async (preset: string) => {
        await page.goto(`/atlas/quasar-agn?preset=${preset}&${backend.query}`);
        await waitForArrival(page);
        return page.evaluate(() => {
          const app = window.__ATLAS_APP__!;
          app.captureFrame();
          return app.host.activeDestinationDebugSnapshot() as Record<string, unknown>;
        });
      };

      const nuclear = await load('quasar-reference');
      const disk = nuclear.diskWork as DiskWork | undefined;
      expect(disk, 'diskWork must be present').toBeDefined();
      expect(disk).toMatchObject({
        representation: 'photospheric-shell',
        innerRg: 200,
        outerRg: 8000,
        zoneVisible: true,
        disposed: false
      });

      // Finite, restrained thickness and valid geometry budget.
      expect(Number.isFinite(disk!.thicknessAtOuterUnits)).toBe(true);
      expect(disk!.thicknessAtOuterUnits).toBeGreaterThan(0);
      expect(disk!.thicknessAtOuterUnits).toBeLessThan(0.64); // < 8% of rOut units
      expect(disk!.thicknessAtInnerUnits).toBeLessThan(disk!.thicknessAtOuterUnits);
      expect(Number.isInteger(disk!.vertexCount) && disk!.vertexCount > 0).toBe(true);
      expect(Number.isInteger(disk!.triangleCount) && disk!.triangleCount > 0).toBe(true);
      expect(Number.isInteger(disk!.azimuthSegments)).toBe(true);
      expect(Number.isInteger(disk!.radialSegments)).toBe(true);

      // Scientific classification is disclosed on the destination.
      const fidelity = nuclear.fidelity as { outerDisk?: string } | undefined;
      expect(String(fidelity?.outerDisk ?? '')).toContain('representation-layer');
      expect(String(fidelity?.outerDisk ?? '')).toContain('NOT GRMHD');

      // Preserved continuum response: live variability factor is finite and
      // strictly positive (it multiplies the shell brightness).
      const continuum = nuclear.continuumFactor as number;
      expect(Number.isFinite(continuum)).toBe(true);
      expect(continuum).toBeGreaterThan(0);
      expect(nuclear.keplerOmegaScalePerDay as number).toBeGreaterThan(0);

      // Deterministic scrubbing: the same phase replays the same state. Each
      // read forces a frame first so the module's update() has applied the
      // scrub before the snapshot is taken (the snapshot is per-frame state).
      const readTime = async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__!;
          app.captureFrame();
          const snap = app.host.activeDestinationDebugSnapshot() as Record<string, unknown>;
          return { timeDays: snap.timeDays, continuumFactor: snap.continuumFactor };
        });
      await page.evaluate(() => {
        window.__ATLAS_APP__!.host.time.pause();
        window.__ATLAS_APP__!.host.time.scrubTo(0.35);
      });
      const first = await readTime();
      await page.evaluate(() => window.__ATLAS_APP__!.host.time.scrubTo(0.1));
      await page.evaluate(() => window.__ATLAS_APP__!.host.time.scrubTo(0.35));
      const replay = await readTime();
      expect(replay.timeDays).toBe(first.timeDays);
      expect(replay.continuumFactor).toBe(first.continuumFactor);

      // No temporal sparkling at a frozen timeline: two forced frames must
      // agree within jitter noise on the 5x5 sample grid.
      const samplesA = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
      const samplesB = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
      expect(samplesA).not.toBeNull();
      expect(samplesB).not.toBeNull();
      const parse = (s: string | undefined): number[] => (s ?? '0,0,0').split(',').map(Number);
      let deltaSum = 0;
      for (let i = 0; i < samplesA!.length; i += 1) {
        const a = parse(samplesA![i]);
        const b = parse(samplesB![i]);
        for (let c = 0; c < 3; c += 1) deltaSum += Math.abs((a[c] ?? 0) - (b[c] ?? 0));
      }
      const meanDelta = deltaSum / (samplesA!.length * 3);
      expect(meanDelta).toBeLessThan(6);

      // Zone exclusivity: the shell exists only in the NUCLEAR zone.
      const inner = await load('inner-engine');
      expect((inner.diskWork as DiskWork).zoneVisible).toBe(false);
      const galactic = await load('radio-galaxy');
      expect((galactic.diskWork as DiskWork).zoneVisible).toBe(false);
      expect(galactic.doubleRenderGuard).toBe('ok');

      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});
