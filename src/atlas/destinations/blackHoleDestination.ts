/**
 * Black-hole destination ADAPTER — lifecycle seam around the strong-field
 * lensing passes (CA0-05 + M2/M3 renderer integration + M9 Kerr backends).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DECISIONS.md CA-ADR-013 — this module owns NO physics:
 *   Schwarzschild geodesics live in
 *   src/phenomena/black-hole/schwarzschildIntegrator.ts, Kerr geodesics in
 *   src/phenomena/black-hole/kerr/ (docs/KERR_BACKEND_ADR.md is the
 *   convention authority), all reached through LensingService.
 * - docs/cosmic-atlas/ARCHITECTURE.md §4 (lifecycle), §5 (scopes).
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §6 + CA6 persistence contract:
 *   normalizeBlackHoleControls is the ONE validation authority for public
 *   control values; presets/share links/live controls all flow through it.
 *
 * Backend routing truth (docs/KERR_BACKEND_ADR.md §1.21):
 * - metric 'kerr' ALWAYS executes the numerical Kerr pass. The Schwarzschild
 *   LUT is a Schwarzschild optimization and is never presented as a Kerr
 *   path; while Kerr is active the LUT choice is truthfully inapplicable
 *   (debug snapshot reports effectiveBackend 'kerr').
 * - metric 'schwarzschild' restores the existing numerical/LUT policy with
 *   its documented precedence (URL override > preference > auto+capability).
 * - If lensing-pass construction fails, prepare() falls back to the
 *   deterministic fullscreen pass and reports that truthfully in its debug
 *   snapshot (`lensingWired: false`) — never silently.
 * - Spin NEVER affects Schwarzschild output (effectiveSpin forces 0).
 *
 * Honesty notes: `estimatedGpuMemoryMB` values remain documented GUESSES.
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
import {
  LUT_AUTO_DEFAULT,
  parseTrajectoryUrlOverride,
  resolveTrajectoryBackend,
  type TrajectoryBackend,
  type TrajectoryBackendPreference
} from '../../atlas/trajectoryPolicy.js';
import {
  DEFAULT_BLACK_HOLE_CONTROLS,
  normalizeBlackHoleControls,
  effectiveSpin,
  type BlackHoleControlState
} from '../../phenomena/black-hole/controlState.js';
import {
  buildObserverUniformPayload,
  seedGeodesicWorldline,
  type ObserverReadout
} from '../../phenomena/black-hole/observer/observerUniforms.js';
import type { TimelikeWorldline } from '../../phenomena/black-hole/observer/worldlines.js';
import { kerrIscoRadius } from '../../phenomena/black-hole/kerr/characteristics.js';
import type { ILensingService, KerrLensingParams } from '../types.js';
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

/** Disk geometry defaults (Schwarzschild): ISCO inner edge, 3x outer span. */
const DISK_INNER_RG = 6;
const DISK_OUTER_RG = 18;
/** Escape classification radius (r_g) — far enough that deflection is done. */
const ESCAPE_RADIUS_RG = 32;

/**
 * Emission-graph floor for the Kerr inner edge (see kerrIntegrator header):
 * high prograde ISCO reaches ~1.237 r_g; keep a small positive margin above
 * the photon orbit so the Shakura-Sunyaev profile stays well-defined.
 */
const KERR_DISK_INNER_FLOOR_RG = 1.05;

/** Per-tier integration step budgets pushed to whichever pass renders. */
const TIER_STEP_BUDGETS: Record<FrameContext['quality'], number> = {
  low: 256,
  medium: 512,
  high: 1024,
  ultra: 2048
};

/** Gentle cinematic orbit rate used when a preset enables `orbit`. */
const ORBIT_RATE_DEG_PER_SECOND = 2;

/** Display recommendations for scientific presentation presets. */
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
    stateSchemaVersion: 2,
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
    stateSchemaVersion: 2,
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
    stateSchemaVersion: 2,
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
    stateSchemaVersion: 2,
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
    stateSchemaVersion: 2,
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
    stateSchemaVersion: 2,
    fidelityNote:
      'Edge-on-ish view of the SAME Shakura-Sunyaev disk with relativistic beaming enabled, making the approaching/receding brightness contrast directly visible. No model change versus other presets.',
    state: { orbit: false },
    camera: { position: [14, 3, 8], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: { exposure: 1.15, toneMapping: 'aces-filmic', bloomEnabled: false, bloomStrength: 0 },
    recommendedQuality: 'medium'
  },
  // -------------------------------------------------------------------------
  // M9 Kerr preset family (scientifically purposeful; conventions per
  // docs/KERR_BACKEND_ADR.md). Disk inner edges follow kerrIscoRadius(spin).
  // -------------------------------------------------------------------------
  {
    id: 'kerr-zero-spin',
    displayName: 'Kerr — Zero Spin (Validation)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Numerical Kerr backend at a* = 0: the primary spin->0 convergence reference. Must be visually and physically indistinguishable from the Schwarzschild path within documented tolerances.',
    state: { metric: 'kerr', spin: 0, orbit: false },
    camera: { position: [0, 2.5, 16], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'high'
  },
  {
    id: 'kerr-moderate-prograde',
    displayName: 'Kerr — Moderate Prograde (a*=0.6)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Numerical Kerr backend, prograde thin disk corotating with a*= +0.6. Disk inner edge at the Bardeen-Press-Teukolsky ISCO (~4.38 r_g); frame dragging shifts the photon ring asymmetrically.',
    state: { metric: 'kerr', spin: 0.6, orbit: false },
    camera: { position: [13.5, 3.2, 7], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'high'
  },
  {
    id: 'kerr-high-prograde',
    displayName: 'Kerr — High Prograde (a*=0.9)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Numerical Kerr backend near the supported spin ceiling: a*= +0.9, disk down to ISCO ~2.32 r_g. Strong frame dragging and pronounced shadow asymmetry; numerical failures stay explicitly classified.',
    state: { metric: 'kerr', spin: 0.9, orbit: false },
    camera: { position: [12, 1.6, 6], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'ultra'
  },
  {
    id: 'kerr-retrograde',
    displayName: 'Kerr — Retrograde Disk (a*=-0.7)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Numerical Kerr backend with the disk still corotating with world +Y while the hole spins a*= -0.7 (retrograde relative to the disk): ISCO pushed to ~8.05 r_g, counter-rotating frame dragging.',
    state: { metric: 'kerr', spin: -0.7, orbit: false },
    camera: { position: [13.5, 3.2, -7], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'high'
  },
  {
    id: 'observer-static',
    displayName: 'Observer — Static Reference (M10)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'M10 compatibility anchor: the explicit STATIC observer mode routes through the new observer-frame abstraction while reproducing the legacy static physics exactly (OBSERVER_FRAME_ADR §5 equivalence gate).',
    state: { orbit: false, observer: { mode: 'static' } },
    camera: { position: [0, 2.5, 16], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0
  },
  {
    id: 'observer-circular',
    displayName: 'Physical Circular Observer (M10)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Timelike equatorial circular geodesic at r = 12 r_g (stable, above the Schwarzschild ISCO): aberration and Doppler come from the comoving tetrad via g = (-k.u_obs)/(-k.u_emit), not from camera motion. Physically distinct from the cinematic Orbit preset.',
    state: {
      orbit: false,
      observer: { mode: 'circular', circularRadiusRg: 12, circularSense: 1 }
    },
    camera: { position: [0, 0.5, 13.5], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 60 },
    seed: 7,
    timelineInitialPhase: 0,
    recommendedQuality: 'high'
  },
  {
    id: 'observer-flyby',
    displayName: 'Flyby Observer (M10)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Unbound equatorial timelike geodesic (E = gamma(0.6) ~ 1.25, impact parameter 8 r_g): a scattering encounter with conserved E/L_z; periastron and outbound asymptote are integrated, never scripted.',
    state: {
      orbit: false,
      observer: { mode: 'flyby', flybyBetaInfinity: 0.6, flybyImpactParameterRg: 8 }
    },
    camera: { position: [0, 2, 10], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 60 },
    seed: 7,
    timelineInitialPhase: 0,
    recommendedQuality: 'high'
  },
  {
    id: 'observer-freefall',
    displayName: 'Freefall Observer (M10)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Drop from rest relative to static observers at r0 = 14 r_g. Proper-time worldline ends at the declared horizon stop band (r_+ * 1.001) with an explicit TERMINAL state — rendering inside the horizon is NOT claimed (OBSERVER_FRAME_ADR §3).',
    state: {
      orbit: false,
      observer: { mode: 'freefall', freefallReleaseRadiusRg: 14 }
    },
    camera: { position: [0, 0.4, 6], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 70 },
    seed: 7,
    timelineInitialPhase: 0,
    recommendedQuality: 'high'
  },
  {
    id: 'kerr-circular-observer',
    displayName: 'Kerr Circular Observer (a* = +0.6, M10)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Physical circular observer on the numerical Kerr backend at a* = +0.6, r = 8 r_g prograde: frame-dragged comoving optics through the full Kerr tetrad chain.',
    state: {
      metric: 'kerr',
      spin: 0.6,
      orbit: false,
      observer: { mode: 'circular', circularRadiusRg: 8, circularSense: 1 }
    },
    camera: { position: [0, 0.8, 9.5], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 60 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'ultra'
  },
  {
    id: 'debug-parity',
    displayName: 'Black Hole — Debug Parity View',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'DEBUG TOOL, not a presentation: ESCAPED rays output their terminal tetrad-projected direction encoded rgb = dir*0.5+0.5 (linear); CAPTURED rays pure black; numerical failures failure-magenta. Disk disabled. Consumed by tests/browser/integrator-parity.spec.ts against cpuReference.integratePhoton and by the M9 Kerr parity spec against the binary64 kerr reference.',
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
  // ESTIMATES, not measurements.
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

type PassKind = 'numerical' | 'lut' | 'kerr';

interface PreparedPasses {
  numerical: LensingHandle;
  lut: LensingHandle | null;
  kerr: LensingHandle;
}

export class BlackHoleModule implements PhenomenonModule {
  readonly descriptor = blackHoleDescriptor;

  private passes: PreparedPasses | null = null;
  private fallbackPass: DiagnosticPass | null = null;
  private scene: Scene | null = null;
  /** Canonical control record (the ONLY authority is the normalizer). */
  private controls: BlackHoleControlState = { ...DEFAULT_BLACK_HOLE_CONTROLS };
  private lastQualityTier: FrameContext['quality'] = 'medium';
  private disposed = false;
  private activePassKind: PassKind | null = null;

  /** LUT backend state (M8-06). Null until a valid family loads. */
  private lut: {
    resources: LutGpuResources;
    storedSpanRad: number;
    bCriticalRg: number;
    hybridBandHalfWidthX: number;
    familyDir: string;
    webgl2Filterable: boolean;
  } | null = null;
  private lastRequestedBackend: TrajectoryBackendPreference = 'auto';
  private lastEffectiveTrajectoryBackend: TrajectoryBackend = 'numerical';
  /** Canonical Schwarzschild trajectory preference copied in update(). */
  private frameTrajectoryBackend: TrajectoryBackendPreference = 'auto';
  private lastFallbackReason: string | null = null;
  /**
   * Dev/test URL override captured ONCE at construction (M8-09 semantics):
   * pins the SCHWARZSCHILD trajectory backend for the page load. Never
   * applies to the Kerr backend (metric=kerr ignores ?trajectory= truthfully).
   */
  private readonly urlTrajectoryOverride: TrajectoryBackendPreference | null =
    readTrajectoryUrlOverride();
  private readonly lutDebugView: boolean =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('lutdebug');

  // --- M10 physical observer state (OBSERVER_FRAME_ADR) ---------------------
  /** Deterministic proper-time clock (t_g units); advanced ONLY from the
   * frame-loop delta while the atlas transport is playing. */
  private observerTau = 0;
  /** Geodesic worldline for flyby/freefall; reseeded on control changes. */
  private geodesicWorldline: TimelikeWorldline | null = null;
  /** Signature of the observer-relevant controls at seed time. */
  private observerSeedSignature = '';
  /** Latest observer readout for the debug snapshot. */
  private lastObserverReadout: ObserverReadout | null = null;
  /** Specific worldline-seed failure (surfaced verbatim in debug truth). */
  private lastObserverSeedFailure: string | null = null;

  /** Reseed the geodesic worldline when observer controls change (deterministic). */
  private syncObserverSeed(): void {
    const o = this.controls.observer;
    const signature = JSON.stringify([
      o.mode,
      effectiveSpin(this.controls),
      o.circularRadiusRg,
      o.circularSense,
      o.flybyBetaInfinity,
      o.flybyImpactParameterRg,
      o.freefallReleaseRadiusRg
    ]);
    if (signature !== this.observerSeedSignature) {
      this.observerSeedSignature = signature;
      if (o.mode === 'flyby' || o.mode === 'freefall') {
        const seeded = seedGeodesicWorldline(this.controls);
        if (seeded.ok) {
          this.geodesicWorldline = seeded.worldline;
          this.lastObserverSeedFailure = null;
        } else {
          this.geodesicWorldline = null;
          // Surface the SPECIFIC domain violation verbatim (campaign §8).
          this.lastObserverSeedFailure = seeded.reason;
        }
      } else {
        this.geodesicWorldline = null;
        this.lastObserverSeedFailure = null;
      }
      this.observerTau = 0;
    }
  }

  async prepare(ctx: PrepareContext): Promise<{
    module: PhenomenonModule;
    scope: PrepareContext['scope'];
    scene: Scene;
    preset: PresetDescriptor;
  }> {
    if (this.disposed) throw new Error('[BlackHoleModule] prepare() called after dispose().');

    ctx.reportProgress(0.15, 'Creating strong-field lensing passes');
    throwIfAborted(ctx.signal);
    const scene = new Scene();

    // Preset state flows through the ONE normalizer before anything consumes it.
    this.controls = normalizeBlackHoleControls(ctx.preset.state);
    this.observerTau = 0;
    this.syncObserverSeed();
    const presetSpin = effectiveSpin(this.controls);

    // --- LUT family load (M8-06): best-effort, never blocks the numerical
    // paths. Any failure records a truthful reason and continues numerical.
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
      const baseParams = {
        massRg: 1,
        backgroundEquirect: null,
        diskEnabled: true,
        qualityTier: ctx.quality
      };

      // --- Pass 1: numerical Schwarzschild (always available) ---
      const numerical = ctx.services.lensing.createBlackHoleLensingPass({
        ...baseParams,
        diskInnerRg: DISK_INNER_RG,
        diskOuterRg: DISK_OUTER_RG
      });
      trackLensingHandle(ctx, numerical);
      scene.add(numerical.object3d());

      // --- Pass 2: LUT Schwarzschild (only when assets are usable) ---
      let lut: LensingHandle | null = null;
      if (
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
        lut = lutSvc.createBlackHoleLutPass(
          { ...baseParams, diskInnerRg: DISK_INNER_RG, diskOuterRg: DISK_OUTER_RG },
          {
            resources: this.lut.resources,
            storedSpanRad: this.lut.storedSpanRad,
            bCriticalRg: this.lut.bCriticalRg,
            hybridBandHalfWidthX: this.lut.hybridBandHalfWidthX
          }
        );
        trackLensingHandle(ctx, lut);
        scene.add(lut.object3d());
      }

      // --- Pass 3: numerical Kerr (M9; distinct strong-field backend) ---
      const kerrSpin = Math.min(0.998, Math.max(-0.998, presetSpin));
      const kerrInner = Math.max(kerrIscoRadius(kerrSpin), KERR_DISK_INNER_FLOOR_RG);
      const kerrParams: KerrLensingParams = {
        ...baseParams,
        diskInnerRg: kerrInner,
        diskOuterRg: DISK_OUTER_RG,
        spinDimensionless: kerrSpin
      };
      const kerr = ctx.services.lensing.createKerrLensingPass(kerrParams);
      trackLensingHandle(ctx, kerr);
      scene.add(kerr.object3d());

      this.passes = { numerical, lut, kerr };
      ctx.reportProgress(0.5, 'Strong-field passes ready');
    } catch {
      // Honest degraded path: deterministic fullscreen pattern, flagged in
      // the debug snapshot. Never presented as geodesic lensing.
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
    // Preset state re-normalized here so preset switches reset controls.
    this.controls = normalizeBlackHoleControls(ctx.preset.state);
    // M10: deterministic observer reset on every enter/preset load.
    this.observerTau = 0;
    this.syncObserverSeed();
  }

  /**
   * Advances the gentle orbit ONLY when the active control state asks for it;
   * otherwise a no-op. Driven by frame dt for determinism under the atlas
   * timeline. M10: also advances the deterministic PROPER-TIME clock of the
   * physical observer (frozen when the atlas transport is paused; frozen at
   * terminal worldline states).
   */
  update(ctx: FrameContext): void {
    this.lastQualityTier = ctx.quality;
    // M8-09: canonical Schwarzschild trajectory preference rides FrameContext.
    this.frameTrajectoryBackend = ctx.trajectoryBackend;
    if (!this.disposed && !ctx.services.time.snapshot().paused) {
      const mode = this.controls.observer.mode;
      const physicalMode = mode === 'circular' || mode === 'flyby' || mode === 'freefall';
      if (physicalMode && this.lastObserverReadout?.terminalReason == null) {
        this.observerTau += ctx.time.dt * this.controls.observer.timeScale;
        if (this.geodesicWorldline !== null) {
          // Worldline integrator consumes the SAME delta so position and
          // clock stay exactly coherent.
          this.geodesicWorldline.advance(ctx.time.dt * this.controls.observer.timeScale);
        }
      }
    }
    if (this.disposed || !this.controls.orbit) return;
    const rig = ctx.services.cameraRig;
    const orbit = rig.getOrbit();
    const azimuthDeg = (orbit.azimuthDeg + ORBIT_RATE_DEG_PER_SECOND * ctx.time.dt) % 360;
    rig.setOrbit(azimuthDeg, orbit.polarDeg, orbit.distance);
  }

  render(ctx: RenderContext): void {
    if (this.disposed || this.scene === null) return;
    if (this.passes !== null) {
      const { numerical, lut, kerr } = this.passes;
      const useKerr = this.controls.metric === 'kerr';
      let selected: LensingHandle;
      let kind: PassKind;

      if (useKerr) {
        selected = kerr;
        kind = 'kerr';
        // Backend policy truth (ADR §1.21): Kerr runs numerical Kerr; the
        // Schwarzschild trajectory preference/LUT policy is INAPPLICABLE.
        this.lastRequestedBackend = 'auto';
        this.lastEffectiveTrajectoryBackend = 'numerical';
        this.lastFallbackReason = this.lut === null ? null : 'lut-inapplicable-while-kerr-active';
      } else {
        const resolution = resolveTrajectoryBackend({
          preference: this.frameTrajectoryBackend,
          urlOverride: this.urlTrajectoryOverride,
          lutAssetsReady: lut !== null && this.lut !== null && this.lut.webgl2Filterable,
          lutUnavailableReason:
            this.lut === null || lut === null
              ? 'lut-assets-unavailable'
              : this.lut.webgl2Filterable
                ? null
                : 'lut-format-not-filterable-on-backend',
          autoDefaultLut: LUT_AUTO_DEFAULT
        });
        selected = resolution.effective === 'lut' && lut !== null ? lut : numerical;
        kind = resolution.effective === 'lut' && lut !== null ? 'lut' : 'numerical';
        this.lastRequestedBackend = resolution.requested;
        this.lastEffectiveTrajectoryBackend = resolution.effective;
        this.lastFallbackReason = resolution.fallbackReason;
      }
      this.activePassKind = kind;

      // Visibility gate: exactly one strong-field pass renders per frame.
      numerical.object3d().visible = kind === 'numerical';
      if (lut !== null) lut.object3d().visible = kind === 'lut';
      kerr.object3d().visible = kind === 'kerr';

      const spin = effectiveSpin(this.controls);
      const baseState = useKerr
        ? {
            ...cameraLensingState(
              ctx.camera,
              Math.max(kerrIscoRadius(spin), KERR_DISK_INNER_FLOOR_RG),
              DISK_OUTER_RG
            ),
            maxSteps: TIER_STEP_BUDGETS[this.lastQualityTier],
            spinDimensionless: spin
          }
        : {
            ...cameraLensingState(ctx.camera, DISK_INNER_RG, DISK_OUTER_RG),
            maxSteps: TIER_STEP_BUDGETS[this.lastQualityTier],
            lutEnabled: kind === 'lut' ? 1 : 0
          };

      // M10 physical observer: per-frame tetrad payload from the canonical
      // snapshot builder. Moving modes also OVERRIDE the ray origin with the
      // worldline position (the camera keeps supplying only LOOK axes).
      this.syncObserverSeed();
      const cameraAxes = currentCameraBasis(ctx.camera);
      const observerPayload = buildObserverUniformPayload({
        controls: this.controls,
        cameraPositionWorld: [ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z],
        cameraAxes,
        tau: this.observerTau,
        geodesicWorldline: this.geodesicWorldline,
        seedFailureReason: this.lastObserverSeedFailure
      });
      this.lastObserverReadout = observerPayload.readout;
      const lensingState: Record<string, unknown> = {
        ...baseState,
        ...observerPayload.stateKeys
      };
      const obsMode = this.controls.observer.mode;
      const movingMode = obsMode === 'circular' || obsMode === 'flyby' || obsMode === 'freefall';
      if (
        movingMode &&
        observerPayload.readout.valid &&
        Number.isFinite(observerPayload.readout.positionWorld[0])
      ) {
        lensingState['cameraPositionRg'] = observerPayload.readout.positionWorld;
      }

      if (this.controls.debugParity) {
        lensingState['diskEnabled'] = false;
        lensingState['debugMode'] = 1;
      }
      if (!useKerr && this.lutDebugView) {
        lensingState['lutDebugStatus'] = 1;
      }
      selected.setUniformsFromState(lensingState);
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
    this.passes = null;
    this.fallbackPass = null;
    this.scene = null;
    this.controls = { ...DEFAULT_BLACK_HOLE_CONTROLS };
    this.activePassKind = null;
  }

  /**
   * Canonical live control channel (CA5/CA6): merges the partial payload over
   * the current record and re-normalizes through the ONE normalizer. The host
   * caches the serialized result afterwards (persistence/back-forward).
   */
  applyControlState(partial: Record<string, unknown>): void {
    if (this.disposed) return;
    this.controls = normalizeBlackHoleControls({ ...this.controls, ...partial });
    // M10: mode/parameter changes reseed the deterministic worldline.
    this.syncObserverSeed();
  }

  serializeShareState(): Record<string, unknown> {
    return {
      metric: this.controls.metric,
      spin: this.controls.spin,
      orbit: this.controls.orbit,
      debugParity: this.controls.debugParity,
      observer: { ...this.controls.observer }
    };
  }

  getDebugSnapshot(): Record<string, unknown> {
    const wired = this.passes !== null;
    const pattern = wired
      ? this.activePassKind === 'kerr'
        ? 'kerr geodesic lensing + accretion disk (numerical)'
        : this.activePassKind === 'lut'
          ? 'schwarzschild geodesic lensing + accretion disk (LUT-capable)'
          : 'schwarzschild geodesic lensing + accretion disk'
      : 'fullscreen pass fallback (lensing construction failed)';
    const spin = effectiveSpin(this.controls);
    return {
      pattern,
      lensingWired: wired,
      // Metric/control truth (M9):
      metric: this.controls.metric,
      spin: this.controls.spin,
      effectiveSpin: spin,
      spinConvention: 'signed dimensionless a* = Jc/(GM^2); +Y axis; disk always +Y-corotating',
      kerrDiskInnerRg:
        this.controls.metric === 'kerr'
          ? Math.max(kerrIscoRadius(spin), KERR_DISK_INNER_FLOOR_RG)
          : null,
      schwarzschildDiskInnerRg: DISK_INNER_RG,
      activePassKind: this.activePassKind,
      // M8-06/M8-09 backend/fallback truth, extended by ADR §1.21:
      trajectoryBackendRequested: this.lastRequestedBackend,
      trajectoryBackendEffective:
        this.controls.metric === 'kerr' ? 'numerical-kerr' : this.lastEffectiveTrajectoryBackend,
      lutFamilyLoaded: this.lut !== null,
      lutFamilyDir: this.lut?.familyDir ?? null,
      lutWebgl2Filterable: this.lut?.webgl2Filterable ?? null,
      lutFallbackReason: this.lastFallbackReason,
      estimatedGpuMemoryMBIsEstimate: true,
      // M10 physical observer truth:
      observerMode: this.controls.observer.mode,
      observerReadout: this.lastObserverReadout,
      observerProperTimeTau: this.observerTau
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

function trackLensingHandle(ctx: PrepareContext, handle: LensingHandle): void {
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
}

/**
 * Dev/test-only trajectory-backend URL override (?trajectory=lut|numerical|auto).
 * Precedence 1 of the documented M8-09 policy (Schwarzschild paths only).
 */
function readTrajectoryUrlOverride(): TrajectoryBackendPreference | null {
  if (typeof window === 'undefined') return null;
  return parseTrajectoryUrlOverride(new URLSearchParams(window.location.search).get('trajectory'));
}

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
 * Builds the flat state record consumed by the lensing passes'
 * `setUniformsFromState`. Scene units are r_g with M = 1; disk normal is
 * world +Y (= the Kerr spin axis) per docs/WORLD_FRAME.md §1.
 */
function cameraLensingState(
  camera: PerspectiveCamera,
  diskInnerRg: number,
  diskOuterRg: number
): Record<string, unknown> {
  const basis = currentCameraBasis(camera);
  const aspect = camera.aspect;
  return {
    cameraPositionRg: [camera.position.x, camera.position.y, camera.position.z],
    cameraRight: basis.right,
    cameraUp: basis.up,
    cameraForward: basis.forward,
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

/** World-space look axes of the camera (presentation inputs for M10). */
function currentCameraBasis(camera: PerspectiveCamera): {
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
} {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  scratchRight.set(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0).normalize();
  scratchUp.set(e[4] ?? 0, e[5] ?? 0, e[6] ?? 0).normalize();
  scratchForward.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 0)).normalize();
  return {
    right: [scratchRight.x, scratchRight.y, scratchRight.z],
    up: [scratchUp.x, scratchUp.y, scratchUp.z],
    forward: [scratchForward.x, scratchForward.y, scratchForward.z]
  };
}
