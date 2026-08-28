/**
 * TransitionDirector — Cosmic Atlas transition/streaming state machine (CA1).
 *
 * Spec sources:
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §4 (transition runtime state) and
 *   §5 (generation safety: every async commit re-checks the generation token;
 *   a stale prepared target is disposed, never activated).
 * - docs/cosmic-atlas/PRODUCT_UX_AND_TRANSITIONS.md §4 (IDLE → PREPARE_TARGET
 *   → DEPART → OCCLUDE → ARRIVE → INTERACTIVE), §6 (phase resource budget),
 *   §7 (reduced motion), §8 (slow-load status), §9 (cancellation / latest
 *   wins), §11 (arrival cameras).
 * - docs/cosmic-atlas/WORK_PACKETS.md CA1-01 … CA1-10.
 * - docs/cosmic-atlas/DECISIONS.md CA-ADR-002 (one heavy destination),
 *   CA-ADR-004 (hyperspace doubles as loading boundary), CA-ADR-005 (reduced
 *   motion bypasses vestibular effects), CA-ADR-015 (global quality governor),
 *   CA-ADR-020 (transition visuals are not scientific).
 *
 * Phase machine (runtime `TransitionPhase | 'idle'`):
 *
 *   idle → preparing → outgoing → hyperspace → arriving → idle
 *
 * - preparing : target module `prepare()` runs with an AbortController owned
 *               by the director. The current scene stays fully interactive; if
 *               preparation exceeds `slowLoadThresholdMs`, slow-load status
 *               events are emitted for the UI. `prepare()` resolving IS the
 *               minimum-ready signal (CA1-03): optional streaming may continue
 *               inside the module after activation.
 * - outgoing  : frozen frame via `ISharedPost.captureSnapshot()`, source
 *               simulation exits (`freezeForTransition: true`), TRANSITION
 *               quality policy forces the governor low, overlay ramps in.
 * - hyperspace: screen dominated by the transition field. At the phase
 *               midpoint the occlusion handoff disposes the source scope and
 *               activates the already-prepared target, then commits the route.
 * - arriving  : overlay decays while the camera eases from the captured
 *               departure transform to the preset arrival shot; governor
 *               quality is restored and recovers through its own hysteresis.
 *
 * Race safety (CA1-02/CA1-12): requests during `preparing` take effect
 * immediately — generation increments, the previous AbortController is
 * cancelled, and every async continuation checks the generation before any
 * commit. Requests during motion are queued latest-wins and never invalidate
 * the in-flight transition. Exactly one transition is in flight at a time.
 *
 * Integration assumptions (owned by other workers, kept to one line each):
 * - `ResourceManager.createScope(name): ResourceScope` exists on the manager.
 * - The host wires `getRenderer()` to the shared kernel's renderer instance.
 * - `ICameraRig.applyArrivalPreset(preset, 0)` applies the preset instantly.
 * - `ISharedPost.present(overlay, opacity)` composites standard-over.
 */

import { Vector3, type Texture } from 'three';
import { HyperspacePass, type HyperspaceStyle } from './hyperspacePass';
import type {
  CameraArrivalPreset,
  DestinationId,
  ICameraRig,
  IPerformanceGovernor,
  ISharedPost,
  PhenomenonDescriptor,
  PresetDescriptor,
  PreparedPhenomenon,
  QualityMode,
  QualityTier,
  RendererLike,
  ResourceScope,
  TransitionPhase,
  TransitionPublicState,
  TransitionRuntimeState
} from './types';
import type { ResourceManager } from './ResourceManager';

// ---------------------------------------------------------------------------
// Public configuration types
// ---------------------------------------------------------------------------

export interface TransitionPhaseTimings {
  /** DEPART duration in ms: overlay ramp-in over the frozen outgoing frame. */
  outgoingMs: number;
  /** OCCLUDE window in ms; its midpoint hosts the resource handoff. */
  hyperspaceMs: number;
  /** ARRIVE duration in ms: overlay decay + camera settle. */
  arrivingMs: number;
  /** Multiplier applied to all durations when reduced motion is active. */
  reducedMotionScale: number;
}

export const DEFAULT_TRANSITION_TIMINGS: TransitionPhaseTimings = {
  outgoingMs: 550,
  hyperspaceMs: 900,
  arrivingMs: 850,
  reducedMotionScale: 0.6
};

export interface TransitionDirectorOptions {
  timings?: Partial<TransitionPhaseTimings>;
  /** Prepare elapsed time before slow-load status events fire (PRODUCT_UX §8). */
  slowLoadThresholdMs?: number;
  /** Repeat interval of slow-load status events while still preparing. */
  slowLoadRepeatMs?: number;
  /**
   * Quality mode restored in the governor when motion ends (CA1-06). The host
   * should pass its user-selected mode (`atlasState.rendering.qualityMode`).
   */
  baseQualityMode?: QualityMode;
  /** Deterministic seed for the hyperspace field. */
  seed?: number;
}

/** Host hook around the built-in TRANSITION quality policy (CA1-06). */
export interface TransitionQualityHooks {
  /** Called after the built-in policy forces conservative quality. */
  onMotionBegin(): void;
  /** Called after the built-in policy restores the base quality mode. */
  onMotionEnd(): void;
}

export interface TransitionPrepareRequest {
  descriptor: PhenomenonDescriptor;
  preset: PresetDescriptor;
  quality: QualityTier;
  /** Aborted by the director when the user re-targets mid-load. */
  signal: AbortSignal;
  reportProgress(fraction01: number, label?: string): void;
}

/**
 * Host-provided lifecycle callbacks. The director never touches destination
 * modules directly; it orchestrates through this boundary only.
 */
export interface TransitionHostCallbacks {
  /** Currently interactive destination id, or null before first activation. */
  getActiveDestination(): DestinationId | null;
  /**
   * Validate and resolve a requested target. Must apply the documented
   * fallbacks (unknown destination/preset) per STATE_AND_ROUTES §2 and never
   * throw for route-shaped input.
   */
  resolveTarget(
    destinationId: DestinationId,
    presetId?: string
  ): { descriptor: PhenomenonDescriptor; preset: PresetDescriptor };
  /** Run the target module's `prepare()`; resolution == minimum-ready. */
  prepare(request: TransitionPrepareRequest): Promise<PreparedPhenomenon>;
  /** Run the prepared module's `enter()` and make it the active scene. */
  activate(prepared: PreparedPhenomenon, ctx: { reducedMotion: boolean }): Promise<void> | void;
  /** Run the active module's `exit()`; freeze the frame when requested. */
  exitActive(ctx: { freezeForTransition: boolean }): Promise<void> | void;
  /** Dispose the active module and its ResourceScope (occlusion handoff). */
  disposeActive(): void;
  /** Dispose a prepared-but-never-activated target scope (stale prepare). */
  disposePrepared(prepared: PreparedPhenomenon): void;
}

export interface TransitionDeps {
  resources: ResourceManager;
  post: ISharedPost;
  governor: IPerformanceGovernor;
  cameraRig: ICameraRig;
  /** Access to the shared renderer for offscreen overlay rendering. */
  getRenderer(): RendererLike | null;
  callbacks: TransitionHostCallbacks;
  qualityHooks?: TransitionQualityHooks;
}

// ---------------------------------------------------------------------------
// Event payload types (consumed by host/UI)
// ---------------------------------------------------------------------------

export interface TransitionPhaseEvent {
  phase: TransitionPhase | 'idle';
  generation: number;
  sourceId: DestinationId | null;
  targetId: DestinationId | null;
}

export interface TransitionProgressEvent {
  destinationId: DestinationId;
  fraction01: number;
  label: string | null;
  generation: number;
}

export type TransitionStatusKind = 'slow-load' | 'route-commit' | 'info';

export interface TransitionStatusEvent {
  kind: TransitionStatusKind;
  message: string;
  detailLabel: string | null;
  /** Only set when actual progress is known (PRODUCT_UX §8). */
  fraction01: number | null;
  elapsedMs: number;
  destinationId: DestinationId | null;
}

export interface TransitionErrorEvent {
  message: string;
  destinationId: DestinationId | null;
  generation: number;
  /** True when the active scene could not be restored by the director. */
  fatal: boolean;
}

/** A travel request: destination id plus optional preset id. */
export interface TransitionRequest {
  destinationId: DestinationId;
  presetId?: string;
}

/** Peak tunnel travel speed in tunnel-lengths per second (artistic constant). */
const PEAK_TRAVEL_SPEED = 3.2;

const DEFAULT_SLOW_LOAD_THRESHOLD_MS = 900;
const DEFAULT_SLOW_LOAD_REPEAT_MS = 1200;

// ---------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------

export class TransitionDirector {
  private readonly deps: TransitionDeps;
  private readonly timings: TransitionPhaseTimings;
  private readonly slowLoadThresholdMs: number;
  private readonly slowLoadRepeatMs: number;
  private readonly baseQualityMode: QualityMode;
  private readonly seed: number;

  /** Owned scope tracking the hyperspace pass resources (CA0-04/CA0-09). */
  private readonly scope: ResourceScope;
  private pass: HyperspacePass | null = null;

  // Runtime state (mirrors TransitionRuntimeState, STATE_AND_ROUTES §4).
  private phase: TransitionPhase | 'idle' = 'idle';
  private generation = 0;
  private sourceId: DestinationId | null = null;
  private targetId: DestinationId | null = null;
  private targetTitle = '';
  private prepareAbort: AbortController | null = null;
  private preparedTarget: PreparedPhenomenon | null = null;
  private minimumReady = false;
  private error: string | null = null;
  private reducedMotion = false;
  private outgoingSnapshot: Texture | null = null;

  // Phase clock and envelopes (deterministic: advanced only via update(dt)).
  private phaseElapsedMs = 0;
  private phaseDurationMs = 1;
  private phaseStartedAtMs = 0;
  private style: HyperspaceStyle = 'streaks';
  private travelSpeed = 0;
  private lastOverlayOpacity = 0;

  // Handoff / policy bookkeeping.
  private pendingRequest: TransitionRequest | null = null;
  private occlusionStarted = false;
  private handoffComplete = false;
  private motionQualityActive = false;
  private departureTransform: CameraArrivalPreset | null = null;
  private arrivalApplied = false;
  private prepareElapsedMs = 0;
  private lastSlowLoadAtMs = 0;
  private latestProgress: { fraction01: number; label: string | null } | null = null;
  private disposed = false;

  // Listeners.
  private readonly phaseListeners = new Set<(event: TransitionPhaseEvent) => void>();
  private readonly progressListeners = new Set<(event: TransitionProgressEvent) => void>();
  private readonly statusListeners = new Set<(event: TransitionStatusEvent) => void>();
  private readonly errorListeners = new Set<(event: TransitionErrorEvent) => void>();

  // Scratch vectors for camera interpolation (no per-frame allocations).
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();

  constructor(deps: TransitionDeps, options: TransitionDirectorOptions = {}) {
    this.deps = deps;
    this.timings = { ...DEFAULT_TRANSITION_TIMINGS, ...options.timings };
    this.slowLoadThresholdMs = options.slowLoadThresholdMs ?? DEFAULT_SLOW_LOAD_THRESHOLD_MS;
    this.slowLoadRepeatMs = options.slowLoadRepeatMs ?? DEFAULT_SLOW_LOAD_REPEAT_MS;
    this.baseQualityMode = options.baseQualityMode ?? 'auto';
    this.seed = options.seed ?? 0x9e3779b9;
    // ASSUMED API: ResourceManager.createScope(name): ResourceScope.
    this.scope = deps.resources.createScope('transition-director');
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  onPhaseChange(cb: (event: TransitionPhaseEvent) => void): () => void {
    this.phaseListeners.add(cb);
    return () => this.phaseListeners.delete(cb);
  }

  onProgress(cb: (event: TransitionProgressEvent) => void): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  onStatus(cb: (event: TransitionStatusEvent) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onError(cb: (event: TransitionErrorEvent) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  // -------------------------------------------------------------------------
  // Public queries
  // -------------------------------------------------------------------------

  getPublicState(): TransitionPublicState {
    return {
      active: this.phase !== 'idle',
      phase: this.phase === 'idle' ? null : this.phase,
      progress: this.getProgress(),
      // The whole hyperspace phase uses the opaque envelope. Keep this
      // semantic state owned by the director instead of making the renderer
      // infer occlusion from an artistic opacity threshold.
      destinationOccluded: this.phase === 'hyperspace'
    };
  }

  getRuntimeState(): TransitionRuntimeState {
    return {
      phase: this.phase,
      sourceId: this.sourceId,
      targetId: this.targetId,
      generation: this.generation,
      prepareAbort: this.prepareAbort,
      preparedTarget: this.preparedTarget,
      phaseStartedAtMs: this.phaseStartedAtMs,
      outgoingSnapshot: this.outgoingSnapshot,
      minimumReady: this.minimumReady,
      error: this.error,
      reducedMotion: this.reducedMotion
    };
  }

  /** Normalized progress of the current phase in [0, 1] (0 while idle). */
  getProgress(): number {
    switch (this.phase) {
      case 'idle':
        return 0;
      case 'preparing':
        return this.latestProgress?.fraction01 ?? 0;
      default:
        return clamp01(this.phaseElapsedMs / this.phaseDurationMs);
    }
  }

  isTransitioning(): boolean {
    return this.phase !== 'idle';
  }

  /**
   * Overlay contribution for the shared frame plan / post present call.
   * Texture is null and opacity 0 whenever no transition motion is visible.
   */
  getOverlay(): { texture: Texture | null; opacity: number } {
    return {
      texture: this.pass?.texture ?? null,
      opacity: this.lastOverlayOpacity
    };
  }

  /** Host calls on resize / render-scale change (internal pixels). */
  resizeOverlay(widthPx: number, heightPx: number): void {
    this.pass?.setSize(widthPx, heightPx);
  }

  /**
   * Reduced-motion preference (PRODUCT_UX §7). Applies to the next
   * transition; an in-flight transition keeps its chosen presentation so the
   * resource lifecycle stays identical either way (CA-ADR-005).
   */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  /**
   * Request travel to a destination (latest-wins). While idle/preparing the
   * request takes effect immediately with a fresh generation token; while in
   * motion it is queued and consumed when the current transition settles.
   */
  requestTransition(request: TransitionRequest): void {
    if (this.disposed) return;

    if (this.phase === 'outgoing' || this.phase === 'hyperspace' || this.phase === 'arriving') {
      // Single in-flight transition; newest selection wins the queue
      // (PRODUCT_UX §9). Generation is NOT bumped: the running transition
      // remains valid until it completes.
      this.pendingRequest = { ...request };
      this.emitStatus({
        kind: 'info',
        message: `Travel to ${request.destinationId} queued`,
        detailLabel: null,
        fraction01: null,
        elapsedMs: 0,
        destinationId: request.destinationId
      });
      return;
    }

    // idle or preparing: retarget now — new generation invalidates every
    // prior async continuation (STATE_AND_ROUTES §5).
    this.generation += 1;
    const gen = this.generation;

    // Cancel any in-flight preparation (CA1-02).
    this.prepareAbort?.abort();
    this.prepareAbort = null;

    // A stale prepared target can never be activated; dispose its scope.
    if (this.preparedTarget) {
      this.deps.callbacks.disposePrepared(this.preparedTarget);
      this.preparedTarget = null;
    }
    this.minimumReady = false;
    this.latestProgress = null;
    this.error = null;

    let resolved: { descriptor: PhenomenonDescriptor; preset: PresetDescriptor };
    try {
      resolved = this.deps.callbacks.resolveTarget(request.destinationId, request.presetId);
    } catch (err) {
      this.error = `Failed to resolve destination '${request.destinationId}': ${errorMessage(err)}`;
      this.emitError(this.error, request.destinationId, gen, false);
      // Never strand the machine in a preparing phase with no active prepare.
      this.resetToIdle(gen);
      return;
    }

    this.sourceId = this.deps.callbacks.getActiveDestination();
    this.targetId = resolved.descriptor.id;
    this.targetTitle = resolved.descriptor.title;
    this.phase = 'preparing';
    this.phaseElapsedMs = 0;
    this.phaseDurationMs = 1;
    this.phaseStartedAtMs = performance.now();
    this.prepareElapsedMs = 0;
    this.lastSlowLoadAtMs = 0;
    this.prepareAbort = new AbortController();
    const controller = this.prepareAbort;
    this.emitPhase();
    this.emitStatus({
      kind: 'info',
      message: `Preparing ${resolved.descriptor.title}…`,
      detailLabel: null,
      fraction01: null,
      elapsedMs: 0,
      destinationId: this.targetId
    });

    void this.runPrepare(gen, controller, resolved.descriptor, resolved.preset);
  }

  /**
   * Cancel a pending preparation and return to idle. Mid-flight transitions
   * (post-departure) cannot be cancelled safely and are ignored.
   */
  cancel(): void {
    if (this.disposed || this.phase !== 'preparing') return;
    this.generation += 1;
    const gen = this.generation;
    this.prepareAbort?.abort();
    this.prepareAbort = null;
    if (this.preparedTarget) {
      this.deps.callbacks.disposePrepared(this.preparedTarget);
      this.preparedTarget = null;
    }
    this.pendingRequest = null;
    this.resetToIdle(gen);
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  /**
   * Advance the state machine. All envelopes are integrated from the supplied
   * deterministic frame delta — no wall-clock reads on this path.
   */
  update(dtSeconds: number): void {
    if (this.disposed) return;
    const dtMs = Math.max(0, dtSeconds * 1000);

    switch (this.phase) {
      case 'idle':
        return;

      case 'preparing': {
        this.prepareElapsedMs += dtMs;
        this.maybeEmitSlowLoad();
        return;
      }

      case 'outgoing': {
        this.phaseElapsedMs += dtMs;
        const p = clamp01(this.phaseElapsedMs / this.phaseDurationMs);
        this.applyOverlayEnvelope(p, true);
        if (p >= 1) this.enterHyperspace();
        break;
      }

      case 'hyperspace': {
        this.phaseElapsedMs += dtMs;
        this.applyOverlayEnvelope(1, true);
        if (!this.occlusionStarted && this.phaseElapsedMs / this.phaseDurationMs >= 0.5) {
          // Occlusion point: the field dominates the frame, so the outgoing
          // heavy resources can be released while the target is already
          // prepared (CA1-07, ARCHITECTURE §11).
          this.startOcclusionHandoff();
        }
        if (this.phaseElapsedMs / this.phaseDurationMs >= 1 && this.handoffComplete) {
          this.enterArriving();
        }
        break;
      }

      case 'arriving': {
        this.phaseElapsedMs += dtMs;
        const p = clamp01(this.phaseElapsedMs / this.phaseDurationMs);
        this.applyOverlayEnvelope(p, false);
        this.applyArrivalRamp(p);
        if (p >= 1) this.completeTransition();
        break;
      }
    }

    this.renderOverlay(dtSeconds);
  }

  // -------------------------------------------------------------------------
  // Preparing
  // -------------------------------------------------------------------------

  private async runPrepare(
    gen: number,
    controller: AbortController,
    descriptor: PhenomenonDescriptor,
    preset: PresetDescriptor
  ): Promise<void> {
    try {
      const prepared = await this.deps.callbacks.prepare({
        descriptor,
        preset,
        quality: this.deps.governor.currentTier,
        signal: controller.signal,
        reportProgress: (fraction01: number, label?: string) => {
          this.onPrepareProgress(gen, descriptor.id, fraction01, label);
        }
      });

      // Generation check before EVERY async commit (STATE_AND_ROUTES §5):
      // prepare B gen10, user picks C gen11 ⇒ B is disposed, never activated.
      if (this.stale(gen)) {
        this.deps.callbacks.disposePrepared(prepared);
        return;
      }

      // Minimum-ready contract (CA1-03): prepare() resolution is the
      // activation-ready signal; optional streaming continues module-side.
      this.preparedTarget = prepared;
      this.minimumReady = true;
      this.beginDeparture(gen);
    } catch (err) {
      if (this.stale(gen)) return; // superseded attempt owns the machine now
      if (controller.signal.aborted) {
        this.resetToIdle(gen);
        return;
      }
      const message = `Preparation of '${descriptor.id}' failed: ${errorMessage(err)}`;
      this.error = message;
      this.emitError(message, descriptor.id, gen, false);
      this.resetToIdle(gen);
    }
  }

  private onPrepareProgress(
    gen: number,
    destinationId: DestinationId,
    fraction01: number,
    label?: string
  ): void {
    if (this.stale(gen)) return; // stale reports never reach the UI
    this.latestProgress = { fraction01: clamp01(fraction01), label: label ?? null };
    this.emitProgress({
      destinationId,
      fraction01: clamp01(fraction01),
      label: label ?? null,
      generation: gen
    });
  }

  /** Slow-load status once past the threshold, then periodically (§8). */
  private maybeEmitSlowLoad(): void {
    if (this.prepareElapsedMs < this.slowLoadThresholdMs) return;
    if (
      this.lastSlowLoadAtMs !== 0 &&
      this.prepareElapsedMs - this.lastSlowLoadAtMs < this.slowLoadRepeatMs
    ) {
      return;
    }
    this.lastSlowLoadAtMs = this.prepareElapsedMs;
    this.emitStatus({
      kind: 'slow-load',
      message: `Preparing ${this.targetTitle}…`,
      detailLabel: this.latestProgress?.label ?? null,
      fraction01: this.latestProgress?.fraction01 ?? null,
      elapsedMs: this.prepareElapsedMs,
      destinationId: this.targetId
    });
  }

  // -------------------------------------------------------------------------
  // Outgoing (DEPART)
  // -------------------------------------------------------------------------

  private beginDeparture(gen: number): void {
    // Freeze the outgoing frame BEFORE exiting the source (CA1-05).
    this.outgoingSnapshot = this.deps.post.captureSnapshot();

    this.style = this.reducedMotion ? 'crossfade' : 'streaks';
    const scale = this.reducedMotion ? this.timings.reducedMotionScale : 1;
    this.phase = 'outgoing';
    this.phaseElapsedMs = 0;
    this.phaseDurationMs = Math.max(1, this.timings.outgoingMs * scale);
    this.phaseStartedAtMs = performance.now();
    this.occlusionStarted = false;
    this.handoffComplete = false;
    this.arrivalApplied = false;
    this.travelSpeed = 0;

    this.departureTransform = this.deps.cameraRig.captureTransform();
    this.deps.cameraRig.setControlsEnabled(false);
    this.enterMotionQuality();

    const pass = this.ensurePass();
    pass.setStyle(this.style);
    pass.setTravel(0);
    this.emitPhase();

    void this.runExitActive(gen);
  }

  private async runExitActive(gen: number): Promise<void> {
    try {
      await this.deps.callbacks.exitActive({ freezeForTransition: true });
    } catch (err) {
      if (this.stale(gen)) return;
      this.failFatal(`Outgoing scene exit failed: ${errorMessage(err)}`);
      return;
    }
    // Retargeting cannot bump the generation while in motion, so only
    // dispose() can make this stale.
    if (this.stale(gen)) return;
  }

  // -------------------------------------------------------------------------
  // Hyperspace (OCCLUDE)
  // -------------------------------------------------------------------------

  private enterHyperspace(): void {
    const scale = this.reducedMotion ? this.timings.reducedMotionScale : 1;
    this.phase = 'hyperspace';
    this.phaseElapsedMs = 0;
    this.phaseDurationMs = Math.max(1, this.timings.hyperspaceMs * scale);
    this.phaseStartedAtMs = performance.now();
    this.emitPhase();
  }

  private startOcclusionHandoff(): void {
    this.occlusionStarted = true;
    const prepared = this.preparedTarget;
    if (!prepared) {
      // Unreachable: departure is gated on a prepared target. Defensive only.
      this.failFatal('Occlusion handoff found no prepared target');
      return;
    }

    const gen = this.generation;
    try {
      // Screen is dominated by the transition field: release the outgoing
      // scene-local heavy resources now (PRODUCT_UX §6 OCCLUDE).
      this.deps.callbacks.disposeActive();
    } catch (err) {
      this.emitError(
        `Outgoing disposal failed during handoff: ${errorMessage(err)}`,
        this.sourceId,
        gen,
        false
      );
    }
    this.sourceId = null;
    void this.activatePrepared(gen, prepared);
  }

  private async activatePrepared(gen: number, prepared: PreparedPhenomenon): Promise<void> {
    try {
      await this.deps.callbacks.activate(prepared, { reducedMotion: this.reducedMotion });
    } catch (err) {
      if (this.stale(gen)) return;
      this.failFatal(`Target activation failed: ${errorMessage(err)}`);
      return;
    }
    if (this.stale(gen)) {
      // Disposed mid-activation: tear down whatever was activated.
      this.deps.callbacks.disposePrepared(prepared);
      return;
    }
    this.handoffComplete = true;

    // Route commit point: the host persists history/public state here
    // (CA1-11 integration listens for this status event).
    this.emitStatus({
      kind: 'route-commit',
      message: `Arrived at ${prepared.module.descriptor.title}`,
      detailLabel: prepared.preset.displayName,
      fraction01: null,
      elapsedMs: 0,
      destinationId: prepared.preset.destinationId
    });

    // The frozen frame is obsolete once the target renders underneath.
    this.releaseSnapshot();
  }

  // -------------------------------------------------------------------------
  // Arriving
  // -------------------------------------------------------------------------

  private enterArriving(): void {
    const scale = this.reducedMotion ? this.timings.reducedMotionScale : 1;
    this.phase = 'arriving';
    this.phaseElapsedMs = 0;
    this.phaseDurationMs = Math.max(1, this.timings.arrivingMs * scale);
    this.phaseStartedAtMs = performance.now();
    this.emitPhase();
  }

  /**
   * Ease the camera from the departure transform to the preset arrival shot
   * across the arriving phase (CA1-08). Applied per-frame with a
   * deterministic easing; reduced motion snaps once instead (§7).
   */
  private applyArrivalRamp(p: number): void {
    const prepared = this.preparedTarget;
    if (!prepared) return;
    const targetPreset = prepared.preset.camera;

    if (this.reducedMotion) {
      if (!this.arrivalApplied) {
        this.deps.cameraRig.applyArrivalPreset(targetPreset, 0);
        this.arrivalApplied = true;
      }
      return;
    }

    const t = easeInOutCubic(p);
    const from = this.departureTransform ?? targetPreset;
    this.deps.cameraRig.applyArrivalPreset(
      interpolatePresets(from, targetPreset, t, this.tmpA, this.tmpB),
      0
    );
    if (p >= 1) this.arrivalApplied = true;
  }

  private completeTransition(): void {
    this.exitMotionQuality();
    this.deps.cameraRig.setControlsEnabled(true);
    this.releaseSnapshot();

    // Ownership of the activated module transferred to the host at activation.
    this.preparedTarget = null;
    this.minimumReady = false;
    this.departureTransform = null;
    this.error = null;
    this.travelSpeed = 0;
    this.lastOverlayOpacity = 0;
    this.phase = 'idle';
    this.phaseElapsedMs = 0;
    this.targetId = null;
    this.targetTitle = '';
    this.emitPhase();

    // Latest-wins queue: begin the newest selection requested mid-flight.
    const queued = this.pendingRequest;
    this.pendingRequest = null;
    if (queued) this.requestTransition(queued);
  }

  // -------------------------------------------------------------------------
  // Overlay envelopes
  // -------------------------------------------------------------------------

  /**
   * Drive the pass uniforms for the current phase position.
   *
   * Streaks path: opacity/intensity/speed ramp in during DEPART, plateau
   * through OCCLUDE, decelerate and fade out through ARRIVE ("speed ramp
   * in/out"). Crossfade path (reduced motion): same envelope shape applied to
   * a flat dim field — no streaking, no simulated acceleration (§7).
   */
  private applyOverlayEnvelope(p: number, rampIn: boolean): void {
    const pass = this.ensurePass();
    let alpha: number;
    let intensity: number;
    let speed: number;

    if (rampIn && this.phase === 'outgoing') {
      alpha = easeInCubic(p);
      intensity = easeInCubic(p);
      speed = PEAK_TRAVEL_SPEED * easeInOutSine(p);
    } else if (this.phase === 'hyperspace') {
      alpha = 1;
      intensity = 1;
      speed = PEAK_TRAVEL_SPEED;
    } else {
      // arriving: decelerate and decay.
      const decay = easeInOutSine(p);
      alpha = 1 - decay;
      intensity = 1 - decay;
      speed = PEAK_TRAVEL_SPEED * (1 - decay);
    }

    if (this.style === 'crossfade') {
      speed = 0;
      intensity = 0;
    }

    this.travelSpeed = speed;
    this.lastOverlayOpacity = clamp01(alpha);
    pass.setIntensity(intensity);
    pass.setAlpha(alpha);
  }

  private renderOverlay(dtSeconds: number): void {
    const pass = this.pass;
    if (!pass) return;
    const renderer = this.deps.getRenderer();
    if (!renderer) return; // pre-init or device loss: hold last valid overlay
    pass.advance(dtSeconds, this.travelSpeed);
    pass.render(renderer);
  }

  // -------------------------------------------------------------------------
  // Quality policy (CA1-06)
  // -------------------------------------------------------------------------

  /**
   * Built-in TRANSITION quality policy: force the governor's quality mode to
   * 'low' for the duration of motion, restore `baseQualityMode` afterwards.
   * The governor's own hysteresis then walks the tier back up gradually
   * instead of jumping straight to high tiers (PRODUCT_UX §6 ARRIVE).
   */
  private enterMotionQuality(): void {
    if (this.motionQualityActive) return;
    this.motionQualityActive = true;
    this.deps.governor.configure({ qualityMode: 'low' });
    this.deps.qualityHooks?.onMotionBegin();
  }

  private exitMotionQuality(): void {
    if (!this.motionQualityActive) return;
    this.motionQualityActive = false;
    this.deps.governor.configure({ qualityMode: this.baseQualityMode });
    this.deps.qualityHooks?.onMotionEnd();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private ensurePass(): HyperspacePass {
    if (!this.pass) {
      const rng = mulberry32(this.seed);
      this.pass = new HyperspacePass({ seed: Math.floor(rng() * 1e6) + 1 });
      // Track the offscreen target/material in the owned scope so repeated
      // navigation shows bounded resources in the debug inventory (CA0-09).
      this.scope.track(
        'renderTarget',
        this.pass,
        () => this.pass?.dispose(),
        this.pass.byteEstimate
      );
    }
    return this.pass;
  }

  private releaseSnapshot(): void {
    if (!this.outgoingSnapshot) return;
    this.deps.post.releaseSnapshot();
    this.outgoingSnapshot = null;
  }

  private resetToIdle(gen: number): void {
    if (this.disposed || gen !== this.generation) return;
    this.prepareAbort = null;
    this.phase = 'idle';
    this.phaseElapsedMs = 0;
    this.targetId = null;
    this.targetTitle = '';
    this.minimumReady = false;
    this.latestProgress = null;
    this.emitPhase();
  }

  /**
   * Catastrophic path: the active scene cannot be restored by the director
   * alone. Best-effort cleanup, fatal error event; the host owns recovery UI.
   */
  private failFatal(message: string): void {
    this.error = message;
    this.exitMotionQuality();
    try {
      this.deps.cameraRig.setControlsEnabled(true);
    } catch {
      // Rig already disposed — nothing further to restore.
    }
    this.releaseSnapshot();
    // Stop compositing the overlay immediately: nothing renders into it.
    this.travelSpeed = 0;
    this.lastOverlayOpacity = 0;
    this.phase = 'idle';
    this.phaseElapsedMs = 0;
    this.emitPhase();
    this.emitError(message, this.targetId, this.generation, true);
  }

  private stale(gen: number): boolean {
    return this.disposed || gen !== this.generation;
  }

  // -------------------------------------------------------------------------
  // Emitters
  // -------------------------------------------------------------------------

  private emitPhase(): void {
    const event: TransitionPhaseEvent = {
      phase: this.phase,
      generation: this.generation,
      sourceId: this.sourceId,
      targetId: this.targetId
    };
    for (const cb of Array.from(this.phaseListeners)) cb(event);
  }

  private emitProgress(event: TransitionProgressEvent): void {
    for (const cb of Array.from(this.progressListeners)) cb(event);
  }

  private emitStatus(event: TransitionStatusEvent): void {
    for (const cb of Array.from(this.statusListeners)) cb(event);
  }

  private emitError(
    message: string,
    destinationId: DestinationId | null,
    generation: number,
    fatal: boolean
  ): void {
    const event: TransitionErrorEvent = { message, destinationId, generation, fatal };
    for (const cb of Array.from(this.errorListeners)) cb(event);
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  /**
   * Release everything the director owns. In-flight continuations are
   * invalidated via a generation bump; a prepared-but-unactivated target is
   * disposed here, while an already-activated module belongs to the host.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;

    this.prepareAbort?.abort();
    this.prepareAbort = null;
    this.pendingRequest = null;

    if (this.preparedTarget && !this.handoffComplete) {
      this.deps.callbacks.disposePrepared(this.preparedTarget);
    }
    this.preparedTarget = null;

    if (this.motionQualityActive) {
      this.exitMotionQuality();
    }
    try {
      this.deps.cameraRig.setControlsEnabled(true);
    } catch {
      // Rig already disposed.
    }
    this.releaseSnapshot();

    this.pass?.dispose();
    this.pass = null;
    this.scope.disposeAll();

    this.phaseListeners.clear();
    this.progressListeners.clear();
    this.statusListeners.clear();
    this.errorListeners.clear();
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (deterministic, unit-testable)
// ---------------------------------------------------------------------------

/** mulberry32 PRNG — seeded, deterministic, no Math.random anywhere. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Interpolate two arrival presets with an eased parameter: positions/targets
 * lerp linearly, up vectors are renormalized after lerp, fov blends when both
 * sides define it. Uses caller-provided scratch vectors to stay
 * allocation-free per frame.
 */
function interpolatePresets(
  from: CameraArrivalPreset,
  to: CameraArrivalPreset,
  t: number,
  scratchA: Vector3,
  scratchB: Vector3
): CameraArrivalPreset {
  const position = [
    from.position[0] + (to.position[0] - from.position[0]) * t,
    from.position[1] + (to.position[1] - from.position[1]) * t,
    from.position[2] + (to.position[2] - from.position[2]) * t
  ] as [number, number, number];

  const target = [
    from.target[0] + (to.target[0] - from.target[0]) * t,
    from.target[1] + (to.target[1] - from.target[1]) * t,
    from.target[2] + (to.target[2] - from.target[2]) * t
  ] as [number, number, number];

  const upFrom = from.up ?? [0, 1, 0];
  const upTo = to.up ?? [0, 1, 0];
  scratchA.set(upFrom[0], upFrom[1], upFrom[2]);
  scratchB.set(upTo[0], upTo[1], upTo[2]);
  scratchA.lerp(scratchB, t);
  if (scratchA.lengthSq() < 1e-10) scratchA.set(0, 1, 0);
  else scratchA.normalize();
  const up = [scratchA.x, scratchA.y, scratchA.z] as [number, number, number];

  let fovDeg: number | undefined;
  if (from.fovDeg !== undefined && to.fovDeg !== undefined) {
    fovDeg = from.fovDeg + (to.fovDeg - from.fovDeg) * t;
  } else if (to.fovDeg !== undefined) {
    fovDeg = to.fovDeg;
  } else if (from.fovDeg !== undefined) {
    fovDeg = from.fovDeg;
  }

  return fovDeg === undefined ? { position, target, up } : { position, target, up, fovDeg };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
