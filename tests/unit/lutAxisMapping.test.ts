/**
 * LUT axis-mapping regression coverage for the D5 manifest-threading fix:
 * the GPU material must build its x->u mapping from the validated manifest,
 * a non-default mapping must produce different u values, and the shipped
 * family must still load through the normal runtime path.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AXIS_X, xToU } from '../../src/phenomena/black-hole/lut/domain.js';
import { loadLutFamily, LutSampler } from '../../src/phenomena/black-hole/lut/runtime.js';

const FAMILY_DIR = 'public/luts/schwarzschild-v1-415dea94';

async function loadShippedFamily() {
  const manifestJson = JSON.parse(await readFile(`${FAMILY_DIR}/manifest.json`, 'utf8')) as unknown;
  const assets = new Map<string, Uint8Array>();
  for (const file of ['trajectory.bin', 'aux-data.bin']) {
    assets.set(file, new Uint8Array(await readFile(`${FAMILY_DIR}/${file}`)));
  }
  return loadLutFamily(manifestJson, assets);
}

describe('x->u axis mapping', () => {
  it('produces a different mapping for a non-default manifest axis', () => {
    const custom = {
      uBreakpoints: [0, 0.25, 0.75, 1] as [number, number, number, number],
      xKnots: [0, 0.9, 1.1, 3] as [number, number, number, number]
    };
    expect(xToU(0.5, custom)).not.toBeCloseTo(xToU(0.5, DEFAULT_AXIS_X), 6);
    expect(xToU(2, custom)).not.toBeCloseTo(xToU(2, DEFAULT_AXIS_X), 6);
  });

  it('keeps the shipped family on the DEFAULT mapping', async () => {
    const result = await loadShippedFamily();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const axis = result.family.manifest.textures.find((t) => t.id === 'trajectory')?.domain.axisX;
      expect(axis).toEqual(DEFAULT_AXIS_X);
    }
  });
});

describe('analytic capture classification', () => {
  it('never reports a ray just inside b_c as escaped', async () => {
    const result = await loadShippedFamily();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sampler = new LutSampler(result.family);
    const bc = result.family.manifest.physics.bCriticalRg;
    // Just inside b_c: captured, never LUT-escaped (the GPU classification is
    // now the analytic xNorm >= 1 comparison, never a filtered sentinel).
    const justInside = sampler.resolveRay(bc * 0.99);
    expect(justInside.status).toBe('captured');
    expect(justInside.status).not.toBe('escaped');
    const justOutside = sampler.resolveRay(bc * 1.01);
    expect(justOutside.status).toBe('escaped');
    // Sweeping the whole sub-critical domain must never yield 'escaped'.
    for (let i = 1; i <= 20; i += 1) {
      const res = sampler.resolveRay(bc * (i / 20) * 0.999);
      expect(res.status).not.toBe('escaped');
    }
  });
});
