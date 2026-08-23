/**
 * CA5 Compact Merger deterministic unit/reference corpus (mission §20).
 *
 * Covers: state normalization, phase ordering, nonlinear phase<->time
 * round-trip, inspiral invariants (decreasing separation, increasing
 * frequency, equal-mass symmetry, unequal-mass COM geometry, deterministic
 * contact), deterministic seeds, ejecta monotonic expansion + finite
 * non-negative fields, kilonova temperature/emission trends, jet
 * viewing-angle response, remnant scenario determinism, scrub/reset
 * determinism. No wall-clock dependence anywhere.
 */

import { describe, expect, it } from 'vitest';

import {
  normalizeCompactMergerState,
  resolveCompactMergerScenario,
  SCENE_UNIT_KM,
  type CompactMergerPublicState,
  type ResolvedMergerScenario
} from '../../src/phenomena/compact-merger/types.js';
import { inspiralStateAt } from '../../src/phenomena/compact-merger/inspiral.js';
import {
  mergerPhaseSequence,
  phaseAt,
  secondsToUiPhase,
  uiPhaseToSeconds
} from '../../src/phenomena/compact-merger/timeline.js';
import {
  buildEjectaParticlePlan,
  ejectaAgeSeconds,
  ejectaAnisotropyFactor,
  ejectaDirectionWeight,
  ejectaRadiusUnits
} from '../../src/phenomena/compact-merger/ejecta.js';
import {
  kelvinToLinearRgb,
  kilonovaLuminosity,
  kilonovaSampleAt,
  kilonovaTemperatureK
} from '../../src/phenomena/compact-merger/emission.js';
import {
  jetFrontRadiusUnits,
  jetViewingResponse,
  RESPONSE_FLOOR
} from '../../src/phenomena/compact-merger/jet.js';
import { remnantSampleAt, remnantVisibleAt } from '../../src/phenomena/compact-merger/remnant.js';

function stateOf(overrides: Partial<CompactMergerPublicState> = {}): CompactMergerPublicState {
  return normalizeCompactMergerState({
    massScenario: 'equal-mass',
    ...overrides
  });
}

function scenarioOf(overrides: Partial<CompactMergerPublicState> = {}): ResolvedMergerScenario {
  return resolveCompactMergerScenario(stateOf(overrides));
}

describe('compact merger state normalization (CA5-01)', () => {
  it('defaults to the documented canonical equal-mass scenario', () => {
    const s = normalizeCompactMergerState({});
    expect(s.massScenario).toBe('equal-mass');
    expect(s.mass1Solar).toBe(1.4);
    expect(s.mass2Solar).toBe(1.4);
    expect(s.radiusKm).toBe(12);
    expect(s.initialSeparationKm).toBe(120);
    expect(s.jetScenario).toBe('none');
  });

  it('forces scenario-true canonical masses (scenario presets stay scenario-true)', () => {
    const unequal = normalizeCompactMergerState({ massScenario: 'unequal-mass' });
    expect(unequal.mass1Solar).toBe(1.6);
    expect(unequal.mass2Solar).toBe(1.2);
  });

  it('clamps invalid values into documented ranges (clamp-dont-reject)', () => {
    const s = normalizeCompactMergerState({
      mass1Solar: 99,
      mass2Solar: -5,
      radiusKm: 1000,
      initialSeparationKm: 1e9,
      viewingAngleDeg: 999,
      seed: -3,
      timeSeconds: Number.NaN
    });
    expect(s.mass1Solar).toBe(2.5);
    expect(s.mass2Solar).toBe(0.8);
    expect(s.radiusKm).toBe(15);
    expect(s.initialSeparationKm).toBe(400);
    expect(s.viewingAngleDeg).toBe(90);
    expect(s.seed).toBe(1);
    expect(s.timeSeconds).toBe(0);
  });

  it('collapses unknown enum values to documented defaults', () => {
    const s = normalizeCompactMergerState({
      massScenario: 'ns-bh',
      ejectaScenario: 'magic',
      remnantScenario: 'wormhole',
      jetScenario: 'mega'
    });
    expect(s.massScenario).toBe('equal-mass');
    expect(s.ejectaScenario).toBe('two-component');
    expect(s.remnantScenario).toBe('massive-ns');
    expect(s.jetScenario).toBe('none');
  });

  it('never ships an NS-BH scenario (documented future work)', () => {
    const s = normalizeCompactMergerState({ massScenario: 'ns-bh' });
    expect(['equal-mass', 'unequal-mass']).toContain(s.massScenario);
  });
});

describe('inspiral invariants (CA5-03, mission §10)', () => {
  it('separation decreases monotonically during inspiral', () => {
    const res = scenarioOf();
    let prev = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 100; i += 1) {
      const t = (res.contactSeconds * i) / 100;
      const s = inspiralStateAt(res, t);
      expect(s.separation).toBeLessThanOrEqual(prev + 1e-12);
      prev = s.separation;
    }
  });

  it('orbital frequency trends upward toward contact', () => {
    const res = scenarioOf();
    let prev = -1;
    for (let i = 0; i <= 100; i += 1) {
      const t = (res.contactSeconds * 0.999 * i) / 100;
      const s = inspiralStateAt(res, t);
      expect(s.orbitalFrequency).toBeGreaterThan(prev);
      prev = s.orbitalFrequency;
    }
  });

  it('equal-mass symmetry is exact (point symmetry through COM)', () => {
    const res = scenarioOf();
    for (let i = 0; i <= 20; i += 1) {
      const t = (res.contactSeconds * i) / 20;
      const s = inspiralStateAt(res, t);
      expect(s.position.x1).toBeCloseTo(-s.position.x2, 12);
      expect(s.position.z1).toBeCloseTo(-s.position.z2, 12);
      expect(Math.hypot(s.position.x1, s.position.z1)).toBeCloseTo(s.separation / 2, 12);
    }
  });

  it('unequal-mass COM geometry satisfies m1 r1 = m2 r2', () => {
    const res = scenarioOf({ massScenario: 'unequal-mass' });
    // COM condition m1*r1 = m2*r2 => the HEAVIER star sits CLOSER to the COM
    // (r1/r2 = m2/m1); the component-wise COM sum must vanish identically.
    const ratio = res.m2Solar / res.m1Solar;
    for (let i = 0; i <= 20; i += 1) {
      const t = (res.contactSeconds * i) / 20;
      const s = inspiralStateAt(res, t);
      const r1 = Math.hypot(s.position.x1, s.position.z1);
      const r2 = Math.hypot(s.position.x2, s.position.z2);
      expect(r1 / r2).toBeCloseTo(ratio, 10);
      // COM stays at the origin: (m1/M)*p1 + (m2/M)*p2 = 0 component-wise
      // (mass-fraction form keeps the tolerance scale-free).
      const f1 = res.m1Kg / res.totalKg;
      const f2 = res.m2Kg / res.totalKg;
      expect(f1 * s.position.x1 + f2 * s.position.x2).toBeCloseTo(0, 10);
      expect(f1 * s.position.z1 + f2 * s.position.z2).toBeCloseTo(0, 10);
    }
  });

  it('contact occurs deterministically at a(t_c) = R1 + R2', () => {
    const res = scenarioOf();
    expect(res.contactSeconds).toBeGreaterThan(0);
    const at = inspiralStateAt(res, res.contactSeconds);
    expect(at.atContact).toBe(true);
    expect(at.separation).toBeCloseTo(res.contactSeparationUnits, 10);
    // Deterministic across evaluations.
    expect(inspiralStateAt(res, res.contactSeconds).phase).toBe(at.phase);
    // Contact time scales physically: heavier pair merges sooner.
    const heavier = scenarioOf({ mass1Solar: 2.0, mass2Solar: 2.0 });
    expect(heavier.contactSeconds).toBeLessThan(res.contactSeconds);
  });

  it('produces no NaN/Infinity anywhere in the inspiral window and beyond', () => {
    const res = scenarioOf({ massScenario: 'unequal-mass' });
    for (let i = 0; i <= 120; i += 1) {
      const t = (res.contactSeconds * 1.2 * i) / 120;
      const s = inspiralStateAt(res, t);
      for (const v of [
        s.separation,
        s.orbitalFrequency,
        s.phase,
        s.position.x1,
        s.position.z1,
        s.position.x2,
        s.position.z2
      ]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('physical contact time is order-one-second for canonical masses (real law)', () => {
    // Quadrupole law from a0=120 km for 1.4+1.4 Msun: ~1 s (sanity anchor
    // that the model uses the physical timescale, not an invented one).
    const res = scenarioOf();
    expect(res.contactSeconds).toBeGreaterThan(0.2);
    expect(res.contactSeconds).toBeLessThan(5);
  });
});

describe('nonlinear phase timeline (CA5-02, mission §8)', () => {
  it('declares the documented phase order', () => {
    expect(mergerPhaseSequence()).toEqual([
      'inspiral',
      'contact',
      'merger',
      'jet',
      'kilonova',
      'afterglow'
    ]);
  });

  it('round-trips phase -> seconds -> phase within documented tolerance', () => {
    const res = scenarioOf();
    for (let i = 0; i <= 100; i += 1) {
      const p = i / 100;
      const t = uiPhaseToSeconds(p, res);
      const back = secondsToUiPhase(t, res);
      expect(Math.abs(back - p)).toBeLessThan(1e-6);
    }
  });

  it('maps time monotonically and lands phases in order', () => {
    const res = scenarioOf();
    let prevT = -1;
    let prevPhaseIndex = -1;
    const order = mergerPhaseSequence();
    for (let i = 0; i <= 200; i += 1) {
      const p = i / 200;
      const t = uiPhaseToSeconds(p, res);
      expect(t).toBeGreaterThanOrEqual(prevT);
      prevT = t;
      const idx = order.indexOf(phaseAt(t, res));
      expect(idx).toBeGreaterThanOrEqual(prevPhaseIndex);
      prevPhaseIndex = idx;
    }
  });

  it('places the deterministic contact at the inspiral/contact boundary', () => {
    const res = scenarioOf();
    expect(phaseAt(res.contactSeconds - 1e-9, res)).toBe('inspiral');
    expect(phaseAt(res.contactSeconds + 1e-6, res)).toBe('contact');
  });
});

describe('ejecta model (CA5-06/07, mission §13)', () => {
  it('expands monotonically and stays bounded', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i += 1) {
      const tau = (7 * 86400 * i) / 100;
      const r = ejectaRadiusUnits(tau);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(Number.isFinite(r)).toBe(true);
      prev = r;
    }
    // Capped at the afterglow plateau.
    expect(ejectaRadiusUnits(86400 * 365)).toBe(ejectaRadiusUnits(86400 * 7));
  });

  it('is zero before contact and clamps negative ages', () => {
    const res = scenarioOf();
    expect(ejectaAgeSeconds(res.contactSeconds - 1, res.contactSeconds)).toBe(0);
    expect(ejectaRadiusUnits(-5)).toBe(0);
  });

  it('direction weight is finite, in [0,1], and observer-independent', () => {
    const res = scenarioOf({ ejectaScenario: 'polar-enhanced' });
    for (const [x, y, z] of [
      [0, 1, 0],
      [0, -1, 0],
      [1, 0, 0],
      [0.3, 0.4, 0.5],
      [0, 0, 0]
    ]) {
      const w = ejectaDirectionWeight(x, y, z, res);
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      const a = ejectaAnisotropyFactor(x, y, z, res);
      expect(Number.isFinite(a)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0.6);
      expect(a).toBeLessThanOrEqual(1.4);
    }
  });

  it('seeded particle plan reproduces identical morphology data', () => {
    const res = scenarioOf();
    const a = buildEjectaParticlePlan(res, 4000);
    const b = buildEjectaParticlePlan(res, 4000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.capacity).toBe(4000);
    expect(a.shellRadiusUnits).toBeGreaterThan(0);
    expect(a.speedUnitsS).toBeGreaterThan(0);
  });
});

describe('kilonova emission (CA5-10, mission §13)', () => {
  it('luminosity rises then declines (documented light-curve shape)', () => {
    const peak = 60_000;
    expect(kilonovaLuminosity(0)).toBe(0);
    // Rising branch into the peak window...
    expect(kilonovaLuminosity(peak / 10)).toBeLessThan(kilonovaLuminosity(peak));
    // ...declining tail beyond it (the arctan-rise x power-law-fall product
    // peaks at/below the nominal peak time).
    expect(kilonovaLuminosity(peak * 2)).toBeLessThan(kilonovaLuminosity(peak));
    expect(kilonovaLuminosity(peak * 4)).toBeLessThan(kilonovaLuminosity(peak * 2));
  });

  it('temperature declines monotonically (diffusive cooling trend)', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 100; i += 1) {
      const tau = 1 + (100 * 86400 * i) / 100;
      const t = kilonovaTemperatureK(tau);
      expect(t).toBeGreaterThan(0);
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeLessThanOrEqual(prev);
      prev = t;
    }
  });

  it('maps temperature to finite non-negative linear RGB (bounded)', () => {
    for (const k of [0, 1500, 4500, 6500, 12000, 40000, 1e9, Number.NaN]) {
      const [r, g, b] = kelvinToLinearRgb(k);
      for (const v of [r, g, b]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // Cooling shifts the tint redward (blue component falls relative to red).
    const hot = kelvinToLinearRgb(8000);
    const cool = kelvinToLinearRgb(2500);
    expect(hot[2]).toBeGreaterThan(cool[2]);
  });

  it('full sample is coherent at a fixed time', () => {
    const res = scenarioOf();
    const s = kilonovaSampleAt(res.contactSeconds + 60_000, res);
    expect(s.ageSeconds).toBeCloseTo(60_000, 6);
    expect(s.luminosity).toBeGreaterThan(0);
    expect(s.temperatureK).toBeGreaterThan(0);
  });
});

describe('short-GRB jet (CA5-08/09, mission §14)', () => {
  it('on-axis response saturates, off-axis falls to the floor, all bounded', () => {
    const res = scenarioOf({ jetScenario: 'thin' });
    const on = jetViewingResponse(0, res);
    const near = jetViewingResponse(8, res);
    const off = jetViewingResponse(68, res);
    const edge = jetViewingResponse(90, res);
    // Monotone non-increasing in the viewing angle; on-axis saturates at the
    // same ceiling as the cone edge (standard beaming saturation).
    expect(on).toBeGreaterThanOrEqual(near);
    expect(near).toBeGreaterThan(off);
    expect(off).toBeGreaterThanOrEqual(edge);
    expect(edge).toBeGreaterThanOrEqual(RESPONSE_FLOOR);
    for (const v of [on, near, off, edge]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // The on/off contrast is substantial (mission: on-axis substantially
    // exceeds off-axis).
    expect(near / edge).toBeGreaterThan(5);
  });

  it('is finite at both angular extrema (no NaN near 0/90 degrees)', () => {
    const res = scenarioOf({ jetScenario: 'wide' });
    expect(Number.isFinite(jetViewingResponse(0, res))).toBe(true);
    expect(Number.isFinite(jetViewingResponse(90, res))).toBe(true);
  });

  it('front is zero before engine ignition and capped by the ejecta envelope', () => {
    const res = scenarioOf({ jetScenario: 'thin' });
    expect(jetFrontRadiusUnits(res.contactSeconds, res)).toBe(0);
    expect(jetFrontRadiusUnits(res.contactSeconds + 0.1, res)).toBe(0); // < delay
    let prev = -1;
    for (let i = 1; i <= 50; i += 1) {
      const t = res.contactSeconds + 1 + (7 * 86400 * i) / 50;
      const f = jetFrontRadiusUnits(t, res);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    // Never exceeds the disclosed cap x contemporaneous ejecta radius.
    const late = jetFrontRadiusUnits(res.contactSeconds + 86400, res);
    const ejecta = ejectaRadiusUnits(86400);
    expect(late).toBeLessThanOrEqual(2.5 * ejecta + 1e-9);
  });

  it('none scenario disables the jet entirely', () => {
    const res = scenarioOf({ jetScenario: 'none' });
    expect(jetFrontRadiusUnits(res.contactSeconds + 1000, res)).toBe(0);
    expect(jetViewingResponse(0, res)).toBe(0);
  });
});

describe('remnant scenarios (CA5-11, mission §15)', () => {
  it('scenario determinism: identical inputs give identical samples', () => {
    const res = scenarioOf({ remnantScenario: 'delayed-collapse' });
    const a = remnantSampleAt(res.contactSeconds + 5, res, res.r1Units);
    const b = remnantSampleAt(res.contactSeconds + 5, res, res.r1Units);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('prompt-bh presents a dark core with bounded glow', () => {
    const res = scenarioOf({ remnantScenario: 'prompt-bh' });
    const s = remnantSampleAt(res.contactSeconds + 1, res, res.r1Units);
    expect(s.gain).toBe(0);
    expect(s.glowGain).toBeGreaterThan(0);
    expect(remnantVisibleAt(res.contactSeconds + 1, res)).toBe(false);
  });

  it('delayed-collapse switches deterministically at the scripted time', () => {
    const res = scenarioOf({ remnantScenario: 'delayed-collapse' });
    const before = remnantSampleAt(
      res.contactSeconds + res.delayedCollapseSeconds - 0.5,
      res,
      res.r1Units
    );
    const after = remnantSampleAt(
      res.contactSeconds + res.delayedCollapseSeconds + 0.5,
      res,
      res.r1Units
    );
    expect(before.gain).toBe(1);
    expect(after.gain).toBe(0);
    expect(after.glowGain).toBeGreaterThan(0);
  });

  it('massive-ns stays visible through the afterglow', () => {
    const res = scenarioOf({ remnantScenario: 'massive-ns' });
    expect(remnantVisibleAt(res.contactSeconds + 7 * 86400, res)).toBe(true);
  });
});

describe('scrub/reset determinism (CA5-12, mission §12/§20)', () => {
  it('state at t is a pure function of (scenario, t) — no traversal history', () => {
    const res = scenarioOf({ massScenario: 'unequal-mass' });
    const direct = inspiralStateAt(res, res.contactSeconds * 0.5);
    // Simulate a scrub path: 0 -> 0.9 -> 0.1 -> 0.5 of contact.
    inspiralStateAt(res, res.contactSeconds * 0.9);
    inspiralStateAt(res, res.contactSeconds * 0.1);
    const scrubbed = inspiralStateAt(res, res.contactSeconds * 0.5);
    expect(scrubbed.phase).toBe(direct.phase);
    expect(scrubbed.separation).toBe(direct.separation);
    expect(scrubbed.position.x1).toBe(direct.position.x1);
  });

  it('timeline round-trip is stable from both directions', () => {
    const res = scenarioOf();
    const t = uiPhaseToSeconds(0.55, res);
    expect(secondsToUiPhase(t, res)).toBeCloseTo(0.55, 9);
    expect(secondsToUiPhase(uiPhaseToSeconds(secondsToUiPhase(t, res), res), res)).toBeCloseTo(
      0.55,
      9
    );
  });
});

describe('scene scale discipline', () => {
  it('uses the single conversion point', () => {
    expect(SCENE_UNIT_KM).toBe(10);
    const res = scenarioOf();
    // 12 km radius -> 1.2 units; 120 km separation -> 12 units.
    expect(res.r1Units).toBeCloseTo(1.2, 12);
    expect(res.a0Units).toBeCloseTo(12, 12);
  });
});
