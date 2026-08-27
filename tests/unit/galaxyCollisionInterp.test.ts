/**
 * CA9-12 — Galaxy Collision GC1 dataset decode + interpolation tests.
 *
 * Validates the offline artifact (`public/data/galaxy-collision/gc1.bin`) and
 * the CPU reference interpolation contract used by the runtime. A decoded
 * dataset that is generated but never asserted is a failure (same principle as
 * CA8-17): we pin counts, interpolation endpoints, midpoints, checksum, and
 * fail-closed decoding.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  decodeGc1,
  Gc1LoadError,
  interpolateCenters,
  interpolateTracers
} from '../../src/phenomena/galaxy-collision/dataset.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BIN_PATH = join(REPO_ROOT, 'public', 'data', 'galaxy-collision', 'gc1.bin');
const MANIFEST_PATH = join(REPO_ROOT, 'public', 'data', 'galaxy-collision', 'gc1.manifest.json');

function readBin(): ArrayBuffer {
  const buf = readFileSync(BIN_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('GC1 artifact decode', () => {
  it('decodes with the expected counts and time range', () => {
    const ds = decodeGc1(readBin());
    expect(ds.schemaVersion).toBe(1);
    expect(ds.tracerCount).toBe(1600);
    expect(ds.keyframeCount).toBe(241);
    expect(ds.tStart).toBeCloseTo(-50, 10);
    expect(ds.tEnd).toBeCloseTo(70, 10);
    expect(ds.times.length).toBe(241);
    expect(ds.times[0]).toBeCloseTo(-50, 10);
    expect(ds.times[240]).toBeCloseTo(70, 10);
  });

  it('reconstructs uniform keyframe times', () => {
    const ds = decodeGc1(readBin());
    const dt = (ds.tEnd - ds.tStart) / (ds.keyframeCount - 1);
    for (let k = 1; k < ds.keyframeCount; k++) {
      expect(ds.times[k]).toBeCloseTo(ds.tStart + k * dt, 12);
    }
  });

  it('matches the manifest SHA-256', () => {
    const buf = readFileSync(BIN_PATH);
    const sha = createHash('sha256').update(buf).digest('hex');
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(manifest.runtime.checksumSha256).toBe(sha);
    expect(manifest.runtime.tracerCount).toBe(1600);
    expect(manifest.runtime.keyframeCount).toBe(241);
    expect(manifest.runtime.bytes).toBe(buf.byteLength);
  });
});

describe('GC1 interpolation (CPU reference contract)', () => {
  it('returns an exact keyframe when t equals a keyframe time', () => {
    const ds = decodeGc1(readBin());
    const N3 = ds.tracerCount * 3;
    const out = new Float32Array(N3);
    interpolateTracers(ds, ds.times[0] ?? ds.tStart, out);
    for (let i = 0; i < N3; i++) {
      expect(out[i] ?? 0).toBe(ds.tracers[i] ?? 0);
    }
  });

  it('linearly interpolates to the midpoint between two keyframes', () => {
    const ds = decodeGc1(readBin());
    const N3 = ds.tracerCount * 3;
    const k = 10;
    const tMid = ((ds.times[k] ?? 0) + (ds.times[k + 1] ?? 0)) / 2;
    const out = new Float32Array(N3);
    interpolateTracers(ds, tMid, out);
    const base0 = k * N3;
    const base1 = (k + 1) * N3;
    for (let i = 0; i < N3; i++) {
      const expected = 0.5 * (ds.tracers[base0 + i] ?? 0) + 0.5 * (ds.tracers[base1 + i] ?? 0);
      expect(out[i] ?? 0).toBeCloseTo(expected, 6);
    }
  });

  it('interpolates nucleus centers consistently with tracers', () => {
    const ds = decodeGc1(readBin());
    const k = 5;
    const tMid = ((ds.times[k] ?? 0) + (ds.times[k + 1] ?? 0)) / 2;
    const x1 = new Float32Array(3);
    const x2 = new Float32Array(3);
    interpolateCenters(ds, tMid, x1, x2);
    const x1k = new Float32Array(3);
    const x2k = new Float32Array(3);
    interpolateCenters(ds, ds.times[k] ?? 0, x1k, x2k);
    for (let i = 0; i < 3; i++) expect(x1k[i] ?? 0).toBe(ds.centers[k * 6 + i] ?? 0);
    for (let i = 0; i < 3; i++) expect(x2k[i] ?? 0).toBe(ds.centers[k * 6 + 3 + i] ?? 0);
    expect(Number.isFinite(x1[0])).toBe(true);
    expect(Number.isFinite(x2[2])).toBe(true);
  });

  it('clamps out-of-range times to the data window', () => {
    const ds = decodeGc1(readBin());
    const N3 = ds.tracerCount * 3;
    const below = new Float32Array(N3);
    const above = new Float32Array(N3);
    interpolateTracers(ds, ds.tStart - 999, below);
    interpolateTracers(ds, ds.tEnd + 999, above);
    for (let i = 0; i < N3; i++) {
      expect(below[i] ?? 0).toBe(ds.tracers[i] ?? 0);
      expect(above[i] ?? 0).toBe(ds.tracers[(ds.keyframeCount - 1) * N3 + i] ?? 0);
    }
  });
});

describe('GC1 fail-closed decoding', () => {
  it('rejects a too-short buffer', () => {
    expect(() => decodeGc1(new ArrayBuffer(10))).toThrow(Gc1LoadError);
  });

  it('rejects a wrong magic', () => {
    const ab = readBin();
    const bytes = new Uint8Array(ab);
    bytes[0] = 0x5a; // 'Z'
    bytes[1] = 0x5a;
    bytes[2] = 0x5a;
    bytes[3] = 0x5a;
    expect(() => decodeGc1(bytes.buffer)).toThrow(Gc1LoadError);
    try {
      decodeGc1(bytes.buffer);
    } catch (e) {
      expect(e).toBeInstanceOf(Gc1LoadError);
      expect((e as Gc1LoadError).kind).toBe('bad-magic');
    }
  });

  it('rejects an unsupported schema version', () => {
    const ab = readBin();
    const dv = new DataView(ab);
    dv.setUint32(4, 99, true);
    expect(() => decodeGc1(ab)).toThrow(Gc1LoadError);
    try {
      decodeGc1(ab);
    } catch (e) {
      expect((e as Gc1LoadError).kind).toBe('bad-schema-version');
    }
  });

  it('rejects a corrupt (length-mismatched) buffer', () => {
    const ab = readBin();
    // Truncate a few bytes so the declared length no longer matches.
    const truncated = ab.slice(0, ab.byteLength - 8);
    expect(() => decodeGc1(truncated)).toThrow(Gc1LoadError);
    try {
      decodeGc1(truncated);
    } catch (e) {
      expect((e as Gc1LoadError).kind).toBe('bad-byte-length');
    }
  });
});
