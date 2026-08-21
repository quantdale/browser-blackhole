/**
 * Development/test-only hooks (docs/CI_CD.md section 6).
 *
 * Small, documented, namespaced global. Read-only except for explicit preset
 * loading, which goes through the canonical normalization boundary. Keep this
 * API minimal; do not add production behavior here.
 */

import type { AppState } from './state.js';
import type { RuntimeStatusSnapshot } from './runtimeStatus.js';

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
  /** Loads a built-in preset through normalizeAppState; returns success. */
  loadPreset(id: string): boolean;
  /** Renders one frame synchronously. */
  renderOnce(): void;
  /** Renders one frame and samples a 5x5 pixel grid from the canvas. */
  captureProbe(): PixelSample[] | null;
  /** Uncaught errors/rejections recorded since boot (test evidence). */
  getUncaughtErrors(): string[];
}

const HOOKS_KEY = '__BLACKHOLE_TEST__';

export function installTestHooks(hooks: BlackHoleTestHooks): void {
  (globalThis as unknown as Record<string, unknown>)[HOOKS_KEY] = hooks;
}

export function removeTestHooks(): void {
  delete (globalThis as unknown as Record<string, unknown>)[HOOKS_KEY];
}
