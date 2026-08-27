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

export interface LoadGc1Options {
  readonly signal?: AbortSignal | null;
  /** Override for tests/tools; defaults to the same-origin static root. */
  readonly baseUrl?: string;
}

/** Load, validate (fail-closed) and decode the GC1 dataset. Throws Gc1LoadError. */
export async function loadGc1Dataset(
  assetId: string,
  options: LoadGc1Options = {}
): Promise<Gc1Dataset> {
  const base = options.baseUrl ?? '/data/galaxy-collision';
  const signal = options.signal ?? null;

  const manifestUrl = `${base}/gc1.manifest.json`;
  const manifestResponse = await fetch(manifestUrl, { signal });
  if (!manifestResponse.ok) {
    throw new Gc1LoadError('bad-manifest', `manifest fetch failed: ${manifestResponse.status}`);
  }
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
  const buffer = await binResponse.arrayBuffer();

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
  return dataset;
}
