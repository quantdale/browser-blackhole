/**
 * CA9-10 — Browser loader for the Galaxy Collision runtime asset (GC1).
 *
 * Mirrors the CA8 black-hole-merger loader contract: lazy, cancellable,
 * stale-safe, and fail-closed. The manifest is validated structurally, the
 * binary byte length + SHA-256 are checked against the manifest BEFORE the
 * dataset is exposed, and decoded counts must match the manifest.
 *
 * No streaming/phased loading: the reduced asset is a few MB; measuring first
 * says splitting it buys nothing.
 */

import { decodeGc1, Gc1LoadError, type Gc1Dataset } from './dataset.js';
import { readBodyWithProgress } from '../shared/assetTransfer.js';
import { isUnsafeAssetPath } from '../black-hole/lut/discovery.js';

export interface Gc1ManifestRuntime {
  readonly encoding: string;
  readonly schemaVersion: number;
  readonly filename: string;
  readonly tracerCount: number;
  readonly keyframeCount: number;
  readonly bytes: number;
  readonly checksumSha256: string;
}

interface Gc1ManifestShape {
  readonly schemaVersion: number;
  readonly id: string;
  readonly phenomenon: string;
  readonly runtime: Gc1ManifestRuntime;
}

function isGc1Manifest(value: unknown): value is Gc1ManifestShape {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const runtime = v['runtime'];
  if (v['schemaVersion'] !== 1) return false;
  if (typeof v['id'] !== 'string' || typeof v['phenomenon'] !== 'string') return false;
  if (runtime === null || typeof runtime !== 'object') return false;
  const r = runtime as Record<string, unknown>;
  return (
    r['encoding'] === 'gc1' &&
    r['schemaVersion'] === 1 &&
    typeof r['filename'] === 'string' &&
    // V-16/5.8: manifest-controlled asset names must never escape the asset
    // directory — the same rule the LUT validator enforces.
    !isUnsafeAssetPath(r['filename']) &&
    typeof r['tracerCount'] === 'number' &&
    typeof r['keyframeCount'] === 'number' &&
    typeof r['bytes'] === 'number' &&
    /^[0-9a-f]{64}$/.test(String(r['checksumSha256']))
  );
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  return hex;
}

/**
 * Reports preparation progress for the GC1 transfer. Mapped onto the module's
 * `reportProgress` channel so the atlas stall gate sees real network events
 * (response headers, increasing received bytes) rather than a single
 * indeterminate await.
 */
export type Gc1ProgressCallback = (fraction01: number, label: string) => void;

// ---------------------------------------------------------------------------
// Bounded decoded-dataset cache (R-12; mirrors the black-hole-merger loader's
// CA8-19 rules: LRU by insertion, MAX_CACHED_DATASETS entries).
// ---------------------------------------------------------------------------

const MAX_CACHED_DATASETS = 2;
const datasetCache = new Map<string, Gc1Dataset>();

/**
 * Insert a FULLY VALIDATED, decoded dataset (R-12/8.3), keyed by the asset id
 * the load was requested for. Called only after decodeGc1's fail-closed
 * byte-length and SHA-256 checks and the manifest count checks have all
 * passed, so eviction can never expose a partially validated asset — a failed
 * load throws before reaching this point.
 */
export function cacheDataset(assetId: string, dataset: Gc1Dataset): void {
  datasetCache.delete(assetId);
  datasetCache.set(assetId, dataset);
  while (datasetCache.size > MAX_CACHED_DATASETS) {
    const oldest = datasetCache.keys().next().value;
    if (oldest === undefined) break;
    datasetCache.delete(oldest);
  }
}

/** Cached dataset by asset id, or null (UI/debug reads this). */
export function getCachedDataset(assetId: string): Gc1Dataset | null {
  return datasetCache.get(assetId) ?? null;
}

export function clearDatasetCache(): void {
  datasetCache.clear();
}

export interface LoadGc1Options {
  readonly signal?: AbortSignal | null;
  /** Override for tests/tools; defaults to the same-origin static root. */
  readonly baseUrl?: string;
  /** Optional byte-level progress reporter (atlas-error-reporting stall gate). */
  readonly onProgress?: Gc1ProgressCallback | null;
}

/** Load, validate (fail-closed) and decode the GC1 dataset. Throws Gc1LoadError. */
export async function loadGc1Dataset(
  assetId: string,
  options: LoadGc1Options = {}
): Promise<Gc1Dataset> {
  // R-12: a repeated arrival must not re-fetch and re-hash 4.6 MB. Cache
  // hits return the already-validated dataset without any network activity.
  const cached = datasetCache.get(assetId);
  if (cached !== undefined) {
    options.onProgress?.(1, 'Dataset cache hit');
    return cached;
  }
  const base = options.baseUrl ?? '/data/galaxy-collision';
  const signal = options.signal ?? null;
  const report = options.onProgress ?? null;

  const manifestUrl = `${base}/gc1.manifest.json`;
  const manifestResponse = await fetch(manifestUrl, { signal });
  if (!manifestResponse.ok) {
    throw new Gc1LoadError('bad-manifest', `manifest fetch failed: ${manifestResponse.status}`);
  }
  // Response headers arrived: this alone is a progress event.
  report?.(0.1, 'Reading dataset manifest');
  const manifestJson: unknown = await manifestResponse.json();
  if (!isGc1Manifest(manifestJson)) {
    throw new Gc1LoadError('bad-manifest', 'manifest failed structural validation');
  }
  if (manifestJson.id !== assetId || manifestJson.phenomenon !== 'galaxy-collision') {
    throw new Gc1LoadError(
      'bad-manifest',
      `manifest is for '${manifestJson.id}' ('${manifestJson.phenomenon}')`
    );
  }

  const binUrl = `${base}/${manifestJson.runtime.filename}`;
  const binResponse = await fetch(binUrl, { signal });
  if (!binResponse.ok) {
    throw new Gc1LoadError('bad-byte-length', `asset fetch failed: ${binResponse.status}`);
  }
  report?.(0.2, 'Downloading tracer dataset');
  // The manifest declares the exact byte length, so the transfer has a real
  // denominator even when the server omits Content-Length.
  const buffer = await readBodyWithProgress(
    binResponse,
    report === null
      ? null
      : (received, total) => {
          const denominator = total ?? manifestJson.runtime.bytes;
          const share =
            denominator > 0 ? Math.min(1, received / denominator) : Math.min(1, received / 1e6);
          report(
            0.2 + 0.55 * share,
            `Downloading tracer dataset ${(received / 1048576).toFixed(1)} MiB`
          );
        },
    manifestJson.runtime.bytes
  );
  report?.(0.8, 'Verifying dataset integrity');

  if (buffer.byteLength !== manifestJson.runtime.bytes) {
    throw new Gc1LoadError(
      'bad-byte-length',
      `asset byte length ${buffer.byteLength} != manifest ${manifestJson.runtime.bytes}`
    );
  }
  const checksum = await sha256Hex(buffer);
  if (checksum !== manifestJson.runtime.checksumSha256) {
    throw new Gc1LoadError(
      'bad-checksum',
      `asset sha256 ${checksum} != manifest ${manifestJson.runtime.checksumSha256}`
    );
  }

  const dataset = decodeGc1(buffer);
  if (
    dataset.tracerCount !== manifestJson.runtime.tracerCount ||
    dataset.keyframeCount !== manifestJson.runtime.keyframeCount
  ) {
    throw new Gc1LoadError('bad-byte-length', 'manifest/binary count mismatch');
  }
  cacheDataset(assetId, dataset);
  return dataset;
}
