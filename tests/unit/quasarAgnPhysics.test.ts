/**
 * CA7-01/CA7-02/CA7-13 — Quasar/AGN pure-logic validation.
 *
 * Covers (docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md §7):
 * - scale-zone hysteresis machine: boundary behavior, no-flicker bands,
 *   totality over the input domain;
 * - scale/unit architecture: zone unit table, physical readouts, mass
 *   independence of normalized geometry;
 * - camera coherence contract: every preset position sits at
 *   agnCameraDistance(zoneOf(zoom01), zoom01) on its documented ray;
 * - blazar beaming-ratio approximation: monotone, edge-on == 1, bounded;
 * - normalizer clamp-don't-reject behavior incl. hostile payloads.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUASAR_AGN_STATE,
  ZONE_BOUNDS,
  ZONE_JUMP_ZOOM,
  agnCameraDistance,
  agnScaleReadout,
  jetLobeBrightnessRatio,
  normalizeQuasarAgnState,
  resolveAgnZone,
  resolveZoneView,
  type AgnZoneId
} from '../../src/phenomena/quasar-agn/types.js';
import {
  QUASAR_AGN_DESCRIPTOR,
  QUASAR_AGN_PRESETS
} from '../../src/phenomena/quasar-agn/presets.js';

describe('scale-zone hysteresis machine (CA7-02)', () => {
  it('starts in inner below the nuclear enter bound', () => {
    expect(resolveAgnZone(0, 'inner')).toBe('inner');
    expect(resolveAgnZone(ZONE_BOUNDS.nuclearEnter - 0.01, 'inner')).toBe('inner');
  });

  it('enters nuclear/galactic at the enter bounds', () => {
    expect(resolveAgnZone(ZONE_BOUNDS.nuclearEnter, 'inner')).toBe('nuclear');
    expect(resolveAgnZone(ZONE_BOUNDS.galacticEnter, 'nuclear')).toBe('galactic');
    expect(resolveAgnZone(1, 'nuclear')).toBe('galactic');
  });

  it('holds hysteresis bands against flicker', () => {
    // Inside the band the zone does NOT change even though a stateless
    // evaluation of zoom would suggest the neighbor zone.
    const midBand = (ZONE_BOUNDS.nuclearExit + ZONE_BOUNDS.nuclearEnter) / 2;
    expect(resolveAgnZone(midBand, 'nuclear')).toBe('nuclear');
    expect(resolveAgnZone(midBand, 'inner')).toBe('inner');
    expect(
      resolveAgnZone((ZONE_BOUNDS.galacticExit + ZONE_BOUNDS.galacticEnter) / 2, 'galactic')
    ).toBe('galactic');
    expect(
      resolveAgnZone((ZONE_BOUNDS.galacticExit + ZONE_BOUNDS.galacticEnter) / 2, 'nuclear')
    ).toBe('nuclear');
  });

  it('exits downward only at the exit bounds', () => {
    expect(resolveAgnZone(ZONE_BOUNDS.nuclearExit + 0.01, 'nuclear')).toBe('nuclear');
    expect(resolveAgnZone(ZONE_BOUNDS.nuclearExit - 0.01, 'nuclear')).toBe('inner');
    expect(resolveAgnZone(ZONE_BOUNDS.galacticExit + 0.01, 'galactic')).toBe('galactic');
    expect(resolveAgnZone(ZONE_BOUNDS.galacticExit - 0.01, 'galactic')).toBe('nuclear');
  });

  it('is total and stable across the whole domain sweep', () => {
    for (let i = 0; i <= 100; i += 1) {
      const z = i / 100;
      for (const current of ['inner', 'nuclear', 'galactic'] as AgnZoneId[]) {
        const next = resolveAgnZone(z, current);
        expect(['inner', 'nuclear', 'galactic']).toContain(next);
      }
    }
    // Out-of-domain input is inert.
    expect(resolveAgnZone(-1, 'nuclear')).toBe('nuclear');
    expect(resolveAgnZone(2, 'nuclear')).toBe('nuclear');
  });

  it('exposes monotone jump targets ordered inner<nuclear<galactic', () => {
    expect(ZONE_JUMP_ZOOM.inner).toBeLessThan(ZONE_JUMP_ZOOM.nuclear);
    expect(ZONE_JUMP_ZOOM.nuclear).toBeLessThan(ZONE_JUMP_ZOOM.galactic);
  });
});

describe('unit/scale architecture (CA7-01)', () => {
  it('uses the documented per-zone multipliers', () => {
    expect(Object.values(resolveZoneView('inner'))).toBeTruthy();
    const readout = agnScaleReadout(1e8);
    // r_g for 1e8 M_sun ~ 1.48e11 m ~ 0.99 AU.
    expect(readout.rgAu).toBeGreaterThan(0.9);
    expect(readout.rgAu).toBeLessThan(1.1);
    // NUCLEAR unit (1e3 r_g) should be milli-parsecs; GALACTIC (1e7 r_g)
    // tens of parsecs at 1e8 M_sun.
    expect(readout.nuclearUnitPc).toBeGreaterThan(3e-3);
    expect(readout.nuclearUnitPc).toBeLessThan(6e-3);
    expect(readout.galacticUnitPc).toBeGreaterThan(40);
    expect(readout.galacticUnitPc).toBeLessThan(55);
    // 1 kpc in r_g for 1e8 M_sun ~ 2e8.
    expect(readout.kpcInRg).toBeGreaterThan(1.8e8);
    expect(readout.kpcInRg).toBeLessThan(2.4e8);
  });

  it('scales physical readouts linearly with SMBH mass', () => {
    const a = agnScaleReadout(1e8);
    const b = agnScaleReadout(2e8);
    expect(b.rgMetres / a.rgMetres).toBeCloseTo(2, 9);
    expect(b.kpcInRg / a.kpcInRg).toBeCloseTo(0.5, 9);
  });

  it('keeps the DIRECT pass exclusive to the INNER zone', () => {
    expect(resolveZoneView('inner').grPassActive).toBe(true);
    expect(resolveZoneView('nuclear').grPassActive).toBe(false);
    expect(resolveZoneView('galactic').grPassActive).toBe(false);
  });
});

describe('camera coherence contract (CA7-11)', () => {
  it('places every preset camera on its zoom-law distance ray', () => {
    for (const preset of QUASAR_AGN_PRESETS) {
      const state = normalizeQuasarAgnState(preset.state);
      const cam = preset.camera;
      const distance = Math.hypot(cam.position[0], cam.position[1], cam.position[2]);
      const zone = resolveAgnZone(state.zoom01, 'inner');
      const lawDistance = agnCameraDistance(zone, state.zoom01);
      expect(
        distance / lawDistance,
        `${preset.id}: |pos| must equal the zoom-law distance`
      ).toBeCloseTo(1, 4);
      // Target is the origin (the AGN engine) for every production preset.
      expect(Math.hypot(cam.target[0], cam.target[1], cam.target[2])).toBeCloseTo(0, 9);
      void QUASAR_AGN_DESCRIPTOR;
    }
  });
});

describe('blazar beaming-ratio approximation (disclosed model)', () => {
  it('equals 1 edge-on and grows monotonically toward the axis', () => {
    expect(jetLobeBrightnessRatio(90)).toBeCloseTo(1, 12);
    let previous = 0;
    for (let deg = 89; deg >= 0; deg -= 1) {
      const r = jetLobeBrightnessRatio(deg);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
    expect(jetLobeBrightnessRatio(0)).toBeGreaterThan(10);
  });

  it('stays bounded on the disclosed fixed-Gamma power law', () => {
    const maxRatio = jetLobeBrightnessRatio(0);
    // ((1+beta)/(1-beta))^kappa with Gamma=8, kappa=3 -> ~1.6e7 on-axis.
    // Display gains are CONSTANT-SUM normalized (<= 2 each), so the raw
    // ratio only redistributes brightness between lobes.
    expect(maxRatio).toBeGreaterThan(1e5);
    expect(maxRatio).toBeLessThan(1e8);
  });
});

describe('normalizer (one authority, clamp-don-t-reject)', () => {
  it('returns canonical defaults for empty/hostile payloads', () => {
    expect(normalizeQuasarAgnState({})).toEqual(DEFAULT_QUASAR_AGN_STATE);
    expect(normalizeQuasarAgnState(null)).toEqual(DEFAULT_QUASAR_AGN_STATE);
    expect(
      normalizeQuasarAgnState({ blackHoleMassSolar: 'x', scenario: 42 }).blackHoleMassSolar
    ).toBe(DEFAULT_QUASAR_AGN_STATE.blackHoleMassSolar);
  });

  it('clamps out-of-range values into documented domains', () => {
    const s = normalizeQuasarAgnState({
      blackHoleMassSolar: 1e15,
      zoom01: 7,
      observerAngleToJetDeg: -20,
      jetTracerDensity: 42
    });
    expect(s.blackHoleMassSolar).toBe(1e10);
    expect(s.zoom01).toBe(1);
    expect(s.observerAngleToJetDeg).toBe(0);
    expect(s.jetTracerDensity).toBe(1);
  });

  it('preserves valid scenario values and rejects unknown ones to default', () => {
    expect(normalizeQuasarAgnState({ scenario: 'blazar-view' }).scenario).toBe('blazar-view');
    expect(normalizeQuasarAgnState({ scenario: 'nope' }).scenario).toBe(
      DEFAULT_QUASAR_AGN_STATE.scenario
    );
  });
});
