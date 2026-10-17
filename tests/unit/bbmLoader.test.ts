/**
 * Black-hole-merger loader tests (verification-gate-integrity tasks 5.3/5.5/5.9).
 *
 * Mirrors the galaxy-collision loader rows: the SHIPPED manifest must
 * resolve and validate end-to-end through the production loader, and a
 * manifest whose asset filename could escape the asset directory must be
 * rejected with an explicit reason BEFORE any request is issued (the same
 * unsafe-path rule the LUT validator enforces — V-16).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDatasetCache,
  getCachedDataset
} from '../../src/phenomena/black-hole-merger/dataset.js';
import { loadBbmDataset } from '../../src/phenomena/black-hole-merger/loader.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA_ROOT = join(REPO_ROOT, 'public', 'data', 'black-hole-merger');

interface FetchCounter {
  manifest: number;
  bin: number;
}

function stubFetch(count: FetchCounter, manifestOverride?: Record<string, unknown>): void {
  const manifestJson = JSON.stringify(
    manifestOverride ?? JSON.parse(readFileSync(join(DATA_ROOT, 'manifest.json'), 'utf8'))
  );
  const binBytes = readFileSync(join(DATA_ROOT, 'sxs-bbh-0001-lev5-bbm1-v1.bin'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('manifest')) {
        count.manifest += 1;
        return new Response(manifestJson, {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      count.bin += 1;
      return new Response(new Uint8Array(binBytes), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      });
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

describe('black-hole-merger loader (5.3/5.9)', () => {
  it('resolves the shipped manifest and validates the artifact end-to-end', async () => {
    const count: FetchCounter = { manifest: 0, bin: 0 };
    stubFetch(count);
    const manifest = JSON.parse(readFileSync(join(DATA_ROOT, 'manifest.json'), 'utf8')) as {
      id: string;
      runtime: { checksumSha256: string };
    };
    const dataset = await loadBbmDataset(manifest.id);
    expect(dataset.assetId).toBe(manifest.id);
    // The shipped manifest's checksum really matches the shipped binary
    // (this is the resolution test the audit found missing — the tests only
    // ever decoded in-memory fixtures).
    expect(
      createHash('sha256')
        .update(readFileSync(join(DATA_ROOT, 'sxs-bbh-0001-lev5-bbm1-v1.bin')))
        .digest('hex')
    ).toBe(manifest.runtime.checksumSha256);
    expect(getCachedDataset(manifest.id)).toBe(dataset);
  });

  it('rejects a traversing asset filename with an explicit reason and no request (5.9)', async () => {
    const real = JSON.parse(readFileSync(join(DATA_ROOT, 'manifest.json'), 'utf8')) as {
      id: string;
      runtime: Record<string, unknown>;
    };
    for (const bad of ['../secrets.bin', 'a' + String.fromCharCode(92) + 'b.bin', '/etc/passwd']) {
      const count: FetchCounter = { manifest: 0, bin: 0 };
      const evil = {
        schemaVersion: 1,
        id: real['id'],
        phenomenon: 'black-hole-merger',
        runtime: { ...real.runtime, filename: bad }
      };
      stubFetch(count, evil);
      await expect(
        loadBbmDataset(String(real['id'])),
        `must reject filename '${bad}'`
      ).rejects.toThrow();
      expect(count.bin, 'no asset request may be issued for a rejected path').toBe(0);
      expect(getCachedDataset(String(real['id'])), 'rejection must not cache').toBeNull();
    }
  });
});
