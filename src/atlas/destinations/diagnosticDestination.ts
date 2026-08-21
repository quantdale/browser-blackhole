/**
 * Diagnostic destination — deterministic fullscreen test pattern (CA0-03
 * reference module).
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §4 (module lifecycle: prepare → enter →
 *   update → render → exit → dispose) and §5 (resource scopes).
 * - docs/cosmic-atlas/DECISIONS.md CA-ADR-006 (fidelity declared, never
 *   overstated), CA-ADR-014 (deterministic presets).
 * - docs/cosmic-atlas/WORK_PACKETS.md CA0-03/CA0-08 (lifecycle contract,
 *   repeated-navigation bounded resources).
 *
 * Fidelity disclosure: this destination renders the shared camera-ray
 * direction-gradient pattern from `src/shaders/diagnostic.ts`
 * (`createDiagnosticPass()`), reused by adding its mesh into the prepared
 * scene. It is a deterministic test pattern with NO physics claims — hence
 * fidelity 'DIRECT' and the explicit fidelityNote.
 *
 * Determinism: same camera basis + NDC ⇒ same color; update() is a no-op and
 * nothing here reads wall-clock time or randomness.
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
// Metadata (light consts; heavy imports are reached through descriptor.load())
// ---------------------------------------------------------------------------

/** Byte estimates for the single triangle geometry / node material. */
const GEOMETRY_ESTIMATED_BYTES = 1024;
const MATERIAL_ESTIMATED_BYTES = 256 * 1024;

export const DIAGNOSTIC_PRESETS: PresetDescriptor[] = [
  {
    id: 'default',
    displayName: 'Diagnostic Default',
    destinationId: 'diagnostic',
    stateSchemaVersion: 1,
    fidelityNote:
      'Deterministic camera-ray direction gradient; a test pattern with no physics claims.',
    state: {},
    camera: {
      position: [0, 0, 6],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovDeg: 60
    },
    seed: 1,
    timelineInitialPhase: 0
  }
];

export const diagnosticDescriptor: PhenomenonDescriptor = {
  id: 'diagnostic',
  title: 'Diagnostic Grid',
  group: 'lab',
  fidelity: 'DIRECT',
  route: 'diagnostic',
  defaultPreset: 'default',
  requiredCapabilities: [],
  // Estimates only: one fullscreen triangle plus a TSL node material; the
  // per-tier spread reflects typical intermediate-target sizing headroom.
  estimatedGpuMemoryMB: { low: 2, medium: 4, high: 8, ultra: 16 },
  load: async () => createDiagnosticModule
};

/** Factory handed out through `descriptor.load()` (lazy dynamic import). */
export function createDiagnosticModule(): PhenomenonModule {
  return new DiagnosticModule();
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export class DiagnosticModule implements PhenomenonModule {
  readonly descriptor = diagnosticDescriptor;

  private pass: DiagnosticPass | null = null;
  private scene: Scene | null = null;
  private disposed = false;

  async prepare(ctx: PrepareContext): Promise<{
    module: PhenomenonModule;
    scope: PrepareContext['scope'];
    scene: Scene;
    preset: PresetDescriptor;
  }> {
    if (this.disposed) throw new Error('[DiagnosticModule] prepare() called after dispose().');

    ctx.reportProgress(0.15, 'Creating diagnostic fullscreen pass');
    throwIfAborted(ctx.signal);
    const pass = createDiagnosticPass();

    ctx.reportProgress(0.55, 'Registering pass resources in scope');
    throwIfAborted(ctx.signal);
    // Ownership: the prepared scope disposes geometry/material (and thereby
    // detaches the mesh) when the host releases this destination.
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

    // A THREE object has one parent: adopt the pass mesh into OUR scene so the
    // kernel renders it; the pass's own internal scene stays empty/unused.
    const scene = new Scene();
    scene.add(pass.mesh);

    this.pass = pass;
    this.scene = scene;

    ctx.reportProgress(1, 'Diagnostic ready');
    return { module: this, scope: ctx.scope, scene, preset: ctx.preset };
  }

  enter(ctx: EnterContext): void {
    if (this.disposed) return;
    // Gradient mode ('diagnostic'); viewOff=0 selects dir*0.5+0.5.
    if (this.pass !== null) this.pass.uniforms.viewOff.value = 0;
    void ctx;
  }

  /** Deterministic no-op: the pattern depends only on the camera basis. */
  update(_ctx: FrameContext): void {
    // Intentionally empty.
  }

  render(ctx: RenderContext): void {
    if (this.disposed || this.scene === null || this.pass === null) return;
    applyCameraBasis(this.pass.uniforms, ctx.camera);
    ctx.renderer.render(this.scene, ctx.camera);
  }

  exit(_ctx: ExitContext): void {
    // Nothing to freeze module-side; the director snapshots via SharedPost.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // GPU objects are owned by the prepare scope; drop references only.
    this.pass = null;
    this.scene = null;
  }

  serializeShareState(): Record<string, unknown> {
    return { viewMode: 'direction-gradient' };
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      pattern: 'camera-ray direction gradient (dir*0.5+0.5)',
      viewOff: this.pass?.uniforms.viewOff.value ?? null,
      disposed: this.disposed,
      presetSeed: DIAGNOSTIC_PRESETS[0]?.seed ?? null
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('DiagnosticModule prepare aborted', 'AbortError');
  }
}

/**
 * Map the canonical camera basis into the diagnostic uniform block
 * (docs/SHADER_CONTRACTS.md §2/§3; mirrors extractBasisFromMatrix in
 * src/camera/CameraController.ts). Three cameras look down local -Z, so
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
