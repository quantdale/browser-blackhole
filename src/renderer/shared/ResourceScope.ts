/**
 * Explicit resource ownership scopes for Cosmic Atlas.
 *
 * Implements the `ResourceScope` contract from `src/atlas/types.ts`.
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §5 "Resource scopes" — explicit ownership
 *   instead of GC dependence; required per-kind counters and estimated GPU
 *   bytes; bounded growth under repeated navigation.
 * - docs/cosmic-atlas/ARCHITECTURE.md §12 "Cache policy" — cache size must be
 *   observable and evictable (the shared LRU itself lives in
 *   `src/atlas/ResourceManager.ts`; this module provides the counter helpers).
 * - docs/cosmic-atlas/WORK_PACKETS.md CA0-04 — track textures, buffers, render
 *   targets, materials, workers, listeners, timers, fetches and estimated
 *   bytes; "every class disposes".
 */

import type {
  ResourceKind,
  ResourceScope as ResourceScopeContract,
  ResourceScopeCounters
} from '../../atlas/types';

/** Every numeric field of `ResourceScopeCounters`, including `estimatedGpuBytes`. */
export const RESOURCE_COUNTER_KEYS: ReadonlyArray<keyof ResourceScopeCounters> = [
  'texture',
  'cubeTexture',
  'volumeTexture',
  'buffer',
  'storageBuffer',
  'geometry',
  'renderTarget',
  'material',
  'worker',
  'listener',
  'timer',
  'pendingFetch',
  'estimatedGpuBytes'
];

/** Fresh zeroed counters. Shared with `ResourceManager` aggregation. */
export function createEmptyCounters(): ResourceScopeCounters {
  const counters = {} as ResourceScopeCounters;
  for (const key of RESOURCE_COUNTER_KEYS) {
    counters[key] = 0;
  }
  return counters;
}

interface TrackedResource {
  readonly kind: ResourceKind;
  readonly handle: unknown;
  readonly disposer: (() => void) | null;
  readonly estimatedBytes: number;
}

/**
 * Concrete `ResourceScope`.
 *
 * Semantics:
 * - Entries are kept in registration order; `disposeAll()` runs disposers in
 *   reverse registration order, then disposes child scopes in reverse creation
 *   order.
 * - `release(handle)` removes exactly one entry and invokes its disposer once.
 *   Releasing an unknown or already-released handle is an idempotent no-op so
 *   double-release paths cannot double-dispose GPU resources.
 * - Tracking into a disposed scope throws; creating a child of a disposed
 *   scope throws. Registering the same handle twice in one scope throws —
 *   ownership must stay unambiguous for `release` to be well-defined.
 * - `snapshot()` reports live counters for this scope plus all live descendant
 *   scopes, so aggregate accounting through `ResourceManager` cannot
 *   undercount nested sub-scopes.
 * - Disposer errors never abort a teardown pass: `disposeAll()` completes every
 *   disposal, then throws an aggregated error listing the failures.
 */
export class ResourceScope implements ResourceScopeContract {
  readonly name: string;

  private entries: TrackedResource[] = [];
  private readonly byHandle = new Map<unknown, TrackedResource>();
  private children: ResourceScope[] = [];
  private readonly parent: ResourceScope | null;
  private disposedState = false;

  constructor(name: string, parent: ResourceScope | null = null) {
    this.name = name;
    this.parent = parent;
  }

  get disposed(): boolean {
    return this.disposedState;
  }

  track(
    kind: ResourceKind,
    handle: unknown,
    disposer: (() => void) | null,
    estimatedBytes?: number
  ): void {
    if (this.disposedState) {
      throw new Error(`ResourceScope "${this.name}": cannot track ${kind} after disposal.`);
    }
    if (this.byHandle.has(handle)) {
      throw new Error(`ResourceScope "${this.name}": handle is already tracked (${kind}).`);
    }
    const entry: TrackedResource = {
      kind,
      handle,
      disposer,
      estimatedBytes: Math.max(0, estimatedBytes ?? 0)
    };
    this.entries.push(entry);
    this.byHandle.set(handle, entry);
  }

  release(handle: unknown): void {
    const entry = this.byHandle.get(handle);
    if (!entry) {
      // Unknown or already released: idempotent no-op.
      return;
    }
    this.byHandle.delete(handle);
    const index = this.entries.indexOf(entry);
    if (index !== -1) {
      this.entries.splice(index, 1);
    }
    entry.disposer?.();
  }

  disposeAll(): void {
    if (this.disposedState) {
      return;
    }
    this.disposedState = true;

    const errors: unknown[] = [];

    // Own resources: reverse registration order.
    const ownEntries = this.entries;
    this.entries = [];
    for (let i = ownEntries.length - 1; i >= 0; i--) {
      const entry = ownEntries[i];
      if (!entry) continue;
      try {
        entry.disposer?.();
      } catch (error) {
        errors.push(error);
      }
    }
    ownEntries.length = 0;
    this.byHandle.clear();

    // Child scopes: reverse creation order. The list is detached first so a
    // child's self-removal callback cannot mutate the array mid-iteration.
    const children = this.children;
    this.children = [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (!child) continue;
      try {
        child.disposeAll();
      } catch (error) {
        errors.push(error);
      }
    }

    // Detach from the parent when disposed directly, so it stops counting us.
    this.parent?.detachChild(this);

    if (errors.length > 0) {
      const messages = errors.map(describeError);
      throw new Error(
        `ResourceScope "${this.name}": ${errors.length} disposer(s) threw during disposeAll: ${messages.join('; ')}`
      );
    }
  }

  snapshot(): ResourceScopeCounters {
    const counters = createEmptyCounters();
    this.accumulateInto(counters);
    return counters;
  }

  createChild(name: string): ResourceScope {
    if (this.disposedState) {
      throw new Error(
        `ResourceScope "${this.name}": cannot create child "${name}" after disposal.`
      );
    }
    const child = new ResourceScope(name, this);
    this.children.push(child);
    return child;
  }

  /** Unlink a directly-disposed child so parent snapshots exclude it. */
  private detachChild(child: ResourceScope): void {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  /** Sum this scope's live entries and all live descendants into `counters`. */
  private accumulateInto(counters: ResourceScopeCounters): void {
    for (const entry of this.entries) {
      counters[entry.kind] += 1;
      counters.estimatedGpuBytes += entry.estimatedBytes;
    }
    for (const child of this.children) {
      child.accumulateInto(counters);
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
