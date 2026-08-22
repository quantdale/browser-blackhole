/**
 * Gate D visual-regression suite (campaign §15-17).
 *
 * Each test executes one GoldenSpec from support/goldenHarness.ts:
 * navigate -> force documented determinism axes (pinned tier, re-applied
 * sizing, paused phase-0 timeline, linear display chain) -> capture #viewport
 * -> perceptual comparison against tests/browser/goldens/<name>.png.
 *
 * Goldens are NEVER auto-updated on failure. Regeneration is an explicit
 * reviewed act:  UPDATE_GOLDENS=1 npx playwright test visual-goldens
 *
 * Serial mode keeps GPU pressure deterministic across workers.
 */

import { expect, test } from '@playwright/test';

import { GOLDEN_SPECS, runGoldenExpectation } from './support/goldenHarness.js';

test.describe.configure({ mode: 'serial' });

for (const spec of GOLDEN_SPECS) {
  test(`golden: ${spec.name}`, async ({ page }) => {
    test.info().annotations.push({
      type: 'golden-notes',
      description: spec.notes
    });
    const result = await runGoldenExpectation(page, spec);
    const expected = process.env.UPDATE_GOLDENS === '1' ? 'updated' : 'pass';
    expect(result.status, JSON.stringify(result)).toBe(expected);
  });
}
