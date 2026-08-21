import { describe, expect, it } from 'vitest';
import {
  BLACK_HOLE_CENTER,
  DEFAULT_DISK_NORMAL,
  SKY_AZIMUTH_ZERO,
  SKY_NORTH_POLE,
  WORLD_UP,
  directionToSky,
  skyToDirection,
  type Vec3
} from '../../src/physics/worldFrame.js';

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function expectVecClose(actual: Vec3, expected: Vec3, digits = 12): void {
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i] as number, digits));
}

describe('worldFrame: canonical constants', () => {
  it('black-hole center is exactly the origin', () => {
    expectVecClose(BLACK_HOLE_CENTER, [0, 0, 0]);
    expect(BLACK_HOLE_CENTER).toEqual([0, 0, 0]);
  });

  it('default disk normal equals world up and is unit length', () => {
    expectVecClose(DEFAULT_DISK_NORMAL, [0, 1, 0]);
    expectVecClose(WORLD_UP, [0, 1, 0]);
    expect(Math.hypot(...DEFAULT_DISK_NORMAL)).toBeCloseTo(1, 12);
  });

  it('sky pole matches world up; azimuth zero is +X', () => {
    expectVecClose(SKY_NORTH_POLE, [0, 1, 0]);
    expectVecClose(SKY_AZIMUTH_ZERO, [1, 0, 0]);
  });
});

describe('worldFrame: handedness', () => {
  const X: Vec3 = [1, 0, 0];
  const Y: Vec3 = [0, 1, 0];
  const Z: Vec3 = [0, 0, 1];

  it('is right-handed: cross(X, Y) = Z (and cyclic)', () => {
    expectVecClose(cross(X, Y), Z);
    expectVecClose(cross(Y, Z), X);
    expectVecClose(cross(Z, X), Y);
  });

  it('left-handed orientation would give -Z and must fail', () => {
    expect(cross(X, Y)[2]).not.toBeCloseTo(-1, 12);
  });

  it('azimuth increases from +X toward +Z (right-handed rotation about +Y)', () => {
    const quarter = skyToDirection({ theta: Math.PI / 2, phi: Math.PI / 2 });
    expectVecClose(quarter, [0, 0, 1]);
    const small = directionToSky(skyToDirection({ theta: Math.PI / 2, phi: 0.25 }));
    expect(small.phi).toBeCloseTo(0.25, 12);
  });

  it('disk normal is orthogonal to the equatorial plane directions', () => {
    for (const d of [X, Z, [1, 0, 1] as Vec3]) {
      expect(cross(DEFAULT_DISK_NORMAL, d)).not.toEqual([0, 0, 0]);
      const dot = DEFAULT_DISK_NORMAL[0] * d[0] + DEFAULT_DISK_NORMAL[1] * d[1] +
        DEFAULT_DISK_NORMAL[2] * d[2];
      expect(dot).toBeCloseTo(0, 12);
    }
  });

  it('disk normal vs sky pole: they coincide by convention', () => {
    expectVecClose(DEFAULT_DISK_NORMAL, SKY_NORTH_POLE);
  });
});

describe('worldFrame: direction <-> sky round trip', () => {
  function roundTrip(d: Vec3): Vec3 {
    return skyToDirection(directionToSky(d));
  }

  it('equator cardinal directions round-trip exactly', () => {
    expectVecClose(roundTrip([1, 0, 0]), [1, 0, 0]);
    expectVecClose(roundTrip([0, 0, 1]), [0, 0, 1]);
    expectVecClose(roundTrip([-1, 0, 0]), [-1, 0, 0]);
    expectVecClose(roundTrip([0, 0, -1]), [0, 0, -1]);
  });

  it('poles round-trip regardless of degenerate azimuth', () => {
    expectVecClose(roundTrip([0, 1, 0]), [0, 1, 0]);
    expectVecClose(roundTrip([0, -1, 0]), [0, -1, 0]);
    // Pole azimuth is pinned to 0.
    expect(directionToSky([0, 1, 0]).phi).toBe(0);
    expect(directionToSky([0, -1, 0]).phi).toBe(0);
  });

  it('oblique directions round-trip within double precision', () => {
    const samples: Vec3[] = [
      [1, 1, 1],
      [-2, 0.5, 3],
      [0.1, -4, 0.7],
      [5, 0, -5]
    ];
    for (const d of samples) {
      const out = roundTrip(d);
      const len = Math.hypot(...d);
      expectVecClose(out, [d[0] / len, d[1] / len, d[2] / len], 9);
    }
  });

  it('theta/phi ranges are respected', () => {
    expect(directionToSky([0, 1, 0]).theta).toBeCloseTo(0, 12);
    expect(directionToSky([0, -1, 0]).theta).toBeCloseTo(Math.PI, 12);
    for (const d of [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]] as Vec3[]) {
      expect(directionToSky(d).theta).toBeCloseTo(Math.PI / 2, 12);
    }
    // atan2(z, x) in (-PI, PI]: +Z-heavy directions get positive phi.
    const { phi } = directionToSky([-1, 0, 1]);
    expect(phi).toBeGreaterThan(0);
    expect(phi).toBeLessThanOrEqual(Math.PI);
    expect(directionToSky([-1, 0, -1]).phi).toBeCloseTo((-3 * Math.PI) / 4, 12);
  });

  it('non-unit inputs are normalized before mapping', () => {
    const c = directionToSky([10, 0, 0]);
    expect(c.theta).toBeCloseTo(Math.PI / 2, 12);
    expect(c.phi).toBeCloseTo(0, 12);
  });
});
