/**
 * LUT asset binary encoding (M8-03).
 *
 * Deterministic, endianness-explicit little-endian serialization of texel
 * grids into the formats declared in lut/types.ts. Float32 paths use the
 * platform DataView (IEEE-754 exact); Float16 uses an explicit
 * round-to-nearest-even converter with denormal/overflow handling so
 * generation is reproducible across platforms regardless of any future
 * native f16 hardware paths.
 *
 * DRIFT POLICY: encode(f32) -> decode -> encode must be bit-stable; tests
 * pin known-good byte patterns. Format selection itself is a measured
 * decision recorded in the manifest (LUT_BACKEND_ADR.md §9) — this module
 * never chooses formats, it only serializes what the family build asks for.
 */

import type { LutTextureFormat } from '../../src/phenomena/black-hole/lut/types.js';

// ---------------------------------------------------------------------------
// IEEE-754 binary16 conversion (round-to-nearest, ties-to-even)
// ---------------------------------------------------------------------------

const F32_VIEW = new DataView(new ArrayBuffer(4));
const F16_INFINITY = 0x7c00;

/**
 * Converts a Number (float64 holding an f32-representable value) to IEEE-754
 * binary16 bits. NaN maps to the canonical quiet NaN 0x7e00; +/-Inf to
 * 0x7c00/0xfc00; overflow saturates to infinity; subnormals keep f16's own
 * subnormal form with correct rounding.
 */
export function floatToHalfBits(value: number): number {
  if (Number.isNaN(value)) return 0x7e00;
  F32_VIEW.setFloat32(0, value, true);
  const bits = F32_VIEW.getUint32(0, true);
  const sign = (bits >>> 16) & 0x8000;
  const exp32 = (bits >>> 23) & 0xff;
  const mant32 = bits & 0x007fffff;
  if (exp32 === 0xff) return sign | F16_INFINITY;

  // Re-bias exponent: f32 bias 127 -> f16 bias 15.
  const exp16 = exp32 - 127 + 15;
  if (exp16 >= 0x1f) return sign | F16_INFINITY; // overflow -> Inf
  if (exp16 <= 0) {
    // Denormal or underflow-to-zero with round-to-nearest-even.
    if (exp16 < -10) return sign; // magnitude < 2^-25 rounds to zero
    const mant = mant32 | 0x00800000; // implicit leading 1
    const shift = 14 - exp16; // 14..24
    const half = mant >>> shift;
    const remainder = mant & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    const rounded =
      remainder > halfway || (remainder === halfway && (half & 1) === 1) ? half + 1 : half;
    return sign | rounded; // may carry into the normal range; that is correct
  }
  const half = mant32 >>> 13;
  const remainder = mant32 & 0x1fff;
  const rounded =
    remainder > 0x1000 || (remainder === 0x1000 && (half & 1) === 1) ? half + 1 : half;
  if (rounded === 0x400) return sign | ((exp16 + 1) << 10); // mantissa carry
  return sign | (exp16 << 10) | rounded;
}

/** Exact inverse of {@link floatToHalfBits} for inspection/tests. */
export function halfBitsToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >>> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0x1f) return mant === 0 ? sign * Infinity : NaN;
  if (exp === 0) {
    if (mant === 0) return sign * 0;
    return sign * mant * Math.pow(2, -24); // denormal: mant * 2^-10 * 2^-14
  }
  return sign * (1 + mant / 1024) * Math.pow(2, exp - 15);
}

// ---------------------------------------------------------------------------
// Texel grid serialization
// ---------------------------------------------------------------------------

export interface EncodedTexture {
  readonly bytes: Uint8Array;
  readonly format: LutTextureFormat;
}

interface TexelSource {
  /** channels[texelIndex * channelCount + c]. */
  readonly data: Float64Array;
  readonly width: number;
  readonly height: number;
  readonly channelCount: number;
}

function channelCountOf(format: LutTextureFormat): number {
  switch (format) {
    case 'r16f':
    case 'r32f':
      return 1;
    case 'rg16f':
    case 'rg32f':
      return 2;
    case 'rgba16f':
    case 'rgba32f':
      return 4;
  }
}

/**
 * Serializes a texel grid. Values pass through Math.fround first so the
 * f32 formats store exactly the f32-rounded value (making checksums stable
 * even if callers hand in wider intermediates), and the f16 formats receive
 * correctly-rounded input.
 */
export function encodeTexture(source: TexelSource, format: LutTextureFormat): EncodedTexture {
  const channels = channelCountOf(format);
  if (source.channelCount !== channels) {
    throw new RangeError(`format ${format} needs ${channels} channels, got ${source.channelCount}`);
  }
  const texels = source.width * source.height;
  const is16 = format.endsWith('16f');
  const bytesPerTexel = channels * (is16 ? 2 : 4);
  const bytes = new Uint8Array(texels * bytesPerTexel);
  const view = new DataView(bytes.buffer);

  for (let t = 0; t < texels; t += 1) {
    for (let c = 0; c < channels; c += 1) {
      const v = Math.fround(source.data[t * channels + c]!);
      const offset = t * bytesPerTexel + c * (is16 ? 2 : 4);
      if (is16) view.setUint16(offset, floatToHalfBits(v), true);
      else view.setFloat32(offset, v, true);
    }
  }
  return { bytes, format };
}

/**
 * Decodes an asset back to texel values (validation roundtrip + CPU-side
 * sampling reference used by the equivalence corpus).
 */
export function decodeTexture(bytes: Uint8Array, format: LutTextureFormat): Float64Array {
  const channels = channelCountOf(format);
  const is16 = format.endsWith('16f');
  const bytesPerTexel = channels * (is16 ? 2 : 4);
  if (bytes.length % bytesPerTexel !== 0) {
    throw new RangeError(`byte length ${bytes.length} not a multiple of ${bytesPerTexel}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const texels = bytes.length / bytesPerTexel;
  const out = new Float64Array(texels * channels);
  for (let t = 0; t < texels; t += 1) {
    for (let c = 0; c < channels; c += 1) {
      const offset = t * bytesPerTexel + c * (is16 ? 2 : 4);
      out[t * channels + c] = is16
        ? halfBitsToFloat(view.getUint16(offset, true))
        : view.getFloat32(offset, true);
    }
  }
  return out;
}
