/**
 * Named physics validation vectors for the Schwarzschild reference solver.
 *
 * @internal Validation-only module. Pure math — no THREE imports, no DOM, no
 * renderer dependencies. Every case evaluates live against ./cpuReference and
 * is fully deterministic (the reference solver uses no randomness).
 *
 * Spec sources:
 * - docs/VALIDATION_VECTORS.md
 *     §2  unit/radius invariants (horizon 2, photon sphere 3, ISCO 6, b_c)
 *     §4  radial capture sanity
 *     §5  radial escape sanity
 *     §6  weak-field deflection series vs alpha ~= 4M/b (convergence + sign)
 *     §7  critical capture boundary and winding growth towards b_c
 *     §12 static gravitational redshift g = sqrt(f_emit/f_obs)
 * - docs/NUMERICAL_METHODS.md §1/§11/§12/§13/§16 (conventions being checked)
 *
 * Tolerance policy follows docs/VALIDATION_VECTORS.md §22: quantity-aware,
 * no universal epsilon. Scalar conventions sit at machine precision; b_c
 * carries RK4-discretization headroom; weak-field cases allow the known
 * second-order GR term (15*pi/4)(M/b)^2 rather than demanding equality with
 * the leading approximation.
 */

import {
  CRITICAL_IMPACT_PARAMETER_ANALYTIC_RG,
  HORIZON_RG,
  ISCO_RG,
  PHOTON_SPHERE_RG,
  criticalImpactParameter,
  deflectionAngleNumeric,
  deflectionAngleWeakField,
  gravitationalRedshiftStatic,
  integratePhoton,
  launchFromImpactParameter,
  type Vec3,
} from './cpuReference';

/** JSON-friendly scalar value carried by vector inputs/expected/actual. */
export type ValidationValue = number | string | boolean;

export interface ValidationEvaluation {
  actual: ValidationValue | Readonly<Record<string, ValidationValue>>;
  pass: boolean;
}

export interface ValidationVector {
  readonly id: string;
  readonly description: string;
  readonly inputs: Readonly<Record<string, ValidationValue | readonly number[]>>;
  readonly expected: ValidationValue | Readonly<Record<string, ValidationValue>>;
  /** Quantity-aware absolute tolerance (docs/VALIDATION_VECTORS.md §22). */
  readonly toleranceAbs: number;
  evaluate(): ValidationEvaluation;
}

function close(actual: number, expected: number, toleranceAbs: number): boolean {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= toleranceAbs;
}

function radiusOf(p: Vec3): number {
  return Math.hypot(p[0], p[1], p[2]);
}

/**
 * Weak-field tolerances leave room for the second-order Schwarzschild term
 * alpha = 4M/b + (15*pi/4)(M/b)^2 + O((M/b)^3): predicted excess over 4/b is
 * ~0.0295 / 0.00736 / 0.00184 / 0.00046 for b = 20 / 40 / 80 / 160.
 */
const WEAK_FIELD_CASES: ReadonlyArray<{ readonly b: number; readonly toleranceAbs: number }> = [
  { b: 20, toleranceAbs: 0.04 },
  { b: 40, toleranceAbs: 0.01 },
  { b: 80, toleranceAbs: 0.0025 },
  { b: 160, toleranceAbs: 0.00062 },
];

const conventionVectors: ValidationVector[] = [
  {
    id: 'convention-horizon-radius',
    description:
      'Schwarzschild horizon r = 2 r_g for M = 1 (docs/VALIDATION_VECTORS.md §2; docs/NUMERICAL_METHODS.md §1).',
    inputs: { massRg: 1 },
    expected: 2,
    toleranceAbs: 0,
    evaluate: () => ({ actual: HORIZON_RG, pass: close(HORIZON_RG, 2, 0) }),
  },
  {
    id: 'convention-photon-sphere',
    description:
      'Null circular orbit (photon sphere) r = 3 r_g for M = 1 (docs/VALIDATION_VECTORS.md §2; docs/NUMERICAL_METHODS.md §1).',
    inputs: { massRg: 1 },
    expected: 3,
    toleranceAbs: 0,
    evaluate: () => ({ actual: PHOTON_SPHERE_RG, pass: close(PHOTON_SPHERE_RG, 3, 0) }),
  },
  {
    id: 'convention-isco-radius',
    description:
      'Schwarzschild ISCO r = 6 r_g for M = 1; inner edge of the stable thin-disk preset (docs/VALIDATION_VECTORS.md §2; docs/NUMERICAL_METHODS.md §15).',
    inputs: { massRg: 1 },
    expected: 6,
    toleranceAbs: 0,
    evaluate: () => ({ actual: ISCO_RG, pass: close(ISCO_RG, 6, 0) }),
  },
];

const criticalBoundaryVectors: ValidationVector[] = [
  {
    id: 'critical-impact-parameter',
    description:
      'Numerically bisected capture boundary matches analytic b_c = 3*sqrt(3)*M ~= 5.196152422706632 (docs/VALIDATION_VECTORS.md §2/§7; docs/NUMERICAL_METHODS.md §11). Tolerance covers RK4 discretization of the boundary location.',
    inputs: { method: 'capture-boundary-bisection', bracketMinRg: 4.5, bracketMaxRg: 6 },
    expected: CRITICAL_IMPACT_PARAMETER_ANALYTIC_RG,
    toleranceAbs: 1e-4,
    evaluate: () => {
      const actual = criticalImpactParameter(1);
      return { actual, pass: close(actual, CRITICAL_IMPACT_PARAMETER_ANALYTIC_RG, 1e-4) };
    },
  },
  {
    id: 'capture-boundary-below-b5',
    description:
      'Ray from r0 = 2000 r_g with invariant impact parameter b = 5 (< b_c) is captured (docs/VALIDATION_VECTORS.md §7).',
    inputs: { bInvariant: 5, startRadiusRg: 2000, escapeRadiusRg: 4400 },
    expected: 'captured',
    toleranceAbs: 0,
    evaluate: () => {
      const result = launchFromImpactParameter(5, { startRadiusRg: 2000, escapeRadius: 4400 });
      return { actual: result.status, pass: result.status === 'captured' };
    },
  },
  {
    id: 'escape-boundary-above-b5p4',
    description:
      'Ray from r0 = 2000 r_g with invariant impact parameter b = 5.4 (> b_c) escapes after strong bending (docs/VALIDATION_VECTORS.md §7).',
    inputs: { bInvariant: 5.4, startRadiusRg: 2000, escapeRadiusRg: 4400 },
    expected: 'escaped',
    toleranceAbs: 0,
    evaluate: () => {
      const result = launchFromImpactParameter(5.4, { startRadiusRg: 2000, escapeRadius: 4400 });
      return { actual: result.status, pass: result.status === 'escaped' };
    },
  },
  {
    id: 'near-critical-winding-growth',
    description:
      'Total deflection grows monotonically as b decreases towards b_c from above — increasing winding/step demand near criticality (docs/VALIDATION_VECTORS.md §7).',
    inputs: { bInvariants: [5.7, 5.5, 5.35, 5.28] },
    expected: true,
    toleranceAbs: 0,
    evaluate: () => {
      const bs = [5.7, 5.5, 5.35, 5.28];
      const alphas = bs.map((b) => deflectionAngleNumeric(b));
      const actual: Record<string, ValidationValue> = {};
      bs.forEach((b, i) => {
        actual[`alpha_b_${b.toFixed(2)}`] = alphas[i];
      });
      let pass = alphas.every((a) => Number.isFinite(a) && a > 0);
      for (let i = 1; i < alphas.length && pass; i += 1) {
        pass = alphas[i] > alphas[i - 1];
      }
      return { actual, pass };
    },
  },
];

const radialVectors: ValidationVector[] = [
  {
    id: 'radial-inward-capture',
    description:
      'Purely inward radial ray from r = 100 r_g is captured at the horizon band with finite steps and no spurious turning point (docs/VALIDATION_VECTORS.md §4; docs/NUMERICAL_METHODS.md §13).',
    inputs: { position: [100, 0, 0], direction: [-1, 0, 0] },
    expected: 'captured',
    toleranceAbs: 0.001,
    evaluate: () => {
      const result = integratePhoton([100, 0, 0], [-1, 0, 0]);
      const finalRadius = radiusOf(result.finalPosition);
      const pass =
        result.status === 'captured' &&
        Number.isFinite(result.steps) &&
        finalRadius <= 2 + 0.001 &&
        finalRadius >= 2 - 0.25;
      return { actual: { status: result.status, finalRadiusRg: finalRadius }, pass };
    },
  },
  {
    id: 'radial-outward-escape',
    description:
      'Purely outward radial ray escapes and its terminal direction remains radial within 1e-9 (docs/VALIDATION_VECTORS.md §5; docs/NUMERICAL_METHODS.md §13).',
    inputs: { position: [100, 0, 0], direction: [1, 0, 0] },
    expected: 'escaped',
    toleranceAbs: 1e-9,
    evaluate: () => {
      const result = integratePhoton([100, 0, 0], [1, 0, 0], { escapeRadius: 1100 });
      const d = result.finalDirection;
      const deviation = Math.max(Math.abs(d[0] - 1), Math.abs(d[1]), Math.abs(d[2]));
      return {
        actual: { status: result.status, maxDirectionDeviation: deviation },
        pass: result.status === 'escaped' && deviation <= 1e-9,
      };
    },
  },
];

const weakFieldVectors: ValidationVector[] = [
  ...WEAK_FIELD_CASES.map(
    ({ b, toleranceAbs }): ValidationVector => ({
      id: `weak-field-deflection-b${b}`,
      description:
        `Numerical total deflection at b = ${b} r_g agrees with the leading weak-field value ` +
        `${deflectionAngleWeakField(b, 1)} rad within second-order GR headroom ` +
        '(docs/VALIDATION_VECTORS.md §6; docs/NUMERICAL_METHODS.md §12).',
      inputs: { b, massRg: 1 },
      expected: deflectionAngleWeakField(b, 1),
      toleranceAbs,
      evaluate: () => {
        const actual = deflectionAngleNumeric(b);
        return { actual, pass: close(actual, deflectionAngleWeakField(b, 1), toleranceAbs) };
      },
    }),
  ),
  {
    id: 'weak-field-convergence-monotonic',
    description:
      'Relative error of the numerical deflection versus 4M/b strictly decreases as b increases through 20/40/80/160, and the sign of the bending is correct (docs/VALIDATION_VECTORS.md §6).',
    inputs: { bSeries: [20, 40, 80, 160] },
    expected: true,
    toleranceAbs: 0,
    evaluate: () => {
      const bs = [20, 40, 80, 160];
      const relativeErrors = bs.map((b) => {
        const numeric = deflectionAngleNumeric(b);
        const leading = deflectionAngleWeakField(b, 1);
        return Math.abs(numeric - leading) / leading;
      });
      const actual: Record<string, ValidationValue> = {};
      bs.forEach((b, i) => {
        actual[`relErr_b_${b}`] = relativeErrors[i];
      });
      let pass = relativeErrors.every((e) => Number.isFinite(e) && e > 0);
      for (let i = 1; i < relativeErrors.length && pass; i += 1) {
        pass = relativeErrors[i] < relativeErrors[i - 1];
      }
      return { actual, pass };
    },
  },
  {
    id: 'weak-field-bends-toward-mass',
    description:
      'Escaped ray with b = 40 leaves bent toward the hole: terminal local direction keeps positive x and gains negative y for a ray passing above the center on +x (sign check, docs/NUMERICAL_METHODS.md §12).',
    inputs: { b: 40, startRadiusRg: 10000, escapeRadiusRg: 22000 },
    expected: 'toward-hole',
    toleranceAbs: 0,
    evaluate: () => {
      const result = launchFromImpactParameter(40, { startRadiusRg: 10000, escapeRadius: 22000 });
      const dirX = result.finalDirection[0];
      const dirY = result.finalDirection[1];
      const pass = result.status === 'escaped' && dirX > 0 && dirY < 0;
      return { actual: { status: result.status, dirX, dirY }, pass };
    },
  },
];

const redshiftVectors: ValidationVector[] = [
  {
    id: 'redshift-static-r3-to-infinity',
    description:
      'Static emitter at r = 3 r_g observed at infinity: g = sqrt(f_emit/f_obs) = sqrt(1/3) (docs/VALIDATION_VECTORS.md §12; docs/NUMERICAL_METHODS.md §16).',
    inputs: { emitRadiusRg: 3, obsRadiusRg: Number.POSITIVE_INFINITY, massRg: 1 },
    expected: 0.5773502691896258,
    toleranceAbs: 1e-15,
    evaluate: () => {
      const actual = gravitationalRedshiftStatic(3, Number.POSITIVE_INFINITY, 1);
      return { actual, pass: close(actual, 0.5773502691896258, 1e-15) };
    },
  },
  {
    id: 'redshift-static-r6-to-infinity',
    description:
      'Static emitter at the ISCO r = 6 r_g observed at infinity: g = sqrt(2/3) (docs/VALIDATION_VECTORS.md §12; docs/NUMERICAL_METHODS.md §16).',
    inputs: { emitRadiusRg: 6, obsRadiusRg: Number.POSITIVE_INFINITY, massRg: 1 },
    expected: 0.816496580927726,
    toleranceAbs: 1e-15,
    evaluate: () => {
      const actual = gravitationalRedshiftStatic(6, Number.POSITIVE_INFINITY, 1);
      return { actual, pass: close(actual, 0.816496580927726, 1e-15) };
    },
  },
  {
    id: 'redshift-static-r10-to-r100',
    description:
      'Static emitter at r = 10 r_g observed at r = 100 r_g: g = sqrt(0.8/0.98) = sqrt(40)/7 (observer radii per docs/VALIDATION_VECTORS.md §3; formula per §12).',
    inputs: { emitRadiusRg: 10, obsRadiusRg: 100, massRg: 1 },
    expected: 0.9035079029052513,
    toleranceAbs: 1e-15,
    evaluate: () => {
      const actual = gravitationalRedshiftStatic(10, 100, 1);
      return { actual, pass: close(actual, 0.9035079029052513, 1e-15) };
    },
  },
  {
    id: 'redshift-static-r100-to-infinity',
    description:
      'Static emitter at r = 100 r_g observed at infinity: g = sqrt(0.98) (docs/VALIDATION_VECTORS.md §12; docs/NUMERICAL_METHODS.md §16).',
    inputs: { emitRadiusRg: 100, obsRadiusRg: Number.POSITIVE_INFINITY, massRg: 1 },
    expected: 0.9899494936611665,
    toleranceAbs: 1e-15,
    evaluate: () => {
      const actual = gravitationalRedshiftStatic(100, Number.POSITIVE_INFINITY, 1);
      return { actual, pass: close(actual, 0.9899494936611665, 1e-15) };
    },
  },
];

/**
 * Deterministic validation corpus. Evaluation order follows
 * docs/VALIDATION_VECTORS.md: unit/radius invariants, radial sanity, critical
 * capture boundary, weak-field series, redshift factors.
 */
export const VALIDATION_VECTORS: readonly ValidationVector[] = [
  ...conventionVectors,
  ...radialVectors,
  ...criticalBoundaryVectors,
  ...weakFieldVectors,
  ...redshiftVectors,
];

export interface ValidationVectorRunResult {
  readonly id: string;
  readonly pass: boolean;
  readonly actual: ValidationValue | Readonly<Record<string, ValidationValue>>;
}

/** Evaluate every vector once; convenience wrapper for test harnesses. */
export function runValidationVectors(): ValidationVectorRunResult[] {
  return VALIDATION_VECTORS.map((vector) => {
    const evaluation = vector.evaluate();
    return { id: vector.id, pass: evaluation.pass, actual: evaluation.actual };
  });
}
