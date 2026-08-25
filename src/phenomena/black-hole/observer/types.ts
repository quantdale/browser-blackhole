/**
 * M10 observer layer — shared types (docs/OBSERVER_FRAME_ADR.md §1/§8).
 *
 * The observer abstraction separates, explicitly:
 * - view/camera orientation (NOT owned here — presentation only);
 * - the physical spacetime position (owned by the mode worldline);
 * - the timelike four-velocity u^mu (analytic for static/circular, integrated
 *   for flyby/freefall);
 * - the observer tetrad (constructed per event from u + camera axes);
 * - deterministic proper time tau advanced by the atlas transport.
 *
 * Everything in this directory is binary64 CPU reference physics (same
 * philosophy as cpuReference.ts / kerr/reference.ts). GPU backends consume
 * the flattened uniform block produced by `buildObserverFrameUniforms`.
 */

/** Physical observer mode ids. `camera` preserves pre-M10 semantics exactly. */
export type ObserverPhysicsMode = 'camera' | 'static' | 'circular' | 'flyby' | 'freefall';

/** Contravariant BL coordinate components (t, r, theta, phi_world). */
export interface CoordinateFourVector {
  readonly t: number;
  readonly r: number;
  readonly th: number;
  readonly ph: number;
}

export type MetricId = 'schwarzschild' | 'kerr';

/** Why an observer configuration cannot render. Distinct failure classes. */
export type ObserverInvalidReason =
  | 'static-inside-ergosphere'
  | 'observer-at-or-inside-horizon'
  | 'observer-on-axis'
  | 'no-circular-orbit-below-photon-orbit'
  | 'degenerate-camera-axis'
  | 'non-finite-parameter'
  | 'flyby-captured-worldline'
  | 'non-finite-worldline-state';

/** Terminal worldline conditions that are NOT failures (declared states). */
export type ObserverTerminalReason = 'horizon-approach' | null;

/**
 * The normalized observer-frame snapshot consumed by CPU reference physics,
 * GPU uniforms, debug UI, tests, and presets. Only semantically defined
 * values are exposed (campaign §2); derived values are computed, never
 * stored redundantly in persisted state.
 */
export interface ObserverFrameSnapshot {
  readonly mode: ObserverPhysicsMode;
  readonly metric: MetricId;
  /** Effective signed spin used by the observer physics (Schwarzschild => 0). */
  readonly effectiveSpin: number;

  readonly valid: boolean;
  readonly invalidReason: ObserverInvalidReason | null;
  readonly terminalReason: ObserverTerminalReason;

  /** Boyer-Lindquist spherical coordinates of the observer event. */
  readonly radiusRg: number;
  readonly thetaRad: number;
  readonly phiWorldRad: number;
  /** Embedded world-space position (r_g, center at origin, +Y axis). */
  readonly positionWorld: readonly [number, number, number];

  /**
   * Four-velocity u^mu in BL coordinates (normalized u.mu u^mu = -1 when
   * valid). Null for invalid configurations.
   */
  readonly fourVelocity: CoordinateFourVector | null;
  /**
   * Spatial tetrad legs e_(1..3) in BL coordinates (orthonormal in the
   * observer rest frame, aligned to camera right/up/forward respectively).
   * Null for invalid configurations.
   */
  readonly tetradLegs: readonly [
    CoordinateFourVector,
    CoordinateFourVector,
    CoordinateFourVector
  ] | null;

  /** Speed measured by LOCAL STATIC observers (null inside ergosphere). */
  readonly betaStatic: readonly [number, number, number] | null;
  readonly betaMagnitude: number;
  readonly gammaFactor: number;

  /** Deterministic proper time carried by the worldline clock (t_g units). */
  readonly properTimeTau: number;
  /** BL coordinate time along the worldline (display-capped near horizon). */
  readonly coordinateTimeT: number;

  /** Angular velocity about +Y for circular mode (rad per unit tau/u^t mix). */
  readonly circularOmega: number | null;
  /** True when a circular orbit exists but lies below the ISCO. */
  readonly circularUnstable: boolean;

  /** Declared stop boundary factor for freefall/flyby (ADR section 3). */
  readonly horizonStopFactor: number;
}

/** Flat per-frame uniform payload consumed by every GPU backend. */
export interface ObserverFrameUniforms {
  /** Tetrad leg U (= u^mu) followed by the three spatial legs. */
  readonly legU: readonly [number, number, number, number];
  readonly legA1: readonly [number, number, number, number];
  readonly legA2: readonly [number, number, number, number];
  readonly legA3: readonly [number, number, number, number];
  /** 1 when the observer block is valid and should drive ray init. */
  readonly observerActive: 0 | 1;
  /** Signed effective spin for metric fragments in shader math. */
  readonly effectiveSpin: number;
}

/** Mode-specific control parameters (validated ranges live in controlState). */
export interface CircularObserverParams {
  readonly radiusRg: number;
  /** +1 orbits toward +phi (with disk/frame-dragging sense of positive spin). */
  readonly sense: 1 | -1;
}

export interface FlybyObserverParams {
  /** Conserved specific energy (> 1 for unbound). */
  readonly energyE: number;
  /** Conserved specific axial angular momentum L_z (sign = orbital sense). */
  readonly angularMomentumLz: number;
  /** Starting BL radius (must give R(r0) > 0). */
  readonly startRadiusRg: number;
}

export interface FreefallObserverParams {
  /** Release radius: dropped from rest relative to static observers there. */
  readonly releaseRadiusRg: number;
}

export interface ObserverModeParams {
  circular?: CircularObserverParams;
  flyby?: FlybyObserverParams;
  freefall?: FreefallObserverParams;
}
