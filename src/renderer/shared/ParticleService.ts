/**
 * ParticleService — GPU-resident particle system host service for Cosmic Atlas.
 *
 * Implements `IParticleService` / `ParticleSystemHandle` from `src/atlas/types.ts`.
 *
 * Spec sources:
 * - docs/cosmic-atlas/RENDERING_SERVICES.md §3  (ParticleService: fields, GPU update,
 *   rendering, debug hooks §16) and §10 (no ownerless GPU object).
 * - docs/cosmic-atlas/PERFORMANCE_HARDWARE.md §6 (GPU compute for persistent parallel
 *   state) and §7 (particle architecture: storage buffers, points/billboards, packed
 *   attributes, compute update, stable capacity buffers, quality-dependent population).
 *
 * Fidelity disclosure (CINEMATIC-class visual infrastructure): particle motion is a
 * first-order Euler drift with stochastic respawn; it is not a solution of any
 * radiative or hydrodynamic transfer model. Destinations composing this service must
 * label their fidelity accordingly and may embed {@link PARTICLE_DISCLOSURE} in their
 * preset `fidelityNote`.
 *
 * Determinism contract:
 * - CPU-side initialization/reset uses the exported {@link mulberry32} PRNG factory;
 *   `Math.random` is never used.
 * - Per-particle random draws use a `fract(sin(x) * C)` hash that is mirrored exactly
 *   between the CPU loop and the TSL compute/vertex graphs, so both paths implement the
 *   same distributional model from a stored per-particle seed.
 * - The CPU path computes in f64 and the GPU path in f32, so bit-exact cross-path
 *   equality of trajectories is NOT claimed; each path is individually reproducible
 *   from `(seed, identical frame sequence)`.
 *
 * Backend notes (verified against three.js r180 sources):
 * - `THREE.Points` maps to WebGPU `point-list` topology, which renders 1-pixel points,
 *   and `PointsNodeMaterial.sizeNode` is ignored on that path. Sized, attenuated points
 *   are therefore rendered the way r180 documents it: an instanced camera-facing quad
 *   expanded by the `PointsNodeMaterial` sprite vertex path (`sizeNode` honored). The
 *   returned Object3D is consequently a `THREE.Mesh` over an `InstancedBufferGeometry`,
 *   not a literal `THREE.Points`; visually and API-wise it behaves as a point cloud.
 * - SoA channels are stored as itemSize-4 attributes because the r180 WebGPU backend
 *   transparently rewrites itemSize-3 storage attributes to padded itemSize-4 arrays,
 *   which would corrupt a CPU-mirrored stride-3 layout.
 * - On the compute path the same `StorageInstancedBufferAttribute` objects are bound as
 *   compute storage and as per-instance vertex data (single source of truth, no
 *   ping-pong, no CPU readback). Constraint: `update()` must run before the first
 *   render so the shared GPU buffers are created with STORAGE|VERTEX usage.
 */

import * as THREE from 'three';
import { PointsNodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';
import type { ComputeNode, Node, UniformNode } from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  atan,
  attribute,
  cameraViewMatrix,
  clamp,
  cross,
  float,
  fract,
  instanceIndex,
  length,
  max,
  mix,
  normalize,
  select,
  sin,
  smoothstep,
  sqrt,
  storage,
  texture,
  uniform,
  uniformArray,
  uint,
  uv,
  vec2,
  vec3,
  vec4
} from 'three/tsl';
import type {
  IParticleService,
  ParticleEmitterConfig,
  ParticleSystemConfig,
  ParticleSystemHandle,
  RendererLike
} from '../../atlas/types';
import { CINEMATIC_EMISSIVE_LAYER } from './visualLayers.js';

/** Any float-valued TSL shader-graph node. */
type TslFloat = Node<'float'>;

/**
 * Disclosure string for destinations that compose this service. Describes the actual
 * model class so UI fidelity notes never overstate what particles represent.
 */
export const PARTICLE_DISCLOSURE =
  'Particles are cinematic visual tracers (first-order Euler drift with stochastic ' +
  'respawn), not simulated hydrodynamics or radiative transfer.';

// ---------------------------------------------------------------------------
// Deterministic randomness primitives
// ---------------------------------------------------------------------------

/**
 * mulberry32 PRNG factory. Returns a closure producing floats in [0, 1) from a
 * 32-bit seed. Used for all CPU-side initialization so content is reproducible.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Golden-ratio additive step used to advance a per-particle seed stream. */
const SEED_STEP = 0.6180339887498949;

/** f64 CPU mirror of the GPU hash. Input and output are in [0, 1). */
function hash01(x: number): number {
  const v = Math.sin(x * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

/** TSL twin of {@link hash01}; compiles to f32 on the GPU. */
function gpuHash01(s: TslFloat): TslFloat {
  return fract(sin(s.mul(12.9898)).mul(43758.5453));
}

/** Advance a seed stream by one golden-ratio step (CPU). */
function nextSeed(s: number): number {
  const v = s + SEED_STEP;
  return v - Math.floor(v);
}

/** Advance a seed stream by one golden-ratio step (GPU). */
function gpuNextSeed(s: TslFloat): TslFloat {
  return fract(s.add(SEED_STEP));
}

// ---------------------------------------------------------------------------
// Emitter model — one definition, two implementations (CPU loop / TSL graph)
// ---------------------------------------------------------------------------

/** Emitter kinds in the order stored in `ParticleEmitterConfig['kind']`. */
const EMITTER_KIND_POINT = 0;
const EMITTER_KIND_SHELL = 1;
const EMITTER_KIND_DISC = 2;
const EMITTER_KIND_BOX = 3;

/** Hard cap on emitters per system; keeps the GPU parameter block bounded. */
export const MAX_EMITTERS = 8;

/** Flattened, GPU-ready copy of the configured emitters (padded to MAX_EMITTERS). */
interface EmitterBlock {
  origins: THREE.Vector3[];
  normals: THREE.Vector3[];
  extents: THREE.Vector3[];
  biases: THREE.Vector3[];
  radii: number[];
  speeds: number[];
  kinds: number[];
  count: number;
}

function kindId(kind: ParticleEmitterConfig['kind']): number {
  switch (kind) {
    case 'point':
      return EMITTER_KIND_POINT;
    case 'sphere-shell':
      return EMITTER_KIND_SHELL;
    case 'disc':
      return EMITTER_KIND_DISC;
    case 'volume-box':
      return EMITTER_KIND_BOX;
  }
}

/**
 * Flatten `config.emitters` into fixed-size uniform blocks. Emitters beyond
 * MAX_EMITTERS are dropped (with a single console warning) rather than silently
 * changing spawn weighting.
 */
function buildEmitterBlock(emitters: ParticleEmitterConfig[]): EmitterBlock {
  if (emitters.length === 0) {
    throw new Error(
      'ParticleService: ParticleSystemConfig.emitters must contain at least one emitter.'
    );
  }
  if (emitters.length > MAX_EMITTERS) {
    console.warn(
      `ParticleService: ${emitters.length} emitters requested, ` +
        `only the first ${MAX_EMITTERS} are used.`
    );
  }
  const count = Math.min(emitters.length, MAX_EMITTERS);
  const block: EmitterBlock = {
    origins: [],
    normals: [],
    extents: [],
    biases: [],
    radii: [],
    speeds: [],
    kinds: [],
    count
  };
  for (let i = 0; i < count; i++) {
    // i < count <= emitters.length, so the element is invariantly defined.
    const e = emitters[i]!;
    const origin = new THREE.Vector3(...(e.origin ?? [0, 0, 0]));
    const normal = new THREE.Vector3(...(e.normal ?? [0, 0, 1]));
    if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
    normal.normalize();
    const extent = new THREE.Vector3(...(e.extent ?? [0, 0, 0]));
    const bias = new THREE.Vector3(...(e.directionBias ?? [0, 0, 0]));
    block.origins.push(origin);
    block.normals.push(normal);
    block.extents.push(extent);
    // directionBias semantics: added to a random unit direction, then normalized.
    // |bias| therefore acts as a collimation strength (0 = isotropic).
    block.biases.push(bias);
    block.radii.push(e.radius ?? 0);
    block.speeds.push(e.speed ?? 0);
    block.kinds.push(kindId(e.kind));
  }
  // Pad remaining slots with inert duplicates so GPU element(k) stays in bounds.
  for (let i = count; i < MAX_EMITTERS; i++) {
    block.origins.push(new THREE.Vector3());
    block.normals.push(new THREE.Vector3(0, 0, 1));
    block.extents.push(new THREE.Vector3());
    block.biases.push(new THREE.Vector3());
    block.radii.push(0);
    block.speeds.push(0);
    block.kinds.push(EMITTER_KIND_POINT);
  }
  return block;
}

/**
 * Uniform point on the unit sphere from two uniforms in [0, 1):
 * cos(theta) = 2u - 1, phi = 2*pi*v. Identical formula on CPU and GPU.
 */
function sphereDirCpu(u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
  const cosT = 2 * u - 1;
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const phi = v * Math.PI * 2;
  return out.set(sinT * Math.cos(phi), sinT * Math.sin(phi), cosT);
}

/** Orthonormal basis (u, v) perpendicular to `n`. Same construction on GPU. */
function discBasis(n: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const helper = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(helper, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  return { u, v };
}

// ---------------------------------------------------------------------------
// SoA layout constants
// ---------------------------------------------------------------------------

// positions: [x, y, z, unused] — w kept at 0 so whole-vector adds preserve it.
const POS_STRIDE = 4;
// velocities: [vx, vy, vz, 0] — w always 0.
const VEL_STRIDE = 4;
// lifeParams: [age, lifetime, seed, emitterIndex]
const LIFE_STRIDE = 4;

const BYTES_PER_PARTICLE = (POS_STRIDE + VEL_STRIDE + LIFE_STRIDE) * 4; // 48 B

/** Largest integration step accepted per update; guards tab-restore spikes. */
const MAX_DT_SECONDS = 0.25;

/** Fraction of normalized lifetime over which alpha fades in/out. */
const EDGE_FADE_FRACTION = 0.1;

/** Radial soft-mask window on the billboard quad (uv distance from center). */
const SOFT_EDGE_INNER = 0.3;
const SOFT_EDGE_OUTER = Math.SQRT1_2; // quad corner distance

/** Color ramp LUT resolution (RGBA8, linear sampling). */
const RAMP_LUT_SIZE = 256;

// ---------------------------------------------------------------------------
// Particle system implementation
// ---------------------------------------------------------------------------

class ParticleSystemImpl implements ParticleSystemHandle {
  readonly capacity: number;

  private readonly config: ParticleSystemConfig;
  private readonly activity: 'static' | 'dynamic';
  private readonly emitters: EmitterBlock;
  private readonly hasComputeRenderer: boolean;
  private readonly rendererRef: RendererLike | null;
  private readonly useCompute: boolean;

  /** CPU mirror of the SoA state; authoritative on the CPU path. */
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly lifeParams: Float32Array;

  private readonly posAttr: StorageInstancedBufferAttribute;
  private readonly velAttr: StorageInstancedBufferAttribute;
  private readonly lifeAttr: StorageInstancedBufferAttribute;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: PointsNodeMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly rampLut: THREE.DataTexture;

  private readonly dtUniform: UniformNode<'float', number>;
  private readonly profileQualityUniform: UniformNode<'float', number>;
  private readonly emissiveIntensity: number;
  private readonly profile: NonNullable<ParticleSystemConfig['profile']>;
  private readonly computeUpdate: ComputeNode | null;
  private drawnCount: number;
  private requestedPopulationScale = 1;
  private globalPopulationScale = 1;
  private simulationUpdates = 0;
  private skippedUpdates = 0;
  private lastSkipReason: 'none' | 'zero-population' | 'static' | 'zero-dt' = 'none';
  private disposed = false;

  constructor(config: ParticleSystemConfig, rendererRef: RendererLike | null) {
    if (!Number.isFinite(config.capacity) || config.capacity < 1) {
      throw new Error(`ParticleService: invalid capacity ${config.capacity}.`);
    }
    this.config = config;
    this.profile = config.profile ?? 'generic-soft';
    this.emissiveIntensity = Number.isFinite(config.emissiveIntensity)
      ? Math.min(32, Math.max(0, config.emissiveIntensity!))
      : 1;
    this.activity = config.activity ?? 'dynamic';
    this.capacity = Math.floor(config.capacity);
    this.emitters = buildEmitterBlock(config.emitters);
    this.rendererRef = rendererRef;

    // Compute availability: caller-provided capability flag AND an actual renderer
    // able to dispatch TSL compute (WebGPURenderer exposes .compute()).
    const r = rendererRef as { compute?: unknown } | null;
    this.hasComputeRenderer =
      r !== null && typeof r === 'object' && typeof r.compute === 'function';
    this.useCompute = config.preferCompute && this.hasComputeRenderer;
    if (config.preferCompute && !this.hasComputeRenderer) {
      console.warn(
        'ParticleService: preferCompute requested but no compute-capable renderer was ' +
          'provided; falling back to the CPU typed-array update path.'
      );
    }

    this.positions = new Float32Array(this.capacity * POS_STRIDE);
    this.velocities = new Float32Array(this.capacity * VEL_STRIDE);
    this.lifeParams = new Float32Array(this.capacity * LIFE_STRIDE);

    this.posAttr = new StorageInstancedBufferAttribute(this.positions, POS_STRIDE);
    this.velAttr = new StorageInstancedBufferAttribute(this.velocities, VEL_STRIDE);
    this.lifeAttr = new StorageInstancedBufferAttribute(this.lifeParams, LIFE_STRIDE);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.velAttr.setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr.setUsage(THREE.DynamicDrawUsage);

    this.rampLut = buildRampLut(config.colorRamp);

    // --- render object: instanced camera-facing quads through the sprite path ---
    this.geometry = buildQuadGeometry();
    this.geometry.setAttribute('aParticlePos', this.posAttr);
    this.geometry.setAttribute('aParticleVel', this.velAttr);
    this.geometry.setAttribute('aParticleLife', this.lifeAttr);
    this.drawnCount = this.capacity;
    this.geometry.instanceCount = this.drawnCount;

    this.material = new PointsNodeMaterial();
    this.material.transparent = true;
    this.material.depthWrite = false;
    // `sizePx` means PIXELS, so perspective attenuation is off. With
    // attenuation on (the PointsMaterial default) the value behaves as a
    // world-space size divided by view depth, so a population the camera has to
    // approach — a supernova's ejecta during the flash, when the shell is ~1
    // scene unit across — inflated into frame-filling bokeh discs instead of a
    // fine particle field.
    this.material.sizeAttenuation = false;
    this.material.blending =
      config.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.userData['cinematicEmissive'] = true;
    this.material.userData['particleProfile'] = this.profile;
    this.profileQualityUniform = uniform(1);

    const posRead = attribute<'vec4'>('aParticlePos', 'vec4');
    const lifeRead = attribute<'vec4'>('aParticleLife', 'vec4');
    const velocityRead = attribute<'vec4'>('aParticleVel', 'vec4');
    this.material.positionNode = posRead.xyz;

    // Per-particle size: mix(sizeMin, sizeMax, hash(seed)) in CSS pixels; the
    // material applies screen-DPR scaling and perspective attenuation itself.
    const sizeMix = gpuHash01(fract(lifeRead.z.add(0.123456)));
    const sizePx = mix(float(config.sizePx[0]), float(config.sizePx[1]), sizeMix);
    const speed = length(velocityRead.xyz);
    const profileStretch =
      this.profile === 'ejecta-streak'
        ? speed.mul(0.035).add(1).clamp(1, 9)
        : this.profile === 'debris-streak'
          ? speed.mul(0.06).add(1).clamp(1, 14)
          : float(1);
    const sizeScale =
      this.profile === 'star'
        ? 0.8
        : this.profile === 'dust-clump'
          ? 1.35
          : this.profile === 'emissive-core'
            ? 1.1
            : 1;
    this.material.sizeNode = vec2(
      sizePx.mul(sizeScale).mul(mix(float(1), profileStretch, this.profileQualityUniform)),
      sizePx.mul(sizeScale)
    );
    if (this.profile === 'ejecta-streak' || this.profile === 'debris-streak') {
      const viewVelocity = cameraViewMatrix.mul(vec4(velocityRead.xyz, 0)).xyz;
      this.material.rotationNode = atan(viewVelocity.y, viewVelocity.x);
    }

    // Color ramp sampled by age/lifetime fraction + analytic edge fade + radial mask.
    const ageFrac = clamp(lifeRead.x.div(max(lifeRead.y, 1e-5)), 0, 1);
    const ramp = sampleLut(this.rampLut, ageFrac);
    const fadeIn = smoothstep(0, EDGE_FADE_FRACTION, ageFrac);
    const fadeOut = float(1).sub(smoothstep(1 - EDGE_FADE_FRACTION, 1, ageFrac));
    const centered = uv().sub(vec2(0.5, 0.5));
    const radial = length(centered);
    const softMask = float(1).sub(smoothstep(SOFT_EDGE_INNER, SOFT_EDGE_OUTER, radial));
    const profileMask = this.buildProfileMask(centered, radial);
    const clusterBrightness = gpuHash01(fract(lifeRead.z.add(37.17)))
      .mul(0.32)
      .add(0.84);
    const profileColor = ramp.xyz.mul(clusterBrightness).mul(this.emissiveIntensity);
    this.material.colorNode = vec4(
      profileColor,
      ramp.w.mul(fadeIn).mul(fadeOut).mul(profileMask).mul(softMask)
    );

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // world-space population; skip bogus culling
    this.mesh.matrixAutoUpdate = false; // identity world matrix: positions are world-space
    this.mesh.layers.enable(CINEMATIC_EMISSIVE_LAYER);
    this.mesh.name = 'ParticleSystem';

    // --- compute update graph (built once; dispatched per frame when active) ---
    this.dtUniform = uniform(0);
    this.computeUpdate = this.useCompute ? this.buildComputeGraph() : null;
    this.respawnRand = mulberry32((config.seed ^ 0x9e3779b9) >>> 0);

    this.reset(config.seed);
  }

  private buildProfileMask(centered: Node<'vec2'>, radial: TslFloat): Node<'float'> {
    switch (this.profile) {
      case 'star': {
        const core = float(1).sub(smoothstep(0.04, 0.22, radial));
        const halo = float(1)
          .sub(smoothstep(0.12, 0.707, radial))
          .mul(0.22);
        return core.add(halo);
      }
      case 'ejecta-streak': {
        const transverse = float(1).sub(smoothstep(0.16, 0.5, centered.y.abs()));
        const head = float(1).sub(smoothstep(0.32, 0.5, centered.x));
        return transverse.mul(head.mul(0.76).add(0.24));
      }
      case 'debris-streak': {
        const transverse = float(1).sub(smoothstep(0.1, 0.43, centered.y.abs()));
        const tapered = float(1).sub(smoothstep(0.2, 0.5, centered.x));
        return transverse.mul(tapered.mul(0.88).add(0.12));
      }
      case 'dust-clump':
        return float(1)
          .sub(smoothstep(0.18, 0.707, radial))
          .mul(0.68)
          .add(0.14);
      case 'emissive-core': {
        const core = float(1).sub(smoothstep(0.03, 0.2, radial));
        const halo = float(1)
          .sub(smoothstep(0.16, 0.707, radial))
          .mul(0.35);
        return core.mul(1.15).add(halo);
      }
      case 'generic-soft':
      default:
        return float(1);
    }
  }

  /** Build the TSL compute kernel: integrate, then recycle dead particles. */
  private buildComputeGraph(): ComputeNode {
    const cfg = this.config;
    const emitters = this.emitters;

    const posBuf = storage(this.posAttr, 'vec4', this.capacity);
    const velBuf = storage(this.velAttr, 'vec4', this.capacity);
    const lifeBuf = storage(this.lifeAttr, 'vec4', this.capacity);

    const uOrigin = uniformArray<'vec3'>(emitters.origins, 'vec3');
    const uNormal = uniformArray<'vec3'>(emitters.normals, 'vec3');
    const uExtent = uniformArray<'vec3'>(emitters.extents, 'vec3');
    const uBias = uniformArray<'vec3'>(emitters.biases, 'vec3');
    const uRadius = uniformArray<'float'>(emitters.radii, 'float');
    const uSpeed = uniformArray<'float'>(emitters.speeds, 'float');
    const uKind = uniformArray<'float'>(emitters.kinds, 'float');

    const dtU = this.dtUniform;
    const lifeMinU = float(cfg.lifetimeSeconds[0]);
    const lifeMaxU = float(cfg.lifetimeSeconds[1]);

    const kernel = Fn(() => {
      const i = instanceIndex;
      const posEl = posBuf.element(i);
      const velEl = velBuf.element(i);
      const lifeEl = lifeBuf.element(i);

      // Snapshot reads into locals so every load precedes every store.
      const posV = vec4(posEl);
      const velV = vec4(velEl);
      const age0 = float(lifeEl.x);
      const lifetime = float(lifeEl.y);
      const seedIn = float(lifeEl.z);
      const emitterIdx = float(lifeEl.w);

      const age1 = age0.add(dtU);

      If(age1.greaterThan(lifetime), () => {
        // Fixed draw sequence (independent of branch shape) keeps the seed stream
        // well-defined: six draws per respawn.
        let s = gpuNextSeed(seedIn);
        const r1 = gpuHash01(s);
        s = gpuNextSeed(s);
        const r2 = gpuHash01(s);
        s = gpuNextSeed(s);
        const r3 = gpuHash01(s);
        s = gpuNextSeed(s);
        const r4 = gpuHash01(s);
        s = gpuNextSeed(s);
        const r5 = gpuHash01(s);
        s = gpuNextSeed(s);
        const r6 = gpuHash01(s);
        const seedOut = gpuNextSeed(s);

        const k = uint(emitterIdx);
        const origin = vec3(uOrigin.element(k));
        const normal = vec3(uNormal.element(k));
        const extent = vec3(uExtent.element(k));
        const bias = vec3(uBias.element(k));
        const radius = float(uRadius.element(k));
        const speed = float(uSpeed.element(k));
        const kind = float(uKind.element(k));

        // Shape position candidates (all evaluated; select picks one).
        const dirShape = sphereDirGpu(r1, r2);
        const pPoint = origin;
        const pShell = origin.add(dirShape.mul(radius));

        const helperY = select(abs(normal.y).lessThan(0.9), float(0), float(1));
        const helper = vec3(helperY, float(1).sub(helperY), float(0));
        const basisU = normalize(cross(helper, normal));
        const basisV = cross(normal, basisU);
        const rad = radius.mul(sqrt(r1));
        const ang = r2.mul(Math.PI * 2);
        const pDisc = origin.add(
          basisU.mul(rad.mul(ang.cos())).add(basisV.mul(rad.mul(ang.sin())))
        );

        const pBox = origin.add(vec3(r1.sub(0.5), r2.sub(0.5), r3.sub(0.5)).mul(extent));

        const spawnPos = select(
          kind.equal(float(EMITTER_KIND_DISC)),
          pDisc,
          select(
            kind.equal(float(EMITTER_KIND_SHELL)),
            pShell,
            select(kind.equal(float(EMITTER_KIND_BOX)), pBox, pPoint)
          )
        );

        // Velocity: random unit direction, optionally collimated by directionBias.
        const dirRand = sphereDirGpu(r4, r5);
        const dirBiased = normalize(dirRand.add(bias));
        const dirVel = select(length(bias).greaterThan(0), dirBiased, dirRand);
        const spawnVel = dirVel.mul(speed);

        const newLifetime = mix(lifeMinU, lifeMaxU, r6);

        posEl.assign(vec4(spawnPos, float(0)));
        velEl.assign(vec4(spawnVel, float(0)));
        lifeEl.assign(vec4(float(0), newLifetime, seedOut, emitterIdx));
      }).Else(() => {
        posEl.assign(posV.add(vec4(velV.xyz.mul(dtU), float(0))));
        lifeEl.assign(vec4(age1, lifetime, seedIn, emitterIdx));
      });
    })();

    // Default workgroup size (64); per PERFORMANCE_HARDWARE guidance this should be
    // revisited only with dispatch benchmarks, not intuition.
    return kernel.compute(this.capacity);
  }

  /** Seed and populate every slot deterministically. */
  reset(seed: number): void {
    if (this.disposed) return;
    const rand = mulberry32(seed);
    this.respawnRand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    for (let i = 0; i < this.capacity; i++) {
      this.spawn(i, rand, true);
    }
    // Initial stagger: spread ages across full lifetimes so the population starts
    // in a steady-state mixture instead of pulsing in lock-step.
    for (let i = 0; i < this.capacity; i++) {
      const o = i * LIFE_STRIDE;
      this.lifeParams[o] = (this.lifeParams[o + 1] ?? 0) * rand();
    }
    this.posAttr.needsUpdate = true;
    this.velAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }

  /**
   * Spawn particle `i` from its assigned emitter using the provided random source.
   * Mirrors the TSL respawn branch (same formulas, same draw order).
   */
  private spawn(i: number, rand: () => number, initial: boolean): void {
    const po = i * POS_STRIDE;
    const vo = i * VEL_STRIDE;
    const lo = i * LIFE_STRIDE;

    const emitterIndex = initial
      ? Math.floor(rand() * this.emitters.count) % this.emitters.count
      : (this.lifeParams[lo + 3] ?? 0);
    const e = emitterIndex | 0;
    // e is invariantly < this.emitters.count (initial path mods by count; the
    // respawn path only ever stores a value previously produced that way).
    const origin = this.emitters.origins[e]!;
    const normal = this.emitters.normals[e]!;
    const extent = this.emitters.extents[e]!;
    const bias = this.emitters.biases[e]!;
    const radius = this.emitters.radii[e]!;
    const speed = this.emitters.speeds[e]!;
    const kind = this.emitters.kinds[e]!;

    // Six draws, matching the GPU respawn sequence.
    let s = nextSeed(rand());
    const r1 = hash01(s);
    s = nextSeed(s);
    const r2 = hash01(s);
    s = nextSeed(s);
    const r3 = hash01(s);
    s = nextSeed(s);
    const r4 = hash01(s);
    s = nextSeed(s);
    const r5 = hash01(s);
    s = nextSeed(s);
    const r6 = hash01(s);
    s = nextSeed(s);

    // Position by kind.
    let px: number;
    let py: number;
    let pz: number;
    if (kind === EMITTER_KIND_DISC) {
      const { u, v } = discBasis(normal);
      const rad = radius * Math.sqrt(r1);
      const ang = r2 * Math.PI * 2;
      px = origin.x + (u.x * Math.cos(ang) + v.x * Math.sin(ang)) * rad;
      py = origin.y + (u.y * Math.cos(ang) + v.y * Math.sin(ang)) * rad;
      pz = origin.z + (u.z * Math.cos(ang) + v.z * Math.sin(ang)) * rad;
    } else if (kind === EMITTER_KIND_BOX) {
      px = origin.x + (r1 - 0.5) * extent.x;
      py = origin.y + (r2 - 0.5) * extent.y;
      pz = origin.z + (r3 - 0.5) * extent.z;
    } else if (kind === EMITTER_KIND_SHELL) {
      const d = sphereDirCpu(r1, r2, _v1);
      px = origin.x + d.x * radius;
      py = origin.y + d.y * radius;
      pz = origin.z + d.z * radius;
    } else {
      px = origin.x;
      py = origin.y;
      pz = origin.z;
    }

    // Velocity direction: isotropic unless a non-zero directionBias collimates it.
    const dir = sphereDirCpu(r4, r5, _v2);
    let dx = dir.x;
    let dy = dir.y;
    let dz = dir.z;
    if (bias.lengthSq() > 0) {
      const bx = dx + bias.x;
      const by = dy + bias.y;
      const bz = dz + bias.z;
      const len = Math.hypot(bx, by, bz);
      if (len > 1e-12) {
        dx = bx / len;
        dy = by / len;
        dz = bz / len;
      }
    }

    this.positions[po] = px;
    this.positions[po + 1] = py;
    this.positions[po + 2] = pz;
    this.positions[po + 3] = 0;
    this.velocities[vo] = dx * speed;
    this.velocities[vo + 1] = dy * speed;
    this.velocities[vo + 2] = dz * speed;
    this.velocities[vo + 3] = 0;
    this.lifeParams[lo] = 0; // respawned particles start at age zero
    this.lifeParams[lo + 1] =
      this.config.lifetimeSeconds[0] +
      (this.config.lifetimeSeconds[1] - this.config.lifetimeSeconds[0]) * r6;
    this.lifeParams[lo + 2] = s;
    this.lifeParams[lo + 3] = e;
  }

  /** Advance the simulation deterministically by `dtSeconds`. */
  update(dtSeconds: number): void {
    if (this.disposed) return;
    if (this.activity === 'static') {
      this.skippedUpdates += 1;
      this.lastSkipReason = 'static';
      return;
    }
    if (this.drawnCount <= 0) {
      this.skippedUpdates += 1;
      this.lastSkipReason = 'zero-population';
      return;
    }
    const dt = Math.min(Math.max(dtSeconds, 0), MAX_DT_SECONDS);
    if (dt === 0) {
      this.skippedUpdates += 1;
      this.lastSkipReason = 'zero-dt';
      return;
    }
    this.lastSkipReason = 'none';
    this.simulationUpdates += 1;

    if (this.useCompute && this.computeUpdate !== null) {
      // GPU path: set dt, dispatch, done. No CPU readback, no attribute upload.
      this.dtUniform.value = dt;
      const r = this.rendererRef as unknown as {
        compute: (node: object) => Promise<void> | undefined;
      };
      void r.compute(this.computeUpdate);
      return;
    }

    // CPU fallback path. Cost note: O(capacity) JS loop (~30 flops/particle) plus a
    // full position+life upload of 32 B/particle per dirty frame; velocity uploads
    // only on frames where at least one particle respawned. Comfortable up to roughly
    // 50k particles at 60 Hz on mid hardware; beyond that prefer the compute path.
    const cap = this.capacity;
    const pos = this.positions;
    const vel = this.velocities;
    const life = this.lifeParams;
    let anyRespawn = false;
    for (let i = 0; i < cap; i++) {
      const lo = i * LIFE_STRIDE;
      const age1 = (life[lo] ?? 0) + dt;
      if (age1 > (life[lo + 1] ?? 0)) {
        this.spawn(i, this.respawnRand, false);
        anyRespawn = true;
        continue;
      }
      life[lo] = age1;
      const po = i * POS_STRIDE;
      pos[po] = (pos[po] ?? 0) + (vel[po] ?? 0) * dt;
      pos[po + 1] = (pos[po + 1] ?? 0) + (vel[po + 1] ?? 0) * dt;
      pos[po + 2] = (pos[po + 2] ?? 0) + (vel[po + 2] ?? 0) * dt;
    }
    this.posAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    if (anyRespawn) this.velAttr.needsUpdate = true;
  }

  /**
   * Continuous random source for mid-simulation respawns on the CPU path. Re-seeded
   * from the system/reset seed so a given (seed, frame sequence) reproduces exactly.
   */
  private respawnRand: () => number = mulberry32(0x9e3779b9);

  /** Throttle the drawn population: `scale` in [0, 1] of capacity. */
  setPopulationScale(scale: number): void {
    if (this.disposed) return;
    this.requestedPopulationScale = Math.min(Math.max(scale, 0), 1);
    const s = Math.min(this.requestedPopulationScale, this.globalPopulationScale);
    const nextCount = Math.round(this.capacity * s);
    if (nextCount === this.drawnCount) return;
    this.drawnCount = nextCount;
    // Instanced equivalent of drawRange: the renderer skips the draw entirely at 0.
    this.geometry.instanceCount = this.drawnCount;
  }

  setGlobalPopulationScale(scale: number): void {
    if (this.disposed) return;
    this.globalPopulationScale = Number.isFinite(scale) ? Math.min(Math.max(scale, 0), 1) : 1;
    this.setPopulationScale(this.requestedPopulationScale);
  }

  setProfileQuality(quality: number): void {
    if (this.disposed) return;
    this.profileQualityUniform.value = Number.isFinite(quality)
      ? Math.min(1, Math.max(0, quality))
      : 1;
  }

  object3d(): THREE.Object3D {
    return this.mesh;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    this.geometry.dispose(); // releases attribute GPU buffers via the backend
    this.material.dispose();
    this.rampLut.dispose();
  }

  /**
   * Bounded debug metadata (RENDERING_SERVICES.md §16): active/capacity, buffer
   * bytes, update path. No GPU readback is performed.
   */
  getDebugSnapshot(): Record<string, unknown> {
    return {
      capacity: this.capacity,
      drawnCount: this.drawnCount,
      requestedPopulationScale: this.requestedPopulationScale,
      globalPopulationScale: this.globalPopulationScale,
      bufferBytes: this.capacity * BYTES_PER_PARTICLE,
      updatePath: this.useCompute ? 'compute' : 'cpu',
      computeAvailable: this.useCompute,
      blending: this.config.blending,
      profile: this.profile,
      profileQuality: this.profileQualityUniform.value,
      emissiveIntensity: this.emissiveIntensity,
      activity: this.activity,
      simulationUpdates: this.simulationUpdates,
      skippedUpdates: this.skippedUpdates,
      lastSkipReason: this.lastSkipReason
    };
  }
}

/** Scratch vectors for CPU spawn math (module-local, no allocation per call). */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Uniform unit-sphere direction from two uniforms (GPU twin of sphereDirCpu). */
function sphereDirGpu(u: TslFloat, v: TslFloat): Node<'vec3'> {
  const cosT = u.mul(2).sub(1);
  const sinT = sqrt(float(1).sub(cosT.mul(cosT)).max(0));
  const phi = v.mul(Math.PI * 2);
  return vec3(sinT.mul(phi.cos()), sinT.mul(phi.sin()), cosT);
}

/**
 * Build the 256x1 RGBA8 color-ramp LUT. Ramp stops are sorted by `t`, interpolated
 * linearly between neighbors, and written straight (no color-space conversion) so
 * destination-supplied values reach the shader unmodified.
 */
function buildRampLut(
  ramp: Array<{ t: number; color: [number, number, number]; alpha: number }>
): THREE.DataTexture {
  if (ramp.length === 0) {
    throw new Error('ParticleService: colorRamp must contain at least one stop.');
  }
  const stops = [...ramp].sort((a, b) => a.t - b.t);
  const data = new Uint8Array(RAMP_LUT_SIZE * 4);
  for (let i = 0; i < RAMP_LUT_SIZE; i++) {
    const t = i / (RAMP_LUT_SIZE - 1);
    // Locate surrounding stops (clamped at both ends).
    let i0 = 0;
    while (i0 < stops.length - 2 && stops[i0 + 1]!.t <= t) i0++;
    // Both indices are clamped into [0, stops.length - 1].
    const a = stops[i0]!;
    const b = stops[Math.min(i0 + 1, stops.length - 1)]!;
    const span = b.t - a.t;
    const f = span > 0 ? Math.min(Math.max((t - a.t) / span, 0), 1) : 0;
    data[i * 4 + 0] = toByte(a.color[0] + (b.color[0] - a.color[0]) * f);
    data[i * 4 + 1] = toByte(a.color[1] + (b.color[1] - a.color[1]) * f);
    data[i * 4 + 2] = toByte(a.color[2] + (b.color[2] - a.color[2]) * f);
    data[i * 4 + 3] = toByte(a.alpha + (b.alpha - a.alpha) * f);
  }
  const lut = new THREE.DataTexture(data, RAMP_LUT_SIZE, 1, THREE.RGBAFormat);
  lut.magFilter = THREE.LinearFilter;
  lut.minFilter = THREE.LinearFilter;
  lut.wrapS = THREE.ClampToEdgeWrapping;
  lut.wrapT = THREE.ClampToEdgeWrapping;
  lut.generateMipmaps = false;
  lut.needsUpdate = true;
  return lut;
}

function toByte(x: number): number {
  return Math.round(Math.min(Math.max(x, 0), 1) * 255);
}

/** Sample the LUT at normalized coordinate `t` (GPU side). */
function sampleLut(lut: THREE.DataTexture, t: TslFloat): Node<'vec4'> {
  return texture(lut, vec2(t, 0.5));
}

/**
 * Unit quad geometry (two triangles, corners at ±0.5) instanced `capacity` times.
 * Instance data flows through the storage-backed attributes; the quad supplies only
 * corner offsets (`positionGeometry.xy`) and uv for the radial mask.
 */
function buildQuadGeometry(): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3
    )
  );
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return geo;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ParticleServiceOptions {
  /**
   * Whether the active backend supports TSL compute (WebGPU). Detected by the host
   * (e.g. from `navigator.gpu` plus backend selection) and passed in here.
   */
  computeAvailable: boolean;
  /**
   * Renderer used to dispatch compute updates. Required for the compute path; when
   * omitted (or lacking `.compute()`), systems fall back to the documented CPU path.
   */
  renderer?: RendererLike | null;
}

/**
 * Host service creating GPU-resident particle systems. One instance per renderer;
 * `dispose()` disposes every live system created by it.
 */
export class ParticleService implements IParticleService {
  readonly computeAvailable: boolean;

  private readonly rendererRef: RendererLike | null;
  private readonly systems: ParticleSystemImpl[] = [];
  private disposed = false;

  constructor(options: ParticleServiceOptions) {
    this.computeAvailable = options.computeAvailable === true;
    this.rendererRef = options.renderer ?? null;
  }

  createSystem(config: ParticleSystemConfig): ParticleSystemHandle {
    if (this.disposed) {
      throw new Error('ParticleService: createSystem called after dispose().');
    }
    const system = new ParticleSystemImpl(config, this.rendererRef);
    this.systems.push(system);
    return system;
  }

  setProfileQuality(quality: number): void {
    for (const system of this.systems) system.setProfileQuality(quality);
  }

  setPopulationScale(scale: number): void {
    for (const system of this.systems) system.setGlobalPopulationScale(scale);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const system of this.systems) system.dispose();
    this.systems.length = 0;
  }
}
