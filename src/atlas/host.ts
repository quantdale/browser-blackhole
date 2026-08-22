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
import type {
  BackendInfo,
  CosmicAtlasStateV1,
  ExperienceMode,
  FrameContext,
  FramePlan,
  FrameTimeInfo,
  HostServices,
  IParticleService,
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
  private activeSeed = 1;
  private pendingPrepares = 0;
  private rendererGeneration = 0;
  private elapsedSeconds = 0;
  private lastFrameDt = 0;
  private reducedMotionValue: boolean;
  private initPromise: Promise<void> | null = null;
  private disposed = false;
  private unsubscribeDeviceLost: (() => void) | null = null;

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
  /** True while the §13 interaction throttle has bloom suspended. */
  private bloomThrottleActive = false;

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
      console.error(
        `[CosmicAtlasHost] transition error${event.fatal ? ' (fatal)' : ''}: ${event.message}`
      );
    });

    // UI/host requests -> director (latest-wins inside the director).
    this.navigation.onIntent((intent) => {
      this.requestTransition(intent);
    });

    this.unsubscribeDeviceLost = this.kernel.onDeviceLost(() => {
      this.rendererGeneration += 1;
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
    const [diagnostic, blackHole, neutronStar, stellarExplosion] = await Promise.all([
      import('./destinations/diagnosticDestination.js'),
      import('./destinations/blackHoleDestination.js'),
      import('../phenomena/neutron-star/neutronStarModule.js'),
      import('../phenomena/stellar-explosion/presets.js')
    ]);
    this.registry.register(diagnostic.diagnosticDescriptor, diagnostic.DIAGNOSTIC_PRESETS);
    this.registry.register(blackHole.blackHoleDescriptor, blackHole.BLACK_HOLE_PRESETS);
    this.registry.register(neutronStar.NEUTRON_STAR_DESCRIPTOR, NEUTRON_STAR_PRESETS);
    this.registry.register(
      stellarExplosion.STELLAR_EXPLOSION_DESCRIPTOR,
      stellarExplosion.STELLAR_EXPLOSION_PRESETS
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
   */
  frame(dtSeconds: number): void {
    if (this.disposed || !this.status.ready) return;
    const dt = Number.isFinite(dtSeconds)
      ? Math.min(Math.max(dtSeconds, 0), MAX_FRAME_DT_SECONDS)
      : 0;
    this.lastFrameDt = dt;
    this.elapsedSeconds += dt;

    this.time.update(dt);
    this.cameraRig.update(dt);
    this.director.update(dt);
    this.applyBloomInteractionThrottle();

    const overlay = this.director.getOverlay();
    const plan: FramePlan = {
      destination: this.activePrepared !== null ? this.frameDestination : null,
      scene: this.activePrepared?.scene ?? null,
      transitionOverlay: overlay.texture,
      transitionOpacity: overlay.opacity
    };
    this.kernel.renderFrame(plan);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Request travel; delegates to NavigationController → director. */
  navigate(destinationId: string, presetId?: string): NavigationIntent | null {
    return this.navigation.navigate(destinationId, presetId);
  }

  /** Forward window resizes; keeps the transition overlay at internal pixels. */
  handleResize(cssWidth: number, cssHeight: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight)) return;
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
  private applyBloomInteractionThrottle(): void {
    if (!this.bloomEnabledValue) return;
    const throttled =
      this.governor.currentTier === 'low' && this.governor.activityMode === 'interaction';
    if (throttled !== this.bloomThrottleActive) {
      this.bloomThrottleActive = throttled;
      this.post.setBloom(!throttled, throttled ? 0 : this.bloomStrengthValue);
    }
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
  }

  /** Apply display-domain values (clamped) through the shared post. */
  setVisual(partial: PresetDisplayState): void {
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
      destinations[active.module.descriptor.id] = {
        schemaVersion: active.preset.stateSchemaVersion,
        state: active.module.serializeShareState()
      };
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
        renderScaleOverride: this.renderScaleOverrideValue
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
      backend: this.kernel.backend
    });
  }

  /** Ordered teardown: director → modules/scopes → services → post → manager → kernel. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unsubscribeDeviceLost?.();
    this.unsubscribeDeviceLost = null;

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
    return { descriptor: entry.descriptor, preset };
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
