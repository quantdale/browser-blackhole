/**
 * AGN jet volume proof of concept.
 *
 * The nuclear and galactic jets must be VolumeService marches, not cylinder
 * meshes: half-resolution, zone-exclusive, and still carrying the blazar
 * lobe-ratio readout. Inner GR stays a direct pass with no jet march.
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

type JetRow = {
  zone: string;
  kind: string;
  side: string;
  visible?: boolean;
  zoneVisible?: boolean;
  halfResolution?: boolean;
  selfShadow?: boolean;
  baseMaxSteps?: number;
};

test.describe('Quasar / AGN jet volumes', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} marches jets only in the owning zone`, async ({ page }) => {
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
          return app.host.activeDestinationDebugSnapshot();
        });
      };

      const inner = await load('inner-engine');
      const nuclear = await load('quasar-reference');
      const galactic = await load('radio-galaxy');
      const blazar = await load('blazar-view');
      if (inner === null || nuclear === null || galactic === null || blazar === null) {
        throw new Error('AGN debug snapshot was null');
      }

      expect(errors, errors.join('\n')).toEqual([]);
      expect(inner).toMatchObject({ zone: 'inner', grPassActive: true, doubleRenderGuard: 'ok' });
      expect(nuclear).toMatchObject({
        zone: 'nuclear',
        grPassActive: false,
        doubleRenderGuard: 'ok'
      });
      expect(galactic).toMatchObject({
        zone: 'galactic',
        grPassActive: false,
        doubleRenderGuard: 'ok'
      });
      expect((blazar.lobeBrightnessRatio as number) ?? 0).toBeGreaterThan(100);
      expect(String((blazar.fidelity as { jet?: string } | undefined)?.jet ?? '')).toContain(
        'not GRMHD'
      );

      const jetsOf = (snap: Record<string, unknown>): JetRow[] => {
        const volumeWork = snap.volumeWork as { jets?: JetRow[] } | undefined;
        return volumeWork?.jets ?? [];
      };
      for (const snap of [inner, nuclear, galactic, blazar]) {
        const jets = jetsOf(snap);
        expect(jets).toHaveLength(4);
        expect(jets.every((jet) => jet.halfResolution === true && jet.selfShadow === false)).toBe(
          true
        );
        expect(jets.every((jet) => (jet.baseMaxSteps ?? 0) >= 24)).toBe(true);
      }
      const visible = (snap: Record<string, unknown>, kind: string): boolean =>
        jetsOf(snap)
          .filter((jet) => jet.kind === kind)
          .every((jet) => jet.visible === true && jet.zoneVisible === true);
      const hidden = (snap: Record<string, unknown>, kind: string): boolean =>
        jetsOf(snap)
          .filter((jet) => jet.kind === kind)
          .every((jet) => jet.visible === false && jet.zoneVisible === false);
      expect(hidden(inner, 'base')).toBe(true);
      expect(hidden(inner, 'extended')).toBe(true);
      expect(visible(nuclear, 'base')).toBe(true);
      expect(hidden(nuclear, 'extended')).toBe(true);
      expect(hidden(galactic, 'base')).toBe(true);
      expect(visible(galactic, 'extended')).toBe(true);
      expect(visible(blazar, 'base')).toBe(true);
      expect(hidden(blazar, 'extended')).toBe(true);
    });
  }
});
