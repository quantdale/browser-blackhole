/**
 * Black-hole destination ADAPTER — lifecycle seam around the existing
 * black-hole visual path (CA0-05).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DECISIONS.md CA-ADR-013 — the black-hole renderer stays
 *   scientifically independent; shared abstractions adapt to it, never the
 *   reverse. This module therefore touches NO physics: it wraps the shared
 *   fullscreen pass as the current main visual and exists so transitions,
 *   scopes, presets and routing work end-to-end while the real Schwarzschild
 *   lensing path is wired in a later packet.
 * - docs/cosmic-atlas/ARCHITECTURE.md §4 (lifecycle), §5 (scopes).
 * - docs/cosmic-atlas/WORK_PACKETS.md CA0-05.
 *
 * Honesty notes:
 * - fidelity 'DIRECT' with an explicit fidelityNote: the current adapter shows
 *   the deterministic fullscreen pass, not geodesic lensing.
 * - `estimatedGpuMemoryMB` values are documented GUESSES/estimates until the
 *   real lensing pass lands; they are not measurements.
 */

import { Scene } from 'three/webgpu';
import type { PerspectiveCamera } from 'three';

import { createDiagnosticPass } from '../../shaders/diagnostic.js';
import type { DiagnosticPass, DiagnosticUniformBlock } from '../../shaders/diagnostic.js';
import type {
  EnterContext,
  ExitContext,
  FrameContext,
  PhenomenonDescriptor,
  PhenomenonModule,
  PrepareContext,
  PresetDescriptor,
  RenderContext
} from '../types.js';

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const GEOMETRY_ESTIMATED_BYTES = 1024;
const MATERIAL_ESTIMATED_BYTES = 256 * 1024;

/** Gentle cinematic orbit rate used when a preset enables `state.orbit`. */
const ORBIT_RATE_DEG_PER_SECOND = 2;

export const BLACK_HOLE_PRESETS: PresetDescriptor[] = [
  {
    id: 'default',
    displayName: 'Black Hole — Default',
    destinationId: 'black-hole',
    stateSchemaVersion: 1,
    fidelityNote:
      'Adapter placeholder: deterministic fullscreen pass. Schwarzschild geodesic lensing is wired in a later packet; physics untouched (CA-ADR-013).',
    state: { orbit: false },
    camera: {
      position: [0, 2.5, 16],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovDeg: 55
    },
    seed: 7,
    timelineInitialPhase: 0
  },
  {
    id: 'cinematic-orbit',
    displayName: 'Black Hole — Cinematic Orbit',
    destinationId: 'black-hole',
    stateSchemaVersion: 1,
    fidelityNote:
      'Same adapter placeholder as the default preset; differs only in arrival camera and a slow time-driven orbit.',
    state: { orbit: true },
    camera: {
      position: [12, 5, 12],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovDeg: 60
    },
    seed: 11,
    timelineInitialPhase: 0
  }
];

export const blackHoleDescriptor: PhenomenonDescriptor = {
  id: 'black-hole',
  title: 'Black Hole',
  group: 'compact',
  fidelity: 'DIRECT',
  route: 'black-hole',
  defaultPreset: 'default',
  requiredCapabilities: [],
  // ESTIMATES, not measurements: projected budget once the full backwards
  // ray-tracing pass replaces the placeholder (HDR intermediates dominate).
  estimatedGpuMemoryMB: { low: 64, medium: 128, high: 256, ultra: 512 },
  load: async () => createBlackHoleModule
};

/** Factory handed out through `descriptor.load()` (lazy dynamic import). */
export function createBlackHoleModule(): PhenomenonModule {
  return new BlackHoleModule();
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export class BlackHoleModule implements PhenomenonModule {
  readonly descriptor = blackHoleDescriptor;

  private pass: DiagnosticPass | null = null;
  private scene: Scene | null = null;
  private orbitEnabled = false;
  private disposed = false;

  async prepare(ctx: PrepareContext): Promise<{
    module: PhenomenonModule;
    scope: PrepareContext['scope'];
    scene: Scene;
    preset: PresetDescriptor;
  }> {
    if (this.disposed) throw new Error('[BlackHoleModule] prepare() called after dispose().');

    ctx.reportProgress(0.15, 'Creating fullscreen pass');
    throwIfAborted(ctx.signal);
    const pass = createDiagnosticPass();

    ctx.reportProgress(0.55, 'Registering pass resources in scope');
    throwIfAborted(ctx.signal);
    ctx.scope.track(
      'geometry',
      pass.mesh.geometry,
      () => pass.mesh.geometry.dispose(),
      GEOMETRY_ESTIMATED_BYTES
    );
    ctx.scope.track(
      'material',
      pass.material,
      () => pass.material.dispose(),
      MATERIAL_ESTIMATED_BYTES
    );

    const scene = new Scene();
    scene.add(pass.mesh);

    this.pass = pass;
    this.scene = scene;

    ctx.reportProgress(1, 'Black hole ready');
    return { module: this, scope: ctx.scope, scene, preset: ctx.preset };
  }

  enter(ctx: EnterContext): void {
    if (this.disposed) return;
    if (this.pass !== null) this.pass.uniforms.viewOff.value = 0;
    this.orbitEnabled = ctx.preset.state['orbit'] === true;
  }

  /**
   * Advances the gentle orbit ONLY when the active preset asks for it
   * (`state.orbit === true`); otherwise a no-op. Driven by frame dt, never by
   * wall-clock reads, so it stays deterministic under the atlas timeline.
   */
  update(ctx: FrameContext): void {
    if (this.disposed || !this.orbitEnabled) return;
    const rig = ctx.services.cameraRig;
    const orbit = rig.getOrbit();
    const azimuthDeg = (orbit.azimuthDeg + ORBIT_RATE_DEG_PER_SECOND * ctx.time.dt) % 360;
    rig.setOrbit(azimuthDeg, orbit.polarDeg, orbit.distance);
  }

  render(ctx: RenderContext): void {
    if (this.disposed || this.scene === null || this.pass === null) return;
    applyCameraBasis(this.pass.uniforms, ctx.camera);
    ctx.renderer.render(this.scene, ctx.camera);
  }

  exit(_ctx: ExitContext): void {
    // Freeze handled by the director's SharedPost snapshot.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // GPU objects are owned by the prepare scope; drop references only.
    this.pass = null;
    this.scene = null;
    this.orbitEnabled = false;
  }

  serializeShareState(): Record<string, unknown> {
    return { orbit: this.orbitEnabled };
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      pattern: 'fullscreen pass placeholder (no lensing yet)',
      lensingWired: false,
      orbitEnabled: this.orbitEnabled,
      disposed: this.disposed,
      estimatedGpuMemoryMBIsEstimate: true
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('BlackHoleModule prepare aborted', 'AbortError');
  }
}

/**
 * Map the canonical camera basis into the diagnostic uniform block
 * (docs/SHADER_CONTRACTS.md §2/§3). Three cameras look down local -Z, so
 * forward is the negated third column of the world matrix.
 */
function applyCameraBasis(uniforms: DiagnosticUniformBlock, camera: PerspectiveCamera): void {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  uniforms.cameraRight.value.set(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0).normalize();
  uniforms.cameraUp.value.set(e[4] ?? 0, e[5] ?? 0, e[6] ?? 0).normalize();
  uniforms.cameraForward.value.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 0)).normalize();
  uniforms.cameraPositionRg.value.copy(camera.position);
  uniforms.tanHalfFovY.value = Math.tan((camera.fov * Math.PI) / 360);
  const aspect = camera.aspect;
  uniforms.aspect.value = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
}
