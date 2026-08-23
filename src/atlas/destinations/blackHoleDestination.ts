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
import {
  buildLutGpuResources,
  type LutGpuResources
} from '../../phenomena/black-hole/lut/textures.js';
import { loadLutFamily, formatWebGL2Status } from '../../phenomena/black-hole/lut/runtime.js';
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
const ESCAPE_RADIUS_RG = 32;

/**
 * Per-tier integration step budgets pushed to the integrator's uMaxSteps
 * uniform each frame. Must stay <= the integrator's compile-time ceiling.
 */
const TIER_STEP_BUDGETS: Record<FrameContext['quality'], number> = {
  low: 256,
  medium: 512,
  high: 1024,
  ultra: 2048
};

/** Gentle cinematic orbit rate used when a preset enables `state.orbit`. */
const ORBIT_RATE_DEG_PER_SECOND = 2;

/**
 * Display recommendations for the production preset set (campaign §10:
 * physics / observer / display / quality defined SEPARATELY — display values
 * here never alter the lensing or disk model, which stay identical across
 * every presentation preset).
 */
const DISPLAY_SCIENTIFIC = {
  exposure: 1,
  toneMapping: 'aces-filmic',
  bloomEnabled: false,
  bloomStrength: 0
} as const;

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
  },
  {
    id: 'face-on-disk',
    displayName: 'Face-on Disk',
    destinationId: 'black-hole',
    stateSchemaVersion: 1,
    fidelityNote:
      'Same full numerical Schwarzschild ray tracer as the default preset; observer placed near the disk symmetry axis so the face-on reference geometry (no Doppler asymmetry expected) can be inspected directly.',
    state: { orbit: false },
    camera: { position: [1.5, 22, 4], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 50 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'medium'
  },
  {
    id: 'edge-on-lensing',
    displayName: 'Edge-on Lensing',
    destinationId: 'black-hole',
    stateSchemaVersion: 1,
    fidelityNote:
      'Identical lensing/disk model viewed from near the disk plane, emphasizing the upper/lower secondary disk images produced by strong-field light bending.',
    state: { orbit: false },
    camera: { position: [17, 0.9, 6], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: { exposure: 1.2, toneMapping: 'aces-filmic', bloomEnabled: false, bloomStrength: 0 },
    recommendedQuality: 'medium'
  },
  {
    id: 'photon-ring',
    displayName: 'Photon Ring',
    destinationId: 'black-hole',
    stateSchemaVersion: 1,
    fidelityNote:
      'Identical lensing/disk model with a closer camera framing the critical impact parameter; display recommendation raises exposure slightly to keep high-order ring structure readable. Physics unchanged.',
    state: { orbit: false },
    camera: { position: [0, 1.2, 9.5], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 45 },
    seed: 7,
    timelineInitialPhase: 0,
    display: { exposure: 1.5, toneMapping: 'aces-filmic', bloomEnabled: true, bloomStrength: 0.35 },
    recommendedQuality: 'high'
  },
  {
    id: 'doppler-demo',
    displayName: 'Doppler Demonstration',
    destinationId: 'black-hole',
    stateSchemaVersion: 1,
    fidelityNote:
      'Edge-on-ish view of the SAME Shakura-Sunyaev disk with relativistic beaming enabled, making the approaching/receding brightness contrast directly visible. No model change versus other presets.',
    state: { orbit: false },
    camera: { position: [14, 3, 8], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: { exposure: 1.15, toneMapping: 'aces-filmic', bloomEnabled: false, bloomStrength: 0 },
    recommendedQuality: 'medium'
  },
  {
    id: 'debug-parity',
    displayName: 'Black Hole — Debug Parity View',
    destinationId: 'black-hole',
    stateSchemaVersion: 1,
    fidelityNote:
      'DEBUG TOOL, not a presentation: ESCAPED rays output their terminal tetrad-projected direction encoded rgb = dir*0.5+0.5 (linear); CAPTURED rays pure black; numerical failures failure-magenta. Disk disabled. Consumed by tests/browser/integrator-parity.spec.ts against cpuReference.integratePhoton.',
    state: { debugParity: true },
    camera: {
      position: [0, 2.5, 16],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovDeg: 55
    },
    seed: 7,
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
  private debugParity = false;
  private lastQualityTier: FrameContext['quality'] = 'medium';
  private disposed = false;

  /** LUT backend state (M8-06). Null until a valid family loads. */
  private lut: {
    resources: LutGpuResources;
    storedSpanRad: number;
    bCriticalRg: number;
    hybridBandHalfWidthX: number;
    familyDir: string;
    webgl2Filterable: boolean;
  } | null = null;
  /** Requested trajectory backend; effective resolution in render(). */
  private lastEffectiveBackend: 'numerical' | 'lut' = 'numerical';
  private lastFallbackReason: string | null = null;

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

    // --- LUT family load (M8-06): best-effort, never blocks the numerical
    // path. Any failure records a truthful reason and continues numerical.
    ctx.reportProgress(0.2, 'Loading Schwarzschild LUT family');
    try {
      const lut = await loadShippedLutFamily();
      if (lut !== null) {
        this.lut = lut;
        ctx.scope.track(
          'texture',
          lut.resources,
          () => lut.resources.dispose(),
          lut.resources.byteEstimate
        );
      }
    } catch (error) {
      console.warn('[BlackHoleModule] LUT family load failed:', error);
      this.lut = null;
    }

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
      // Decide the pass ONCE, up front:
      // - ?trajectory=lut AND valid family -> LUT material
      // - otherwise -> the CERTIFIED numerical material (untouched)
      // This keeps the production numerical path byte-identical when LUT
      // is not explicitly requested (mission section 10).
      const wantLutPass = this.lut !== null && requestedTrajectoryBackend() === 'lut';
      if (
        wantLutPass &&
        this.lut !== null &&
        typeof (
          ctx.services.lensing as {
            createBlackHoleLutPass?: unknown;
          }
        ).createBlackHoleLutPass === 'function'
      ) {
        const lutSvc = ctx.services.lensing as ILensingService & {
          createBlackHoleLutPass: (
            p: Parameters<ILensingService['createBlackHoleLensingPass']>[0],
            l: {
              resources: LutGpuResources;
              storedSpanRad: number;
              bCriticalRg: number;
              hybridBandHalfWidthX: number;
            }
          ) => LensingHandle & { lutMaterial?: () => unknown };
        };
        const lutHandle = lutSvc.createBlackHoleLutPass(
          {
            massRg: 1,
            backgroundEquirect: null,
            diskEnabled: true,
            diskInnerRg: DISK_INNER_RG,
            diskOuterRg: DISK_OUTER_RG,
            qualityTier: ctx.quality
          },
          {
            resources: this.lut.resources,
            storedSpanRad: this.lut.storedSpanRad,
            bCriticalRg: this.lut.bCriticalRg,
            hybridBandHalfWidthX: this.lut.hybridBandHalfWidthX
          }
        );
        ctx.scope.track(
          'geometry',
          lutHandle.object3d().geometry,
          () => lutHandle.object3d().geometry.dispose(),
          GEOMETRY_ESTIMATED_BYTES
        );
        ctx.scope.track(
          'material',
          lutHandle.object3d().material,
          () => lutHandle.dispose(),
          MATERIAL_ESTIMATED_BYTES
        );
        this.lensing = lutHandle as LensingHandle;
        scene.add(lutHandle.object3d());
        ctx.reportProgress(0.5, 'Schwarzschild LUT pass ready');
      } else {
        if (this.lut === null && this.lastFallbackReason === null) {
          this.lastFallbackReason = 'lut-assets-unavailable';
        }
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
      }
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
    this.debugParity = ctx.preset.state['debugParity'] === true;
  }

  /**
   * Advances the gentle orbit ONLY when the active preset asks for it
   * (`state.orbit === true`); otherwise a no-op. Driven by frame dt, never by
   * wall-clock reads, so it stays deterministic under the atlas timeline.
   */
  update(ctx: FrameContext): void {
    // PERFORMANCE CAMPAIGN: the integrator's step budget is a UNIFORM, so the
    // governor's live tier reaches the shader without any pipeline rebuild.
    this.lastQualityTier = ctx.quality;
    if (this.disposed || !this.orbitEnabled) return;
    const rig = ctx.services.cameraRig;
    const orbit = rig.getOrbit();
    const azimuthDeg = (orbit.azimuthDeg + ORBIT_RATE_DEG_PER_SECOND * ctx.time.dt) % 360;
    rig.setOrbit(azimuthDeg, orbit.polarDeg, orbit.distance);
  }

  render(ctx: RenderContext): void {
    if (this.disposed || this.scene === null) return;
    if (this.lensing !== null) {
      // Live tier budget: the governor's current step count rides the
      // uMaxSteps uniform — no pipeline rebuild on tier changes. The parity
      // preset additionally disables disk shading and selects the encoded
      // escape-direction debug output (both plain uniforms).
      const lensingState: Record<string, unknown> = {
        ...cameraLensingState(ctx.camera, DISK_INNER_RG, DISK_OUTER_RG),
        maxSteps: TIER_STEP_BUDGETS[this.lastQualityTier]
      };
      if (this.debugParity) {
        lensingState['diskEnabled'] = false;
        lensingState['debugMode'] = 1;
      }
      // Trajectory backend gate: LUT only when a valid family is loaded AND
      // its formats are filterable here; otherwise truthful numerical.
      const lutUsable = this.lut !== null && this.lut.webgl2Filterable && lutFamilyRequested();
      lensingState['lutEnabled'] = lutUsable ? 1 : 0;
      if (lutUsable) {
        this.lastEffectiveBackend = 'lut';
        this.lastFallbackReason = null;
      } else {
        this.lastEffectiveBackend = 'numerical';
        if (this.lut === null && this.lastFallbackReason === null) {
          this.lastFallbackReason = 'lut-assets-unavailable';
        }
      }
      this.lensing.setUniformsFromState(lensingState);
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
    this.debugParity = false;
  }

  serializeShareState(): Record<string, unknown> {
    return { orbit: this.orbitEnabled };
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      pattern:
        this.lensing !== null
          ? this.lut !== null
            ? 'schwarzschild geodesic lensing + accretion disk (LUT-capable)'
            : 'schwarzschild geodesic lensing + accretion disk'
          : 'fullscreen pass fallback (lensing construction failed)',
      lensingWired: this.lensing !== null,
      diskInnerRg: DISK_INNER_RG,
      diskOuterRg: DISK_OUTER_RG,
      orbitEnabled: this.orbitEnabled,
      disposed: this.disposed,
      // M8-06 backend/fallback truth (mission §9/§17):
      trajectoryBackendRequested: requestedTrajectoryBackend(),
      trajectoryBackendEffective: this.lastEffectiveBackend,
      lutFamilyLoaded: this.lut !== null,
      lutFamilyDir: this.lut?.familyDir ?? null,
      lutWebgl2Filterable: this.lut?.webgl2Filterable ?? null,
      lutFallbackReason: this.lastFallbackReason,
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
 * Dev/test-only trajectory-backend override (?trajectory=lut|numerical),
 * same policy class as ?backend=. Default 'auto' resolves to numerical
 * until M8-08 evidence justifies lut-by-default (LUT_BACKEND_SPEC §14/§15).
 */
function requestedTrajectoryBackend(): 'auto' | 'numerical' | 'lut' {
  if (typeof window === 'undefined') return 'auto';
  const value = new URLSearchParams(window.location.search).get('trajectory');
  if (value === 'lut' || value === 'numerical') return value;
  return 'auto';
}

function lutFamilyRequested(): boolean {
  const mode = requestedTrajectoryBackend();
  // 'numerical' forces the oracle path; 'lut' opts in; 'auto' stays numerical
  // until M8-08 measures a meaningful win and M8-09 flips the default.
  if (mode === 'numerical') return false;
  if (mode === 'lut') return true;
  return LUT_AUTO_DEFAULT;
}

/**
 * auto-policy gate: flipped to true only by measured M8-08 evidence.
 * See docs/BENCHMARK_MATRIX.md for the recorded numbers.
 */
export const LUT_AUTO_DEFAULT = false;

async function loadShippedLutFamily(): Promise<{
  resources: import('../../phenomena/black-hole/lut/textures.js').LutGpuResources;
  storedSpanRad: number;
  bCriticalRg: number;
  hybridBandHalfWidthX: number;
  familyDir: string;
  webgl2Filterable: boolean;
} | null> {
  const indexResponse = await fetch('/luts/index.json');
  if (!indexResponse.ok) return null;
  const index = (await indexResponse.json()) as Record<string, string>;
  const familyDir = index['schwarzschild-v1'];
  if (familyDir === undefined) return null;
  const manifestResponse = await fetch(`/luts/${familyDir}/manifest.json`);
  if (!manifestResponse.ok) return null;
  const manifestJson = await manifestResponse.json();
  const manifest = manifestJson as {
    textures: Array<{ id: string; file: string; format: string }>;
    physics: { bCriticalRg: number };
    hybridBandHalfWidthX: number;
    textures0domain?: unknown;
  };
  const trajEntry = manifest.textures.find((t) => t.id === 'trajectory');
  const auxEntry = manifest.textures.find((t) => t.id === 'aux');
  if (trajEntry === undefined || auxEntry === undefined) return null;
  const assets = new Map<string, Uint8Array>();
  for (const entry of [trajEntry, auxEntry]) {
    const assetResponse = await fetch(`/luts/${familyDir}/${entry.file}`);
    if (!assetResponse.ok) return null;
    assets.set(entry.file, new Uint8Array(await assetResponse.arrayBuffer()));
  }
  const result = await loadLutFamily(manifestJson, assets);
  if (!result.ok) return null;
  const domainSpan = (
    result.family.manifest.textures.find((t) => t.id === 'trajectory')?.domain as {
      storedSpanRg?: number;
    }
  )?.storedSpanRg;
  if (domainSpan === undefined) return null;
  const filterable =
    formatWebGL2Status(trajEntry.format as Parameters<typeof formatWebGL2Status>[0]).filterable &&
    formatWebGL2Status(auxEntry.format as Parameters<typeof formatWebGL2Status>[0]).filterable;
  return {
    resources: buildLutGpuResources(result.family.manifest, assets),
    storedSpanRad: domainSpan,
    bCriticalRg: result.family.manifest.physics.bCriticalRg,
    hybridBandHalfWidthX: result.family.manifest.hybridBandHalfWidthX,
    familyDir,
    webgl2Filterable: filterable
  };
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
