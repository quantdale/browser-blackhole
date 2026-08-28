/**
 * CosmicAtlasHost — composition root of the Cosmic Atlas application shell
 * (CA0-02/CA0-03/CA0-07/CA0-09 core).
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §4 (module lifecycle ownership),
 *   §6 (shared renderer kernel + services), §7 (frame lifecycle), §9 (public
 *   state), §11 (transition orchestration boundary).
 * - docs/cosmic-atlas/DECISIONS.md CA-ADR-002 (one heavy destination),
 *   CA-ADR-003 (mandatory lifecycle), CA-ADR-013 (black-hole independence —
 *   the host adapts around destinations, never into their physics),
 *   CA-ADR-015 (global governor).
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §4 (transition runtime), §14
 *   (history semantics via NavigationController/routes.js).
 * - docs/cosmic-atlas/WORK_PACKETS.md CA0-02/03/07/09.
 *
 * Ownership notes:
 * - The kernel brackets every orchestrated frame with
 *   governor.beginFrame()/endFrame() internally (SharedRendererKernel.renderFrame),
 *   so the host deliberately does NOT call them again — double-bracketing
 *   would corrupt the FPS EMA with ~0 ms samples.
 * - `IVolumeService` is served by the real VolumeService
 *   (src/renderer/shared/VolumeService.ts) since CA2-05 landed; destinations
 *   create volumes through HostServices.volumes.
 * - `SharedPost` requires a live renderer at construction while the kernel
 *   creates that renderer during init(); `DeferredSharedPost` below is the
 *   host-local gluon that forwards calls once the inner instance exists.
 */

import { PerspectiveCamera } from 'three/webgpu';
import type { Texture } from 'three';

import { CameraRig } from '../renderer/shared/CameraRig.js';
import { FieldLineService } from '../renderer/shared/FieldLineService.js';
import { LensingService } from '../renderer/shared/LensingService.js';
import { ParticleService } from '../renderer/shared/ParticleService.js';
import { RibbonService } from '../renderer/shared/RibbonService.js';
import { SharedPost } from '../renderer/shared/SharedPost.js';
import {
  SharedRendererKernel,
  type SharedRendererKernelOptions
} from '../renderer/SharedRendererKernel.js';
import { TrajectoryService } from '../renderer/shared/TrajectoryService.js';
import { VolumeService } from '../renderer/shared/VolumeService.js';
import { NEUTRON_STAR_PRESETS } from '../phenomena/neutron-star/presets.js';
import { collectInventory } from './debugInventory.js';
import type { DebugInventoryView } from './debugInventory.js';
import { PerformanceGovernor } from './governor.js';
import {
  BLOOM_STRENGTH_RANGE,
  EXPOSURE_RANGE,
  RENDER_SCALE_OVERRIDE_RANGE,
  TONE_MAPPING_VALUES
} from './atlasState.js';
import { InitStatusTracker } from './hostStatus.js';
import { NavigationController } from './navigation.js';
import type { NavigationIntent } from './navigation.js';
import { ResourceManager } from './ResourceManager.js';
import { TimeController } from './TimeController.js';
import { TransitionDirector } from './TransitionDirector.js';
import type { TransitionPrepareRequest } from './TransitionDirector.js';
import { TRAJECTORY_BACKEND_VALUES, type TrajectoryBackendPreference } from './trajectoryPolicy.js';
import type {
  BackendInfo,
  CosmicAtlasStateV1,
  ExperienceMode,
  FrameContext,
  FramePlan,
  FrameTimeInfo,
  HostServices,
  IParticleService,
  FrameInvalidationTelemetry,
  FrameWorkTelemetry,
  InvalidationReasonMask,
  InvalidationReasonName,
  ISharedPost,
  PresetDisplayState,
  PreparedPhenomenon,
  PhenomenonDescriptor,
  PresetDescriptor,
  RenderContext,
  RendererLike,
  ResourceScope,
  VersionedDestinationState
} from './types.js';
import {
  describeInvalidationReasons,
  INVALIDATION_REASON,
  INVALIDATION_REASON_NAMES
} from './types.js';
import { DestinationRegistry } from './registry.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const DEFAULT_FOV_DEG = 60;
const CAMERA_NEAR = 0.05;
const CAMERA_FAR = 5000;
const DEFAULT_DPR_CAP = 2;
/** Arrival-camera ease used on plain activations (transitions ramp their own). */
const ARRIVAL_ANIMATE_SECONDS = 0.9;
/** Single-frame dt clamp; larger deltas (tab switches) advance deterministically. */
const MAX_FRAME_DT_SECONDS = 0.25;
/** Fallback CSS size when the canvas is not laid out yet. */
const FALLBACK_CSS_WIDTH = 1280;
const FALLBACK_CSS_HEIGHT = 720;

/**
 * Display-domain defaults applied when the user switches experience mode
 * (campaign §5). These are PRESENTATION values only — they never touch
 * physics/model state. Scientific deliberately disables bloom so nothing
 * scientific can require it.
 */
const EXPERIENCE_VISUAL_DEFAULTS: Record<
  ExperienceMode,
  Required<Omit<PresetDisplayState, never>>
> = {
  scientific: { exposure: 1, toneMapping: 'aces-filmic', bloomEnabled: false, bloomStrength: 0 },
  cinematic: { exposure: 1.1, toneMapping: 'aces-filmic', bloomEnabled: true, bloomStrength: 0.6 },
  // Debug changes visibility surfaces, not the display chain.
  debug: { exposure: 1, toneMapping: 'aces-filmic', bloomEnabled: false, bloomStrength: 0 }
};

// ---------------------------------------------------------------------------
// Host-local gluons
// ---------------------------------------------------------------------------

type ToneMappingMode = CosmicAtlasStateV1['sharedVisual']['toneMapping'];

/**
 * ISharedPost front-end that tolerates "renderer not created yet": every call
 * forwards to the inner SharedPost once `attach()` runs (right after
 * kernel.init), and degrades honestly (null / stored settings) before that.
 */
class DeferredSharedPost implements ISharedPost {
  private inner: SharedPost | null = null;
  private pendingSize: { widthPx: number; heightPx: number; renderScale: number } | null = null;
  private exposureValue = 1;
  private bloomEnabledValue = true;
  private bloomStrengthValue = 0.5;
  private toneMappingValue: ToneMappingMode = 'aces-filmic';

  attach(renderer: RendererLike, scope: ResourceScope): void {
    if (this.inner !== null) return;
    this.inner = new SharedPost({ renderer, scope });
    if (this.pendingSize !== null) {
      const size = this.pendingSize;
      this.pendingSize = null;
      this.inner.ensureSize(size.widthPx, size.heightPx, size.renderScale);
    }
    this.inner.setExposure(this.exposureValue);
    this.inner.setBloom(this.bloomEnabledValue, this.bloomStrengthValue);
    this.inner.setToneMapping(this.toneMappingValue);
  }

  ensureSize(widthPx: number, heightPx: number, renderScale: number): void {
    if (this.inner !== null) this.inner.ensureSize(widthPx, heightPx, renderScale);
    else this.pendingSize = { widthPx, heightPx, renderScale };
  }

  getHdrTarget(): Texture | null {
    return this.inner !== null ? this.inner.getHdrTarget() : null;
  }

  setExposure(exposure: number): void {
    this.exposureValue = exposure;
    this.inner?.setExposure(exposure);
  }

  setBloom(enabled: boolean, strength: number): void {
    this.bloomEnabledValue = enabled;
    this.bloomStrengthValue = strength;
    this.inner?.setBloom(enabled, strength);
  }

  setToneMapping(mode: ToneMappingMode): void {
    this.toneMappingValue = mode;
    this.inner?.setToneMapping(mode);
  }

  present(transitionOverlay: Texture | null, transitionOpacity: number): void {
    this.inner?.present(transitionOverlay, transitionOpacity);
  }

  captureSnapshot(): Texture | null {
    return this.inner !== null ? this.inner.captureSnapshot() : null;
  }

  releaseSnapshot(): void {
    this.inner?.releaseSnapshot();
  }

  dispose(): void {
    this.inner?.dispose();
    this.inner = null;
  }
}

/**
 * Honest placeholder removed: VolumeService (src/renderer/shared/
 * VolumeService.ts) now provides the CA2-05 bounding-volume raymarch
 * foundation; destinations create volumes through HostServices.volumes.
 */

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export interface CosmicAtlasHostOptions {
  /**
   * Reduced-motion preference. When omitted, the host reads
   * `prefers-reduced-motion` from the media query (browser environments only).
   */
  reducedMotion?: boolean;
  /**
   * Dev/test-only backend override forwarded to the shared kernel; the
   * `?backend=` URL parsing stays in the app shell. Undefined = the documented
   * WebGPU-preferred-with-WebGL2-fallback policy.
   */
  forcedBackend?: 'webgpu' | 'webgl2';
}

/** Stage flags for a frame that never reached the kernel. */
const NO_FRAME_WORK: FrameWorkTelemetry = {
  destinationUpdated: false,
  destinationDrawn: false,
  postPresented: false
};

export class CosmicAtlasHost {
  readonly canvas: HTMLCanvasElement;
  readonly status = new InitStatusTracker();
  readonly resources = new ResourceManager();
  readonly governor = new PerformanceGovernor();
  readonly time = new TimeController();
  readonly registry = new DestinationRegistry();
  readonly cameraRig: CameraRig;
  readonly camera: PerspectiveCamera;
  readonly post = new DeferredSharedPost();
  readonly navigation: NavigationController;
  readonly kernel: SharedRendererKernel;
  readonly director: TransitionDirector;
  readonly services: HostServices;

  private readonly postScope: ResourceScope;
  private particlesService: IParticleService;
  private readonly volumesService = new VolumeService();
  private readonly ribbonService = new RibbonService();
  private readonly trajectoryService = new TrajectoryService();
  private readonly fieldLineService = new FieldLineService();
  private readonly lensingService = new LensingService();

  private activePrepared: PreparedPhenomenon | null = null;

  /**
   * Last-known normalized destination state per destination id (CA6 control-
   * persistence generalization). Written through whenever a module serializes
   * share state or accepts canonical controls; merged back over the registry
   * preset at resolveTarget so revisits (back/forward, re-navigation) restore
   * supported controls instead of silently resetting them. Scoped to the
   * preset the state came from: switching presets resets to that preset's
   * documented defaults.
   */
  private readonly destinationStateCache = new Map<
    string,
    { presetId: string; schemaVersion: number; state: Record<string, unknown> }
  >();
  private activeSeed = 1;
  private pendingPrepares = 0;
  private rendererGeneration = 0;
  private elapsedSeconds = 0;
  private lastFrameDt = 0;
  private reducedMotionValue: boolean;
  private initPromise: Promise<void> | null = null;
  private disposed = false;
  private unsubscribeDeviceLost: (() => void) | null = null;
  /** M11-03: set when the rendering device is lost (terminal for the session). */
  private fatalDeviceLoss = false;
  private readonly fatalCallbacks = new Set<() => void>();

  // Visual presentation state mirrored for the public snapshot; applied to the
  // shared post through the deferred front-end.
  private exposureValue = 1;
  private bloomEnabledValue = true;
  private bloomStrengthValue = 0.5;
  private toneMappingValue: ToneMappingMode = 'aces-filmic';

  // M5 canonical product state.
  private experienceModeValue: ExperienceMode = 'scientific';
  private diagnosticsEnabledValue = false;
  /** Manual render-scale override (null = governor-managed dynamic resolution). */
  private renderScaleOverrideValue: number | null = null;
  /** M8-09 canonical trajectory-backend preference (rendering domain). */
  private trajectoryBackendValue: TrajectoryBackendPreference = 'auto';
  /** True while the §13 interaction throttle has bloom suspended. */
  private bloomThrottleActive = false;

  // -- WS1 frame invalidation (whole-atlas performance campaign) -------------
  /**
   * Set while the document appears to be unloading; silences teardown-caused
   * transition errors. Cleared by the next transition request — see
   * {@link requestTransition} for why it must not latch.
   */
  private tearingDown = false;

  /**
   * WS0/tasks.md §1 frame-invalidation telemetry. Counters are cumulative so
   * a benchmark or test can difference two snapshots; they are the evidence
   * that WS1's work elimination is real, independent of any timing measurement.
   */
  private framesObservedValue = 0;
  private framesRenderedValue = 0;
  private lastReasonsValue: InvalidationReasonMask = 0;
  private readonly reasonCountsValue: Record<InvalidationReasonName, number> = Object.fromEntries(
    INVALIDATION_REASON_NAMES.map((name) => [name, 0])
  ) as Record<InvalidationReasonName, number>;

  /** Reasons accumulated by `invalidate()` since the last consumed frame. */
  private pendingInvalidationMask: InvalidationReasonMask = 0;
  /** TEST-ONLY: forces every frame to render (benchmark steady-state sampling). */
  private forceContinuousRenderValue = false;
  /** Whether the most recent `frame()` call actually rendered (debug/diagnostics). */
  private lastFrameRenderedValue = true;
  private unsubscribeTierChanged: (() => void) | null = null;

  /** Stable per-frame destination closures (no per-frame allocation). */
  private readonly frameDestination = {
    update: (ctx: FrameContext): void => {
      this.activePrepared?.module.update(ctx);
    },
    render: (ctx: RenderContext): void => {
      this.activePrepared?.module.render(ctx);
    }
  };

  constructor(canvas: HTMLCanvasElement, options: CosmicAtlasHostOptions = {}) {
    this.canvas = canvas;
    this.reducedMotionValue = options.reducedMotion ?? prefersReducedMotion();

    this.cameraRig = new CameraRig({ canvas });
    this.camera = new PerspectiveCamera(DEFAULT_FOV_DEG, 1, CAMERA_NEAR, CAMERA_FAR);
    this.cameraRig.attach(this.camera);
    this.cameraRig.setReducedMotion(this.reducedMotionValue);

    this.postScope = this.resources.createScope('shared-post');
    // Pre-init particle service runs the documented CPU path; replaced with a
    // renderer-bound instance once the backend is known (see init()).
    this.particlesService = new ParticleService({
      computeAvailable: detectComputeAvailable(),
      renderer: null
    });

    this.navigation = new NavigationController(this.registry);

    const kernelOptions: SharedRendererKernelOptions = {
      governor: this.governor,
      post: this.post,
      getTimeInfo: () => this.getTimeInfo(),
      getQuality: () => this.governor.currentTier,
      getServices: () => this.services,
      getCamera: () => this.camera,
      getTrajectoryBackend: () => this.trajectoryBackendValue,
      dprCap: DEFAULT_DPR_CAP
    };
    if (options.forcedBackend !== undefined) {
      kernelOptions.forcedBackend = options.forcedBackend;
    }
    this.kernel = new SharedRendererKernel(kernelOptions);

    this.services = this.buildServices();

    this.director = new TransitionDirector(
      {
        resources: this.resources,
        post: this.post,
        governor: this.governor,
        cameraRig: this.cameraRig,
        getRenderer: () => this.kernel.renderer,
        callbacks: {
          getActiveDestination: () => this.activePrepared?.module.descriptor.id ?? null,
          resolveTarget: (destinationId, presetId) => this.resolveTarget(destinationId, presetId),
          prepare: (request) => this.prepareTarget(request),
          activate: (prepared, ctx) => this.activateTarget(prepared, ctx.reducedMotion),
          exitActive: (ctx) => this.exitActive(ctx.freezeForTransition),
          disposeActive: () => this.disposeActive(),
          disposePrepared: (prepared) => this.disposePrepared(prepared)
        }
      },
      { baseQualityMode: 'auto' }
    );

    // Route commit point (STATE_AND_ROUTES §14): canonicalize the URL with a
    // history REPLACEMENT when the director hands off the activated target.
    this.director.onStatus((event) => {
      if (event.kind === 'route-commit' && event.destinationId !== null) {
        const selection = this.navigation.getSelection();
        this.navigation.commitRoute(event.destinationId, selection?.presetId);
      }
    });
    this.director.onError((event) => {
      // A page that is unloading cancels its own in-flight module fetches;
      // reporting that as a preparation failure would be untrue (see
      // abandonPendingTransition).
      if (this.tearingDown) return;
      console.error(
        `[CosmicAtlasHost] transition error${event.fatal ? ' (fatal)' : ''}: ${event.message}`
      );
    });

    // UI/host requests -> director (latest-wins inside the director).
    this.navigation.onIntent((intent) => {
      this.requestTransition(intent);
    });

    // WS1: a tier change is a real render-resolution change even while the
    // scene is otherwise static (paused, camera settled) — it must wake the
    // frame loop for at least one frame.
    this.unsubscribeTierChanged = this.governor.onTierChanged(() => {
      this.invalidate(INVALIDATION_REASON.QUALITY_CHANGED);
    });

    this.unsubscribeDeviceLost = this.kernel.onDeviceLost(() => {
      this.rendererGeneration += 1;
      // M11-03: a lost device is TERMINAL for the session. The documented
      // product recovery strategy is "reload required": the renderer instance
      // is entangled with SharedPost/service state that cannot be swapped
      // invisibly, and a botched automatic re-init would corrupt state
      // silently — worse than an explicit, explained stop. Surface the
      // user-visible terminal state instead of a misleading READY.
      this.fatalDeviceLoss = true;
      for (const cb of [...this.fatalCallbacks]) {
        try {
          cb();
        } catch (error) {
          console.error('[CosmicAtlasHost] fatal-error listener threw:', error);
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Boot the shell through the documented init stages. Idempotent per success. */
  async init(): Promise<void> {
    if (this.initPromise !== null) return this.initPromise;
    this.initPromise = this.runInit();
    return this.initPromise;
  }

  private async runInit(): Promise<void> {
    try {
      this.status.begin('capabilities');
      // Capability probing happens inside kernel.init(); report it complete.
      this.status.setStageFraction(1);

      this.status.begin('renderer');
      const backend = await this.kernel.init(this.canvas);
      const renderer = this.kernel.renderer;
      if (renderer === null) {
        throw new Error('[CosmicAtlasHost] kernel.init() succeeded without a renderer.');
      }
      this.post.attach(renderer, this.postScope);
      this.wireParticles(backend);

      this.status.begin('services');
      this.handleResize(this.initialCssWidth(), this.initialCssHeight());
      this.status.setStageFraction(1);

      this.status.begin('registry');
      await this.registerDestinations();
      this.navigation.syncRoutingRegistries();
      this.navigation.attachHistory();
      // Deep link / redirect policy (§2/§14): validates and emits the first
      // navigation intent, which starts preparing the initial destination.
      this.navigation.applyInitialRoute();

      this.status.begin('ready');
    } catch (error) {
      const message = describeError(error);
      const code = message.includes('no render backend could be initialized')
        ? 'ENV_WEBGL2_UNAVAILABLE'
        : 'BOOT_UNSUPPORTED';
      try {
        this.status.fail(code, message);
      } catch {
        // Tracker already terminal; keep the original error propagating.
      }
      this.initPromise = null;
      throw error;
    }
  }

  /** Dynamically import destination metadata + factories (lazy heavy paths). */
  private async registerDestinations(): Promise<void> {
    const [
      diagnostic,
      blackHole,
      neutronStar,
      stellarExplosion,
      compactMerger,
      tidalDisruption,
      quasarAgn,
      blackHoleMerger,
      galaxyCollision
    ] = await Promise.all([
      import('./destinations/diagnosticDestination.js'),
      import('./destinations/blackHoleDescriptor.js'),
      import('../phenomena/neutron-star/descriptor.js'),
      import('../phenomena/stellar-explosion/presets.js'),
      import('../phenomena/compact-merger/presets.js'),
      import('../phenomena/tidal-disruption/presets.js'),
      import('../phenomena/quasar-agn/presets.js'),
      import('../phenomena/black-hole-merger/presets.js'),
      import('../phenomena/galaxy-collision/presets.js')
    ]);
    this.registry.register(diagnostic.diagnosticDescriptor, diagnostic.DIAGNOSTIC_PRESETS);
    this.registry.register(blackHole.blackHoleDescriptor, blackHole.BLACK_HOLE_PRESETS);
    this.registry.register(neutronStar.NEUTRON_STAR_DESCRIPTOR, NEUTRON_STAR_PRESETS);
    this.registry.register(
      stellarExplosion.STELLAR_EXPLOSION_DESCRIPTOR,
      stellarExplosion.STELLAR_EXPLOSION_PRESETS
    );
    this.registry.register(
      compactMerger.COMPACT_MERGER_DESCRIPTOR,
      compactMerger.COMPACT_MERGER_PRESETS
    );
    this.registry.register(
      tidalDisruption.TIDAL_DISRUPTION_DESCRIPTOR,
      tidalDisruption.TIDAL_DISRUPTION_PRESETS
    );
    this.registry.register(quasarAgn.QUASAR_AGN_DESCRIPTOR, quasarAgn.QUASAR_AGN_PRESETS);
    this.registry.register(
      blackHoleMerger.BLACK_HOLE_MERGER_DESCRIPTOR,
      blackHoleMerger.BLACK_HOLE_MERGER_PRESETS
    );
    this.registry.register(
      galaxyCollision.GALAXY_COLLISION_DESCRIPTOR,
      galaxyCollision.GALAXY_COLLISION_PRESETS
    );
  }

  private wireParticles(backend: BackendInfo): void {
    const previous = this.particlesService;
    this.particlesService = new ParticleService({
      computeAvailable: backend.api === 'webgpu',
      renderer: this.kernel.renderer
    });
    // Pre-init instance never created systems; dispose for hygiene.
    previous.dispose();
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  /**
   * Advance one frame: deterministic clock → rig → director envelopes →
   * orchestrated kernel render (which brackets governor begin/end itself and
   * composites the transition overlay over the destination scene).
   *
   * WS1 frame invalidation (openspec/changes/whole-atlas-performance-
   * optimization): the clock/rig/director state machines always advance —
   * required simulation/transition/camera-ease progress must never stall —
   * but the expensive destination update/render + post-present only run when
   * a render REASON exists (`INVALIDATION_REASON`) or the shared timeline is
   * currently playing (several destinations key continuous internal
   * integration to `!TimeController.paused` rather than the mapped UI phase
   * moving; see the type's doc comment). `opts.force` is the test-only
   * escape hatch backing `AtlasAppWindowHook.captureFrame()`.
   */
  frame(dtSeconds: number, opts?: { force?: boolean }): void {
    if (this.disposed || !this.status.ready) return;
    const dt = Number.isFinite(dtSeconds)
      ? Math.min(Math.max(dtSeconds, 0), MAX_FRAME_DT_SECONDS)
      : 0;
    this.lastFrameDt = dt;
    this.elapsedSeconds += dt;

    let reasons: InvalidationReasonMask = this.pendingInvalidationMask;
    this.pendingInvalidationMask = 0;
    if (opts?.force === true || this.forceContinuousRenderValue) {
      reasons |= INVALIDATION_REASON.FORCED_CAPTURE;
    }

    this.time.update(dt);
    if (this.time.consumeDirty()) reasons |= INVALIDATION_REASON.TIME_ADVANCED;

    if (this.cameraRig.update(dt)) reasons |= INVALIDATION_REASON.CAMERA_CHANGED;

    this.director.update(dt);
    if (this.applyBloomInteractionThrottle()) reasons |= INVALIDATION_REASON.POST_CHANGED;
    if (this.director.getPublicState().active) reasons |= INVALIDATION_REASON.TRANSITION_CHANGED;

    const shouldRender = reasons !== 0 || !this.time.paused;
    this.lastFrameRenderedValue = shouldRender;
    this.lastReasonsValue = reasons;
    this.framesObservedValue += 1;
    for (const name of INVALIDATION_REASON_NAMES) {
      if ((reasons & INVALIDATION_REASON[name]) !== 0) this.reasonCountsValue[name] += 1;
    }
    if (!shouldRender) return;

    const overlay = this.director.getOverlay();
    const transition = this.director.getPublicState();
    const plan: FramePlan = {
      destination: this.activePrepared !== null ? this.frameDestination : null,
      scene: this.activePrepared?.scene ?? null,
      // During the mathematically opaque hyperspace phase the destination may
      // still update for lifecycle/timeline correctness, but its pixels cannot
      // affect the presented image. The director owns this semantic decision;
      // the kernel only enforces it.
      destinationDrawSuppressed: transition.destinationOccluded,
      transitionOverlay: overlay.texture,
      transitionOpacity: overlay.opacity
    };
    // Count RENDERS, not dispatches: the kernel returns false when it is
    // disposed, the device is lost, or no renderer exists, and a counter that
    // silently included those would overstate the work actually done.
    if (this.kernel.renderFrame(plan)) this.framesRenderedValue += 1;
  }

  /**
   * Accumulate a render reason from anywhere in the host's public API
   * (control/resize/quality/visual/destination setters below). Consumed and
   * cleared by the next `frame()` call; safe to call between frames.
   */
  invalidate(reason: InvalidationReasonMask): void {
    this.pendingInvalidationMask |= reason;
  }

  /**
   * TEST-ONLY: forces every subsequent `frame()` call to render regardless of
   * invalidation state. Benchmark harnesses (scripts/bench-*.mjs) pin a
   * stationary, paused scene and sample many rAF deltas to measure steady-
   * state per-frame cost; WS1's on-demand skip would otherwise make that
   * measurement measure "nothing happened" instead of render cost. Not
   * reachable from production UI.
   */
  forceContinuousRenderForTest(enabled: boolean): void {
    this.forceContinuousRenderValue = enabled === true;
  }

  /** Whether the most recent `frame()` call actually rendered (diagnostics). */
  get lastFrameRendered(): boolean {
    return this.lastFrameRenderedValue;
  }

  /**
   * WS0/tasks.md §1 frame-invalidation telemetry. Cumulative counters plus a
   * description of the most recent frame. Difference two reads to measure how
   * much work an interaction actually cost — no timing is involved, so the
   * number means the same thing on every machine.
   */
  frameTelemetry(): FrameInvalidationTelemetry {
    return {
      lastReasons: this.lastReasonsValue,
      lastReasonNames: describeInvalidationReasons(this.lastReasonsValue),
      lastFrameRendered: this.lastFrameRenderedValue,
      // The kernel is never INVOKED on a host-skipped frame, so its flags
      // would still describe the last frame that did render — a snapshot
      // reporting `lastFrameRendered: false` alongside three true stage flags
      // contradicts itself, and this is exactly the field later workstreams
      // use as their work-elimination evidence.
      lastFrameWork: this.lastFrameRenderedValue ? this.kernel.lastFrameWork : NO_FRAME_WORK,
      framesObserved: this.framesObservedValue,
      framesRendered: this.framesRenderedValue,
      framesSkipped: this.framesObservedValue - this.framesRenderedValue,
      reasonCounts: { ...this.reasonCountsValue }
    };
  }

  /** Reset the cumulative frame counters (benchmark/test measurement window). */
  resetFrameTelemetry(): void {
    this.framesObservedValue = 0;
    this.framesRenderedValue = 0;
    for (const name of INVALIDATION_REASON_NAMES) this.reasonCountsValue[name] = 0;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Request travel; delegates to NavigationController → director. */
  navigate(destinationId: string, presetId?: string): NavigationIntent | null {
    return this.navigation.navigate(destinationId, presetId);
  }

  /**
   * Abandon any in-flight destination preparation.
   *
   * Called when the page itself is going away (`pagehide`). WS3 made every
   * destination implementation a lazily imported chunk, so a reload can now
   * interrupt a module fetch that is still in flight. Without this the
   * director reports the browser's cancelled request as "Preparation of 'x'
   * failed", which is not true — the preparation was abandoned, not broken —
   * and it leaves a spurious error in the console of a page that is already
   * unloading. Cancelling bumps the director's generation so the existing
   * silent stale-attempt path handles the rejection.
   *
   * `cancel()` alone is not sufficient: Firefox aborts the module load as
   * part of starting the navigation, and the rejection can reach the catch
   * before the generation bump does. The `tearingDown` flag therefore also
   * silences error REPORTING for the rest of this document's life.
   *
   * A GENUINE chunk-load failure (bad deploy, offline) is untouched: nothing
   * sets this flag while the page is staying, so it still surfaces as a real
   * transition error.
   */
  abandonPendingTransition(): void {
    this.tearingDown = true;
    this.director.cancel();
  }

  /** True once the rendering device has been lost (terminal for the session). */
  get isFatalDeviceLoss(): boolean {
    return this.fatalDeviceLoss;
  }

  /** Subscribe to fatal (session-terminal) renderer events. */
  onFatal(cb: () => void): () => void {
    this.fatalCallbacks.add(cb);
    if (this.fatalDeviceLoss) cb();
    return () => {
      this.fatalCallbacks.delete(cb);
    };
  }

  /**
   * TEST-ONLY (M11-03): inject a device loss through the kernel's PRODUCTION
   * loss path. Not reachable from production code; the device-loss browser
   * suite drives this so the injected fault exercises the real
   * notify -> subscriber -> terminal-state machine.
   */
  simulateDeviceLoss(): void {
    this.kernel.simulateDeviceLossForTest();
  }

  /** Forward window resizes; keeps the transition overlay at internal pixels. */
  handleResize(cssWidth: number, cssHeight: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight)) return;
    this.invalidate(INVALIDATION_REASON.RESIZE);
    const scale = this.effectiveRenderScale();
    this.kernel.handleResize(cssWidth, cssHeight, scale);

    // Mirror the kernel's pixel-ratio formula for the overlay target size.
    const dpr =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : 1;
    const ratio = Math.min(dpr > 0 ? dpr : 1, this.governor.getConfig().dprCap) * scale;
    this.director.resizeOverlay(
      Math.max(1, Math.round(cssWidth * ratio)),
      Math.max(1, Math.round(cssHeight * ratio))
    );
  }

  /** Manual override wins over governor-managed dynamic resolution. */
  private effectiveRenderScale(): number {
    return this.renderScaleOverrideValue ?? this.governor.renderScale;
  }

  /**
   * Campaign §13: protect the black-hole Low-tier budget from post cost.
   * When bloom is ON and the governor reports the LOW tier during active
   * interaction, bloom is temporarily suspended and restored once the camera
   * settles. Purely display-side; never touches destination state.
   */
  private applyBloomInteractionThrottle(): boolean {
    if (!this.bloomEnabledValue) return false;
    const throttled =
      this.governor.currentTier === 'low' && this.governor.activityMode === 'interaction';
    if (throttled === this.bloomThrottleActive) return false;
    this.bloomThrottleActive = throttled;
    this.post.setBloom(!throttled, throttled ? 0 : this.bloomStrengthValue);
    return true;
  }

  /** Reduced-motion preference forwarded to director + rig (CA-ADR-005). */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotionValue = reduced;
    this.director.setReducedMotion(reduced);
    this.cameraRig.setReducedMotion(reduced);
  }

  get reducedMotion(): boolean {
    return this.reducedMotionValue;
  }

  // -----------------------------------------------------------------------
  // M5 product state surface (experience / visual / rendering / debug)
  // -----------------------------------------------------------------------

  /**
   * Switch the product experience mode. Presentation defaults are applied
   * deterministically per mode (documented table above); physics/model state
   * is untouched. Entering Debug also enables the diagnostics surface;
   * leaving Debug leaves the flag as the user last set it.
   */
  setExperienceMode(mode: ExperienceMode): void {
    if (!(mode in EXPERIENCE_VISUAL_DEFAULTS)) return;
    this.experienceModeValue = mode;
    const defaults = EXPERIENCE_VISUAL_DEFAULTS[mode];
    this.setVisual(defaults);
    if (mode === 'debug') this.diagnosticsEnabledValue = true;
  }

  get experienceMode(): ExperienceMode {
    return this.experienceModeValue;
  }

  get diagnosticsEnabled(): boolean {
    return this.diagnosticsEnabledValue;
  }

  setDiagnostics(enabled: boolean): void {
    this.diagnosticsEnabledValue = enabled === true;
    this.invalidate(INVALIDATION_REASON.DEBUG_CHANGED);
  }

  /** Apply display-domain values (clamped) through the shared post. */
  setVisual(partial: PresetDisplayState): void {
    this.invalidate(INVALIDATION_REASON.POST_CHANGED);
    if (partial.exposure !== undefined) {
      const exposure = clampRange(
        Number(partial.exposure),
        EXPOSURE_RANGE.min,
        EXPOSURE_RANGE.max,
        this.exposureValue
      );
      this.exposureValue = exposure;
      this.post.setExposure(exposure);
    }
    if (partial.toneMapping !== undefined) {
      const mode = (TONE_MAPPING_VALUES as readonly string[]).includes(partial.toneMapping)
        ? partial.toneMapping
        : this.toneMappingValue;
      this.toneMappingValue = mode;
      this.post.setToneMapping(mode);
    }
    if (partial.bloomEnabled !== undefined || partial.bloomStrength !== undefined) {
      const enabled = partial.bloomEnabled ?? this.bloomEnabledValue;
      const strength =
        partial.bloomStrength !== undefined
          ? clampRange(
              Number(partial.bloomStrength),
              BLOOM_STRENGTH_RANGE.min,
              BLOOM_STRENGTH_RANGE.max,
              this.bloomStrengthValue
            )
          : this.bloomStrengthValue;
      this.bloomEnabledValue = enabled === true;
      this.bloomStrengthValue = strength;
      // Reset the §13 throttle latch so the next frame re-evaluates cleanly
      // against the new user intent instead of keeping a stale suspension.
      this.bloomThrottleActive = false;
      this.post.setBloom(this.bloomEnabledValue, strength);
    }
  }

  get renderScaleOverride(): number | null {
    return this.renderScaleOverrideValue;
  }

  /**
   * Manual render-scale override (campaign §4 rendering domain). Null
   * restores governor-managed dynamic resolution. Values outside the
   * documented range collapse back to null rather than throwing.
   */
  setRenderScaleOverride(scale: number | null): void {
    if (
      scale === null ||
      !Number.isFinite(scale) ||
      scale < RENDER_SCALE_OVERRIDE_RANGE.min ||
      scale > RENDER_SCALE_OVERRIDE_RANGE.max
    ) {
      this.renderScaleOverrideValue = null;
    } else {
      this.renderScaleOverrideValue = scale;
    }
    this.handleResize(
      this.canvas.clientWidth || FALLBACK_CSS_WIDTH,
      this.canvas.clientHeight || FALLBACK_CSS_HEIGHT
    );
  }

  setQualityMode(mode: CosmicAtlasStateV1['rendering']['qualityMode']): void {
    this.governor.configure({ qualityMode: mode });
  }

  setTargetFps(fps: 30 | 60): void {
    this.governor.configure({ targetFps: fps });
  }

  /**
   * Canonical trajectory-backend preference (M8-09). Invalid values collapse
   * to `auto` instead of throwing; takes effect on the next rendered frame —
   * no pipeline rebuild (the destination pass selector re-evaluates per frame).
   */
  setTrajectoryBackend(preference: TrajectoryBackendPreference): void {
    this.trajectoryBackendValue = (TRAJECTORY_BACKEND_VALUES as readonly string[]).includes(
      preference
    )
      ? preference
      : 'auto';
    this.invalidate(INVALIDATION_REASON.CONTROL_CHANGED);
  }

  get trajectoryBackend(): TrajectoryBackendPreference {
    return this.trajectoryBackendValue;
  }

  /**
   * Debug snapshot of the active destination module (getDebugSnapshot when
   * implemented), or null. Read-only introspection for diagnostics, tests and
   * benchmark harnesses — never a control path.
   */
  activeDestinationDebugSnapshot(): Record<string, unknown> | null {
    const module = this.activePrepared?.module;
    if (module === undefined || typeof module.getDebugSnapshot !== 'function') return null;
    return module.getDebugSnapshot();
  }

  /**
   * Canonical destination-control channel (CA5): forwards a partial control
   * payload to the ACTIVE destination's applyControlState (which normalizes
   * through its own single normalizer). Unknown ids / absent handlers are
   * ignored; never throws; never touches uniforms directly.
   */
  setDestinationControl(destinationId: string, partial: Record<string, unknown>): void {
    const active = this.activePrepared?.module;
    if (active === undefined) return;
    if (active.descriptor.id !== destinationId) return;
    if (typeof active.applyControlState !== 'function') return;
    active.applyControlState(partial);
    this.cacheDestinationState(active);
    this.invalidate(INVALIDATION_REASON.CONTROL_CHANGED);
  }

  /**
   * Write-through the active module's normalized share state into the
   * destination-state cache (control persistence generalization, CA6).
   * The cache is stamped with the PREPARED module's preset id — never the
   * current navigation selection, which may already point elsewhere.
   */
  private cacheDestinationState(active: NonNullable<PreparedPhenomenon['module']>): void {
    if (typeof active.serializeShareState !== 'function') return;
    const state = active.serializeShareState();
    this.destinationStateCache.set(active.descriptor.id, {
      presetId: this.activePrepared?.preset.id ?? '',
      schemaVersion: this.activePrepared?.preset.stateSchemaVersion ?? 1,
      state
    });
  }

  get isReady(): boolean {
    return this.status.ready;
  }

  /**
   * validateAtlasState-compatible public snapshot (ARCHITECTURE §9): stable
   * public values only; runtime handles never appear here.
   */
  get state(): CosmicAtlasStateV1 {
    const selection = this.navigation.getSelection();
    const runtime = this.director.getRuntimeState();
    const orbit = this.cameraRig.getOrbit();

    const destinations: Record<string, VersionedDestinationState> = {};
    const active = this.activePrepared;
    if (active !== null && typeof active.module.serializeShareState === 'function') {
      // Write-through: the live serialization refreshes the cache so every
      // visited destination's last-known controls persist in `state`. Stamped
      // with the prepared preset id (the selection may already point elsewhere
      // during a transition).
      const state = active.module.serializeShareState();
      this.destinationStateCache.set(active.module.descriptor.id, {
        presetId: active.preset.id,
        schemaVersion: active.preset.stateSchemaVersion,
        state
      });
    }
    for (const [id, cached] of this.destinationStateCache) {
      destinations[id] = { schemaVersion: cached.schemaVersion, state: cached.state };
    }

    const config = this.governor.getConfig();
    return {
      schemaVersion: 1,
      atlas: {
        activeDestination: selection?.destinationId ?? 'black-hole',
        activePreset: selection?.presetId ?? '',
        targetDestination: runtime.targetId,
        targetPreset: runtime.targetId !== null ? (selection?.presetId ?? null) : null,
        transition: this.director.getPublicState()
      },
      experience: {
        mode: this.experienceModeValue
      },
      sharedVisual: {
        exposure: this.exposureValue,
        bloomEnabled: this.bloomEnabledValue,
        bloomStrength: this.bloomStrengthValue,
        toneMapping: this.toneMappingValue
      },
      rendering: {
        qualityMode: config.qualityMode,
        targetFps: config.targetFps,
        dynamicResolution: this.renderScaleOverrideValue === null,
        renderScaleOverride: this.renderScaleOverrideValue,
        trajectoryBackend: this.trajectoryBackendValue
      },
      debug: {
        diagnosticsEnabled: this.diagnosticsEnabledValue
      },
      accessibility: {
        reducedMotion: this.reducedMotionValue,
        highContrastUi: false
      },
      camera: {
        azimuthDeg: orbit.azimuthDeg,
        polarDeg: orbit.polarDeg,
        distance: orbit.distance,
        fovDeg: this.camera.fov
      },
      destinations
    };
  }

  /** Assemble the CA0-09 debug inventory from live host pieces. */
  debugInventory(): DebugInventoryView {
    return collectInventory({
      resources: { debugInventory: () => this.resources.debugInventory() },
      activeDestinationId: this.activePrepared?.module.descriptor.id ?? null,
      rendererGeneration: this.rendererGeneration,
      pendingPrepares: this.pendingPrepares,
      governor: this.governor,
      backend: this.kernel.backend,
      gpuFrameMs: this.kernel.gpuFrameMs,
      frame: this.frameTelemetry(),
      rendererInfo: this.kernel.readRendererInfo()
    });
  }

  /**
   * BH-121: force a GPU timestamp-pool resolve and return the window mean
   * (null when the backend does not expose timestamp queries).
   */
  flushGpuTimestamps(): Promise<number | null> {
    return this.kernel.flushGpuTimestamps();
  }

  /** Ordered teardown: director → modules/scopes → services → post → manager → kernel. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unsubscribeDeviceLost?.();
    this.unsubscribeDeviceLost = null;
    this.unsubscribeTierChanged?.();
    this.unsubscribeTierChanged = null;
    this.fatalCallbacks.clear();

    try {
      this.director.dispose();
    } catch (error) {
      console.error('[CosmicAtlasHost] director.dispose threw:', error);
    }

    const active = this.activePrepared;
    this.activePrepared = null;
    if (active !== null) {
      releasePrepared(active, '[CosmicAtlasHost]');
    }

    for (const service of [
      this.particlesService,
      this.volumesService,
      this.ribbonService,
      this.trajectoryService,
      this.fieldLineService,
      this.lensingService
    ]) {
      try {
        service.dispose();
      } catch (error) {
        console.error('[CosmicAtlasHost] service dispose threw:', error);
      }
    }
    try {
      this.cameraRig.dispose();
    } catch (error) {
      console.error('[CosmicAtlasHost] cameraRig.dispose threw:', error);
    }

    this.post.dispose();

    try {
      this.resources.disposeAll();
    } catch (error) {
      console.error('[CosmicAtlasHost] resource disposal threw:', error);
    }

    this.kernel.dispose();
    this.governor.dispose();
    this.navigation.dispose();
  }

  // -------------------------------------------------------------------------
  // TransitionHostCallbacks (director boundary)
  // -------------------------------------------------------------------------

  private resolveTarget(
    destinationId: string,
    presetId?: string
  ): { descriptor: PhenomenonDescriptor; preset: PresetDescriptor } {
    const selection = this.navigation.resolveSelection(destinationId, presetId);
    if (selection === null) {
      throw new Error(`[CosmicAtlasHost] no registered destination satisfies '${destinationId}'.`);
    }
    const entry = this.registry.get(selection.destinationId);
    const preset = entry?.presetById.get(selection.presetId);
    if (entry === undefined || preset === undefined) {
      throw new Error(
        `[CosmicAtlasHost] resolved '${selection.destinationId}/${selection.presetId}' is missing from the registry.`
      );
    }
    // Control persistence (CA6): restore cached controls when revisiting the
    // SAME preset; a different preset resets to its documented defaults. The
    // destination module re-normalizes the merged state in prepare(), so the
    // module remains the normalization authority.
    const cached = this.destinationStateCache.get(selection.destinationId);
    if (cached === undefined || cached.presetId !== selection.presetId) {
      return { descriptor: entry.descriptor, preset };
    }
    const restored: PresetDescriptor = {
      ...preset,
      state: { ...preset.state, ...cached.state }
    };
    return { descriptor: entry.descriptor, preset: restored };
  }

  private async prepareTarget(request: TransitionPrepareRequest): Promise<PreparedPhenomenon> {
    this.pendingPrepares += 1;
    let scope: ResourceScope | null = null;
    try {
      const factory = await request.descriptor.load();
      throwIfAborted(request.signal, `${request.descriptor.id} preparation aborted`);
      const module = factory();
      scope = this.resources.createScope(`destination:${request.descriptor.id}`);
      return await module.prepare({
        services: this.services,
        scope,
        preset: request.preset,
        quality: request.quality,
        signal: request.signal,
        reportProgress: request.reportProgress
      });
    } catch (error) {
      // A failed prepare must not leak its half-built scope.
      if (scope !== null) {
        try {
          scope.disposeAll();
        } catch (cleanupError) {
          console.error('[CosmicAtlasHost] prepare-scope cleanup threw:', cleanupError);
        }
      }
      throw error;
    } finally {
      this.pendingPrepares -= 1;
    }
  }

  private async activateTarget(
    prepared: PreparedPhenomenon,
    reducedMotion: boolean
  ): Promise<void> {
    const previous = this.activePrepared;
    this.activePrepared = prepared;
    try {
      await prepared.module.enter({
        services: this.services,
        preset: prepared.preset,
        reducedMotion
      });
    } catch (error) {
      this.activePrepared = previous;
      throw error;
    }
    this.activeSeed = Number(prepared.preset.seed) >>> 0;
    // Preset display recommendations ride on top of mode defaults: presets
    // define physics/observer/display separately (campaign §10), and only the
    // DISPLAY domain is applied here.
    if (prepared.preset.display !== undefined) {
      this.setVisual(prepared.preset.display);
    }
    // The arriving destination's work multiplier now drives the governor's
    // fps expectation (and re-arms its warmup grace window).
    this.governor.setActiveDestination(prepared.module.descriptor.id);
    // Transitions ramp the camera themselves; this instant/snap application
    // covers plain activations and reduced motion (animateSeconds 0).
    this.cameraRig.applyArrivalPreset(
      prepared.preset.camera,
      reducedMotion ? 0 : ARRIVAL_ANIMATE_SECONDS
    );
    this.invalidate(INVALIDATION_REASON.DESTINATION_CHANGED);
  }

  private async exitActive(freezeForTransition: boolean): Promise<void> {
    const active = this.activePrepared;
    if (active === null) return;
    await active.module.exit({ services: this.services, freezeForTransition });
  }

  private disposeActive(): void {
    const active = this.activePrepared;
    this.activePrepared = null;
    if (active === null) return;
    this.invalidate(INVALIDATION_REASON.DESTINATION_CHANGED);
    this.governor.setActiveDestination(null);
    // Surface failures to the director (it wraps this call in try/catch), but
    // always attempt both halves of the teardown.
    let firstError: unknown = null;
    try {
      active.module.dispose();
    } catch (error) {
      firstError = error;
    }
    active.scope.disposeAll(); // aggregated disposer errors propagate
    if (firstError !== null) throw firstError;
  }

  private disposePrepared(prepared: PreparedPhenomenon): void {
    releasePrepared(prepared, '[CosmicAtlasHost]');
  }

  private requestTransition(intent: NavigationIntent): void {
    // `beforeunload` fires when a navigation STARTS, not when it commits, so
    // a page can fire it and then stay (cancelled navigation, a link that
    // resolves to a download). Leaving `tearingDown` latched would silence
    // every later transition error — including fatal ones — for the rest of
    // the session, while the director still drove the UI error path: an
    // error visible on screen and absent from the console. A new transition
    // request proves the document is alive, and the abandoned prepare's
    // rejection has already been delivered by this point, so clearing here
    // restores truthful reporting without reopening the teardown race.
    this.tearingDown = false;
    this.director.requestTransition({
      destinationId: intent.destinationId,
      presetId: intent.presetId
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private getTimeInfo(): FrameTimeInfo {
    return {
      dt: this.lastFrameDt,
      elapsed: this.elapsedSeconds,
      phase: this.time.simulationPhase,
      physicalTime: this.time.physicalTime
    };
  }

  private buildServices(): HostServices {
    const services: HostServices = {
      kernel: this.kernel,
      cameraRig: this.cameraRig,
      particles: this.particlesService,
      volumes: this.volumesService,
      ribbons: this.ribbonService,
      trajectories: this.trajectoryService,
      fieldLines: this.fieldLineService,
      lensing: this.lensingService,
      post: this.post,
      governor: this.governor,
      resources: this.resources,
      time: this.time,
      seed: this.activeSeed
    };
    // Live members exposed as getters (arrow closures keep `this` lexical):
    // the particle service is swapped for a renderer-bound instance during
    // init(), and the seed follows the activated preset.
    Object.defineProperty(services, 'particles', {
      get: () => this.particlesService,
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(services, 'seed', {
      get: () => this.activeSeed,
      enumerable: true,
      configurable: true
    });
    return services;
  }

  private initialCssWidth(): number {
    const width = this.canvas.clientWidth;
    return Number.isFinite(width) && width > 0 ? width : FALLBACK_CSS_WIDTH;
  }

  private initialCssHeight(): number {
    const height = this.canvas.clientHeight;
    return Number.isFinite(height) && height > 0 ? height : FALLBACK_CSS_HEIGHT;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Dispose a prepared-but-never-activated target (module + scope), logging. */
function releasePrepared(prepared: PreparedPhenomenon, context: string): void {
  try {
    prepared.module.dispose();
  } catch (error) {
    console.error(`${context} prepared module dispose threw:`, error);
  }
  try {
    prepared.scope.disposeAll();
  } catch (error) {
    console.error(`${context} prepared scope disposal threw:`, error);
  }
}

function throwIfAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) throw new DOMException(message, 'AbortError');
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Finite-clamp with fallback (host-local mirror of atlasState helpers). */
function clampRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (min > max) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Media-query probe; treated as false outside browser environments. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Approximation disclosure: `'gpu' in navigator` only predicts WebGPU
 * availability for the CPU/GPU particle path choice; ParticleService still
 * verifies `renderer.compute` per system, and init() re-wires the service
 * against the actual selected backend.
 */
function detectComputeAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
