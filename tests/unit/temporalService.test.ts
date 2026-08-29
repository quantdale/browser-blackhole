import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { ResourceScope } from '../../src/renderer/shared/ResourceScope.js';
import {
  TemporalService,
  halton,
  temporalJitter
} from '../../src/renderer/shared/TemporalService.js';
import type { RendererLike } from '../../src/atlas/types.js';

function fakeRenderer(): RendererLike {
  return {
    getRenderTarget: () => null,
    setRenderTarget: () => undefined,
    render: () => undefined
  } as unknown as RendererLike;
}

describe('TemporalService', () => {
  it('uses a deterministic centered Halton sequence', () => {
    expect(halton(1, 2)).toBe(0.5);
    expect(halton(2, 2)).toBe(0.25);
    expect(temporalJitter(0, 0.5)[0]).toBeCloseTo(0, 12);
    expect(temporalJitter(0, 0.5)[1]).toBeCloseTo(-1 / 12, 12);
    expect(temporalJitter(7, 0.5)).toEqual(temporalJitter(7, 0.5));
  });

  it('owns two bounded FP16 histories and converges only after resolve frames', () => {
    const scope = new ResourceScope('temporal-test');
    const service = new TemporalService({ renderer: fakeRenderer(), scope });
    service.ensureSize(64, 32);
    service.setPolicy({ enabled: true, historyFrames: 4, jitterScale: 0.5 });

    expect(service.getDebugSnapshot()).toMatchObject({
      enabled: true,
      valid: false,
      historyAge: 0,
      targetSize: [64, 32],
      allocatedTargetCount: 2
    });

    const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
    service.beginFrame();
    service.resolve(new THREE.Texture(), camera);
    expect(service.getDebugSnapshot()).toMatchObject({ valid: true, historyAge: 1 });
    service.beginFrame();
    service.resolve(new THREE.Texture(), camera);
    expect(service.getDebugSnapshot()).toMatchObject({ valid: true, historyAge: 2 });

    service.reset('route-change');
    expect(service.getDebugSnapshot()).toMatchObject({
      valid: false,
      historyAge: 0,
      lastResetReason: 'route-change'
    });
    service.dispose();
    expect(scope.snapshot().renderTarget).toBe(0);
  });

  it('classifies a large camera discontinuity as a camera cut', () => {
    const scope = new ResourceScope('temporal-cut-test');
    const service = new TemporalService({ renderer: fakeRenderer(), scope });
    service.ensureSize(32, 32);
    service.setPolicy({ enabled: true, historyFrames: 8, jitterScale: 0.25 });
    const camera = new THREE.PerspectiveCamera();
    service.beginFrame();
    service.resolve(new THREE.Texture(), camera);
    camera.position.set(5, 0, 0);
    camera.updateMatrixWorld();
    service.beginFrame();
    service.resolve(new THREE.Texture(), camera);
    expect(service.getDebugSnapshot().lastResetReason).toBe('camera-cut');
    service.dispose();
  });
});
