/**
 * Cosmic Atlas shared contracts — single source of truth for cross-module interfaces.
 *
 * Spec sources (do not contradict without updating docs):
 * - docs/cosmic-atlas/ARCHITECTURE.md   (topology, descriptor, lifecycle, services)
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md (state schema, routes, presets, generations)
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md (per-destination models)
 * - docs/SHADER_CONTRACTS.md, docs/NUMERICAL_METHODS.md (physics conventions)
 */

import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';

import type { TrajectoryBackendPreference } from './trajectoryPolicy';

// ---------------------------------------------------------------------------
// Enums and primitive aliases
// ---------------------------------------------------------------------------

/** Declared scientific fidelity of a destination. Never overstate. */
export type FidelityClass = 'DIRECT' | 'DATA_DRIVEN' | 'PROCEDURAL_SCIENTIFIC' | 'CINEMATIC';

export type QualityMode = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Product experience mode (M5 canonical state, campaign §4/§5).
 *
 * - `scientific`: physical readability first — restrained post effects, clear
 *   labels/units, deterministic display. Must NOT require bloom.
 * - `cinematic`: SAME underlying physical simulation; may change exposure,
 *   bloom and presentation only.
 * - `debug`: exposes technical diagnostics (backend, tier, frame timing,
 *   inventories) and developer destinations (Diagnostic).
 */
export type ExperienceMode = 'scientific' | 'cinematic' | 'debug';

export type DestinationGroup = 'compact' | 'catastrophe' | 'galactic' | 'expansion' | 'lab';

export type DestinationId = string;

export type CapabilityId =
  | 'webgpu'
  | 'webgpu-compute'
  | 'storage-buffers'
  | 'float-render-target'
  | 'timestamp-query'
  | 'compressed-textures';

export interface CapabilityRequirement {
  capability: CapabilityId;
  /** Hard = destination cannot run without it; soft = a degraded path exists. */
  hard: boolean;
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

export type PhenomenonModuleFactory = () => PhenomenonModule;

export interface PhenomenonDescriptor {
  id: DestinationId;
  title: string;
  group: DestinationGroup;
  fidelity: FidelityClass;
  /** Canonical route suffix; full route is `/atlas/<route>`. Unique. */
  route: string;
  defaultPreset: string;
  requiredCapabilities: CapabilityRequirement[];
  estimatedGpuMemoryMB: Record<QualityTier, number>;
  /**
   * Lazy loader. Must dynamically import the heavy module so registry
   * definition never pulls destination code into the initial bundle.
   */
  load: () => Promise<PhenomenonModuleFactory>;
}

export interface CameraArrivalPreset {
  position: [number, number, number];
  target: [number, number, number];
  up?: [number, number, number];
  fovDeg?: number;
}

/**
 * Display-only recommendations a preset may carry (campaign §10: presets
 * define physics/observer/display/quality SEPARATELY). Values live in the
 * DISPLAY domain: applying them never mutates physical/model state.
 * All fields optional; absent fields keep the current shared-visual value.
 */
export interface PresetDisplayState {
  exposure?: number;
  toneMapping?: CosmicAtlasStateV1['sharedVisual']['toneMapping'];
  bloomEnabled?: boolean;
  bloomStrength?: number;
}

export interface PresetDescriptor {
  id: string;
  displayName: string;
  destinationId: DestinationId;
  stateSchemaVersion: number;
  /** Human-readable fidelity/model note shown in the UI. */
  fidelityNote: string;
  /** Destination-namespaced public state applied on activation. */
  state: Record<string, unknown>;
  camera: CameraArrivalPreset;
  /** Deterministic seed for procedural content. */
  seed: number;
  /** Initial normalized timeline phase in [0, 1]. */
  timelineInitialPhase: number;
  /** Display-domain recommendation applied on activation (optional). */
  display?: PresetDisplayState;
  /** Quality tier this preset was tuned against; advisory only. */
  recommendedQuality?: QualityTier;
}

// ---------------------------------------------------------------------------
// Resource scopes (CA0-04)
// ---------------------------------------------------------------------------

export type ResourceKind =
  | 'texture'
  | 'cubeTexture'
  | 'volumeTexture'
  | 'buffer'
  | 'storageBuffer'
  | 'geometry'
  | 'renderTarget'
  | 'material'
  | 'worker'
  | 'listener'
  | 'timer'
  | 'pendingFetch';

export interface ResourceScopeCounters {
  texture: number;
  cubeTexture: number;
  volumeTexture: number;
  buffer: number;
  storageBuffer: number;
  geometry: number;
  renderTarget: number;
  material: number;
  worker: number;
  listener: number;
  timer: number;
  pendingFetch: number;
  estimatedGpuBytes: number;
}

/**
 * Explicit ownership tracker. Every destination gets one; disposal is
 * deterministic instead of GC-dependent.
 */
export interface ResourceScope {
  readonly name: string;
  readonly disposed: boolean;
  /** Register an owned resource with an optional disposer and byte estimate. */
  track(
    kind: ResourceKind,
    handle: unknown,
    disposer: (() => void) | null,
    estimatedBytes?: number
  ): void;
  /** Release a single previously tracked resource. */
  release(handle: unknown): void;
  /** Dispose everything owned by this scope, in reverse registration order. */
  disposeAll(): void;
  snapshot(): ResourceScopeCounters;
  /** Spawn a child scope that is disposed together with this one. */
  createChild(name: string): ResourceScope;
}

// ---------------------------------------------------------------------------
// Host service interfaces (implemented under src/renderer/shared/)
// ---------------------------------------------------------------------------

export interface BackendInfo {
  api: 'webgpu' | 'webgl2';
  adapterName: string;
  maxTextureSize: number;
  floatRenderTargets: boolean;
  timestampQuery: boolean;
  storageBuffers: boolean;
  devicePixelRatio: number;
}

export type RendererLike = WebGPURenderer | THREE.WebGLRenderer;

/**
 * TSL node-function alias. Density/emission callbacks are TSL `Fn` graph
 * builders evaluated per sample position inside the volume march.
 */
export type TslDensityFn = (args: { pos: unknown; dir: unknown }) => unknown;

export interface ParticleEmitterConfig {
  kind: 'point' | 'sphere-shell' | 'disc' | 'volume-box';
  origin?: [number, number, number];
  radius?: number;
  normal?: [number, number, number];
  extent?: [number, number, number];
  /** Initial speed magnitude or profile id understood by the destination. */
  speed?: number;
  directionBias?: [number, number, number];
}

export interface ParticleSystemConfig {
  capacity: number;
  emitters: ParticleEmitterConfig[];
  lifetimeSeconds: [number, number];
  sizePx: [number, number];
  colorRamp: Array<{ t: number; color: [number, number, number]; alpha: number }>;
  blending: 'additive' | 'normal';
  seed: number;
  /** Use GPU compute update when available; otherwise shader/CPU fallback. */
  preferCompute: boolean;
}

export interface ParticleSystemHandle {
  readonly capacity: number;
  /** Advance simulation deterministically by dt seconds. */
  update(dtSeconds: number): void;
  /** Three.js object to add to the destination scene. */
  object3d(): THREE.Object3D;
  setPopulationScale(scale: number): void;
  reset(seed: number): void;
  dispose(): void;
  /**
   * Bounded debug metadata (RENDERING_SERVICES.md §16): capacity/drawn count,
   * buffer bytes, update path, blending. No GPU readback is performed.
   */
  getDebugSnapshot(): Record<string, unknown>;
}

export interface IParticleService {
  createSystem(config: ParticleSystemConfig): ParticleSystemHandle;
  readonly computeAvailable: boolean;
  dispose(): void;
}

export interface VolumeConfig {
  /** Bounding shape for the march. */
  bounds:
    | { kind: 'sphere'; center: [number, number, number]; radius: number }
    | { kind: 'box'; center: [number, number, number]; halfExtents: [number, number, number] };
  density: TslDensityFn;
  emission?: TslDensityFn;
  /** Base step count at 'high' tier; governor scales it. */
  baseMaxSteps: number;
  halfResolution: boolean;
  earlyAlphaTermination: boolean;
  temporalJitter: boolean;
}

export interface VolumeHandle {
  object3d(): THREE.Object3D;
  setStepScale(scale: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export interface IVolumeService {
  createVolume(config: VolumeConfig): VolumeHandle;
  /** Half/quarter-resolution internal target management. */
  setInternalScale(scale: number): void;
  dispose(): void;
}

export interface RibbonConfig {
  /** Number of spine samples. */
  segments: number;
  widthStart: number;
  widthEnd: number;
  colorStart: [number, number, number];
  colorEnd: [number, number, number];
  additive: boolean;
  /** Optional per-vertex alpha taper along the ribbon length. */
  taper: 'none' | 'linear' | 'exponential';
}

export interface RibbonHandle {
  /** Replace the spine polyline (world space) and rebuild vertex data. */
  setSpine(points: THREE.Vector3[]): void;
  object3d(): THREE.Object3D;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export interface IRibbonService {
  createRibbon(config: RibbonConfig): RibbonHandle;
  dispose(): void;
}

export interface KeplerElements {
  semiMajor: number;
  eccentricity: number;
  inclinationDeg: number;
  longitudeOfAscendingNodeDeg: number;
  argumentOfPeriapsisDeg: number;
  /** Gravitational parameter GM for period computation. */
  mu: number;
}

export interface KeyframeTrack {
  /** Times in seconds, strictly increasing. */
  times: Float32Array;
  /** Flat positions xyz per keyframe. */
  positions: Float32Array;
}

export interface ITrajectoryService {
  /** Analytic Kepler orbit sampler returning world-space position at time t. */
  sampleKepler(elements: KeplerElements, tSeconds: number, out: THREE.Vector3): THREE.Vector3;
  buildSpline(
    points: THREE.Vector3[],
    closed?: boolean
  ): {
    sample(t01: number, out: THREE.Vector3): THREE.Vector3;
    arcLength(): number;
  };
  /** Piecewise-linear (optionally smoothstep-eased) keyframe interpolation. */
  sampleKeyframes(track: KeyframeTrack, tSeconds: number, out: THREE.Vector3): THREE.Vector3;
  /** Nonlinear phase mapping helpers for merger/collision timelines. */
  mapPhaseLinear(phase01: number): number;
  mapPhaseInspiral(phase01: number): number;
  dispose(): void;
}

export interface FieldLineConfig {
  /** Dipole moment axis (normalized). */
  momentAxis: [number, number, number];
  strength: number;
  rMin: number;
  rMax: number;
  lineCount: number;
  pointsPerLine: number;
  color: [number, number, number];
  opacity: number;
  seed: number;
}

export interface IFieldLineService {
  createDipoleLines(config: FieldLineConfig): THREE.LineSegments;
  /** Integrate arbitrary field lines from a seed-point callback. */
  createCustomLines(
    seeds: THREE.Vector3[],
    stepFn: (p: THREE.Vector3, out: THREE.Vector3) => void,
    stepsPerLine: number,
    stepSize: number,
    color: [number, number, number],
    opacity: number
  ): THREE.LineSegments;
  dispose(): void;
}

export interface LensingPassParams {
  /** Mass in geometric units r_g = GM/c^2 (scene units are r_g). */
  massRg: number;
  backgroundEquirect: THREE.Texture | null;
  diskEnabled: boolean;
  diskInnerRg: number;
  diskOuterRg: number;
  qualityTier: QualityTier;
}

/**
 * Kerr numerical pass parameters (M9; docs/KERR_BACKEND_ADR.md is the
 * convention authority for every field consumed downstream).
 */
export interface KerrLensingParams extends LensingPassParams {
  /** SIGNED dimensionless spin a* = Jc/(GM^2) in [-0.998, +0.998]. */
  spinDimensionless: number;
}

export interface ILensingService {
  /**
   * Full Schwarzschild backwards-ray-tracing pass (black-hole destination).
   * Implementation must follow docs/NUMERICAL_METHODS.md exactly.
   */
  createBlackHoleLensingPass(params: LensingPassParams): {
    object3d(): THREE.Mesh;
    setUniformsFromState(state: Record<string, unknown>): void;
    dispose(): void;
  };
  /**
   * Full KERR numerical backwards-ray-tracing pass (M9-03..05). A DISTINCT
   * strong-field backend — never a branch of the Schwarzschild integrator.
   * Conventions: docs/KERR_BACKEND_ADR.md; numerics:
   * src/phenomena/black-hole/kerr/. The LUT backend is Schwarzschild-only
   * and must never be presented as a Kerr path.
   */
  createKerrLensingPass(params: KerrLensingParams): {
    object3d(): THREE.Mesh;
    setUniformsFromState(state: Record<string, unknown>): void;
    dispose(): void;
  };
  /**
   * Reduced thin-lens deflection for non-black-hole destinations
   * (lensing lab, AGN). Must not weaken the black-hole path.
   */
  createThinLensDisplacement(massRg: number, impactParameterScale: number): TslDensityFn;
  dispose(): void;
}

export interface ICameraRig {
  attach(camera: THREE.PerspectiveCamera): void;
  applyArrivalPreset(preset: CameraArrivalPreset, animateSeconds: number): void;
  /** Capture departure transform for transition interpolation. */
  captureTransform(): CameraArrivalPreset;
  setOrbit(azimuthDeg: number, polarDeg: number, distance: number): void;
  getOrbit(): { azimuthDeg: number; polarDeg: number; distance: number };
  setTarget(target: THREE.Vector3): void;
  setFov(fovDeg: number): void;
  setControlsEnabled(enabled: boolean): void;
  setReducedMotion(reduced: boolean): void;
  /** Returns true when this call changed the camera transform (CAMERA_CHANGED signal). */
  update(dtSeconds: number): boolean;
  dispose(): void;
}

export type GovernorActivityMode = 'interaction' | 'settling' | 'stable';

export interface GovernorConfig {
  targetFps: 30 | 60;
  qualityMode: QualityMode;
  dprCap: number;
}

export interface IPerformanceGovernor {
  configure(config: Partial<GovernorConfig>): void;
  beginFrame(): void;
  endFrame(): void;
  notifyInteraction(): void;
  /** Destinations declare relative cost multipliers per tier. */
  setWorkMultiplier(destinationId: DestinationId, multiplier: number): void;
  /**
   * Host lifecycle hook: which destination is currently rendering (null when
   * none). Governs which work multiplier drives the fps expectation; switching
   * resets hysteresis and re-arms the startup grace window.
   */
  setActiveDestination(destinationId: DestinationId | null): void;
  readonly currentTier: QualityTier;
  readonly renderScale: number;
  readonly activityMode: GovernorActivityMode;
  onTierChanged(cb: (tier: QualityTier) => void): () => void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Frame invalidation (whole-atlas performance campaign WS1)
// ---------------------------------------------------------------------------

/**
 * Host-owned render-reason bitset (openspec/changes/whole-atlas-performance-
 * optimization MASTER_PLAN.md §6.2). The host is the single authority that
 * decides whether a frame's destination update/render/post-present is worth
 * doing; a reason bit means "something a viewer could see changed since the
 * last presented frame." `CosmicAtlasHost.frame()` renders when any bit is
 * set OR the shared timeline is not paused (several destinations advance
 * physically-meaningful internal state — moving-observer proper time,
 * auto-orbit, particle/spin integration — keyed to `!TimeController.paused`
 * rather than to the mapped UI phase actually moving; skipping presentation
 * while playing would let that state drift invisibly, so "paused" is a
 * required precondition for skipping, matching MASTER_PLAN §6.3/§6.5
 * verbatim). FORCED_CAPTURE is the "render this frame regardless" escape
 * hatch: `CosmicAtlasHost.frame(dt, { force: true })` and
 * `forceContinuousRenderForTest` use it for deterministic golden/benchmark
 * capture; the WS3 page-visibility resume handler (src/app/atlasApp.ts) uses
 * the same bit via `host.invalidate()` for its one-shot "wake on resume"
 * nudge, since nothing else about the scene necessarily changed while hidden.
 */
export const INVALIDATION_REASON = {
  TIME_ADVANCED: 1 << 0,
  CAMERA_CHANGED: 1 << 1,
  CONTROL_CHANGED: 1 << 2,
  DESTINATION_CHANGED: 1 << 3,
  RESIZE: 1 << 4,
  QUALITY_CHANGED: 1 << 5,
  TRANSITION_CHANGED: 1 << 6,
  POST_CHANGED: 1 << 7,
  DEBUG_CHANGED: 1 << 8,
  FORCED_CAPTURE: 1 << 9
} as const;

export type InvalidationReasonName = keyof typeof INVALIDATION_REASON;
export type InvalidationReasonMask = number;

/** Every reason name, in bit order — the canonical iteration order. */
export const INVALIDATION_REASON_NAMES = Object.keys(
  INVALIDATION_REASON
) as readonly InvalidationReasonName[];

/**
 * Decode a reason mask into its set reason names (WS0/tasks.md §1 telemetry).
 * Order matches {@link INVALIDATION_REASON_NAMES}, so the output is stable and
 * safe to assert on; an empty array means "no reason — this frame was
 * skippable".
 */
export function describeInvalidationReasons(
  mask: InvalidationReasonMask
): InvalidationReasonName[] {
  return INVALIDATION_REASON_NAMES.filter((name) => (mask & INVALIDATION_REASON[name]) !== 0);
}

/**
 * Per-frame work-execution telemetry (WS0/tasks.md §1): which stages of the
 * orchestrated frame actually ran. The whole point of WS1/WS2 is to make these
 * false when the work is provably unnecessary, so they are the primary
 * regression signal for every later workstream.
 */
export interface FrameWorkTelemetry {
  /** `destination.update()` ran. */
  readonly destinationUpdated: boolean;
  /** `destination.render()` ran (a real draw into the HDR target). */
  readonly destinationDrawn: boolean;
  /** `SharedPost.present()` ran (the composite/present pass). */
  readonly postPresented: boolean;
}

/** Renderer.info mirror (WS0/tasks.md §1). Null fields = backend not reporting. */
export interface RendererInfoTelemetry {
  readonly render: {
    readonly frameCalls: number;
    readonly drawCalls: number;
    readonly triangles: number;
    readonly points: number;
    readonly lines: number;
  };
  readonly compute: { readonly frameCalls: number };
  readonly memory: {
    readonly geometries: number;
    readonly textures: number;
    readonly programs: number;
    readonly renderTargets: number;
    readonly storageAttributes: number;
    readonly uniformBuffers: number;
    readonly totalBytes: number;
  };
}

/**
 * Host frame-invalidation telemetry (WS0/tasks.md §1).
 *
 * Counters are cumulative since boot (or since the last explicit reset) so a
 * benchmark or test can take two snapshots and difference them; `last*`
 * fields describe only the most recent `frame()` call.
 */
export interface FrameInvalidationTelemetry {
  /** Reason mask of the most recent frame (0 = nothing required a frame). */
  readonly lastReasons: InvalidationReasonMask;
  /** Decoded names of {@link lastReasons}. */
  readonly lastReasonNames: readonly InvalidationReasonName[];
  /** Whether the most recent frame rendered rather than being skipped. */
  readonly lastFrameRendered: boolean;
  /** Stage flags of the most recent orchestrated frame. */
  readonly lastFrameWork: FrameWorkTelemetry;
  /** `frame()` calls observed. */
  readonly framesObserved: number;
  /** Of those, frames that rendered. */
  readonly framesRendered: number;
  /** Of those, frames skipped because no reason existed and time was paused. */
  readonly framesSkipped: number;
  /** How many frames each reason contributed to, keyed by reason name. */
  readonly reasonCounts: Readonly<Record<InvalidationReasonName, number>>;
}

export interface ISharedPost {
  ensureSize(widthPx: number, heightPx: number, renderScale: number): void;
  getHdrTarget(): THREE.Texture | null;
  setExposure(exposure: number): void;
  setBloom(enabled: boolean, strength: number): void;
  setToneMapping(mode: 'aces-filmic' | 'agx' | 'neutral' | 'linear'): void;
  /** Composite HDR result + transition overlay to the canvas. */
  present(transitionOverlay: THREE.Texture | null, transitionOpacity: number): void;
  /** Frozen outgoing frame for transitions. */
  captureSnapshot(): THREE.Texture | null;
  releaseSnapshot(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Time model (ARCHITECTURE §8)
// ---------------------------------------------------------------------------

export interface TimeModelSnapshot {
  displayTime: string;
  simulationPhase: number;
  physicalTime: number | null;
  playbackRate: number;
  paused: boolean;
}

export interface PhaseMapping {
  id: string;
  label: string;
  /** Map normalized UI phase [0,1] to internal simulation coordinate. */
  forward(phase01: number): number;
  /** Inverse mapping for scrubbing. */
  inverse(internal: number): number;
  /** Human display string for a given internal coordinate. */
  formatDisplay(internal: number): string;
}

// ---------------------------------------------------------------------------
// Atlas state schema (STATE_AND_ROUTES §1)
// ---------------------------------------------------------------------------

export type TransitionPhase = 'preparing' | 'outgoing' | 'hyperspace' | 'arriving';

export interface TransitionPublicState {
  active: boolean;
  phase: TransitionPhase | null;
  progress: number;
  /** True only while the hyperspace envelope is mathematically opaque. */
  destinationOccluded: boolean;
}

export interface AtlasCameraPublicState {
  azimuthDeg: number;
  polarDeg: number;
  distance: number;
  fovDeg: number;
}

export interface VersionedDestinationState {
  schemaVersion: number;
  state: Record<string, unknown>;
}

export interface CosmicAtlasStateV1 {
  schemaVersion: 1;
  atlas: {
    activeDestination: DestinationId;
    activePreset: string;
    targetDestination: DestinationId | null;
    targetPreset: string | null;
    transition: TransitionPublicState;
  };
  /** Product experience mode (Scientific / Cinematic / Debug). */
  experience: {
    mode: ExperienceMode;
  };
  sharedVisual: {
    exposure: number;
    bloomEnabled: boolean;
    bloomStrength: number;
    toneMapping: 'aces-filmic' | 'agx' | 'neutral' | 'linear';
  };
  rendering: {
    qualityMode: QualityMode;
    targetFps: 30 | 60;
    /** Dynamic resolution governed by the global governor when true. */
    dynamicResolution: boolean;
    renderScaleOverride: number | null;
    /**
     * M8-09 canonical trajectory-backend preference for the black-hole
     * lensing path (docs/LUT_BACKEND_SPEC.md §15). Resolution precedence:
     * dev/test URL override > this preference > auto policy + capability.
     */
    trajectoryBackend: TrajectoryBackendPreference;
  };
  /** Debug-domain visibility flags (kept out of Scientific/Cinematic UX). */
  debug: {
    diagnosticsEnabled: boolean;
  };
  accessibility: {
    reducedMotion: boolean;
    highContrastUi: boolean;
  };
  camera: AtlasCameraPublicState;
  destinations: Record<string, VersionedDestinationState>;
}

// ---------------------------------------------------------------------------
// Transition runtime (STATE_AND_ROUTES §4 — not serialized)
// ---------------------------------------------------------------------------

export interface TransitionRuntimeState {
  phase: TransitionPhase | 'idle';
  sourceId: DestinationId | null;
  targetId: DestinationId | null;
  generation: number;
  prepareAbort: AbortController | null;
  preparedTarget: PreparedPhenomenon | null;
  phaseStartedAtMs: number;
  outgoingSnapshot: THREE.Texture | null;
  minimumReady: boolean;
  error: string | null;
  reducedMotion: boolean;
}

// ---------------------------------------------------------------------------
// Lifecycle contexts (ARCHITECTURE §4)
// ---------------------------------------------------------------------------

export interface FrameTimeInfo {
  /** Wall delta since previous frame, seconds. */
  dt: number;
  /** Deterministic accumulated atlas clock, seconds. */
  elapsed: number;
  /** Normalized timeline phase [0,1] after nonlinear mapping. */
  phase: number;
  /** Physical time in destination units where meaningful. */
  physicalTime: number | null;
}

export interface HostServices {
  kernel: IRendererKernel;
  cameraRig: ICameraRig;
  particles: IParticleService;
  volumes: IVolumeService;
  ribbons: IRibbonService;
  trajectories: ITrajectoryService;
  fieldLines: IFieldLineService;
  lensing: ILensingService;
  post: ISharedPost;
  governor: IPerformanceGovernor;
  resources: import('./ResourceManager').ResourceManager;
  time: import('./TimeController').TimeController;
  /** Global deterministic seed derived from preset. */
  seed: number;
}

export interface PrepareContext {
  services: HostServices;
  scope: ResourceScope;
  preset: PresetDescriptor;
  quality: QualityTier;
  /** Abort when the user picks another destination mid-load. */
  signal: AbortSignal;
  reportProgress(fraction01: number, label?: string): void;
}

export interface EnterContext {
  services: HostServices;
  preset: PresetDescriptor;
  reducedMotion: boolean;
}

export interface FrameContext {
  services: HostServices;
  time: FrameTimeInfo;
  quality: QualityTier;
  renderScale: number;
  /** Canonical trajectory-backend preference (M8-09, atlas rendering domain). */
  trajectoryBackend: TrajectoryBackendPreference;
}

export interface RenderContext {
  renderer: RendererLike;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  /** Shared HDR target the destination renders into (may be null pre-init). */
  hdrTarget: THREE.Texture | null;
}

export interface ExitContext {
  services: HostServices;
  /** True when exiting because a transition needs a frozen snapshot. */
  freezeForTransition: boolean;
}

export interface PreparedPhenomenon {
  module: PhenomenonModule;
  scope: ResourceScope;
  scene: THREE.Scene;
  preset: PresetDescriptor;
}

/**
 * Destination module contract. Exactly one heavy destination is active.
 * Ordering enforced by the host: prepare -> enter -> (update -> render)* -> exit -> dispose.
 */
export interface PhenomenonModule {
  readonly descriptor: PhenomenonDescriptor;

  prepare(ctx: PrepareContext): Promise<PreparedPhenomenon>;
  enter(ctx: EnterContext): Promise<void> | void;
  update(ctx: FrameContext): void;
  render(ctx: RenderContext): void;
  exit(ctx: ExitContext): Promise<void> | void;
  dispose(): void;

  serializeShareState?(): Record<string, unknown>;
  getDebugSnapshot?(): Record<string, unknown>;
  /**
   * Live canonical control channel (CA5): UI controls call the HOST, the
   * host forwards here; the module normalizes/merges through its ONE
   * normalizer. Never a UI-to-uniform bypass. Absent = destination has no
   * live controls.
   */
  applyControlState?(partial: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Renderer kernel contract (src/renderer/SharedRendererKernel.ts)
// ---------------------------------------------------------------------------

export interface FramePlan {
  destination: {
    update(ctx: FrameContext): void;
    render(ctx: RenderContext): void;
  } | null;
  scene: THREE.Scene | null;
  /** Skip only the hidden destination draw; update remains allowed. */
  destinationDrawSuppressed: boolean;
  transitionOverlay: THREE.Texture | null;
  transitionOpacity: number;
}

export interface IRendererKernel {
  init(canvas: HTMLCanvasElement): Promise<BackendInfo>;
  readonly backend: BackendInfo | null;
  readonly renderer: RendererLike | null;
  onDeviceLost(cb: () => void): () => void;
  handleResize(cssWidth: number, cssHeight: number, renderScale: number): void;
  /** Execute one orchestrated frame; returns false if skipped by governor. */
  renderFrame(plan: FramePlan): boolean;
  /**
   * Which stages the most recent {@link renderFrame} actually executed
   * (WS0/tasks.md §1). All false before the first frame and whenever the
   * kernel itself bails (disposed, device lost, no renderer).
   *
   * The kernel cannot describe a frame it was never asked to run: when the
   * HOST skips a frame it does not call `renderFrame` at all, so these flags
   * would still describe the last frame that did render. The host owns that
   * case and reports all-false itself — read stage flags through
   * `CosmicAtlasHost.frameTelemetry()`, not from here, unless you know the
   * kernel was invoked.
   */
  readonly lastFrameWork: FrameWorkTelemetry;
  /** Renderer.info mirror, or null when no renderer is live. */
  readRendererInfo(): RendererInfoTelemetry | null;
  capabilities(): CapabilityRequirement[] & { satisfied(id: CapabilityId): boolean };
  /**
   * BH-121: GPU milliseconds per orchestrated frame from the most recent
   * timestamp-pool resolution (the last resolved frame's summed render-pass
   * time); null when the backend lacks timestamp queries or nothing has
   * resolved yet. Never inferred from CPU timing.
   */
  readonly gpuFrameMs: number | null;
  /** Force a GPU timestamp-pool resolve; resolves to the window mean or null. */
  flushGpuTimestamps(): Promise<number | null>;
  dispose(): void;
}
