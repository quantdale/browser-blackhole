/**
 * TDE debris stream propagation, winding and self-intersection proxy
 * (CA6-06 / CA6-08).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 6 (stream winding;
 *   self-intersection/shock region; RibbonService for debris);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 9 (stream continuity; no
 *   intersection before the modeled phase; no teleporting under scrub);
 * - mission CA6-06/CA6-08 (continuous trajectories, deterministic
 *   intersection trigger, clear parameter relationship, honest labeling).
 *
 * MODEL (disclosed reduced dynamics — Newtonian Kepler family):
 * - The disrupted gas is represented by a one-parameter FAMILY of Kepler
 *   orbits sharing the encounter plane and periapsis direction, spread over
 *   the energy band [-spread/2, +spread/2] around the parabolic COM value.
 *   Bound members (eps < 0) are ellipses with periapsis q; unbound members
 *   are hyperbolas with the same periapsis.
 *   Elliptic:  a = mu / (-2 eps), e = 1 - q/a, M = n t, n = sqrt(mu/a^3)
 *   Hyperbolic: a_h = mu / (2 eps), e = 1 + q/a_h, M = n t (same form with
 *   hyperbolic anomaly H: e sinh H - H = M).
 *   Both anomalies are solved by FIXED-COUNT Newton iterations (deterministic;
 *   identical result for identical inputs; no history).
 * - WINDING emerges from differential mean motion across the family: more
 *   bound elements advance faster, so the returned stream wraps into a
 *   spiral over time. This is DIFFERENTIAL KEPLER WINDING. GR apsidal
 *   precession is deliberately NOT modeled (disclosed); the presentation
 *   consequence (apparent self-crossing) is labeled an approximation.
 * - SELF-INTERSECTION / SHOCK TRIGGER: deterministic — the most-bound
 *   element's first periapsis return, t_shock = P(a_min) = fallbackSeconds.
 *   Before that time the model presents no shock emission.
 *
 * Continuity contract: every spine sample is a pure function of elapsed time
 * since disruption; smooth in t; identical under rewind/replay.
 */

import { METRES_PER_SCENE_UNIT, type ResolvedTdeEncounter } from './types.js';

/** Squared metres-per-unit cache for SI -> scene energy conversion. */
const METRES_PER_SCENE_UNIT_SQUARED = METRES_PER_SCENE_UNIT * METRES_PER_SCENE_UNIT;

/** Newton iteration budget for Kepler anomaly solves (deterministic). */
const KEPLER_ITERATIONS = 24;

/** Convergence tolerance for the anomaly solve (radians). */
const KEPLER_TOL = 1e-10;

export function solveEllipticAnomaly(e: number, mPar: number): number {
  const ecc = Math.min(Math.max(e, 0), 0.999999);
  const twoPi = Math.PI * 2;
  let m = mPar % twoPi;
  if (m < 0) m += twoPi;
  if (m < KEPLER_TOL || m > twoPi - KEPLER_TOL) return m;

  // F(lo) <= 0 <= F(hi) by construction (F strictly increasing for e < 1).
  let lo = 0;
  let hi = twoPi;
  for (let i = 0; i < 36; i += 1) {
    const mid = 0.5 * (lo + hi);
    const f = mid - ecc * Math.sin(mid) - m;
    if (f < 0) lo = mid;
    else hi = mid;
  }
  let ev = 0.5 * (lo + hi);
  for (let i = 0; i < 6; i += 1) {
    const f = ev - ecc * Math.sin(ev) - m;
    if (Math.abs(f) < KEPLER_TOL) break;
    const fp = Math.max(1 - ecc * Math.cos(ev), 1e-6);
    const next = ev - f / fp;
    if (!(next > lo && next < hi)) break; // stay inside the proven bracket
    ev = next;
  }
  return Number.isFinite(ev) ? ev : m;
}

/**
 * Solve hyperbolic Kepler equation e sinh H - H = M (M >= 0 here; odd
 * symmetry handles M < 0). Fixed iterations; finite output guaranteed.
 */
export function solveHyperbolicAnomaly(e: number, mPar: number): number {
  const sign = mPar < 0 ? -1 : 1;
  const m = Math.abs(Number.isFinite(mPar) ? mPar : 0);
  if (m < KEPLER_TOL) return 0;
  // Good initial guess grows logarithmically for large M.
  let h = Math.log(
    1 + (2 * m) / Math.max(e, 1.001) + Math.sqrt(1 + ((2 * m) / Math.max(e, 1.001)) ** 2)
  );
  for (let i = 0; i < KEPLER_ITERATIONS; i += 1) {
    const f = e * Math.sinh(h) - h - m;
    if (Math.abs(f) < KEPLER_TOL) break;
    const fp = e * Math.cosh(h) - 1;
    h -= f / Math.max(fp, 1e-6);
    if (!Number.isFinite(h)) {
      h = Math.log(2 * m + 1.1);
      break;
    }
  }
  return sign * (Number.isFinite(h) ? h : 0);
}

/** In-plane position of a Kepler orbit at elapsed time t (scene units). */
export interface StreamSample {
  readonly x: number;
  readonly z: number;
  /** Orbital radius at this sample, scene units. */
  readonly radiusUnits: number;
}

/**
 * Propagate ONE bound debris element (specific energy eps <= 0, SI J/kg) to
 * time t. Periapsis stays on +X for every element (they inherit the
 * encounter geometry); differential phase creates the winding pattern.
 */
export function boundStreamPoint(
  encounter: ResolvedTdeEncounter,
  epsJPerKg: number,
  tSeconds: number
): StreamSample {
  const mu = encounter.muSiM3S2 / Math.pow(METRES_PER_SCENE_UNIT, 3); // units^3/s^2
  const q = encounter.rpUnits;
  // Convert SI specific energy to scene units: divide by u^2.
  const bindingMag = Math.max(-epsJPerKg, 1e-12) / METRES_PER_SCENE_UNIT_SQUARED;
  const a = mu / (2 * bindingMag);
  const e = Math.min(Math.max(1 - q / a, 0), 0.9995);
  const n = Math.sqrt(mu / (a * a * a));
  const mPar = n * Math.max(tSeconds, 0);
  const ev = solveEllipticAnomaly(e, mPar);
  const cosE = Math.cos(ev);
  const sinE = Math.sin(ev);
  const r = a * (1 - e * cosE);
  // Periapsis along +X; world-z takes the encounter's clockwise handedness
  // (matches trajectory.ts z = -r sin(nu)).
  const x = a * (cosE - e);
  const z = -a * Math.sqrt(Math.max(1 - e * e, 1e-9)) * sinE;
  return { x, z, radiusUnits: r };
}

/**
 * Propagate ONE unbound element (eps > 0, SI J/kg) to time t (hyperbolic
 * branch, same plane/periapsis/handedness conventions as the bound branch).
 */
export function unboundStreamPoint(
  encounter: ResolvedTdeEncounter,
  epsJPerKg: number,
  tSeconds: number
): StreamSample {
  const mu = encounter.muSiM3S2 / Math.pow(METRES_PER_SCENE_UNIT, 3);
  const q = encounter.rpUnits;
  const eps = Math.max(epsJPerKg, 1e-12) / METRES_PER_SCENE_UNIT_SQUARED;
  const aH = mu / (2 * eps);
  const e = 1 + q / aH;
  const n = Math.sqrt(mu / (aH * aH * aH));
  const h = solveHyperbolicAnomaly(e, n * Math.max(tSeconds, 0));
  const coshH = Math.cosh(h);
  const sinhH = Math.sinh(h);
  const r = aH * (e * coshH - 1);
  // x = a_h (e - cosh H) starts at +q and decreases; z keeps the clockwise
  // handedness so freshly stripped gas initially follows the star's -Z exit.
  const x = aH * (e - coshH);
  const z = -aH * Math.sqrt(Math.max(e * e - 1, 1e-9)) * sinhH;
  return { x, z, radiusUnits: r };
}

/**
 * Build a full stream polyline (bound or unbound branch) as pure samples in
 * the orbital plane. Presentation sampling (disclosed): member energies are
 * CLUSTERED toward the band edge (f = FMIN + (1-FMIN)(1-(1-u)^CLUSTER)) so
 * spine detail survives where the family actually wraps, and the near-
 * parabolic far tail (f < FMIN, apoapsis far beyond any frame) is cropped.
 * The caller supplies the sample count so quality tiers can change
 * resolution without changing the model.
 */
const SPINE_F_MIN = 1 / 30;
const SPINE_CLUSTER_EXPONENT = 2.5;

export function buildStreamSpine(
  encounter: ResolvedTdeEncounter,
  tSinceDisruptionSeconds: number,
  samples: number,
  boundBranch: boolean,
  out: { xs: Float64Array; zs: Float64Array; rs: Float64Array }
): number {
  const count = Math.max(2, Math.floor(samples));
  const spread = encounter.energySpreadJPerKg;
  const usable = Math.min(count, out.xs.length);
  for (let i = 0; i < usable; i += 1) {
    const u = (i + 0.5) / count;
    const f = SPINE_F_MIN + (1 - SPINE_F_MIN) * (1 - Math.pow(1 - u, SPINE_CLUSTER_EXPONENT));
    const epsMag = f * (spread / 2);
    const p = boundBranch
      ? boundStreamPoint(encounter, -epsMag, tSinceDisruptionSeconds)
      : unboundStreamPoint(encounter, epsMag, tSinceDisruptionSeconds);
    out.xs[i] = p.x;
    out.zs[i] = p.z;
    out.rs[i] = p.radiusUnits;
  }
  return usable;
}

/** Reusable scratch buffers for spine construction (no per-frame allocation). */
export function createSpineScratch(capacity: number): {
  xs: Float64Array;
  zs: Float64Array;
  rs: Float64Array;
} {
  const cap = Math.max(2, Math.floor(capacity));
  return { xs: new Float64Array(cap), zs: new Float64Array(cap), rs: new Float64Array(cap) };
}
