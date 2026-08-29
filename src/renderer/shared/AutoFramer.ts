/**
 * Shared camera auto-framing for destinations whose scene scale changes by
 * orders of magnitude over their timeline (phenomena-animation campaign).
 *
 * WHY THIS EXISTS
 * A fixed arrival camera can only frame one instant. A supernova shell grows
 * from ~1 to ~500 scene units, and a tidal-disruption debris stream from a few
 * hundred to tens of thousands, so a single standoff shows an empty frame for
 * most of the timeline and then an interior view of a wall of gas. Both
 * destinations previously did exactly that.
 *
 * CONTRACT
 * - Destinations may pair the distance update with an explicit presentation
 *   focus target; azimuth and polar stay user-owned. AutoFramer itself never
 *   changes physical observer state.
 * - The rig runs its own arrival/preset ease after `reset()`; writing during it
 *   would cancel that animation (`setOrbit` clears it), so the framer stays
 *   hands-off until `rig.isAnimating()` clears and then adopts whatever the ease
 *   left behind as its baseline. Arming on the rig's OWN state rather than a
 *   wall-clock delay is what makes a paused capture deterministic: with a delay,
 *   whether the framer already owned the distance depended on how long the
 *   caller happened to wait, so two captures of the same scrubbed instant could
 *   differ (a visual-golden row was unreproducible between runs).
 * - Once armed, the framer eases the distance toward `margin * extent` and
 *   compares the rig's live distance against the value it last wrote. Any
 *   discrepancy means the VIEWER moved the camera, and the framer disables
 *   itself permanently for that visit (`enabled` reads false thereafter).
 * - Destinations must declare their own rig distance limits: the framer clamps
 *   to [minUnits, maxUnits] but the rig applies its own clamp on top.
 * - While the timeline is PAUSED, callers pass `snapToDesired` so a scrubbed
 *   frame is a SETTLED frame: easing would leave the camera drifting after each
 *   scrub, which breaks deterministic replay and reads as drift to a viewer who
 *   paused on purpose.
 */

export interface AutoFramerOptions {
  /** Distance = margin x extent. */
  margin: number;
  /** Clamp for the requested distance, in scene units. */
  minUnits: number;
  maxUnits: number;
  /** Exponential approach constant, per second. */
  lerpPerSecond: number;
  /** Relative distance discrepancy that counts as "the viewer took over". */
  userEpsilon: number;
  /**
   * Fallback ceiling (seconds) after which the framer arms even if the rig still
   * claims to be animating. Guards against a rig implementation whose animation
   * never clears; normal arming is driven by `rig.isAnimating()`.
   */
  armDelaySeconds: number;
}

/** Minimal rig surface the framer needs (satisfied by ICameraRig). */
export interface AutoFramerRig {
  getOrbit(): { azimuthDeg: number; polarDeg: number; distance: number };
  setOrbit(
    azimuthDeg: number,
    polarDeg: number,
    distance: number,
    source?: 'system' | 'user'
  ): void;
  /** True while the rig's own arrival/preset ease is still interpolating. */
  isAnimating(): boolean;
  /** Optional viewer-input revision; separates user takeover from host writes. */
  getUserInteractionRevision?(): number;
}

const DEFAULTS: AutoFramerOptions = {
  margin: 2.2,
  minUnits: 1,
  maxUnits: 10_000,
  lerpPerSecond: 3.2,
  userEpsilon: 0.05,
  armDelaySeconds: 1.5
};

export class AutoFramer {
  private readonly options: AutoFramerOptions;
  private enabledValue = true;
  private lastWritten = Number.NaN;
  private ageSeconds = 0;
  private userInteractionRevision: number | null = null;

  constructor(options: Partial<AutoFramerOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Re-arm for a fresh visit (call from the destination's `enter`). */
  reset(): void {
    this.enabledValue = true;
    this.lastWritten = Number.NaN;
    this.ageSeconds = 0;
    this.userInteractionRevision = null;
  }

  /** False once the viewer has taken over the distance for this visit. */
  get enabled(): boolean {
    return this.enabledValue;
  }

  /** Distance this framer last requested, or null before it owns the camera. */
  get requestedDistance(): number | null {
    return Number.isFinite(this.lastWritten) ? this.lastWritten : null;
  }

  /**
   * Advance one frame toward framing `extentUnits`. Returns the distance now in
   * effect (the rig's own value when the framer is not driving).
   *
   * `marginOverride` lets a destination frame tighter for stages with a single
   * small subject (a star on approach) than for stages that must hold a whole
   * stream.
   */
  update(
    rig: AutoFramerRig,
    extentUnits: number,
    dtSeconds: number,
    marginOverride?: number,
    snapToDesired = false
  ): number {
    const orbit = rig.getOrbit();
    if (!this.enabledValue) return orbit.distance;

    const userRevision = rig.getUserInteractionRevision?.();
    if (userRevision !== undefined) {
      if (this.userInteractionRevision === null) {
        this.userInteractionRevision = userRevision;
      } else if (userRevision !== this.userInteractionRevision) {
        // The camera may also be written by a transition ramp between frames;
        // only direct viewer input is a takeover signal.
        this.enabledValue = false;
        return orbit.distance;
      }
    }

    this.ageSeconds += Math.max(dtSeconds, 0);
    const easing = rig.isAnimating() && this.ageSeconds < this.options.armDelaySeconds;
    if (easing) {
      // The rig's arrival ease owns the camera: neither read a baseline from it
      // nor write to it.
      return orbit.distance;
    }

    if (
      userRevision === undefined &&
      Number.isFinite(this.lastWritten) &&
      Math.abs(orbit.distance - this.lastWritten) >
        Math.max(1e-3, this.options.userEpsilon * this.lastWritten)
    ) {
      this.enabledValue = false;
      return orbit.distance;
    }

    const extent = Number.isFinite(extentUnits) ? Math.max(extentUnits, 0) : 0;
    const margin = marginOverride ?? this.options.margin;
    const desired = Math.min(
      this.options.maxUnits,
      Math.max(this.options.minUnits, extent * margin)
    );
    const current = Number.isFinite(this.lastWritten) ? this.lastWritten : orbit.distance;
    // Snap (used while the timeline is PAUSED): a scrubbed frame must be a
    // settled frame. Easing after a scrub leaves the camera drifting for about a
    // second, so two captures of the "same" scrubbed instant differ — which is
    // both a determinism violation for deterministic-replay tests and visible
    // drift to a viewer who paused deliberately.
    const blend = snapToDesired
      ? 1
      : 1 - Math.exp(-this.options.lerpPerSecond * Math.max(dtSeconds, 0));
    const next = current + (desired - current) * blend;
    this.lastWritten = next;
    if (Math.abs(next - orbit.distance) > 1e-4) {
      rig.setOrbit(orbit.azimuthDeg, orbit.polarDeg, next, 'system');
    }
    return next;
  }
}
