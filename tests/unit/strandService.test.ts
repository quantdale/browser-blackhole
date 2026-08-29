import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { StrandService } from '../../src/renderer/shared/StrandService.js';

function config() {
  return {
    segments: 4,
    radialSegments: 8,
    widthStart: 2,
    widthEnd: 0.5,
    aspectStart: 0.8,
    aspectEnd: 0.35,
    opacityStart: 0.9,
    opacityEnd: 0.1,
    colorStart: [1, 0.8, 0.4] as [number, number, number],
    colorEnd: [0.2, 0.4, 1] as [number, number, number],
    temperatureVariation: 0.3,
    clumpStrength: 0.4,
    clumpSeed: 17,
    additive: true
  };
}

describe('StrandService', () => {
  it('builds a non-flat transported tube whose ring centers preserve the spine', () => {
    const service = new StrandService();
    const strand = service.createStrand(config());
    const spine = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0.2, 0.4),
      new THREE.Vector3(2, 0.7, 0.5),
      new THREE.Vector3(3, 1.3, 0.1),
      new THREE.Vector3(4, 1.6, -0.4)
    ];
    strand.setSpine(spine);
    const mesh = strand.object3d().children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute('position').array as Float32Array;
    const radial = 8;
    for (let i = 0; i < spine.length; i += 1) {
      const center = new THREE.Vector3();
      for (let j = 0; j < radial; j += 1) {
        const offset = (i * (radial + 1) + j) * 3;
        center.add(
          new THREE.Vector3(positions[offset]!, positions[offset + 1]!, positions[offset + 2]!)
        );
      }
      center.multiplyScalar(1 / radial);
      expect(center.distanceTo(spine[i]!)).toBeLessThan(1e-5);
    }
    const firstRadius = Math.hypot(positions[0]! - positions[3]!, positions[1]! - positions[4]!);
    const lastOffset = (spine.length - 1) * (radial + 1) * 3;
    const lastRadius = Math.hypot(
      positions[lastOffset]! - positions[lastOffset + 3]!,
      positions[lastOffset + 1]! - positions[lastOffset + 4]!
    );
    expect(firstRadius).toBeGreaterThan(lastRadius);
    expect(strand.getDebugSnapshot?.()).toMatchObject({
      representation: 'tube',
      pointCount: spine.length,
      radialSegments: radial,
      authoritativeSpine: true
    });
    service.dispose();
  });

  it('is deterministic and exposes a bounded quality fallback', () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 2, 0)
    ];
    const a = new StrandService();
    const b = new StrandService();
    const strandA = a.createStrand(config());
    const strandB = b.createStrand(config());
    strandA.setSpine(points);
    strandB.setSpine(points);
    const positionsA = (
      (strandA.object3d().children[0] as THREE.Mesh).geometry as THREE.BufferGeometry
    ).getAttribute('position').array;
    const positionsB = (
      (strandB.object3d().children[0] as THREE.Mesh).geometry as THREE.BufferGeometry
    ).getAttribute('position').array;
    expect(Array.from(positionsA)).toEqual(Array.from(positionsB));
    strandA.setQuality(0);
    expect(strandA.object3d().visible).toBe(false);
    a.dispose();
    b.dispose();
  });
});
