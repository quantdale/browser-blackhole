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

/**
 * shared-renderer-service-lifecycle R-01 (task 1.1) — fail-first row.
 *
 * Lowering the interaction history cap must REDUCE the history blend weight
 * on the very next resolve while the history is saturated. The old formula
 * divided the accumulated age by the LOWERED cap (>= 1 when saturated) and
 * stayed pinned at the 0.94 ceiling — exactly backwards from the cap's
 * documented intent. No history reset is required for the drop (design D2).
 */
describe('TemporalService interaction weight (R-01)', () => {
  it('drops the history weight on the next resolve when interaction begins', () => {
    const scope = new ResourceScope('temporal-r01-test');
    const service = new TemporalService({ renderer: fakeRenderer(), scope });
    service.ensureSize(32, 32);
    service.setPolicy({ enabled: true, historyFrames: 8, interactionHistoryFrames: 1 });
    const camera = new THREE.PerspectiveCamera();
    // Saturate the history under the settled cap.
    for (let i = 0; i < 9; i += 1) {
      service.beginFrame();
      service.resolve(new THREE.Texture(), camera);
    }
    const settled = service.getDebugSnapshot();
    expect(settled.historyAge).toBeGreaterThan(1);
    expect(settled.appliedHistoryWeight).toBeGreaterThan(0.9);

    // Flip to interaction WITHOUT changing the policy variant — this must not
    // reset history (D2: "do not require a history invalidation solely to
    // prove the change").
    const resetsBefore = settled.resetCount;
    service.setPolicy({ enabled: true, historyFrames: 8, interactionHistoryFrames: 1 }, true);
    expect(service.getDebugSnapshot().resetCount).toBe(resetsBefore);

    service.beginFrame();
    service.resolve(new THREE.Texture(), camera);
    const interaction = service.getDebugSnapshot();
    expect(interaction.activeHistoryCap).toBe(1);
    // min(age, activeCap) / settledCap * 0.94 ~= 1/8 * 0.94 = 0.1175
    expect(interaction.appliedHistoryWeight).toBeLessThan(0.2);
    expect(interaction.appliedHistoryWeight).toBeCloseTo((1 / 8) * 0.94, 6);
    service.dispose();
  });
});
