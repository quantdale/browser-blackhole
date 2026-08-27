/**
 * CA9-10 — Galaxy Collision runtime dataset (GC1) decode + interpolation.
 *
 * The offline tool (`tools/cosmic-data/restricted_three_body.py --emit-artifact`)
 * produces a versioned compact binary (`gc1.bin`) plus a manifest. This module
 * decodes the binary into typed arrays and provides the deterministic
 * interpolation contract used by both the CPU reference and the runtime.
 *
 * Binary layout (little-endian), `GC1` schema 1:
 *   offset 0   : magic     "GC1"            (4 bytes, ASCII)
 *   offset 4   : schemaVersion  uint32
 *   offset 8   : tracerCount    uint32
 *   offset 12  : keyframeCount  uint32
 *   offset 16  : tStart         float64
 *   offset 24  : tEnd           float64
 *   offset 32  : diskRadiusRef  float64       (the R = 1 normalization reference)
 *   offset 40  : centers        keyframeCount * 2 * 3 float32  (nucleus x,y,z pairs)
 *   next       : tracers        keyframeCount * tracerCount * 3 float32
 *
 * Keyframes are uniformly spaced in time between tStart and tEnd (the offline
 * integrator records at fixed step cadence), so `times[k] = tStart + k*dtK`.
 *
 * SCIENTIFIC CONTRACT: tracer positions at browser time t are interpolated from
 * the validated offline data. They are NEVER computed by a runtime O(N^2)
 * solver or by cinematic particle drift. See docs/.../DATA_SOURCES_GALAXY_
 * COLLISION_SOURCE_LOCK.md.
 */

export interface Gc1Dataset {
  readonly schemaVersion: number;
  readonly tracerCount: number;
  readonly keyframeCount: number;
  readonly tStart: number;
  readonly tEnd: number;
  readonly diskRadiusRef: number;
  /** Uniform keyframe times (synthetic; uniform cadence). Length = keyframeCount. */
  readonly times: Float64Array;
  /** Flat keyframe nucleus positions, length keyframeCount * 2 * 3 (x1,y1,z1,x2,y2,z2). */
  readonly centers: Float32Array;
  /** Flat keyframe tracer positions, length keyframeCount * tracerCount * 3. */
  readonly tracers: Float32Array;
}

export type Gc1LoadErrorKind =
  'bad-magic' | 'bad-schema-version' | 'bad-byte-length' | 'bad-checksum' | 'bad-manifest';

export class Gc1LoadError extends Error {
  constructor(
    public readonly kind: Gc1LoadErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'Gc1LoadError';
  }
}

const GC1_MAGIC = 'GCL1';
const GC1_HEADER_BYTES = 40;
const GC1_SCHEMA = 1;

function readMagic(view: DataView): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(i));
  return s;
}

/**
 * Decode a GC1 binary buffer into typed arrays. Fail-closed: any structural
 * problem throws `Gc1LoadError` before any data is returned.
 */
export function decodeGc1(buffer: ArrayBuffer): Gc1Dataset {
  if (buffer.byteLength < GC1_HEADER_BYTES) {
    throw new Gc1LoadError('bad-byte-length', `GC1 too small: ${buffer.byteLength} bytes`);
  }
  const view = new DataView(buffer);
  const magic = readMagic(view);
  if (magic !== GC1_MAGIC) {
    throw new Gc1LoadError('bad-magic', `expected GC1 magic, got "${magic}"`);
  }
  const schemaVersion = view.getUint32(4, true);
  if (schemaVersion !== GC1_SCHEMA) {
    throw new Gc1LoadError('bad-schema-version', `unsupported GC1 schema ${schemaVersion}`);
  }
  const tracerCount = view.getUint32(8, true);
  const keyframeCount = view.getUint32(12, true);
  const tStart = view.getFloat64(16, true);
  const tEnd = view.getFloat64(24, true);
  const diskRadiusRef = view.getFloat64(32, true);

  if (tracerCount === 0 || keyframeCount === 0) {
    throw new Gc1LoadError('bad-byte-length', 'GC1 has zero tracers/keyframes');
  }
  const expected =
    GC1_HEADER_BYTES + keyframeCount * 2 * 3 * 4 + keyframeCount * tracerCount * 3 * 4;
  if (buffer.byteLength !== expected) {
    throw new Gc1LoadError(
      'bad-byte-length',
      `GC1 byte length ${buffer.byteLength} != expected ${expected}`
    );
  }

  const centers = new Float32Array(
    buffer.slice(GC1_HEADER_BYTES, GC1_HEADER_BYTES + keyframeCount * 2 * 3 * 4)
  );
  const tracerOffset = GC1_HEADER_BYTES + keyframeCount * 2 * 3 * 4;
  const tracers = new Float32Array(buffer.slice(tracerOffset));

  const dtK = keyframeCount > 1 ? (tEnd - tStart) / (keyframeCount - 1) : 0;
  const times = new Float64Array(keyframeCount);
  for (let k = 0; k < keyframeCount; k++) times[k] = tStart + k * dtK;

  return {
    schemaVersion,
    tracerCount,
    keyframeCount,
    tStart,
    tEnd,
    diskRadiusRef,
    times,
    centers,
    tracers
  };
}

/** Locate the bracketing keyframe indices + interpolation weight for time t. */
function locate(ds: Gc1Dataset, t: number): { k0: number; k1: number; s: number } {
  const K = ds.keyframeCount;
  if (K === 1) return { k0: 0, k1: 0, s: 0 };
  const dtK = (ds.tEnd - ds.tStart) / (K - 1);
  let f = dtK > 0 ? (t - ds.tStart) / dtK : 0;
  if (!Number.isFinite(f)) f = 0;
  if (f < 0) f = 0;
  if (f > K - 1) f = K - 1;
  const k0 = Math.floor(f);
  const k1 = Math.min(k0 + 1, K - 1);
  const s = f - k0;
  return { k0, k1, s };
}

/**
 * Interpolate tracer positions at time t into `out` (length tracerCount*3).
 * Linear interpolation between the two surrounding keyframes (design.md §6:
 * linear is acceptable when cadence error is proven; default cadence dtK = 0.5
 * model-time units keeps tidal-feature motion smooth for visualization).
 */
export function interpolateTracers(ds: Gc1Dataset, t: number, out: Float32Array): void {
  if (out.length < ds.tracerCount * 3) {
    throw new Error('interpolateTracers: out buffer too small');
  }
  const { k0, k1, s } = locate(ds, t);
  const N3 = ds.tracerCount * 3;
  const base0 = k0 * N3;
  const base1 = k1 * N3;
  const a = ds.tracers;
  for (let i = 0; i < N3; i++) {
    out[i] = (a[base0 + i] ?? 0) * (1 - s) + (a[base1 + i] ?? 0) * s;
  }
}

/** Interpolate the two nucleus center positions at time t (each length 3). */
export function interpolateCenters(
  ds: Gc1Dataset,
  t: number,
  outX1: Float32Array,
  outX2: Float32Array
): void {
  const { k0, k1, s } = locate(ds, t);
  const base0 = k0 * 6;
  const base1 = k1 * 6;
  const c = ds.centers;
  for (let i = 0; i < 3; i++) {
    outX1[i] = (c[base0 + i] ?? 0) * (1 - s) + (c[base1 + i] ?? 0) * s;
    outX2[i] = (c[base0 + 3 + i] ?? 0) * (1 - s) + (c[base1 + 3 + i] ?? 0) * s;
  }
}

/** Map a normalized timeline phase [0,1] to internal model time. */
export function phaseToModelTime(ds: Gc1Dataset, phase01: number): number {
  const p = Math.min(1, Math.max(0, phase01));
  return ds.tStart + p * (ds.tEnd - ds.tStart);
}
