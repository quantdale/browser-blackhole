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

/** Physical observer mode ids (OBSERVER_FRAME_ADR §2; `camera` = legacy semantics). */
export type ObserverControlMode = 'camera' | 'static' | 'circular' | 'flyby' | 'freefall';

/**
 * M10 physical-observer control sub-record. Owned/normalized HERE so presets,
 * share links and live calls flow through the ONE normalizer
 * (docs/OBSERVER_FRAME_ADR.md §8).
 */
export interface ObserverControlState {
  mode: ObserverControlMode;
  /** Circular orbit radius (r_g); clamped above the sense's photon orbit. */
  circularRadiusRg: number;
  /** +1 orbits toward +phi (prograde relative to POSITIVE spin). */
  circularSense: 1 | -1;
  /** Flyby asymptotic speed |beta| < 1 (sets conserved E = gamma). */
  flybyBetaInfinity: number;
  /** Flyby impact parameter b (r_g); sign selects the orbital sense. */
  flybyImpactParameterRg: number;
  /** Freefall release radius (r_g), dropped from rest relative to statics. */
  freefallReleaseRadiusRg: number;
  /** Proper-time rate multiplier (deterministic; paused freezes evolution). */
  timeScale: number;
}

export const DEFAULT_OBSERVER_CONTROLS: Readonly<ObserverControlState> = {
  mode: 'camera',
  circularRadiusRg: 9,
  circularSense: 1,
  flybyBetaInfinity: 0.5,
  flybyImpactParameterRg: 7,
  freefallReleaseRadiusRg: 14,
  timeScale: 1
};

/** Documented validation ranges (clamped, never rejected for finite input). */
export const OBSERVER_RANGES = {
  circularRadiusRg: { min: 1.05, max: 60 },
  flybyBetaInfinity: { min: 0.05, max: 0.95 },
  flybyImpactParameterRg: { min: -40, max: 40 },
  freefallReleaseRadiusRg: { min: 1.05, max: 60 },
  timeScale: { min: -5, max: 5 }
} as const;

/** Public, serializable control record for the black-hole destination. */
export interface BlackHoleControlState {
  metric: 'schwarzschild' | 'kerr';
  /** SIGNED dimensionless spin a* clamped to [-0.998, +0.998]. */
  spin: number;
  /** Cinematic slow-orbit presentation flag (display domain, not physics). */
  orbit: boolean;
  /** Debug parity encoding view (debug tooling only). */
  debugParity: boolean;
  /** M10 physical observer configuration. */
  observer: ObserverControlState;
}

/** Canonical defaults; identical to the historical preset behavior. */
export const DEFAULT_BLACK_HOLE_CONTROLS: Readonly<BlackHoleControlState> = {
  metric: 'schwarzschild',
  spin: 0,
  orbit: false,
  debugParity: false,
  observer: DEFAULT_OBSERVER_CONTROLS
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

function clampNumber(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/**
 * The ONE observer sub-record normalizer. Never throws; invalid fields fall
 * back to documented defaults (mode 'camera' = pre-M10 semantics), so hostile
 * share-state payloads cannot change the physical meaning of old links.
 */
export function normalizeObserverControls(raw: unknown): ObserverControlState {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_OBSERVER_CONTROLS;
  const modeRaw = source['mode'];
  const mode: ObserverControlMode =
    modeRaw === 'static' || modeRaw === 'circular' || modeRaw === 'flyby' || modeRaw === 'freefall'
      ? modeRaw
      : 'camera';
  const senseRaw = source['circularSense'];
  return {
    mode,
    circularRadiusRg: clampNumber(
      source['circularRadiusRg'],
      d.circularRadiusRg,
      OBSERVER_RANGES.circularRadiusRg.min,
      OBSERVER_RANGES.circularRadiusRg.max
    ),
    circularSense: senseRaw === -1 ? -1 : 1,
    flybyBetaInfinity: clampNumber(
      source['flybyBetaInfinity'],
      d.flybyBetaInfinity,
      OBSERVER_RANGES.flybyBetaInfinity.min,
      OBSERVER_RANGES.flybyBetaInfinity.max
    ),
    flybyImpactParameterRg: clampNumber(
      source['flybyImpactParameterRg'],
      d.flybyImpactParameterRg,
      OBSERVER_RANGES.flybyImpactParameterRg.min,
      OBSERVER_RANGES.flybyImpactParameterRg.max
    ),
    freefallReleaseRadiusRg: clampNumber(
      source['freefallReleaseRadiusRg'],
      d.freefallReleaseRadiusRg,
      OBSERVER_RANGES.freefallReleaseRadiusRg.min,
      OBSERVER_RANGES.freefallReleaseRadiusRg.max
    ),
    timeScale: clampNumber(
      source['timeScale'],
      d.timeScale,
      OBSERVER_RANGES.timeScale.min,
      OBSERVER_RANGES.timeScale.max
    )
  };
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
    debugParity: pickBool(source['debugParity'], DEFAULT_BLACK_HOLE_CONTROLS.debugParity),
    observer: normalizeObserverControls(source['observer'])
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
