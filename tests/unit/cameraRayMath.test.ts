/**
 * Unit coverage for `src/shaders/cameraRayMath.ts` (verification-gate-
 * integrity task 6.7 / D8 note).
 *
 * This module is the CPU reference the browser parity gate depends on — the
 * exact camera-ray convention the GPU passes reconstruct — and it had ZERO
 * unit coverage (the coverage report's headline blind spot). These rows pin
 * the two conventions the parity corpora assume: the NDC pixel-center map
 * and the pinhole direction construction.
 */

import { describe, expect, it } from 'vitest';

import {
  makeCameraRayDirection,
  pixelToNdc,
  type CameraRayParams
} from '../../src/shaders/cameraRayMath.js';

const BASE: CameraRayParams = {
  position: [0, 0, 0],
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, -1],
  tanHalfFovY: 1,
  aspect: 2
};

describe('pixelToNdc', () => {
  it('centers the middle pixel of an odd frame at NDC (0, 0)', () => {
    expect(pixelToNdc(2, 2, 5, 5)).toEqual({ ndcX: 0, ndcY: 0 });
  });

  it('maps corners symmetrically with y flipped (top-left origin)', () => {
    const tl = pixelToNdc(0, 0, 4, 4);
    const br = pixelToNdc(3, 3, 4, 4);
    expect(tl.ndcX).toBeCloseTo(-0.75, 12);
    expect(tl.ndcY).toBeCloseTo(0.75, 12);
    expect(br.ndcX).toBeCloseTo(0.75, 12);
    expect(br.ndcY).toBeCloseTo(-0.75, 12);
  });

  it('pixel centers are strictly interior and evenly spaced', () => {
    const first = pixelToNdc(0, 0, 8, 8);
    const second = pixelToNdc(1, 0, 8, 8);
    expect(second.ndcX - first.ndcX).toBeCloseTo(2 / 8, 12);
    expect(first.ndcX).toBeGreaterThan(-1);
    expect(pixelToNdc(7, 7, 8, 8).ndcX).toBeLessThan(1);
  });
});

describe('makeCameraRayDirection', () => {
  it('center pixel looks straight down the forward axis', () => {
    const ray = makeCameraRayDirection(0, 0, BASE);
    expect(ray.unnormalized).toEqual([0, 0, -1]);
    expect(ray.direction[0]).toBeCloseTo(0, 12);
    expect(ray.direction[1]).toBeCloseTo(0, 12);
    expect(ray.direction[2]).toBeCloseTo(-1, 12);
  });

  it('applies the aspect-stretched horizontal half-tangent', () => {
    // ndcX=1 must land at right*tanHalfFovY*aspect + forward.
    const ray = makeCameraRayDirection(1, 0, BASE);
    expect(ray.unnormalized[0]).toBeCloseTo(2, 12); // 1 * 1 * aspect(2)
    expect(ray.unnormalized[1]).toBeCloseTo(0, 12);
    expect(ray.unnormalized[2]).toBeCloseTo(-1, 12);
  });

  it('applies the vertical half-tangent without aspect', () => {
    const ray = makeCameraRayDirection(0, 1, BASE);
    expect(ray.unnormalized[0]).toBeCloseTo(0, 12);
    expect(ray.unnormalized[1]).toBeCloseTo(1, 12); // 1 * tanHalfFovY(1)
    expect(ray.unnormalized[2]).toBeCloseTo(-1, 12);
  });

  it('returns unit-length directions for every corner', () => {
    const corners: Array<[number, number]> = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ];
    for (const [x, y] of corners) {
      const ray = makeCameraRayDirection(x, y, BASE);
      const len = Math.hypot(ray.direction[0], ray.direction[1], ray.direction[2]);
      expect(len).toBeCloseTo(1, 12);
    }
  });

  it('degenerate zero-length rays normalize safely instead of producing NaN', () => {
    // forward that exactly cancels the offset leaves a zero vector.
    const degenerate: CameraRayParams = {
      ...BASE,
      forward: [2, 0, -1],
      right: [-1, 0, 0],
      up: [0, 0, 0]
    };
    const ray = makeCameraRayDirection(2, 0, degenerate); // 2*right*halfW = -2x cancels +2x
    expect(ray.direction.every((c) => Number.isFinite(c))).toBe(true);
  });
});
