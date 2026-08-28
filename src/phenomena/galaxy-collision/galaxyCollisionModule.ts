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
const NUCLEUS_SIZE_PX = 34;
/** Additive radiance scale per sprite before brightness jitter. */
const TRACER_INTENSITY = 1.6;
const NUCLEUS_INTENSITY = 3.5;

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
  private nucleusPosAttr: THREE.InstancedBufferAttribute | null = null;
  private nucleusPositions: Float32Array = new Float32Array(6);
  private currentPhase = 0;
  private currentModelTime = 0;
  private disposed = false;
  private probe: Array<[number, number, number]> = [];

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

    const scene = new THREE.Scene();
    scene.add(nucleusMesh);
    scene.add(tracerMesh);

    this.dataset = dataset;
    this.scene = scene;
    this.tracerPosAttr = tracers.posAttr;
    this.tracerPositions = tracers.positions;
    this.nucleusPosAttr = nuclei.posAttr;
    this.nucleusPositions = nuclei.positions;
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
  }

  private applyPhase(phase: number): void {
    if (this.dataset === null || this.tracerPositions === null) return;
    this.currentPhase = phase;
    const t = phaseToModelTime(this.dataset, phase);
    this.currentModelTime = t;
    interpolateTracers(this.dataset, t, this.tracerPositions);
    const x1 = new Float32Array(3);
    const x2 = new Float32Array(3);
    interpolateCenters(this.dataset, t, x1, x2);
    this.nucleusPositions[0] = x1[0] ?? 0;
    this.nucleusPositions[1] = x1[1] ?? 0;
    this.nucleusPositions[2] = x1[2] ?? 0;
    this.nucleusPositions[3] = x2[0] ?? 0;
    this.nucleusPositions[4] = x2[1] ?? 0;
    this.nucleusPositions[5] = x2[2] ?? 0;
    if (this.tracerPosAttr) this.tracerPosAttr.needsUpdate = true;
    if (this.nucleusPosAttr) this.nucleusPosAttr.needsUpdate = true;

    this.probe = PROBE_INDICES.map((idx) => [
      this.tracerPositions![idx * 3] ?? 0,
      this.tracerPositions![idx * 3 + 1] ?? 0,
      this.tracerPositions![idx * 3 + 2] ?? 0
    ]);
  }

  render(ctx: RenderContext): void {
    if (this.disposed || this.scene === null) return;
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
    this.nucleusPosAttr = null;
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
