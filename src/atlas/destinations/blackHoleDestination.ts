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
import { blackHoleDescriptor } from './blackHoleDescriptor.js';
import type { ILensingService, KerrLensingParams } from '../types.js';
import type {
  EnterContext,
  ExitContext,
  FrameContext,
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

/** Factory handed out through `descriptor.load()` (lazy dynamic import). */
export function createBlackHoleModule(): PhenomenonModule {
  return new BlackHoleModule();
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

type PassKind = 'numerical' | 'lut' | 'kerr';

/**
 * Bounded recent-pass cache (WS4 §9.2): the active pass plus at most one
 * alternate. A control toggle back and forth reuses the resident alternate;
 * a third pass evicts the least-recently-used non-active one. Everything is
 * also tracked by the prepare scope, so eviction releases the scope entries
 * rather than leaving them to double-dispose at visit end.
 */
const MAX_RESIDENT_PASSES = 2;

/** Construction context captured at prepare time for lazy alternate passes. */
interface LensingPassContext {
  lensing: ILensingService;
  scope: PrepareContext['scope'];
}

export class BlackHoleModule implements PhenomenonModule {
  readonly descriptor = blackHoleDescriptor;

  // WS4 §9.2 active-pass lifecycle: passes are created on demand, never as an
  // eager numerical+LUT+Kerr set. Draw-time visibility still selects exactly
  // one pass per frame.
  private readonly passHandles = new Map<PassKind, LensingHandle>();
  /** Child scope per created pass, so eviction disposes exactly its resources. */
  private readonly passScopes = new Map<PassKind, PrepareContext['scope']>();
  private activePass: { kind: PassKind; handle: LensingHandle } | null = null;
  private passContext: LensingPassContext | null = null;
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
  /**
   * Live backend API captured at prepare (WS4 §9.2). The LUT acceleration is a
   * WebGPU-only path: under forced WebGL2 on this stack the LUT material
   * renders black even with a core-filterable RGBA16F family (measured: the
   * LUT pass ALONE produces a black frame on both the pre-lifecycle and
   * lifecycle builds, while the numerical reference renders correctly).
   * WebGL2 therefore always uses the numerical Schwarzschild reference and
   * reports `lut-webgl2-unsupported` instead of presenting a black frame.
   */
  private backendApiValue: 'webgpu' | 'webgl2' | null = null;
  /** M11 Kerr classification view (?kerrstatus): per-ray terminal classes. */
  private readonly kerrStatusView: boolean =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('kerrstatus');

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

  /**
   * Which pass kind this frame/arrival should show (WS4 §9.2). Metric 'kerr'
   * always selects the numerical Kerr pass; Schwarzschild resolves through the
   * ONE documented trajectory policy (URL override > preference > auto +
   * capability) plus actual LUT asset availability.
   */
  private desiredPassKind(): PassKind {
    if (this.controls.metric === 'kerr') return 'kerr';
    const resolution = this.resolveSchwarzschildTrajectory();
    return resolution.effective === 'lut' && this.lut !== null ? 'lut' : 'numerical';
  }

  /** Shared Schwarzschild trajectory resolution for lifecycle + render truth. */
  private resolveSchwarzschildTrajectory(): ReturnType<typeof resolveTrajectoryBackend> {
    return resolveTrajectoryBackend({
      preference: this.frameTrajectoryBackend,
      urlOverride: this.urlTrajectoryOverride,
      lutAssetsReady: this.lut !== null && this.lut.webgl2Filterable,
      lutUnavailableReason:
        this.backendApiValue === 'webgl2'
          ? 'lut-webgl2-unsupported'
          : this.lut === null
            ? 'lut-assets-unavailable'
            : this.lut.webgl2Filterable
              ? null
              : 'lut-format-not-filterable-on-backend',
      autoDefaultLut: LUT_AUTO_DEFAULT
    });
  }

  /**
   * Lazily create (and scope-track) the pass for `kind`, or null when it
   * cannot be created — a missing LUT family, a backend without the LUT pass
   * factory, or a construction failure. Creation failure NEVER destroys the
   * currently visible pass; the caller keeps the old metric and records a
   * truthful fallback reason.
   */
  private createPass(kind: PassKind): LensingHandle | null {
    const existing = this.passHandles.get(kind);
    if (existing !== undefined) return existing;
    const context = this.passContext;
    if (context === null) return null;

    const baseParams = {
      massRg: 1,
      backgroundEquirect: null,
      diskEnabled: true,
      qualityTier: this.lastQualityTier
    };
    let handle: LensingHandle;
    try {
      if (kind === 'numerical') {
        handle = context.lensing.createBlackHoleLensingPass({
          ...baseParams,
          diskInnerRg: DISK_INNER_RG,
          diskOuterRg: DISK_OUTER_RG
        });
      } else if (kind === 'lut') {
        if (this.lut === null) return null;
        const lutSvc = context.lensing as ILensingService & {
          createBlackHoleLutPass?: (
            p: Parameters<ILensingService['createBlackHoleLensingPass']>[0],
            l: {
              resources: LutGpuResources;
              storedSpanRad: number;
              bCriticalRg: number;
              hybridBandHalfWidthX: number;
            }
          ) => LensingHandle & { lutMaterial?: () => unknown };
        };
        if (typeof lutSvc.createBlackHoleLutPass !== 'function') return null;
        handle = lutSvc.createBlackHoleLutPass(
          { ...baseParams, diskInnerRg: DISK_INNER_RG, diskOuterRg: DISK_OUTER_RG },
          {
            resources: this.lut.resources,
            storedSpanRad: this.lut.storedSpanRad,
            bCriticalRg: this.lut.bCriticalRg,
            hybridBandHalfWidthX: this.lut.hybridBandHalfWidthX
          }
        );
      } else {
        const kerrSpin = Math.min(0.998, Math.max(-0.998, effectiveSpin(this.controls)));
        const kerrParams: KerrLensingParams = {
          ...baseParams,
          diskInnerRg: Math.max(kerrIscoRadius(kerrSpin), KERR_DISK_INNER_FLOOR_RG),
          diskOuterRg: DISK_OUTER_RG,
          spinDimensionless: kerrSpin
        };
        handle = context.lensing.createKerrLensingPass(kerrParams);
      }
    } catch (error) {
      console.warn(`[BlackHoleModule] creating the '${kind}' lensing pass failed:`, error);
      return null;
    }

    this.passHandles.set(kind, handle);
    this.scene?.add(handle.object3d());
    // A child scope per pass (WS4 §9.2) keeps eviction accountable: disposal
    // releases exactly this pass's geometry/material and detaches it from the
    // destination scope's counters.
    const childScope = context.scope.createChild(`lensing-${kind}`);
    this.passScopes.set(kind, childScope);
    trackLensingHandle(childScope, handle);
    handle.object3d().visible = false;
    return handle;
  }

  /** Make `kind` the only visible pass and enforce the bounded cache. */
  private activatePass(kind: PassKind, handle: LensingHandle): void {
    for (const [passKind, pass] of this.passHandles) {
      pass.object3d().visible = passKind === kind;
    }
    this.activePass = { kind, handle };
    this.activePassKind = kind;
    this.enforcePassCache();
  }

  /** Evict least-recently-used non-active passes beyond the cache bound. */
  private enforcePassCache(): void {
    while (this.passHandles.size > MAX_RESIDENT_PASSES) {
      let evicted: { kind: PassKind; handle: LensingHandle } | null = null;
      for (const [kind, handle] of this.passHandles) {
        if (this.activePass !== null && this.activePass.handle === handle) continue;
        evicted = { kind, handle };
        break;
      }
      if (evicted === null) return;
      this.evictPass(evicted.kind, evicted.handle);
    }
  }

  /** Dispose every non-active resident pass (visit teardown still keeps the active one). */
  private disposeAlternates(): void {
    for (const [kind, handle] of [...this.passHandles]) {
      if (this.activePass !== null && this.activePass.handle === handle) continue;
      this.evictPass(kind, handle);
    }
  }

  private evictPass(kind: PassKind, handle: LensingHandle): void {
    this.passHandles.delete(kind);
    handle.object3d().removeFromParent();
    const childScope = this.passScopes.get(kind);
    if (childScope !== undefined) {
      // The child's tracked disposers release the geometry and the handle.
      this.passScopes.delete(kind);
      childScope.disposeAll();
      return;
    }
    handle.dispose();
  }

  async prepare(ctx: PrepareContext): Promise<{
    module: PhenomenonModule;
    scope: PrepareContext['scope'];
    scene: Scene;
    preset: PresetDescriptor;
  }> {
    if (this.disposed) throw new Error('[BlackHoleModule] prepare() called after dispose().');

    ctx.reportProgress(0.15, 'Creating strong-field lensing pass');
    throwIfAborted(ctx.signal);
    const scene = new Scene();
    this.scene = scene;

    // Preset state flows through the ONE normalizer before anything consumes it.
    this.controls = normalizeBlackHoleControls(ctx.preset.state);
    this.observerTau = 0;
    this.syncObserverSeed();
    this.backendApiValue = ctx.services.kernel.backend?.api ?? null;

    // --- LUT family load (M8-06): best-effort, never blocks the numerical
    // paths. Any failure records a truthful reason and continues numerical.
    //
    // Backend-conditional load (LUT_BACKEND_ADR.md §12 "future optimization"
    // footnote): skip the ~2.1 MiB GPU textures + 3 network fetches when this
    // prepare() can already PROVE the LUT choice will never be selected for
    // the module's whole lifetime — the Kerr metric never consults it
    // (ADR §1.21) and an explicit `?trajectory=numerical` override pins
    // numerical for the entire page load (M8-09 precedence, captured once at
    // construction). A later LIVE metric/preference change away from these
    // cases still resolves through the existing, already-tested
    // `lut-assets-unavailable` fallback — the same honest path already
    // exercised whenever the network fetch itself fails.
    const lutCouldBeSelected =
      this.backendApiValue !== 'webgl2' &&
      this.controls.metric !== 'kerr' &&
      this.urlTrajectoryOverride !== 'numerical';
    ctx.reportProgress(0.2, 'Loading Schwarzschild LUT family');
    if (lutCouldBeSelected) {
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
    }

    try {
      this.passContext = { lensing: ctx.services.lensing, scope: ctx.scope };
      // WS4 §9.2: instantiate ONLY the pass this arrival will actually show.
      // The default Schwarzschild auto policy selects LUT when the family is
      // ready, so a default arrival builds the LUT pass and nothing else;
      // numerical/Kerr are created lazily on an actual switch.
      const desired = this.desiredPassKind();
      const handle = this.createPass(desired);
      if (handle === null) {
        throw new Error(`initial '${desired}' lensing pass could not be created`);
      }
      this.activatePass(desired, handle);
      ctx.reportProgress(0.5, 'Strong-field pass ready');
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
    rig.setOrbit(azimuthDeg, orbit.polarDeg, orbit.distance, 'system');
  }

  render(ctx: RenderContext): void {
    if (this.disposed || this.scene === null) return;
    const useKerr = this.controls.metric === 'kerr';
    if (this.passContext !== null) {
      // WS4 §9.2: lazily create the requested pass and keep the currently
      // visible one if an alternate cannot be built. Activation is synchronous
      // with the frame that requests the switch, so no wrong-metric or
      // half-configured intermediate frame can ever be presented.
      const desired = this.desiredPassKind();
      let creationFailed = false;
      if (this.activePass === null || this.activePass.kind !== desired) {
        const next = this.createPass(desired);
        if (next !== null) this.activatePass(desired, next);
        else creationFailed = this.activePass !== null;
      }

      if (this.activePass !== null) {
        const selected = this.activePass.handle;
        const kind = this.activePass.kind;
        if (useKerr) {
          // Backend policy truth (ADR §1.21): Kerr runs numerical Kerr; the
          // Schwarzschild trajectory preference/LUT policy is INAPPLICABLE.
          this.lastRequestedBackend = 'auto';
          this.lastEffectiveTrajectoryBackend = 'numerical';
          this.lastFallbackReason = 'lut-inapplicable-while-kerr-active';
        } else {
          const resolution = this.resolveSchwarzschildTrajectory();
          this.lastRequestedBackend = resolution.requested;
          // Effective truth comes from the pass that is ACTUALLY active, not
          // from the resolution: if the requested alternate could not be built
          // we keep rendering the previous metric and say so.
          this.lastEffectiveTrajectoryBackend = kind === 'lut' ? 'lut' : 'numerical';
          this.lastFallbackReason =
            kind === 'lut'
              ? resolution.fallbackReason
              : creationFailed
                ? 'alternate-pass-creation-failed'
                : resolution.fallbackReason;
        }

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
          cameraPositionWorld: [
            ctx.camera.position.x,
            ctx.camera.position.y,
            ctx.camera.position.z
          ],
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
        lensingState['temporalJitterNdc'] = ctx.temporalJitterNdc ?? [0, 0];
        const obsMode = this.controls.observer.mode;
        const movingMode = obsMode === 'circular' || obsMode === 'flyby' || obsMode === 'freefall';
        if (
          movingMode &&
          observerPayload.readout.valid &&
          Number.isFinite(observerPayload.readout.positionWorld[0])
        ) {
          lensingState['cameraPositionRg'] = observerPayload.readout.positionWorld;
        }
        // M11: moving-observer Kerr rays traverse deeper potentials at E < 1
        // with theta-motion — measured census for the kerr-circular-observer
        // reference: median ~215 / p95 ~1260 / max ~2600 policy steps vs the
        // static-camera workload. Scale the tier budget so the tier ladder
        // keeps its meaning; the pass hard-clamps to its compile bound.
        if (useKerr && movingMode && observerPayload.readout.valid) {
          lensingState['maxSteps'] = Math.min(6144, TIER_STEP_BUDGETS[this.lastQualityTier] * 3);
        }

        if (this.controls.debugParity) {
          lensingState['diskEnabled'] = false;
          lensingState['debugMode'] = 1;
        }
        if (!useKerr && this.lutDebugView) {
          lensingState['lutDebugStatus'] = 1;
        }
        if (useKerr && this.kerrStatusView) {
          lensingState['debugMode'] = 2;
        }
        selected.setUniformsFromState(lensingState);
      } else if (this.fallbackPass !== null) {
        applyCameraBasis(this.fallbackPass.uniforms, ctx.camera);
      }
    } else if (this.fallbackPass !== null) {
      applyCameraBasis(this.fallbackPass.uniforms, ctx.camera);
    }
    ctx.renderer.render(this.scene, ctx.camera);
  }

  exit(_ctx: ExitContext): void {
    // Freeze handled by the director's SharedPost snapshot. Alternates are
    // presentation-only and safe to release now; the active pass stays until
    // the visit scope is disposed.
    this.disposeAlternates();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // GPU objects are owned by the prepare scope; drop references only.
    this.passHandles.clear();
    this.passScopes.clear();
    this.activePass = null;
    this.passContext = null;
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
    const wired = this.activePass !== null;
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
      // WS4 §9.2 active-pass lifecycle evidence: exactly the resident passes,
      // created lazily and bounded to the active plus one alternate.
      lensingResidentPassKinds: [...this.passHandles.keys()],
      lensingResidentPassCount: this.passHandles.size,
      // M8-06/M8-09 backend/fallback truth, extended by ADR §1.21:
      trajectoryBackendRequested: this.lastRequestedBackend,
      trajectoryBackendEffective:
        this.controls.metric === 'kerr' ? 'numerical-kerr' : this.lastEffectiveTrajectoryBackend,
      lutFamilyLoaded: this.lut !== null,
      lutFamilyDir: this.lut?.familyDir ?? null,
      lutWebgl2Filterable: this.lut?.webgl2Filterable ?? null,
      lutFallbackReason: this.lastFallbackReason,
      criticalRegionSampling: {
        method: 'validated radius-aware adaptive step sizing',
        photonSphereRg: 3,
        horizonFloorScale: 0.02,
        targetedSupersampling: false,
        rationale:
          'temporal jitter/history and the existing near-horizon step floor pass the critical-curve stability gate; extra ray bundles were not justified by the measured cost/artifact tradeoff'
      },
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

function trackLensingHandle(scope: PrepareContext['scope'], handle: LensingHandle): void {
  scope.track(
    'geometry',
    handle.object3d().geometry,
    () => handle.object3d().geometry.dispose(),
    GEOMETRY_ESTIMATED_BYTES
  );
  scope.track(
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
