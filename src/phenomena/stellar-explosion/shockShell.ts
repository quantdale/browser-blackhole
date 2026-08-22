/**
 * Stellar Explosion analytic shock-shell profile (CA4-04).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 3 ("expanding
 *   shock shell", shell(r, R(t), width) factor of the density model);
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md PROCEDURAL_SCIENTIFIC.
 *
 * The shell is a smooth, compactly supported radial window around the
 * characteristic radius R(t) produced by physics.shockRadiusUnits. It is a
 * MORPHOLOGY envelope, not a solved hydrodynamic shock front: no Rankine-
 * Hugoniot conditions are claimed or enforced.
 *
 * Purity contract: pure functions only; no wall clock, no randomness.
 */

import { shockRadiusUnits } from './physics.js';
import type { ResolvedScenario } from './types.js';

/**
 * Shell thickness as a FRACTION of the current radius (self-similar
 * broadening). Clamped so early times keep a finite absolute width instead
 * of collapsing to zero at R = 0.
 */
export const SHELL_WIDTH_FRACTION = 0.16;

/** Minimum absolute shell width, scene units (avoids degenerate t~0 shells). */
export const MIN_SHELL_WIDTH_UNITS = 0.05;

/** Support multiplier: profile is exactly zero beyond R + SUPPORT*w. */
export const SHELL_SUPPORT = 2.5;

/**
 * Shell width (scene units) at age `t` seconds: a fixed fraction of the
 * current characteristic radius, floored at {@link MIN_SHELL_WIDTH_UNITS}.
 * Monotone by construction because R(t) is monotone.
 */
export function shellWidthUnits(tSeconds: number, resolved: ResolvedScenario): number {
  const r = shockRadiusUnits(tSeconds, resolved);
  const w = r * SHELL_WIDTH_FRACTION;
  return Number.isFinite(w) ? Math.max(w, MIN_SHELL_WIDTH_UNITS) : MIN_SHELL_WIDTH_UNITS;
}

/**
 * Radial shell profile in [0, 1] at distance `r` from the explosion centre,
 * centred on radius `R` with width `w`.
 *
 * Shape: Gaussian core exp(-((r-R)/w)^2) multiplied by a smooth compact-
 * support cutoff at |r - R| > SUPPORT * w. The cutoff bounds the volume the
 * volume renderer must march (mission section 24: bounded volume) while the
 * Gaussian gives a soft, visually coherent shell without discontinuities.
 *
 * Guaranteed: 0 <= profile <= 1 for all finite inputs; exactly 0 outside the
 * support; symmetric in shape around R.
 */
export function shellProfile(r: number, bigR: number, w: number): number {
  if (!Number.isFinite(r) || !Number.isFinite(bigR) || !Number.isFinite(w) || w <= 0 || bigR < 0) {
    return 0;
  }
  const d = Math.abs(r - bigR);
  if (d >= SHELL_SUPPORT * w) return 0;
  const gaussian = Math.exp(-(d / w) * (d / w));
  // Smoothstep window: 1 well inside the support, 0 exactly at the edge.
  const edge = d / (SHELL_SUPPORT * w);
  const window = 1 - edge * edge * (3 - 2 * edge);
  const value = gaussian * window;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
