/**
 * Shared renderer kernel — the single owner of the Three.js renderer instance,
 * backend selection (WebGPU preferred, WebGL2 fallback), device-loss surfacing,
 * canvas sizing, and per-frame orchestration into the shared HDR/post pipeline.
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §6 (shared renderer kernel), §7 (frame lifecycle),
 *   §10 (capability policy)
 * - docs/DEPLOYMENT_COMPATIBILITY.md §2 (WebGPU capability flow), §5 (device loss),
 *   §7 (production diagnostics)
 * - docs/FAILURE_RECOVERY.md §2 (runtime status machine), §5 (device-loss recovery,
 *   monotonic generation IDs), §12 (duplicate-loop defense), §14 (resize edge cases),
 *   §17 (stable error codes)
 *
 * Frame orchestration (ARCHITECTURE §7): governor.beginFrame → destination.update →
 * bind shared HDR target → destination.render(RenderContext) → restore target →
 * post.present(transition overlay) → governor.endFrame. The kernel binds the render
 * target; the active destination performs its own draw passes through the
 * RenderContext it receives. The kernel does not own the animation loop — the host
 * must drive exactly one renderFrame() loop per renderer generation
 * (FAILURE_RECOVERY §12).
 *
 * Approximation disclosure: capability probing is conservative (see
 * ./capabilities.ts). No physics fidelity claims are made by this module.
 */

import type * as THREE from 'three';
import type {
  BackendInfo,
  CapabilityId,
  CapabilityRequirement,
  FrameContext,
  FramePlan,
  FrameTimeInfo,
  HostServices,
  IPerformanceGovernor,
  IRendererKernel,
  ISharedPost,
  QualityTier,
  RenderContext,
  RendererLike
} from '../atlas/types';
import {
  CAPABILITY_IDS,
  detectCapabilities,
  detectCapabilityFlags,
  resolveWebGPUAdapterName,
  satisfied,
  summarizeCapabilities
} from './capabilities';
import type { CapabilityFlags, CapabilitySummary, RendererProbe } from './capabilities';

/** Default device-pixel-ratio cap when the host does not inject one. */
const DEFAULT_DPR_CAP = 2;

// ---------------------------------------------------------------------------
// Duck-typed surfaces (three r180 typings do not expose these on common Renderer)
// ---------------------------------------------------------------------------

interface DeviceLostInfoLike {
  api?: string;
  message?: string;
  reason?: string | null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function readDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** Read the live WebGL2 context off either renderer flavor, or null. */
function extractWebglContext(renderer: RendererLike): WebGL2RenderingContext | null {
  try {
    const ctx = (renderer as { getContext?: () => unknown }).getContext?.();
    if (
      ctx !== null &&
      typeof ctx === 'object' &&
      typeof (ctx as WebGL2RenderingContext).getExtension === 'function'
    ) {
      return ctx as WebGL2RenderingContext;
    }
  } catch {
    // context unavailable (e.g. lost during init) — probe without it
  }
  return null;
}

function extractCapabilities(renderer: RendererLike): { maxTextureSize?: number } | null {
  const caps = (renderer as { capabilities?: unknown }).capabilities;
  if (caps === null || typeof caps !== 'object') return null;
  return caps as { maxTextureSize?: number };
}

/**
 * Recover a bindable RenderTarget from the shared post's HDR texture.
 *
 * The contract types `ISharedPost.getHdrTarget()` as `THREE.Texture | null`.
 * three r180 supports both practical shapes: the RenderTarget instance itself
 * (flagged `isRenderTarget`) or its color texture (which carries a
 * `.renderTarget` back-reference assigned by RenderTarget's constructor).
 */
function resolveRenderTarget(texture: THREE.Texture | null): THREE.RenderTarget | null {
  if (texture === null) return null;
  if ((texture as unknown as { isRenderTarget?: boolean }).isRenderTarget === true) {
    return texture as unknown as THREE.RenderTarget;
  }
  const linked = (texture as unknown as { renderTarget?: THREE.RenderTarget }).renderTarget;
  if (
    linked !== null &&
    linked !== undefined &&
    (linked as { isRenderTarget?: boolean }).isRenderTarget === true
  ) {
    return linked;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export interface SharedRendererKernelOptions {
  governor: IPerformanceGovernor;
  post: ISharedPost;
  getTimeInfo: () => FrameTimeInfo;
  getQuality: () => QualityTier;
  /**
   * Required to drive destinations: `FrameContext.services` cannot be
   * synthesized by the kernel. renderFrame throws a descriptive error when a
   * destination must be updated without this provider (fail loud, not fake).
   */
  getServices?: () => HostServices;
  /**
   * Camera used in the RenderContext handed to destinations each frame.
   * Same fail-loud policy as `getServices`.
   */
  getCamera?: () => THREE.PerspectiveCamera;
  /**
   * Canonical trajectory-backend preference surfaced through FrameContext
   * (M8-09). Defaults to 'auto' when absent so synthetic/test kernels stay
   * valid without wiring.
   */
  getTrajectoryBackend?: () => 'auto' | 'numerical' | 'lut';
  /** Device pixel ratio cap applied before render scaling (default 2). */
  dprCap?: number;
  /**
   * Dev/test-only backend decision override (docs/CI_CD.md §6, same policy
   * class as the root app's `?backend=`): forces the init attempt so fallback
   * behavior stays exercisable on capable machines. 'webgl2' skips the WebGPU
   * attempt entirely; 'webgpu' removes the WebGL2 fallback on failure.
   * Absent = documented WebGPU-preferred policy.
   */
  forcedBackend?: 'webgpu' | 'webgl2';
}

export class SharedRendererKernel implements IRendererKernel {
  private readonly options: SharedRendererKernelOptions;

  private rendererValue: RendererLike | null = null;
  private backendValue: BackendInfo | null = null;
  private capabilityFlags: CapabilityFlags | null = null;

  /** Monotonic renderer generation; stale async callbacks are ignored (FAILURE_RECOVERY §5). */
  private generation = 0;
  private disposed = false;
  private deviceLost = false;
  /** Generation whose loss event already notified subscribers (dedupes multi-source loss signals). */
  private lossNotifiedGeneration = -1;

  private readonly deviceLostCallbacks = new Set<() => void>();
  private removeContextLostListener: (() => void) | null = null;
  private detachRendererLostHook: (() => void) | null = null;
  private hdrTargetContractWarned = false;

  constructor(options: SharedRendererKernelOptions) {
    this.options = options;
  }

  // -- lifecycle ------------------------------------------------------------

  /**
   * Initialize the renderer: WebGPU first (dynamic import keeps the heavy
   * `three/webgpu` build out of modules that merely reference the kernel),
   * explicit WebGL2 fallback via WebGPURenderer's forceWebGL backend.
   * Idempotent after success.
   *
   * Note: three r180's WebGPURenderer may itself fall back to its internal
   * WebGLBackend; the active API is therefore read off the initialized backend
   * rather than assumed from the constructor path.
   */
  async init(canvas: HTMLCanvasElement): Promise<BackendInfo> {
    if (this.disposed) {
      throw new Error('[SharedRendererKernel] init() called after dispose().');
    }
    if (this.rendererValue !== null && this.backendValue !== null) {
      return this.backendValue;
    }

    const generation = ++this.generation;

    let webgpuError: unknown;
    let partialRenderer: { dispose(): void } | null = null;
    if (this.options.forcedBackend !== 'webgl2') {
      try {
        const webgpuModule = await import('three/webgpu');
        const candidate = new webgpuModule.WebGPURenderer({ canvas, antialias: false });
        partialRenderer = candidate;
        await candidate.init();
        if (this.disposed || generation !== this.generation) {
          candidate.dispose();
          throw new Error('[SharedRendererKernel] init() superseded by dispose()/re-init.');
        }
        this.adoptRenderer(candidate, generation);
        await this.resolveAdapterName(generation);
        return this.requireBackend();
      } catch (error) {
        webgpuError = error;
        // Release the failed attempt's GPU resources before fallback/rethrow
        // (FAILURE_RECOVERY §15: bounded degraded retry, no leaked reallocations).
        try {
          partialRenderer?.dispose();
        } catch {
          // backend already dead — nothing further to release
        }
        this.teardownLossWiring();
        this.rendererValue = null;
        this.backendValue = null;
        this.capabilityFlags = null;
        if (this.disposed || generation !== this.generation) throw error;
        if (this.options.forcedBackend === 'webgpu') {
          // Forced WebGPU must not silently degrade to WebGL2 — the whole point
          // of the override is to pin the decision for tests/probes.
          throw error;
        }
        // otherwise fall through to the documented WebGL2 fallback
      }
    }

    try {
      // WebGL2 fallback: WebGPURenderer pinned to its WebGL2 backend. The
      // classic THREE.WebGLRenderer cannot build TSL node materials in three
      // r185 (its GLSL stage never receives node-generated shaders —
      // resolveIncludes(undefined)), while the forceWebGL path runs the same
      // node system on GLSL and keeps one code path for every destination.
      const webgpuModule = await import('three/webgpu');
      const candidate = new webgpuModule.WebGPURenderer({
        canvas,
        antialias: false,
        forceWebGL: true
      });
      await candidate.init();
      if (this.disposed || generation !== this.generation) {
        candidate.dispose();
        throw new Error('[SharedRendererKernel] init() superseded by dispose()/re-init.');
      }
      this.adoptRenderer(candidate, generation);
      return this.requireBackend();
    } catch (error) {
      this.generation += 1; // invalidate any partially attached listeners
      this.teardownLossWiring();
      const liveRenderer = this.rendererValue as RendererLike | null;
      try {
        liveRenderer?.dispose();
      } catch {
        // renderer never became usable — nothing further to release
      }
      this.rendererValue = null;
      this.backendValue = null;
      this.capabilityFlags = null;
      throw new Error(
        `[ENV_WEBGPU_UNAVAILABLE / ENV_WEBGL2_UNAVAILABLE] SharedRendererKernel: no render backend could be initialized. ` +
          `WebGPU attempt: ${describeError(webgpuError)}. WebGL2 attempt: ${describeError(error)}.`
      );
    }
  }

  get backend(): BackendInfo | null {
    return this.backendValue;
  }

  get renderer(): RendererLike | null {
    return this.rendererValue;
  }

  /** True between a device-loss notification and kernel disposal/re-init. */
  get isDeviceLost(): boolean {
    return this.deviceLost;
  }

  // -- device loss ----------------------------------------------------------

  /** Subscribe to device-loss notifications; returns an unsubscribe function. */
  onDeviceLost(cb: () => void): () => void {
    this.deviceLostCallbacks.add(cb);
    return () => {
      this.deviceLostCallbacks.delete(cb);
    };
  }

  /**
   * TEST-ONLY fault injection (M11-03): fire the PRODUCTION device-loss path
   * for the current generation exactly as the real loss sources would.
   * Never called by production code; consumed by the device-loss browser
   * suite through the host test hook so the injected fault exercises the
   * same notify -> subscriber state machine, not a parallel fake path.
   */
  simulateDeviceLossForTest(reason = 'test-injection'): void {
    this.notifyDeviceLoss(this.generation, reason);
  }

  /**
   * Wire all loss sources for the current generation. Deduplicated by
   * {@link notifyDeviceLoss} so the same physical loss event notifies once even
   * though three's unified hook, the raw `device.lost` promise, and (on WebGL)
   * the canvas context-lost event can all fire.
   */
  private wireDeviceLoss(renderer: RendererLike, generation: number): void {
    // 1) three r180's unified hook — invoked by both of its backends.
    const hookable = renderer as { onDeviceLost?: (info: DeviceLostInfoLike) => void };
    const previous =
      typeof hookable.onDeviceLost === 'function'
        ? hookable.onDeviceLost.bind(renderer)
        : undefined;
    hookable.onDeviceLost = (info: DeviceLostInfoLike) => {
      if (previous !== undefined) previous(info);
      this.notifyDeviceLoss(generation, info?.reason ?? info?.message ?? 'unknown');
    };
    this.detachRendererLostHook = () => {
      if (previous === undefined) delete hookable.onDeviceLost;
      else hookable.onDeviceLost = previous;
    };

    // 2) Direct WebGPU device.lost promise (guarded by feature detection).
    const lostPromise = (
      renderer as { backend?: { device?: { lost?: Promise<DeviceLostInfoLike> } } }
    ).backend?.device?.lost;
    if (
      lostPromise !== null &&
      lostPromise !== undefined &&
      typeof lostPromise.then === 'function'
    ) {
      lostPromise
        .then((info) => {
          this.notifyDeviceLoss(generation, info?.reason ?? info?.message ?? 'unknown');
        })
        .catch(() => {
          // late rejection after dispose — nothing to recover into
        });
    }

    // 3) Classic canvas-level context loss (covers the plain WebGLRenderer fallback
    //    and three-internal WebGLBackend alike). preventDefault keeps the context
    //    recoverable instead of browser-default teardown.
    const canvas = renderer.domElement;
    const onContextLost = (event: Event): void => {
      event.preventDefault();
      this.notifyDeviceLoss(generation, 'webglcontextlost');
    };
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    this.removeContextLostListener = () => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
    };
  }

  private notifyDeviceLoss(generation: number, reason: string): void {
    if (this.disposed || generation !== this.generation) return; // stale-generation callback
    if (this.lossNotifiedGeneration === generation) return; // already reported this loss
    this.lossNotifiedGeneration = generation;
    this.deviceLost = true;
    console.error(
      `[GPU_DEVICE_LOST] SharedRendererKernel: rendering device lost (${reason}). ` +
        'Subscribers notified; frame submission stops until recovery/re-init.'
    );
    for (const cb of [...this.deviceLostCallbacks]) {
      try {
        cb();
      } catch (error) {
        console.error('[SharedRendererKernel] onDeviceLost subscriber threw:', error);
      }
    }
  }

  // -- sizing ---------------------------------------------------------------

  /**
   * Apply CSS size plus effective pixel ratio = min(devicePixelRatio, dprCap) ×
   * renderScale, clamped so the drawing buffer never exceeds the device max
   * texture dimension. Zero/hidden containers defer sizing entirely
   * (FAILURE_RECOVERY §14). Keeps the shared HDR/post target matched to the
   * resulting drawing buffer.
   */
  handleResize(cssWidth: number, cssHeight: number, renderScale: number): void {
    const renderer = this.rendererValue;
    if (renderer === null || this.disposed) return;
    if (
      !Number.isFinite(cssWidth) ||
      !Number.isFinite(cssHeight) ||
      cssWidth <= 0 ||
      cssHeight <= 0
    ) {
      return;
    }

    const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
    renderer.setSize(cssWidth, cssHeight, false);

    const configuredCap = this.options.dprCap ?? DEFAULT_DPR_CAP;
    const dprCap = configuredCap > 0 ? configuredCap : DEFAULT_DPR_CAP;
    let pixelRatio = Math.min(readDevicePixelRatio(), dprCap) * scale;

    const maxTextureSize = this.backendValue?.maxTextureSize ?? 0;
    if (maxTextureSize > 0) {
      pixelRatio = Math.min(pixelRatio, maxTextureSize / Math.max(cssWidth, cssHeight));
    }
    if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) pixelRatio = 1;
    renderer.setPixelRatio(pixelRatio);

    const widthPx = Math.max(1, Math.round(cssWidth * pixelRatio));
    const heightPx = Math.max(1, Math.round(cssHeight * pixelRatio));
    this.options.post.ensureSize(widthPx, heightPx, scale);
  }

  // -- frame orchestration ----------------------------------------------------

  /**
   * Execute one orchestrated frame (ARCHITECTURE §7). Returns false when the
   * kernel has no initialized renderer or the device was lost — i.e. nothing
   * was submitted; true covers every frame that reached present().
   */
  renderFrame(plan: FramePlan): boolean {
    const renderer = this.rendererValue;
    if (this.disposed || this.deviceLost || renderer === null || this.backendValue === null) {
      return false;
    }

    const governor = this.options.governor;
    governor.beginFrame();
    try {
      const destination = plan.destination;
      if (destination !== null && plan.scene !== null) {
        destination.update(this.assembleFrameContext());

        const hdrTexture = this.options.post.getHdrTarget();
        const hdrTarget = this.resolveHdrTargetOrDegraded(hdrTexture);

        // The union RendererLike spans WebGPURenderer (accepts base RenderTarget)
        // and WebGLRenderer (whose d.ts narrows to WebGLRenderTarget); at runtime
        // both accept the shared HDR target produced by post.
        renderer.setRenderTarget(hdrTarget as THREE.WebGLRenderTarget | null);
        try {
          const renderContext: RenderContext = {
            renderer,
            camera: this.requireCamera(),
            scene: plan.scene,
            hdrTarget: hdrTexture
          };
          destination.render(renderContext);
        } finally {
          renderer.setRenderTarget(null);
        }
      }

      // Present even without an active destination so transition overlays
      // composite over the frozen/black state during travel.
      this.options.post.present(plan.transitionOverlay, plan.transitionOpacity);
    } finally {
      governor.endFrame();
    }
    return true;
  }

  private assembleFrameContext(): FrameContext {
    const getServices = this.options.getServices;
    if (getServices === undefined) {
      throw new Error(
        '[SharedRendererKernel] options.getServices was not provided; ' +
          'FrameContext.services cannot be synthesized by the kernel.'
      );
    }
    return {
      services: getServices(),
      time: this.options.getTimeInfo(),
      quality: this.options.getQuality(),
      renderScale: this.options.governor.renderScale,
      trajectoryBackend: this.options.getTrajectoryBackend?.() ?? 'auto'
    };
  }

  private requireCamera(): THREE.PerspectiveCamera {
    const getCamera = this.options.getCamera;
    if (getCamera === undefined) {
      throw new Error(
        '[SharedRendererKernel] options.getCamera was not provided; the active camera cannot be resolved.'
      );
    }
    const camera = getCamera();
    if (camera === null || camera === undefined) {
      throw new Error(
        '[SharedRendererKernel] options.getCamera returned no camera; cannot render.'
      );
    }
    return camera;
  }

  /**
   * Bindable target from the shared post's HDR texture, degrading to canvas
   * output with a one-time console error if the post violates the expected
   * shape (visible degradation instead of a silently faked HDR pass).
   */
  private resolveHdrTargetOrDegraded(texture: THREE.Texture | null): THREE.RenderTarget | null {
    const resolved = resolveRenderTarget(texture);
    if (resolved !== null) return resolved;
    if (texture !== null && !this.hdrTargetContractWarned) {
      this.hdrTargetContractWarned = true;
      console.error(
        '[SharedRendererKernel] ISharedPost.getHdrTarget() returned neither a RenderTarget nor a ' +
          'texture carrying a .renderTarget back-reference; rendering to the canvas instead.'
      );
    }
    return null;
  }

  // -- capabilities -----------------------------------------------------------

  /**
   * Availability report for all known capabilities. Hardness is declared per
   * destination (ARCHITECTURE §10), so the kernel always reports `hard: false`
   * and exposes availability through `satisfied(id)`.
   */
  capabilities(): CapabilityRequirement[] & { satisfied(id: CapabilityId): boolean } {
    const flags = this.capabilityFlags;
    const requirements: CapabilityRequirement[] = CAPABILITY_IDS.map((capability) => ({
      capability,
      hard: false
    }));
    return Object.assign(requirements, {
      satisfied: (id: CapabilityId): boolean => satisfied(flags, id)
    });
  }

  /** Convenience accessor for the host status/debug UI (DEPLOYMENT_COMPATIBILITY §7). */
  summary(): CapabilitySummary {
    return summarizeCapabilities(this.backendValue, this.capabilityFlags);
  }

  // -- teardown ---------------------------------------------------------------

  /**
   * Dispose the renderer and unsubscribe every loss source. Injected
   * governor/post instances are owned by whoever composed them (the host) and
   * are intentionally not disposed here.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1; // invalidate in-flight async callbacks from the old generation

    this.teardownLossWiring();
    this.deviceLostCallbacks.clear();

    const renderer = this.rendererValue;
    this.rendererValue = null;
    this.backendValue = null;
    this.capabilityFlags = null;
    this.deviceLost = false;

    if (renderer !== null) {
      try {
        renderer.dispose();
      } catch (error) {
        console.error('[SharedRendererKernel] renderer.dispose() threw during dispose:', error);
      }
    }
  }

  private teardownLossWiring(): void {
    this.removeContextLostListener?.();
    this.removeContextLostListener = null;
    this.detachRendererLostHook?.();
    this.detachRendererLostHook = null;
  }

  // -- adoption internals -------------------------------------------------------

  private adoptRenderer(renderer: RendererLike, generation: number): void {
    this.rendererValue = renderer;
    this.deviceLost = false;
    this.lossNotifiedGeneration = -1;

    const probe = this.buildProbe(renderer);
    this.capabilityFlags = detectCapabilityFlags(probe);
    this.backendValue = detectCapabilities(probe);

    this.wireDeviceLoss(renderer, generation);
  }

  private buildProbe(renderer: RendererLike): RendererProbe {
    const backendObj = (renderer as { backend?: { isWebGPUBackend?: boolean; device?: unknown } })
      .backend;
    const isWebGpu = backendObj?.isWebGPUBackend === true;
    return {
      api: isWebGpu ? 'webgpu' : 'webgl2',
      gpuDevice: isWebGpu ? backendObj?.device : undefined,
      gl: isWebGpu ? null : extractWebglContext(renderer),
      capabilities: extractCapabilities(renderer),
      adapterName: '',
      devicePixelRatio: readDevicePixelRatio()
    };
  }

  /**
   * Fill the adapter name asynchronously. three r180's WebGPUBackend does not
   * expose its adapter handle, so capabilities.ts issues a separate diagnostic
   * requestAdapter() call; result is discarded if the generation moved on.
   */
  private async resolveAdapterName(generation: number): Promise<void> {
    const backend = this.backendValue;
    if (backend === null || backend.api !== 'webgpu') return;
    const adapterName = await resolveWebGPUAdapterName();
    if (this.disposed || generation !== this.generation || this.backendValue !== backend) return;
    this.backendValue = { ...backend, adapterName };
  }

  private requireBackend(): BackendInfo {
    if (this.backendValue === null) {
      throw new Error('[SharedRendererKernel] internal error: backend missing after adoption.');
    }
    return this.backendValue;
  }
}
