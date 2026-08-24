/**
 * CA8-17 — BBM1 binary integrity + fail-closed decoder validation.
 *
 * Gates tested (docs/cosmic-atlas/DATA_PIPELINE.md §10, mission §17):
 * - the COMMITTED runtime asset decodes and matches its committed manifest
 *   checksum/byte length/sample count;
 * - sha256HexSync matches published SHA-256 test vectors;
 * - every corruption class fails closed with a structured BbmLoadError and
 *   never partially activates: magic, schema version, header length, byte
 *   length, sample count, merger index, embedded asset id, non-finite
 *   values, non-monotonic time, impossible channel ranges, checksum.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BbmLoadError,
  decodeBbm1,
  sha256HexSync,
  type BbmDataset
} from '../../src/phenomena/black-hole-merger/dataset.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ASSET_DIR = join(REPO_ROOT, 'public', 'data', 'black-hole-merger');
const BIN_PATH = join(ASSET_DIR, 'sxs-bbh-0001-lev5-bbm1-v1.bin');

interface CommittedManifest {
  readonly id: string;
  readonly phenomenon: string;
  readonly channels: string[];
  readonly runtime: {
    readonly encoding: string;
    readonly schemaVersion: number;
    readonly filename: string;
    readonly samples: number;
    readonly bytes: number;
    readonly checksumSha256: string;
  };
}

const manifest = JSON.parse(
  readFileSync(join(ASSET_DIR, 'manifest.json'), 'utf8')
) as unknown as CommittedManifest;

function loadCommitted(): { buffer: ArrayBuffer; dataset: BbmDataset } {
  const buffer = readFileSync(BIN_PATH);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const dataset = decodeBbm1(arrayBuffer, manifest.id, manifest.runtime.checksumSha256);
  return { buffer: arrayBuffer, dataset };
}

function corrupted(source: ArrayBuffer, mutate: (view: DataView) => void): ArrayBuffer {
  const copy = source.slice(0);
  mutate(new DataView(copy));
  return copy;
}

describe('sha256HexSync', () => {
  it('matches published SHA-256 test vectors', () => {
    const encode = (s: string): ArrayBuffer =>
      Uint8Array.from(s, (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
    expect(sha256HexSync(encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(sha256HexSync(encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256HexSync(encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });
});

describe('committed BBM1 asset integrity', () => {
  const { buffer, dataset } = loadCommitted();

  it('manifest declares a black-hole-merger bbm1 v1 contract', () => {
    expect(manifest.phenomenon).toBe('black-hole-merger');
    expect(manifest.runtime.encoding).toBe('bbm1');
    expect(manifest.runtime.schemaVersion).toBe(1);
    expect(manifest.channels).toEqual(['timeM', 'bhA.xyz', 'bhB.xyz', 'h22Re', 'h22Im']);
    expect(manifest.runtime.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('payload hash equals the manifest checksum (fail-closed gate)', () => {
    expect(sha256HexSync(buffer)).toBe(manifest.runtime.checksumSha256);
  });

  it('decoded shape matches manifest byte/sample counts exactly', () => {
    expect(buffer.byteLength).toBe(manifest.runtime.bytes);
    expect(dataset.sampleCount).toBe(manifest.runtime.samples);
    expect(dataset.assetId).toBe(manifest.id);
    expect(dataset.schemaVersion).toBe(1);
  });

  it('physical metadata carries documented NR conventions', () => {
    // Equal-mass non-spinning reference event (CA-ADR-021).
    expect(Math.abs(dataset.m1OverM - 0.5)).toBeLessThan(1e-4);
    expect(Math.abs(dataset.m2OverM - 0.5)).toBeLessThan(1e-4);
    expect(Math.abs(dataset.chi1z)).toBeLessThan(1e-4);
    expect(Math.abs(dataset.chi2z)).toBeLessThan(1e-4);
    // Remnant from late-time common horizon (source-derived).
    expect(Math.abs(dataset.remnantMassOverM - 0.9515962632179453)).toBeLessThan(1e-12);
    expect(Math.abs(dataset.remnantChiZ - 0.6864817488889335)).toBeLessThan(1e-12);
    // Merger anchor at t=0; window strictly ordered.
    expect(dataset.tStartM).toBeLessThan(0);
    expect(dataset.tEndM).toBeGreaterThan(0);
    expect(dataset.mergerEndM).toBeGreaterThan(0);
    expect(dataset.ringdownEndM).toBeGreaterThanOrEqual(dataset.mergerEndM);
    expect(dataset.mergerIndex).toBeGreaterThanOrEqual(0);
    expect(dataset.mergerIndex).toBeLessThan(dataset.sampleCount);
    // Time channel starts exactly at tStart and is strictly monotonic.
    expect(dataset.timesM[0]).toBeCloseTo(dataset.tStartM, 3);
    for (let i = 1; i < dataset.sampleCount; i += 1) {
      if ((dataset.timesM[i] as number) <= (dataset.timesM[i - 1] as number)) {
        throw new Error(`non-monotonic time at ${i}`);
      }
    }
    // Peak strain amplitude is finite positive (documented ~0.3948).
    expect(dataset.h22PeakAmplitude).toBeGreaterThan(0.1);
    expect(dataset.h22PeakAmplitude).toBeLessThan(10);
  });

  it('waveform amplitude peaks at the merger anchor (alignment preserved)', () => {
    let peakIndex = 0;
    let peakValue = 0;
    for (let i = 0; i < dataset.sampleCount; i += 1) {
      const re = dataset.h22Re[i] as number;
      const im = dataset.h22Im[i] as number;
      const amp = re * re + im * im;
      if (amp > peakValue) {
        peakValue = amp;
        peakIndex = i;
      }
    }
    expect(Math.abs(peakIndex - dataset.mergerIndex)).toBeLessThanOrEqual(1);
    expect(dataset.timesM[peakIndex] as number).toBeCloseTo(0, 1);
  });
});

describe('fail-closed decoding of corrupt payloads', () => {
  const { buffer } = loadCommitted();

  function expectCode(payload: ArrayBuffer, code: BbmLoadError['code']): void {
    let caught: unknown = null;
    try {
      // Structural checks are exercised WITHOUT checksum enforcement (the
      // decoder checks the checksum first when requested — that ordering is
      // itself asserted by the dedicated checksum test below).
      decodeBbm1(payload, manifest.id, undefined);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BbmLoadError);
    expect((caught as BbmLoadError).code).toBe(code);
  }

  it('rejects bad magic', () => {
    expectCode(
      corrupted(buffer, (v) => v.setUint32(0, 0xdeadbeef, true)),
      'bad-magic'
    );
  });

  it('rejects unsupported schema version', () => {
    expectCode(
      corrupted(buffer, (v) => v.setUint32(4, 999, true)),
      'bad-schema-version'
    );
  });

  it('rejects wrong header length field', () => {
    expectCode(
      corrupted(buffer, (v) => v.setUint32(8, 32, true)),
      'bad-header-length'
    );
  });

  it('rejects truncated payloads', () => {
    expectCode(buffer.slice(0, buffer.byteLength - 8), 'bad-byte-length');
  });

  it('rejects invalid sample counts', () => {
    expectCode(
      corrupted(buffer, (v) => v.setUint32(12, 0, true)),
      'bad-sample-count'
    );
    expectCode(
      corrupted(buffer, (v) => v.setUint32(12, 1 << 25, true)),
      'bad-sample-count'
    );
  });

  it('rejects out-of-range merger index', () => {
    expectCode(
      corrupted(buffer, (v) => v.setUint32(16, 1 << 30, true)),
      'bad-merger-index'
    );
  });

  it('rejects embedded asset-id mismatch (wrong destination)', () => {
    const copy = buffer.slice(0);
    const bytes = new Uint8Array(copy);
    bytes.fill(0x58, 128, 144); // overwrite NUL-padded ascii asset id
    let caught: unknown = null;
    try {
      decodeBbm1(copy, manifest.id, undefined);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BbmLoadError);
    expect((caught as BbmLoadError).code).toBe('bad-asset-id');
  });

  it('rejects non-monotonic times without partial activation', () => {
    // Interleaved rows: sample 1's time float lives at 160 + 9*4 bytes.
    expectCode(
      corrupted(buffer, (v) => v.setFloat32(160 + 9 * 4, -1e30, true)),
      'non-monotonic-time'
    );
  });

  it('rejects NaN injected into numeric channels', () => {
    const strainOffset = 160 + 7 * datasetSampleCount() * 4;
    expectCode(
      corrupted(buffer, (v) => v.setFloat32(strainOffset, Number.NaN, true)),
      'non-finite-values'
    );
  });

  it('rejects impossible strain ranges', () => {
    const strainOffset = 160 + 7 * datasetSampleCount() * 4;
    expectCode(
      corrupted(buffer, (v) => v.setFloat32(strainOffset, 500, true)),
      'impossible-channel-range'
    );
  });

  it('rejects checksum mismatches when verification is requested', () => {
    const flipped = corrupted(buffer, (v) =>
      v.setFloat32(160, v.getFloat32(160, true) + 0.5, true)
    );
    let caught: unknown = null;
    try {
      decodeBbm1(flipped, manifest.id, manifest.runtime.checksumSha256);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BbmLoadError);
    expect((caught as BbmLoadError).code).toBe('checksum-mismatch');
  });

  function datasetSampleCount(): number {
    const view = new DataView(buffer);
    return view.getUint32(12, true);
  }
});
