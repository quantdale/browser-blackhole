/**
 * M9-02/BH-203 — centralized Kerr characteristic helper tests.
 *
 * Authority chain: published reference vectors (Bardeen-Press-Teukolsky
 * 1972 via Fujita/Sago/Nakano arXiv:1707.09309 Table 1 and the standard
 * restatements) + raw-metric normalization checks + Schwarzschild limits,
 * per docs/KERR_BACKEND_ADR.md §1.16 and docs/TESTING.md.
 */
import { describe, expect, it } from 'vitest';

import {
  kerrDiskAngularVelocity,
  kerrDiskRedshiftFactor,
  kerrEmitterUt,
  kerrErgosphereRadius,
  kerrHorizonRadii,
  kerrIscoRadius,
  kerrPhotonOrbitRadius,
  kerrFragments
} from '../../src/phenomena/black-hole/kerr/characteristics.js';
import {
  DISK_ISCO_RG,
  emitterAngularVelocity,
  emitterUt,
  diskRedshiftFactor
} from '../../src/phenomena/black-hole/accretionDisk.js';

const VECTOR_TOL = 5e-9; // published tables give ~9 significant digits

describe('Kerr horizons (ADR §1.9)', () => {
  it('recovers Schwarzschild limits: outer horizon 2M, inner collapses to r=0', () => {
    const h = kerrHorizonRadii(0);
    expect(h.outerRg).toBeCloseTo(2, 12);
    expect(h.innerRg).toBeCloseTo(0, 12);
  });

  it('matches the closed form r+- = 1 +- sqrt(1 - a*^2)', () => {
    const a = 0.9;
    const h = kerrHorizonRadii(a);
    const root = Math.sqrt(1 - 0.81);
    expect(h.outerRg).toBeCloseTo(1 + root, 14);
    expect(h.innerRg).toBeCloseTo(1 - root, 14);
  });

  it('degenerates towards r = M at extremal spin', () => {
    expect(kerrHorizonRadii(0.999999).outerRg).toBeLessThan(1.0015);
    expect(kerrHorizonRadii(0.999999).innerRg).toBeGreaterThan(0.9985);
  });

  it('meets the ergosurface on-axis and strictly off-axis for spinning holes', () => {
    for (const a of [0.3, 0.7, 0.998]) {
      // On the rotation axis horizon == ergosurface (cos theta = +-1).
      expect(kerrErgosphereRadius(a, 0)).toBeCloseTo(kerrHorizonRadii(a).outerRg, 12);
      // Off-axis the ergosurface is strictly outside the horizon.
      expect(kerrErgosphereRadius(a, Math.PI / 2)).toBeGreaterThan(kerrHorizonRadii(a).outerRg);
    }
  });

  it('reproduces the Schwarzschild ergosurface 2M for every angle at a*=0', () => {
    for (let i = 0; i <= 10; i += 1) {
      expect(kerrErgosphereRadius(0, (i / 10) * Math.PI)).toBeCloseTo(2, 12);
    }
  });
});

describe('Kerr ISCO (BPT 1972 eq. 2.20, locked disk-corotating signed form)', () => {
  it('is exactly 6M at a* = 0 (Schwarzschild recovery)', () => {
    expect(kerrIscoRadius(0)).toBeCloseTo(DISK_ISCO_RG, 12);
  });

  it('reproduces published reference vectors', () => {
    // Fujita/Sago/Nakano arXiv:1707.09309 Table 1 (BPT formula evaluations).
    expect(kerrIscoRadius(0.5)).toBeCloseTo(4.233002531, VECTOR_TOL);
    expect(kerrIscoRadius(-0.5)).toBeCloseTo(7.554584713, VECTOR_TOL);
    expect(kerrIscoRadius(0.9)).toBeCloseTo(2.320883043, VECTOR_TOL);
    expect(kerrIscoRadius(-0.9)).toBeCloseTo(8.717352279, VECTOR_TOL);
  });

  it('approaches 1.237M prograde and 9M retrograde near extremality', () => {
    expect(kerrIscoRadius(0.998)).toBeGreaterThan(1.23);
    expect(kerrIscoRadius(0.998)).toBeLessThan(1.245);
    expect(kerrIscoRadius(-0.998)).toBeGreaterThan(8.95);
    expect(kerrIscoRadius(-1)).toBeCloseTo(9, 9);
    expect(kerrIscoRadius(1)).toBeCloseTo(1, 9);
  });

  it('orders prograde < 6 < retrograde for every positive spin', () => {
    for (const a of [0.1, 0.3, 0.5, 0.7, 0.9, 0.998]) {
      expect(kerrIscoRadius(a)).toBeLessThan(6);
      expect(kerrIscoRadius(-a)).toBeGreaterThan(6);
    }
  });

  it('is monotone non-increasing in a* across the supported domain', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 199; i += 1) {
      const a = -0.998 + (i / 199) * 2 * 0.998;
      const r = kerrIscoRadius(a);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeLessThanOrEqual(previous + 1e-12);
      previous = r;
    }
  });
});

describe('circular equatorial emitters (BPT eqs. 2.16-2.18)', () => {
  it('photon-orbit boundary: 3M at a*=0, ->M prograde / ->4M retrograde at extremality', () => {
    expect(kerrPhotonOrbitRadius(0)).toBeCloseTo(3, 12);
    expect(kerrPhotonOrbitRadius(1)).toBeCloseTo(1, 9);
    expect(kerrPhotonOrbitRadius(-1)).toBeCloseTo(4, 9);
  });

  it('a*=0 emitter Omega and u^t equal the validated Schwarzschild formulas', () => {
    for (let i = 1; i <= 40; i += 1) {
      const r = 3.05 + i * 0.5;
      expect(kerrDiskAngularVelocity(0, r)).toBeCloseTo(emitterAngularVelocity(r), 12);
      expect(kerrEmitterUt(0, r)).toBeCloseTo(emitterUt(r), 12);
    }
    expect(kerrEmitterUt(0, 3)).toBe(0);
    expect(kerrEmitterUt(0, 2)).toBe(0);
  });

  it('reports "no orbit" (0) below the spin-dependent existence boundary', () => {
    for (const a of [0.5, 0.9, 0.998, -0.5, -0.9, -0.998]) {
      const rPh = kerrPhotonOrbitRadius(a);
      // Bounded probes: exactly ON the boundary is a f64 roundoff coin flip,
      // so test clearly-inside/clearly-outside radii instead.
      expect(kerrEmitterUt(a, rPh * (1 - 1e-6))).toBe(0);
      expect(kerrDiskAngularVelocity(a, rPh * (1 - 1e-6))).toBe(0);
      expect(kerrEmitterUt(a, rPh * (1 + 1e-6))).toBeGreaterThan(0);
      expect(kerrDiskAngularVelocity(a, rPh * (1 + 1e-6))).toBeGreaterThan(0);
    }
  });

  it('satisfies u.mu u^mu = -1 against the RAW metric across the domain', () => {
    // u = u^t (dt + Omega dphi) at theta = PI/2; contract with the full BL
    // metric built from kerrFragments — an independent derivation check of
    // BOTH the Omega and u^t formulas (ADR §1.16).
    for (const a of [0.9, 0.5, 0, -0.5, -0.9, -0.998]) {
      const rPh = kerrPhotonOrbitRadius(a);
      for (let i = 1; i <= 12; i += 1) {
        const r = rPh * (1 + i * 0.35);
        const ut = kerrEmitterUt(a, r);
        if (ut === 0) continue;
        const omega = kerrDiskAngularVelocity(a, r);
        const fr = kerrFragments(r, Math.PI / 2, a);
        const bigA = (r * r + fr.aSq) ** 2 - fr.aSq * fr.delta;
        const gTT = -(1 - (2 * r) / r ** 2); // -(1 - 2Mr/Sigma) at s=1
        const gTphi = (-2 * a * r) / r ** 2; // -2Mar sin^2/Sigma at s=1
        const gPhiPhi = bigA / r ** 2; // A sin^2/Sigma at s=1
        const norm = ut * ut * (gTT + 2 * omega * gTphi + omega * omega * gPhiPhi);
        expect(norm, `a=${a} r=${r}`).toBeCloseTo(-1, 9);
      }
    }
  });

  it('a*=0 redshift factor equals the validated Schwarzschild implementation', () => {
    for (const bz of [0, 1, 3, 6, -2.5]) {
      for (let i = 1; i <= 15; i += 1) {
        const r = 3.2 + i * 0.8;
        expect(kerrDiskRedshiftFactor(0, r, bz)).toBeCloseTo(diskRedshiftFactor(r, bz), 12);
      }
    }
  });

  it('keeps b_z = 0 net-redshifted and invisible states gated to 0', () => {
    const a = 0.9;
    const r = 4.5;
    const ut = kerrEmitterUt(a, r);
    expect(kerrDiskRedshiftFactor(a, r, 0)).toBeCloseTo(1 / ut, 12);
    expect(kerrDiskRedshiftFactor(a, r, 0)).toBeLessThan(1);
    // Retrograde photon orbit sits ABOVE 3M: 3.5 r_g has no corotating orbit
    // for a* = -0.9, so the emitter state must gate to invisible 0.
    expect(kerrDiskRedshiftFactor(-0.9, 3.5, 0)).toBe(0);
    expect(kerrDiskRedshiftFactor(a, Number.NaN, 1)).toBe(0);
  });
});

describe('domain safety (ADR §1.21)', () => {
  it('rejects non-finite and super-extremal spin loudly', () => {
    expect(() => kerrHorizonRadii(Number.NaN)).toThrow(RangeError);
    expect(() => kerrIscoRadius(1.2)).toThrow(RangeError);
    expect(() => kerrEmitterUt(Number.POSITIVE_INFINITY, 6)).toThrow(RangeError);
  });

  it('produces only finite outputs across the supported product domain', () => {
    for (let i = 0; i <= 50; i += 1) {
      const a = -0.998 + (i / 50) * 2 * 0.998;
      expect(Number.isFinite(kerrHorizonRadii(a).outerRg)).toBe(true);
      expect(Number.isFinite(kerrIscoRadius(a))).toBe(true);
      expect(Number.isFinite(kerrPhotonOrbitRadius(a))).toBe(true);
      for (let j = 0; j <= 6; j += 1) {
        expect(Number.isFinite(kerrErgosphereRadius(a, (j / 6) * Math.PI))).toBe(true);
      }
    }
  });
});
