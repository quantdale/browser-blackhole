/**
 * Scope registry plus bounded shared LRU cache for Cosmic Atlas.
 *
 * Exposed to destinations as `HostServices.resources` (see
 * `src/atlas/types.ts`). Implements the resource-management half of:
 * - docs/cosmic-atlas/ARCHITECTURE.md §5 "Resource scopes" — every destination
 *   gets a scope; repeated navigation must not grow memory outside bounded
 *   caches.
 * - docs/cosmic-atlas/ARCHITECTURE.md §12 "Cache policy" — bounded shared
 *   caches whose size is observable and evictable (LRU by byte budget).
 * - docs/cosmic-atlas/WORK_PACKETS.md CA0-04 — ResourceScope + manager with
 *   "every class disposes" semantics.
 */

import {
  RESOURCE_COUNTER_KEYS,
  ResourceScope,
  createEmptyCounters,
} from '../renderer/shared/ResourceScope';
import type {
  ResourceScope as ResourceScopeContract,
  ResourceScopeCounters,
} from './types';

/** Default shared-cache byte budget: 256 MB. */
const DEFAULT_CACHE_BUDGET_BYTES = 256 * 1024 * 1024;

/** Aggregated inventory across every live scope plus the shared cache. */
export interface ResourceManagerTotals extends ResourceScopeCounters {
  /** Number of live (non-disposed) scopes registered with this manager. */
  scopeCount: number;
  /** Entries currently held by the shared LRU cache. */
  cacheEntryCount: number;
  /** Estimated bytes currently held by the shared LRU cache. */
  cacheEstimatedBytes: number;
  /** `estimatedGpuBytes` (scopes) + `cacheEstimatedBytes`. */
  totalEstimatedBytes: number;
}

/** Per-scope snapshot row for the debug inventory UI (CA0-09). */
export interface ScopeInventory {
  name: string;
  snapshot: ResourceScopeCounters;
}

interface CacheRecord {
  readonly key: string;
  readonly entry: unknown;
  readonly bytes: number;
  readonly disposer: (() => void) | null;
}

/**
 * Owns destination `ResourceScope`s and one bounded shared cache.
 *
 * Cache semantics:
 * - `Map` insertion order doubles as LRU order: `get()` re-inserts the record
 *   at the most-recently-used end; eviction removes from the least-recently
 *   -used front.
 * - `put()` on an existing key disposes and replaces the old record, then
 *   inserts fresh at the MRU end.
 * - Eviction runs until the total is within budget; the single most recent
 *   entry is always retained even when it alone exceeds the budget, so an
 *   oversized asset stays usable instead of thrashing.
 * - Disposer errors never abort bookkeeping: bytes are decremented before the
 *   disposer runs, and `put()`/`disposeAll()` throw an aggregated error only
 *   after all accounting is consistent.
 *
 * Manager semantics:
 * - `disposeAll()` disposes every live scope, then flushes the cache in
 *   reverse LRU order. It is idempotent; afterwards `createScope`/`put` throw
 *   and `get` returns `undefined` (the cache is empty).
 */
export class ResourceManager {
  /** Configured shared-cache byte budget. */
  readonly budgetBytes: number;

  private scopes: ResourceScopeContract[] = [];
  private readonly cache = new Map<string, CacheRecord>();
  private cacheBytes = 0;
  private disposedState = false;

  constructor(byteBudget: number = DEFAULT_CACHE_BUDGET_BYTES) {
    if (!(byteBudget > 0)) {
      throw new Error(
        `ResourceManager: byteBudget must be a positive finite number, got ${byteBudget}.`,
      );
    }
    this.budgetBytes = byteBudget;
  }

  get disposed(): boolean {
    return this.disposedState;
  }

  createScope(name: string): ResourceScopeContract {
    if (this.disposedState) {
      throw new Error('ResourceManager: cannot createScope after disposeAll().');
    }
    const scope = new ResourceScope(name);
    this.scopes.push(scope);
    return scope;
  }

  /**
   * Insert or replace a shared cache entry. `bytes` is the estimated cost of
   * the entry against the budget; negative estimates are clamped to zero.
   */
  put(key: string, entry: unknown, bytes: number, disposer: (() => void) | null): void {
    if (this.disposedState) {
      throw new Error(`ResourceManager: cannot put "${key}" after disposeAll().`);
    }
    const errors: unknown[] = [];

    const existing = this.cache.get(key);
    if (existing) {
      // Replace: drop old record first so accounting never double-counts.
      this.cache.delete(key);
      this.cacheBytes -= existing.bytes;
      try {
        existing.disposer?.();
      } catch (error) {
        errors.push(error);
      }
    }

    const record: CacheRecord = {
      key,
      entry,
      bytes: Math.max(0, bytes),
      disposer,
    };
    this.cache.set(key, record);
    this.cacheBytes += record.bytes;

    this.evictToBudget(errors);

    if (errors.length > 0) {
      const messages = errors.map(describeError);
      throw new Error(
        `ResourceManager: ${errors.length} cache disposer(s) threw while inserting "${key}": ${messages.join('; ')}`,
      );
    }
  }

  /** Most-recently-used lookup; returns `undefined` on a miss. */
  get(key: string): unknown {
    const record = this.cache.get(key);
    if (!record) {
      return undefined;
    }
    // Refresh recency: re-insert at the MRU end of Map iteration order.
    this.cache.delete(key);
    this.cache.set(key, record);
    return record.entry;
  }

  /**
   * Aggregate counters across every live scope (including their child scopes,
   * via `ResourceScope.snapshot()`) plus the shared cache. Disposed scopes are
   * pruned from the registry here so the manager itself stays bounded across
   * repeated navigation (ARCHITECTURE §5).
   */
  totals(): ResourceManagerTotals {
    this.pruneDisposedScopes();

    const totals: ResourceManagerTotals = {
      ...createEmptyCounters(),
      scopeCount: this.scopes.length,
      cacheEntryCount: this.cache.size,
      cacheEstimatedBytes: this.cacheBytes,
      totalEstimatedBytes: 0,
    };
    for (const scope of this.scopes) {
      const snapshot = scope.snapshot();
      for (const key of RESOURCE_COUNTER_KEYS) {
        totals[key] += snapshot[key];
      }
    }
    totals.totalEstimatedBytes = totals.estimatedGpuBytes + totals.cacheEstimatedBytes;
    return totals;
  }

  /** Per-scope snapshots for the debug inventory UI (live scopes only). */
  debugInventory(): ScopeInventory[] {
    this.pruneDisposedScopes();
    return this.scopes.map((scope) => ({
      name: scope.name,
      snapshot: scope.snapshot(),
    }));
  }

  /** Dispose every scope, then flush the shared cache. Idempotent. */
  disposeAll(): void {
    if (this.disposedState) {
      return;
    }
    this.disposedState = true;

    const errors: unknown[] = [];

    // Destination-local resources first, most recently created scope first.
    const scopes = this.scopes;
    this.scopes = [];
    for (let i = scopes.length - 1; i >= 0; i--) {
      try {
        scopes[i].disposeAll();
      } catch (error) {
        errors.push(error);
      }
    }

    // Shared cache in reverse LRU order (most recent first).
    const keys = [...this.cache.keys()];
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];
      const record = this.cache.get(key);
      this.cache.delete(key);
      if (!record) {
        continue;
      }
      this.cacheBytes -= record.bytes;
      try {
        record.disposer?.();
      } catch (error) {
        errors.push(error);
      }
    }
    this.cacheBytes = 0;

    if (errors.length > 0) {
      const messages = errors.map(describeError);
      throw new Error(
        `ResourceManager.disposeAll: ${errors.length} disposer(s) threw: ${messages.join('; ')}`,
      );
    }
  }

  /**
   * Evict least-recently-used entries until within budget. The most recent
   * entry is always kept, even when it alone exceeds the budget.
   */
  private evictToBudget(errors: unknown[]): void {
    while (this.cacheBytes > this.budgetBytes && this.cache.size > 1) {
      const oldestKey = this.cache.keys().next();
      if (oldestKey.done) {
        break;
      }
      const record = this.cache.get(oldestKey.value);
      this.cache.delete(oldestKey.value);
      if (!record) {
        continue;
      }
      this.cacheBytes -= record.bytes;
      try {
        record.disposer?.();
      } catch (error) {
        errors.push(error);
      }
    }
  }

  private pruneDisposedScopes(): void {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].disposed) {
        this.scopes.splice(i, 1);
      }
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
