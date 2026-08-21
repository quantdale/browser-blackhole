/**
 * Development/test-only hooks (docs/CI_CD.md section 6).
 *
 * Small, documented, namespaced global. Read-only except for explicit preset
 * loading, which goes through the canonical normalization boundary. Keep this
 * API minimal; do not add production behavior here.
 */

import type { AppState, DebugViewMode } from './state.js';
import type { RenderBackend } from './capability.js';
import type { RuntimeStatusSnapshot } from './runtimeStatus.js';
import type { CameraBasis } from '../camera/CameraController.js';

export interface PixelSample {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface BlackHoleTestHooks {
  getRuntimeStatus(): RuntimeStatusSnapshot;
  getState(): AppState;
  /**
   * Applies a partial canonical state (same normalization path as presets);
   * returns success. Used by validation probes to aim the camera or switch
   * debug views without preset round-trips.
   */
  setState?(partial: unknown): boolean;
  /** Loads a built-in preset through normalizeAppState; returns success. */
  loadPreset(id: string): boolean;
  /** Renders one frame synchronously. */
  renderOnce(): void;
  /** Renders one frame and samples a 5x5 pixel grid from the canvas. */
  captureProbe(): PixelSample[] | null;
  /** Canonical camera basis of the current frame (CPU-vs-GPU parity testing). */
  getCameraBasis(): CameraBasis;
  /** Uncaught errors/rejections recorded since boot (test evidence). */
  getUncaughtErrors(): string[];
}

const HOOKS_KEY = '__BLACKHOLE_TEST__';

const BACKEND_OVERRIDE_PARAM = 'backend';
const BACKEND_OVERRIDE_VALUES: readonly string[] = ['webgpu', 'webgl2', 'unsupported'];

/**
 * Dev/test-only backend decision override (docs/CI_CD.md section 6):
 * `?backend=webgpu|webgl2|unsupported` forces the backend decision so the
 * WebGL2 fallback path and the terminal unsupported UX are exercisable on
 * capable machines. Returns null when the parameter is absent or invalid;
 * capability telemetry always reports the REAL probes regardless.
 */
export function readForcedBackend(search: string): RenderBackend | null {
  const value = new URLSearchParams(search).get(BACKEND_OVERRIDE_PARAM);
  if (value === null || !BACKEND_OVERRIDE_VALUES.includes(value)) return null;
  return value as RenderBackend;
}

/**
 * Dev/test-only debug-view override (same policy class as `?backend=`):
 * `?view=diagnostic|environment|off` selects the initial `debug.viewMode`
 * without going through a preset, so the straight-ray environment sampling
 * path is exercisable in browser probes. Returns null when absent/invalid.
 */
export function readForcedViewMode(search: string): DebugViewMode | null {
  const value = new URLSearchParams(search).get('view');
  if (value === 'diagnostic' || value === 'environment' || value === 'off') {
    return value;
  }
  return null;
}

export function installTestHooks(hooks: BlackHoleTestHooks): void {
  (globalThis as unknown as Record<string, unknown>)[HOOKS_KEY] = hooks;
}

export function removeTestHooks(): void {
  delete (globalThis as unknown as Record<string, unknown>)[HOOKS_KEY];
}
