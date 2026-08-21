/**
 * Black-hole destination ADAPTER — lifecycle seam around the Schwarzschild
 * backwards-ray-tracing pass (CA0-05 + M2/M3 renderer integration).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DECISIONS.md CA-ADR-013 — the black-hole renderer stays
 *   scientifically independent; shared abstractions adapt to it, never the
 *   reverse. This module owns NO physics math: geodesics live in
 *   src/phenomena/black-hole/schwarzschildIntegrator.ts behind
 *   LensingService.createBlackHoleLensingPass; this module only feeds camera
 *   state and lifecycle.
 * - docs/cosmic-atlas/ARCHITECTURE.md §4 (lifecycle), §5 (scopes).
 * - docs/cosmic-atlas/WORK_PACKETS.md CA0-05; docs/ROADMAP.md M2-09/M3-05.
 *
 * Honesty notes:
 * - fidelity 'DIRECT': the primary path is the full numerical Schwarzschild
 *   geodesic integrator (GPU f32; CPU binary64 reference stays the oracle).
 * - If lensing-pass construction fails, prepare() falls back to the
 *   deterministic fullscreen pass and reports that truthfully in its debug
 *   snapshot (`lensingWired: false`) — never silently.
 * - `estimatedGpuMemoryMB` values remain documented GUESSES/estimates.
 */

import { Scene, Vector3 } from 'three/webgpu';
import type { PerspectiveCamera } from 'three';

import { createDiagnosticPass } from '../../shaders/diagnostic.js';
import type { DiagnosticPass, DiagnosticUniformBlock } from '../../shaders/diagnostic.js';
import type { ILensingService } from '../types.js';
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

/** Handle shape returned by LensingService.createBlackHoleLensingPass. */
type LensingHandle = ReturnType<ILensingService['createBlackHoleLensingPass']>;

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const GEOMETRY_ESTIMATED_BYTES = 1024;
const MATERIAL_ESTIMATED_BYTES = 256 * 1024;

/** Disk geometry defaults: ISCO inner edge, 3x outer span (r_g units). */
const DISK_INNER_RG = 6;
const DISK_OUTER_RG = 18;
/** Escape classification radius (r_g) — far enough that deflection is done. */
const ESCAPE_RADIUS_RG = 60;

/** Gentle cinematic orbit rate used when a preset enables `state.orbit`. */
const ORBIT_RATE_DEG_PER_SECOND = 2;

export const BLACK_HOLE_PRESETS: PresetDescriptor[] = [
  {
    id: 'default',
    displayName: 'Black Hole — Default',
    destinationId: 'black-hole',
    stateSchemaVersion: 1,
    fidelityNote:
      'Full numerical Schwarzschild backwards ray tracing (GPU f32 integrator; CPU binary64 reference is the oracle). Disk: Shakura-Sunyaev thin disk, ISCO inner edge.',
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
      'Same Schwarzschild lensing path as the default preset; differs only in arrival camera and a slow time-driven orbit.',
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

  private lensing: LensingHandle | null = null;
  private fallbackPass: DiagnosticPass | null = null;
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

    ctx.reportProgress(0.15, 'Creating Schwarzschild lensing pass');
    throwIfAborted(ctx.signal);
    const scene = new Scene();
    try {
      // Primary path: full backwards ray tracing through the shared
      // LensingService (physics owned by schwarzschildIntegrator.ts).
      const handle = ctx.services.lensing.createBlackHoleLensingPass({
        massRg: 1,
        backgroundEquirect: null,
        diskEnabled: true,
        diskInnerRg: DISK_INNER_RG,
        diskOuterRg: DISK_OUTER_RG,
        qualityTier: ctx.quality
      });
      ctx.scope.track(
        'geometry',
        handle.object3d().geometry,
        () => handle.object3d().geometry.dispose(),
        GEOMETRY_ESTIMATED_BYTES
      );
      ctx.scope.track(
        'material',
        handle.object3d().material,
        () => handle.dispose(),
        MATERIAL_ESTIMATED_BYTES
      );
      this.lensing = handle;
      scene.add(handle.object3d());
    } catch {
      // Honest degraded path: deterministic fullscreen pattern, flagged in the
      // debug snapshot. Never presented as geodesic lensing.
      ctx.reportProgress(0.4, 'Lensing pass unavailable — deterministic fallback');
      throwIfAborted(ctx.signal);
      const pass = createDiagnosticPass();
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
      this.fallbackPass = pass;
      scene.add(pass.mesh);
    }

    ctx.reportProgress(0.85, 'Registering pass resources in scope');
    throwIfAborted(ctx.signal);

    this.scene = scene;

    ctx.reportProgress(1, 'Black hole ready');
    return { module: this, scope: ctx.scope, scene, preset: ctx.preset };
  }

  enter(ctx: EnterContext): void {
    if (this.disposed) return;
    if (this.fallbackPass !== null) this.fallbackPass.uniforms.viewOff.value = 0;
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
    if (this.disposed || this.scene === null) return;
    if (this.lensing !== null) {
      this.lensing.setUniformsFromState(
        cameraLensingState(ctx.camera, DISK_INNER_RG, DISK_OUTER_RG)
      );
    } else if (this.fallbackPass !== null) {
      applyCameraBasis(this.fallbackPass.uniforms, ctx.camera);
    }
    ctx.renderer.render(this.scene, ctx.camera);
  }

  exit(_ctx: ExitContext): void {
    // Freeze handled by the director's SharedPost snapshot.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // GPU objects are owned by the prepare scope; drop references only.
    this.lensing = null;
    this.fallbackPass = null;
    this.scene = null;
    this.orbitEnabled = false;
  }

  serializeShareState(): Record<string, unknown> {
    return { orbit: this.orbitEnabled };
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      pattern:
        this.lensing !== null
          ? 'schwarzschild geodesic lensing + accretion disk'
          : 'fullscreen pass fallback (lensing construction failed)',
      lensingWired: this.lensing !== null,
      diskInnerRg: DISK_INNER_RG,
      diskOuterRg: DISK_OUTER_RG,
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

/** Scratch vectors for per-frame lensing state assembly (no allocation churn). */
const scratchRight = new Vector3();
const scratchUp = new Vector3();
const scratchForward = new Vector3();

/**
 * Builds the flat state record consumed by
 * `LensingService.createBlackHoleLensingPass().setUniformsFromState`
 * (accepted keys documented in schwarzschildIntegrator.ts). Scene units are
 * r_g with M = 1; disk normal is world +Y per docs/WORLD_FRAME.md §1.
 */
function cameraLensingState(
  camera: PerspectiveCamera,
  diskInnerRg: number,
  diskOuterRg: number
): Record<string, unknown> {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  scratchRight.set(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0).normalize();
  scratchUp.set(e[4] ?? 0, e[5] ?? 0, e[6] ?? 0).normalize();
  scratchForward.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 0)).normalize();
  const aspect = camera.aspect;
  return {
    cameraPositionRg: [camera.position.x, camera.position.y, camera.position.z],
    cameraRight: [scratchRight.x, scratchRight.y, scratchRight.z],
    cameraUp: [scratchUp.x, scratchUp.y, scratchUp.z],
    cameraForward: [scratchForward.x, scratchForward.y, scratchForward.z],
    tanHalfFovY: Math.tan((camera.fov * Math.PI) / 360),
    aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1,
    massRg: 1,
    centerRg: [0, 0, 0],
    diskEnabled: true,
    diskInnerRg,
    diskOuterRg,
    escapeRadiusRg: ESCAPE_RADIUS_RG,
    backgroundIntensity: 1
  };
}
