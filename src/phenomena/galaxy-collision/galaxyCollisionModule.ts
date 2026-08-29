/**
 * CA9 — Galaxy Collision phenomenon module.
 *
 * DATA_DRIVEN reduced restricted-three-body reconstruction. Tracer positions at
 * the current timeline phase are interpolated from the validated offline GC1
 * artifact (see dataset.ts / loader.ts). The renderer never solves gravity at
 * runtime and never uses cinematic particle drift for the scientific tracers.
 *
 * Module lifecycle follows docs/cosmic-atlas/ARCHITECTURE.md §4. Resources are
 * owned by the prepared scope so repeated navigation stays bounded.
 *
 * Presentation (phenomena-animation campaign):
 * - Tracers are drawn as INSTANCED camera-facing quads through
 *   `PointsNodeMaterial`'s sprite vertex path, not as `THREE.Points`. WebGPU's
 *   `point-list` topology renders 1-pixel points and ignores point size
 *   entirely (three.js r185 documents this on `PointsNodeMaterial.sizeNode`),
 *   which is why the tidal structure previously read as a near-black scatter
 *   of single pixels. This mirrors the approach already proven in
 *   `src/renderer/shared/ParticleService.ts`.
 * - The two disks are tinted separately. Tracers `[0, tracerCount/2)` were
 *   sampled around nucleus 1 and the rest around nucleus 2
 *   (`tools/cosmic-data/restricted_three_body.py` `sample_all_tracers`), so
 *   the tint is a data fact, and it is what makes a bridge (material pulled
 *   ACROSS to the companion) visually distinguishable from a tail.
 * - The timeline registers a phase mapping in model time with an explicit
 *   wall-clock pace and looping, so the encounter actually plays. Without a
 *   registered mapping the shared identity mapping ran 0->1 in one second and
 *   then held at its endpoint forever: the scene was frozen on its final
 *   keyframe from one second after arrival onward.
 */

import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, float, length, mix, smoothstep, uv, vec2, vec3, vec4 } from 'three/tsl';

import {
  Gc1LoadError,
  interpolateCenters,
  interpolateTracers,
  phaseToModelTime,
  type Gc1Dataset
} from './dataset.js';
import { loadGc1Dataset } from './loader.js';
import { GALAXY_COLLISION_DESCRIPTOR } from './presets.js';
import {
  CINEMATIC_DETAIL_BY_TIER,
  createCinematicBackdrop,
  createCinematicHalo,
  type CinematicBackdropHandle
} from '../../renderer/shared/CinematicPrimitives.js';

import type {
  EnterContext,
  ExitContext,
  FrameContext,
  PhenomenonDescriptor,
  PhenomenonModule,
  PrepareContext,
  PresetDescriptor,
  RenderContext
} from '../../atlas/types.js';

const ASSET_ID = 'gc1-nequal';
const TRACER_POINT_ESTIMATED_BYTES = 64; // geometry + material headroom per tracer point
const NUCLEUS_POINT_ESTIMATED_BYTES = 4 * 1024;
const PROBE_INDICES = [0, 1, 2];

/**
 * Wall-clock seconds for one full traverse of the GC1 window (model time
 * -50 -> +70 in units of sqrt(R^3/GM)) at 1x. Pericenter sits at t = 0, so this
 * puts the encounter itself — the bridge and tail formation, which is the whole
 * point of the Toomre & Toomre model — around the 25 s mark while keeping the
 * slow approach watchable rather than instantaneous.
 */
const TIMELINE_PLAYBACK_SECONDS = 60;

/** Disk tints: nucleus-1 material warm, nucleus-2 material cool (see header). */
const DISK_A_COLOR: [number, number, number] = [1.0, 0.82, 0.55];
const DISK_B_COLOR: [number, number, number] = [0.62, 0.78, 1.0];
const NUCLEUS_A_COLOR: [number, number, number] = [1.0, 0.93, 0.8];
const NUCLEUS_B_COLOR: [number, number, number] = [0.86, 0.92, 1.0];

/** Sprite footprint in CSS pixels (fixed size: a star cloud, not spheres). */
const TRACER_SIZE_PX = 3.2;
const NUCLEUS_SIZE_PX = 14;
/** Additive radiance scale per sprite before brightness jitter. */
const TRACER_INTENSITY = 1.6;
const NUCLEUS_INTENSITY = 3.5;
/** Upper bound for secondary unresolved emitters around the GC1 backbone. */
const SECONDARY_EMITTER_CAPACITY = 3200;
const SECONDARY_SIZE_PX = 1.8;
const SECONDARY_INTENSITY = 0.62;

/**
 * Stage label for a GC1 model time, used in the timeline readout. Boundaries
 * follow the encounter geometry measured from the artifact itself (nucleus
 * separation 19 -> 4 at pericenter t=0 -> 25 by t=+70), not arbitrary taste.
 */
function encounterStage(t: number): string {
  if (t < -12) return 'approach';
  if (t < -2) return 'first tidal distortion';
  if (t <= 2) return 'pericenter';
  if (t < 18) return 'bridge & tails';
  return 'post-encounter tails';
}

/** Deterministic per-index unit hash for brightness jitter (no Math.random). */
function hash01(index: number): number {
  let h = (index + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x68bc21eb) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x02e169be) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface SpriteCloud {
  geometry: THREE.InstancedBufferGeometry;
  positions: Float32Array;
  posAttr: THREE.InstancedBufferAttribute;
}

/**
 * Unit quad instanced `count` times, plus the two per-instance attributes the
 * material reads: `aPos` (world position) and `aTint` (disk selector in x,
 * brightness jitter in y). Mirrors ParticleService's quad so both paths carry
 * the same WebGPU/WebGL2 behavior.
 */
function buildSpriteCloud(count: number): SpriteCloud {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3
    )
  );
  geometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2)
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  // World-space population: never let three cull it against a stale sphere.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  geometry.instanceCount = count;

  const positions = new Float32Array(count * 3);
  const posAttr = new THREE.InstancedBufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aPos', posAttr);

  const tints = new Float32Array(count * 2);
  const half = count / 2;
  for (let i = 0; i < count; i += 1) {
    tints[i * 2] = i < half ? 0 : 1;
    // 0.45..1.30 brightness spread so the cloud reads as stars, not a flat wash.
    tints[i * 2 + 1] = 0.45 + 0.85 * hash01(i);
  }
  geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 2));

  return { geometry, positions, posAttr };
}

/**
 * Additive sprite material for a data-driven point cloud. `softness` shapes the
 * radial profile: 2 is a tight star, 4 a diffuse glow.
 */
function buildSpriteMaterial(options: {
  colorA: [number, number, number];
  colorB: [number, number, number];
  sizePx: number;
  intensity: number;
  softness: number;
}): PointsNodeMaterial {
  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.blending = THREE.AdditiveBlending;
  // Fixed pixel footprint: tracers are unresolved star populations, so they
  // must not shrink to nothing as a tail recedes from the camera.
  material.sizeAttenuation = false;

  material.positionNode = attribute<'vec3'>('aPos', 'vec3');
  material.sizeNode = vec2(float(options.sizePx), float(options.sizePx));

  const tint = attribute<'vec2'>('aTint', 'vec2');
  const radial = length(uv().sub(vec2(0.5, 0.5))).mul(2);
  const profile = float(1)
    .sub(smoothstep(0, 1, radial))
    .pow(options.softness);
  const color = mix(
    vec3(options.colorA[0], options.colorA[1], options.colorA[2]),
    vec3(options.colorB[0], options.colorB[1], options.colorB[2]),
    tint.x
  );
  material.colorNode = vec4(color.mul(tint.y.mul(options.intensity)), profile);
  return material;
}

export function createGalaxyCollisionModule(): PhenomenonModule {
  return new GalaxyCollisionModule();
}

class GalaxyCollisionModule implements PhenomenonModule {
  readonly descriptor: PhenomenonDescriptor = GALAXY_COLLISION_DESCRIPTOR;

  private dataset: Gc1Dataset | null = null;
  private scene: THREE.Scene | null = null;
  private tracerPosAttr: THREE.InstancedBufferAttribute | null = null;
  private tracerPositions: Float32Array | null = null;
  private secondaryPosAttr: THREE.InstancedBufferAttribute | null = null;
  private secondaryPositions: Float32Array | null = null;
  private secondaryMesh: THREE.Mesh | null = null;
  private secondaryCount = 0;
  private nucleusPosAttr: THREE.InstancedBufferAttribute | null = null;
  private nucleusPositions: Float32Array = new Float32Array(6);
  private backdrop: CinematicBackdropHandle | null = null;
  private currentPhase = 0;
  private currentModelTime = 0;
  private lastAppliedPhase = Number.NaN;
  private disposed = false;
  private readonly centerScratchA = new Float32Array(3);
  private readonly centerScratchB = new Float32Array(3);
  private nucleusHaloA: THREE.Mesh | null = null;
  private nucleusHaloB: THREE.Mesh | null = null;
  private readonly probe: Array<[number, number, number]> = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];

  async prepare(ctx: PrepareContext): Promise<{
    module: PhenomenonModule;
    scope: PrepareContext['scope'];
    scene: THREE.Scene;
    preset: PresetDescriptor;
  }> {
    if (this.disposed) throw new Error('[GalaxyCollisionModule] prepare() after dispose().');
    ctx.reportProgress(0.1, 'Loading galaxy-collision asset');
    throwIfAborted(ctx.signal);

    const dataset = await loadGc1Dataset(ASSET_ID, { signal: ctx.signal });
    throwIfAborted(ctx.signal);

    ctx.reportProgress(0.6, 'Building tracer point cloud');
    const tracerCount = dataset.tracerCount;
    const tracers = buildSpriteCloud(tracerCount);
    interpolateTracers(dataset, dataset.tStart, tracers.positions);
    tracers.posAttr.needsUpdate = true;

    const tracerMaterial = buildSpriteMaterial({
      colorA: DISK_A_COLOR,
      colorB: DISK_B_COLOR,
      sizePx: TRACER_SIZE_PX,
      intensity: TRACER_INTENSITY,
      softness: 2
    });
    const tracerMesh = new THREE.Mesh(tracers.geometry, tracerMaterial);
    tracerMesh.frustumCulled = false;
    tracerMesh.matrixAutoUpdate = false; // positions are already world-space
    tracerMesh.name = 'GalaxyCollisionTracers';

    const nuclei = buildSpriteCloud(2);
    const nucleusMaterial = buildSpriteMaterial({
      colorA: NUCLEUS_A_COLOR,
      colorB: NUCLEUS_B_COLOR,
      sizePx: NUCLEUS_SIZE_PX,
      intensity: NUCLEUS_INTENSITY,
      softness: 4
    });
    const nucleusMesh = new THREE.Mesh(nuclei.geometry, nucleusMaterial);
    nucleusMesh.frustumCulled = false;
    nucleusMesh.matrixAutoUpdate = false;
    nucleusMesh.name = 'GalaxyCollisionNuclei';
    const detail = CINEMATIC_DETAIL_BY_TIER[ctx.quality];

    // GC1's 1,600 source-driven tracers remain the authoritative morphology.
    // This separate bounded instanced population is generated around those
    // positions only to supply unresolved stellar density; it is not a second
    // trajectory solver or a claim of source-data resolution.
    const secondary = buildSpriteCloud(SECONDARY_EMITTER_CAPACITY);
    const secondaryMaterial = buildSpriteMaterial({
      colorA: [0.9, 0.64, 0.38],
      colorB: [0.5, 0.7, 1.0],
      sizePx: SECONDARY_SIZE_PX,
      intensity: SECONDARY_INTENSITY,
      softness: 2.8
    });
    const secondaryMesh = new THREE.Mesh(secondary.geometry, secondaryMaterial);
    secondaryMesh.frustumCulled = false;
    secondaryMesh.matrixAutoUpdate = false;
    secondaryMesh.name = 'GalaxyCollisionUnresolvedStars';
    secondaryMesh.renderOrder = 1;

    // The GC1 tracers remain the sole source of galaxy morphology. These
    // bounded nucleus halos only provide a soft stellar-core hierarchy so the
    // data-driven pair does not read as two hard sprite stamps.
    const nucleusHaloGeometry = new THREE.SphereGeometry(
      0.28,
      detail.haloSegments.width,
      detail.haloSegments.height
    );
    const nucleusHaloSurface = createCinematicHalo({
      tint: [1.0, 0.64, 0.22],
      seed: ctx.preset.seed ^ 0x9a1,
      gain: 0.9,
      alpha: 0.24,
      noiseScale: 4,
      noiseOctaves: detail.surfaceOctaves
    });
    const nucleusHaloA = new THREE.Mesh(nucleusHaloGeometry, nucleusHaloSurface.material);
    const nucleusHaloB = new THREE.Mesh(nucleusHaloGeometry, nucleusHaloSurface.material);
    nucleusHaloA.name = 'GalaxyCollisionNucleusHaloA';
    nucleusHaloB.name = 'GalaxyCollisionNucleusHaloB';
    nucleusHaloA.renderOrder = 5;
    nucleusHaloB.renderOrder = 5;

    ctx.scope.track(
      'geometry',
      tracers.geometry,
      () => tracers.geometry.dispose(),
      tracerCount * TRACER_POINT_ESTIMATED_BYTES
    );
    ctx.scope.track('material', tracerMaterial, () => tracerMaterial.dispose(), tracerCount * 256);
    ctx.scope.track(
      'geometry',
      nuclei.geometry,
      () => nuclei.geometry.dispose(),
      NUCLEUS_POINT_ESTIMATED_BYTES
    );
    ctx.scope.track('material', nucleusMaterial, () => nucleusMaterial.dispose(), 256 * 1024);
    ctx.scope.track(
      'geometry',
      secondary.geometry,
      () => secondary.geometry.dispose(),
      SECONDARY_EMITTER_CAPACITY * TRACER_POINT_ESTIMATED_BYTES
    );
    ctx.scope.track(
      'material',
      secondaryMaterial,
      () => secondaryMaterial.dispose(),
      SECONDARY_EMITTER_CAPACITY * 256
    );
    ctx.scope.track(
      'geometry',
      nucleusHaloGeometry,
      () => nucleusHaloGeometry.dispose(),
      detail.haloSegments.width * detail.haloSegments.height * 32
    );
    ctx.scope.track(
      'material',
      nucleusHaloSurface.material,
      () => nucleusHaloSurface.material.dispose(),
      4096
    );

    const scene = new THREE.Scene();
    const cinematicBackdrop = createCinematicBackdrop({
      seed: ctx.preset.seed,
      intensity: 0.18,
      dustColor: [0.028, 0.018, 0.04],
      starColor: [0.78, 0.78, 0.9],
      segments: detail.backdropSegments,
      octaves: detail.backdropOctaves,
      starCells: { x: 240, y: 120 }
    });
    scene.add(cinematicBackdrop.mesh);
    ctx.scope.track(
      'geometry',
      cinematicBackdrop.geometry,
      () => cinematicBackdrop.geometry.dispose(),
      32 * 20 * 32
    );
    ctx.scope.track(
      'material',
      cinematicBackdrop.material,
      () => cinematicBackdrop.material.dispose(),
      8192
    );
    this.backdrop = cinematicBackdrop;
    scene.add(nucleusMesh);
    scene.add(tracerMesh);
    scene.add(secondaryMesh);
    scene.add(nucleusHaloA, nucleusHaloB);

    this.dataset = dataset;
    this.scene = scene;
    this.tracerPosAttr = tracers.posAttr;
    this.tracerPositions = tracers.positions;
    this.secondaryPosAttr = secondary.posAttr;
    this.secondaryPositions = secondary.positions;
    this.secondaryMesh = secondaryMesh;
    this.secondaryCount = 0;
    this.nucleusPosAttr = nuclei.posAttr;
    this.nucleusPositions = nuclei.positions;
    this.nucleusHaloA = nucleusHaloA;
    this.nucleusHaloB = nucleusHaloB;
    this.currentPhase = ctx.preset.timelineInitialPhase;

    ctx.reportProgress(1, 'Galaxy collision ready');
    return { module: this, scope: ctx.scope, scene, preset: ctx.preset };
  }

  enter(ctx: EnterContext): void {
    if (this.disposed) return;
    const dataset = this.dataset;
    if (dataset !== null) {
      // Timeline in MODEL time (units sqrt(R^3/GM), pericenter at t = 0) with an
      // explicit wall-clock pace and looping, so the encounter plays instead of
      // saturating the shared identity mapping within its first second.
      const span = dataset.tEnd - dataset.tStart;
      ctx.services.time.registerPhaseMapping('gc-encounter', {
        id: 'gc-encounter',
        label: 'Encounter time',
        forward: (phase01) => phaseToModelTime(dataset, phase01),
        inverse: (t) => (span > 0 ? (t - dataset.tStart) / span : 0),
        formatDisplay: (t) =>
          `${t >= 0 ? '+' : '−'}${Math.abs(t).toFixed(1)} τ · ${encounterStage(t)}`,
        playbackSeconds: TIMELINE_PLAYBACK_SECONDS,
        loop: true
      });
      ctx.services.time.setPhaseMapping('gc-encounter');
      ctx.services.time.scrubTo(this.currentPhase);
    }
    this.applyPhase(this.currentPhase);
  }

  update(ctx: FrameContext): void {
    if (this.disposed || this.dataset === null) return;
    this.applyPhase(ctx.time.phase);
    const secondaryDetail =
      ctx.experienceMode === 'cinematic' ? ctx.workBudget.environmentDetail : 0;
    this.secondaryCount = Math.round(SECONDARY_EMITTER_CAPACITY * secondaryDetail);
    if (this.secondaryMesh !== null) {
      (this.secondaryMesh.geometry as THREE.InstancedBufferGeometry).instanceCount =
        this.secondaryCount;
      this.secondaryMesh.visible = this.secondaryCount > 0;
    }
    this.backdrop?.setDetail(secondaryDetail);
    this.backdrop?.setIntensity(ctx.experienceMode === 'cinematic' ? 0.48 : 0.18);
  }

  private applyPhase(phase: number): void {
    if (this.dataset === null || this.tracerPositions === null) return;
    if (phase === this.lastAppliedPhase) return;
    this.lastAppliedPhase = phase;
    this.currentPhase = phase;
    const t = phaseToModelTime(this.dataset, phase);
    this.currentModelTime = t;
    interpolateTracers(this.dataset, t, this.tracerPositions);
    interpolateCenters(this.dataset, t, this.centerScratchA, this.centerScratchB);
    this.nucleusPositions[0] = this.centerScratchA[0] ?? 0;
    this.nucleusPositions[1] = this.centerScratchA[1] ?? 0;
    this.nucleusPositions[2] = this.centerScratchA[2] ?? 0;
    this.nucleusPositions[3] = this.centerScratchB[0] ?? 0;
    this.nucleusPositions[4] = this.centerScratchB[1] ?? 0;
    this.nucleusPositions[5] = this.centerScratchB[2] ?? 0;
    this.nucleusHaloA?.position.set(
      this.nucleusPositions[0] ?? 0,
      this.nucleusPositions[1] ?? 0,
      this.nucleusPositions[2] ?? 0
    );
    this.nucleusHaloB?.position.set(
      this.nucleusPositions[3] ?? 0,
      this.nucleusPositions[4] ?? 0,
      this.nucleusPositions[5] ?? 0
    );
    if (this.tracerPosAttr) this.tracerPosAttr.needsUpdate = true;
    if (this.nucleusPosAttr) this.nucleusPosAttr.needsUpdate = true;
    if (this.secondaryPositions !== null && this.secondaryPosAttr !== null) {
      const sourceCount = this.dataset.tracerCount;
      for (let i = 0; i < SECONDARY_EMITTER_CAPACITY; i += 1) {
        const source = sourceCount > 0 ? (i * 17 + 11) % sourceCount : 0;
        const sourceOffset = source * 3;
        const angle = hash01(i + 0x4f31) * Math.PI * 2;
        const elevation = hash01(i + 0x8217) * 2 - 1;
        const spread = 0.035 + hash01(i + 0xb19d) * 0.18;
        const radial = Math.sqrt(Math.max(0, 1 - elevation * elevation));
        const targetOffset = i * 3;
        this.secondaryPositions[targetOffset] =
          (this.tracerPositions?.[sourceOffset] ?? 0) + Math.cos(angle) * radial * spread;
        this.secondaryPositions[targetOffset + 1] =
          (this.tracerPositions?.[sourceOffset + 1] ?? 0) + elevation * spread * 0.42;
        this.secondaryPositions[targetOffset + 2] =
          (this.tracerPositions?.[sourceOffset + 2] ?? 0) + Math.sin(angle) * radial * spread;
      }
      this.secondaryPosAttr.needsUpdate = true;
    }

    for (let i = 0; i < PROBE_INDICES.length; i += 1) {
      const idx = PROBE_INDICES[i]!;
      const probe = this.probe[i]!;
      probe[0] = this.tracerPositions[idx * 3] ?? 0;
      probe[1] = this.tracerPositions[idx * 3 + 1] ?? 0;
      probe[2] = this.tracerPositions[idx * 3 + 2] ?? 0;
    }
  }

  render(ctx: RenderContext): void {
    if (this.disposed || this.scene === null) return;
    this.backdrop?.syncToCamera(ctx.camera);
    this.backdrop?.setTime(this.currentModelTime * 0.001);
    ctx.renderer.render(this.scene, ctx.camera);
  }

  exit(_ctx: ExitContext): void {
    // No module-side freeze; the director snapshots via SharedPost.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // GPU objects are owned by the prepare scope; drop references only.
    this.dataset = null;
    this.scene = null;
    this.tracerPosAttr = null;
    this.tracerPositions = null;
    this.secondaryPosAttr = null;
    this.secondaryPositions = null;
    this.secondaryMesh = null;
    this.secondaryCount = 0;
    this.nucleusPosAttr = null;
    this.nucleusHaloA = null;
    this.nucleusHaloB = null;
    this.backdrop = null;
    this.lastAppliedPhase = Number.NaN;
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      assetId: ASSET_ID,
      tracerCount: this.dataset?.tracerCount ?? null,
      keyframeCount: this.dataset?.keyframeCount ?? null,
      phase: this.currentPhase,
      modelTime: this.currentModelTime,
      stage: encounterStage(this.currentModelTime),
      probe0: this.probe[0] ?? null,
      probe1: this.probe[1] ?? null,
      probe2: this.probe[2] ?? null,
      authoritativeTracerCount: this.dataset?.tracerCount ?? null,
      unresolvedEmitterCapacity: SECONDARY_EMITTER_CAPACITY,
      unresolvedEmitterCount: this.secondaryCount,
      unresolvedEmitterSource: 'deterministic offsets around GC1 tracers',
      disposed: this.disposed
    };
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('GalaxyCollisionModule prepare aborted', 'AbortError');
  }
}

// Re-export for callers that want the typed error without importing dataset.ts.
export { Gc1LoadError };
