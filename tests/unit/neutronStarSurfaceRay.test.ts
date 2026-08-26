/**
 * M12-NS — neutron-star surface-ray reference semantics (binary64 oracle).
 *
 * Gates tested here (openspec/changes/m12-neutron-star-surface-lensing):
 * - radial hit terminates on the material surface with finite refined
 *   coordinates and outward normal, never reaching horizon/capture logic;
 * - off-axis hits land ON the surface radius within refinement tolerance;
 * - clear misses escape with a usable terminal direction;
 * - the near-limb hit/miss transition matches the analytic Schwarzschild
 *   apparent limb b_limb = R/sqrt(1-2M/R) IN ITS REGIME R > 3 r_g;
 * - multiple-image behavior: a just-above-limb ray wrapping behind the star
 *   still terminates surface-hit (ultra-compact support evidence);
 * - deterministic repeats are bit-identical;
 * - invalid surfaces throw; degenerate rays report invalid-initial-state;
 * - exhausted budgets report numerical-failure, never success.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BISECTION_ITERATIONS,
  MIN_SURFACE_RADIUS_RG,
  analyticLimbImpactParameter,
  findLimbTransitionBisection,
  launchSurfaceRayFromImpactParameter,
  traceSurfaceRay,
  type NeutronStarSurfaceRayResult
} from '../../src/phenomena/neutron-star/surfaceRayReference.js';

/** Canonical production model: 1.4 Msun, 12 km -> R_rg ~ 5.805 r_g. */
const CANONICAL_SURFACE_RG = 12 / (1.4 * 1.476625);
const OBSERVER_RG = 42 / (1.4 * 1.476625); // 'surface' preset camera distance in r_g

function norm3(v: readonly [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

describe('neutron-star surface rays — termination semantics', () => {
  it('radial center ray hits the surface head-on with finite refined geometry', () => {
    const result = traceSurfaceRay([OBSERVER_RG, 0, 0], [-1, 0, 0], {
      surfaceRadiusRg: CANONICAL_SURFACE_RG
    });
    expect(result.classification).toBe('surface-hit');
    expect(result.steps).toBeGreaterThan(0);
    expect(Number.isFinite(result.minRadiusRg)).toBe(true);
    // Refined hit radius sits ON the surface within the bracketed tolerance.
    expect(Math.abs(result.finalRadiusRg - CANONICAL_SURFACE_RG)).toBeLessThan(1e-9);
    const hit = result.hitPositionRg!;
    expect(norm3(hit)).toBeCloseTo(CANONICAL_SURFACE_RG, 6);
    expect(Number.isFinite(hit[0]) && Number.isFinite(hit[1]) && Number.isFinite(hit[2])).toBe(
      true
    );
    const normal = result.hitNormal!;
    expect(Math.abs(norm3(normal) - 1)).toBeLessThan(1e-12);
    // Head-on hit: normal is exactly the inward launch axis (+x side).
    expect(normal[0]).toBeGreaterThan(0.999999);
    // The star surface is far above the horizon: capture logic never binds.
    expect(result.finalRadiusRg).toBeGreaterThan(2.001);
    expect(result.diagnostics.refinementSpan).toBeLessThanOrEqual(1 / DEFAULT_BISECTION_ITERATIONS);
  });

  it('off-axis hit lands on the surface and reports a unit normal', () => {
    // Aim a clearly-inside-the-limb ray at the origin from an offset start.
    const pos: [number, number, number] = [OBSERVER_RG, 2.0, 0];
    const len = Math.hypot(pos[0], pos[1]);
    const dir: [number, number, number] = [-pos[0] / len, -pos[1] / len, 0];
    const result = traceSurfaceRay(pos, dir, { surfaceRadiusRg: CANONICAL_SURFACE_RG });
    expect(result.classification).toBe('surface-hit');
    const hit = result.hitPositionRg!;
    expect(Math.abs(norm3(hit) - CANONICAL_SURFACE_RG)).toBeLessThan(1e-6);
    const n = result.hitNormal!;
    // Normal is parallel to the hit position (star centered at origin).
    const crossMag =
      Math.abs(n[1] * hit[2] - n[2] * hit[1]) +
      Math.abs(n[2] * hit[0] - n[0] * hit[2]) +
      Math.abs(n[0] * hit[1] - n[1] * hit[0]);
    expect(crossMag).toBeLessThan(1e-9);
  });

  it('outward-pointing rays escape and return a usable terminal direction', () => {
    const result = traceSurfaceRay([OBSERVER_RG, 0, 0], [1, 0, 0], {
      surfaceRadiusRg: CANONICAL_SURFACE_RG,
      escapeRadius: 256
    });
    expect(result.classification).toBe('escaped');
    expect(result.hitPositionRg).toBeUndefined();
    const dir = result.escapeDirection!;
    expect(Math.abs(norm3(dir) - 1)).toBeLessThan(1e-9);
    // Escaped outward: terminal direction keeps the outward radial sense.
    expect(dir[0]).toBeGreaterThan(0.99);
  });

  it('repeated traces of identical inputs are bit-identical', () => {
    const run = (): NeutronStarSurfaceRayResult =>
      traceSurfaceRay([OBSERVER_RG, 1.5, 0.5], [-0.96, -0.2, -0.18], {
        surfaceRadiusRg: CANONICAL_SURFACE_RG
      });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('exhausted step budgets stay numerical failures', () => {
    const result = traceSurfaceRay([OBSERVER_RG, 0, 0], [-1, 0, 0], {
      surfaceRadiusRg: CANONICAL_SURFACE_RG,
      maxSteps: 2
    });
    expect(result.classification).toBe('numerical-failure');
    expect(result.hitPositionRg).toBeUndefined();
    expect(result.steps).toBe(2);
  });

  it('degenerate rays report invalid-initial-state without integrating', () => {
    const zeroDir = traceSurfaceRay([OBSERVER_RG, 0, 0], [0, 0, 0], {
      surfaceRadiusRg: CANONICAL_SURFACE_RG
    });
    expect(zeroDir.classification).toBe('invalid-initial-state');
    expect(zeroDir.steps).toBe(0);

    const insideStar = traceSurfaceRay([1, 0, 0], [-1, 0, 0], {
      surfaceRadiusRg: CANONICAL_SURFACE_RG
    });
    expect(insideStar.classification).toBe('invalid-initial-state');

    const nonFinite = traceSurfaceRay([Number.NaN, 0, 0], [-1, 0, 0], {
      surfaceRadiusRg: CANONICAL_SURFACE_RG
    });
    expect(nonFinite.classification).toBe('invalid-initial-state');
  });

  it('rejects unsanctioned compactness loudly instead of rendering nonsense', () => {
    expect(() => traceSurfaceRay([10, 0, 0], [-1, 0, 0], { surfaceRadiusRg: 2 })).toThrowError(
      RangeError
    );
    expect(() =>
      traceSurfaceRay([10, 0, 0], [-1, 0, 0], { surfaceRadiusRg: MIN_SURFACE_RADIUS_RG / 2 })
    ).toThrowError(RangeError);
    expect(() =>
      traceSurfaceRay([10, 0, 0], [-1, 0, 0], { surfaceRadiusRg: Number.NaN })
    ).toThrowError(TypeError);
  });
});

describe('neutron-star apparent limb — analytic reference (regime R > 3 r_g)', () => {
  // Regime statement (design.md §6): b_limb = R/sqrt(1-2M/R) is the ASYMPTOTIC
  // limb relation for R > 3 r_g only. The canonical model (R_rg ~ 5.805) is
  // comfortably inside that regime.
  const bLimb = analyticLimbImpactParameter(CANONICAL_SURFACE_RG);
  const tightSettings = {
    surfaceRadiusRg: CANONICAL_SURFACE_RG,
    stepSize: 0.002,
    minStep: 1e-9,
    maxStep: 250,
    maxSteps: 2_000_000,
    escapeRadius: 2.5e4
  };

  it('analytic helper returns NaN outside its stated regime', () => {
    expect(analyticLimbImpactParameter(2.5)).toBeNaN(); // ultra-compact
    expect(analyticLimbImpactParameter(3)).toBeNaN(); // photon sphere
    expect(analyticLimbImpactParameter(CANONICAL_SURFACE_RG)).toBeGreaterThan(0);
    expect(Number.isFinite(analyticLimbImpactParameter(CANONICAL_SURFACE_RG))).toBe(true);
  });

  it('hit/miss transition agrees with b_limb within documented tolerance', () => {
    expect(bLimb).toBeGreaterThan(0);
    // Bracket generously, then bisect the physical boundary.
    const lo = 0.9 * bLimb;
    const hi = 1.1 * bLimb;
    expect(launchSurfaceRayFromImpactParameter(lo, tightSettings).classification).toBe(
      'surface-hit'
    );
    expect(launchSurfaceRayFromImpactParameter(hi, tightSettings).classification).toBe('escaped');
    const measured = findLimbTransitionBisection(lo, hi, tightSettings);
    // Tolerance budget: RK4 deflection accuracy + fixed 24-step linear
    // interpolation refinement, both far below 0.01 r_g at these settings.
    expect(Math.abs(measured - bLimb)).toBeLessThan(0.01);
  });

  it('near-limb probes straddle the transition exactly as classified', () => {
    const justInside = launchSurfaceRayFromImpactParameter(bLimb * (1 - 1e-4), tightSettings);
    const justOutside = launchSurfaceRayFromImpactParameter(bLimb * (1 + 1e-4), tightSettings);
    expect(justInside.classification).toBe('surface-hit');
    expect(justOutside.classification).toBe('escaped');
  });

  it('multiple-image regime: ultra-compact surfaces produce far-side hits', () => {
    // Physics note: for R > 3 r_g the material body BLOCKS the photon-sphere
    // region, so no secondary image exists (the limb transition above is the
    // whole story). For an ULTRA-COMPACT surface R < 3 r_g, rays winding
    // between the photon sphere and the surface strike the FAR hemisphere:
    // the numerical integrator must handle that morphology truthfully
    // (design.md §6 decision evidence).
    const ultraCompact = 2.6;
    const settings = {
      surfaceRadiusRg: ultraCompact,
      stepSize: 0.002,
      minStep: 1e-9,
      maxStep: 250,
      maxSteps: 2_000_000,
      escapeRadius: 2.5e4
    };
    let found: NeutronStarSurfaceRayResult | null = null;
    for (let b = 1.0; b <= 5.0; b += 0.02) {
      const probe = launchSurfaceRayFromImpactParameter(b, settings);
      if (probe.classification !== 'surface-hit') continue;
      const hit = probe.hitPositionRg!;
      // Source sits at (-x0, ...): hit x > 0 means the FAR side.
      if (hit[0] > 0 && probe.windingRadians > Math.PI) {
        found = probe;
        break;
      }
    }
    expect(found, 'expected at least one far-side secondary-image hit').not.toBeNull();
    expect(found!.classification).toBe('surface-hit');
    expect(Math.abs(norm3(found!.hitPositionRg!) - ultraCompact)).toBeLessThan(1e-6);
  });

  it('redshift ordering with compactness holds through the physics helper', async () => {
    const { surfaceRedshift } = await import('../../src/phenomena/neutron-star/physics.js');
    const gLoose = surfaceRedshift(1.4, 14_000);
    const gTight = surfaceRedshift(1.4, 11_000);
    expect(gTight).toBeLessThan(gLoose);
    expect(gLoose).toBeLessThan(1);
  });
});
