/**
 * Runtime status machine and store (M0-03/M0-09).
 *
 * Lifecycle per docs/FAILURE_RECOVERY.md section 2:
 *   BOOT -> CAPABILITY_CHECK -> INITIALIZING -> READY
 *   INITIALIZING -> FALLBACK_INITIALIZING -> READY
 *   INITIALIZING -> FAILED
 *   (device-loss/recovering phases arrive with the device-loss work)
 *
 * The `unsupported` terminal phase covers "no WebGPU and no WebGL2": it is a
 * useful, visible terminal state, never a blank canvas.
 */

import type { RenderBackend, RuntimeCapabilities } from './capability.js';

export type LifecyclePhase =
  | 'boot'
  | 'capability-check'
  | 'initializing'
  | 'fallback-initializing'
  | 'ready'
  | 'unsupported'
  | 'failed';

export type Severity = 'info' | 'ok' | 'warning' | 'error';

export interface RuntimeStatusSnapshot {
  phase: LifecyclePhase;
  /** Backend decision or actual backend once known; 'pending' before the probe. */
  backend: RenderBackend | 'pending';
  severity: Severity;
  headline: string;
  detail: string;
  errorCode: string | null;
  webgpuAvailable: boolean | null;
  webgl2Available: boolean | null;
  internalWidth: number | null;
  internalHeight: number | null;
  revision: number;
}

export type StatusListener = (snapshot: RuntimeStatusSnapshot) => void;

interface StatusPatch {
  phase?: LifecyclePhase;
  backend?: RenderBackend | 'pending';
  severity?: Severity;
  headline?: string;
  detail?: string;
  errorCode?: string | null;
  webgpuAvailable?: boolean | null;
  webgl2Available?: boolean | null;
  internalWidth?: number | null;
  internalHeight?: number | null;
  revision?: number;
}

const PHASE_DEFAULT_SEVERITY: Record<LifecyclePhase, Severity> = {
  boot: 'info',
  'capability-check': 'info',
  initializing: 'info',
  'fallback-initializing': 'warning',
  ready: 'ok',
  unsupported: 'error',
  failed: 'error'
};

const PHASE_DEFAULT_HEADLINE: Record<LifecyclePhase, string> = {
  boot: 'Starting…',
  'capability-check': 'Checking graphics capabilities…',
  initializing: 'Initializing WebGPU renderer…',
  'fallback-initializing': 'WebGPU unavailable — initializing WebGL2 fallback…',
  ready: 'Ready',
  unsupported: 'This browser cannot run the renderer',
  failed: 'Renderer initialization failed'
};

/** Stable machine-readable codes (docs/FAILURE_RECOVERY.md section 17). */
export const ERROR_CODES = {
  ENV_WEBGPU_UNAVAILABLE: 'ENV_WEBGPU_UNAVAILABLE',
  ENV_WEBGL2_UNAVAILABLE: 'ENV_WEBGL2_UNAVAILABLE',
  GPU_ADAPTER_FAILED: 'GPU_ADAPTER_FAILED',
  GPU_PIPELINE_FAILED: 'GPU_PIPELINE_FAILED',
  STATE_INVALID: 'STATE_INVALID'
} as const;

export class StatusStore {
  private snapshot: RuntimeStatusSnapshot = {
    phase: 'boot',
    backend: 'pending',
    severity: PHASE_DEFAULT_SEVERITY['boot'],
    headline: 'Starting…',
    detail: '',
    errorCode: null,
    webgpuAvailable: null,
    webgl2Available: null,
    internalWidth: null,
    internalHeight: null,
    revision: 0
  };

  private listeners = new Set<StatusListener>();

  get(): RuntimeStatusSnapshot {
    return this.snapshot;
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  patch(patch: StatusPatch): void {
    const phase = patch.phase ?? this.snapshot.phase;
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      phase,
      severity: patch.severity ?? PHASE_DEFAULT_SEVERITY[phase],
      headline: patch.headline ?? PHASE_DEFAULT_HEADLINE[phase]
    };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  setInternalSize(width: number, height: number): void {
    if (width === this.snapshot.internalWidth && height === this.snapshot.internalHeight) return;
    this.patch({ internalWidth: width, internalHeight: height });
  }

  setRevision(revision: number): void {
    if (revision !== this.snapshot.revision) this.patch({ revision });
  }

  /** Applies a capability probe result to the snapshot. */
  applyCapabilities(caps: RuntimeCapabilities): void {
    this.patch({
      webgpuAvailable: caps.webgpuAvailable,
      webgl2Available: caps.webgl2Available,
      backend: caps.backend
    });
  }
}
