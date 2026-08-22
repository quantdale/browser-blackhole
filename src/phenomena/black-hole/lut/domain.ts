/**
 * LUT domain mapping math — the EXACT functions both the offline generator
 * and the runtime sampler use to translate between physical table
 * coordinates and texture coordinates (M8-02/M8-04).
 *
 * Spec sources:
 * - docs/LUT_BACKEND_ADR.md §3 (x = b/b_c parameterization), §6 (critical-
 *   region nonlinear sampling), §7 (uniform-psi rows and equally spaced disk
 *   crossing candidates)
 * - docs/LUT_BACKEND_SPEC.md §6/§7 (domain chosen from measured behavior;
 *   critical region must not be undersampled)
 *
 * DRIFT POLICY: these functions are pure, dependency-free, and unit-tested.
 * The ACTIVE mapping parameters always come from a validated manifest
 * (`LutAxisMapping`), never from hard-coded literals at the call site; the
 * DEFAULTS below exist only for the generator CLI and tests. Changing the
 * defaults requires regenerating every family and bumping nothing else —
 * manifests carry their own copy of the knots.
 */

import type { LutAxisMapping } from './types.js';

// ---------------------------------------------------------------------------
// Physics scalars (geometric units M = 1)
// ---------------------------------------------------------------------------

/** Critical impact parameter b_c = 3*sqrt(3)*M in r_g (NUMERICAL_METHODS §11). */
export const B_CRITICAL_RG = 3 * Math.sqrt(3);

/**
 * Generator default: reference sphere where rows begin/end (ADR §4). */
export const DEFAULT_R_REF_RG = 64;

/** Generator default: escape radius used by the validation corpus (r_g). */
export const DEFAULT_ESCAPE_RADIUS_RG = 32;

/**
 * MEASURED normalized-axis knots (M8-04, tools/generate-luts/study.ts):
 * among {default [.85,1.15], tight [.95,1.05], wide [.70,1.30]} at widths
 * 512..1536, the WIDE critical band won BOTH statistics at w=1024
 * (radiusErrMax 3.05e-2 r_g, rms 1.18e-2, angular <=5.4e-5 rad, 2 MiB).
 * The tight mapping was consistently WORST: concentrating columns inside
 * [0.95,1.05] starves [0.85,0.95) where strong-lensing disk hits live.
 * Height sweep showed psi resolution is not the bottleneck (h=2048 within
 * noise of h=1024). Do not retune without re-running lut:study.
 */
export const DEFAULT_AXIS_X: LutAxisMapping = {
  uBreakpoints: [0, 1 / 3, 2 / 3, 1],
  xKnots: [0, 0.7, 1.3, 3]
};

// ---------------------------------------------------------------------------
// Piecewise-linear axis mapping (exact inverses)
// ---------------------------------------------------------------------------

function assertMapping(a: LutAxisMapping): void {
  const [u0, u1, u2, u3] = a.uBreakpoints;
  const [x0, x1, x2, x3] = a.xKnots;
  if (!(u0 === 0 && u1 > u0 && u2 > u1 && u3 === 1)) {
    throw new RangeError(`uBreakpoints must be [0, a, b, 1] increasing, got ${a.uBreakpoints}`);
  }
  if (!(x0 === 0 && x1 > x0 && x2 > x1 && x3 > x2)) {
    throw new RangeError(`xKnots must be [0, ...] strictly increasing, got ${a.xKnots}`);
  }
}

/** Physical x = b/b_c -> texture coordinate u in [0, 1] (piecewise linear). */
export function xToU(x: number, m: LutAxisMapping): number {
  assertMapping(m);
  if (!Number.isFinite(x) || x < 0) return 0;
  const [u0, u1, u2, u3] = m.uBreakpoints;
  const [x0, x1, x2, x3] = m.xKnots;
  if (x <= x1) return x1 === x0 ? u0 : u0 + ((x - x0) / (x1 - x0)) * (u1 - u0);
  if (x <= x2) return u1 + ((x - x1) / (x2 - x1)) * (u2 - u1);
  if (x >= x3) return u3;
  return u2 + ((x - x2) / (x3 - x2)) * (u3 - u2);
}

/** Texture coordinate u in [0, 1] -> physical x = b/b_c (piecewise linear). */
export function uToX(u: number, m: LutAxisMapping): number {
  assertMapping(m);
  if (!Number.isFinite(u)) return NaN;
  const c = Math.min(1, Math.max(0, u));
  const [u0, u1, u2, u3] = m.uBreakpoints;
  const [x0, x1, x2, x3] = m.xKnots;
  if (c <= u1) return x0 + ((c - u0) / (u1 - u0)) * (x1 - x0);
  if (c <= u2) return x1 + ((c - u1) / (u2 - u1)) * (x2 - x1);
  return x2 + ((c - u2) / (u3 - u2)) * (x3 - x2);
}

// ---------------------------------------------------------------------------
// Row (psi) helpers
// ---------------------------------------------------------------------------

/** Uniform psi row grid -> texel-center texture v coordinate in (0, 1). */
export function psiToV(psi: number, psiMax: number, height: number): number {
  // Texel centers: v = (i + 0.5)/H with i = floor(psi / psiMax * H).
  if (!Number.isFinite(psi) || !Number.isFinite(psiMax) || psiMax <= 0 || height <= 0) {
    return NaN;
  }
  const clamped = Math.min(Math.max(psi, 0), psiMax);
  const i = Math.min(height - 1, Math.floor((clamped / psiMax) * height));
  return (i + 0.5) / height;
}

/** Texel-center v coordinate -> the psi value that texel represents. */
export function vToPsi(v: number, psiMax: number, height: number): number {
  if (!Number.isFinite(v) || !Number.isFinite(psiMax) || psiMax <= 0 || height <= 0) {
    return NaN;
  }
  const c = Math.min(1, Math.max(0, v));
  const i = Math.min(height - 1, Math.floor(c * height));
  return ((i + 0.5) / height) * psiMax;
}
