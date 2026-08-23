/**
 * M8-09 — canonical trajectory-backend preference resolution.
 *
 * Spec sources:
 * - docs/LUT_BACKEND_SPEC.md §15 (runtime policy: auto/numerical/lut with
 *   visible fallback; "never silently switch to a different physical model");
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §6 (every public value passes one
 *   normalizer) and §7 (invalidation semantics);
 * - docs/cosmic-atlas/WORK_PACKETS.md M8-09 ("Use LUT only when validated
 *   assets/capabilities are available; numerical remains selectable").
 *
 * Precedence (documented contract):
 * 1. explicit dev/test URL override (`?trajectory=lut|numerical|auto`) when
 *    intentionally retained by the caller — wins over everything;
 * 2. otherwise the canonical user preference
 *    (`CosmicAtlasStateV1.rendering.trajectoryBackend`);
 * 3. `auto` resolves through the measured auto-policy gate
 *    ({@link LUT_AUTO_DEFAULT}) AND asset/capability readiness;
 * 4. any unavailable requested LUT path falls back to numerical with an
 *    explicit reason surfaced through diagnostics — never silently.
 *
 * This module is pure and dependency-free so the decision is unit-testable
 * without a renderer.
 */

export type TrajectoryBackendPreference = 'auto' | 'numerical' | 'lut';
export type TrajectoryBackend = 'numerical' | 'lut';

/** Canonical vocabulary for `rendering.trajectoryBackend` state + UI mapping. */
export const TRAJECTORY_BACKEND_VALUES: readonly TrajectoryBackendPreference[] = [
  'auto',
  'numerical',
  'lut'
];

/**
 * Auto-policy gate (M8-08/M8-09): what `auto` resolves to when a validated
 * LUT family is loaded and usable on the active backend. Stays `false` unless
 * the paired numerical-vs-LUT benchmark campaign demonstrates a meaningful,
 * reproducible performance win within documented quality limits
 * (docs/BENCHMARK_MATRIX.md §10, docs/LUT_BACKEND_ADR.md §11).
 */
export const LUT_AUTO_DEFAULT: boolean = false;

/** Everything the resolver needs to make the backend decision. */
export interface TrajectoryBackendRequest {
  /** Canonical preference from atlas rendering state. */
  preference: TrajectoryBackendPreference;
  /**
   * Dev/test URL override (`?trajectory=`), already normalized; `null` when
   * absent or invalid (invalid values never poison canonical state).
   */
  urlOverride: TrajectoryBackendPreference | null;
  /** A validated LUT family is loaded AND usable on this backend/format. */
  lutAssetsReady: boolean;
  /** Why the assets are unusable; surfaced when `lut` is requested but not ready. */
  lutUnavailableReason: string | null;
  /** Auto-policy gate value (production passes {@link LUT_AUTO_DEFAULT}). */
  autoDefaultLut: boolean;
}

/** The outcome consumed by the destination pass selector + debug snapshot. */
export interface TrajectoryBackendResolution {
  /** Preference after precedence step 1 (override beats canonical). */
  requested: TrajectoryBackendPreference;
  /** Backend that will actually execute this frame. */
  effective: TrajectoryBackend;
  /** Non-null iff a requested path could not run (truthful fallback). */
  fallbackReason: string | null;
}

/**
 * Total, allocation-light resolution of the trajectory backend decision.
 * Never throws; every input combination yields a valid backend plus an
 * honest fallback reason when the request could not be honored.
 */
export function resolveTrajectoryBackend(
  request: TrajectoryBackendRequest
): TrajectoryBackendResolution {
  const overrideWins = request.urlOverride !== null;
  const requested: TrajectoryBackendPreference = overrideWins
    ? (request.urlOverride as TrajectoryBackendPreference)
    : request.preference;

  if (requested === 'lut') {
    if (request.lutAssetsReady) {
      return { requested, effective: 'lut', fallbackReason: null };
    }
    return {
      requested,
      effective: 'numerical',
      fallbackReason: request.lutUnavailableReason ?? 'lut-unavailable'
    };
  }

  if (requested === 'numerical') {
    // Numerical is always executable; expose when it overrides a lut request.
    const fallbackReason =
      overrideWins && request.preference === 'lut' ? 'numerical-forced-by-url-override' : null;
    return { requested, effective: 'numerical', fallbackReason };
  }

  // auto: measured policy gate AND readiness must BOTH hold for LUT.
  if (request.autoDefaultLut && request.lutAssetsReady) {
    return { requested, effective: 'lut', fallbackReason: null };
  }
  return { requested, effective: 'numerical', fallbackReason: null };
}

/** Parse a raw `?trajectory=` query value; invalid/absent -> null. */
export function parseTrajectoryUrlOverride(
  raw: string | null | undefined
): TrajectoryBackendPreference | null {
  if (raw === 'auto' || raw === 'numerical' || raw === 'lut') return raw;
  return null;
}
