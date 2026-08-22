/**
 * Stellar Explosion reduced-model invariant corpus (mission section 39,
 * docs/cosmic-atlas/VALIDATION_TESTING.md section 6).
 *
 * These tests validate the SCIENTIFIC CORE only (CPU faces); rendering is
 * covered separately by browser suites once the module lands. Invariants:
 * monotone expansion, non-negative finite bounded density, seed determinism,
 * structural hypernova difference, jet geometry bounds, on/off-axis response,
 * timeline roundtrip/ordering, temperature trend honesty.
 */

import { describe, expect, it } from 'vitest';

import {
  luminosityProxy,
  photosphericTemperatureK,
  resolveScenario,
  shockRadiusUnits,
  shockVelocityUnitsS,
  structurallyDistinct,
  TEMPERATURE_FLOOR_K
} from '../../src/phenomena/stellar-explosion/physics.js';
import {
  engineIgnitionSeconds,
  formatSimSeconds,
  makeExplosionPhaseMapping,
  phaseAt,
  phaseBoundaries,
  phaseSequence,
  secondsToUiPhase,
  uiPhaseToSeconds
} from '../../src/phenomena/stellar-explosion/timeline.js';
import {
  jetAxisBasis,
  jetDensityFactor,
  jetFrontUnits,
  viewingResponse
} from '../../src/phenomena/stellar-explosion/jet.js';
import { kelvinToLinearRgb } from '../../src/phenomena/stellar-explosion/emission.js';
import {
  normalizeStellarExplosionState,
  type StellarExplosionPublicState
} from '../../src/phenomena/stellar-explosion/types.js';
import {
  STELLAR_EXPLOSION_DESCRIPTOR,
  STELLAR_EXPLOSION_PRESETS
} from '../../src/phenomena/stellar-explosion/presets.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_STATE: StellarExplosionPublicState = {
  scenarioId: 'core-collapse',
  progenitorRadiusSolar: 500,
  progenitorTemperatureK: 3800,
  energyProxyFoe: 1.2,
  ejectaMassProxySolar: 9,
  expansionVelocityScaleKmS: 11000,
  anisotropyStrength: 0.35,
  anisotropyAxis: [0, 1, 0],
  lobeWeighting: 0.3,
  clumpingLevel: 0.55,
  clumpingSeed: 41,
  jet: { enabled: false, halfOpeningAngleDeg: 10, velocityProxyC: 0.5, viewingAngleDeg: 90 },
  timeSeconds: 0
};

function presetState(presetId: string): StellarExplosionPublicState {
  const preset = STELLAR_EXPLOSION_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`missing preset ${presetId}`);
  return normalizeStellarExplosionState(preset.state as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Shock expansion invariants
// ---------------------------------------------------------------------------

describe('shock expansion', () => {
  const coreCollapse = resolveScenario(BASE_STATE);
  const hypernova = resolveScenario(presetState('hypernova'));

  it('radius is monotonically non-decreasing across dense samples (core collapse)', () => {
    let previous = -1;
    for (let i = 0; i <= 4000; i++) {
      const t = (i / 4000) * 400 * 86_400 * 4; // 0 .. ~4.4 years
      const r = shockRadiusUnits(t, coreCollapse);
      expect(r).toBeGreaterThanOrEqual(previous);
      expect(Number.isFinite(r)).toBe(true);
      previous = r;
    }
  });

  it('radius is monotonically non-decreasing for the hypernova past crossover', () => {
    let previous = -1;
    for (let i = 0; i <= 2000; i++) {
      const t = (i / 2000) * 300 * 86_400;
      const r = shockRadiusUnits(t, hypernova);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
  });

  it('velocity stays positive for all t > 0', () => {
    for (let i = 1; i <= 500; i++) {
      const t = Math.pow(10, -2 + (i / 500) * 8); // 0.01 s .. 1e6 s
      expect(shockVelocityUnitsS(t, coreCollapse)).toBeGreaterThan(0);
    }
  });

  it('free-expansion branch matches v0*t early and decelerates late', () => {
    const earlyR = shockRadiusUnits(3600, coreCollapse); // 1 h << 12 h crossover
    const expectedEarly = coreCollapse.velocityUnitsS * 3600;
    expect(earlyR / expectedEarly).toBeCloseTo(1, 3);

    const lateV = shockVelocityUnitsS(180 * 86_400, coreCollapse);
    expect(lateV).toBeLessThan(coreCollapse.velocityUnitsS); // decelerating
  });

  it('radius is zero before the trigger and non-negative everywhere', () => {
    expect(shockRadiusUnits(-50, coreCollapse)).toBe(0);
    expect(shockRadiusUnits(Number.NaN, coreCollapse)).toBe(0);
    for (let i = 0; i <= 200; i++) {
      expect(shockRadiusUnits(i * 1e4, hypernova)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Temperature / luminosity trends
// ---------------------------------------------------------------------------

describe('temperature and luminosity proxies', () => {
  const resolved = resolveScenario(BASE_STATE);

  it('temperature is finite everywhere and respects the floor', () => {
    for (let i = 0; i <= 1000; i++) {
      const t = (i / 1000) * 200 * 86_400;
      const temp = photosphericTemperatureK(t, resolved);
      expect(Number.isFinite(temp)).toBe(true);
      expect(temp).toBeGreaterThanOrEqual(TEMPERATURE_FLOOR_K);
    }
  });

  it('temperature rises to flash peak then is monotonically non-increasing', () => {
    let peakSeen = 0;
    let rising = true;
    let previous = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 800; i++) {
      const t = resolved.explosionTimeSeconds + (i / 800) * 120 * 86_400;
      const temp = photosphericTemperatureK(t, resolved);
      peakSeen = Math.max(peakSeen, temp);
      if (rising && temp > previous + 1e-6) {
        // still rising toward the flash peak
      } else if (temp < peakSeen) {
        rising = false;
      }
      if (!rising) {
        expect(temp).toBeLessThanOrEqual(previous + 1e-6);
      }
      previous = temp;
    }
    expect(peakSeen).toBeGreaterThan(resolved.progenitorTemperatureK);
  });

  it('luminosity peaks once and declines, staying finite', () => {
    let maxL = 0;
    let argMaxI = 0;
    const samples: number[] = [];
    for (let i = 0; i <= 10_000; i++) {
      // Dense enough to resolve the 6 h flash rise inside a 90 d window.
      const t = resolved.explosionTimeSeconds + (i / 10_000) * 90 * 86_400;
      const l = luminosityProxy(t, resolved);
      samples.push(l);
      expect(Number.isFinite(l)).toBe(true);
      if (l > maxL) {
        maxL = l;
        argMaxI = i;
      }
    }
    expect(maxL).toBeCloseTo(1, 1); // peak-normalized shape
    expect(argMaxI).toBeLessThan(10_000 / 2); // decline dominates the tail
    expect(samples[samples.length - 1]).toBeLessThan(0.2);
  });
});

// ---------------------------------------------------------------------------
// Density field invariants (CPU face)
// ---------------------------------------------------------------------------

describe('density field', () => {
  it('non-negative, finite, bounded on seeded clouds across phases', async () => {
    const { cpuDensity, MAX_DENSITY_FACTOR } =
      await import('../../src/phenomena/stellar-explosion/density.js');
    for (const presetId of ['core-collapse', 'stripped-envelope', 'long-grb-on-axis']) {
      const resolved = resolveScenario(presetState(presetId));
      for (const t of [60, 91, 20 * 3600, 5 * 86_400, 40 * 86_400]) {
        let seedState = t * 2654435761;
        const nextRand = (): number => {
          seedState = (seedState * 1103515245 + 12345) % 2147483648;
          return seedState / 2147483648;
        };
        // Age since trigger -> characteristic radius; sample AROUND the shell
        // (deep-cavity and far-field points are trivially zero).
        const age = Math.max(0, t - resolved.explosionTimeSeconds);
        const shellR = shockRadiusUnits(age, resolved);
        if (shellR > 0) {
          for (let i = 0; i < 300; i++) {
            const r = shellR * (0.7 + nextRand() * 0.6);
            const theta = nextRand() * Math.PI * 2;
            const zc = nextRand() * 2 - 1;
            const sinPhi = Math.sqrt(Math.max(0, 1 - zc * zc));
            const value = cpuDensity(
              r * sinPhi * Math.cos(theta),
              r * zc,
              r * sinPhi * Math.sin(theta),
              t,
              resolved
            );
            expect(value).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeLessThanOrEqual(MAX_DENSITY_FACTOR * 1.01);
          }
        }
      }
    }
  });

  it('same seed reproduces identical density values', async () => {
    const { cpuDensity } = await import('../../src/phenomena/stellar-explosion/density.js');
    const a = resolveScenario(resolveStateWithSeed(BASE_STATE, 4242));
    const b = resolveScenario(resolveStateWithSeed(BASE_STATE, 4242));
    for (let i = 1; i < 60; i++) {
      const t = i * 3600;
      const age = Math.max(0, t - a.explosionTimeSeconds);
      const r = shockRadiusUnits(age, a);
      if (r <= 0) continue;
      const theta = i * 0.7;
      const x = r * Math.cos(theta);
      const y = r * 0.9;
      const z = r * Math.sin(theta);
      expect(cpuDensity(x, y, z, t, a)).toBe(cpuDensity(x, y, z, t, b));
    }
  });

  it('changing clumpingSeed changes morphology while shell envelope is unchanged', async () => {
    const { cpuDensity } = await import('../../src/phenomena/stellar-explosion/density.js');
    const noClumpA = resolveScenario({ ...resolveStateWithSeed(BASE_STATE, 1), clumpingLevel: 0 });
    const noClumpB = resolveScenario({
      ...resolveStateWithSeed(BASE_STATE, 999),
      clumpingLevel: 0
    });
    const clumpA = resolveScenario(resolveStateWithSeed(BASE_STATE, 1));
    const clumpB = resolveScenario(resolveStateWithSeed(BASE_STATE, 999));

    const t = 30 * 86_400;
    const age = t - clumpA.explosionTimeSeconds;
    const shellR = shockRadiusUnits(age, clumpA);
    let sawDifference = false;
    for (let i = 1; i < 80; i++) {
      // Points distributed on the current shell surface (nonzero support).
      const theta = i * 0.83;
      const height = ((i % 13) / 13 - 0.5) * 2; // -1..1
      const sinPhi = Math.sqrt(Math.max(0, 1 - height * height));
      const x = shellR * sinPhi * Math.cos(theta);
      const y = shellR * height;
      const z = shellR * sinPhi * Math.sin(theta);
      // Envelope (no clumping) must be seed-independent.
      expect(cpuDensity(x, y, z, t, noClumpA)).toBe(cpuDensity(x, y, z, t, noClumpB));
      if (cpuDensity(x, y, z, t, clumpA) !== cpuDensity(x, y, z, t, clumpB)) {
        sawDifference = true;
      }
    }
    expect(sawDifference).toBe(true);
  });

  function resolveStateWithSeed(
    base: StellarExplosionPublicState,
    seed: number
  ): StellarExplosionPublicState {
    return { ...base, clumpingSeed: seed };
  }
});

// ---------------------------------------------------------------------------
// Scenario structure (hypernova honesty)
// ---------------------------------------------------------------------------

describe('scenario structure', () => {
  it('hypernova resolves structurally different from core collapse', () => {
    const cc = resolveScenario(presetState('core-collapse'));
    const hn = resolveScenario(presetState('hypernova'));
    expect(hn.velocityKmS).toBeGreaterThan(cc.velocityKmS * 2);
    expect(hn.anisotropyStrength).toBeGreaterThan(cc.anisotropyStrength);
    expect(structurallyDistinct(cc, hn)).toBe(true);
    // Structural difference is NOT achieved by brightness alone: energy proxy
    // alone never enters luminosityProxy normalization.
    expect(hn.lobeWeighting).not.toBe(cc.lobeWeighting);
  });

  it('every preset passes its own normalizer unchanged within bounds', () => {
    for (const preset of STELLAR_EXPLOSION_PRESETS) {
      const normalized = normalizeStellarExplosionState(
        preset.state as unknown as Record<string, unknown>
      );
      expect(normalized.scenarioId).toBe((preset.state as Record<string, unknown>)['scenarioId']);
      expect(normalized.anisotropyAxis.length).toBe(3);
      const axisLen = Math.hypot(...normalized.anisotropyAxis);
      expect(axisLen).toBeCloseTo(1, 6);
      expect(normalized.clumpingSeed).toBeGreaterThanOrEqual(1);
      expect(normalized.jet.halfOpeningAngleDeg).toBeGreaterThanOrEqual(1);
      expect(normalized.jet.halfOpeningAngleDeg).toBeLessThanOrEqual(25);
    }
  });
});

// ---------------------------------------------------------------------------
// Jet geometry + viewing response
// ---------------------------------------------------------------------------

describe('jet model', () => {
  const grb = resolveScenario(presetState('long-grb-on-axis'));

  it('basis vectors are orthonormal', () => {
    const { axis, u, v } = jetAxisBasis([0.3, 0.9, -0.2]);
    expect(axis.length()).toBeCloseTo(1, 9);
    expect(u.length()).toBeCloseTo(1, 9);
    expect(v.length()).toBeCloseTo(1, 9);
    expect(Math.abs(axis.dot(u))).toBeLessThan(1e-9);
    expect(Math.abs(axis.dot(v))).toBeLessThan(1e-9);
    expect(Math.abs(u.dot(v))).toBeLessThan(1e-9);
  });

  it('jet front is exactly zero before ignition and grows after', () => {
    const ignition = engineIgnitionSeconds('long-grb');
    expect(jetFrontUnits(ignition - 1, ignition, grb)).toBe(0);
    const after = jetFrontUnits(ignition + 600, ignition, grb);
    expect(after).toBeGreaterThan(0);
    expect(jetFrontUnits(ignition + 1200, ignition, grb)).toBeGreaterThan(after);
  });

  it('factor negligible beyond 3 half-angles off axis', () => {
    const ignition = engineIgnitionSeconds('long-grb');
    const t = ignition + 3600;
    const along = grb.jet.velocityUnitsS * (t - ignition) * 0.5; // mid-jet point
    const halfRad = grb.jet.halfOpeningAngleRad;
    const far = Math.tan(halfRad * 3) * along;
    // Axis is +Y for this preset: axial coordinate runs along y.
    const nearFactor = jetDensityFactor(0, along, 0, t, ignition, grb);
    const farFactor = jetDensityFactor(0, along, far, t, ignition, grb);
    expect(nearFactor).toBeGreaterThan(0.1);
    expect(farFactor).toBeLessThan(1e-6);
  });

  it('viewing response differs strongly between on-axis and 90 degrees', () => {
    const on = viewingResponse(4, grb);
    const side = viewingResponse(90, grb);
    expect(on / side).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// Timeline machinery
// ---------------------------------------------------------------------------

describe('timeline', () => {
  it('forward-inverse roundtrip within 1e-9 over dense UI samples', () => {
    for (const scenario of ['core-collapse', 'long-grb'] as const) {
      for (let i = 0; i <= 512; i++) {
        const ui = i / 512;
        const roundtrip = secondsToUiPhase(uiPhaseToSeconds(ui, scenario), scenario);
        expect(Math.abs(roundtrip - ui)).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it('phase sequences are valid and ordered per scenario', () => {
    expect(phaseSequence('core-collapse')).toEqual([
      'progenitor',
      'collapse',
      'flash',
      'shock-breakout',
      'expanding-ejecta',
      'nebular'
    ]);
    expect(phaseSequence('long-grb')).toEqual([
      'progenitor',
      'collapse',
      'engine-ignition',
      'jet-breakout',
      'expanding-ejecta',
      'nebular'
    ]);
  });

  it('phaseAt is pure and boundary-consistent', () => {
    const boundaries = phaseBoundaries('core-collapse');
    let previousEnd = -1;
    for (const boundary of boundaries) {
      expect(boundary.startSeconds).toBeGreaterThanOrEqual(previousEnd);
      expect(phaseAt(boundary.startSeconds + 0.001, 'core-collapse')).toBe(boundary.phase);
      previousEnd = boundary.endSeconds;
    }
    // Purity: repeated calls identical.
    expect(phaseAt(123456, 'core-collapse')).toBe(phaseAt(123456, 'core-collapse'));
  });

  it('PhaseMapping matches the atlas contract and formats display strings', () => {
    const mapping = makeExplosionPhaseMapping(resolveScenario(BASE_STATE));
    expect(mapping.id).toBe('explosion-timeline');
    expect(typeof mapping.forward).toBe('function');
    expect(typeof mapping.inverse).toBe('function');
    const display = mapping.formatDisplay(mapping.forward(0.5));
    expect(display.length).toBeGreaterThan(0);
    expect(display).toMatch(/d|h|min|s|ms|months|yr/);
    expect(formatSimSeconds(0.5)).toContain('ms');
    expect(formatSimSeconds(36_000)).toContain('h');
    expect(formatSimSeconds(5 * 86_400)).toContain('d');
  });
});

// ---------------------------------------------------------------------------
// Emission ramp honesty
// ---------------------------------------------------------------------------

describe('kelvin ramp', () => {
  it('finite everywhere in domain, hue trend ordered, clamped outside', () => {
    const cold = kelvinToLinearRgb(1000);
    const hot = kelvinToLinearRgb(1e7);
    for (const rgb of [cold, hot, kelvinToLinearRgb(6500)]) {
      for (const channel of rgb) {
        expect(Number.isFinite(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
    // Red channel falls and blue channel rises with temperature (ordered hue).
    expect(cold[0]).toBeGreaterThan(hot[0]);
    expect(cold[2]).toBeLessThan(hot[2]);
    // Clamped, never extrapolated.
    expect(kelvinToLinearRgb(1e-6)).toEqual(kelvinToLinearRgb(1000));
    expect(kelvinToLinearRgb(1e12)).toEqual(kelvinToLinearRgb(1e7));
  });
});

// ---------------------------------------------------------------------------
// Descriptor sanity
// ---------------------------------------------------------------------------

describe('descriptor', () => {
  it('route/id/defaultPreset are consistent', () => {
    expect(STELLAR_EXPLOSION_PRESETS.find((p) => p.id === 'core-collapse')).toBeDefined();
    expect(STELLAR_EXPLOSION_PRESETS.find((p) => p.id === 'long-grb-off-axis')).toBeDefined();
    const ids = new Set(STELLAR_EXPLOSION_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(STELLAR_EXPLOSION_PRESETS.length);
    expect(STELLAR_EXPLOSION_DESCRIPTOR.route).toBe('stellar-explosion');
    expect(STELLAR_EXPLOSION_DESCRIPTOR.defaultPreset).toBe('core-collapse');
    expect(STELLAR_EXPLOSION_DESCRIPTOR.fidelity).toBe('PROCEDURAL_SCIENTIFIC');
  });
});
