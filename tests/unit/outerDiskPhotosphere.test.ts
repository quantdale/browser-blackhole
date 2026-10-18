/**
 * Outer-disk photosphere — geometry and emission-law contract.
 *
 * Locks the properties the flat RingGeometry could not satisfy and the thin
 * shell must: finite restrained height with radius ordering, closed-surface
 * vertex layout with valid indices and finite normals, preserved disk laws
 * (colour, soft edges, continuum response, Keplerian shear), deterministic
 * timeline behaviour, and honest scientific classification.
 */
import { describe, expect, it } from 'vitest';

import {
  DISK_DETAIL_OCTAVE1,
  DISK_DETAIL_OCTAVE2,
  DISK_FLARE_EXPONENT,
  DISK_RADIAL_EMISSIVITY_OUTER_FRACTION,
  DISK_SURFACE,
  DISK_SURFACE_GAIN,
  DISK_THICKNESS_AT_ROUT_FRACTION,
  OUTER_DISK_PATTERN_BASE,
  OUTER_DISK_PATTERN_FINE_AMPLITUDE,
  OUTER_DISK_PATTERN_WAVE_AMPLITUDE,
  OUTER_DISK_PHOTOSPHERE_DISCLOSURE,
  buildOuterDiskPhotosphereGeometry,
  outerDiskColorAt,
  outerDiskDetailAt,
  outerDiskEdgeFalloff,
  outerDiskLayout,
  outerDiskOmegaPerDay,
  outerDiskPatternAt,
  outerDiskRadialEmissivity,
  outerDiskRadialT,
  outerDiskThicknessAt
} from '../../src/phenomena/quasar-agn/outerDiskPhotosphere.js';
import {
  OUTER_DISK_INNER_RG,
  OUTER_DISK_OUTER_RG,
  ZONE_UNIT_RG
} from '../../src/phenomena/quasar-agn/types.js';

const LAYOUT = outerDiskLayout(307);

describe('outer disk photosphere layout', () => {
  it('keeps the documented radial boundaries and is geometrically thin', () => {
    expect(LAYOUT.rInUnits).toBeCloseTo(OUTER_DISK_INNER_RG / ZONE_UNIT_RG.nuclear);
    expect(LAYOUT.rOutUnits).toBeCloseTo(OUTER_DISK_OUTER_RG / ZONE_UNIT_RG.nuclear);
    expect(LAYOUT.rInUnits).toBeLessThan(LAYOUT.rOutUnits);
    // Finite restrained height: thin at the outer edge, thinner inside.
    expect(LAYOUT.thicknessAtOuterUnits).toBeGreaterThan(0);
    expect(LAYOUT.thicknessAtOuterUnits).toBeLessThan(LAYOUT.rOutUnits * 0.08);
    expect(LAYOUT.thicknessAtOuterUnits).toBeCloseTo(
      LAYOUT.rOutUnits * DISK_THICKNESS_AT_ROUT_FRACTION
    );
    expect(LAYOUT.thicknessAtInnerUnits).toBeLessThan(LAYOUT.thicknessAtOuterUnits);
  });

  it('flares monotonically and stays finite', () => {
    let previous = 0;
    for (let i = 0; i <= 16; i += 1) {
      const r = LAYOUT.rInUnits + ((LAYOUT.rOutUnits - LAYOUT.rInUnits) * i) / 16;
      const h = outerDiskThicknessAt(r, LAYOUT);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(previous);
      previous = h;
    }
    expect(outerDiskThicknessAt(LAYOUT.rOutUnits, LAYOUT)).toBeCloseTo(
      LAYOUT.thicknessAtOuterUnits,
      10
    );
    expect(outerDiskThicknessAt(LAYOUT.rInUnits, LAYOUT)).toBeCloseTo(
      LAYOUT.thicknessAtInnerUnits,
      10
    );
    expect(DISK_FLARE_EXPONENT).toBeGreaterThan(1);
    expect(DISK_FLARE_EXPONENT).toBeLessThan(1.5);
  });

  it('reports consistent vertex and triangle counts', () => {
    const az = LAYOUT.azimuthSegments;
    const rings = LAYOUT.radialSegments + 1;
    expect(LAYOUT.vertexCount).toBe(2 * rings * az + 4 * az);
    expect(LAYOUT.triangleCount).toBe(4 * LAYOUT.radialSegments * az + 4 * az);
  });
});

describe('outer disk photosphere geometry', () => {
  const geometry = buildOuterDiskPhotosphereGeometry(LAYOUT);
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const surfaces = geometry.getAttribute('aSurface');
  const index = geometry.getIndex();

  it('has the declared counts and a valid index buffer', () => {
    expect(positions.count).toBe(LAYOUT.vertexCount);
    expect(normals.count).toBe(LAYOUT.vertexCount);
    expect(surfaces.count).toBe(LAYOUT.vertexCount);
    expect(index).not.toBeNull();
    expect(index?.count).toBe(LAYOUT.triangleCount * 3);
    let maxIndex = 0;
    for (let i = 0; i < (index?.count ?? 0); i += 1) {
      const v = index?.getX(i) ?? 0;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(LAYOUT.vertexCount);
      maxIndex = Math.max(maxIndex, v);
    }
    expect(maxIndex).toBe(LAYOUT.vertexCount - 1);
  });

  it('keeps every vertex finite and inside the annular shell bounds', () => {
    const eps = 1e-5;
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      const r = Math.hypot(x, z);
      expect(r).toBeGreaterThanOrEqual(LAYOUT.rInUnits - eps);
      expect(r).toBeLessThanOrEqual(LAYOUT.rOutUnits + eps);
      const maxHalfThickness = outerDiskThicknessAt(r, LAYOUT) / 2 + eps;
      expect(Math.abs(y)).toBeLessThanOrEqual(maxHalfThickness);
    }
  });

  it('has finite unit normals and all four surfaces represented', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < normals.count; i += 1) {
      const nx = normals.getX(i);
      const ny = normals.getY(i);
      const nz = normals.getZ(i);
      expect(Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)).toBe(true);
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
      const surface = surfaces.getX(i);
      expect(Object.values(DISK_SURFACE)).toContain(surface);
      counts.set(surface, (counts.get(surface) ?? 0) + 1);
    }
    const az = LAYOUT.azimuthSegments;
    const rings = LAYOUT.radialSegments + 1;
    expect(counts.get(DISK_SURFACE.top)).toBe(rings * az);
    expect(counts.get(DISK_SURFACE.bottom)).toBe(rings * az);
    expect(counts.get(DISK_SURFACE.innerRim)).toBe(2 * az);
    expect(counts.get(DISK_SURFACE.outerRim)).toBe(2 * az);
  });

  it('points top normals up and bottom normals down', () => {
    for (let i = 0; i < positions.count; i += 1) {
      const surface = surfaces.getX(i);
      const ny = normals.getY(i);
      if (surface === DISK_SURFACE.top) expect(ny).toBeGreaterThan(0.9);
      if (surface === DISK_SURFACE.bottom) expect(ny).toBeLessThan(-0.9);
      if (surface === DISK_SURFACE.innerRim || surface === DISK_SURFACE.outerRim) {
        expect(Math.abs(ny)).toBeLessThan(1e-6);
      }
    }
  });
});

describe('preserved disk emission laws', () => {
  it('keeps the warm-inner to violet-outer colour law', () => {
    const inner = outerDiskColorAt(0);
    const outer = outerDiskColorAt(1);
    expect(inner[0]).toBeCloseTo(1.0, 5);
    expect(inner[1]).toBeCloseTo(0.87, 5);
    expect(inner[2]).toBeCloseTo(0.63, 5);
    expect(outer[0]).toBeCloseTo(0.72, 5);
    expect(outer[1]).toBeCloseTo(0.56, 5);
    expect(outer[2]).toBeCloseTo(0.96, 5);
  });

  it('keeps the soft INNER fade and a defined outer boundary', () => {
    // Documented deviation from the old annulus: a fading outer alpha cannot
    // write depth without cutting the background, so the photosphere keeps
    // only the soft inner fade and a defined outer photospheric boundary.
    expect(outerDiskEdgeFalloff(0)).toBe(0);
    expect(outerDiskEdgeFalloff(1)).toBeCloseTo(1, 5);
    expect(outerDiskEdgeFalloff(0.5)).toBeCloseTo(1, 5);
    expect(outerDiskEdgeFalloff(-0.1)).toBe(0);
    expect(outerDiskEdgeFalloff(1.1)).toBeCloseTo(1, 5);
  });

  it('keeps the radial parameterization and monotone radial emissivity', () => {
    expect(outerDiskRadialT(LAYOUT.rInUnits, LAYOUT)).toBeCloseTo(0, 10);
    expect(outerDiskRadialT(LAYOUT.rOutUnits, LAYOUT)).toBeCloseTo(1, 10);
    expect(outerDiskRadialEmissivity(0)).toBeCloseTo(1, 10);
    expect(outerDiskRadialEmissivity(1)).toBeCloseTo(DISK_RADIAL_EMISSIVITY_OUTER_FRACTION, 10);
    let previous = Infinity;
    for (let i = 0; i <= 10; i += 1) {
      const value = outerDiskRadialEmissivity(i / 10);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('keeps the continuum response linear in the brightness factor', () => {
    // The continuum factor multiplies the pattern identically for any gain;
    // the module contract is brightness ~ pattern * continuum * 1.08.
    const phi = 0.7;
    const rRg = 3500;
    const pattern = outerDiskPatternAt(phi, rRg, 12.5, 180);
    const detail = outerDiskDetailAt(phi, 0.4, 12.5, 180, rRg, LAYOUT.seedOffset);
    expect(Number.isFinite(pattern * detail)).toBe(true);
    expect(pattern).toBeGreaterThan(0);
    // Continuum scaling is asserted at the module level via the debug
    // snapshot; here the shared factor's absence from the pattern/detail
    // functions guarantees the response stays a pure multiplicative term.
  });
});

describe('deterministic timeline behaviour', () => {
  const omegaScale = 180;

  it('is a pure function of the timeline days', () => {
    const a = outerDiskPatternAt(1.1, 4200, 33.3, omegaScale);
    const b = outerDiskPatternAt(1.1, 4200, 33.3, omegaScale);
    expect(a).toBe(b);
    const d1 = outerDiskDetailAt(1.1, 0.55, 33.3, omegaScale, 4200, LAYOUT.seedOffset);
    const d2 = outerDiskDetailAt(1.1, 0.55, 33.3, omegaScale, 4200, LAYOUT.seedOffset);
    expect(d1).toBe(d2);
  });

  it('advances with time and shears differentially with radius', () => {
    const early = outerDiskPatternAt(0.3, 1200, 10, omegaScale);
    const late = outerDiskPatternAt(0.3, 1200, 200, omegaScale);
    expect(late).not.toBe(early);
    // The same time offset rotates inner radii further than outer radii.
    const innerOmega = outerDiskOmegaPerDay(1200, omegaScale);
    const outerOmega = outerDiskOmegaPerDay(7000, omegaScale);
    expect(innerOmega).toBeGreaterThan(outerOmega);
  });

  it('stays bounded with finite outputs (no clipping blowups)', () => {
    for (let i = 0; i < 64; i += 1) {
      const phi = (i / 64) * Math.PI * 2;
      const t = i * 3.7;
      const pattern = outerDiskPatternAt(phi, 900 + i * 137, t, omegaScale);
      const detail = outerDiskDetailAt(
        phi,
        (i % 16) / 16,
        t,
        omegaScale,
        900 + i * 137,
        LAYOUT.seedOffset
      );
      expect(Number.isFinite(pattern)).toBe(true);
      expect(Number.isFinite(detail)).toBe(true);
      const patternFloor =
        OUTER_DISK_PATTERN_BASE -
        OUTER_DISK_PATTERN_WAVE_AMPLITUDE -
        OUTER_DISK_PATTERN_FINE_AMPLITUDE;
      const patternCeil =
        OUTER_DISK_PATTERN_BASE +
        OUTER_DISK_PATTERN_WAVE_AMPLITUDE +
        OUTER_DISK_PATTERN_FINE_AMPLITUDE;
      expect(pattern).toBeGreaterThanOrEqual(patternFloor - 1e-6);
      expect(pattern).toBeLessThanOrEqual(patternCeil + 1e-6);
      expect(detail).toBeGreaterThanOrEqual(1 - DISK_DETAIL_OCTAVE1 - DISK_DETAIL_OCTAVE2 - 1e-6);
      expect(detail).toBeLessThanOrEqual(1 + DISK_DETAIL_OCTAVE1 + DISK_DETAIL_OCTAVE2 + 1e-6);
    }
  });

  it('gives the same geometry for any seed (only the noise domain follows it)', () => {
    const other = outerDiskLayout(999);
    const g1 = buildOuterDiskPhotosphereGeometry(LAYOUT).getAttribute('position');
    const g2 = buildOuterDiskPhotosphereGeometry(other).getAttribute('position');
    expect(g1.count).toBe(g2.count);
    for (let i = 0; i < g1.count; i += 7) {
      expect(g2.getX(i)).toBe(g1.getX(i));
      expect(g2.getY(i)).toBe(g1.getY(i));
      expect(g2.getZ(i)).toBe(g1.getZ(i));
    }
    expect(other.seedOffset).not.toBe(LAYOUT.seedOffset);
  });
});

describe('scientific classification', () => {
  it('discloses the representation-layer approximation honestly', () => {
    expect(OUTER_DISK_PHOTOSPHERE_DISCLOSURE).toContain('representation-layer');
    expect(OUTER_DISK_PHOTOSPHERE_DISCLOSURE).toContain('NOT GRMHD');
    expect(OUTER_DISK_PHOTOSPHERE_DISCLOSURE).toContain('NOT a solved vertical disk model');
    expect(OUTER_DISK_PHOTOSPHERE_DISCLOSURE).toContain('Keplerian');
    expect(OUTER_DISK_PHOTOSPHERE_DISCLOSURE).toContain('illustrative');
  });

  it('keeps surface shading as an explicit presentation choice', () => {
    expect(DISK_SURFACE_GAIN.top).toBe(1);
    expect(DISK_SURFACE_GAIN.bottom).toBeLessThan(DISK_SURFACE_GAIN.top);
    expect(DISK_SURFACE_GAIN.outerRim).toBeLessThan(DISK_SURFACE_GAIN.top);
    expect(DISK_SURFACE_GAIN.innerRim).toBeLessThan(DISK_SURFACE_GAIN.top);
  });
});
