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
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsNodeMaterial,
  Scene
} from 'three/webgpu';

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
const TRACER_COLOR = new Color(1.0, 0.88, 0.66);
const NUCLEUS_COLOR = new Color(0.6, 0.8, 1.0);
const PROBE_INDICES = [0, 1, 2];

export function createGalaxyCollisionModule(): PhenomenonModule {
  return new GalaxyCollisionModule();
}

class GalaxyCollisionModule implements PhenomenonModule {
  readonly descriptor: PhenomenonDescriptor = GALAXY_COLLISION_DESCRIPTOR;

  private dataset: Gc1Dataset | null = null;
  private scene: Scene | null = null;
  private tracerGeometry: BufferGeometry | null = null;
  private tracerPositions: Float32Array | null = null;
  private nucleusGeometry: BufferGeometry | null = null;
  private nucleusPositions = new Float32Array(6);
  private currentPhase = 0;
  private disposed = false;
  private probe: Array<[number, number, number]> = [];

  async prepare(ctx: PrepareContext): Promise<{
    module: PhenomenonModule;
    scope: PrepareContext['scope'];
    scene: Scene;
    preset: PresetDescriptor;
  }> {
    if (this.disposed) throw new Error('[GalaxyCollisionModule] prepare() after dispose().');
    ctx.reportProgress(0.1, 'Loading galaxy-collision asset');
    throwIfAborted(ctx.signal);

    const dataset = await loadGc1Dataset(ASSET_ID, { signal: ctx.signal });
    throwIfAborted(ctx.signal);

    ctx.reportProgress(0.6, 'Building tracer point cloud');
    const tracerCount = dataset.tracerCount;
    const tracerPositions = new Float32Array(tracerCount * 3);
    interpolateTracers(dataset, dataset.tStart, tracerPositions);

    const tracerGeometry = new BufferGeometry();
    tracerGeometry.setAttribute('position', new BufferAttribute(tracerPositions, 3));
    const tracerMaterial = new PointsNodeMaterial();
    tracerMaterial.color = TRACER_COLOR;
    tracerMaterial.size = 2.0;
    tracerMaterial.transparent = true;
    tracerMaterial.blending = AdditiveBlending;
    tracerMaterial.depthWrite = false;
    const tracerPoints = new Points(tracerGeometry, tracerMaterial);
    tracerMaterial.size = 2.0;

    const nucleusGeometry = new BufferGeometry();
    nucleusGeometry.setAttribute('position', new BufferAttribute(this.nucleusPositions, 3));
    const nucleusMaterial = new PointsNodeMaterial();
    nucleusMaterial.color = NUCLEUS_COLOR;
    nucleusMaterial.size = 9.0;
    nucleusMaterial.transparent = true;
    nucleusMaterial.blending = AdditiveBlending;
    nucleusMaterial.depthWrite = false;
    const nucleusPoints = new Points(nucleusGeometry, nucleusMaterial);
    nucleusMaterial.size = 9.0;

    ctx.scope.track(
      'geometry',
      tracerGeometry,
      () => tracerGeometry.dispose(),
      tracerCount * TRACER_POINT_ESTIMATED_BYTES
    );
    ctx.scope.track('material', tracerMaterial, () => tracerMaterial.dispose(), tracerCount * 256);
    ctx.scope.track(
      'geometry',
      nucleusGeometry,
      () => nucleusGeometry.dispose(),
      NUCLEUS_POINT_ESTIMATED_BYTES
    );
    ctx.scope.track('material', nucleusMaterial, () => nucleusMaterial.dispose(), 256 * 1024);

    const scene = new Scene();
    scene.add(nucleusPoints);
    scene.add(tracerPoints);

    this.dataset = dataset;
    this.scene = scene;
    this.tracerGeometry = tracerGeometry;
    this.tracerPositions = tracerPositions;
    this.nucleusGeometry = nucleusGeometry;
    this.currentPhase = ctx.preset.timelineInitialPhase;

    ctx.reportProgress(1, 'Galaxy collision ready');
    return { module: this, scope: ctx.scope, scene, preset: ctx.preset };
  }

  enter(_ctx: EnterContext): void {
    if (this.disposed) return;
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
    if (this.tracerGeometry) this.tracerGeometry.attributes.position!.needsUpdate = true;
    if (this.nucleusGeometry) this.nucleusGeometry.attributes.position!.needsUpdate = true;

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
    this.tracerGeometry = null;
    this.tracerPositions = null;
    this.nucleusGeometry = null;
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      assetId: ASSET_ID,
      tracerCount: this.dataset?.tracerCount ?? null,
      keyframeCount: this.dataset?.keyframeCount ?? null,
      phase: this.currentPhase,
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
