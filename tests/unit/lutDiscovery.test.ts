/**
 * Shipped-LUT discovery tests (verification-gate-integrity D5/V-04, tasks
 * 5.2/5.6/5.7).
 *
 * These rows exercise the SAME pure resolver the product runs
 * (`resolveLutFamilyFromIndex` is what `loadShippedLutFamily` calls), so a
 * broken shipped index can no longer leave the suite green — negative test
 * 1.1 pointed `public/luts/index.json` at a non-existent family and every
 * LUT test passed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  isUnsafeAssetPath,
  resolveLutFamilyFromIndex
} from '../../src/phenomena/black-hole/lut/discovery.js';
import { loadLutFamily, type LutAssetSource } from '../../src/phenomena/black-hole/lut/runtime.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LUT_ROOT = join(REPO_ROOT, 'public', 'luts');

describe('shipped LUT index resolution (D5)', () => {
  it('resolves the shipped index and fully validates the selected family', async () => {
    const index: unknown = JSON.parse(readFileSync(join(LUT_ROOT, 'index.json'), 'utf8'));
    const resolution = resolveLutFamilyFromIndex(index);
    expect(resolution.ok, 'the SHIPPED index must resolve').toBe(true);
    if (!resolution.ok) return;

    // Full validation of the selected family: structure, per-asset presence.
    const dir = join(LUT_ROOT, resolution.familyDir);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as unknown;
    const m = manifest as { textures: Array<{ file: string; bytes?: number }> };
    const assets = new Map<string, Uint8Array>();
    for (const t of m.textures) {
      const buf = readFileSync(join(dir, t.file));
      if (t.bytes !== undefined) {
        expect(buf.byteLength, `${t.file}: byte length must match the manifest`).toBe(t.bytes);
      }
      assets.set(t.file, new Uint8Array(buf));
    }
    const result = await loadLutFamily(manifest, assets as LutAssetSource);
    expect(result.ok, 'the SHIPPED family must pass its own validator').toBe(true);
  });

  it('rejects a broken index with an explicit reason (fail-first: 1.1 was blind)', () => {
    // The exact 1.1 mutation: a family directory that does not exist.
    const broken = resolveLutFamilyFromIndex({ 'schwarzschild-v1': 'does-not-exist-99999999' });
    // The directory NAME itself is legal — resolution succeeds and the
    // subsequent family LOAD fails. What these rows pin is that the resolver
    // rejects every structurally broken document with a REASON.
    expect(broken.ok).toBe(true);

    expect(resolveLutFamilyFromIndex({})).toEqual({
      ok: false,
      reason: "lut-index: missing 'schwarzschild-v1' entry"
    });
    expect(resolveLutFamilyFromIndex(null).ok).toBe(false);
    expect(resolveLutFamilyFromIndex([]).ok).toBe(false);
    expect(resolveLutFamilyFromIndex({ 'schwarzschild-v1': 42 }).ok).toBe(false);
  });

  it('rejects family directories that could escape the luts root (V-16 class)', () => {
    for (const bad of ['../secrets', 'a/b', 'a\\b', '/etc']) {
      const res = resolveLutFamilyFromIndex({ 'schwarzschild-v1': bad });
      expect(res.ok, `must reject '${bad}'`).toBe(false);
      if (!res.ok) expect(res.reason, 'rejection must carry a reason').toContain('unsafe');
    }
  });

  it('the unsafe-asset-path rule matches the documented LUT validator semantics', () => {
    expect(isUnsafeAssetPath('../x')).toBe(true);
    expect(isUnsafeAssetPath('a\\b')).toBe(true);
    expect(isUnsafeAssetPath('/abs')).toBe(true);
    expect(isUnsafeAssetPath('aux.bin')).toBe(false);
    expect(isUnsafeAssetPath('family/aux.bin')).toBe(false);
  });
});
