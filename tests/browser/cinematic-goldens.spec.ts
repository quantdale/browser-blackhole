/**
 * Separate Cinematic Goldens gate. Scientific goldens intentionally force a
 * restrained linear display chain; this suite pins Cinematic mode and records
 * the settled image plus temporal/high-contrast metrics.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

import {
  CINEMATIC_GOLDEN_SPECS,
  runCinematicGoldenExpectation
} from './support/cinematicGoldenHarness.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const requestedBackend = process.env.CINEMATIC_GOLDEN_BACKEND;
if (
  requestedBackend !== undefined &&
  requestedBackend !== 'webgpu' &&
  requestedBackend !== 'webgl2'
) {
  throw new Error(`CINEMATIC_GOLDEN_BACKEND must be webgpu or webgl2 (got ${requestedBackend})`);
}
const runSpecs = CINEMATIC_GOLDEN_SPECS.map((spec) => ({
  ...spec,
  ...(requestedBackend === undefined ? {} : { backend: requestedBackend as 'webgpu' | 'webgl2' })
}));
const results: Array<Record<string, unknown>> = [];

test.afterAll(() => {
  const commit = (process.env.CINEMATIC_GOLDEN_COMMIT ?? 'uncommitted').replace(
    /[^a-zA-Z0-9._-]/g,
    '_'
  );
  const backend = requestedBackend ?? 'default';
  const directory = resolve('artifacts', 'cinematic-visual-fidelity');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, `cinematic-goldens-${commit}-${backend}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        commit: process.env.CINEMATIC_GOLDEN_COMMIT ?? 'uncommitted',
        requestedBackend: requestedBackend ?? 'default',
        results
      },
      null,
      2
    )
  );
});

for (const spec of runSpecs) {
  test(`cinematic golden: ${spec.name}`, async ({ page }) => {
    test.info().annotations.push({ type: 'cinematic-notes', description: spec.notes });
    const result = await runCinematicGoldenExpectation(page, spec);
    results.push({ name: spec.name, ...result });
    const expected = process.env.UPDATE_CINEMATIC_GOLDENS === '1' ? 'updated' : 'pass';
    console.log(`CINEMATIC_GOLDEN ${spec.name}: ${JSON.stringify(result)}`);
    expect(result.status, JSON.stringify(result)).toBe(expected);
    expect(result.metadata.tier, `${spec.name} tier metadata`).toBe('high');
    expect(
      (result.metadata.temporal as { historyAge: number }).historyAge,
      `${spec.name} settle`
    ).toBe(8);
    expect(result.metrics.meanLuma, `${spec.name} should have visible radiance`).toBeGreaterThan(
      spec.minimumMeanLuma ?? 0.5
    );
    expect(result.metrics.saturationPercent, `${spec.name} saturation headroom`).toBeLessThan(35);
    expect(result.metrics.temporal.meanLumaDelta, `${spec.name} temporal flicker`).toBeLessThan(12);
    expect(result.metrics.temporal.edgeFlickerPercent, `${spec.name} edge shimmer`).toBeLessThan(
      35
    );
  });
}
