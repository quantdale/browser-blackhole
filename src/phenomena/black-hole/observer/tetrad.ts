/**
 * M10 observer layer — observer tetrad construction (OBSERVER_FRAME_ADR §4).
 *
 * Universal construction needing ONLY the four-velocity u (no static
 * fiducial), therefore valid inside the Kerr ergosphere for infalling
 * observers where static frames do not exist:
 *
 *   P(x) = x + (x.u) u            orthogonal projector onto u's rest space
 *
 * The three camera axis WORLD directions are converted into BL coordinate
 * direction vectors, projected with P, and Gram-Schmidt-orthonormalized in
 * order (right, up, forward). Because P restricts to the IDENTITY on the
 * rest subspace it is orientation-preserving there: the legs inherit the
 * camera axes' handedness exactly, and degenerate configurations (axis
 * parallel to u) are rejected rather than flipped. beta -> 0 reduces exactly
 * to the camera-aligned static tetrad of the validated paths.
 */

import type { CoordinateFourVector } from './types.js';
import { metricInner, type MetricContext } from './metric.js';

export interface CameraAxisDirections {
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
}

export type ObserverTetradLegs = readonly [
  CoordinateFourVector,
  CoordinateFourVector,
  CoordinateFourVector
];

/**
 * Convert a WORLD cartesian direction into a BL coordinate CONTRAVARIANT
 * spatial vector V such that the physical displacement is
 * dr e_r + r dtheta e_theta + r sin(theta) dphi e_phi. Pure kinematics of
 * the spherical embedding (+Y axis; phi from +X toward +Z).
 */
export function worldDirectionToCoordinateVector(
  d: readonly [number, number, number],
  ctx: MetricContext
): CoordinateFourVector {
  const st = Math.sin(ctx.theta);
  const ct = Math.cos(ctx.theta);
  const sp = Math.sin(ctx.phiWorldRad);
  const cp = Math.cos(ctx.phiWorldRad);
  const sinFloor = Math.max(st, 1e-9);
  const rFloor = Math.max(ctx.r, 1e-9);
  const drComp = d[0] * st * cp + d[1] * ct + d[2] * st * sp;
  const thComp = (d[0] * ct * cp - d[1] * st + d[2] * ct * sp) / rFloor;
  const phComp = (-d[0] * sp + d[2] * cp) / (rFloor * sinFloor);
  return { t: 0, r: drComp, th: thComp, ph: phComp };
}

/** World cartesian DIRECTION represented by a coordinate spatial vector. */
export function coordinateVectorToWorldDirection(
  v: CoordinateFourVector,
  ctx: MetricContext
): [number, number, number] {
  const st = Math.sin(ctx.theta);
  const ct = Math.cos(ctx.theta);
  const sp = Math.sin(ctx.phiWorldRad);
  const cp = Math.cos(ctx.phiWorldRad);
  return [
    v.r * st * cp + ctx.r * v.th * ct * cp - ctx.r * st * v.ph * sp,
    v.r * ct - ctx.r * v.th * st,
    v.r * st * sp + ctx.r * v.th * ct * sp + ctx.r * st * v.ph * cp
  ];
}

function projectOrthogonalToU(
  x: CoordinateFourVector,
  u: CoordinateFourVector,
  ctx: MetricContext
): CoordinateFourVector {
  const xu = metricInner(ctx, x, u);
  return {
    t: x.t + xu * u.t,
    r: x.r + xu * u.r,
    th: x.th + xu * u.th,
    ph: x.ph + xu * u.ph
  };
}

function normalizeSpacelike(
  x: CoordinateFourVector,
  ctx: MetricContext
): CoordinateFourVector | null {
  const normSq = metricInner(ctx, x, x);
  if (!(normSq > 1e-24) || !Number.isFinite(normSq)) return null;
  const norm = Math.sqrt(normSq);
  return { t: x.t / norm, r: x.r / norm, th: x.th / norm, ph: x.ph / norm };
}

function subtractScaled(
  a: CoordinateFourVector,
  b: CoordinateFourVector,
  coefficient: number
): CoordinateFourVector {
  return {
    t: a.t - coefficient * b.t,
    r: a.r - coefficient * b.r,
    th: a.th - coefficient * b.th,
    ph: a.ph - coefficient * b.ph
  };
}

/**
 * Build the three SPATIAL tetrad legs aligned to camera right/up/forward and
 * orthogonal to u. Returns null when an axis degenerates under projection
 * (camera axis parallel to u within numerical tolerance) — callers surface
 * `degenerate-camera-axis`, never silently flip.
 */
export function buildObserverTetrad(
  u: CoordinateFourVector,
  axes: CameraAxisDirections,
  ctx: MetricContext
): ObserverTetradLegs | null {
  const cRight = projectOrthogonalToU(worldDirectionToCoordinateVector(axes.right, ctx), u, ctx);
  const leg1 = normalizeSpacelike(cRight, ctx);
  if (!leg1) return null;

  const rawUp = projectOrthogonalToU(worldDirectionToCoordinateVector(axes.up, ctx), u, ctx);
  const leg2 = normalizeSpacelike(subtractScaled(rawUp, leg1, metricInner(ctx, rawUp, leg1)), ctx);
  if (!leg2) return null;

  const rawFwd = projectOrthogonalToU(worldDirectionToCoordinateVector(axes.forward, ctx), u, ctx);
  const orth3a = subtractScaled(rawFwd, leg1, metricInner(ctx, rawFwd, leg1));
  const orth3b = subtractScaled(orth3a, leg2, metricInner(ctx, orth3a, leg2));
  const leg3 = normalizeSpacelike(orth3b, ctx);
  if (!leg3) return null;

  // Orthonormality is guaranteed by construction up to roundoff; verify the
  // worst pairwise inner product so a future refactor cannot degrade it
  // silently (fail-closed, OBSERVER_FRAME_ADR section 4).
  const worst =
    Math.abs(metricInner(ctx, leg1, leg2)) +
    Math.abs(metricInner(ctx, leg1, leg3)) +
    Math.abs(metricInner(ctx, leg2, leg3));
  if (!(worst < 1e-9)) return null;

  return [leg1, leg2, leg3] as const;
}
