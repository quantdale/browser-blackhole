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
    transition: { active: boolean; phase: string | null; progress: number };
  };
}

interface InventoryView {
  liveScopeCount: number;
  totalEstimatedGpuBytes: number;
  pendingPrepares: number;
  /** Present when a backend engaged; null during boot or before first frame. */
  backend: { api: string; adapterName: string } | null;
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
