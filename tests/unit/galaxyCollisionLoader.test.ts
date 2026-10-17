/**
 * shared-renderer-service-lifecycle R-12 (tasks 8.1-8.3) — GC1 dataset cache.
 *
 * Every arrival used to re-fetch and re-hash the 4.6 MB GC1 artifact. The
 * loader now keeps a bounded cache (mirroring the black-hole-merger CA8-19
 * rules). These rows pin the three contracts:
 *
 * 8.2 — a second load of the same asset issues NO network request;
 * 8.3 — eviction cannot expose a partially validated asset: a load that
 *       fails its fail-closed checks must never populate the cache.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cacheDataset,
  clearDatasetCache,
  getCachedDataset,
  loadGc1Dataset
} from '../../src/phenomena/galaxy-collision/loader.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BIN_PATH = join(REPO_ROOT, 'public', 'data', 'galaxy-collision', 'gc1.bin');
const MANIFEST_PATH = join(REPO_ROOT, 'public', 'data', 'galaxy-collision', 'gc1.manifest.json');

const MANIFEST_JSON = readFileSync(MANIFEST_PATH, 'utf8');
const MANIFEST = JSON.parse(MANIFEST_JSON) as { id: string; runtime: Record<string, unknown> };
const ASSET_ID = MANIFEST.id;
const BIN_BYTES = readFileSync(BIN_PATH);

interface FetchCounter {
  manifest: number;
  bin: number;
}

function stubFetchManifest(count: FetchCounter, manifest: Record<string, unknown>): void {
  const manifestJson = JSON.stringify(manifest);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('gc1.manifest.json')) {
        count.manifest += 1;
        return new Response(manifestJson, {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      count.bin += 1;
      return new Response(new Uint8Array(0), { status: 200 });
    })
  );
}

function stubFetch(count: FetchCounter, binBytes: Buffer = BIN_BYTES): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('gc1.manifest.json')) {
        count.manifest += 1;
        return new Response(MANIFEST_JSON, {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.includes('gc1.bin')) {
        count.bin += 1;
        return new Response(new Uint8Array(binBytes), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' }
        });
      }
      throw new Error(`unexpected fetch in loader-cache test: ${url}`);
    })
  );
}

beforeEach(() => {
  clearDatasetCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearDatasetCache();
});

describe('GC1 loader dataset cache (R-12)', () => {
  it('the second load of the same asset issues no request (8.2)', async () => {
    const count: FetchCounter = { manifest: 0, bin: 0 };
    stubFetch(count);

    const first = await loadGc1Dataset(ASSET_ID);
    expect(count).toEqual({ manifest: 1, bin: 1 });

    const second = await loadGc1Dataset(ASSET_ID);
    expect(count, 'the cache hit must not touch the network').toEqual({ manifest: 1, bin: 1 });
    expect(second).toBe(first);
    expect(getCachedDataset(ASSET_ID)).toBe(first);
  });

  it('a failed integrity check never populates the cache (8.3)', async () => {
    // Corrupt the artifact: the SHA-256 check must reject it fail-closed.
    const corrupted = Buffer.from(BIN_BYTES);
    const last = corrupted.length - 1;
    corrupted[last] = (corrupted[last] ?? 0) ^ 0xff;
    const count: FetchCounter = { manifest: 0, bin: 0 };

    stubFetch(count, corrupted);
    await expect(loadGc1Dataset(ASSET_ID)).rejects.toThrow();
    expect(getCachedDataset(ASSET_ID), 'a partially validated asset must not be cached').toBeNull();

    // A later good load still fetches (nothing was cached) and then caches.
    stubFetch(count);
    const good = await loadGc1Dataset(ASSET_ID);
    expect(count.bin, 'the failed attempt must not have short-circuited the retry').toBe(2);
    expect(getCachedDataset(ASSET_ID)).toBe(good);
  });

  it('the cache is bounded and eviction only removes whole entries', async () => {
    const count: FetchCounter = { manifest: 0, bin: 0 };
    stubFetch(count);
    await loadGc1Dataset(ASSET_ID);
    // Two more distinct keys push the first out (MAX_CACHED_DATASETS = 2).
    cacheDataset('other-1', await loadGc1Dataset(ASSET_ID));
    cacheDataset('other-2', await loadGc1Dataset(ASSET_ID));
    expect(getCachedDataset(ASSET_ID)).toBeNull();
    expect(getCachedDataset('other-2')).not.toBeNull();
    // Sanity: the manifest we served really is the pinned one (no fixture drift).
    expect(createHash('sha256').update(BIN_BYTES).digest('hex')).toBe(
      MANIFEST.runtime['checksumSha256']
    );
  });
});

// 5.9 (verification-gate-integrity): a manifest whose asset filename could
// escape the asset directory must be rejected with an explicit reason BEFORE
// any request is issued — the same unsafe-path rule the LUT validator
// enforces (V-16).
describe('GC1 manifest asset-path rule (5.9)', () => {
  it('rejects a traversing asset filename with no request issued', async () => {
    const base = JSON.parse(MANIFEST_JSON) as Record<string, unknown>;
    const runtime = base['runtime'] as Record<string, unknown>;
    for (const bad of ['../secrets.bin', 'a' + String.fromCharCode(92) + 'b.bin', '/etc/passwd']) {
      const count: FetchCounter = { manifest: 0, bin: 0 };
      stubFetchManifest(count, {
        ...base,
        runtime: { ...runtime, filename: bad }
      });
      await expect(loadGc1Dataset(ASSET_ID), `must reject '${bad}'`).rejects.toThrow();
      expect(count.bin, 'no asset request may be issued for a rejected path').toBe(0);
    }
  });
});
