/**
 * Renderer capability detection for the Cosmic Atlas shared renderer kernel.
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §6 (shared renderer kernel), §10 (capability policy)
 * - docs/DEPLOYMENT_COMPATIBILITY.md §2 (WebGPU capability flow), §3 (feature tiers),
 *   §7 (production diagnostics)
 * - docs/FAILURE_RECOVERY.md §2 (CAPABILITY_CHECK stage), §17 (stable error codes)
 *
 * Probing policy: every optional feature is probed conservatively at init time from
 * live API surfaces only (GPUDevice features/limits, WebGL extension lists, renderer
 * capabilities). Support is never inferred from user-agent strings. An unreadable
 * surface reports `false` — "unknown" degrades to "absent" so destinations select
 * their documented fallback path instead of an unverified fast path.
 */

import type { BackendInfo, CapabilityId } from '../atlas/types';

// ---------------------------------------------------------------------------
// Probe input
// ---------------------------------------------------------------------------

/**
 * Everything the detector may need about an initialized renderer. All fields
 * except `api` are optional and duck-typed: three r180 does not expose the
 * WebGPU adapter handle or a typed device surface on its common `Backend`.
 */
export interface RendererProbe {
  /** Backend actually in use after init (three's WebGPURenderer can fall back internally). */
  api: 'webgpu' | 'webgl2';
  /** GPUDevice when `api === 'webgpu'` and the backend exposes one; otherwise undefined. */
  gpuDevice?: unknown;
  /** WebGL2 context when `api === 'webgl2'`; otherwise null. */
  gl?: WebGL2RenderingContext | null;
  /** three renderer capabilities object when exposed (`WebGLRenderer.capabilities`). */
  capabilities?: { maxTextureSize?: number } | null;
  /** Human-readable adapter description ('' when unavailable). */
  adapterName?: string;
  /** Device pixel ratio at detection time. */
  devicePixelRatio?: number;
}

// ---------------------------------------------------------------------------
// Duck-typed WebGPU surfaces (no dependency on ambient WebGPU typings)
// ---------------------------------------------------------------------------

interface GpuFeatureSetLike {
  has(feature: string): boolean;
}

interface GpuLimitsLike {
  maxTextureDimension2D?: number;
  maxStorageBufferBindingSize?: number;
}

interface GpuDeviceLike {
  features?: GpuFeatureSetLike;
  limits?: GpuLimitsLike;
}

interface GpuAdapterInfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

interface GpuAdapterLike {
  info?: GpuAdapterInfoLike;
  requestAdapterInfo?: () => Promise<GpuAdapterInfoLike>;
}

interface NavigatorGpuLike {
  requestAdapter?(options?: { powerPreference?: string }): Promise<GpuAdapterLike | null>;
}

/** Fallback used only when live limits cannot be read; deliberately modest. */
const FALLBACK_MAX_TEXTURE_SIZE = 8192;

/** Every CapabilityId, in stable report order. */
export const CAPABILITY_IDS: readonly CapabilityId[] = [
  'webgpu',
  'webgpu-compute',
  'storage-buffers',
  'float-render-target',
  'timestamp-query',
  'compressed-textures'
];

/** Human-readable labels for host status UI. */
export const CAPABILITY_LABELS: Readonly<Record<CapabilityId, string>> = {
  webgpu: 'WebGPU backend',
  'webgpu-compute': 'WebGPU compute shaders',
  'storage-buffers': 'Storage buffers',
  'float-render-target': 'Float render targets',
  'timestamp-query': 'GPU timestamp queries',
  'compressed-textures': 'Compressed texture formats'
};

/** Fixed honesty note displayed next to capability flags in the UI. */
export const CAPABILITY_DISCLOSURE =
  'Capability flags are probed conservatively at startup from live device features, limits, and ' +
  'WebGL extensions; unreadable surfaces report as unsupported. Flags describe availability, not performance.';

export type CapabilityFlags = Record<CapabilityId, boolean>;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Narrow an unknown value to the duck-typed GPUDevice surface, or null. */
function asGpuDevice(value: unknown): GpuDeviceLike | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as GpuDeviceLike;
  if (candidate.features !== undefined && typeof candidate.features.has !== 'function') return null;
  if (candidate.limits !== undefined && typeof candidate.limits !== 'object') return null;
  return candidate;
}

/** Read the WebGL extension list without enabling anything (side-effect free). */
function collectWebglExtensions(gl: WebGL2RenderingContext | null | undefined): Set<string> {
  if (gl === null || gl === undefined || typeof gl.getSupportedExtensions !== 'function') {
    return new Set<string>();
  }
  const supported = gl.getSupportedExtensions();
  return new Set<string>(supported ?? []);
}

function hasAnyPrefix(set: Iterable<string> | null, prefix: string): boolean {
  if (set === null) return false;
  for (const value of set) {
    if (value.startsWith(prefix)) return true;
  }
  return false;
}

function gpuFeatureSupported(
  features: GpuFeatureSetLike | null | undefined,
  name: string
): boolean {
  if (features === null || features === undefined) return false;
  try {
    return features.has(name);
  } catch {
    return false;
  }
}

/**
 * Detect per-capability availability flags from a renderer probe.
 * Conservative: any unreadable surface yields `false` for its capability.
 */
export function detectCapabilityFlags(probe: RendererProbe): CapabilityFlags {
  const isWebGpu = probe.api === 'webgpu';

  if (isWebGpu) {
    const device = asGpuDevice(probe.gpuDevice);
    const features = device?.features ?? null;
    return {
      webgpu: true,
      // Compute dispatch is part of core WebGPU; there is no WebGL2 equivalent path.
      'webgpu-compute': true,
      'storage-buffers': (device?.limits?.maxStorageBufferBindingSize ?? 0) > 0,
      // float32/half-float color attachments are renderable in core WebGPU.
      'float-render-target': true,
      'timestamp-query': gpuFeatureSupported(features, 'timestamp-query'),
      'compressed-textures':
        gpuFeatureSupported(features, 'texture-compression-bc') ||
        gpuFeatureSupported(features, 'texture-compression-astc') ||
        gpuFeatureSupported(features, 'texture-compression-etc2')
    };
  }

  const webglExtensions = collectWebglExtensions(probe.gl);
  return {
    webgpu: false,
    'webgpu-compute': false,
    'storage-buffers': false,
    'float-render-target':
      webglExtensions.has('EXT_color_buffer_float') ||
      webglExtensions.has('EXT_color_buffer_half_float'),
    'timestamp-query': webglExtensions.has('EXT_disjoint_timer_query_webgl2'),
    'compressed-textures': hasAnyPrefix(webglExtensions, 'WEBGL_compressed_texture_')
  };
}

function resolveMaxTextureSize(probe: RendererProbe): number {
  if (probe.api === 'webgpu') {
    const limit = asGpuDevice(probe.gpuDevice)?.limits?.maxTextureDimension2D;
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
      return Math.floor(limit);
    }
    return FALLBACK_MAX_TEXTURE_SIZE;
  }

  const fromCapabilities = probe.capabilities?.maxTextureSize;
  if (
    typeof fromCapabilities === 'number' &&
    Number.isFinite(fromCapabilities) &&
    fromCapabilities > 0
  ) {
    return Math.floor(fromCapabilities);
  }

  const gl = probe.gl;
  if (gl !== null && gl !== undefined && typeof gl.getParameter === 'function') {
    try {
      const value = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    } catch {
      // context already lost — fall through to the conservative default
    }
  }
  return FALLBACK_MAX_TEXTURE_SIZE;
}

/**
 * Build the shared `BackendInfo` record for an initialized renderer.
 * Pair with {@link detectCapabilityFlags} to keep extended flags (e.g.
 * `compressed-textures`, which has no dedicated field on `BackendInfo`).
 */
export function detectCapabilities(probe: RendererProbe): BackendInfo {
  const flags = detectCapabilityFlags(probe);
  return {
    api: probe.api,
    adapterName: probe.adapterName ?? '',
    maxTextureSize: resolveMaxTextureSize(probe),
    floatRenderTargets: flags['float-render-target'],
    timestampQuery: flags['timestamp-query'],
    storageBuffers: flags['storage-buffers'],
    devicePixelRatio: probe.devicePixelRatio ?? 1
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Availability of a single capability given detected flags (null → false). */
export function satisfied(flags: CapabilityFlags | null, id: CapabilityId): boolean {
  if (flags === null) return false;
  return flags[id] === true;
}

// ---------------------------------------------------------------------------
// Host status UI summary
// ---------------------------------------------------------------------------

export interface CapabilitySummary {
  /** True once the kernel adopted an initialized renderer. */
  ready: boolean;
  api: 'webgpu' | 'webgl2' | 'none';
  adapterName: string;
  maxTextureSize: number;
  devicePixelRatio: number;
  flags: CapabilityFlags;
  labels: Readonly<Record<CapabilityId, string>>;
  /** Fixed honesty note to render next to the flags. */
  disclosure: string;
}

function emptyFlags(): CapabilityFlags {
  const flags = {} as CapabilityFlags;
  for (const id of CAPABILITY_IDS) flags[id] = false;
  return flags;
}

/** Assemble the debug/status-panel summary from kernel state. */
export function summarizeCapabilities(
  backend: BackendInfo | null,
  flags: CapabilityFlags | null
): CapabilitySummary {
  return {
    ready: backend !== null,
    api: backend?.api ?? 'none',
    adapterName: backend?.adapterName ?? '',
    maxTextureSize: backend?.maxTextureSize ?? 0,
    devicePixelRatio: backend?.devicePixelRatio ?? 1,
    flags: flags !== null ? { ...flags } : emptyFlags(),
    labels: CAPABILITY_LABELS,
    disclosure: CAPABILITY_DISCLOSURE
  };
}

// ---------------------------------------------------------------------------
// Adapter identification
// ---------------------------------------------------------------------------

function formatAdapterInfo(info: GpuAdapterInfoLike | null): string {
  if (info === null) return '';
  const description = typeof info.description === 'string' ? info.description.trim() : '';
  if (description !== '') return description;
  const parts = [info.vendor, info.architecture, info.device]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim());
  return parts.join(' ');
}

/**
 * Resolve a human-readable WebGPU adapter name via the standard navigator API.
 *
 * three r180's WebGPUBackend does not expose its adapter handle, so this issues
 * a separate diagnostic `requestAdapter()` call. Every step is feature-guarded
 * and failure-tolerant: any error yields '' rather than blocking initialization.
 */
export async function resolveWebGPUAdapterName(): Promise<string> {
  const gpu =
    typeof navigator !== 'undefined' ? (navigator as { gpu?: NavigatorGpuLike }).gpu : undefined;
  if (gpu === undefined || gpu === null || typeof gpu.requestAdapter !== 'function') return '';

  let adapter: GpuAdapterLike | null = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    return '';
  }
  if (adapter === null || adapter === undefined) return '';

  let info: GpuAdapterInfoLike | null = null;
  if (adapter.info !== null && typeof adapter.info === 'object') {
    info = adapter.info;
  } else if (typeof adapter.requestAdapterInfo === 'function') {
    try {
      info = await adapter.requestAdapterInfo();
    } catch {
      info = null;
    }
  }
  return formatAdapterInfo(info);
}
