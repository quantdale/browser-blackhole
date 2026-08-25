/**
 * M10 observer layer — Boyer-Lindquist metric algebra (binary64).
 *
 * Signature (-,+,+,+), G=c=1, M=1, signed a* on +Y — identical to
 * docs/KERR_BACKEND_ADR.md §1.1-§1.4. Schwarzschild is the a* = 0 case of
 * every function here (exact, not approximated).
 *
 * Centralization rule (campaign §2): GR formulas live HERE and in the
 * worldline/tetrad modules — never in UI components or destination glue.
 */

import { kerrFragments } from '../kerr/characteristics.js';
import type { CoordinateFourVector } from './types.js';

export interface MetricContext {
  readonly metric: 'schwarzschild' | 'kerr';
  readonly effectiveSpin: number;
  /** BL radius in r_g. */
  readonly r: number;
  /** Polar angle from +Y in radians. */
  readonly theta: number;
  /** World azimuth (phi from +X toward +Z); used only by kinematic helpers. */
  readonly phiWorldRad: number;
}

/** Raw metric fragments at the event (Sigma, Delta, A, sin/cos). */
export function metricFragments(ctx: MetricContext): {
  sigma: number;
  delta: number;
  bigA: number;
  sinTheta: number;
  cosTheta: number;
  sin2: number;
} {
  const fr = kerrFragments(ctx.r, ctx.theta, ctx.effectiveSpin);
  const r2 = ctx.r * ctx.r;
  const a2 = fr.aSq;
  const bigA = (r2 + a2) * (r2 + a2) - a2 * fr.delta * fr.sin2;
  return {
    sigma: fr.sigma,
    delta: fr.delta,
    bigA,
    sinTheta: fr.sinTheta,
    cosTheta: fr.cosTheta,
    sin2: fr.sin2
  };
}

/**
 * Covariant inner product g(a,b) = g_mn a^m b^n for two CONTRAVARIANT
 * coordinate four-vectors at the event.
 */
export function metricInner(
  ctx: MetricContext,
  a: CoordinateFourVector,
  b: CoordinateFourVector
): number {
  const { sigma, delta, bigA, sin2 } = metricFragments(ctx);
  const twoR = 2 * ctx.r;
  const gTT = -(1 - twoR / sigma);
  const gTPh = (-twoR * ctx.effectiveSpin * sin2) / sigma;
  const gRR = sigma / delta;
  const gThTh = sigma;
  const gPhPh = (bigA * sin2) / sigma;
  return (
    gTT * a.t * b.t +
    gTPh * (a.t * b.ph + a.ph * b.t) +
    gRR * a.r * b.r +
    gThTh * a.th * b.th +
    gPhPh * a.ph * b.ph
  );
}

/** Static-observer lapse-like factor f_s = -g_tt = (Sigma - 2Mr)/Sigma (>0 outside ergosphere). */
export function staticLapse(ctx: MetricContext): number {
  const { sigma } = metricFragments(ctx);
  return (sigma - 2 * ctx.r) / sigma;
}

/** Static four-velocity u^mu = (1/sqrt(f_s), 0, 0, 0); null iff f_s <= 0. */
export function staticFourVelocity(ctx: MetricContext): CoordinateFourVector | null {
  const fS = staticLapse(ctx);
  if (!(fS > 0)) return null;
  return { t: 1 / Math.sqrt(fS), r: 0, th: 0, ph: 0 };
}

/**
 * Frame-dragging rate omega = -g_tphi/g_phiphi (> 0 for a* > 0). Zero on
 * the symmetry axis where g_phiphi vanishes (limit taken analytically).
 */
export function frameDraggingOmega(ctx: MetricContext): number {
  const { sigma, bigA, sin2 } = metricFragments(ctx);
  if (!(sin2 > 0)) return 0;
  const gTPh = (-2 * ctx.r * ctx.effectiveSpin * sin2) / sigma;
  const gPhPh = (bigA * sin2) / sigma;
  return -gTPh / gPhPh;
}

/**
 * ZAMO (locally nonrotating frame) four-velocity:
 * u = alpha^-1 (d/dt + omega d/dphi) with lapse alpha^2 = Delta Sigma / A.
 * Exists everywhere outside the outer horizon.
 */
export function zamoFourVelocity(ctx: MetricContext): CoordinateFourVector | null {
  const { delta, sigma, bigA } = metricFragments(ctx);
  const alphaSq = (delta * sigma) / bigA;
  if (!(alphaSq > 0)) return null;
  const omega = frameDraggingOmega(ctx);
  const ut = 1 / Math.sqrt(alphaSq);
  return { t: ut, r: 0, th: 0, ph: omega * ut };
}

/**
 * Static-observer SPATIAL orthonormal triad (contravariant legs),
 * KERR_BACKEND_ADR section 1.8 including the orthogonalized phi-leg.
 * Returns null inside the ergosphere (f_s <= 0) or on the symmetry axis.
 */
export function staticOrthonormalTriad(
  ctx: MetricContext
): readonly [CoordinateFourVector, CoordinateFourVector, CoordinateFourVector] | null {
  const fr = metricFragments(ctx);
  const fS = (fr.sigma - 2 * ctx.r) / fr.sigma;
  if (!(fS > 0)) return null;
  if (!(fr.sinTheta > 1e-9)) return null;
  const eR: CoordinateFourVector = {
    t: 0,
    r: Math.sqrt(fr.delta / fr.sigma),
    th: 0,
    ph: 0
  };
  const eTh: CoordinateFourVector = { t: 0, r: 0, th: 1 / Math.sqrt(fr.sigma), ph: 0 };
  // Orthogonalized azimuthal leg (g_tphi != 0 in Kerr):
  //   e_ph = sqrt(f_s/Delta)/sin(th) * [ d/dphi - (g_tphi/g_tt) d/dt ]
  const gTT = -(1 - (2 * ctx.r) / fr.sigma);
  const gTPh = (-2 * ctx.r * ctx.effectiveSpin * fr.sin2) / fr.sigma;
  const k = Math.sqrt(fS / fr.delta) / fr.sinTheta;
  const ePh: CoordinateFourVector = { t: -k * (gTPh / gTT), r: 0, th: 0, ph: k };
  return [eR, eTh, ePh] as const;
}
