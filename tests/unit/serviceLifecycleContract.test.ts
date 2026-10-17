/**
 * Shared service lifecycle contract (shared-renderer-service-lifecycle D1).
 *
 * "A convention that only some implementers follow is not a convention."
 * This table-driven test applies ONE contract to every GPU service in
 * `src/renderer/shared/`, expressed in terms all of them share — lifetime,
 * unlinking, counter return — never in any single resource kind:
 *
 * 1. creation after `dispose()` is refused (R-05 family; LensingService had
 *    no disposed state at all before this change);
 * 2. a released handle unlinks itself from its service (R-06 family;
 *    ParticleService/VolumeService retained disposed handles for the page
 *    lifetime);
 * 3. handle and service disposal are idempotent (no double dispose);
 * 4. live counters return to zero after service disposal.
 *
 * Fail-first history: rows 1-2 fail against the pre-change services
 * (no LensingService guard; Particle/Volume retention).
 */

import { describe, expect, it } from 'vitest';

import { LensingService } from '../../src/renderer/shared/LensingService.js';
import { ParticleService } from '../../src/renderer/shared/ParticleService.js';
import { RibbonService } from '../../src/renderer/shared/RibbonService.js';
import { StrandService } from '../../src/renderer/shared/StrandService.js';
import { VolumeService } from '../../src/renderer/shared/VolumeService.js';
import type {
  LensingPassParams,
  ParticleSystemConfig,
  RibbonConfig,
  StrandConfig
} from '../../src/atlas/types.js';

function strandConfig(): StrandConfig {
  return {
    segments: 4,
    radialSegments: 8,
    widthStart: 2,
    widthEnd: 0.5,
    aspectStart: 0.8,
    aspectEnd: 0.35,
    opacityStart: 0.9,
    opacityEnd: 0.1,
    colorStart: [1, 0.8, 0.4],
    colorEnd: [0.2, 0.4, 1],
    temperatureVariation: 0.3,
    clumpStrength: 0.4,
    clumpSeed: 17,
    radianceScale: 3,
    coreOpacity: 0.7,
    additive: true
  };
}

function ribbonConfig(): RibbonConfig {
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

function particleConfig(): ParticleSystemConfig {
  return {
    capacity: 16,
    emitters: [{ kind: 'point', origin: [0, 0, 0], speed: 1 }],
    lifetimeSeconds: [10, 20],
    sizePx: [1, 2],
    colorRamp: [
      { t: 0, color: [1, 0, 0], alpha: 1 },
      { t: 1, color: [0, 0, 1], alpha: 0 }
    ],
    blending: 'additive',
    seed: 7,
    preferCompute: false
  };
}

function lensingParams(): LensingPassParams {
  return {
    massRg: 1,
    backgroundEquirect: null,
    diskEnabled: false,
    diskInnerRg: 6,
    diskOuterRg: 18,
    qualityTier: 'high'
  };
}

interface ServiceCase {
  name: string;
  /** Fresh service + one fresh handle; the contract drives the rest. */
  setup(): {
    service: { dispose(): void };
    create(): { dispose(): void };
    liveCount(): number | null;
  };
}

const CASES: ServiceCase[] = [
  {
    name: 'StrandService',
    setup() {
      const service = new StrandService();
      return {
        service,
        create: () => service.createStrand(strandConfig()),
        liveCount: () => service.liveHandleCount
      };
    }
  },
  {
    name: 'RibbonService',
    setup() {
      const service = new RibbonService();
      return {
        service,
        create: () => service.createRibbon(ribbonConfig()),
        liveCount: () => service.liveHandleCount
      };
    }
  },
  {
    name: 'ParticleService',
    setup() {
      const service = new ParticleService({ computeAvailable: false, renderer: null });
      return {
        service,
        create: () => service.createSystem(particleConfig()),
        liveCount: () => service.getDebugSnapshot().liveSystems
      };
    }
  },
  {
    name: 'VolumeService',
    setup() {
      const service = new VolumeService();
      return {
        service,
        create: () =>
          service.createVolume({
            bounds: { kind: 'sphere', center: [0, 0, 0], radius: 1 },
            density: () => 0,
            baseMaxSteps: 8,
            halfResolution: true,
            earlyAlphaTermination: true,
            temporalJitter: false
          }),
        liveCount: () => service.getDebugSnapshot().liveVolumes
      };
    }
  },
  {
    name: 'LensingService',
    setup() {
      const service = new LensingService();
      return {
        service,
        create: () => service.createBlackHoleLensingPass(lensingParams()),
        // Live-pass observability exists on the debug snapshot; the dedicated
        // row below asserts the exact unlinking of this service.
        liveCount: () => service.getDebugSnapshot().passes.length
      };
    }
  }
];

describe('shared service lifecycle contract (D1/R-05/R-06)', () => {
  for (const testCase of CASES) {
    it(`${testCase.name}: refuses creation after dispose()`, () => {
      const { service, create } = testCase.setup();
      create();
      service.dispose();
      expect(() => create(), 'creation after dispose must throw').toThrow();
    });

    it(`${testCase.name}: handle and service disposal are idempotent`, () => {
      const { service, create } = testCase.setup();
      const handle = create();
      handle.dispose();
      expect(() => handle.dispose(), 'double handle dispose must be safe').not.toThrow();
      service.dispose();
      expect(() => service.dispose(), 'double service dispose must be safe').not.toThrow();
    });

    const liveCount = testCase.setup().liveCount();
    if (liveCount !== null) {
      it(`${testCase.name}: released handles unlink and counters return to zero`, () => {
        const { service, create, liveCount: count } = testCase.setup();
        const first = create();
        create();
        expect(count()).toBe(2);
        first.dispose();
        expect(count(), 'a released handle must leave the service set').toBe(1);
        service.dispose();
        expect(count(), 'dispose must release everything').toBe(0);
      });
    }
  }

  it('LensingService: thin-lens closures are refused after dispose too', () => {
    const service = new LensingService();
    service.dispose();
    expect(() => service.createThinLensDisplacement(1, 1)).toThrow();
  });

  it('LensingService: released passes unlink and dispose releases everything', () => {
    const service = new LensingService();
    const params = lensingParams();
    const pass = service.createBlackHoleLensingPass(params);
    expect(service.getDebugSnapshot().passes.length).toBe(1);
    pass.dispose();
    expect(service.getDebugSnapshot().passes.length, 'a released pass must unlink').toBe(0);
    pass.dispose(); // idempotent
    service.dispose();
    expect(() => service.createBlackHoleLensingPass(params)).toThrow();
    expect(() => service.createKerrLensingPass({ ...params, spinDimensionless: 0.5 })).toThrow();
    expect(() => service.createThinLensDisplacement(1, 1)).toThrow();
    service.dispose();
  });
});
