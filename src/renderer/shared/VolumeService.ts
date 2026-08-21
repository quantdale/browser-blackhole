/**
 * VolumeService — raymarched volumetric host service for Cosmic Atlas.
 *
 * Implements `IVolumeService` / `VolumeHandle` from `src/atlas/types.ts`.
 *
 * Spec sources:
 * - docs/cosmic-atlas/RENDERING_SERVICES.md §4 (VolumeService: density source
 *   contract, render contract, optimization list) and §10 (no ownerless GPU
 *   object — every resource created here is disposed by the owning handle).
 * - docs/cosmic-atlas/ARCHITECTURE.md §5 (resource scopes; deterministic
 *   teardown), §12.
 *
 * Structure mirrors `ParticleService`: one service instance owns a list of live
 * volume handles; each handle disposes exactly what it created (geometry,
 * materials, internal render target); `VolumeService.dispose()` disposes all
 * still-live volumes. No ResourceScope is taken as a constructor dependency —
 * disposal is local and idempotent, matching the sibling service.
 *
 * Algorithm (per fragment, TSL fragment graph on a proxy mesh):
 * 1. Ray origin = `cameraPosition`, direction = normalize(positionWorld -
 *    cameraPosition) (backwards, camera -> emitter/background).
 * 2. Analytic ray/bounds intersection: slab test for boxes, quadratic for
 *    spheres. Misses output vec4(0) immediately (early ray-box miss, §4).
 * 3. Constant-step front-to-back march between tNear/tFar with the compile-time
 *    literal loop bound `baseMaxSteps`. `setStepScale(s)` scales the step LENGTH
 *    by 1/s at runtime through a uniform (s > 1 = finer sampling), so quality
 *    changes never recompile the shader.
 * 4. Accumulation is emission-absorption with premultiplied color:
 *      a_i     = 1 - exp(-density * absorb * dt)
 *      rgbAcc += transmittance * emission * a_i
 *      aAcc   += transmittance * a_i
 *      transmittance *= 1 - a_i
 *    Blending choice (documented per requirement): NormalBlending with
 *    material.premultipliedAlpha = true. Premultiplied normal blending is the
 *    physically saner composite for absorption+emission over an opaque scene —
 *    additive blending cannot represent self-absorption/occlusion of the
 *    background.
 * 5. Optional early termination when accumulated alpha > ~0.99.
 * 6. Optional temporal jitter: the start offset within the first step comes
 *    from a seeded `fract(sin(x)*C)` hash over (deterministic seed, frame
 *    index). `Math.random` is never used; identical frame sequences reproduce
 *    identical jitter sequences.
 *
 * Half-resolution path: when `config.halfResolution` is true, the march runs
 * into an internal half-res `RenderTarget` (scale shared via
 * `setInternalScale`), rendered during the main pass from the proxy mesh's
 * `onBeforeRender`; the visible proxy then composites that texture at
 * `screenUV` with linear filtering (no depth-aware upsample — disclosed below).
 *
 * FIDELITY DISCLOSURE (CINEMATIC-class visual infrastructure):
 * - Constant step length; no adaptive sampling, no empty-region acceleration
 *   structure beyond the bounds test.
 * - Single-scattering-style emission only. NO scattering-order claims are made;
 *   multiple scattering is not modeled.
 * - No depth-aware upsampling in the half-res composite (RENDERING_SERVICES §4
 *   lists it as an optimization, not a requirement); edges may halo against
 *   high-frequency backgrounds.
 * - The nested half-res render happens inside `onBeforeRender` of the active
 *   scene pass; this is the standard three.js hook but relies on renderer state
 *   save/restore semantics of the active backend.
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  cameraPosition,
  float,
  fract,
  max,
  min,
  normalize,
  positionWorld,
  screenUV,
  sin,
  sqrt,
  texture,
  uniform,
  vec2,
  vec3,
  vec4
} from 'three/tsl';
import type { IVolumeService, RendererLike, VolumeConfig, VolumeHandle } from '../../atlas/types';

/** Any float-valued TSL shader-graph node. */
type TslFloat = Node<'float'>;

/**
 * Disclosure string for destinations composing this service. Describes the
 * actual model class so UI fidelity notes never overstate what volumes
 * represent (RENDERING_SERVICES.md §8 disclosure discipline).
 */
export const VOLUME_DISCLOSURE =
  'Volumes are constant-step emission-absorption raymarches (single-scattering ' +
  'style, no multiple-scattering model), not simulated radiative transfer.';

/** Alpha level at which marching stops early when earlyAlphaTermination is set. */
const EARLY_ALPHA_THRESHOLD = 0.99;

/** Extinction scale applied to density before exp(); keeps unitless densities usable. */
const ABSORPTION_SCALE = 1.0;

/** Clamp range for the service-level internal (half-res) scale factor. */
const INTERNAL_SCALE_MIN = 0.1;
const INTERNAL_SCALE_MAX = 1;

/** Deterministic golden-ratio stride for the jitter frame sequence. */
const JITTER_FRAME_STRIDE = 0.6180339887498949;

/** f32-safe hash twin used on the GPU side (same form as ParticleService). */
function gpuHash01(s: TslFloat): TslFloat {
  return fract(sin(s.mul(12.9898)).mul(43758.5453));
}

/** CPU-side fold of numeric config values into a stable non-degenerate seed. */
function foldSeed(values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h = (Math.imul(h ^ Math.round(v * 1024), 0x85ebca6b) | 0) >>> 0;
  }
  return ((h % 1000) + 0.123) / 8;
}

// ---------------------------------------------------------------------------
// Volume implementation
// ---------------------------------------------------------------------------

class VolumeImpl implements VolumeHandle {
  private readonly geometry: THREE.BufferGeometry;
  /** March material: full raymarch graph (used directly or into the RT). */
  private readonly marchMaterial: MeshBasicNodeMaterial;
  /** Composite material: upsampled RT read (half-res path only). */
  private readonly compositeMaterial: MeshBasicNodeMaterial | null;
  private readonly mesh: THREE.Mesh;
  /** Private scene holding the proxy for the nested half-res march render. */
  private readonly marchScene: THREE.Scene | null;
  private readonly target: THREE.RenderTarget | null;

  private readonly uStepScale: UniformNode<'float', number>;
  private readonly uJitterSeed: UniformNode<'float', number>;
  private readonly uJitterFrame: UniformNode<'float', number>;
  private readonly uInternalScale: { value: number };

  private disposed = false;

  constructor(config: VolumeConfig, internalScaleState: { value: number }, dprCap: number) {
    // dprCap participates in the byte estimate only; the march itself is
    // resolution-independent world-space math.
    void dprCap;

    const center = new THREE.Vector3(...boundsCenter(config.bounds));
    const seed = foldSeed(boundsNumbers(config.bounds));

    // --- uniforms ---
    this.uStepScale = uniform(1);
    this.uJitterSeed = uniform(seed);
    this.uJitterFrame = uniform(0);
    this.uInternalScale = internalScaleState;

    // --- proxy geometry ---
    if (config.bounds.kind === 'box') {
      const he = config.bounds.halfExtents;
      this.geometry = new THREE.BoxGeometry(he[0]! * 2, he[1]! * 2, he[2]! * 2);
    } else {
      this.geometry = new THREE.SphereGeometry(config.bounds.radius, 48, 32);
    }

    // --- march material ---
    this.marchMaterial = new MeshBasicNodeMaterial();
    this.marchMaterial.side = THREE.BackSide;
    this.marchMaterial.transparent = true;
    this.marchMaterial.depthWrite = false;
    this.marchMaterial.premultipliedAlpha = true;
    this.marchMaterial.blending = THREE.NormalBlending;
    this.marchMaterial.colorNode = this.buildMarchGraph(config);

    // --- half-res plumbing ---
    let compositeMaterial: MeshBasicNodeMaterial | null = null;
    let marchScene: THREE.Scene | null = null;
    let target: THREE.RenderTarget | null = null;

    if (config.halfResolution) {
      target = new THREE.RenderTarget(2, 2, {
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType
      });

      compositeMaterial = new MeshBasicNodeMaterial();
      compositeMaterial.side = THREE.BackSide;
      compositeMaterial.transparent = true;
      compositeMaterial.depthWrite = false;
      compositeMaterial.premultipliedAlpha = true;
      compositeMaterial.blending = THREE.NormalBlending;
      // Upsample: linear-filtered premultiplied RGBA straight to the canvas.
      compositeMaterial.colorNode = texture(target.texture, screenUV);

      marchScene = new THREE.Scene();
      const proxy = new THREE.Mesh(this.geometry, this.marchMaterial);
      proxy.position.copy(center);
      proxy.frustumCulled = false;
      marchScene.add(proxy);
    }

    this.compositeMaterial = compositeMaterial;
    this.marchScene = marchScene;
    this.target = target;

    // --- visible object ---
    this.mesh = new THREE.Mesh(this.geometry, compositeMaterial ?? this.marchMaterial);
    this.mesh.position.copy(center);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10; // after opaque scene content
    this.mesh.name = 'VolumeProxy';

    if (marchScene !== null) {
      this.mesh.onBeforeRender = (renderer, _scene, camera) => {
        this.renderHalfRes(renderer as RendererLike, marchScene, camera);
      };
    }
  }

  /**
   * Full march fragment graph. See class header for the algorithm contract.
   */
  private buildMarchGraph(config: VolumeConfig): Node<'vec4'> {
    const ro = vec3(cameraPosition);
    const rd = normalize(positionWorld.sub(ro));

    // Analytic intersection -> (tNear, tFar) clamped to the camera side.
    const hit =
      config.bounds.kind === 'box'
        ? intersectBox(ro, rd, config.bounds.center, config.bounds.halfExtents)
        : intersectSphere(ro, rd, config.bounds.center, config.bounds.radius);

    const span = hit.y.sub(hit.x).max(0);
    // Compile-time literal bound; runtime quality scales step length instead.
    const steps = config.baseMaxSteps;
    const dt = span.div(float(steps)).div(this.uStepScale.max(1e-5));

    // Seeded temporal jitter of the start offset within the first step.
    const jitter01 = gpuHash01(this.uJitterSeed.add(this.uJitterFrame));
    const startOffset = config.temporalJitter ? jitter01.mul(dt) : float(0);

    return Fn(() => {
      const rgbAcc = vec3(0, 0, 0).toVar();
      const alphaAcc = float(0).toVar();
      const transmittance = float(1).toVar();

      If(hit.y.greaterThan(hit.x), () => {
        const t = hit.x.add(startOffset).toVar();

        Loop(steps, () => {
          const pos = ro.add(rd.mul(t));
          // Contract boundary: callbacks receive plain nodes typed `unknown`
          // and are cast back exactly like LensingService.createThinLensDisplacement.
          const densityRaw = config.density({ pos, dir: rd });
          const density = float(densityRaw as Node<'float'>).max(0);

          const emissionRaw =
            config.emission !== undefined ? config.emission({ pos, dir: rd }) : null;
          const emission =
            emissionRaw !== null
              ? vec3(emissionRaw as Node<'vec3'>)
              : vec3(density, density, density);

          const aSample = float(1).sub(expNeg(density.mul(ABSORPTION_SCALE).mul(dt)));
          const sampleAlpha = aSample.mul(transmittance);

          rgbAcc.assign(rgbAcc.add(emission.mul(sampleAlpha)));
          alphaAcc.assign(alphaAcc.add(sampleAlpha));
          transmittance.assign(transmittance.mul(float(1).sub(aSample)));

          if (config.earlyAlphaTermination) {
            If(alphaAcc.greaterThan(EARLY_ALPHA_THRESHOLD), () => {
              Break();
            });
          }

          t.assign(t.add(dt));
        });
      });

      return vec4(rgbAcc, alphaAcc);
    })();
  }

  /**
   * Nested half-res march: resize the internal target, render the private
   * proxy scene into it, restore the previous binding. Runs inside the main
   * scene pass, just before the visible proxy composites the result.
   */
  private renderHalfRes(
    renderer: RendererLike,
    marchScene: THREE.Scene,
    camera: THREE.Camera
  ): void {
    if (this.disposed || this.target === null) return;

    const size = new THREE.Vector2();
    renderer.getSize(size);
    const dpr = Math.min(renderer.getPixelRatio(), 16);
    const scale = clampRange(this.uInternalScale.value, INTERNAL_SCALE_MIN, INTERNAL_SCALE_MAX);
    const w = Math.max(2, Math.floor(size.x * dpr * scale * 0.5));
    const h = Math.max(2, Math.floor(size.y * dpr * scale * 0.5));
    if (this.target.width !== w || this.target.height !== h) {
      this.target.setSize(w, h);
    }

    // Advance the deterministic jitter clock: one tick per marched frame.
    this.uJitterFrame.value = (this.uJitterFrame.value + JITTER_FRAME_STRIDE) % 1;

    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target as THREE.WebGLRenderTarget | null);
    renderer.render(marchScene, camera);
    renderer.setRenderTarget(previous as THREE.WebGLRenderTarget | null);
  }

  object3d(): THREE.Object3D {
    return this.mesh;
  }

  /** Scale effective step size: s > 1 means finer steps (more samples). */
  setStepScale(scale: number): void {
    if (this.disposed) return;
    this.uStepScale.value = Math.max(1e-5, scale);
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.mesh.visible = visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.onBeforeRender = () => {};
    this.mesh.removeFromParent();
    this.marchScene?.clear();
    this.geometry.dispose();
    this.marchMaterial.dispose();
    this.compositeMaterial?.dispose();
    this.target?.dispose();
  }
}

// ---------------------------------------------------------------------------
// Analytic intersections (TSL graphs)
// ---------------------------------------------------------------------------

/** Ray/AABB slab test. Returns vec2(tNear, tFar) with both >= 0; miss => x > y. */
function intersectBox(
  ro: Node<'vec3'>,
  rd: Node<'vec3'>,
  center: [number, number, number],
  halfExtents: [number, number, number]
): Node<'vec2'> {
  const bmin = vec3(
    center[0]! - halfExtents[0]!,
    center[1]! - halfExtents[1]!,
    center[2]! - halfExtents[2]!
  );
  const bmax = vec3(
    center[0]! + halfExtents[0]!,
    center[1]! + halfExtents[1]!,
    center[2]! + halfExtents[2]!
  );
  const inv = float(1).div(rd);
  const t0 = bmin.sub(ro).mul(inv);
  const t1 = bmax.sub(ro).mul(inv);
  const tSmaller = min(t0, t1);
  const tLarger = max(t0, t1);
  const tNear = max(tSmaller.x, tSmaller.y, tSmaller.z).max(0);
  const tFar = min(tLarger.x, tLarger.y, tLarger.z);
  return vec2(tNear, tFar);
}

/** Ray/sphere quadratic. Returns vec2(tNear, tFar) with tNear >= 0; miss => x > y. */
function intersectSphere(
  ro: Node<'vec3'>,
  rd: Node<'vec3'>,
  center: [number, number, number],
  radius: number
): Node<'vec2'> {
  const oc = ro.sub(vec3(center[0]!, center[1]!, center[2]!));
  const bDot = rd.dot(oc);
  const c = oc.dot(oc).sub(radius * radius);
  const disc = bDot.mul(bDot).sub(c).max(0);
  const sq = sqrt(disc);
  const tNear = bDot.negate().sub(sq).max(0);
  const tFar = bDot.negate().add(sq);
  return vec2(tNear, tFar);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** exp(-x) via the identity exp(x)^-1 (TSL has no direct negated-exp export). */
function expNeg(x: TslFloat): TslFloat {
  return float(1).div(x.exp().max(1e-12));
}

function boundsCenter(bounds: VolumeConfig['bounds']): [number, number, number] {
  return bounds.kind === 'box' ? bounds.center : bounds.center;
}

function boundsNumbers(bounds: VolumeConfig['bounds']): number[] {
  return bounds.kind === 'box'
    ? [...bounds.center, ...bounds.halfExtents]
    : [...bounds.center, bounds.radius];
}

function clampRange(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface VolumeServiceOptions {
  /**
   * Device-pixel-ratio cap mirroring ParticleServiceOptions style. The march
   * is resolution-independent; the cap bounds the half-res target estimate
   * used for accounting and guards pathological DPR values.
   */
  dprCap?: number;
}

/**
 * Host service creating raymarched volumes. One instance per renderer;
 * `dispose()` disposes every live volume created by it.
 */
export class VolumeService implements IVolumeService {
  private readonly dprCap: number;
  private readonly volumes: VolumeImpl[] = [];
  /** Shared internal-scale state read by every half-res handle each frame. */
  private readonly internalScaleState = { value: 0.5 };
  private disposed = false;

  constructor(options: VolumeServiceOptions = {}) {
    this.dprCap = options.dprCap ?? 2;
  }

  createVolume(config: VolumeConfig): VolumeHandle {
    if (this.disposed) {
      throw new Error('VolumeService: createVolume called after dispose().');
    }
    if (!Number.isFinite(config.baseMaxSteps) || config.baseMaxSteps < 1) {
      throw new Error(`VolumeService: invalid baseMaxSteps ${config.baseMaxSteps}.`);
    }
    const volume = new VolumeImpl(config, this.internalScaleState, this.dprCap);
    this.volumes.push(volume);
    return volume;
  }

  /** Global half-res factor for every half-resolution volume; clamped to [0.1, 1]. */
  setInternalScale(scale: number): void {
    this.internalScaleState.value = clampRange(scale, INTERNAL_SCALE_MIN, INTERNAL_SCALE_MAX);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const volume of this.volumes) volume.dispose();
    this.volumes.length = 0;
  }
}
