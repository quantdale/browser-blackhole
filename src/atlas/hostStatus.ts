/**
 * Boot initialization status: stage machine, progress tracking, and the
 * unsupported-device message builder.
 *
 * Spec sources:
 * - docs/FAILURE_RECOVERY.md §2 (runtime status machine BOOT → READY/FAILED),
 *   §3 (user-facing error principles), §4 (WebGPU unavailable), §17 (stable
 *   error codes);
 * - docs/OBSERVABILITY_DIAGNOSTICS.md §13 (error overlay fields);
 * - docs/cosmic-atlas/WORK_PACKETS.md §CA0-09 (boot/debug support surface).
 *
 * This module owns no DOM; the UI worker subscribes to `InitStatusTracker`
 * and renders `UnsupportedDeviceMessage` wherever appropriate. All behavior
 * is deterministic: no randomness, no wall-clock reads.
 */

import type { BackendInfo, CapabilityId, CapabilityRequirement } from './types';

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export type InitStage = 'capabilities' | 'renderer' | 'services' | 'registry' | 'ready' | 'failed';

/** Linear boot order. `failed` is terminal and reached only via `fail()`. */
export const INIT_STAGE_ORDER: readonly InitStage[] = [
  'capabilities',
  'renderer',
  'services',
  'registry',
  'ready'
];

/** Human-readable per-stage messages used as default transition text. */
export const INIT_STAGE_DESCRIPTIONS: Record<InitStage, string> = {
  capabilities: 'Checking graphics capabilities…',
  renderer: 'Initializing renderer…',
  services: 'Starting shared renderer services…',
  registry: 'Loading destination registry…',
  ready: 'Ready.',
  failed: 'Initialization failed.'
};

/**
 * Number of linear stages that must complete before `ready`. Overall progress
 * is `(completedStages + withinStageFraction) / STAGES_BEFORE_READY`.
 */
const STAGES_BEFORE_READY = INIT_STAGE_ORDER.length - 1;

function isLinearStage(stage: InitStage): boolean {
  return stage !== 'failed' && INIT_STAGE_ORDER.includes(stage);
}

// ---------------------------------------------------------------------------
// Events and snapshots
// ---------------------------------------------------------------------------

export interface InitStatusSnapshot {
  /** Null before the first `begin()` call (pre-boot). */
  stage: InitStage | null;
  message: string;
  /** Overall boot fraction in [0, 1]; frozen at its last value on failure. */
  progress: number;
  /** Stable error code per docs/FAILURE_RECOVERY.md §17; null unless failed. */
  errorCode: string | null;
  ready: boolean;
  failed: boolean;
}

/** Emitted on every stage transition and overall-progress change. */
export interface InitStatusEvent extends InitStatusSnapshot {
  previousStage: InitStage | null;
}

export type InitStatusListener = (event: InitStatusEvent) => void;

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

/**
 * Tracks boot progress through the linear stages and notifies subscribers of
 * transitions and progress changes. Illegal orderings throw loudly instead of
 * being silently absorbed, mirroring the lifecycle-ordering discipline of
 * CA0-03; call `reset()` to return to the pre-boot state.
 */
export class InitStatusTracker {
  private currentStage: InitStage | null = null;
  private previousStageValue: InitStage | null = null;
  private messageValue = '';
  private errorCodeValue: string | null = null;
  private progressValue = 0;
  private readonly listeners = new Set<InitStatusListener>();

  get stage(): InitStage | null {
    return this.currentStage;
  }

  get message(): string {
    return this.messageValue;
  }

  get progress(): number {
    return this.progressValue;
  }

  get errorCode(): string | null {
    return this.errorCodeValue;
  }

  get ready(): boolean {
    return this.currentStage === 'ready';
  }

  get failed(): boolean {
    return this.currentStage === 'failed';
  }

  /**
   * Subscribe to status updates. The listener fires synchronously on stage
   * transitions and on overall-progress changes, receiving an immutable event
   * copy. Returns an unsubscribe function.
   */
  subscribe(listener: InitStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Enter a linear boot stage. Stages must advance forward through
   * `INIT_STAGE_ORDER`; re-entering a stage or moving backwards throws.
   */
  begin(stage: InitStage, message?: string): void {
    if (!isLinearStage(stage)) {
      throw new Error(
        `InitStatusTracker.begin: '${stage}' is not a linear stage (use fail() for failures).`
      );
    }
    if (this.currentStage === 'ready' || this.currentStage === 'failed') {
      throw new Error(
        `InitStatusTracker.begin: cannot advance from terminal stage '${this.currentStage}' (call reset() first).`
      );
    }
    const nextIndex = INIT_STAGE_ORDER.indexOf(stage);
    const currentIndex =
      this.currentStage === null ? -1 : INIT_STAGE_ORDER.indexOf(this.currentStage);
    if (nextIndex <= currentIndex) {
      throw new Error(
        `InitStatusTracker.begin: illegal stage move ${String(this.currentStage)} -> '${stage}'.`
      );
    }

    this.progressValue = stage === 'ready' ? 1 : Math.min(1, nextIndex / STAGES_BEFORE_READY);
    this.markStage(stage, message ?? INIT_STAGE_DESCRIPTIONS[stage], null);
  }

  /**
   * Refine progress within the current stage (e.g. shader-compilation
   * fraction). Non-finite values are ignored and out-of-range values are
   * clamped so a glitchy reporter cannot corrupt the overall fraction.
   * No-op before boot, once ready, or once failed. Emits only when the
   * overall fraction actually changes.
   */
  setStageFraction(fraction01: number): void {
    if (
      this.currentStage === null ||
      this.currentStage === 'ready' ||
      this.currentStage === 'failed'
    ) {
      return;
    }
    if (!Number.isFinite(fraction01)) return;
    const clamped = Math.min(1, Math.max(0, fraction01));
    const completedStages = INIT_STAGE_ORDER.indexOf(this.currentStage);
    const nextProgress = Math.min(1, (completedStages + clamped) / STAGES_BEFORE_READY);
    if (nextProgress !== this.progressValue) {
      this.progressValue = nextProgress;
      this.emit();
    }
  }

  /**
   * Enter the terminal `failed` stage. Overall progress freezes at its last
   * value. Throws when already terminal (call `reset()` first).
   */
  fail(errorCode: string, detail?: string): void {
    if (this.currentStage === 'failed') {
      throw new Error('InitStatusTracker.fail: already failed (call reset() first).');
    }
    if (this.currentStage === 'ready') {
      throw new Error('InitStatusTracker.fail: cannot fail after ready.');
    }
    this.markStage('failed', detail ?? INIT_STAGE_DESCRIPTIONS.failed, errorCode);
  }

  /** Return to the pre-boot state and notify subscribers. No-op if pristine. */
  reset(): void {
    if (
      this.currentStage === null &&
      this.messageValue === '' &&
      this.errorCodeValue === null &&
      this.progressValue === 0
    ) {
      return;
    }
    this.progressValue = 0;
    this.markStage(null, '', null);
  }

  snapshot(): InitStatusSnapshot {
    return Object.freeze({
      stage: this.currentStage,
      message: this.messageValue,
      progress: this.progressValue,
      errorCode: this.errorCodeValue,
      ready: this.ready,
      failed: this.failed
    });
  }

  private markStage(stage: InitStage | null, message: string, errorCode: string | null): void {
    this.previousStageValue = this.currentStage;
    this.currentStage = stage;
    this.messageValue = message;
    this.errorCodeValue = errorCode;
    this.emit();
  }

  private emit(): void {
    const event: InitStatusEvent = Object.freeze({
      stage: this.currentStage,
      message: this.messageValue,
      progress: this.progressValue,
      errorCode: this.errorCodeValue,
      ready: this.ready,
      failed: this.failed,
      previousStage: this.previousStageValue
    });
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

// ---------------------------------------------------------------------------
// Capability evaluation (unsupported-device reason builder)
// ---------------------------------------------------------------------------

interface CapabilityCopy {
  /** Stable code extending the docs/FAILURE_RECOVERY.md §17 naming style. */
  code: string;
  summary: string;
  suggestion: string;
}

/**
 * Per-capability copy. `webgpu-compute` is approximated as WebGPU plus
 * storage buffers because `BackendInfo` exposes no dedicated compute flag;
 * storage buffers are the practical prerequisite for the compute particle
 * path. `compressed-textures` is not observable from `BackendInfo` at all and
 * is treated as satisfied whenever any backend exists (ARCHITECTURE §10 lists
 * it as an optional optimization, never hard).
 */
const CAPABILITY_COPY: Record<CapabilityId, CapabilityCopy> = {
  webgpu: {
    code: 'ENV_WEBGPU_UNAVAILABLE',
    summary: 'WebGPU is required but this browser does not expose it.',
    suggestion:
      'Open the atlas in a WebGPU-capable browser (Chrome or Edge 113+, or a recent Firefox/Safari) over HTTPS or localhost.'
  },
  'webgpu-compute': {
    code: 'ENV_WEBGPU_COMPUTE_UNAVAILABLE',
    summary: 'GPU compute is required but the active backend does not provide it.',
    suggestion:
      'Switch to a destination/preset with a non-compute fallback, or use a browser/device whose WebGPU implementation supports compute.'
  },
  'storage-buffers': {
    code: 'GPU_STORAGE_BUFFERS_UNSUPPORTED',
    summary:
      'The active GPU adapter does not support the storage buffers this destination requires.',
    suggestion:
      'Choose a preset that avoids storage-buffer paths, or try a device with a newer GPU/driver.'
  },
  'float-render-target': {
    code: 'GPU_FLOAT_RENDER_TARGET_UNSUPPORTED',
    summary:
      'Float render targets are required for this destination’s HDR path but are unsupported here.',
    suggestion:
      'Select a lower-fidelity preset, or use a device whose GPU supports floating-point rendering.'
  },
  'timestamp-query': {
    code: 'GPU_TIMESTAMP_QUERY_UNSUPPORTED',
    summary: 'GPU timestamp queries are required here but the adapter does not expose them.',
    suggestion:
      'Continue without GPU timing (CPU wall timing will be labeled as such) or use an adapter with timestamp-query support.'
  },
  'compressed-textures': {
    code: 'GPU_COMPRESSED_TEXTURES_UNSUPPORTED',
    summary: 'A required compressed texture format is unavailable on this device.',
    suggestion:
      'Use a preset with uncompressed assets, or a device/GPU supporting the needed compressed texture formats.'
  }
};

export interface MissingCapabilityFinding {
  capability: CapabilityId;
  code: string;
  summary: string;
}

export interface CapabilitySupportReport {
  /** True when every hard requirement is satisfied by the given backend. */
  supported: boolean;
  missingHard: readonly MissingCapabilityFinding[];
  missingSoft: readonly MissingCapabilityFinding[];
}

function capabilitySatisfied(capability: CapabilityId, backend: BackendInfo | null): boolean {
  if (backend === null) return false;
  switch (capability) {
    case 'webgpu':
      return backend.api === 'webgpu';
    case 'webgpu-compute':
      return backend.api === 'webgpu' && backend.storageBuffers;
    case 'storage-buffers':
      return backend.storageBuffers;
    case 'float-render-target':
      return backend.floatRenderTargets;
    case 'timestamp-query':
      return backend.timestampQuery;
    case 'compressed-textures':
      return true;
  }
}

/**
 * Evaluate destination capability requirements against acquired backend info.
 * A null backend means no adapter was acquired, so nothing can be verified
 * and every requirement is reported missing.
 */
export function evaluateCapabilitySupport(
  backend: BackendInfo | null,
  required: readonly CapabilityRequirement[]
): CapabilitySupportReport {
  const missingHard: MissingCapabilityFinding[] = [];
  const missingSoft: MissingCapabilityFinding[] = [];

  for (const requirement of required) {
    if (capabilitySatisfied(requirement.capability, backend)) continue;
    const copy = CAPABILITY_COPY[requirement.capability];
    const finding: MissingCapabilityFinding = {
      capability: requirement.capability,
      code: copy.code,
      summary: copy.summary
    };
    if (requirement.hard) {
      missingHard.push(finding);
    } else {
      missingSoft.push(finding);
    }
  }

  return { supported: missingHard.length === 0, missingHard, missingSoft };
}

/** Compose missing-capability findings into one human-readable sentence list. */
export function formatMissingCapabilityReasons(
  findings: readonly MissingCapabilityFinding[]
): string {
  return findings.map((finding) => finding.summary).join(' ');
}

// ---------------------------------------------------------------------------
// Unsupported-device message builder
// ---------------------------------------------------------------------------

export interface UnsupportedDeviceMessage {
  title: string;
  detail: string;
  suggestions: string[];
  /** Stable machine-readable code for the error overlay. */
  code: string;
}

interface ReasonCopy {
  title: string;
  detail: string;
  suggestions: string[];
}

/** Curated copy keyed by stable codes (docs/FAILURE_RECOVERY.md §17). */
const REASON_COPY: ReadonlyMap<string, ReasonCopy> = new Map(
  Object.entries({
    ENV_WEBGPU_UNAVAILABLE: {
      title: 'WebGPU is unavailable',
      detail:
        'This browser does not expose the WebGPU API, which Cosmic Atlas requires for rendering. The application cannot start.',
      suggestions: [
        'Use a WebGPU-capable browser such as Chrome or Edge 113+ (or a recent Firefox/Safari).',
        'Serve the page over HTTPS or localhost — WebGPU requires a secure context.',
        'Check that WebGPU is not disabled by browser flags or device policy.'
      ]
    },
    ENV_WEBGL2_UNAVAILABLE: {
      title: 'Graphics fallback unavailable',
      detail:
        'Neither WebGPU nor the WebGL2 fallback could be initialized, so there is no compatible rendering path on this system.',
      suggestions: [
        'Update your browser to the latest version.',
        'Verify hardware acceleration is enabled in browser settings.',
        'Try another device with a supported GPU.'
      ]
    },
    GPU_ADAPTER_FAILED: {
      title: 'Graphics adapter could not be selected',
      detail:
        'The browser could not provide a usable GPU adapter. Rendering cannot continue on this device right now.',
      suggestions: [
        'Reload the page to retry adapter acquisition.',
        'Update your GPU driver and browser, then retry.',
        'Try a different browser or device.'
      ]
    },
    GPU_DEVICE_FAILED: {
      title: 'Graphics device could not be created',
      detail:
        'A GPU adapter was found but the rendering device could not be created. The application cannot start rendering.',
      suggestions: [
        'Reload the page to retry.',
        'Close other GPU-heavy applications and retry.',
        'Update your GPU driver or try another browser.'
      ]
    },
    GPU_DEVICE_LOST: {
      title: 'Graphics device was lost',
      detail:
        'The GPU device was lost during or after startup. Recovery did not succeed, so the application cannot continue rendering on this device.',
      suggestions: [
        'Reload the page to restart with a fresh device.',
        'If this repeats, lower quality settings once running, or update your GPU driver.'
      ]
    },
    GPU_PIPELINE_FAILED: {
      title: 'Renderer initialization failed',
      detail:
        'The rendering pipeline could not be compiled or configured for this device. Initialization stopped visibly instead of showing a degraded fake.',
      suggestions: [
        'Reload the page to retry initialization.',
        'Update your browser/GPU driver, then retry.',
        'If the failure persists, report the error code shown below.'
      ]
    }
  })
);

const GENERIC_REASON_COPY: ReasonCopy = {
  title: 'Cosmic Atlas cannot run on this device',
  detail:
    'Initialization stopped before a working render path was available. The application cannot continue.',
  suggestions: [
    'Reload the page and retry.',
    'Try a current version of Chrome, Edge, Firefox, or Safari.',
    'If a specific feature was named in the message, choose a destination or preset that does not require it.'
  ]
};

function capabilityReasonCopy(code: string): ReasonCopy | null {
  for (const capability of Object.keys(CAPABILITY_COPY) as CapabilityId[]) {
    const copy = CAPABILITY_COPY[capability];
    if (copy.code === code) {
      return { title: copy.summary, detail: copy.summary, suggestions: [copy.suggestion] };
    }
  }
  return null;
}

function describeBackend(backend: BackendInfo | null): string {
  if (backend === null) {
    return 'No graphics adapter was acquired.';
  }
  return `Active backend: ${backend.api} — adapter '${backend.adapterName}'.`;
}

/**
 * Build the user-facing unsupported-device copy for the boot/error overlay
 * (docs/FAILURE_RECOVERY.md §3 tone: what failed, whether the app can
 * continue, one useful remediation; docs/OBSERVABILITY_DIAGNOSTICS.md §13
 * overlay fields).
 *
 * `reason` should be a stable error code (see REASON_COPY / CAPABILITY_COPY);
 * free text is accepted and surfaced verbatim inside the generic copy.
 * Backend facts are appended so users and bug reports include the active
 * adapter context.
 */
export function buildUnsupportedMessage(
  backend: BackendInfo | null,
  reason: string
): UnsupportedDeviceMessage {
  const normalizedCode = reason.trim().toUpperCase();
  let copy: ReasonCopy;
  let code: string;
  let known = true;

  const curated = REASON_COPY.get(normalizedCode);
  if (curated !== undefined) {
    copy = curated;
    code = normalizedCode;
  } else {
    const capabilityCopy = capabilityReasonCopy(normalizedCode);
    if (capabilityCopy !== null) {
      copy = capabilityCopy;
      code = normalizedCode;
    } else {
      copy = GENERIC_REASON_COPY;
      code = 'BOOT_UNSUPPORTED';
      known = false;
    }
  }

  const detailLines: string[] = [copy.detail, describeBackend(backend)];
  if (!known && reason.trim().length > 0) {
    detailLines.push(`Reason: ${reason.trim()}`);
  }

  return {
    title: copy.title,
    detail: detailLines.join(' '),
    suggestions: [...copy.suggestions],
    code
  };
}
