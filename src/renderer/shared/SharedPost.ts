/**
 * SharedPost — shared HDR post-processing and presentation service.
 *
 * Spec sources:
 * - docs/cosmic-atlas/RENDERING_SERVICES.md §9 (SharedPost centralizes HDR
 *   target format, exposure, tone mapping, bloom, color conversion and final
 *   compositing; destinations supply physical radiance, cinematic multipliers
 *   live in visual state)
 * - docs/RENDERING_PIPELINE.md §5 (display chain: radiance -> bloom ->
 *   exposure/tone mapping -> output color space) and §6 (TSL strategy with
 *   explicit fallback behavior)
 *
 * Implementation contract (src/atlas/types.ts `ISharedPost`):
 * - Half-float (RGBA16F) HDR render target sized cssSize x renderScale,
 *   recreated on change; the old target is disposed and ownership is tracked
 *   via the injected ResourceScope ('shared-post').
 * - Exposure and tone mapping are applied by the renderer's automatic
 *   canvas-present path (`renderer.toneMapping` / `renderer.toneMappingExposure`).
 *   three.js applies those only when presenting to the default framebuffer
 *   (see WebGPURenderer `_getFrameBufferTarget` / `_renderOutput`), so renders
 *   into the HDR target always stay linear HDR. SharedPost therefore owns the
 *   presentation transform: setExposure()/setToneMapping() intentionally write
 *   renderer presentation state (RENDERING_SERVICES §9 assigns exactly these
 *   concerns to this service).
 * - Bloom uses the three.js TSL `bloom` node (UnrealBloom-style), computed on
 *   linear HDR values before exposure/tone mapping. Disclosure: this is a
 *   display-side visual effect, not a physical PSF model. With threshold 1.0
 *   only radiance above 1.0 contributes, so it never feeds back into physics.
 *   When disabled the node graph is rebuilt without it, so no bloom cost is
 *   paid while off.
 * - Transition overlays are blended in linear HDR before tone mapping so the
 *   outgoing/incoming cross-fade stays photometrically consistent.
 * - The same TSL graph runs on both backends of WebGPURenderer (WebGPU and
 *   WebGL2); there is no backend branch in this module (RENDERING_PIPELINE §6:
 *   "same algorithm can compile/run on WebGL2").
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial, RenderPipeline } from 'three/webgpu';
import {
  clamp,
  dot,
  float,
  hash,
  length,
  mix,
  mrt,
  screenUV,
  texture,
  uniform,
  vec2,
  vec3,
  vec4
} from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

import type { ISharedPost, RendererLike, ResourceScope } from '../../atlas/types';
import {
  TemporalService,
  type TemporalPolicy,
  type TemporalResetReason
} from './TemporalService.js';
import { CINEMATIC_EMISSIVE_LAYER } from './visualLayers.js';

/** Tone-mapping enum -> THREE constant applied to the canvas-present path. */
const TONE_MAPPING_CONSTANTS = {
  'aces-filmic': THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  linear: THREE.LinearToneMapping
} as const;

/**
 * Bloom radius (blur spread, node-internal 0..1 scale) and luminance
 * threshold in linear HDR units. Threshold 1.0 restricts bloom to radiance
 * above diffuse-white so it reads as an HDR highlight effect.
 */
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 1.0;

type BloomNodeObject = ReturnType<typeof bloom>;

export class SharedPost implements ISharedPost {
  private readonly renderer: RendererLike;
  private readonly scope: ResourceScope;
  private readonly temporal: TemporalService;

  private hdrTarget: THREE.WebGLRenderTarget | null = null;
  /** Separate selective-highlight source; never substitutes for scene radiance. */
  private highlightTarget: THREE.WebGLRenderTarget | null = null;
  private snapshotTarget: THREE.WebGLRenderTarget | null = null;
  /** Ping-pong depth copy used one frame later by volume upsampling. */
  private volumeDepthRead: THREE.WebGLRenderTarget | null = null;
  private volumeDepthWrite: THREE.WebGLRenderTarget | null = null;
  private volumeDepthValid = false;
  private volumeDepthSource: THREE.Texture | null = null;

  private exposure = 1;
  private bloomEnabled = false;
  private bloomStrength = 0;
  private cinematicStyleEnabled = false;

  /** Cached composite inputs; rebuilds the TSL graphs when any part changes. */
  private graphKey: string | null = null;
  private overlayTexture: THREE.Texture | null = null;
  private bloomNode: BloomNodeObject | null = null;
  private highlightRendered = false;
  private bloomResolutionScale = 0.5;
  private temporalPresentationActive = false;
  private temporalProjectionBackup: THREE.Matrix4 | null = null;

  private readonly overlayOpacityU = uniform(0);

  private readonly scene = new THREE.Scene();
  /** Orthographic camera matching three's QuadMesh: NDC-space pass-through. */
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly triangleGeometry = SharedPost.createFullscreenTriangleGeometry();
  private readonly mesh = new THREE.Mesh(this.triangleGeometry);
  private readonly presentMaterial = new MeshBasicNodeMaterial();
  private readonly copyMaterial = new MeshBasicNodeMaterial();
  private readonly depthCopyScene = new THREE.Scene();
  private readonly depthCopyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly depthCopyMaterial = new MeshBasicNodeMaterial();
  private readonly depthCopyMesh = new THREE.Mesh(this.triangleGeometry, this.depthCopyMaterial);

  private disposed = false;

  constructor(services: { renderer: RendererLike; scope: ResourceScope }) {
    this.renderer = services.renderer;
    this.scope = services.scope;
    this.temporal = new TemporalService(services);

    for (const material of [this.presentMaterial, this.copyMaterial]) {
      material.depthTest = false;
      material.depthWrite = false;
      material.blending = THREE.NoBlending;
      material.side = THREE.DoubleSide;
    }

    this.mesh.frustumCulled = false;
    this.mesh.material = this.presentMaterial;
    this.scene.add(this.mesh);

    this.depthCopyMaterial.depthTest = false;
    this.depthCopyMaterial.depthWrite = false;
    this.depthCopyMaterial.blending = THREE.NoBlending;
    this.depthCopyMaterial.side = THREE.DoubleSide;
    this.depthCopyMesh.frustumCulled = false;
    this.depthCopyScene.add(this.depthCopyMesh);
  }

  /** Single full-screen triangle covering clip space (mirrors QuadGeometry). */
  private static createFullscreenTriangleGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3)
    );
    // UVs interpolate to exactly [0,1] across the visible screen area.
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, -1, 0, 1, 2, 1], 2));
    return geometry;
  }

  ensureSize(widthPx: number, heightPx: number, renderScale: number): void {
    if (this.disposed) return;

    const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
    const width = Math.max(1, Math.floor(widthPx * scale));
    const height = Math.max(1, Math.floor(heightPx * scale));

    if (
      this.hdrTarget !== null &&
      this.hdrTarget.width === width &&
      this.hdrTarget.height === height
    ) {
      return;
    }

    const previous = this.hdrTarget;
    this.hdrTarget = this.createHdrTarget(width, height);
    if (previous !== null) {
      this.releaseTarget(previous);
    }
    const highlightWidth = Math.max(2, Math.floor(width * this.bloomResolutionScale));
    const highlightHeight = Math.max(2, Math.floor(height * this.bloomResolutionScale));
    if (
      this.highlightTarget === null ||
      this.highlightTarget.width !== highlightWidth ||
      this.highlightTarget.height !== highlightHeight
    ) {
      const previousHighlight = this.highlightTarget;
      this.highlightTarget = this.createAuxiliaryTarget(
        highlightWidth,
        highlightHeight,
        'SharedPost.Emissive'
      );
      if (previousHighlight !== null) this.releaseTarget(previousHighlight);
    }
    this.highlightRendered = false;
    this.temporal.ensureSize(width, height);
    this.ensureVolumeDepthTargets(width, height);
    this.temporalPresentationActive = false;
    // Force graph rebuild against the new texture on the next present/capture.
    this.graphKey = null;
  }

  getHdrTarget(): THREE.Texture | null {
    return this.disposed || this.hdrTarget === null ? null : this.hdrTarget.texture;
  }

  /** Current selective-highlight attachment, or null before sizing. */
  getHighlightTarget(): THREE.Texture | null {
    return this.disposed || this.highlightTarget === null ? null : this.highlightTarget.texture;
  }

  getDepthTexture(): THREE.Texture | null {
    return this.disposed || this.hdrTarget === null ? null : this.hdrTarget.depthTexture;
  }

  getVolumeDepthTexture(): THREE.Texture | null {
    return this.disposed || !this.volumeDepthValid || this.volumeDepthRead === null
      ? null
      : this.volumeDepthRead.texture;
  }

  /**
   * Stage the current scene depth after the destination draw. Sampling the
   * main target's depth attachment while that same target is being written is
   * invalid on WebGPU and undefined on WebGL2; the one-frame ping-pong copy is
   * explicit, bounded, and safe for the next frame's volume composite.
   */
  captureDepthForVolume(): void {
    if (
      this.disposed ||
      this.hdrTarget === null ||
      this.hdrTarget.depthTexture === null ||
      this.volumeDepthRead === null ||
      this.volumeDepthWrite === null
    ) {
      return;
    }
    if (this.volumeDepthSource?.id !== this.hdrTarget.depthTexture.id) {
      this.volumeDepthSource = this.hdrTarget.depthTexture;
      const source = texture(this.volumeDepthSource);
      this.depthCopyMaterial.colorNode = vec4(source.r, source.r, source.r, 1);
      this.depthCopyMaterial.needsUpdate = true;
    }
    const previousTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(this.volumeDepthWrite);
      this.renderer.render(this.depthCopyScene, this.depthCopyCamera);
    } finally {
      this.renderer.setRenderTarget(previousTarget as THREE.WebGLRenderTarget | null);
    }
    const swap = this.volumeDepthRead;
    this.volumeDepthRead = this.volumeDepthWrite;
    this.volumeDepthWrite = swap;
    this.volumeDepthValid = true;
  }

  invalidateDepthHistory(): void {
    this.volumeDepthValid = false;
  }

  /** Set the global bloom auxiliary resolution; takes effect immediately. */
  setBloomResolutionScale(scale: number): void {
    const next = Number.isFinite(scale) ? THREE.MathUtils.clamp(scale, 0.25, 1) : 0.5;
    if (next === this.bloomResolutionScale) return;
    this.bloomResolutionScale = next;
    this.graphKey = null;
    if (this.hdrTarget !== null) {
      const width = Math.max(2, Math.floor(this.hdrTarget.width * next));
      const height = Math.max(2, Math.floor(this.hdrTarget.height * next));
      const previous = this.highlightTarget;
      this.highlightTarget = this.createAuxiliaryTarget(width, height, 'SharedPost.Emissive');
      if (previous !== null) this.releaseTarget(previous);
    }
  }

  setTemporalPolicy(policy: TemporalPolicy, interaction = false): void {
    this.temporal.setPolicy(policy, interaction);
    this.graphKey = null;
  }

  invalidateTemporal(reason: string): void {
    const knownReason: TemporalResetReason = isTemporalResetReason(reason) ? reason : 'explicit';
    this.temporal.reset(knownReason);
    this.temporalPresentationActive = false;
    this.invalidateDepthHistory();
    this.graphKey = null;
  }

  beginTemporalFrame(camera: THREE.PerspectiveCamera): void {
    this.temporalPresentationActive = false;
    this.temporalProjectionBackup = null;
    const state = this.temporal.getDebugSnapshot();
    if (!state.enabled || this.hdrTarget === null) return;
    const jitter = this.temporal.beginFrame();
    this.temporalProjectionBackup = camera.projectionMatrix.clone();
    const elements = camera.projectionMatrix.elements;
    elements[8] = (elements[8] ?? 0) + (2 * jitter[0]) / this.hdrTarget.width;
    elements[9] = (elements[9] ?? 0) + (2 * jitter[1]) / this.hdrTarget.height;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  resolveTemporal(camera: THREE.PerspectiveCamera): void {
    if (this.hdrTarget === null) return;
    this.temporal.resolve(this.hdrTarget.texture, camera);
    this.temporalPresentationActive = this.temporal.getResolvedTexture() !== null;
    this.graphKey = null;
  }

  clearTemporalOutput(): void {
    this.temporalPresentationActive = false;
    this.graphKey = null;
  }

  endTemporalFrame(camera: THREE.PerspectiveCamera): void {
    if (this.temporalProjectionBackup === null) return;
    camera.projectionMatrix.copy(this.temporalProjectionBackup);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.temporalProjectionBackup = null;
  }

  setExposure(exposure: number): void {
    this.exposure = Number.isFinite(exposure) ? Math.max(0, exposure) : 1;
    // Presentation state only: renders into the HDR target are unaffected.
    this.renderer.toneMappingExposure = this.exposure;
  }

  setBloom(enabled: boolean, strength: number): void {
    const nextStrength = Number.isFinite(strength) ? Math.max(0, strength) : 0;
    if (enabled !== this.bloomEnabled) {
      this.bloomEnabled = enabled;
      // Toggle changes the graph shape (bloom cost must vanish when off).
      this.graphKey = null;
    }
    this.bloomStrength = nextStrength;
    if (this.bloomNode !== null) {
      this.bloomNode.strength.value = nextStrength;
    }
  }

  setCinematicStyle(enabled: boolean): void {
    const next = enabled === true;
    if (next === this.cinematicStyleEnabled) return;
    this.cinematicStyleEnabled = next;
    this.graphKey = null;
  }

  setToneMapping(mode: 'aces-filmic' | 'agx' | 'neutral' | 'linear'): void {
    // Presentation state only: three invalidates its output pipeline when
    // renderer.toneMapping changes, and never applies it to off-screen targets.
    this.renderer.toneMapping = TONE_MAPPING_CONSTANTS[mode];
  }

  /**
   * Render only materials tagged `userData.cinematicEmissive` into the
   * auxiliary target. The main scene is not mutated: camera layers are
   * restored synchronously and the target is cleared by the normal render.
   * A direct ray pass with no authored tag is reported as a legacy fallback
   * and may use the whole-image bloom source for compatibility.
   */
  renderSelectiveHighlights(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.highlightRendered = false;
    this.graphKey = null;
    if (this.disposed || this.highlightTarget === null || !this.bloomEnabled) return;

    let marked = 0;
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh & { isMesh?: boolean };
      if (!object.visible || mesh.isMesh !== true) return;
      const material = mesh.material;
      const materials = Array.isArray(material) ? material : [material];
      if (materials.some((entry) => entry.userData['cinematicEmissive'] === true)) {
        object.layers.enable(CINEMATIC_EMISSIVE_LAYER);
        marked += 1;
      }
    });
    if (marked === 0) return;

    const previousTarget = this.renderer.getRenderTarget();
    const previousMask = camera.layers.mask;
    try {
      camera.layers.set(CINEMATIC_EMISSIVE_LAYER);
      this.renderer.setRenderTarget(this.highlightTarget);
      this.renderer.render(scene, camera);
      this.highlightRendered = true;
    } finally {
      this.renderer.setRenderTarget(previousTarget as THREE.WebGLRenderTarget | null);
      camera.layers.mask = previousMask;
    }
  }

  clearSelectiveHighlights(): void {
    this.highlightRendered = false;
    this.graphKey = null;
  }

  present(transitionOverlay: THREE.Texture | null, transitionOpacity: number): void {
    if (this.disposed || this.hdrTarget === null) return;

    this.overlayTexture = transitionOverlay;
    this.overlayOpacityU.value = clamp01(transitionOpacity);

    this.syncGraphs();

    this.mesh.material = this.presentMaterial;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  captureSnapshot(): THREE.Texture | null {
    if (this.disposed || this.hdrTarget === null) return null;

    const width = this.hdrTarget.width;
    const height = this.hdrTarget.height;

    if (this.snapshotTarget === null) {
      this.snapshotTarget = this.createHdrTarget(width, height, 'SharedPost.Snapshot', false);
    } else if (this.snapshotTarget.width !== width || this.snapshotTarget.height !== height) {
      // Same tracked handle; byte estimate drifts slightly until disposal.
      this.snapshotTarget.setSize(width, height);
    }

    this.syncGraphs();

    // Raw copy: rendering into an off-screen target bypasses tone mapping
    // and color conversion, so the snapshot stays linear HDR.
    this.mesh.material = this.copyMaterial;
    this.renderer.setRenderTarget(this.snapshotTarget);
    this.renderer.render(this.scene, this.camera);
    return this.snapshotTarget.texture;
  }

  releaseSnapshot(): void {
    if (this.disposed || this.snapshotTarget === null) return;
    const target = this.snapshotTarget;
    this.snapshotTarget = null;
    this.releaseTarget(target);
  }

  /**
   * Execute the bounded r185 RenderPipeline/MRT spike against scratch targets.
   * This method is reached only by browser architecture tests; normal frames
   * stay on the explicit SharedPost lifecycle and never allocate these probes.
   */
  async runArchitectureSpikeForTest(): Promise<Record<string, unknown>> {
    if (this.disposed || this.hdrTarget === null) {
      return { status: 'not-ready' };
    }

    const renderer = this.renderer as RendererLike & {
      readRenderTargetPixelsAsync?: (
        target: THREE.RenderTarget,
        x: number,
        y: number,
        width: number,
        height: number,
        textureIndex?: number
      ) => Promise<ArrayLike<number>>;
      getMRT?: () => unknown;
      setMRT?: (mrtNode: unknown) => void;
    };
    if (typeof renderer.readRenderTargetPixelsAsync !== 'function') {
      return { status: 'unsupported', reason: 'readRenderTargetPixelsAsync unavailable' };
    }

    const readCenter = async (target: THREE.RenderTarget, textureIndex = 0): Promise<number[]> => {
      const data = await renderer.readRenderTargetPixelsAsync!(
        target,
        Math.floor(target.width / 2),
        Math.floor(target.height / 2),
        1,
        1,
        textureIndex
      );
      return Array.from(data).slice(0, 4);
    };

    const sourceTarget = this.hdrTarget;
    const copyTarget = new THREE.RenderTarget(sourceTarget.width, sourceTarget.height, {
      depthBuffer: false,
      stencilBuffer: false,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace
    });
    // The kernel intentionally exposes a union for its public fallback
    // contract, but both supported node paths use WebGPURenderer (forceWebGL
    // selects its WebGLBackend). The r185 RenderPipeline type is narrower.
    const pipeline = new RenderPipeline(
      renderer as unknown as import('three/webgpu').WebGPURenderer,
      texture(sourceTarget.texture)
    );
    pipeline.outputColorTransform = false;
    pipeline.needsUpdate = true;
    const previousTarget = renderer.getRenderTarget();
    let renderPipelineResult: Record<string, unknown>;
    try {
      renderer.setRenderTarget(copyTarget as THREE.WebGLRenderTarget);
      pipeline.render();
      renderPipelineResult = {
        status: 'pass',
        sourceChannels: await readCenter(sourceTarget),
        copyChannels: await readCenter(copyTarget),
        sourceType: sourceTarget.texture.type,
        copyType: copyTarget.texture.type
      };
    } catch (error) {
      renderPipelineResult = {
        status: 'fail',
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      renderer.setRenderTarget(previousTarget as THREE.WebGLRenderTarget | null);
      pipeline.dispose();
      copyTarget.dispose();
    }

    const mrtTarget = new THREE.RenderTarget(2, 2, {
      depthBuffer: false,
      stencilBuffer: false,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      count: 2,
      colorSpace: THREE.NoColorSpace
    });
    mrtTarget.textures[0]!.name = 'output';
    mrtTarget.textures[1]!.name = 'emissive';
    const mrtMaterial = new MeshBasicNodeMaterial();
    const output = vec4(2, 2, 2, 1);
    const emissive = vec4(4, 4, 4, 1);
    mrtMaterial.colorNode = output;
    mrtMaterial.mrtNode = mrt({ output, emissive });
    mrtMaterial.depthTest = false;
    mrtMaterial.depthWrite = false;
    const mrtScene = new THREE.Scene();
    const mrtCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mrtMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mrtMaterial);
    mrtScene.add(mrtMesh);
    let mrtResult: Record<string, unknown>;
    const previousMrt = renderer.getMRT?.();
    try {
      renderer.setMRT?.(null);
      renderer.setRenderTarget(mrtTarget as THREE.WebGLRenderTarget);
      renderer.render(mrtScene, mrtCamera);
      mrtResult = {
        status: 'pass',
        outputChannels: await readCenter(mrtTarget, 0),
        emissiveChannels: await readCenter(mrtTarget, 1),
        textureNames: mrtTarget.textures.map((entry) => entry.name),
        targetType: mrtTarget.texture.type
      };
    } catch (error) {
      mrtResult = {
        status: 'fail',
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      renderer.setRenderTarget(previousTarget as THREE.WebGLRenderTarget | null);
      renderer.setMRT?.(previousMrt);
      mrtScene.remove(mrtMesh);
      mrtMesh.geometry.dispose();
      mrtMaterial.dispose();
      mrtTarget.dispose();
    }

    return {
      status: 'complete',
      api: {
        renderPipeline: 'r185 RenderPipeline',
        mrt: 'r185 MRTNode/mrt()'
      },
      renderPipeline: renderPipelineResult,
      mrt: mrtResult,
      scratchMemoryBytes: sourceTarget.width * sourceTarget.height * 8 + 2 * 2 * 8 * 2
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.hdrTarget !== null) {
      const target = this.hdrTarget;
      this.hdrTarget = null;
      this.releaseTarget(target);
    }
    if (this.highlightTarget !== null) {
      const target = this.highlightTarget;
      this.highlightTarget = null;
      this.releaseTarget(target);
    }
    if (this.snapshotTarget !== null) {
      const snapshot = this.snapshotTarget;
      this.snapshotTarget = null;
      this.releaseTarget(snapshot);
    }
    if (this.volumeDepthRead !== null) {
      const target = this.volumeDepthRead;
      this.volumeDepthRead = null;
      this.releaseTarget(target);
    }
    if (this.volumeDepthWrite !== null) {
      const target = this.volumeDepthWrite;
      this.volumeDepthWrite = null;
      this.releaseTarget(target);
    }
    this.volumeDepthSource = null;
    this.volumeDepthValid = false;

    if (this.bloomNode !== null) {
      this.bloomNode.dispose();
      this.bloomNode = null;
    }
    this.graphKey = null;
    this.overlayTexture = null;

    this.temporal.dispose();
    this.presentMaterial.dispose();
    this.copyMaterial.dispose();
    this.depthCopyMaterial.dispose();
    this.triangleGeometry.dispose();
    this.scene.remove(this.mesh);
    this.depthCopyScene.remove(this.depthCopyMesh);
  }

  /**
   * Rebuilds the present/copy TSL graphs when the HDR texture, overlay
   * texture or bloom gate changed. Uniform values persist across rebuilds.
   */
  private syncGraphs(): void {
    if (this.hdrTarget === null) return;
    const hdrTexture = this.hdrTarget.texture;
    const temporalTexture = this.temporalPresentationActive
      ? this.temporal.getResolvedTexture()
      : null;
    const sceneTexture = temporalTexture ?? hdrTexture;
    const overlayTexture = this.overlayTexture;
    const highlightTexture = this.highlightTarget?.texture ?? null;
    const bloomSourceKind =
      this.highlightRendered && highlightTexture !== null ? 'selective' : 'legacy';

    const key = `${sceneTexture.id}|${hdrTexture.id}|${highlightTexture?.id ?? -1}|${overlayTexture !== null ? overlayTexture.id : -1}|${this.bloomEnabled ? 1 : 0}|${bloomSourceKind}|${this.cinematicStyleEnabled ? 1 : 0}`;
    if (key === this.graphKey) return;
    this.graphKey = key;

    // Raw copy graph for captureSnapshot().
    this.copyMaterial.fragmentNode = texture(sceneTexture);
    this.copyMaterial.needsUpdate = true;

    // Present graph: HDR -> (+ additive bloom) -> overlay lerp -> tonemap/sRGB
    // (the last step is the renderer's automatic canvas-present transform).
    const hdrNode = texture(sceneTexture);
    let rgb = hdrNode.rgb;

    if (this.bloomEnabled) {
      const bloomInput =
        bloomSourceKind === 'selective' && highlightTexture !== null
          ? texture(highlightTexture)
          : hdrNode;
      if (this.bloomNode === null) {
        this.bloomNode = bloom(bloomInput, this.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
      } else {
        this.bloomNode.inputNode = bloomInput;
      }
      this.bloomNode.strength.value = this.bloomStrength;
      this.bloomNode.radius.value = BLOOM_RADIUS;
      this.bloomNode.threshold.value = BLOOM_THRESHOLD;
      rgb = rgb.add(this.bloomNode.rgb);
    } else if (this.bloomNode !== null) {
      this.bloomNode.dispose();
      this.bloomNode = null;
    }

    if (overlayTexture !== null) {
      rgb = mix(rgb, texture(overlayTexture).rgb, this.overlayOpacityU);
    }

    if (this.cinematicStyleEnabled) {
      // Display-only finishing pass. The lift/contrast/warmth/vignette and
      // seeded static grain are deliberately applied after bloom and before
      // the renderer's output transform. The branch is graph-build-time, so
      // Scientific/Debug do not pay for cinematic grading at all.
      const centered = screenUV.sub(0.5);
      const vignette = clamp(
        float(1).sub(length(vec2(centered.x.mul(1.12), centered.y.mul(1.12))).mul(0.42)),
        0.74,
        1
      );
      const luminance = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      const lifted = rgb.sub(vec3(0.18)).mul(1.06).add(vec3(0.18));
      const warm = lifted.mul(vec3(1.035, 1.0, 0.975)).mul(vignette);
      const grain = hash(screenUV.x.mul(173.17).add(screenUV.y.mul(311.71)))
        .sub(0.5)
        .mul(0.012)
        .mul(luminance.add(0.18).clamp(0, 4));
      rgb = warm.add(vec3(grain, grain, grain));
    }

    this.presentMaterial.colorNode = vec4(rgb, 1);
    this.presentMaterial.needsUpdate = true;
  }

  private createHdrTarget(
    width: number,
    height: number,
    name = 'SharedPost.HDR',
    withDepth = true
  ): THREE.WebGLRenderTarget {
    const depthTexture = withDepth ? new THREE.DepthTexture(width, height) : null;
    if (depthTexture !== null) {
      depthTexture.name = `${name}.Depth`;
      depthTexture.colorSpace = THREE.NoColorSpace;
    }
    // WebGLRenderTarget extends RenderTarget and is accepted by both
    // WebGPURenderer and WebGLRenderer. RGBA16F is natively renderable on
    // WebGPU and on WebGL2 with float-buffer extensions (required by the
    // backend's own intermediate targets anyway).
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: withDepth,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.NoColorSpace,
      depthTexture
    });
    target.texture.name = name;
    // ~12 bytes/px: 4 channels x half float + 4-byte depth estimate.
    this.scope.track('renderTarget', target, () => target.dispose(), width * height * 12);
    return target;
  }

  private ensureVolumeDepthTargets(width: number, height: number): void {
    if (
      this.volumeDepthRead !== null &&
      this.volumeDepthWrite !== null &&
      this.volumeDepthRead.width === width &&
      this.volumeDepthRead.height === height &&
      this.volumeDepthWrite.width === width &&
      this.volumeDepthWrite.height === height
    ) {
      return;
    }
    const previousRead = this.volumeDepthRead;
    const previousWrite = this.volumeDepthWrite;
    this.volumeDepthRead = this.createVolumeDepthTarget(width, height, 'SharedPost.Depth.Read');
    this.volumeDepthWrite = this.createVolumeDepthTarget(width, height, 'SharedPost.Depth.Write');
    if (previousRead !== null) this.releaseTarget(previousRead);
    if (previousWrite !== null) this.releaseTarget(previousWrite);
    this.volumeDepthSource = null;
    this.volumeDepthValid = false;
  }

  private createVolumeDepthTarget(
    width: number,
    height: number,
    name: string
  ): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      colorSpace: THREE.NoColorSpace
    });
    target.texture.name = name;
    this.scope.track('renderTarget', target, () => target.dispose(), width * height * 8);
    return target;
  }

  private createAuxiliaryTarget(
    width: number,
    height: number,
    name: string
  ): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.NoColorSpace
    });
    target.texture.name = name;
    // Four FP16 color channels plus a conservative 4-byte depth estimate.
    this.scope.track('renderTarget', target, () => target.dispose(), width * height * 12);
    return target;
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      stages: [
        'scene-hdr',
        this.temporal.getDebugSnapshot().enabled ? 'temporal-resolve' : 'temporal-resolve:off',
        'selective-bloom',
        'transition-composite',
        'display-transform',
        'cinematic-grade'
      ],
      hdrTarget:
        this.hdrTarget === null
          ? null
          : {
              width: this.hdrTarget.width,
              height: this.hdrTarget.height,
              type: this.hdrTarget.texture.type,
              colorSpace: this.hdrTarget.texture.colorSpace
            },
      highlightTarget:
        this.highlightTarget === null
          ? null
          : {
              width: this.highlightTarget.width,
              height: this.highlightTarget.height,
              type: this.highlightTarget.texture.type,
              colorSpace: this.highlightTarget.texture.colorSpace
            },
      highlightRendered: this.highlightRendered,
      bloomEnabled: this.bloomEnabled,
      bloomSource: this.highlightRendered ? 'selective-emissive' : 'legacy-scene-threshold',
      bloomResolutionScale: this.bloomResolutionScale,
      cinematicStyleEnabled: this.cinematicStyleEnabled,
      volumeDepthHistory:
        this.volumeDepthRead === null || this.volumeDepthWrite === null
          ? null
          : {
              valid: this.volumeDepthValid,
              size: [this.volumeDepthRead.width, this.volumeDepthRead.height],
              type: this.volumeDepthRead.texture.type,
              allocatedTargetCount: 2
            },
      temporal: this.temporal.getDebugSnapshot()
    };
  }

  private releaseTarget(target: THREE.WebGLRenderTarget): void {
    try {
      // The registered disposer calls target.dispose().
      this.scope.release(target);
    } catch {
      // Scope already disposed or handle unknown; still free the GPU object.
      target.dispose();
    }
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

const TEMPORAL_RESET_REASONS: ReadonlySet<string> = new Set([
  'initial',
  'route-change',
  'preset-change',
  'timeline-discontinuity',
  'camera-cut',
  'resize',
  'render-scale-change',
  'quality-tier-change',
  'backend-change',
  'pass-variant-change',
  'transition-handoff',
  'material-change',
  'explicit'
]);

function isTemporalResetReason(value: string): value is TemporalResetReason {
  return TEMPORAL_RESET_REASONS.has(value);
}
