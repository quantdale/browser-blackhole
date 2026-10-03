/**
 * D6 mass convention (openspec/changes/kerr-gpu-initializer-correctness
 * design.md D6): every Kerr metric term uses the physical spin length
 * a = a* * M. The GPU TSL graph cannot execute under vitest, so this pins the
 * convention twin: the algebraic forms kerrIntegrator.ts now builds
 * (threaded Delta / Sigma / A / g_tphi), the horizon identity those forms
 * must satisfy, and the pre-threading mixed formula the spec forbids
 * ("The pass SHALL NOT mix the dimensionless a* with a metric that assumes
 * unit mass", specs/kerr-photon-initialization).
 */
import { describe, expect, it } from 'vitest';

import { kerrCameraBigA } from '../../src/phenomena/black-hole/kerr/cameraSideInit.js';

const masses = [1, 0.9515962632179453, 0.5, 2];
const spins = [0, 0.6865, 0.9, -0.9, 0.998];

/** Threaded Delta as built by kerrIntegrator (aPhysSq = (a* * M)^2). */
const deltaThreaded = (r: number, m: number, aStar: number): number => {
  const a = aStar * m;
  return r * r - 2 * m * r + a * a;
};

/** Pre-threading mixed form: a*^2 inserted into an M-scaled metric. */
const deltaMixed = (r: number, m: number, aStar: number): number =>
  r * r - 2 * m * r + aStar * aStar;

/** Outer horizon r+ = M (1 + sqrt(1 - a*^2)) — kerrIntegrator's rPlus node. */
const rPlus = (m: number, aStar: number): number =>
  m * (1 + Math.sqrt(Math.max(1 - aStar * aStar, 0)));

describe('Kerr mass convention (design.md D6 threading)', () => {
  it('threaded Delta vanishes at r+ for every mass (horizon identity)', () => {
    for (const m of masses) {
      for (const aStar of spins) {
        expect(deltaThreaded(rPlus(m, aStar), m, aStar), `m=${m} a*=${aStar}`).toBeCloseTo(0, 10);
      }
    }
  });

  it('the pre-threading mixed formula violates the horizon identity at M != 1', () => {
    const m = 0.9515962632179453;
    const aStar = 0.6865;
    const residual = Math.abs(deltaMixed(rPlus(m, aStar), m, aStar));
    expect(residual).toBeGreaterThan(1e-3);
  });

  it('threading is exactly the identity at unit mass', () => {
    for (const aStar of spins) {
      for (let r = 1.5; r < 30; r *= 1.3) {
        expect(deltaThreaded(r, 1, aStar), `a*=${aStar} r=${r}`).toBe(deltaMixed(r, 1, aStar));
      }
    }
  });

  it('the camera-side mirror builds A with a = a* * M (kerrCameraBigA)', () => {
    for (const m of masses) {
      for (const aStar of spins) {
        for (const theta of [0.4, Math.PI / 2, 2.2]) {
          for (const r of [2, 6, 12]) {
            const a2 = (aStar * m) ** 2;
            const delta = r * r - 2 * m * r + a2;
            const s2 = Math.sin(theta) * Math.sin(theta);
            const expected = (r * r + a2) ** 2 - a2 * delta * s2;
            expect(kerrCameraBigA(r, theta, aStar, m), `m=${m} a*=${aStar} r=${r}`).toBeCloseTo(
              expected,
              12
            );
          }
        }
      }
    }
  });

  it('g_tphi threads as -2 M (a* M) r sin^2(theta) / Sigma (init/terminal form)', () => {
    const gTphi = (r: number, m: number, aStar: number, theta: number): number => {
      const a = aStar * m;
      const sigma = r * r + a * a * Math.cos(theta) ** 2;
      const s2 = Math.sin(theta) ** 2;
      return (-2 * m * a * r * s2) / sigma;
    };
    // Homogeneity: at fixed (r/M, theta), g_tphi scales linearly with M because
    // both the M and the a = a* * M factors carry one power of the mass.
    const aStar = 0.9;
    const theta = 0.7;
    const x = 3; // r/M
    const ratio = gTphi(x * 0.5, 0.5, aStar, theta) / gTphi(x * 1, 1, aStar, theta);
    expect(ratio).toBeCloseTo(0.5, 12);
  });
});
