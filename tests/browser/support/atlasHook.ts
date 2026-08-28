/**
 * Shared typed view of the `window.__ATLAS_APP__` test hook exposed by
 * src/app/atlasApp.ts.
 *
 * Both atlas spec suites augment `Window` with this hook; a single canonical
 * declaration here prevents TS2717 duplicate-declaration conflicts between
 * per-spec local interfaces and keeps the structural contract in one place
 * (mirrors the real AtlasAppWindowHook: host, navigate, captureFrame).
 *
 * Only fields the specs actually assert on are modeled — the runtime object
 * carries more, and page.evaluate payloads cross the serialization boundary
 * anyway.
 */

interface AtlasStateView {
  atlas: {
    activeDestination: string;
    activePreset: string;
    transition: {
      active: boolean;
      phase: string | null;
      progress: number;
      destinationOccluded: boolean;
    };
  };
  /** Atlas rendering domain (quality/trajectory-backend preferences). */
  rendering: { trajectoryBackend?: 'auto' | 'numerical' | 'lut' } & Record<string, unknown>;
  /** Per-destination serialized share state keyed by destination id. */
  destinations: Record<string, { schemaVersion: number; state: Record<string, unknown> }>;
}

interface InventoryView {
  liveScopeCount: number;
  totalEstimatedGpuBytes: number;
  totalResourceCounts: { texture: number };
  pendingPrepares: number;
  /** Present when a backend engaged; null during boot or before first frame. */
  backend: { api: string; adapterName: string } | null;
  /** Monotonic renderer generation (bumped on device loss / re-init). */
  rendererGeneration: number;
  /** Quality governor view (tier + live dynamic-resolution scale). */
  governor: { tier: string; renderScale: number };
  /** WS0/tasks.md §1 renderer.info mirror; null when no renderer is live. */
  rendererInfo: {
    render: { frameCalls: number; drawCalls: number; triangles: number };
    compute: { frameCalls: number };
    memory: { textures: number; programs: number; renderTargets: number; totalBytes: number };
  } | null;
}

/**
 * Structural mirror of the LIVE perspective camera surface specs consume
 * in-page (three.js PerspectiveCamera satisfies this structurally).
 */
interface AtlasCameraView {
  updateMatrixWorld(): void;
  matrixWorld: { elements: number[] };
  position: { x: number; y: number; z: number };
  fov: number;
  aspect: number;
}

/** Structural mirror of the runtime hook object; consumed via `Window`. */
interface AtlasHook {
  host: {
    state: AtlasStateView;
    debugInventory(): InventoryView;
    /** Live perspective camera; callers must read basis through evaluate. */
    camera: AtlasCameraView;
    /** SharedPost front-end owning exposure/bloom/tone-mapping presentation. */
    post: {
      setExposure(exposure: number): void;
      setBloom(enabled: boolean, strength: number): void;
      setToneMapping(mode: 'aces-filmic' | 'agx' | 'neutral' | 'linear'): void;
    };
    /** Canonical experience mode (scientific | cinematic | debug). */
    readonly experienceMode: string;
    /** Destination timeline transport (deterministic pause/scrub for specs). */
    time: {
      pause(): void;
      play(): void;
      scrubTo(phase01: number): void;
      /** Deterministic reset to the given (or preset initial) phase. */
      reset(initialPhase?: number): void;
      snapshot(): {
        paused: boolean;
        simulationPhase: number;
        physicalTime: number | null;
        /** Mapping-declared wall-clock pace (internal units per second at 1x). */
        basePlaybackRate: number;
        /** True when the active mapping wraps at its endpoints. */
        loop: boolean;
      };
    };
    /** Quality surface used to pin tiers in deterministic spec flows. */
    governor: {
      configure(config: { qualityMode?: 'auto' | 'low' | 'medium' | 'high' | 'ultra' }): void;
      /** Hard tier pin used by the golden harness (overrides auto mode). */
      setForcedTier(tier: 'low' | 'medium' | 'high' | 'ultra'): void;
      readonly currentTier: 'low' | 'medium' | 'high' | 'ultra';
    };
    /** Re-applies canvas sizing from the given CSS viewport size. */
    handleResize(cssWidth: number, cssHeight: number): void;
    /** M8-09 canonical trajectory-backend preference setter. */
    setTrajectoryBackend(preference: 'auto' | 'numerical' | 'lut'): void;
    /**
     * Canonical destination-control channel (CA5/CA6): forwards a partial
     * control payload to the ACTIVE destination's normalizer.
     */
    setDestinationControl(destinationId: string, partial: Record<string, unknown>): void;
    /** Debug snapshot of the active destination module (null when none). */
    activeDestinationDebugSnapshot(): Record<string, unknown> | null;
    /** WS0/tasks.md §1 frame-invalidation telemetry. */
    frameTelemetry(): {
      lastReasons: number;
      lastReasonNames: string[];
      lastFrameRendered: boolean;
      lastFrameWork: {
        destinationUpdated: boolean;
        destinationDrawn: boolean;
        postPresented: boolean;
      };
      framesObserved: number;
      framesRendered: number;
      framesSkipped: number;
      reasonCounts: Record<string, number>;
    };
    /** Resets the cumulative frame counters (measurement window). */
    resetFrameTelemetry(): void;
    /** Manual render-scale override (null = governor-managed). */
    renderScaleOverride: number | null;
    /** True once the rendering device was lost (terminal for the session). */
    isFatalDeviceLoss: boolean;
    /** M11-03 TEST-ONLY: inject device loss through the production path. */
    simulateDeviceLoss(): void;
    /** Navigate to a destination (latest-wins through the director). */
    navigate(destinationId: string, presetId?: string): unknown;
  };
  navigate(destinationId: string, presetId?: string): unknown;
  /** Renders one deterministic frame in-task and returns a 5x5 RGB grid ("r,g,b"). */
  captureFrame(): string[] | null;
}

declare global {
  interface Window {
    __ATLAS_APP__?: AtlasHook;
  }
}

// Spec suites pull this file in via side-effect import for the augmentation;
// the empty export keeps it an external module, which `declare global` requires.
export {};
