/**
 * BBM1 runtime binary decoder — strict, fail-closed (CA8-08/09/10).
 *
 * Format contract (tools/cosmic-data/reduce_bbh_merger.py HEADER_STRUCT,
 * docs/cosmic-atlas/DATA_PIPELINE.md §4):
 *
 *   Little-endian. Fixed 160-byte header:
 *     0   4s  magic "BBM1"
 *     4   u32 schemaVersion
 *     8   u32 headerBytes (=160)
 *     12  u32 sampleCount
 *     16  u32 mergerIndex
 *     20  u32 reserved (0)
 *     24  f64 tStartM (<=0)
 *     32  f64 tEndM (>=0)
 *     40  f64 m1OverM      48 f64 m2OverM
 *     56  f64 chi1z        64 f64 chi2z
 *     72  f64 remnantMassOverM
 *     80  f64 remnantChiMag
 *     88  f64 remnantChiZ
 *     96  f64 separationStartM
 *     104 f64 h22PeakAmplitude
 *     112 f64 mergerEndM   120 f64 ringdownEndM
 *     128 32s ascii assetId (NUL padded)
 *
 *   Then sampleCount rows of 9 float32: timeM, bhA.xyz, bhB.xyz, h22Re,
 *   h22Im.
 *
 * The decoder NEVER partially activates: any violation of magic, schema
 * version, byte length, finiteness, monotonic time, anchor bounds or channel
 * ranges rejects the whole payload with a structured BbmLoadError.
 */

export const BBM1_MAGIC = 0x314d4242; // "BBM1" little-endian
export const BBM1_SCHEMA_VERSION = 1;
const HEADER_BYTES = 160;
const FLOAT32_BYTES = 4;
const ROW_FLOATS = 9;

/** Structured failure taxonomy (machine-readable; mirrors lutSchema). */
export type BbmFailureCode =
  | 'bad-magic'
  | 'bad-schema-version'
  | 'bad-header-length'
  | 'bad-byte-length'
  | 'bad-sample-count'
  | 'bad-merger-index'
  | 'bad-asset-id'
  | 'non-finite-values'
  | 'non-monotonic-time'
  | 'impossible-channel-range'
  | 'checksum-mismatch';

const FAILURE_MESSAGES: Record<BbmFailureCode, string> = {
  'bad-magic': 'not a BBM1 payload (magic mismatch)',
  'bad-schema-version': 'unsupported BBM1 schema version',
  'bad-header-length': 'header length field mismatch',
  'bad-byte-length': 'byte length does not match header sample count',
  'bad-sample-count': 'sample count out of bounds',
  'bad-merger-index': 'merger index outside the sample range',
  'bad-asset-id': 'embedded asset id mismatch',
  'non-finite-values': 'non-finite value in numeric channels',
  'non-monotonic-time': 'time channel is not strictly increasing',
  'impossible-channel-range': 'channel value outside the documented physical range',
  'checksum-mismatch': 'payload failed SHA-256 verification'
};

export class BbmLoadError extends Error {
  readonly code: BbmFailureCode;
  constructor(code: BbmFailureCode, detail?: string) {
    super(`[black-hole-merger] ${FAILURE_MESSAGES[code]}${detail ? ` (${detail})` : ''}`);
    this.name = 'BbmLoadError';
    this.code = code;
  }
}

/** Decoded, validated dataset. Typed-array views are copied from the wire. */
export interface BbmDataset {
  readonly assetId: string;
  readonly schemaVersion: number;
  readonly sampleCount: number;
  /** Index of the merger anchor (t = 0, the source h22 amplitude peak). */
  readonly mergerIndex: number;
  /** Times in NR geometric M units relative to the peak; strictly rising. */
  readonly timesM: Float32Array;
  /** Horizon coordinate paths (GAUGE-DEPENDENT; DATA_SOURCES §4), units M. */
  readonly bhAxyz: Float32Array;
  readonly bhBxyz: Float32Array;
  /** h(l=2,m=+2) strain real/imag, dimensionless r*h/M. */
  readonly h22Re: Float32Array;
  readonly h22Im: Float32Array;
  // Header scalars (all data-derived):
  readonly tStartM: number;
  readonly tEndM: number;
  readonly m1OverM: number;
  readonly m2OverM: number;
  readonly chi1z: number;
  readonly chi2z: number;
  readonly remnantMassOverM: number;
  readonly remnantChiMag: number;
  readonly remnantChiZ: number;
  readonly separationStartM: number;
  readonly h22PeakAmplitude: number;
  /** Data-derived phase anchors: |h22| <= 0.35 / <= 0.08 of peak. */
  readonly mergerEndM: number;
  readonly ringdownEndM: number;
}

// Documented sanity ranges (DATA_SOURCES_BBH_MERGER.md conventions).
const MAX_SAMPLE_COUNT = 1 << 20;
const MAX_ABS_POSITION_M = 1e6;
const MAX_ABS_STRAIN = 100; // peak is ~0.39 for the pinned source

function readHeaderScalars(view: DataView): {
  scalars: number[];
  sampleCount: number;
  mergerIndex: number;
} {
  const schemaVersion = view.getUint32(4, true);
  if (schemaVersion !== BBM1_SCHEMA_VERSION) {
    throw new BbmLoadError('bad-schema-version', String(schemaVersion));
  }
  const headerBytes = view.getUint32(8, true);
  if (headerBytes !== HEADER_BYTES) {
    throw new BbmLoadError('bad-header-length', String(headerBytes));
  }
  const sampleCount = view.getUint32(12, true);
  if (sampleCount < 2 || sampleCount > MAX_SAMPLE_COUNT) {
    throw new BbmLoadError('bad-sample-count', String(sampleCount));
  }
  const mergerIndex = view.getUint32(16, true);
  if (mergerIndex >= sampleCount) {
    throw new BbmLoadError('bad-merger-index', String(mergerIndex));
  }
  const doubles: number[] = [];
  for (let i = 0; i < 13; i += 1) {
    doubles.push(view.getFloat64(24 + i * 8, true));
  }
  return { scalars: doubles, sampleCount, mergerIndex };
}

function readAssetId(view: DataView): string {
  let id = '';
  for (let i = 0; i < 32; i += 1) {
    const byte = view.getUint8(128 + i);
    if (byte === 0) break;
    id += String.fromCharCode(byte);
  }
  return id;
}

/**
 * Validate + decode a BBM1 payload. `expectedAssetId` and `expectedSha256`
 * come from the manifest; when provided they are enforced (fail closed).
 */
export function decodeBbm1(
  buffer: ArrayBuffer,
  expectedAssetId?: string,
  expectedSha256?: string
): BbmDataset {
  if (expectedSha256 !== undefined && sha256HexSync(buffer) !== expectedSha256.toLowerCase()) {
    throw new BbmLoadError('checksum-mismatch');
  }
  if (buffer.byteLength < HEADER_BYTES) {
    throw new BbmLoadError('bad-header-length', `${buffer.byteLength} bytes`);
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== BBM1_MAGIC) {
    throw new BbmLoadError('bad-magic');
  }

  const { scalars, sampleCount, mergerIndex } = readHeaderScalars(view);
  const assetId = readAssetId(view);
  if (expectedAssetId !== undefined && assetId !== expectedAssetId) {
    throw new BbmLoadError('bad-asset-id', `${assetId} != ${expectedAssetId}`);
  }

  const expectedBytes = HEADER_BYTES + sampleCount * ROW_FLOATS * FLOAT32_BYTES;
  if (buffer.byteLength !== expectedBytes) {
    throw new BbmLoadError(
      'bad-byte-length',
      `${buffer.byteLength} != ${expectedBytes} (${sampleCount} samples)`
    );
  }

  // Rows are interleaved (cache-friendly): [t, ax,ay,az, bx,by,bz, hRe, hIm]
  // per sample. De-interleave into planar channel arrays for consumers.
  const floats = new Float32Array(buffer, HEADER_BYTES, sampleCount * ROW_FLOATS);
  const timesM = new Float32Array(sampleCount);
  const bhAxyz = new Float32Array(sampleCount * 3);
  const bhBxyz = new Float32Array(sampleCount * 3);
  const h22Re = new Float32Array(sampleCount);
  const h22Im = new Float32Array(sampleCount);
  for (let r = 0; r < sampleCount; r += 1) {
    const o = r * ROW_FLOATS;
    timesM[r] = floats[o] as number;
    bhAxyz[r * 3] = floats[o + 1] as number;
    bhAxyz[r * 3 + 1] = floats[o + 2] as number;
    bhAxyz[r * 3 + 2] = floats[o + 3] as number;
    bhBxyz[r * 3] = floats[o + 4] as number;
    bhBxyz[r * 3 + 1] = floats[o + 5] as number;
    bhBxyz[r * 3 + 2] = floats[o + 6] as number;
    h22Re[r] = floats[o + 7] as number;
    h22Im[r] = floats[o + 8] as number;
  }

  // Finiteness + monotonic time + documented channel ranges.
  for (let i = 0; i < timesM.length; i += 1) {
    const value = timesM[i] as number;
    if (!Number.isFinite(value)) throw new BbmLoadError('non-finite-values', `time[${i}]`);
    if (i > 0 && !(value > (timesM[i - 1] as number))) {
      throw new BbmLoadError('non-monotonic-time', `index ${i}`);
    }
  }
  for (const channel of [bhAxyz, bhBxyz]) {
    for (let i = 0; i < channel.length; i += 1) {
      const value = channel[i] as number;
      if (!Number.isFinite(value)) throw new BbmLoadError('non-finite-values');
      if (Math.abs(value) > MAX_ABS_POSITION_M) {
        throw new BbmLoadError('impossible-channel-range', `position[${i}]`);
      }
    }
  }
  for (const channel of [h22Re, h22Im]) {
    for (let i = 0; i < channel.length; i += 1) {
      const value = channel[i] as number;
      if (!Number.isFinite(value)) throw new BbmLoadError('non-finite-values');
      if (Math.abs(value) > MAX_ABS_STRAIN) {
        throw new BbmLoadError('impossible-channel-range', `strain[${i}]`);
      }
    }
  }

  for (const scalar of scalars) {
    if (!Number.isFinite(scalar)) throw new BbmLoadError('non-finite-values', 'header scalar');
  }
  const lastTimeM = timesM[timesM.length - 1] as number;
  const peakAmplitude = scalars[10] as number;
  const mergerEndM = scalars[11] as number;
  const ringdownEndM = scalars[12] as number;
  if (!(peakAmplitude > 0) || !(mergerEndM >= 0) || ringdownEndM < mergerEndM) {
    throw new BbmLoadError('impossible-channel-range', 'phase anchors');
  }
  if (ringdownEndM > lastTimeM) {
    throw new BbmLoadError('impossible-channel-range', 'ringdown anchor beyond data');
  }

  return {
    assetId,
    schemaVersion: BBM1_SCHEMA_VERSION,
    sampleCount,
    mergerIndex,
    timesM,
    bhAxyz,
    bhBxyz,
    h22Re,
    h22Im,
    tStartM: scalars[0] as number,
    tEndM: scalars[1] as number,
    m1OverM: scalars[2] as number,
    m2OverM: scalars[3] as number,
    chi1z: scalars[4] as number,
    chi2z: scalars[5] as number,
    remnantMassOverM: scalars[6] as number,
    remnantChiMag: scalars[7] as number,
    remnantChiZ: scalars[8] as number,
    separationStartM: scalars[9] as number,
    h22PeakAmplitude: peakAmplitude,
    mergerEndM: mergerEndM,
    ringdownEndM: ringdownEndM
  };
}

/**
 * Synchronous SHA-256 (hex). Uses WebCrypto when available (browser and
 * Node>=21 global crypto); otherwise fails closed — checksum verification is
 * part of the runtime contract and must not be silently skipped.
 */
export function sha256HexSync(buffer: ArrayBuffer): string {
  // Synchronous by contract: decodeBbm1 is pure and the checksum is part of
  // its fail-closed validation, so a compact synchronous SHA-256 is used
  // (payload sizes here are bounded tens-of-KB).
  return sha256Pure(buffer);
}

function sha256Pure(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const bitLenHi = Math.floor(bytes.length / 0x20000000);
  const bitLenLo = (bytes.length << 3) >>> 0;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const withPadding = new Uint8Array(paddedLength);
  withPadding.set(bytes);
  withPadding[bytes.length] = 0x80;
  const dv = new DataView(withPadding.buffer);
  dv.setUint32(paddedLength - 8, bitLenHi, false);
  dv.setUint32(paddedLength - 4, bitLenLo, false);

  const H = SHA256_H.slice();
  const w = new Uint32Array(64);
  for (let block = 0; block < paddedLength; block += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = dv.getUint32(block + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15] as number;
      const y = w[i - 2] as number;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      const wi16 = w[i - 16] as number;
      const wi7 = w[i - 7] as number;
      w[i] = (wi16 + s0 + wi7 + s1) >>> 0;
    }
    let a = H[0] as number,
      b = H[1] as number,
      c = H[2] as number,
      d2 = H[3] as number,
      e = H[4] as number,
      f = H[5] as number,
      g = H[6] as number,
      h = H[7] as number;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + (SHA256_K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d2 + temp1) >>> 0;
      d2 = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    H[0] = ((H[0] as number) + a) >>> 0;
    H[1] = ((H[1] as number) + b) >>> 0;
    H[2] = ((H[2] as number) + c) >>> 0;
    H[3] = ((H[3] as number) + d2) >>> 0;
    H[4] = ((H[4] as number) + e) >>> 0;
    H[5] = ((H[5] as number) + f) >>> 0;
    H[6] = ((H[6] as number) + g) >>> 0;
    H[7] = ((H[7] as number) + h) >>> 0;
  }
  let hex = '';
  for (let i = 0; i < 8; i += 1) hex += ((H[i] ?? 0) >>> 0).toString(16).padStart(8, '0');
  return hex;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

const SHA256_H = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]);

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

// ---------------------------------------------------------------------------
// Bounded decoded-dataset cache (shared across prepare cycles; CA8-19 rules)
// ---------------------------------------------------------------------------

const MAX_CACHED_DATASETS = 2;
const datasetCache = new Map<string, BbmDataset>();

export function cacheDataset(dataset: BbmDataset): void {
  datasetCache.delete(dataset.assetId);
  datasetCache.set(dataset.assetId, dataset);
  while (datasetCache.size > MAX_CACHED_DATASETS) {
    const oldest = datasetCache.keys().next().value;
    if (oldest === undefined) break;
    datasetCache.delete(oldest);
  }
}

/** Cached dataset by asset id, or null (UI waveform panel reads this). */
export function getCachedDataset(assetId: string): BbmDataset | null {
  return datasetCache.get(assetId) ?? null;
}

export function clearDatasetCache(): void {
  datasetCache.clear();
}
