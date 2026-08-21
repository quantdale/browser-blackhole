import { describe, expect, it } from 'vitest';
import { Matrix4 } from 'three/webgpu';
import {
  extractBasisFromMatrix,
  lookAtMatrix,
  type CameraBasis
} from '../../src/camera/CameraController.js';
import { makeCameraRayDirection, type CameraRayParams } from '../../src/shaders/cameraRayMath.js';

function basisFor(eye: [number, number, number], target: [number, number, number]): CameraBasis {
  const m = lookAtMatrix(eye, target, [0, 1, 0]);
  return extractBasisFromMatrix(m.elements, { x: eye[0], y: eye[1], z: eye[2] }, 60, 1.5);
}

function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

describe('extractBasisFromMatrix: canonical camera basis', () => {
  function expectVecClose(actual: number[], expected: number[]): void {
    expect(actual.length).toBe(expected.length);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i] as number, 12));
  }

  it('identity orientation looks down -Z with +X right and +Y up', () => {
    const m = new Matrix4().identity();
    const basis = extractBasisFromMatrix(m.elements, { x: 0, y: 0, z: 10 }, 60, 1);
    expectVecClose(basis.right, [1, 0, 0]);
    expectVecClose(basis.up, [0, 1, 0]);
    expectVecClose(basis.forward, [0, 0, -1]);
    expectVecClose(basis.position, [0, 0, 10]);
  });

  it('camera at +Z looking at origin has forward -Z', () => {
    const basis = basisFor([0, 0, 30], [0, 0, 0]);
    expect(basis.forward[0]).toBeCloseTo(0, 12);
    expect(basis.forward[1]).toBeCloseTo(0, 12);
    expect(basis.forward[2]).toBeCloseTo(-1, 12);
  });

  it('camera on +X orbit looking at origin has forward -X', () => {
    const basis = basisFor([30, 0, 0], [0, 0, 0]);
    expect(basis.forward[0]).toBeCloseTo(-1, 12);
    expect(basis.forward[2]).toBeCloseTo(0, 12);
  });

  it('basis is orthonormal for an oblique view', () => {
    const basis = basisFor([12, 8, 25], [0, 0, 0]);
    const axes = [basis.right, basis.up, basis.forward];
    for (const axis of axes) {
      expect(Math.hypot(...axis)).toBeCloseTo(1, 9);
    }
    expect(Math.abs(dot(basis.right, basis.up))).toBeLessThan(1e-9);
    expect(Math.abs(dot(basis.right, basis.forward))).toBeLessThan(1e-9);
    expect(Math.abs(dot(basis.up, basis.forward))).toBeLessThan(1e-9);
  });

  it('tanHalfFovY matches tan(fov/2)', () => {
    const m = new Matrix4().identity();
    const basis = extractBasisFromMatrix(m.elements, { x: 0, y: 0, z: 1 }, 60, 2);
    expect(basis.tanHalfFovY).toBeCloseTo(Math.tan(Math.PI / 6), 12);
  });
});

describe('makeCameraRayDirection: ray reconstruction contract', () => {
  const params: CameraRayParams = {
    position: [0, 0, 30],
    right: [1, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, -1],
    tanHalfFovY: Math.tan(Math.PI / 6), // fovY 60deg
    aspect: 1.5
  };

  it('center NDC maps exactly to camera forward', () => {
    const { direction } = makeCameraRayDirection(0, 0, params);
    expect(direction[0]).toBeCloseTo(0, 12);
    expect(direction[1]).toBeCloseTo(0, 12);
    expect(direction[2]).toBeCloseTo(-1, 12);
  });

  it('right-edge pixel has positive right component; top edge positive up', () => {
    const rightEdge = makeCameraRayDirection(1, 0, params).direction;
    expect(dot(rightEdge, params.right)).toBeGreaterThan(0);
    const topEdge = makeCameraRayDirection(0, 1, params).direction;
    expect(dot(topEdge, params.up)).toBeGreaterThan(0);
    const leftEdge = makeCameraRayDirection(-1, 0, params).direction;
    expect(dot(leftEdge, params.right)).toBeLessThan(0);
  });

  it('directions are unit length across the frame', () => {
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [-1, 0.5],
      [0.3, -0.7]
    ] as const) {
      const { direction } = makeCameraRayDirection(x, y, params);
      expect(Math.hypot(...direction)).toBeCloseTo(1, 12);
    }
  });

  /** Half-angle between a ray direction and forward, in radians. */
  function spreadAngle(direction: number[], params: CameraRayParams): number {
    return Math.acos(dot(direction, params.forward));
  }

  it('aspect widens horizontal spread only', () => {
    const wide = makeCameraRayDirection(1, 0, { ...params, aspect: 2 }).direction;
    const narrow = makeCameraRayDirection(1, 0, { ...params, aspect: 0.5 }).direction;
    expect(spreadAngle(wide, params)).toBeGreaterThan(spreadAngle(narrow, params));
    // Vertical spread is unchanged by aspect.
    const upWide = makeCameraRayDirection(0, 1, { ...params, aspect: 2 }).direction;
    const upNarrow = makeCameraRayDirection(0, 1, { ...params, aspect: 0.5 }).direction;
    expect(dot(upWide, params.up)).toBeCloseTo(dot(upNarrow, params.up), 12);
  });

  it('FOV increases angular spread monotonically', () => {
    const small = makeCameraRayDirection(1, 0, { ...params, tanHalfFovY: 0.2 }).direction;
    const large = makeCameraRayDirection(1, 0, { ...params, tanHalfFovY: 1.0 }).direction;
    expect(spreadAngle(small, params)).toBeLessThan(spreadAngle(large, params));
  });
});
