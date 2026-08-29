/**
 * Separate Cinematic Goldens gate. Scientific goldens intentionally force a
 * restrained linear display chain; this suite pins Cinematic mode and records
 * the settled image plus temporal/high-contrast metrics.
 */

import { expect, test } from '@playwright/test';

import {
  CINEMATIC_GOLDEN_SPECS,
  runCinematicGoldenExpectation
} from './support/cinematicGoldenHarness.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

for (const spec of CINEMATIC_GOLDEN_SPECS) {
  test(`cinematic golden: ${spec.name}`, async ({ page }) => {
    test.info().annotations.push({ type: 'cinematic-notes', description: spec.notes });
    const result = await runCinematicGoldenExpectation(page, spec);
    const expected = process.env.UPDATE_CINEMATIC_GOLDENS === '1' ? 'updated' : 'pass';
    console.log(`CINEMATIC_GOLDEN ${spec.name}: ${JSON.stringify(result)}`);
    expect(result.status, JSON.stringify(result)).toBe(expected);
    expect(result.metadata.tier, `${spec.name} tier metadata`).toBe('high');
    expect(
      (result.metadata.temporal as { historyAge: number }).historyAge,
      `${spec.name} settle`
    ).toBe(8);
    expect(result.metrics.meanLuma, `${spec.name} should have visible radiance`).toBeGreaterThan(
      0.5
    );
    expect(result.metrics.saturationPercent, `${spec.name} saturation headroom`).toBeLessThan(35);
    expect(result.metrics.temporal.meanLumaDelta, `${spec.name} temporal flicker`).toBeLessThan(12);
    expect(result.metrics.temporal.edgeFlickerPercent, `${spec.name} edge shimmer`).toBeLessThan(
      35
    );
  });
}
