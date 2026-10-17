/**
 * Schwarzschild core unit file: the retired reference-ray name lock plus a
 * coverage floor over the module's remaining public helpers.
 *
 * Dependency lock (reference-ray-oracle-honesty D2): traceReferenceRay was
 * removed because it left disk-hit classification unset and could be read as
 * a reference disk-hit oracle while omitting the event the production passes
 * classify. Disk-hit classification stays on the production integrators'
 * own paths (schwarzschildIntegrator.ts segment refinement, kerrIntegrator.ts,
 * cpuReference.integratePhoton as the status oracle). No parity or production
 * module may import the retired wrapper name again.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  RAY_ACTIVE,
  RAY_CAPTURED,
  RAY_DISK_HIT,
  RAY_ESCAPED,
  RAY_INVALID_INITIAL_STATE,
  RAY_MAX_STEPS,
  RAY_NON_FINITE,
  classificationName,
  classifyRadiusEvent,
  isNumericalFailure,
  staticTetradMap,
  rayInitialStateFromWorld
} from '../../src/physics/schwarzschild.js';

const RETIRED_NAME = 'traceReferenceRay';
const THIS_FILE = 'tests/unit/schwarzschildCore.test.ts';

/** Recursively collect *.ts files under a directory (deterministic order). */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkTs(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('retired reference-ray oracle lock (reference-ray-oracle-honesty)', () => {
  it('no parity or production module imports the retired traceReferenceRay wrapper', () => {
    const offenders: string[] = [];
    for (const root of ['src', 'tests']) {
      for (const full of walkTs(join(process.cwd(), root))) {
        const rel = full.slice(process.cwd().length + 1).replace(/\\/g, '/');
        if (rel === THIS_FILE) continue; // this file names the lock, not a caller
        if (new RegExp(`\\b${RETIRED_NAME}\\b`).test(readFileSync(full, 'utf8'))) {
          offenders.push(rel);
        }
      }
    }
    expect(
      offenders,
      'traceReferenceRay was retired (reference-ray-oracle-honesty D1): disk-hit ' +
        'classification must ride the production integrators (schwarzschild' +
        `Integrator/kerrIntegrator refinement) — re-introducing ${RETIRED_NAME} as a ` +
        `disk-hit source is forbidden; offenders: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});

/**
 * Bare-bones validation of the classification code contract the production
 * integrators import: integer codes 0..6 must stay stable (docs/
 * SHADER_CONTRACTS.md section 6 — codes must not be renumbered).
 */
describe('stable classification codes', () => {
  it('keeps the documented numeric code values', () => {
    expect(RAY_ACTIVE).toBe(0);
    expect(RAY_CAPTURED).toBe(1);
    expect(RAY_ESCAPED).toBe(2);
    expect(RAY_DISK_HIT).toBe(3);
    expect(RAY_MAX_STEPS).toBe(4);
    expect(RAY_NON_FINITE).toBe(5);
    expect(RAY_INVALID_INITIAL_STATE).toBe(6);
  });

  it('flags numerical codes and passes presentational codes', () => {
    expect(isNumericalFailure(RAY_MAX_STEPS)).toBe(true);
    expect(isNumericalFailure(RAY_NON_FINITE)).toBe(true);
    expect(isNumericalFailure(RAY_INVALID_INITIAL_STATE)).toBe(true);
    expect(isNumericalFailure(RAY_ACTIVE)).toBe(false);
    expect(isNumericalFailure(RAY_CAPTURED)).toBe(false);
    expect(isNumericalFailure(RAY_ESCAPED)).toBe(false);
    expect(isNumericalFailure(RAY_DISK_HIT)).toBe(false);
  });

  it('names every code without renumbering accidents', () => {
    expect(classificationName(RAY_ACTIVE)).toBe('ACTIVE');
    expect(classificationName(RAY_CAPTURED)).toBe('CAPTURED');
    expect(classificationName(RAY_ESCAPED)).toBe('ESCAPED');
    expect(classificationName(RAY_MAX_STEPS)).toBe('MAX_STEPS');
    expect(classificationName(RAY_NON_FINITE)).toBe('NON_FINITE');
    expect(classificationName(RAY_INVALID_INITIAL_STATE)).toBe('INVALID_INITIAL_STATE');
    expect(classificationName(RAY_DISK_HIT)).toBe('DISK_HIT');
  });
});

describe('radius-event classification (NM §10 priority contract)', () => {
  const opts = { captureEpsilon: 0.1, escapeRadiusRg: 100 };

  it('captures before escape and requires outward-throughout momentum for escape', () => {
    expect(classifyRadiusEvent(2.05, 1, 1, opts)).toBe(RAY_CAPTURED); // <= 2 + eps
    expect(classifyRadiusEvent(150, 1, 1, opts)).toBe(RAY_ESCAPED); // r > escape && outward
    expect(classifyRadiusEvent(150, -1, 1, opts)).toBe(RAY_ACTIVE); // turned, not outward-throughout
    expect(classifyRadiusEvent(3, 1, 1, opts)).toBe(RAY_ACTIVE); // far below escape radius
    expect(classifyRadiusEvent(NaN, 1, 1, opts)).toBe(RAY_NON_FINITE);
  });
});

describe('remaining public helpers coverage floor', () => {
  it('staticTetradMap: maps a unit direction and NaN-fills invalid input', () => {
    // f(r) = 1 - 2/r (horizon r = 2 in M=1 r_g-native units): f(10) = 0.8.
    const mid = staticTetradMap(10, -1, 0, 0, 1, Math.PI / 2);
    expect(mid.energyE).toBeCloseTo(Math.sqrt(0.8), 12);
    expect(mid.kt).toBeGreaterThan(1);
    expect(mid.initialPr).toBeCloseTo(-1 / Math.sqrt(0.8), 12);
    const bad = staticTetradMap(1, 0.6, 0.6, 0.6); // inside the horizon: f <= 0
    expect(bad.kt).toBeNaN();
  });

  it('rayInitialStateFromWorld: reduces a world ray and flags outside-horizon origins', () => {
    const ok = rayInitialStateFromWorld([10, 0, 0], [-1, 0.2, 0]);
    expect(ok.position).toEqual([10, 0]);
    expect(ok.invalid).toBe(false);
    expect(ok.nearRadial).toBe(false);
    const basisOrthogonal = ok.e0[0] * ok.e1[0] + ok.e0[1] * ok.e1[1] + ok.e0[2] * ok.e1[2];
    expect(Math.abs(basisOrthogonal)).toBeLessThan(1e-12);
    const inside = rayInitialStateFromWorld([1, 0, 0], [-1, 0, 0]);
    expect(inside.invalid).toBe(true);
    expect(inside.invalidReason).toContain('horizon');
    expect(inside.impactParameterConserved).toBeNaN();
  });
});
