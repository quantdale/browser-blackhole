/**
 * Canonical world/environment frame (docs/WORLD_FRAME.md).
 *
 * This module is the single authority for world-frame conventions:
 * handedness, axes, black-hole center placement, default disk normal,
 * and the world-direction -> sky-coordinate mapping used for
 * environment sampling (docs/SHADER_CONTRACTS.md section 9).
 *
 * No other module may independently reinterpret axes or redefine the
 * sky mapping; import from here instead.
 *
 * Conventions (chosen here because the existing docs are silent;
 * see docs/WORLD_FRAME.md section 1):
 *   - Right-handed coordinate system.
 *   - +Y is world up; the equatorial plane is the XZ plane.
 *   - +X right, +Z toward the default viewer side.
 *   - Black-hole center is exactly the world origin.
 *   - Default disk/spin axis normal is +Y (thin disk lies in XZ).
 *   - Sky coordinates: polar angle theta measured from +Y (north
 *     pole), azimuth phi measured around +Y starting from +X and
 *     increasing toward +Z (right-handed rotation about +Y).
 */

import type { Vec3 } from '../shaders/cameraRayMath.js';

export type { Vec3 };

/** World up axis; also the default disk/spin-axis normal. */
export const WORLD_UP: Vec3 = [0, 1, 0];

/** Canonical black-hole center: the world origin, in r_g units. */
export const BLACK_HOLE_CENTER: Vec3 = [0, 0, 0];

/** Default thin-disk normal (Schwarzschild scene convention). */
export const DEFAULT_DISK_NORMAL: Vec3 = [0, 1, 0];

/** Sky north pole direction for environment sampling. */
export const SKY_NORTH_POLE: Vec3 = [0, 1, 0];

/** Azimuth-zero reference direction for environment sampling. */
export const SKY_AZIMUTH_ZERO: Vec3 = [1, 0, 0];

export interface SkyCoord {
  /** Polar angle from +Y, radians in [0, PI]. */
  theta: number;
  /** Azimuth around +Y from +X toward +Z, radians in (-PI, PI]. */
  phi: number;
}

/**
 * Maps a normalized world direction to sky coordinates.
 *
 * At the poles the azimuth is degenerate; this function returns
 * `phi = 0` there so the mapping stays deterministic. Input need not
 * be perfectly unit length (it is normalized defensively), but a
 * zero vector yields theta = 0 by the same safe-length fallback used
 * in camera-ray reconstruction.
 */
export function directionToSky(direction: Vec3): SkyCoord {
  const len = Math.hypot(...direction);
  const safeLen = len > 1e-12 ? len : 1;
  const y = direction[1] / safeLen;
  const clampedY = Math.min(1, Math.max(-1, y));
  const theta = Math.acos(clampedY);
  if (Math.abs(clampedY) >= 1 - 1e-12) {
    return { theta, phi: 0 };
  }
  let phi = Math.atan2(direction[2], direction[0]);
  if (phi <= -Math.PI) {
    phi = Math.PI;
  }
  return { theta, phi };
}

/**
 * Inverse of `directionToSky`: builds the normalized world direction
 * for sky coordinates. Poles map back with `phi` ignored (the
 * returned direction is exact regardless of its value).
 */
export function skyToDirection(coord: SkyCoord): Vec3 {
  const sinTheta = Math.sin(coord.theta);
  return [
    sinTheta * Math.cos(coord.phi),
    Math.cos(coord.theta),
    sinTheta * Math.sin(coord.phi)
  ];
}
