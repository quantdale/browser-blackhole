/**
 * GPU texture construction for a validated LUT family (M8-06, BH-164).
 *
 * Maps the wire formats of lut/types.ts onto Three.js GPU textures:
 *
 *   trajectory.bin  R16F    -> RedFormat  + HalfFloatType (W x H)
 *   aux-data.bin    RGBA16F -> RGBAFormat + HalfFloatType (W x 1)
 *
 * Both are core-texture-FILTERABLE in WebGL2 (ES 3.0 table 3.13) and map to
 * filterable float formats in WebGPU ('r16float'/'rgba16float'), matching
 * runtime.formatWebGL2Status. Upload re-packs f16 bits with the generator's
 * OWN round-to-nearest-even converter (tools encode.floatToHalfBits) so the
 * bits reaching the GPU are BIT-IDENTICAL to the shipped asset.
 *
 * Linear filtering + ClampToEdge + no mipmaps: exactly the interpolation
 * assumptions validated offline (texel-center bilinear over the shared span).
 * v=0 is texel row 0 = psi 0 = apsis, matching LutSampler row mapping.
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  RedFormat,
  RGBAFormat,
  type Texture
} from 'three';
import { decodeTexture, floatToHalfBits } from '../../../../tools/generate-luts/encode.js';
import { lutFormatBytesPerPixel, type LutManifest, type LutTextureEntry } from './types.js';

export interface LutGpuResources {
  readonly trajectoryTexture: Texture;
  readonly auxTexture: Texture;
  /** Estimated GPU bytes for resource-scope accounting. */
  readonly byteEstimate: number;
  dispose(): void;
}

function entryFor(manifest: LutManifest, id: string): LutTextureEntry | null {
  return manifest.textures.find((t) => t.id === id) ?? null;
}

/** Repacks decoded f64 texels into packed little-endian f16 halves (RNE). */
function packHalfFloats(values: Float64Array): Uint16Array {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = floatToHalfBits(values[i]!);
  return out;
}

export function buildLutGpuResources(
  manifest: LutManifest,
  assets: ReadonlyMap<string, Uint8Array>
): LutGpuResources {
  const trajEntry = entryFor(manifest, 'trajectory');
  const auxEntry = entryFor(manifest, 'aux');
  if (trajEntry === null || auxEntry === null) {
    throw new TypeError('LUT family lacks trajectory/aux texture entries');
  }

  function make(entry: LutTextureEntry, format: typeof RedFormat | typeof RGBAFormat): Texture {
    const bytes = assets.get(entry.file);
    if (bytes === undefined) throw new Error(`LUT asset missing: ${entry.file}`);
    if (bytes.byteLength !== entry.byteLength) {
      throw new Error(`LUT asset ${entry.file}: ${bytes.byteLength} != ${entry.byteLength}`);
    }
    const values = decodeTexture(bytes, entry.format);
    const halves = packHalfFloats(values);
    const tex = new DataTexture(halves, entry.width, entry.height, format, HalfFloatType);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  const trajectoryTexture = make(trajEntry, RedFormat);
  const auxTexture = make(auxEntry, RGBAFormat);

  const byteEstimate =
    trajEntry.width * trajEntry.height * lutFormatBytesPerPixel(trajEntry.format) +
    auxEntry.width * auxEntry.height * lutFormatBytesPerPixel(auxEntry.format);

  const textures: Texture[] = [trajectoryTexture, auxTexture];
  return {
    trajectoryTexture,
    auxTexture,
    byteEstimate,
    dispose(): void {
      for (const t of textures) t.dispose();
      textures.length = 0;
    }
  };
}
