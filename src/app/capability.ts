/**
 * Runtime capability snapshot and backend decision logic (M0-03).
 *
 * Spec: docs/IMPLEMENTATION_PLAYBOOK.md section 2.4, docs/DEPLOYMENT_COMPATIBILITY.md
 * section 2. Support is never inferred from user-agent strings; the WebGPU
 * probe requests a real adapter, the WebGL2 probe creates a real context.
 *
 * The pure decision function is unit-tested; the browser probes are thin and
 * defensive because TypeScript's DOM lib does not ship WebGPU types yet.
 */

export type RenderBackend = 'webgpu' | 'webgl2' | 'unsupported';

/** Serializable capability snapshot; telemetry/debug data, not behavior control. */
export interface RuntimeCapabilities {
  backend: RenderBackend;
  webgpuAvailable: boolean;
  webgl2Available: boolean;
  adapterInfo?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  features: string[];
  limits: Record<string, number>;
  timestampQuery: boolean;
  offscreenCanvas: boolean;
  crossOriginIsolated: boolean;
}

export interface BackendDecisionInput {
  webgpuAvailable: boolean;
  webgl2Available: boolean;
}

/**
 * Pure backend decision. WebGPU is preferred whenever the API exists;
 * WebGL2 is the documented fallback; anything else is unsupported.
 */
export function decideBackend(input: BackendDecisionInput): RenderBackend {
  if (input.webgpuAvailable) return 'webgpu';
  if (input.webgl2Available) return 'webgl2';
  return 'unsupported';
}

/* ------------------------------------------------------------------ */
/* Minimal structural types for the WebGPU entry points.               */
/* The DOM lib in TypeScript 5.9 does not declare navigator.gpu.       */
/* ------------------------------------------------------------------ */

interface GpuAdapterLike {
  features: Iterable<string>;
  limits: Record<string, number>;
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  requestAdapterInfo?: () => Promise<{
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  }>;
}

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter?: (options?: { powerPreference?: string }) => Promise<GpuAdapterLike | null>;
  };
}

function navigatorWithGpu(nav: Navigator): NavigatorWithGpu {
  return nav as Navigator & Partial<NavigatorWithGpu>;
}

/** True when `navigator.gpu.requestAdapter` exists (API presence only). */
export function detectWebGpuAvailability(nav: Navigator): boolean {
  const gpu = navigatorWithGpu(nav).gpu;
  return typeof gpu === 'object' && gpu !== null && typeof gpu.requestAdapter === 'function';
}

/**
 * True when a WebGL2 context can actually be created. Probes on a detached
 * scratch canvas so the main canvas stays untouched for the renderer.
 */
export function detectWebGl2Availability(documentRef: Document): boolean {
  try {
    const scratch = documentRef.createElement('canvas');
    const gl = scratch.getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface WebGPUGlobal {
  offscreenCanvas: boolean;
  crossOriginIsolated: boolean;
}

function globalFlags(): WebGPUGlobal {
  const g = globalThis as typeof globalThis & {
    OffscreenCanvas?: unknown;
    crossOriginIsolated?: boolean;
  };
  return {
    offscreenCanvas: typeof g.OffscreenCanvas === 'function',
    crossOriginIsolated: g.crossOriginIsolated === true
  };
}

async function probeAdapter(): Promise<GpuAdapterLike | null> {
  const gpu = navigatorWithGpu(navigator).gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return null;
  try {
    return await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    return null;
  }
}

async function readAdapterInfo(
  adapter: GpuAdapterLike
): Promise<RuntimeCapabilities['adapterInfo']> {
  if (adapter.info && typeof adapter.info === 'object') return { ...adapter.info };
  if (typeof adapter.requestAdapterInfo === 'function') {
    try {
      const legacy = await adapter.requestAdapterInfo();
      return legacy ? { ...legacy } : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Builds the full capability snapshot by probing the real environment.
 * `backend` reflects the same decision as `decideBackend` over the probes.
 */
export async function snapshotCapabilities(): Promise<RuntimeCapabilities> {
  const webgpuAvailable = detectWebGpuAvailability(navigator);
  const webgl2Available = detectWebGl2Availability(document);
  const flags = globalFlags();

  let adapterInfo: RuntimeCapabilities['adapterInfo'];
  const features: string[] = [];
  const limits: Record<string, number> = {};
  if (webgpuAvailable) {
    const adapter = await probeAdapter();
    if (adapter) {
      adapterInfo = await readAdapterInfo(adapter);
      for (const f of adapter.features) features.push(f);
      for (const [k, v] of Object.entries(adapter.limits)) {
        if (typeof v === 'number') limits[k] = v;
      }
    }
  }

  return {
    backend: decideBackend({ webgpuAvailable, webgl2Available }),
    webgpuAvailable,
    webgl2Available,
    ...(adapterInfo !== undefined ? { adapterInfo } : {}),
    features,
    limits,
    timestampQuery: features.includes('timestamp-query'),
    offscreenCanvas: flags.offscreenCanvas,
    crossOriginIsolated: flags.crossOriginIsolated
  };
}
