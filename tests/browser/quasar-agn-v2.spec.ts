import { expect, test } from '@playwright/test';

import './support/atlasHook.js';

const BACKENDS = [
  { label: 'webgpu', query: 'backend=webgpu' },
  { label: 'webgl2', query: 'backend=webgl2' }
] as const;

const PRESETS = ['inner-engine', 'quasar-reference', 'radio-galaxy', 'blazar-view'] as const;

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

test.describe('Quasar / AGN V2 presentation', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  for (const backend of BACKENDS) {
    test(`${backend.label} keeps direct inner GR and V2 galactic/nuclear profiles`, async ({
      page
    }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`PAGE_ERROR: ${error.message}`));
      const rows: Array<Record<string, unknown>> = [];

      for (const preset of PRESETS) {
        await page.goto(`/atlas/quasar-agn?preset=${preset}&${backend.query}`);
        await waitForArrival(page);
        await page.locator('input[value="cinematic"]').check();
        const debug = await page.evaluate(() => {
          const app = window.__ATLAS_APP__!;
          const host = app.host as unknown as {
            governor: { setForcedTier(tier: 'high'): void };
            time: { pause(): void; scrubTo(phase: number): void };
            handleResize(width: number, height: number): void;
          };
          host.governor.setForcedTier('high');
          host.time.pause();
          host.time.scrubTo(0.5);
          const rect = document.getElementById('viewport')?.getBoundingClientRect();
          if (rect) host.handleResize(rect.width, rect.height);
          app.captureFrame();
          return app.host.activeDestinationDebugSnapshot();
        });
        rows.push({ preset, debug });
      }

      console.log(`AGN_V2 ${backend.label}: ${JSON.stringify(rows)}`);
      expect(errors).toEqual([]);
      const inner = rows.find((row) => row.preset === 'inner-engine')?.debug as Record<
        string,
        unknown
      >;
      expect(inner).toMatchObject({ zone: 'inner', grPassActive: true });
      for (const row of rows) {
        expect(row.debug).toMatchObject({
          doubleRenderGuard: 'ok',
          zoneMotion: { galactic: expect.stringContaining('static') },
          volumeWork: {
            corona: { intermediateFormat: 'rgba16f', hdrIntermediate: true },
            torus: { intermediateFormat: 'rgba16f', hdrIntermediate: true }
          },
          particleWork: {
            host: { profile: 'star' },
            knots: { profile: 'emissive-core' }
          }
        });
      }
    });
  }
});
