/**
 * Pure CPU mirror of the shader-side camera-ray reconstruction
 * (docs/SHADER_CONTRACTS.md section 3).
 *
 * NDC convention (documented once, here):
 *   - x: -1 left edge .. +1 right edge
 *   - y: -1 bottom edge .. +1 top edge
 *   - center pixel is (0, 0) and maps exactly to `forward`
 *
 * The TSL diagnostic graph in src/shaders/diagnostic.ts must stay consistent
 * with this function; tests compare both contracts' inputs/outputs.
 */

export type Vec3 = [number, number, number];

export interface CameraRayParams {
  position: Vec3;
  /** Orthonormal basis; right/up/forward must be unit length. */
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  tanHalfFovY: number;
  aspect: number;
}

export interface RayComponents {
  /** Unnormalized direction before normalization. */
  unnormalized: Vec3;
  /** Normalized world-space direction. */
  direction: Vec3;
}

export function makeCameraRayDirection(
  ndcX: number,
  ndcY: number,
  p: CameraRayParams
): RayComponents {
  const halfW = p.tanHalfFovY * p.aspect;
  const halfH = p.tanHalfFovY;
  const dx = ndcX * halfW;
  const dy = ndcY * halfH;
  const unnormalized: Vec3 = [
    p.forward[0] + p.right[0] * dx + p.up[0] * dy,
    p.forward[1] + p.right[1] * dx + p.up[1] * dy,
    p.forward[2] + p.right[2] * dx + p.up[2] * dy
  ];
  const len = Math.hypot(...unnormalized);
  const safeLen = len > 1e-12 ? len : 1;
  return {
    unnormalized,
    direction: [unnormalized[0] / safeLen, unnormalized[1] / safeLen, unnormalized[2] / safeLen]
  };
}

export interface PixelNdc {
  ndcX: number;
  ndcY: number;
}

/**
 * Maps a pixel CENTER (integer coordinates, origin top-left, y down) to NDC
 * (+x right, +y up). This is the single shared convention between the CPU
 * reference and browser-side sampling; the full-screen triangle interpolates
 * clip-space xy linearly, so pixel centers follow exactly this mapping for
 * odd and even resolutions alike. Only an odd-sized frame has a pixel whose
 * center is exactly NDC (0, 0).
 */
export function pixelToNdc(
  pixelX: number,
  pixelY: number,
  width: number,
  height: number
): PixelNdc {
  const ndcX = ((pixelX + 0.5) / width) * 2 - 1;
  const ndcY = 1 - ((pixelY + 0.5) / height) * 2;
  return { ndcX, ndcY };
}
