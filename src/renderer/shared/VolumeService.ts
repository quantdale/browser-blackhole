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
 * 3. Constant-step front-to-back march between tNear/tFar with a compile-time
 *    upper bound and a runtime active-step guard. `setStepScale(s)` changes
 *    the number of executed density/emission evaluations, while the active
 *    samples still span the same analytic interval.
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
 * `screenUV` with an alpha/depth-guided bilateral filter when requested.
 * Because emission is linear radiance, this target is RGBA16F by default.
 * `hdrIntermediate: false` is an explicit opt-down for an LDR-safe effect.
 *
 * FIDELITY DISCLOSURE (CINEMATIC-class visual infrastructure):
 * - Constant step length; no adaptive sampling, no empty-region acceleration
 *   structure beyond the bounds test.
 * - Single-scattering-style emission only. NO scattering-order claims are made;
 *   multiple scattering is not modeled.
 * - Depth awareness uses a staged PREVIOUS-frame scene-depth copy owned by
 *   SharedPost. The first frame and every invalidation conservatively fall
 *   back to alpha-guided filtering; this avoids sampling the active depth
 *   attachment while it is being written.
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
  cameraProjectionMatrix,
  cameraPosition,
  cameraViewMatrix,
  float,
  fract,
  max,
  min,
  mx_fractal_noise_float,
  normalize,
  positionWorld,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  vec2,
  vec3,
  vec4
} from 'three/tsl';
import type { IVolumeService, RendererLike, VolumeConfig, VolumeHandle } from '../../atlas/types';
import { CINEMATIC_EMISSIVE_LAYER } from './visualLayers.js';

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
  private readonly intermediateType: THREE.TextureDataType | null;
  private readonly intermediateFormat: 'rgba16f' | 'rgba8' | null;
  private readonly uDetailOctaves: UniformNode<'float', number>;
  private readonly detailOctaveCeiling: number;
  private readonly uLightingTaps: UniformNode<'float', number>;
  private readonly uJitterEnabled: UniformNode<'float', number>;
  private readonly uDepthValid: UniformNode<'float', number>;
  private readonly depthTextureState: { value: THREE.Texture | null };
  private readonly emptyDepthTexture = new THREE.Texture();
  private readonly depthTextureNode: ReturnType<typeof texture> | null;
  private readonly compositeTexelSize: UniformNode<'vec2', THREE.Vector2> = uniform(
    new THREE.Vector2(0.5, 0.5)
  );

  private readonly uStepScale: UniformNode<'float', number>;
  private readonly uActiveSteps: UniformNode<'float', number>;
  private readonly uJitterSeed: UniformNode<'float', number>;
  private readonly uJitterFrame: UniformNode<'float', number>;
  private readonly uInternalScale: { value: number };
  private readonly baseMaxSteps: number;
  private activeStepCount: number;
  private visible = true;
  private readonly rendererSizeScratch = new THREE.Vector2();

  private disposed = false;

  constructor(
    config: VolumeConfig,
    internalScaleState: { value: number },
    dprCap: number,
    depthTextureState: { value: THREE.Texture | null }
  ) {
    // dprCap participates in the byte estimate only; the march itself is
    // resolution-independent world-space math.
    void dprCap;

    const center = new THREE.Vector3(...boundsCenter(config.bounds));
    const seed = foldSeed(boundsNumbers(config.bounds));

    // --- uniforms ---
    this.uStepScale = uniform(1);
    this.baseMaxSteps = Math.max(1, Math.floor(config.baseMaxSteps));
    this.activeStepCount = this.baseMaxSteps;
    this.uActiveSteps = uniform(this.activeStepCount);
    this.uJitterSeed = uniform(seed);
    this.uJitterFrame = uniform(0);
    this.uJitterEnabled = uniform(config.temporalJitter ? 1 : 0);
    this.uDepthValid = uniform(0);
    this.detailOctaveCeiling =
      config.detail === undefined ? 1 : clampInt(config.detail.octaves ?? 3, 1, 5);
    this.uDetailOctaves = uniform(this.detailOctaveCeiling);
    this.uLightingTaps = uniform(
      config.approximateSelfShadow ? clampInt(config.approximateSelfShadow ? 1 : 0, 0, 2) : 0
    );
    this.depthTextureState = depthTextureState;
    this.depthTextureNode = config.depthAwareUpsample ? texture(this.emptyDepthTexture) : null;
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
    this.marchMaterial.userData['cinematicEmissive'] = true;
    this.marchMaterial.colorNode = this.buildMarchGraph(config);

    // --- half-res plumbing ---
    let compositeMaterial: MeshBasicNodeMaterial | null = null;
    let marchScene: THREE.Scene | null = null;
    let target: THREE.RenderTarget | null = null;
    let intermediateType: THREE.TextureDataType | null = null;
    let intermediateFormat: 'rgba16f' | 'rgba8' | null = null;

    if (config.halfResolution) {
      const hdrIntermediate = config.hdrIntermediate !== false;
      intermediateType = hdrIntermediate ? THREE.HalfFloatType : THREE.UnsignedByteType;
      intermediateFormat = hdrIntermediate ? 'rgba16f' : 'rgba8';
      target = new THREE.RenderTarget(2, 2, {
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: intermediateType,
        colorSpace: THREE.NoColorSpace
      });

      compositeMaterial = new MeshBasicNodeMaterial();
      // The nested march intentionally uses BackSide so a camera outside the
      // bounds shades the far surface. The visible composite must also work
      // when the camera is inside the volume; culling its front-facing proxy
      // would drop the otherwise-valid HDR texture before SharedPost.
      compositeMaterial.side = THREE.DoubleSide;
      compositeMaterial.transparent = true;
      compositeMaterial.depthWrite = false;
      compositeMaterial.premultipliedAlpha = true;
      compositeMaterial.blending = THREE.NormalBlending;
      compositeMaterial.userData['cinematicEmissive'] = true;
      // Upsample: linear-filtered premultiplied RGBA straight to the canvas.
      compositeMaterial.colorNode = texture(target.texture, screenUV);
      if (this.depthTextureNode !== null) {
        compositeMaterial.colorNode = this.buildCompositeGraph(target.texture);
      }

      marchScene = new THREE.Scene();
      const proxy = new THREE.Mesh(this.geometry, this.marchMaterial);
      proxy.position.copy(center);
      proxy.layers.enable(CINEMATIC_EMISSIVE_LAYER);
      proxy.frustumCulled = false;
      marchScene.add(proxy);
    }

    this.compositeMaterial = compositeMaterial;
    this.marchScene = marchScene;
    this.target = target;
    this.intermediateType = intermediateType;
    this.intermediateFormat = intermediateFormat;

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
    // Compile-time upper bound plus a runtime active count. Quality changes
    // now guard the expensive density/emission callback itself; dt remains
    // normalized to the full analytic ray interval.
    const steps = this.baseMaxSteps;
    const activeSteps = this.uActiveSteps.clamp(1, steps);
    const dt = span.div(activeSteps);

    // Seeded temporal jitter of the start offset within the first step.
    const jitter01 = gpuHash01(this.uJitterSeed.add(this.uJitterFrame));
    const startOffset = this.uJitterEnabled.mul(jitter01).mul(dt);

    return Fn(() => {
      const rgbAcc = vec3(0, 0, 0).toVar();
      const alphaAcc = float(0).toVar();
      const transmittance = float(1).toVar();

      If(hit.y.greaterThan(hit.x), () => {
        const t = hit.x.add(startOffset).toVar();

        Loop({ start: 0, end: steps, type: 'int', condition: '<' }, ({ i }) => {
          If(float(i).lessThan(activeSteps), () => {
            const pos = ro.add(rd.mul(t));
            // Contract boundary: callbacks receive plain nodes typed `unknown`
            // and are cast back exactly like LensingService.createThinLensDisplacement.
            const densityRaw = config.density({ pos, dir: rd });
            let density: Node<'float'> = float(densityRaw as Node<'float'>).max(0);
            let detailFactor: Node<'float'> = float(1);
            if (config.detail !== undefined) {
              detailFactor = this.buildDetailFactor(pos, config);
              density = density.mul(detailFactor);
            }

            const emissionRaw =
              config.emission !== undefined ? config.emission({ pos, dir: rd }) : null;
            let emission: Node<'vec3'> =
              emissionRaw !== null
                ? vec3(emissionRaw as Node<'vec3'>)
                : vec3(density, density, density);
            if (config.detail !== undefined) {
              // Density controls optical depth; a softer radiance response
              // keeps detail visible without turning every structured field
              // into a saturated white mask.
              emission = emission.mul(detailFactor.pow(0.45));
            }

            if (this.depthTextureNode !== null) {
              // Conservative previous-frame depth clip. The staged map is
              // explicitly invalidated on discontinuities, and a small depth
              // bias keeps the volume from disappearing at coplanar edges.
              const clipPosition = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(pos, 1)));
              const sampleDepth = clipPosition.z.div(clipPosition.w.max(1e-6)).mul(0.5).add(0.5);
              const sceneDepth = this.depthTextureNode.sample(screenUV).r;
              const depthGate = select(
                this.uDepthValid.greaterThan(0.5),
                select(sampleDepth.lessThan(sceneDepth.add(0.003)), float(1), float(0)),
                float(1)
              );
              density = density.mul(depthGate);
            }

            if (config.gradientShading === true) {
              const forwardDensity = float(
                config.density({ pos: pos.add(rd.mul(dt)), dir: rd }) as Node<'float'>
              ).max(0);
              const frontFactor = forwardDensity.sub(density).mul(0.12).add(0.92).clamp(0.78, 1.16);
              emission = emission.mul(frontFactor);
            }

            if (config.approximateSelfShadow === true) {
              const shadow = float(1).toVar();
              for (let tap = 1; tap <= 2; tap += 1) {
                const shadowDensity = float(
                  config.density({
                    pos: pos.add(rd.mul(dt.mul(tap * 2))),
                    dir: rd
                  }) as Node<'float'>
                ).max(0);
                If(this.uLightingTaps.greaterThanEqual(tap), () => {
                  shadow.assign(shadow.mul(expNeg(shadowDensity.mul(dt).mul(0.35))));
                });
              }
              emission = emission.mul(shadow.mul(0.72).add(0.28));
            }

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
      });

      return vec4(rgbAcc, alphaAcc);
    })();
  }

  /**
   * Compose a bounded presentation detail factor over the destination's
   * authoritative macro density. The octaves are selected by a uniform so the
   * global work budget can reduce work without rebuilding the destination
   * graph; every branch has a compile-time ceiling of five octaves.
   */
  private buildDetailFactor(pos: Node<'vec3'>, config: VolumeConfig): Node<'float'> {
    const detail = config.detail;
    if (detail === undefined) return float(1);
    const center = config.bounds.kind === 'sphere' ? config.bounds.center : config.bounds.center;
    const scale =
      config.bounds.kind === 'sphere'
        ? Math.max(config.bounds.radius, 1e-3)
        : Math.max(...config.bounds.halfExtents, 1e-3);
    const seed = foldSeed([detail.seed]);
    const frequency = Number.isFinite(detail.frequency)
      ? Math.max(0.05, Math.min(12, detail.frequency!))
      : 2.4;
    const local = pos.sub(vec3(center[0]!, center[1]!, center[2]!)).div(scale);
    const warpNoise = mx_fractal_noise_float(
      local.mul(frequency * 0.45).add(seed * 0.007),
      2,
      2.0,
      0.5
    )
      .mul(2)
      .sub(1);
    const warp = detail.domainWarpStrength ?? 0;
    const warped = local.add(
      vec3(
        warpNoise.mul(Math.min(Math.max(warp, 0), 0.5)),
        warpNoise.mul(-0.63),
        warpNoise.mul(0.41)
      )
    );

    const octaveNoise = mx_fractal_noise_float(warped.mul(frequency).add(seed * 0.013), 1, 2.0, 0.5)
      .mul(0.5)
      .add(0.5)
      .toVar();
    const maxDetailOctaves = this.detailOctaveCeiling;
    for (let octave = 2; octave <= maxDetailOctaves; octave += 1) {
      const candidate = mx_fractal_noise_float(
        warped.mul(frequency).add(seed * 0.013),
        octave,
        2.0,
        0.5
      )
        .mul(0.5)
        .add(0.5);
      If(this.uDetailOctaves.greaterThanEqual(octave), () => {
        octaveNoise.assign(candidate);
      });
    }

    const ridged = float(1).sub(octaveNoise.mul(2).sub(1).abs()).pow(1.8);
    const clumpNoise = mx_fractal_noise_float(
      warped.mul(frequency * 0.62).add(seed * 0.031 + 17.3),
      2,
      2.0,
      0.5
    )
      .mul(0.5)
      .add(0.5);
    const clumps = smoothstep(0.56, 0.86, clumpNoise);
    const strength = Math.max(0, Math.min(1, detail.strength ?? 0.22));
    const filamentStrength = Math.max(0, Math.min(1, detail.filamentStrength ?? 0));
    const clumpStrength = Math.max(0, Math.min(1, detail.clumpStrength ?? 0));
    return octaveNoise
      .sub(0.5)
      .mul(strength)
      .add(ridged.mul(filamentStrength * 0.8))
      .add(clumps.mul(clumpStrength * 0.9))
      .add(1)
      .clamp(0.12, 3.2);
  }

  private buildCompositeGraph(targetTexture: THREE.Texture): Node<'vec4'> {
    const source = texture(targetTexture);
    const offsets: Array<[number, number]> = [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1]
    ];
    const samples = offsets.map(([x, y]) =>
      source.sample(screenUV.add(this.compositeTexelSize.mul(vec2(x, y))))
    );
    const center = samples[0]!;
    const centerAlpha = center.w;
    let rgb = center.rgb;
    let alpha = centerAlpha;
    let weight: Node<'float'> = float(1);
    for (let i = 1; i < samples.length; i += 1) {
      const sample = samples[i]!;
      const similarity = float(1).sub(sample.w.sub(centerAlpha).abs().mul(3)).clamp(0.15, 1);
      rgb = rgb.add(sample.rgb.mul(similarity));
      alpha = alpha.add(sample.w.mul(similarity));
      weight = weight.add(similarity);
    }
    // A depth texture is sampled in the composite graph when supplied. The
    // depth delta is deliberately only a weight: a missing/clear depth map
    // falls back to the alpha-guided bilateral filter instead of hiding the
    // volume. This is conservative at foreground boundaries.
    if (this.depthTextureNode !== null) {
      const depthCenter = this.depthTextureNode.sample(screenUV).r;
      let depthWeight: Node<'float'> = float(1);
      for (const [x, y] of offsets.slice(1)) {
        const neighborDepth = this.depthTextureNode.sample(
          screenUV.add(this.compositeTexelSize.mul(vec2(x, y)))
        ).r;
        depthWeight = depthWeight.add(
          float(1).div(float(1).add(neighborDepth.sub(depthCenter).abs().mul(64)))
        );
      }
      // The ratio is close to one in a flat-depth region and downweights
      // cross-edge samples without changing the center sample.
      const normalizedDepth = depthWeight.div(5);
      rgb = rgb.mul(normalizedDepth).add(center.rgb.mul(float(1).sub(normalizedDepth)));
      alpha = alpha.mul(normalizedDepth).add(centerAlpha.mul(float(1).sub(normalizedDepth)));
    }
    return vec4(rgb.div(weight), alpha.div(weight));
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

    renderer.getSize(this.rendererSizeScratch);
    const size = this.rendererSizeScratch;
    const dpr = Math.min(renderer.getPixelRatio(), 16);
    const scale = clampRange(this.uInternalScale.value, INTERNAL_SCALE_MIN, INTERNAL_SCALE_MAX);
    const w = Math.max(2, Math.floor(size.x * dpr * scale * 0.5));
    const h = Math.max(2, Math.floor(size.y * dpr * scale * 0.5));
    if (this.target.width !== w || this.target.height !== h) {
      this.target.setSize(w, h);
    }
    this.compositeTexelSize.value.set(1 / this.target.width, 1 / this.target.height);
    if (this.depthTextureNode !== null) {
      this.depthTextureNode.value = this.depthTextureState.value ?? this.emptyDepthTexture;
    }

    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target as THREE.WebGLRenderTarget | null);
    renderer.render(marchScene, camera);
    renderer.setRenderTarget(previous as THREE.WebGLRenderTarget | null);
  }

  object3d(): THREE.Object3D {
    return this.mesh;
  }

  /** Scale the effective march budget: s > 1 means more executed samples. */
  setStepScale(scale: number): void {
    if (this.disposed) return;
    const safeScale = Number.isFinite(scale) ? Math.max(1e-5, scale) : 1;
    this.uStepScale.value = safeScale;
    this.activeStepCount = Math.max(
      1,
      Math.min(this.baseMaxSteps, Math.round(this.baseMaxSteps * safeScale))
    );
    this.uActiveSteps.value = this.activeStepCount;
  }

  setDetailOctaves(octaves: number): void {
    if (this.disposed) return;
    this.uDetailOctaves.value = clampInt(octaves, 1, this.detailOctaveCeiling);
  }

  setLightingTaps(taps: number): void {
    if (this.disposed) return;
    this.uLightingTaps.value = clampInt(taps, 0, 2);
  }

  setTemporalJitter(enabled: boolean): void {
    if (this.disposed) return;
    this.uJitterEnabled.value = enabled ? 1 : 0;
  }

  setTemporalFrame(frameIndex: number): void {
    if (this.disposed) return;
    const index = Number.isFinite(frameIndex) ? Math.max(0, Math.floor(frameIndex)) : 0;
    this.uJitterFrame.value = (index * JITTER_FRAME_STRIDE) % 1;
  }

  setSceneDepthTexture(textureValue: THREE.Texture | null): void {
    if (this.disposed) return;
    this.depthTextureState.value = textureValue;
    this.uDepthValid.value = textureValue === null ? 0 : 1;
    if (this.depthTextureNode !== null) {
      this.depthTextureNode.value = textureValue ?? this.emptyDepthTexture;
    }
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.visible = visible;
    this.mesh.visible = visible;
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      baseMaxSteps: this.baseMaxSteps,
      activeSteps: this.activeStepCount,
      internalScale: this.uInternalScale.value,
      visible: this.visible,
      halfResolution: this.target !== null,
      intermediateFormat: this.intermediateFormat,
      intermediateType: this.intermediateType,
      intermediateBytesPerPixel:
        this.intermediateType === THREE.HalfFloatType
          ? 8
          : this.intermediateType === THREE.UnsignedByteType
            ? 4
            : 0,
      hdrIntermediate: this.intermediateType === THREE.HalfFloatType,
      detailOctaves: Math.min(this.uDetailOctaves.value, this.detailOctaveCeiling),
      lightingTaps: this.uLightingTaps.value,
      temporalJitter: this.uJitterEnabled.value > 0,
      depthAwareUpsample: this.depthTextureNode !== null,
      depthClipActive: this.depthTextureNode !== null && this.uDepthValid.value > 0
    };
  }

  /** Numeric HDR probe hook; ordinary destinations use object3d() instead. */
  getIntermediateRenderTargetForTest(): THREE.RenderTarget | null {
    return this.target;
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
    this.emptyDepthTexture.dispose();
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

function clampInt(v: number, lo: number, hi: number): number {
  return Math.floor(clampRange(Number.isFinite(v) ? v : lo, lo, hi));
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
  private readonly sceneDepthState: { value: THREE.Texture | null } = { value: null };
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
    const volume = new VolumeImpl(
      config,
      this.internalScaleState,
      this.dprCap,
      this.sceneDepthState
    );
    this.volumes.push(volume);
    return volume;
  }

  /** Global half-res factor for every half-resolution volume; clamped to [0.1, 1]. */
  setInternalScale(scale: number): void {
    this.internalScaleState.value = clampRange(scale, INTERNAL_SCALE_MIN, INTERNAL_SCALE_MAX);
  }

  setStepScale(scale: number): void {
    for (const volume of this.volumes) volume.setStepScale(scale);
  }

  setDetailOctaves(octaves: number): void {
    for (const volume of this.volumes) volume.setDetailOctaves(octaves);
  }

  setLightingTaps(taps: number): void {
    for (const volume of this.volumes) volume.setLightingTaps(taps);
  }

  setTemporalJitter(enabled: boolean): void {
    for (const volume of this.volumes) volume.setTemporalJitter(enabled);
  }

  setTemporalFrame(frameIndex: number): void {
    for (const volume of this.volumes) volume.setTemporalFrame(frameIndex);
  }

  setSceneDepthTexture(texture: THREE.Texture | null): void {
    this.sceneDepthState.value = texture;
    for (const volume of this.volumes) volume.setSceneDepthTexture(texture);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const volume of this.volumes) volume.dispose();
    this.volumes.length = 0;
  }
}
