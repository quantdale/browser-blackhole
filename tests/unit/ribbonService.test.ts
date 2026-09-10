import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { RibbonService } from '../../src/renderer/shared/RibbonService.js';
import type { RibbonConfig } from '../../src/atlas/types.js';

/**
 * WS6 §11.2 — ribbon/buffer revisioning. Destinations gate their own
 * model-time revisions; these tests pin the SERVICE-level guarantees the
 * campaign asks for: an unchanged spine does not rebuild or upload, changed
 * geometry does, and the maintained bounds make ordinary frustum culling
 * conservative-correct.
 */

function config(): RibbonConfig {
  return {
    segments: 8,
    widthStart: 2,
    widthEnd: 0.5,
    colorStart: [1, 0, 0],
    colorEnd: [0, 0, 1],
    additive: true,
    taper: 'linear'
  };
}

function stripMesh(ribbon: ReturnType<RibbonService['createRibbon']>): THREE.Mesh {
  const group = ribbon.object3d() as THREE.Group;
  return group.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
}

describe('RibbonService revision gating and conservative bounds', () => {
  it('skips rebuild/upload for a value-identical spine and uploads on change', () => {
    const service = new RibbonService();
    const ribbon = service.createRibbon(config());
    const mesh = stripMesh(ribbon);
    const positionAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const startVersion = positionAttr.version;

    const spine = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0)
    ];
    ribbon.setSpine(spine);
    expect(positionAttr.version).toBe(startVersion + 1);

    // Fresh objects with identical values: still no second upload.
    ribbon.setSpine(spine.map((p) => p.clone()));
    expect(positionAttr.version).toBe(startVersion + 1);

    spine[1]!.y = 0.5;
    ribbon.setSpine(spine);
    expect(positionAttr.version).toBe(startVersion + 2);
    service.dispose();
  });

  it('maintains a conservative bounding sphere and enables culling', () => {
    const service = new RibbonService();
    const ribbon = service.createRibbon(config());
    const mesh = stripMesh(ribbon);
    expect(mesh.frustumCulled).toBe(true);

    const spine = [
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(12, 0, 1),
      new THREE.Vector3(14, 1, 0)
    ];
    ribbon.setSpine(spine);
    const sphere = mesh.geometry.boundingSphere;
    expect(sphere).not.toBeNull();
    for (const point of spine) {
      expect(sphere!.containsPoint(point)).toBe(true);
    }
    service.dispose();
  });
});
