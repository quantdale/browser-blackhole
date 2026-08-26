/**
 * M12-NS — dedicated neutron-star physics regression suite (task 2.10).
 *
 * Covers the pure CPU model in src/phenomena/neutron-star/physics.ts:
 * compactness/redshift DIRECT conventions and validation, rotation
 * kinematics, analytic beacon pulse geometry, dipole helpers, and the
 * procedural flare machine. These helpers previously had no dedicated unit
 * coverage; this suite is their regression gate.
 */

import { describe, expect, it } from 'vitest';

import {
  FLARE_QUIESCENT_LEVEL,
  compactness,
  flareEnvelope,
  gravitationalRadiusKm,
  lightCylinderRadiusRg,
  magneticAxisVector,
  nextFlareState,
  observedTemperatureRatio,
  polarCapColatitude,
  pulseVisibility,
  spinPhase,
  spotDirectionFromSpinAxis,
  surfaceRedshift,
  type FlareState
} from '../../src/phenomena/neutron-star/physics.js';

const RG_KM = 1.476625;

describe('neutron-star compactness and redshift (DIRECT)', () => {
  it('gravitational radius scales linearly with mass', () => {
    expect(gravitationalRadiusKm(1)).toBeCloseTo(RG_KM, 9);
    expect(gravitationalRadiusKm(2)).toBeCloseTo(2 * RG_KM, 9);
    expect(() => gravitationalRadiusKm(0)).toThrowError(RangeError);
    expect(() => gravitationalRadiusKm(Number.NaN)).toThrowError(TypeError);
  });

  it('compactness is r_g/R (radius in metres) and rejects R <= 2 r_g', () => {
    const expected = (RG_KM * 1.4) / 12;
    expect(compactness(12000, 1.4)).toBeCloseTo(expected, 12);
    expect(() => compactness(2 * RG_KM * 1.4 * 1000, 1.4)).toThrowError(RangeError);
    expect(() => compactness(RG_KM * 1.4 * 1000, 1.4)).toThrowError(RangeError);
    expect(() => compactness(-5, 1.4)).toThrowError(RangeError);
  });

  it('surface redshift equals sqrt(1 - 2 r_g/R) and orders with compactness', () => {
    const gWide = surfaceRedshift(1.4, 14_000);
    const gCanon = surfaceRedshift(1.4, 12_000);
    const gTight = surfaceRedshift(1.4, 10_000);
    expect(gCanon).toBeCloseTo(Math.sqrt(1 - (2 * RG_KM * 1.4) / 12), 12);
    expect(gTight).toBeLessThan(gCanon);
    expect(gCanon).toBeLessThan(gWide);
    expect(gWide).toBeLessThan(1);
    // 8 km < 2 r_g(3 Msun): no static surface exists there.
    expect(() => surfaceRedshift(3, 8_000)).toThrowError(RangeError);
  });

  it('observed temperature ratio tracks the frequency-ratio convention g', () => {
    expect(observedTemperatureRatio(1.4, 12_000)).toBe(surfaceRedshift(1.4, 12_000));
  });
});

describe('neutron-star rotation kinematics', () => {
  it('spin phase wraps into [0, 2pi) and stays deterministic for negative time', () => {
    expect(spinPhase(0, 0.5)).toBe(0);
    expect(spinPhase(1, 0.5)).toBeCloseTo(Math.PI, 12); // 2*pi*0.5*1 = pi
    const wrapped = spinPhase(3, 0.5); // 3*pi wraps to pi
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(Math.PI * 2);
    expect(spinPhase(-1, 0.5)).toBeGreaterThanOrEqual(0);
    expect(() => spinPhase(1, -0.1)).toThrowError(RangeError);
    expect(() => spinPhase(Number.NaN, 1)).toThrowError(TypeError);
  });

  it('spot direction follows the stated spherical convention', () => {
    expect(spotDirectionFromSpinAxis(0, 0)).toEqual([0, 1, 0]);
    const equator = spotDirectionFromSpinAxis(Math.PI / 2, 0);
    expect(equator[0]).toBeCloseTo(1, 12);
    expect(equator[1]).toBeCloseTo(0, 12);
    const quarter = spotDirectionFromSpinAxis(Math.PI / 2, Math.PI / 2);
    expect(quarter[2]).toBeCloseTo(1, 12);
    const arbitrary = spotDirectionFromSpinAxis(0.7, 2.1);
    expect(Math.hypot(arbitrary[0], arbitrary[1], arbitrary[2])).toBeCloseTo(1, 12);
  });
});

describe('neutron-star pulse geometry (analytic beacon)', () => {
  it('is exactly zero outside the beam opening', () => {
    const spot = spotDirectionFromSpinAxis(Math.PI / 3, 0);
    const observer = spotDirectionFromSpinAxis(Math.PI / 3 + 0.5, 0);
    expect(pulseVisibility(spot, observer, 0.25)).toBe(0);
    expect(() => pulseVisibility(spot, observer, 0)).toThrowError(RangeError);
    expect(() => pulseVisibility(spot, observer, Math.PI)).toThrowError(RangeError);
  });

  it('peaks on the beam axis and is constant for an aligned rotator', () => {
    const spot = spotDirectionFromSpinAxis(Math.PI / 3, 0);
    expect(pulseVisibility(spot, spot, 1)).toBeCloseTo(1, 12);
    // Aligned-axis case: visibility independent of observer azimuth phase.
    const poleSpot: [number, number, number] = [0, 1, 0];
    const obsA = spotDirectionFromSpinAxis(Math.PI / 3, 0);
    const obsB = spotDirectionFromSpinAxis(Math.PI / 3, 2);
    expect(pulseVisibility(poleSpot, obsA, 1)).toBe(pulseVisibility(poleSpot, obsB, 1));
  });

  it('documented phase of maximum: phi_max = phi_o - phi_s', () => {
    const thetaS = Math.PI / 3;
    const thetaO = Math.PI / 2.5;
    const phiS = 0.7;
    const phiO = 1.9;
    const observer = spotDirectionFromSpinAxis(thetaO, phiO);
    const opening = 1.2;
    let bestPhi = 0;
    let bestV = -1;
    for (let k = 0; k <= 2000; k++) {
      const phi = (k / 2000) * Math.PI * 2;
      const v = pulseVisibility(spotDirectionFromSpinAxis(thetaS, phi + phiS), observer, opening);
      if (v > bestV) {
        bestV = v;
        bestPhi = phi;
      }
    }
    const twoPi = Math.PI * 2;
    const expected = (((phiO - phiS) % twoPi) + twoPi) % twoPi;
    const delta = Math.abs(((bestPhi - expected + Math.PI) % twoPi) - Math.PI);
    void bestV;
    expect(delta).toBeLessThan(0.01);
  });
});

describe('neutron-star dipole helpers (PROCEDURAL_SCIENTIFIC support)', () => {
  it('light cylinder is infinite without rotation and otherwise c/(2 pi f)/r_g', () => {
    expect(lightCylinderRadiusRg(0, 1.4)).toBe(Infinity);
    const expected = 299792.458 / (2 * Math.PI * 5) / (RG_KM * 1.4);
    expect(lightCylinderRadiusRg(5, 1.4)).toBeCloseTo(expected, 9);
  });

  it('polar-cap colatitude satisfies r_star = L sin^2(theta_p)', () => {
    const rStar = (RG_KM * 1.4) / 12; // canonical R_rg ~ 5.805
    const lc = 50;
    const thetaP = polarCapColatitude(rStar, lc);
    expect(rStar).toBeCloseTo(lc * Math.sin(thetaP) ** 2, 9);
    expect(() => polarCapColatitude(lc, lc)).toThrowError(RangeError);
  });

  it('magnetic axis construction is deterministic, unit, and degenerate safely', () => {
    const a = magneticAxisVector(0.5, 1.0);
    const b = magneticAxisVector(0.5, 1.0);
    expect(a).toEqual(b);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 12);
    // Zero tilt keeps the magnetic axis ON the spin axis for every phase.
    for (const phase of [0, 1, 2.5, 5]) {
      const m = magneticAxisVector(0, phase);
      expect(m[0]).toBeCloseTo(0, 12);
      expect(m[1]).toBeCloseTo(1, 12);
      expect(m[2]).toBeCloseTo(0, 12);
    }
    expect(() => magneticAxisVector(0.3, 0, [0, 0, 0])).toThrowError(RangeError);
  });
});

describe('neutron-star flare machine (PROCEDURAL_SCIENTIFIC)', () => {
  const quiescent: FlareState = { mode: 'quiescent', phase01: 0, storedEnergy: 0 };

  it('envelope stays inside [quiescent, 1] across the whole cycle', () => {
    for (let i = 0; i <= 100; i++) {
      const v = flareEnvelope(i / 100);
      expect(v).toBeGreaterThanOrEqual(FLARE_QUIESCENT_LEVEL - 1e-12);
      expect(v).toBeLessThanOrEqual(1 + 1e-12);
    }
    expect(flareEnvelope(0.25)).toBe(1); // plateau
    expect(flareEnvelope(1)).toBe(FLARE_QUIESCENT_LEVEL);
  });

  it('accumulates energy, triggers once, plays the envelope, then rests', () => {
    let s = quiescent;
    s = nextFlareState(s, 0.999);
    expect(s.mode).toBe('quiescent');
    s = nextFlareState(s, 0.001);
    expect(s.mode).toBe('active');
    expect(s.storedEnergy).toBeCloseTo(0, 12);
    // Envelope phase advances 0.25 per UNIT of input energy: four 1.0-doses
    // walk phase01 through 0.25/0.50/0.75 and rest at 1.0.
    s = nextFlareState(s, 1);
    expect(s.mode).toBe('active');
    s = nextFlareState(s, 1);
    expect(s.mode).toBe('active');
    s = nextFlareState(s, 1);
    expect(s.mode).toBe('active');
    s = nextFlareState(s, 1);
    expect(s.mode).toBe('quiescent');
    expect(s.phase01).toBe(0);
  });

  it('caps stored energy and ignores non-finite/negative doses', () => {
    let s = quiescent;
    let sawActive = false;
    for (let i = 0; i < 20; i++) {
      s = nextFlareState(s, 1);
      sawActive ||= s.mode === 'active';
      expect(s.storedEnergy).toBeLessThanOrEqual(10);
      expect(s.storedEnergy).toBeGreaterThanOrEqual(0);
      if (s.mode === 'active') expect(s.phase01).toBeLessThan(1);
    }
    expect(sawActive).toBe(true); // capping never prevents triggering
    const corrupt = nextFlareState(
      { mode: 'active', phase01: Number.NaN, storedEnergy: Number.NaN },
      0.1
    );
    expect(Number.isFinite(corrupt.phase01)).toBe(true);
    expect(nextFlareState(quiescent, Number.NaN).storedEnergy).toBe(0);
    expect(nextFlareState(quiescent, -1).storedEnergy).toBe(0);
  });

  it('never mutates its input state', () => {
    const before: FlareState = { mode: 'active', phase01: 0.2, storedEnergy: 0.5 };
    const snapshot = JSON.stringify(before);
    nextFlareState(before, 0.3);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
