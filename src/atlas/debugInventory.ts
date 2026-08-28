/**
 * CA0-09 — Atlas debug inventory.
 *
 * Aggregates the host pieces an engineer needs to answer "what state is the
 * renderer in right now" (docs/cosmic-atlas/WORK_PACKETS.md §CA0-09,
 * docs/OBSERVABILITY_DIAGNOSTICS.md §2 runtime snapshot and §13 error overlay):
 * active destination, renderer generation, resource counts, pending prepares,
 * quality-governor tier/render scale, and backend info.
 *
 * This module owns no DOM and no renderer lifecycle; the UI worker renders
 * `DebugInventoryView` (e.g. via `formatInventoryText`) wherever it wants.
 * All output is deterministic: no timestamps, no locale-dependent formatting,
 * no randomness.
 */

import type {
  BackendInfo,
  FrameInvalidationTelemetry,
  DestinationId,
  GovernorActivityMode,
  IPerformanceGovernor,
  QualityTier,
  RendererInfoTelemetry,
  ResourceScopeCounters
} from './types';
import type { ScopeInventory } from './ResourceManager';

// ---------------------------------------------------------------------------
// Structural inputs (kept minimal so this module only depends on what it reads)
// ---------------------------------------------------------------------------

/** One scope entry as rendered by the inventory view. */
export interface ResourceScopeInventoryEntry {
  readonly name: string;
  readonly disposed: boolean;
  readonly counters: ResourceScopeCounters;
}

/**
 * Minimal structural contract assumed for `ResourceManager.debugInventory()`.
 * The real manager signature returns `ScopeInventory[]` — rows of
 * `{ name, snapshot }` covering LIVE scopes only (disposed scopes are pruned
 * by the manager before reporting, so `disposed` is always false here).
 */
export type DebugInventoryResourceSource = {
  debugInventory(): ScopeInventory[];
} | null;

/** Governor piece narrowed to the fields the inventory reports. */
export type DebugInventoryGovernorPiece = Pick<
  IPerformanceGovernor,
  'currentTier' | 'renderScale' | 'activityMode'
> | null;
/** Host pieces passed in by the boot/frame coordinator each dump. */
export interface DebugInventoryHostPieces {
  resources: DebugInventoryResourceSource;
  /** Currently entered destination id, or null while no destination is live. */
  activeDestinationId: DestinationId | null;
  /** Monotonically increasing renderer generation (docs/FAILURE_RECOVERY.md §5). */
  rendererGeneration: number;
  /** Destination preparations started but not yet resolved/aborted. */
  pendingPrepares: number;
  governor: DebugInventoryGovernorPiece;
  backend: BackendInfo | null;
  /** BH-121 GPU frame ms of the last resolved frame (null = unavailable). */
  gpuFrameMs: number | null;
  /** WS0/tasks.md §1 frame-invalidation telemetry (null before the host wires it). */
  frame: FrameInvalidationTelemetry | null;
  /** WS0/tasks.md §1 renderer.info mirror (null when no renderer is live). */
  rendererInfo: RendererInfoTelemetry | null;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface DebugInventoryView {
  activeDestinationId: DestinationId | null;
  rendererGeneration: number;
  pendingPrepares: number;
  governor: {
    tier: QualityTier;
    renderScale: number;
    activityMode: GovernorActivityMode;
  } | null;
  backend: BackendInfo | null;
  /** BH-121 GPU frame ms of the last resolved frame (null = unavailable). */
  gpuFrameMs: number | null;
  /**
   * WS0/tasks.md §1 frame-invalidation telemetry: which reasons woke recent
   * frames, how many frames were skipped, and which stages the last
   * orchestrated frame executed. This is the work-elimination evidence every
   * later workstream is measured against, and unlike a timing delta it means
   * the same thing on every machine.
   */
  frame: FrameInvalidationTelemetry | null;
  /** WS0/tasks.md §1 renderer.info mirror (null when no renderer is live). */
  rendererInfo: RendererInfoTelemetry | null;
  /** Per-scope entries exactly as reported by the ResourceManager. */
  resourceScopes: readonly ResourceScopeInventoryEntry[];
  /** True when `debugInventory()` was reachable and returned without throwing. */
  resourceInventoryAvailable: boolean;
  /** Present when the resource inventory could not be read (boot order, disposal race). */
  resourceInventoryError: string | null;
  liveScopeCount: number;
  disposedScopeCount: number;
  /** Per-kind counters summed over live scopes. */
  totalResourceCounts: ResourceScopeCounters;
  /** Sum of `estimatedGpuBytes` over live scopes. */
  totalEstimatedGpuBytes: number;
}

function emptyCounters(): ResourceScopeCounters {
  return {
    texture: 0,
    cubeTexture: 0,
    volumeTexture: 0,
    buffer: 0,
    storageBuffer: 0,
    geometry: 0,
    renderTarget: 0,
    material: 0,
    worker: 0,
    listener: 0,
    timer: 0,
    pendingFetch: 0,
    estimatedGpuBytes: 0
  };
}

function addCounters(into: ResourceScopeCounters, from: ResourceScopeCounters): void {
  into.texture += from.texture;
  into.cubeTexture += from.cubeTexture;
  into.volumeTexture += from.volumeTexture;
  into.buffer += from.buffer;
  into.storageBuffer += from.storageBuffer;
  into.geometry += from.geometry;
  into.renderTarget += from.renderTarget;
  into.material += from.material;
  into.worker += from.worker;
  into.listener += from.listener;
  into.timer += from.timer;
  into.pendingFetch += from.pendingFetch;
  into.estimatedGpuBytes += from.estimatedGpuBytes;
}

/**
 * Build a point-in-time debug inventory view from the given host pieces.
 * Never throws: a failing or missing ResourceManager degrades to an empty
 * resource section with `resourceInventoryAvailable: false` so the rest of
 * the dump stays useful during partial boot or device recovery.
 */
export function collectInventory(pieces: DebugInventoryHostPieces): DebugInventoryView {
  let scopes: readonly ResourceScopeInventoryEntry[] = [];
  let resourceInventoryAvailable = false;
  let resourceInventoryError: string | null = null;

  if (pieces.resources !== null) {
    try {
      // ResourceManager.debugInventory() reports live scopes as
      // `{ name, snapshot }` rows; disposed scopes never appear (the manager
      // prunes them), so `disposed` is false for every reported entry.
      const inventory = pieces.resources.debugInventory();
      scopes = inventory.map((row) => ({
        name: row.name,
        disposed: false,
        counters: row.snapshot
      }));
      resourceInventoryAvailable = true;
    } catch (error) {
      resourceInventoryError =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }

  const totals = emptyCounters();
  let liveScopeCount = 0;
  let disposedScopeCount = 0;

  for (const scope of scopes) {
    if (scope.disposed) {
      disposedScopeCount += 1;
      continue;
    }
    liveScopeCount += 1;
    addCounters(totals, scope.counters);
  }

  return {
    activeDestinationId: pieces.activeDestinationId,
    rendererGeneration: pieces.rendererGeneration,
    pendingPrepares: pieces.pendingPrepares,
    governor:
      pieces.governor === null
        ? null
        : {
            tier: pieces.governor.currentTier,
            renderScale: pieces.governor.renderScale,
            activityMode: pieces.governor.activityMode
          },
    backend: pieces.backend,
    gpuFrameMs: pieces.gpuFrameMs,
    frame: pieces.frame,
    rendererInfo: pieces.rendererInfo,
    resourceScopes: scopes,
    resourceInventoryAvailable,
    resourceInventoryError,
    liveScopeCount,
    disposedScopeCount,
    totalResourceCounts: totals,
    totalEstimatedGpuBytes: totals.estimatedGpuBytes
  };
}

// ---------------------------------------------------------------------------
// Text formatting
// ---------------------------------------------------------------------------

const LABEL_WIDTH = 24;

function boolLabel(value: boolean): string {
  return value ? 'yes' : 'no';
}

function formatFixed(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return 'n/a';
  const mib = bytes / (1024 * 1024);
  return `${bytes} bytes (${formatFixed(mib, 2)} MiB)`;
}

function formatScopeLine(scope: ResourceScopeInventoryEntry): string {
  const c = scope.counters;
  const state = scope.disposed ? 'disposed' : 'live';
  return (
    `- [${state}] '${scope.name}'` +
    ` tex=${c.texture} cube=${c.cubeTexture} vol=${c.volumeTexture}` +
    ` buf=${c.buffer} sbuf=${c.storageBuffer} geo=${c.geometry} rt=${c.renderTarget}` +
    ` mat=${c.material} workers=${c.worker} listeners=${c.listener} timers=${c.timer}` +
    ` fetch=${c.pendingFetch} bytes=${c.estimatedGpuBytes}`
  );
}

/**
 * Render a multi-line human-readable dump of the inventory for
 * console/debug-panel display (docs/OBSERVABILITY_DIAGNOSTICS.md §2).
 * Pure function of the view — identical input always yields identical text.
 */
export function formatInventoryText(view: DebugInventoryView): string {
  const lines: string[] = [];
  const label = (name: string): string => `${name}:`.padEnd(LABEL_WIDTH);

  lines.push('== Cosmic Atlas debug inventory ==');

  const backend = view.backend;
  if (backend !== null) {
    lines.push(`${label('backend api')}${backend.api}`);
    lines.push(`${label('adapter')}${backend.adapterName}`);
    lines.push(`${label('max texture size')}${backend.maxTextureSize}px`);
    lines.push(`${label('float render targets')}${boolLabel(backend.floatRenderTargets)}`);
    lines.push(`${label('timestamp query')}${boolLabel(backend.timestampQuery)}`);
    lines.push(`${label('storage buffers')}${boolLabel(backend.storageBuffers)}`);
    lines.push(`${label('device pixel ratio')}${formatFixed(backend.devicePixelRatio, 2)}`);
    lines.push(
      `${label('gpu frame time')}${
        view.gpuFrameMs === null
          ? 'unavailable (no resolved window)'
          : `${formatFixed(view.gpuFrameMs, 2)} ms (window mean)`
      }`
    );
  } else {
    lines.push(`${label('backend')}none (not initialized)`);
  }

  lines.push(`${label('renderer generation')}${view.rendererGeneration}`);
  lines.push(`${label('active destination')}${view.activeDestinationId ?? 'none'}`);
  lines.push(`${label('pending prepares')}${view.pendingPrepares}`);

  if (view.governor !== null) {
    lines.push(`${label('governor tier')}${view.governor.tier}`);
    lines.push(`${label('governor render scale')}${formatFixed(view.governor.renderScale, 3)}`);
    lines.push(`${label('governor activity')}${view.governor.activityMode}`);
  } else {
    lines.push(`${label('governor')}not initialized`);
  }

  lines.push('');
  lines.push('-- resources --');
  if (!view.resourceInventoryAvailable) {
    lines.push(
      view.resourceInventoryError !== null
        ? `unavailable (${view.resourceInventoryError})`
        : 'unavailable (ResourceManager not initialized)'
    );
  } else {
    lines.push(`${label('live scopes')}${view.liveScopeCount}`);
    lines.push(`${label('disposed scopes')}${view.disposedScopeCount}`);
    lines.push(`${label('estimated GPU memory')}${formatBytes(view.totalEstimatedGpuBytes)}`);
    const c = view.totalResourceCounts;
    lines.push(
      `${label('totals')}tex=${c.texture} cube=${c.cubeTexture} vol=${c.volumeTexture}` +
        ` buf=${c.buffer} sbuf=${c.storageBuffer} geo=${c.geometry} rt=${c.renderTarget}` +
        ` mat=${c.material} workers=${c.worker} listeners=${c.listener} timers=${c.timer}` +
        ` fetch=${c.pendingFetch}`
    );
    for (const scope of view.resourceScopes) {
      lines.push(formatScopeLine(scope));
    }
  }

  return lines.join('\n');
}
