import { describe, expect, it } from 'vitest';

import { LensingService } from '../../src/renderer/shared/LensingService.js';
import type { LensingPassParams } from '../../src/atlas/types.js';

/**
 * WS0/tasks.md §1 — active lensing pass kind + live max-step budget.
 *
 * The budget must come from the material's own uniform (the single authority
 * that per-frame tier writes target), not from a service-local copy of the
 * tier table, so these assert the value reaches the service snapshot.
 */

const PARAMS: LensingPassParams = {
  massRg: 1,
  backgroundEquirect: null,
  diskEnabled: false,
  diskInnerRg: 6,
  diskOuterRg: 20,
  qualityTier: 'medium'
};

describe('LensingService WS0 telemetry', () => {
  it('reports no live passes on a fresh service', () => {
    const service = new LensingService();
    expect(service.getDebugSnapshot()).toEqual({
      livePasses: 0,
      passes: [],
      environmentDetail: 0,
      environmentLayer: 'cinematic-diffuse+dense-stars+dust'
    });
    service.dispose();
  });

  it('tracks numerical and Kerr pass kinds with their medium-tier budgets', () => {
    const service = new LensingService();
    const numerical = service.createBlackHoleLensingPass(PARAMS);
    const kerr = service.createKerrLensingPass({ ...PARAMS, spinDimensionless: 0.9 });

    expect(service.getDebugSnapshot()).toMatchObject({
      livePasses: 2,
      passes: [
        { kind: 'numerical', qualityTier: 'medium', maxSteps: 512 },
        { kind: 'kerr', qualityTier: 'medium', maxSteps: 512 }
      ]
    });

    numerical.dispose();
    kerr.dispose();
    expect(service.getDebugSnapshot().livePasses).toBe(0);
    service.dispose();
  });

  it('reports a low-tier pass with the low step budget', () => {
    const service = new LensingService();
    service.createBlackHoleLensingPass({ ...PARAMS, qualityTier: 'low' });
    expect(service.getDebugSnapshot().passes).toEqual([
      { kind: 'numerical', qualityTier: 'low', maxSteps: 256 }
    ]);
    service.dispose();
  });

  it('keeps environmentDetail synchronized in the snapshot', () => {
    const service = new LensingService();
    service.setEnvironmentDetail(5); // clamped to 1
    expect(service.getDebugSnapshot().environmentDetail).toBe(1);
    service.dispose();
  });
});
