/**
 * M8-03 deterministic-generation gate (mission §5): two builds from the same
 * explicit source revision and options must produce byte-identical assets AND
 * a byte-identical manifest; the assembled manifest must pass strict schema
 * validation with checksums matching every asset; differing physics inputs
 * must change the content-addressed family directory.
 */

import { describe, expect, it } from 'vitest';
import { buildFamily } from '../../tools/generate-luts/generate.js';
import {
  validateLutManifest,
  verifyAssetChecksum
} from '../../src/phenomena/black-hole/lut/validate.js';

const PINNED_COMMIT = 'feedface00000000000000000000000000000000';
const PINNED_ISO = '2026-08-23T00:00:00.000Z';

const OPTIONS = {
  width: 96,
  height: 128,
  psiMax: 16,
  generatorCommit: PINNED_COMMIT,
  generatedAtIso: PINNED_ISO
} as const;

describe('deterministic LUT generation pipeline', () => {
  // Two full CPU-reference builds are legitimately slow (>5 s under parallel
  // vitest workers); the timeout budgets that cost without touching asserts.
  it('produces byte-identical assets and manifest across runs', { timeout: 60_000 }, async () => {
    const a = await buildFamily(OPTIONS);
    const b = await buildFamily(OPTIONS);
    expect(a.directoryName).toBe(b.directoryName);
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest));
    expect(a.assets.size).toBe(b.assets.size);
    for (const [name, bytes] of a.assets) {
      const other = b.assets.get(name);
      expect(other, `asset ${name} present in both runs`).toBeDefined();
      expect(Buffer.from(bytes).equals(Buffer.from(other!))).toBe(true);
    }
  });

  it('emits a manifest that passes strict schema validation', async () => {
    const { manifest } = await buildFamily(OPTIONS);
    const result = validateLutManifest(JSON.parse(JSON.stringify(manifest)));
    if (!result.ok) console.log(`[pipeline-diag] reject=${result.reason}: ${result.detail}`);
    expect(result.ok, result.ok ? 'valid' : `${result.reason}: ${result.detail}`).toBe(true);
    if (result.ok) {
      expect(result.manifest.family).toBe('schwarzschild-v1');
      expect(result.manifest.physics.massGeometric).toBe(1);
      expect(result.manifest.textures.map((t) => t.id).sort()).toEqual(['aux', 'trajectory']);
    }
  });

  it('records checksums matching every asset byte-for-byte', async () => {
    const { manifest, assets } = await buildFamily(OPTIONS);
    for (const texture of manifest.textures) {
      const bytes = assets.get(texture.file);
      expect(bytes).toBeDefined();
      expect(await verifyAssetChecksum(bytes!, texture.sha256)).toBe(true);
      const bpp = texture.format === 'r16f' ? 2 : texture.format === 'rgba16f' ? 8 : Number.NaN;
      expect(texture.byteLength).toBe(texture.width * texture.height * bpp);
    }
  });

  it('classifies every column exactly at the analytic critical boundary', async () => {
    const { manifest } = await buildFamily(OPTIONS);
    // Generator-side corpus: classification is exact outside any hybrid band;
    // with the default winding budget the measured band must be empty.
    expect(manifest.validation.classificationMismatchRate).toBe(0);
    expect(manifest.hybridBandHalfWidthX).toBe(0);
  });

  it('changes the content-addressed directory when physics inputs change', async () => {
    const base = await buildFamily(OPTIONS);
    const other = await buildFamily({ ...OPTIONS, psiMax: 8 });
    expect(base.directoryName).not.toBe(other.directoryName);
    const domain = other.manifest.textures[0]?.domain;
    expect(domain?.kind).toBe('trajectory');
    if (domain?.kind === 'trajectory') expect(domain.psiMax).toBe(8);
  });

  it('measures nonzero terminal-direction accuracy into the manifest', async () => {
    const { manifest } = await buildFamily(OPTIONS);
    expect(manifest.validation.escapeDirectionAngularErrorRadMax).toBeGreaterThan(0);
    expect(manifest.validation.escapeDirectionAngularErrorRadMax).toBeLessThan(1e-2);
    expect(manifest.validation.diskHitRadiusErrorRgMax).toBeGreaterThan(0);
  });
});
