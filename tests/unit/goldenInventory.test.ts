/**
 * Golden inventory integrity (verification-gate-integrity D4/V-02, tasks 4.5).
 *
 * The GPU golden COMPARISON cannot run on hosted CI, but FILE EXISTENCE can —
 * set equality between declared scene names and committed baseline filenames,
 * in both directions, with no GPU and no browser. This converts baseline
 * deletion, rename, and orphaning from invisible (the 1.2 negative test:
 * deleting a PNG changed nothing outside the GPU suite) to blocking.
 *
 * Cinematic backend variants (`<NAME>_<BACKEND>.png`, produced by
 * `CINEMATIC_GOLDEN_BACKEND=webgl2 npx playwright test cinematic-goldens`)
 * are valid inventory members of their base row (task 6.6 documents this
 * command — the eight previously-orphaned `_WEBGL2` baselines are reachable
 * through it); any OTHER suffix is an orphan and fails.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GOLDEN_SPECS } from '../browser/support/goldenHarness.js';
import { CINEMATIC_GOLDEN_SPECS } from '../browser/support/cinematicGoldenHarness.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCIENTIFIC_DIR = join(REPO_ROOT, 'tests', 'browser', 'goldens');
const CINEMATIC_DIR = join(REPO_ROOT, 'tests', 'browser', 'cinematic-goldens');

function pngNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -'.png'.length))
    .sort();
}

describe('golden inventory integrity (D4)', () => {
  it('scientific suite: declared scenes and committed baselines are the same set', () => {
    const declared = GOLDEN_SPECS.map((spec) => spec.name).sort();
    const committed = pngNames(SCIENTIFIC_DIR);

    const missingBaselines = declared.filter((name) => !committed.includes(name));
    const orphanedBaselines = committed.filter((name) => !declared.includes(name));

    expect(missingBaselines, 'every declared scene must have a committed baseline').toEqual([]);
    expect(orphanedBaselines, 'every committed baseline must belong to a declared scene').toEqual(
      []
    );
    // The declaration itself must not contain duplicates.
    expect(new Set(declared).size, 'scene names must be unique').toBe(declared.length);
  });

  it('cinematic suite: every baseline maps to a declared row (backend variants allowed)', () => {
    const declared = CINEMATIC_GOLDEN_SPECS.map((spec) => spec.name);
    const declaredSet = new Set(declared);
    expect(declaredSet.size, 'cinematic scene names must be unique').toBe(declared.length);

    const committed = pngNames(CINEMATIC_DIR);
    const orphans: string[] = [];
    for (const file of committed) {
      if (declaredSet.has(file)) continue;
      // Documented backend variant: <NAME>_<BACKEND> for a declared <NAME>
      // (task 6.6: CINEMATIC_GOLDEN_BACKEND=webgl2 reaches these).
      const cut = file.lastIndexOf('_');
      if (cut > 0 && declaredSet.has(file.slice(0, cut))) continue;
      orphans.push(file);
    }
    expect(orphans, 'every cinematic baseline must map to a declared row').toEqual([]);

    // Both directions: every declared row must have at least one baseline.
    const missing = declared.filter(
      (name) =>
        !committed.includes(name) &&
        !committed.some((file) => file.startsWith(`${name}_`) && file !== name)
    );
    expect(missing, 'every declared cinematic row must have a committed baseline').toEqual([]);
  });
});
