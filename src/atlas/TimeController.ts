/**
 * Deterministic destination timeline controller.
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §8 (time model): destinations span
 *   milliseconds to billions of years, so display time, normalized simulation
 *   phase, physical time, and user playback rate are kept as separate
 *   concerns; nonlinear phase mappings are first-class and no uniform
 *   seconds-per-frame scale is assumed.
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §13 (timeline adapters map phase to
 *   source sample time or model parameters; reset is deterministic).
 *
 * Coordinate convention:
 * - The UI/timeline slider operates in normalized phase space [0, 1]
 *   (`simulationPhase`).
 * - The active {@link PhaseMapping} converts UI phase to the destination's
 *   internal simulation coordinate (`forward`) and back (`inverse`); its
 *   `formatDisplay` renders the internal coordinate for humans.
 * - Playback advances the INTERNAL coordinate by `playbackRate * dt`, so
 *   speed is physically uniform in simulation coordinates even when the
 *   mapping itself is nonlinear; the stored UI phase is re-derived each step
 *   through `inverse`.
 * - Until a destination registers a real mapping, an identity mapping is
 *   active and `physicalTime` stays `null` ("no physical units defined").
 *   Once a mapping is registered, `physicalTime` mirrors the internal
 *   coordinate in whatever units that mapping defines (seconds, days,
 *   megayears — destination's contract).
 *
 * Determinism: no wall-clock reads anywhere. All advancement comes from the
 * `dtSeconds` argument supplied by the frame loop.
 */

import type { PhaseMapping, TimeModelSnapshot } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Largest |playbackRate| accepted; guards against pathological UI input. */
const MAX_PLAYBACK_RATE = 1000;

/** Non-finite rates keep the previous rate; magnitude clamped to [0, MAX]. */
function sanitizeRate(rate: unknown, fallback: number): number {
  const n = finiteOrNull(rate);
  if (n === null) return fallback;
  const sign = n < 0 ? -1 : 1;
  return sign * Math.min(Math.abs(n), MAX_PLAYBACK_RATE);
}

/**
 * Fallback mapping used before any destination registers one: identity over
 * [0, 1] with a percentage display. Keeps the controller fully usable while a
 * destination module is still loading.
 */
const IDENTITY_MAPPING: PhaseMapping = {
  id: 'identity',
  label: 'Normalized',
  forward: (phase01) => clamp01(phase01),
  inverse: (internal) => clamp01(internal),
  formatDisplay: (internal) => `${(clamp01(internal) * 100).toFixed(1)}%`
};

export interface TimeControllerOptions {
  /** Initial normalized UI phase in [0, 1]. Default 0. */
  initialPhase?: number;
  /** Initial playback rate (may be negative for reverse). Default 1. */
  playbackRate?: number;
  /** Start paused. Default false. */
  paused?: boolean;
}

// ---------------------------------------------------------------------------
// TimeController
// ---------------------------------------------------------------------------

/**
 * Owns the active destination's timeline state and exposes deterministic
 * transport + scrubbing + snapshot for UI and the frame loop
 * (ARCHITECTURE §8; consumed via `HostServices.time`).
 */
export class TimeController {
  private readonly mappings = new Map<string, PhaseMapping>();

  private activeMapping: PhaseMapping = IDENTITY_MAPPING;
  private usingDefaultMapping = true;

  /** Internal simulation coordinate of the active mapping. */
  private internalTime = 0;
  /** Cached internal-coordinate bounds of the active mapping. */
  private internalMin = 0;
  private internalMax = 1;

  private simulationPhaseValue = 0;
  private physicalTimeValue: number | null = null;
  private displayTimeValue = IDENTITY_MAPPING.formatDisplay(0);

  private rateValue: number;
  private pausedValue: boolean;

  constructor(options: TimeControllerOptions = {}) {
    this.rateValue = sanitizeRate(options.playbackRate ?? 1, 1);
    this.pausedValue = options.paused ?? false;
    this.setPhaseFromUi(typeof options.initialPhase === 'number' ? options.initialPhase : 0);
  }

  // --- Mapping registry ----------------------------------------------------

  /**
   * Register (or replace) a named phase mapping. Registration alone does not
   * activate it; call {@link setPhaseMapping}. Throws on programmer error
   * (bad id or non-function members) — this is an internal API contract, not
   * user input, so it must not fail silently.
   */
  registerPhaseMapping(id: string, mapping: PhaseMapping): void {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new TypeError('TimeController.registerPhaseMapping: id must be a non-empty string.');
    }
    if (
      mapping === null ||
      typeof mapping !== 'object' ||
      typeof mapping.forward !== 'function' ||
      typeof mapping.inverse !== 'function' ||
      typeof mapping.formatDisplay !== 'function'
    ) {
      throw new TypeError(
        `TimeController.registerPhaseMapping: mapping '${id}' must provide forward, inverse and formatDisplay functions.`
      );
    }
    this.mappings.set(id, mapping);
    if (this.activeMapping.id === id) this.activateMapping(mapping);
  }

  /**
   * Activate a previously registered mapping by id. Throws when the id is
   * unknown (programmer error). The current internal coordinate is preserved
   * where possible and re-clamped into the new mapping's range; all derived
   * fields (UI phase, physical time, display string) are recomputed.
   */
  setPhaseMapping(id: string): void {
    const mapping = this.mappings.get(id);
    if (mapping === undefined) {
      throw new Error(
        `TimeController.setPhaseMapping: no mapping registered under id '${id}' (known: ${
          [...this.mappings.keys()].join(', ') || 'none'
        }).`
      );
    }
    this.activateMapping(mapping);
  }

  /** Id of the currently active mapping. */
  get activeMappingId(): string {
    return this.activeMapping.id;
  }

  private activateMapping(mapping: PhaseMapping): void {
    const lo = finiteOrNull(mapping.forward(0)) ?? 0;
    const hi = finiteOrNull(mapping.forward(1)) ?? 1;
    this.internalMin = Math.min(lo, hi);
    this.internalMax = Math.max(lo, hi);
    this.activeMapping = mapping;
    this.usingDefaultMapping = mapping === IDENTITY_MAPPING;
    this.internalTime = clamp(this.internalTime, this.internalMin, this.internalMax);
    this.refreshDerived();
  }

  // --- Transport ------------------------------------------------------------

  play(): void {
    this.pausedValue = false;
  }

  pause(): void {
    this.pausedValue = true;
  }

  /**
   * Set playback rate in internal-coordinate units per second. Negative
   * values play in reverse; 0 freezes advancement while remaining "playing".
   * Non-finite input is ignored.
   */
  setRate(rate: number): void {
    this.rateValue = sanitizeRate(rate, this.rateValue);
  }

  /**
   * Advance the timeline deterministically by `dtSeconds` of frame time:
   * internal += playbackRate * dt, clamped to the mapping's range (the
   * timeline holds at its endpoints rather than looping or auto-pausing).
   * Paused controllers are a no-op. Non-finite dt is treated as 0.
   */
  update(dtSeconds: number): void {
    if (this.pausedValue) return;
    const dt = finiteOrNull(dtSeconds) ?? 0;
    if (dt === 0 || this.rateValue === 0) return;
    this.internalTime = clamp(
      this.internalTime + this.rateValue * dt,
      this.internalMin,
      this.internalMax
    );
    this.refreshDerived();
  }

  // --- Scrubbing / reset ------------------------------------------------------

  /**
   * Scrub to a normalized UI phase in [0, 1]: the value is clamped, mapped to
   * the internal coordinate with `forward`, and the stored UI phase is
   * re-derived with `inverse` so exotic mappings stay self-consistent.
   * Works whether playing or paused.
   */
  scrubTo(phase01: number): void {
    this.setPhaseFromUi(phase01);
  }

  /**
   * Reset the timeline to `initialPhase` (default 0). Deterministic per
   * STATE_AND_ROUTES §11; playback rate and pause state are intentionally
   * preserved (timeline reset ≠ transport reset).
   */
  reset(initialPhase = 0): void {
    this.setPhaseFromUi(initialPhase);
  }

  private setPhaseFromUi(phase01: number): void {
    const ui = clamp(finiteOrNull(phase01) ?? 0, 0, 1);
    this.internalTime = clamp(this.activeMapping.forward(ui), this.internalMin, this.internalMax);
    this.refreshDerived();
  }

  // --- Readout -----------------------------------------------------------------

  /** Normalized UI phase in [0, 1]. */
  get simulationPhase(): number {
    return this.simulationPhaseValue;
  }

  /**
   * Physical time in the active mapping's units, or null while only the
   * default identity mapping is active (no physical units defined).
   */
  get physicalTime(): number | null {
    return this.physicalTimeValue;
  }

  get playbackRate(): number {
    return this.rateValue;
  }

  get paused(): boolean {
    return this.pausedValue;
  }

  /** Human-facing time string produced by the active mapping. */
  get displayTime(): string {
    return this.displayTimeValue;
  }

  /** Internal simulation coordinate of the active mapping (diagnostics). */
  get internalCoordinate(): number {
    return this.internalTime;
  }

  /**
   * Immutable point-in-time view for UI binding and FrameContext assembly
   * (ARCHITECTURE §8). Fresh object every call; callers may hold it.
   */
  snapshot(): TimeModelSnapshot {
    return {
      displayTime: this.displayTimeValue,
      simulationPhase: this.simulationPhaseValue,
      physicalTime: this.physicalTimeValue,
      playbackRate: this.rateValue,
      paused: this.pausedValue
    };
  }

  // --- Derived-state refresh ------------------------------------------------------

  private refreshDerived(): void {
    this.simulationPhaseValue = clamp01(this.activeMapping.inverse(this.internalTime));
    this.physicalTimeValue = this.usingDefaultMapping ? null : this.internalTime;
    this.displayTimeValue = this.activeMapping.formatDisplay(this.internalTime);
  }
}
