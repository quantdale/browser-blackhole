/**
 * Black-hole destination control state — the ONE normalization authority for
 * every public control value of the black-hole destination (CA5/CA6
 * generalized persistence contract: presets, share links (`dc=`), and live
 * `setDestinationControl` calls all flow through this normalizer; renderer
 * modules never consume raw preset records and no UI writes uniforms
 * directly).
 *
 * Spec sources:
 * - docs/KERR_BACKEND_ADR.md §1.3/§1.5/§1.21 — signed spin convention,
 *   supported domain |a*| <= 0.998, metric/backend routing truth.
 * - src/app/state.ts STATE_RANGES.absSpin — canonical spin clamp (0.998).
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §6 (one normalizer per module;
 *   clamp-don't-reject for finite values).
 * - docs/cosmic-atlas/DECISIONS.md CA-ADR-013 — this module owns NO physics:
 *   it only validates/coerces the public record.
 *
 * Scope notes (M9):
 * - `metric` selects 'schwarzschild' | 'kerr'. Kerr always runs the numerical
 *   Kerr backend; the Schwarzschild LUT remains a Schwarzschild optimization
 *   and is truthfully inapplicable when metric = 'kerr' (ADR §1.21).
 * - `spin` is the SIGNED dimensionless a*; positive = angular momentum along
 *   +Y. Spin NEVER affects Schwarzschild output (the destination forces the
 *   effective spin to 0 for Schwarzschild rendering).
 * - The canonical state's spinAxis stays +Y-only in M9 (ADR §1.4 scope);
 *   tilted axes are an explicitly unsupported/degraded configuration.
 */

/** Public, serializable control record for the black-hole destination. */
export interface BlackHoleControlState {
  metric: 'schwarzschild' | 'kerr';
  /** SIGNED dimensionless spin a* clamped to [-0.998, +0.998]. */
  spin: number;
  /** Cinematic slow-orbit presentation flag (display domain, not physics). */
  orbit: boolean;
  /** Debug parity encoding view (debug tooling only). */
  debugParity: boolean;
}

/** Canonical defaults; identical to the historical preset behavior. */
export const DEFAULT_BLACK_HOLE_CONTROLS: Readonly<BlackHoleControlState> = {
  metric: 'schwarzschild',
  spin: 0,
  orbit: false,
  debugParity: false
};

/** Absolute clamp shared with canonical app state (docs/STATE_SCHEMA.md). */
export const BLACK_HOLE_SPIN_LIMIT = 0.998;

function clampSpin(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_BLACK_HOLE_CONTROLS.spin;
  }
  return Math.min(BLACK_HOLE_SPIN_LIMIT, Math.max(-BLACK_HOLE_SPIN_LIMIT, raw));
}

function pickBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  return fallback;
}

/**
 * The ONE normalizer. Never throws; invalid fields fall back to documented
 * defaults so hostile share-state payloads cannot break the destination.
 */
export function normalizeBlackHoleControls(raw: unknown): BlackHoleControlState {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const metricRaw = source['metric'];
  const metric =
    metricRaw === 'kerr' || metricRaw === 'schwarzschild'
      ? metricRaw
      : DEFAULT_BLACK_HOLE_CONTROLS.metric;
  return {
    metric,
    spin: clampSpin(source['spin']),
    orbit: pickBool(source['orbit'], DEFAULT_BLACK_HOLE_CONTROLS.orbit),
    debugParity: pickBool(source['debugParity'], DEFAULT_BLACK_HOLE_CONTROLS.debugParity)
  };
}

/**
 * Effective rendering spin: Schwarzschild output must never depend on the
 * stored spin value (docs/KERR_BACKEND_ADR.md §1.21 routing truth).
 */
export function effectiveSpin(controls: BlackHoleControlsLike): number {
  return controls.metric === 'kerr' ? controls.spin : 0;
}

/** Structural subset used by helpers (keeps imports light in UI code). */
export interface BlackHoleControlsLike {
  metric: 'schwarzschild' | 'kerr';
  spin: number;
}
