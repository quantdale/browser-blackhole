/**
 * Kerr camera-side math: the shared GPU construction must equal the binary64
 * CPU oracle. The unit test asserts the numeric mirror
 * (kerr/cameraSideInit.ts) against metricFragments and the ADR §1.8 static
 * L_z normalisation; the browser parity rows assert the TSL graph matches.
 */
import { describe, expect, it } from 'vitest';

import {
  kerrCameraBigA,
  staticLzTerm
} from '../../src/phenomena/black-hole/kerr/cameraSideInit.js';
import { metricFragments } from '../../src/phenomena/black-hole/observer/metric.js';
import { kerrFragments } from '../../src/phenomena/black-hole/kerr/characteristics.js';

describe('Kerr camera-side quartic (shared bigA)', () => {
  it('matches the binary64 metricFragments quartic over a sampled (r, theta, a) grid', () => {
    for (const a of [0, 0.3, 0.9, -0.6, 0.998]) {
      for (let i = 0; i < 12; i += 1) {
        const r = 2.5 + i * 0.75;
        for (let j = 1; j < 8; j += 1) {
          const theta = (j / 8) * Math.PI;
          const expected = metricFragments({
            metric: 'kerr',
            effectiveSpin: a,
            r,
            theta,
            phiWorldRad: 0
          }).bigA;
          expect(kerrCameraBigA(r, theta, a), `a=${a} r=${r} theta=${theta}`).toBeCloseTo(
            expected,
            12
          );
        }
      }
    }
  });
});

describe('static L_z frame term', () => {
  it('uses g_tphi / sqrt(f_s), matching kerr/reference.ts and ADR §1.8', () => {
    for (const a of [0, 0.3, 0.9, -0.6]) {
      for (let i = 0; i < 10; i += 1) {
        const r = 3 + i * 0.7;
        for (let j = 1; j < 6; j += 1) {
          const theta = (j / 6) * Math.PI;
          const fr = kerrFragments(r, theta, a);
          const sigma = fr.sigma;
          const fS = sigma > 0 ? (sigma - 2 * r) / sigma : 0;
          const s2 = Math.sin(theta) * Math.sin(theta);
          const gTphi = (-2 * a * r * s2) / sigma;
          const nPh = 0.4;
          const reference =
            nPh * Math.sin(theta) * Math.sqrt(fr.delta / fS) + gTphi / Math.sqrt(fS);
          expect(
            staticLzTerm(nPh, Math.sin(theta), fr.delta, fS, gTphi),
            `a=${a} r=${r}`
          ).toBeCloseTo(reference, 12);
        }
      }
    }
  });
});
