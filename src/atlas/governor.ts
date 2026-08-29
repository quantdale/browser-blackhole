/**
 * PerformanceGovernor — global frame-budget and quality-tier controller
 * (CA-ADR-015: quality is managed centrally; destinations expose knobs but
 * never fight this controller).
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §6 "PerformanceGovernor" — FPS EMA,
 *   auto tier hysteresis, interaction/settling/stable activity model.
 * - docs/cosmic-atlas/DECISIONS.md CA-ADR-015 — one global governor.
 * - docs/cosmic-atlas/WORK_PACKETS.md CA0 (host shell) — governor contract in
 *   `src/atlas/types.ts` (`IPerformanceGovernor`).
 * - docs/PERFORMANCE.md §3 — dynamic resolution tiers; render scale per tier;
 *   never trace at unrestricted devicePixelRatio.
 *
 * Semantics implemented here:
 * - FPS is an exponential moving average of per-frame durations sampled by
 *   `beginFrame()`/`endFrame()` pairs via `performance.now()`. The kernel's
 *   `renderFrame()` already brackets every orchestrated frame with these calls
 *   (see `SharedRendererKernel.renderFrame`), so a host driving frames through
 *   the kernel must NOT call them a second time.
 * - Auto mode walks one tier at a time on a fixed ladder low→medium→high→ultra:
 *   drop when smoothed fps < target*0.8 sustained ~1 s; raise when
 *   fps > target*1.15 sustained ~3 s; never two changes closer than 2 s
 *   (anti-flap). Manual modes (`low|medium|high|ultra`) pin the tier exactly.
 * - `setForcedTier(tier)` is a host-side extension used by transitions that
 *   need a deterministic ceiling while keeping 'auto' as the user mode: it
 *   overrides the auto walk but never overrides a manual pin.
 * - Activity model: `notifyInteraction()` restarts a clock advanced by frame
 *   durations; mode is 'interaction' for 0.5 s, then 'settling' for 2 s, then
 *   'stable'. The clock is frame-driven (no wall-clock timers), so `dispose()`
 *   only clears subscriptions.
 * - Work multipliers (`setWorkMultiplier`) express a destination's relative
 *   cost; the effective fps target is `targetFps / multiplier` (clamped to
 *   [0.1, 10]) so a heavier destination tolerates proportionally lower fps
 *   before a downgrade. The multiplier that matters is the ACTIVE
 *   destination's (`setActiveDestination`, host-called on activation and
 *   disposal). Until the host signals an activation, the heaviest registered
 *   multiplier is used as a conservative legacy fallback.
 * - Raise condition is refresh-aware: on a vsync-locked display, wall-clock
 *   fps saturates at the compositor cadence, so demanding smoothed fps above
 *   `target x 1.15` can be unsatisfiable (e.g. 60 fps display, 60 fps target)
 *   and auto would never climb back after a downgrade. The governor estimates
 *   the refresh interval from a window of recent frame minima (quantized to
 *   common refresh intervals) and raises when smoothed fps exceeds
 *   `min(target x 1.15, refreshFps - margin)`. When no confident estimate
 *   exists (few samples, unthrottled environment), the raw factor applies.
 * - Startup grace: for STARTUP_GRACE_MS of wall time after governor creation —
 *   and again after every forced-tier release / mode change into auto /
 *   active-destination switch, all of which can trigger pipeline compilation —
 *   automatic tier changes are suppressed entirely so known warmup spikes do
 *   not cascade the tier down (docs/PERFORMANCE_BUDGETS.md §6/§17).
 */

import type {
  DestinationId,
  GovernorActivityMode,
  GovernorConfig,
  IPerformanceGovernor,
  QualityTier,
  VisualWorkBudget
} from './types';
import { resolveVisualWorkBudget } from './visualWorkBudget';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Tier ladder, lowest first. Auto mode moves one step at a time. */
const TIER_LADDER: readonly QualityTier[] = ['low', 'medium', 'high', 'ultra'];

/** Internal render scale per tier (docs/PERFORMANCE.md §3). */
export const PER_TIER_RENDER_SCALE: Readonly<Record<QualityTier, number>> = {
  low: 0.6,
  medium: 0.8,
  high: 1.0,
  ultra: 1.0
};

/** Drop a tier when smoothed fps stays below target × this factor… */
const DROP_THRESHOLD_FACTOR = 0.8;
/** …for at least this long (ms). */
const DROP_SUSTAIN_MS = 1000;

/** Raise a tier when smoothed fps stays above target × this factor… */
const RAISE_THRESHOLD_FACTOR = 1.15;
/** …for at least this long (ms) — raising is deliberately slower than dropping. */
const RAISE_SUSTAIN_MS = 3000;

/** Minimum wall time between two automatic tier changes (anti-flap). */
const MIN_TIER_CHANGE_INTERVAL_MS = 2000;

/** Per-frame EMA weight toward the newest instantaneous fps sample. */
const FPS_EMA_ALPHA = 0.1;

/** interaction → settling after this long since the last interaction (ms). */
const SETTLING_AFTER_MS = 500;
/** settling → stable after this much additional quiet time (ms). */
const STABLE_AFTER_SETTLING_MS = 2000;

/** Clamp bounds for destination work multipliers. */
const MULTIPLIER_MIN = 0.1;
const MULTIPLIER_MAX = 10;

/**
 * No automatic tier changes within this wall-time window (ms) after governor
 * creation or after any event that recompiles pipelines (forced-tier release,
 * mode entry, active-destination switch) — compilation/loading spikes are
 * noise, not signal (docs/PERFORMANCE_BUDGETS.md §6 "ignore known
 * compilation/loading spikes", §17 bootstrap).
 */
const STARTUP_GRACE_MS = 3000;

/** Frame-duration history length for the refresh estimator (~2 s at 60 Hz). */
const REFRESH_WINDOW_SAMPLES = 120;
/** Minimum history samples before the estimate is trusted. */
const REFRESH_MIN_SAMPLES = 30;
/**
 * A window minimum confirms a common refresh interval only when it is close
 * to it on BOTH sides. One-sided slack would let overload frames (slower than
 * vsync) masquerade as a low-refresh display and fabricate raise headroom.
 */
const REFRESH_MATCH_TOLERANCE = 0.15;
/** Common display refresh intervals (ms), ascending. */
const COMMON_REFRESH_INTERVALS_MS: readonly number[] = [
  1000 / 120,
  1000 / 90,
  1000 / 60,
  1000 / 30
];
/** Margin subtracted from the estimated refresh fps in the raise threshold. */
const RAISE_REFRESH_MARGIN_FPS = 4;
/** Floor for the raise threshold as a fraction of target (stays above drop band). */
const RAISE_THRESHOLD_FLOOR_FACTOR = 0.9;

/** Frame-duration guard: a single sample longer than this is clamped (tab switch). */
const MAX_SAMPLED_FRAME_MS = 500;

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  targetFps: 60,
  qualityMode: 'auto',
  dprCap: 2
};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// ---------------------------------------------------------------------------
// Governor
// ---------------------------------------------------------------------------

export class PerformanceGovernor implements IPerformanceGovernor {
  private config: GovernorConfig = { ...DEFAULT_GOVERNOR_CONFIG };

  /** Live tier. In manual modes this mirrors the pinned mode instantly. */
  private tierValue: QualityTier = 'high';
  /** Host-forced tier (transitions); overrides auto, not manual pins. */
  private forcedTierValue: QualityTier | null = null;

  // Frame sampling (begin/end pairs).
  private frameStartMs = -1;
  private sampling = false;

  // Smoothed fps state.
  private fpsEmaValue = 0;
  private hasFpsSample = false;

  // Refresh estimation from recent frame-duration minima (ring buffer).
  private readonly frameDurationWindow = new Float32Array(REFRESH_WINDOW_SAMPLES);
  private frameWindowCount = 0;
  private frameWindowCursor = 0;

  // Startup grace: wall-time anchor; automatic changes are suppressed for
  // STARTUP_GRACE_MS after creation or the last grace restart.
  private graceAnchorMs = 0;

  // Active destination (work-multiplier lifecycle).
  private activeDestinationIdValue: DestinationId | null = null;
  /** False until the first setActiveDestination call (legacy fallback semantics). */
  private hasActiveDestinationSignal = false;

  // Sustained-threshold accumulators (ms of continuous condition).
  private belowDropThresholdMs = 0;
  private aboveRaiseThresholdMs = 0;
  private lastAutoChangeAtMs = -Infinity;

  // Activity clock, advanced only by sampled frame durations.
  private msSinceInteraction = Infinity;

  private disposed = false;

  private readonly tierListeners = new Set<(tier: QualityTier) => void>();
  private readonly workMultipliers = new Map<DestinationId, number>();

  // -------------------------------------------------------------------------
  // IPerformanceGovernor
  // -------------------------------------------------------------------------

  configure(config: Partial<GovernorConfig>): void {
    if (this.disposed) return;

    if (config.targetFps !== undefined) {
      if (config.targetFps === 30 || config.targetFps === 60) {
        this.config.targetFps = config.targetFps;
      } else {
        console.warn(
          `[PerformanceGovernor] ignoring unsupported targetFps ${String(config.targetFps)} (expected 30 or 60).`
        );
      }
    }

    let modeChanged = false;
    if (config.qualityMode !== undefined && config.qualityMode !== this.config.qualityMode) {
      this.config.qualityMode = config.qualityMode;
      modeChanged = true;
    }

    if (config.dprCap !== undefined) {
      if (Number.isFinite(config.dprCap) && config.dprCap > 0) {
        this.config.dprCap = config.dprCap;
      } else {
        console.warn(
          `[PerformanceGovernor] ignoring non-positive dprCap ${String(config.dprCap)}.`
        );
      }
    }

    if (modeChanged) this.applyModeToTier();
  }

  beginFrame(): void {
    if (this.disposed) return;
    // Unbalanced re-begin simply restarts the sample window.
    this.frameStartMs = performance.now();
    this.sampling = true;
  }

  endFrame(): void {
    if (this.disposed || !this.sampling) return;
    this.sampling = false;

    const durationMs = clamp(performance.now() - this.frameStartMs, 0, MAX_SAMPLED_FRAME_MS);
    const instantaneousFps = 1000 / Math.max(durationMs, 0.01);
    if (!this.hasFpsSample) {
      this.fpsEmaValue = instantaneousFps;
      this.hasFpsSample = true;
    } else {
      this.fpsEmaValue += FPS_EMA_ALPHA * (instantaneousFps - this.fpsEmaValue);
    }

    this.recordFrameDuration(durationMs);
    this.advanceActivityClock(durationMs);
    this.evaluateAutoTier(durationMs);
  }

  notifyInteraction(): void {
    if (this.disposed) return;
    this.msSinceInteraction = 0;
  }

  setWorkMultiplier(destinationId: DestinationId, multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      console.warn(
        `[PerformanceGovernor] ignoring non-positive work multiplier for '${destinationId}'.`
      );
      return;
    }
    this.workMultipliers.set(destinationId, multiplier);
    if (this.activeDestinationIdValue === destinationId) {
      // Cost expectation for the live workload changed; accumulated evidence
      // about the old workload does not carry over.
      this.resetHysteresis();
    }
  }

  /**
   * Host lifecycle hook: which destination is currently rendering. Switching
   * resets hysteresis accumulators and restarts the startup grace window,
   * because the arriving destination may compile fresh pipelines.
   */
  setActiveDestination(destinationId: DestinationId | null): void {
    if (this.disposed) return;
    if (this.hasActiveDestinationSignal && this.activeDestinationIdValue === destinationId) return;
    this.activeDestinationIdValue = destinationId;
    this.hasActiveDestinationSignal = true;
    this.resetHysteresis();
    this.restartGrace();
  }

  get currentTier(): QualityTier {
    return this.tierValue;
  }

  get renderScale(): number {
    return PER_TIER_RENDER_SCALE[this.tierValue];
  }

  get activityMode(): GovernorActivityMode {
    if (this.msSinceInteraction < SETTLING_AFTER_MS) return 'interaction';
    if (this.msSinceInteraction < SETTLING_AFTER_MS + STABLE_AFTER_SETTLING_MS) {
      return 'settling';
    }
    return 'stable';
  }

  getVisualWorkBudget(): VisualWorkBudget {
    return resolveVisualWorkBudget(this.tierValue, this.activityMode);
  }

  onTierChanged(cb: (tier: QualityTier) => void): () => void {
    this.tierListeners.add(cb);
    return () => {
      this.tierListeners.delete(cb);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sampling = false;
    this.tierListeners.clear();
    this.workMultipliers.clear();
    this.activeDestinationIdValue = null;
    this.hasActiveDestinationSignal = false;
  }

  // -------------------------------------------------------------------------
  // Local extensions (host/transition hooks)
  // -------------------------------------------------------------------------

  /**
   * Force the tier while the user mode remains 'auto' (transition policy).
   * Manual pins always win; passing `null` resumes the auto walk with reset
   * hysteresis accumulators so the next change respects full sustain times.
   */
  setForcedTier(tier: QualityTier | null): void {
    if (this.disposed) return;
    const previous = this.tierValue;
    this.forcedTierValue = tier;
    this.resetHysteresis();
    if (tier !== null && this.config.qualityMode === 'auto') {
      this.tierValue = tier;
      this.emitTierChanged(previous);
    }
    if (tier === null && this.config.qualityMode === 'auto') {
      // Releasing a forced tier typically coincides with fresh pipeline
      // compilation for the arriving destination.
      this.restartGrace();
    }
  }

  /** Currently forced tier, or `null` when the auto/manual path is live. */
  get forcedTier(): QualityTier | null {
    return this.forcedTierValue;
  }

  /** Smoothed fps sample (diagnostics/debug inventory). */
  get smoothedFps(): number {
    return this.fpsEmaValue;
  }

  /** Registered relative-cost multiplier for a destination (default 1). */
  getWorkMultiplier(destinationId: DestinationId): number {
    return this.workMultipliers.get(destinationId) ?? 1;
  }

  /** Destination whose work multiplier drives the fps expectation, if signaled. */
  get activeDestinationId(): DestinationId | null {
    return this.activeDestinationIdValue;
  }

  /** Snapshot of the mutable config for debug surfaces. */
  getConfig(): Readonly<GovernorConfig> {
    return this.config;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Effective fps expectation. With an active-destination signal, only that
   * destination's multiplier counts; without one (legacy hosts), the heaviest
   * registered multiplier sets a conservative expectation.
   */
  private effectiveTargetFps(): number {
    let multiplier = 1;
    if (this.hasActiveDestinationSignal) {
      if (this.activeDestinationIdValue !== null) {
        const registered = this.workMultipliers.get(this.activeDestinationIdValue);
        if (registered !== undefined) multiplier = registered;
      }
    } else {
      for (const value of this.workMultipliers.values()) {
        if (value > multiplier) multiplier = value;
      }
    }
    const clamped = clamp(multiplier, MULTIPLIER_MIN, MULTIPLIER_MAX);
    return this.config.targetFps / clamped;
  }

  private applyModeToTier(): void {
    const previous = this.tierValue;
    this.resetHysteresis();
    if (this.config.qualityMode === 'auto') {
      // Keep walking from wherever the tier currently is; re-arm grace since
      // entering auto often follows a settings change that recompiles.
      this.restartGrace();
      return;
    }
    this.tierValue = this.config.qualityMode;
    this.emitTierChanged(previous);
  }

  private evaluateAutoTier(frameDurationMs: number): void {
    if (this.config.qualityMode !== 'auto') return;
    if (this.forcedTierValue !== null) return;

    const target = this.effectiveTargetFps();
    const index = TIER_LADDER.indexOf(this.tierValue);
    if (index < 0) return;

    // Sustain accumulators advance on every auto-mode frame, including during
    // the anti-flap cooldown and the startup grace window; only the actual
    // tier change is gated below.
    if (this.fpsEmaValue < target * DROP_THRESHOLD_FACTOR) {
      this.belowDropThresholdMs += frameDurationMs;
      this.aboveRaiseThresholdMs = 0;
    } else if (this.fpsEmaValue > this.raiseThresholdFps(target)) {
      this.aboveRaiseThresholdMs += frameDurationMs;
      this.belowDropThresholdMs = 0;
    } else {
      // Inside the comfort band: both accumulators decay to zero.
      this.belowDropThresholdMs = 0;
      this.aboveRaiseThresholdMs = 0;
    }

    const now = performance.now();
    if (now - this.lastAutoChangeAtMs < MIN_TIER_CHANGE_INTERVAL_MS) return;

    // Known compilation/loading spikes must not move the tier
    // (docs/PERFORMANCE_BUDGETS.md §6/§17). Evidence collected inside the
    // grace window is discarded so a post-grace decision starts clean.
    if (now - this.graceAnchorMs < STARTUP_GRACE_MS) {
      this.resetHysteresis();
      return;
    }

    const previous = this.tierValue;
    if (this.belowDropThresholdMs >= DROP_SUSTAIN_MS && index > 0) {
      this.tierValue = TIER_LADDER[index - 1] as QualityTier;
      this.afterAutoChange(now, previous);
      return;
    }
    if (this.aboveRaiseThresholdMs >= RAISE_SUSTAIN_MS && index < TIER_LADDER.length - 1) {
      this.tierValue = TIER_LADDER[index + 1] as QualityTier;
      this.afterAutoChange(now, previous);
    }
  }

  private afterAutoChange(nowMs: number, previous: QualityTier): void {
    this.lastAutoChangeAtMs = nowMs;
    this.belowDropThresholdMs = 0;
    this.aboveRaiseThresholdMs = 0;
    this.emitTierChanged(previous);
  }

  /** Sliding window of recent frame durations feeding the refresh estimator. */
  private recordFrameDuration(durationMs: number): void {
    this.frameDurationWindow[this.frameWindowCursor] = durationMs;
    this.frameWindowCursor = (this.frameWindowCursor + 1) % REFRESH_WINDOW_SAMPLES;
    if (this.frameWindowCount < REFRESH_WINDOW_SAMPLES) this.frameWindowCount += 1;
  }

  /**
   * Estimated display refresh fps from the minimum of recent frame durations,
   * quantized to common refresh intervals. Frames are rAF-driven, so a
   * healthy pipeline's fastest frames sit at the compositor cadence;
   * quantization keeps overload frames (slower than vsync) and unthrottled
   * environments from faking or hiding headroom. Returns null when the
   * history is too short or matches no common interval.
   */
  private estimatedRefreshFps(): number | null {
    if (this.frameWindowCount < REFRESH_MIN_SAMPLES) return null;
    let minMs = Infinity;
    for (let i = 0; i < this.frameWindowCount; i += 1) {
      const duration = this.frameDurationWindow[i];
      if (duration !== undefined && duration < minMs) minMs = duration;
    }
    for (const intervalMs of COMMON_REFRESH_INTERVALS_MS) {
      if (Math.abs(minMs - intervalMs) <= intervalMs * REFRESH_MATCH_TOLERANCE) {
        return 1000 / intervalMs;
      }
    }
    return null;
  }

  /**
   * fps level the smoothed sample must exceed before a raise is considered.
   * Refresh-aware: capped by the estimated compositor cadence minus margin so
   * a vsync-locked display can still qualify for raises it can actually
   * sustain; floored above the drop band so the two never overlap.
   */
  private raiseThresholdFps(targetFps: number): number {
    const rawThreshold = targetFps * RAISE_THRESHOLD_FACTOR;
    const refreshFps = this.estimatedRefreshFps();
    if (refreshFps === null) return rawThreshold;
    return Math.max(
      targetFps * RAISE_THRESHOLD_FLOOR_FACTOR,
      Math.min(rawThreshold, refreshFps - RAISE_REFRESH_MARGIN_FPS)
    );
  }

  /** Re-arm the startup grace window (pipeline recompilation expected). */
  private restartGrace(): void {
    this.graceAnchorMs = performance.now();
  }

  private advanceActivityClock(frameDurationMs: number): void {
    if (Number.isFinite(this.msSinceInteraction)) {
      this.msSinceInteraction += frameDurationMs;
    } else {
      // Before any interaction the app counts as stable.
      this.msSinceInteraction = SETTLING_AFTER_MS + STABLE_AFTER_SETTLING_MS + 1;
    }
  }

  private resetHysteresis(): void {
    this.belowDropThresholdMs = 0;
    this.aboveRaiseThresholdMs = 0;
  }

  private emitTierChanged(previous: QualityTier): void {
    if (previous === this.tierValue) return;
    for (const cb of Array.from(this.tierListeners)) cb(this.tierValue);
  }
}
