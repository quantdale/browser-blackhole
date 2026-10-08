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
  TransitionError,
  TransitionErrorCode,
  TransitionPhase,
  TransitionPublicState,
  TransitionRuntimeState
} from './types';
import { TRANSITION_ERROR_CODES } from './types.js';
import type { ResourceManager } from './ResourceManager';
import { buildTransitionFailureMessage } from './hostStatus.js';

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
   * Seconds-without-a-progress-event bound on an outstanding preparation
   * (atlas-error-reporting: a stalled preparation SHALL terminate). Unlike
   * `slowLoadThresholdMs` this is not a status cadence — expiry aborts the
   * preparation and publishes a recoverable failure. Must stay well above
   * the slow-load threshold: a preparation that keeps reporting progress is
   * never aborted by it. Defaults to 10x the slow-load threshold.
   */
  stallThresholdMs?: number;
  /**
   * Resolves the quality mode restored in the governor when motion ends
   * (CA1-06, quality-ladder-resolution-integrity D2). Read at motion END —
   * not captured at construction — so a selection made while the transition
   * runs wins. Defaults to 'auto'.
   */
  resolveBaseQualityMode?: () => QualityMode;
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
  /** Stable machine-readable code mirrored into the public state. */
  code: TransitionErrorCode;
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
  private readonly stallThresholdMs: number;
  private readonly resolveBaseQualityMode: () => QualityMode;
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
  /**
   * The published error. Set wherever a transition error is emitted so the
   * shell can render a failure without reading director internals
   * (E-01/E-02); cleared by a successful completion and a new request.
   */
  private publicError: TransitionError | null = null;
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
  /**
   * Wall-clock timestamp of the last accepted PROGRESS EVENT. A progress event
   * is one of: the prepare promise settling; a `reportProgress` report whose
   * finite fraction is the first report or strictly greater than the last
   * accepted one; response headers arriving for the outstanding fetch; or an
   * increase in received response bytes (atlas-error-reporting §stall).
   * Elapsed time alone is deliberately NOT a progress event.
   */
  private lastProgressEventAtMs = 0;
  /**
   * Generation of the preparation the director itself stalled. A stall is
   * director-initiated (not a user cancel), so the resulting abort must
   * publish a recoverable failure rather than reset silently.
   */
  private stalledGeneration: number | null = null;
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
    // A stall must be far more permissive than the slow-load STATUS cadence:
    // the slow-load event fires on a healthy prepare, so gating an abort on it
    // would kill every normal preparation. 10x is the documented minimum.
    const stall = options.stallThresholdMs ?? this.slowLoadThresholdMs * 10;
    if (!(stall > this.slowLoadThresholdMs)) {
      throw new Error(
        `TransitionDirector: stallThresholdMs (${stall}) must exceed slowLoadThresholdMs (${this.slowLoadThresholdMs})`
      );
    }
    this.stallThresholdMs = stall;
    this.resolveBaseQualityMode = options.resolveBaseQualityMode ?? (() => 'auto');
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
      destinationOccluded: this.phase === 'hyperspace',
      // Published so the shell can render a failure without reaching into
      // director internals (E-01). Event-only delivery is not enough: an event
      // fires once and is not replayed on a panel rebuild.
      error: this.publicError
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
    // A new attempt supersedes any published failure: the banner must not
    // outlive the request that replaced it (atlas-error-reporting).
    this.publicError = null;
    this.stalledGeneration = null;

    let resolved: { descriptor: PhenomenonDescriptor; preset: PresetDescriptor };
    try {
      resolved = this.deps.callbacks.resolveTarget(request.destinationId, request.presetId);
    } catch (err) {
      const message = `Failed to resolve destination '${request.destinationId}': ${errorMessage(err)}`;
      this.emitError({
        message,
        displayMessage: buildTransitionFailureMessage({
          code: TRANSITION_ERROR_CODES.TRANSITION_RESOLVE_FAILED,
          destinationTitle: request.destinationId,
          fatal: false
        }),
        destinationId: request.destinationId,
        fatal: false,
        code: TRANSITION_ERROR_CODES.TRANSITION_RESOLVE_FAILED
      });
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
    // The stall clock is wall-clock (an outstanding fetch does not care about
    // our frame cadence) and starts at the first PROGRESS EVENT, which is the
    // start report every production prepare path emits before the stall gate
    // can apply to it (atlas-error-reporting).
    this.lastProgressEventAtMs = performance.now();
    this.stalledGeneration = null;
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
        this.checkPrepareStall();
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
      this.stalledGeneration = null;
      this.beginDeparture(gen);
    } catch (err) {
      if (this.stale(gen)) return; // superseded attempt owns the machine now
      if (controller.signal.aborted) {
        // The director itself stalled this attempt: expiry of the stall window
        // is a FAILURE the user must see and be able to retry, not a silent
        // reset (atlas-error-reporting: a stalled preparation terminates in a
        // user-visible failure with a recovery action).
        if (this.stalledGeneration === gen) {
          const message = `Preparation of '${descriptor.id}' was stopped: no progress event for ${Math.round(this.stallThresholdMs)} ms`;
          this.emitError({
            message,
            displayMessage: buildTransitionFailureMessage({
              code: TRANSITION_ERROR_CODES.TRANSITION_STALLED,
              destinationTitle: this.targetTitle || descriptor.id,
              fatal: false,
              stallThresholdMs: this.stallThresholdMs
            }),
            destinationId: descriptor.id,
            fatal: false,
            code: TRANSITION_ERROR_CODES.TRANSITION_STALLED
          });
          this.stalledGeneration = null;
        }
        this.resetToIdle(gen);
        return;
      }
      const message = `Preparation of '${descriptor.id}' failed: ${errorMessage(err)}`;
      this.emitError({
        message,
        displayMessage: buildTransitionFailureMessage({
          code: TRANSITION_ERROR_CODES.TRANSITION_PREPARE_FAILED,
          destinationTitle: this.targetTitle || descriptor.id,
          fatal: false
        }),
        destinationId: descriptor.id,
        fatal: false,
        code: TRANSITION_ERROR_CODES.TRANSITION_PREPARE_FAILED
      });
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
    // A progress EVENT is the first report, or a strictly increased FINITE
    // fraction. A repeated or non-finite fraction is a label change and is not
    // progress (atlas-error-reporting): it must not re-arm the stall clock.
    const fraction = clamp01(fraction01);
    const previous = this.latestProgress?.fraction01;
    const isProgressEvent =
      Number.isFinite(fraction01) && (previous === undefined || fraction > previous);
    if (isProgressEvent) {
      this.lastProgressEventAtMs = performance.now();
    }
    this.latestProgress = { fraction01: fraction, label: label ?? null };
    this.emitProgress({
      destinationId,
      fraction01: fraction,
      label: label ?? null,
      generation: gen
    });
  }

  /**
   * Stall gate: expiry of the stall window aborts the outstanding preparation
   * through the SAME AbortController path a retarget uses, so every existing
   * stale/abort guard runs unchanged. Only a preparation with no progress event
   * for the whole window is aborted — one that keeps reporting progress is never
   * aborted, however long it runs.
writeFileSync(TARGET, s, 'utf8');
   * Why this cannot misfire on a slow-but-healthy synchronous build: the gate is
   * evaluated from `update(dt)`, which only runs between awaits, so a genuinely
   * long step is not observed as an elapsed gap — the measurement exists
   * precisely to catch an await that never resumes. Every production prepare
   * path also reports progress before each of its steps (verified across all
   * eight destinations), so an outstanding request is the only condition that
   * can leave the window empty.
   */
  private checkPrepareStall(): void {
    if (this.phase !== 'preparing') return;
    if (this.prepareAbort === null || this.prepareAbort.signal.aborted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastProgressEventAtMs < this.stallThresholdMs) return;
    // Record the generation BEFORE aborting so runPrepare's catch can tell a
    // director-initiated stall from a user cancel and publish the failure.
    this.stalledGeneration = this.generation;
    this.emitStatus({
      kind: 'slow-load',
      message: `Preparing ${this.targetTitle}… stopped after no progress for ${Math.round(this.stallThresholdMs)} ms`,
      detailLabel: this.latestProgress?.label ?? null,
      fraction01: this.latestProgress?.fraction01 ?? null,
      elapsedMs: this.prepareElapsedMs,
      destinationId: this.targetId
    });
    this.prepareAbort.abort();
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
      this.failFatal({
        message: `Outgoing scene exit failed: ${errorMessage(err)}`,
        code: TRANSITION_ERROR_CODES.TRANSITION_EXIT_FAILED
      });
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
      this.failFatal({
        message: 'Occlusion handoff found no prepared target',
        code: TRANSITION_ERROR_CODES.TRANSITION_HANDOFF_FAILED
      });
      return;
    }

    const gen = this.generation;
    try {
      // Screen is dominated by the transition field: release the outgoing
      // scene-local heavy resources now (PRODUCT_UX §6 OCCLUDE).
      this.deps.callbacks.disposeActive();
    } catch (err) {
      const message = `Outgoing disposal failed during handoff: ${errorMessage(err)}`;
      this.emitError({
        message,
        displayMessage: buildTransitionFailureMessage({
          code: TRANSITION_ERROR_CODES.TRANSITION_DISPOSAL_FAILED,
          destinationTitle: this.targetTitle || this.sourceId || 'the previous scene',
          fatal: false
        }),
        destinationId: this.sourceId,
        fatal: false,
        code: TRANSITION_ERROR_CODES.TRANSITION_DISPOSAL_FAILED
      });
    }
    this.sourceId = null;
    void this.activatePrepared(gen, prepared);
  }

  private async activatePrepared(gen: number, prepared: PreparedPhenomenon): Promise<void> {
    try {
      await this.deps.callbacks.activate(prepared, { reducedMotion: this.reducedMotion });
    } catch (err) {
      if (this.stale(gen)) return;
      this.failFatal({
        message: `Target activation failed: ${errorMessage(err)}`,
        code: TRANSITION_ERROR_CODES.TRANSITION_ACTIVATION_FAILED
      });
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
    // A successful arrival clears any previously published failure
    // (atlas-error-reporting: a successful transition clears a previous error).
    this.publicError = null;
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
   * 'low' for the duration of motion, restore the mode resolved at this very
   * moment afterwards (so a user selection made mid-transition survives,
   * quality-ladder-resolution-integrity A-02/D2). The governor's own
   * hysteresis then walks the tier back up gradually instead of jumping
   * straight to high tiers (PRODUCT_UX §6 ARRIVE).
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
    this.deps.governor.configure({ qualityMode: this.resolveBaseQualityMode() });
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
  private failFatal(error: { message: string; code: TransitionErrorCode }): void {
    this.emitError({
      message: error.message,
      displayMessage: buildTransitionFailureMessage({
        code: error.code,
        destinationTitle: this.targetTitle || this.targetId || 'the destination',
        fatal: true
      }),
      destinationId: this.targetId,
      fatal: true,
      code: error.code
    });
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

  /**
   * Single publish point for a transition error. `message` is the technical
   * detail (console channel); `displayMessage` is authored copy for the
   * user-visible surface (docs/FAILURE_RECOVERY.md §3 forbids dumping loader
   * strings or stack traces into ordinary UI). The code is stable and
   * testable; both strings may evolve.
   */
  private emitError(options: {
    message: string;
    displayMessage: string;
    destinationId: DestinationId | null;
    fatal: boolean;
    code: TransitionErrorCode;
  }): void {
    this.error = options.message;
    this.publicError = {
      code: options.code,
      message: options.displayMessage,
      destinationId: options.destinationId,
      fatal: options.fatal
    };
    const event: TransitionErrorEvent = {
      message: options.message,
      destinationId: options.destinationId,
      generation: this.generation,
      fatal: options.fatal,
      code: options.code
    };
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
