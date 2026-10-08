/**
 * CA8-10 — Browser loader for the Black-Hole Merger runtime asset.
 *
 * Contract (docs/cosmic-atlas/DATA_PIPELINE.md §10/§11):
 * - lazy: called only from the destination module's prepare();
 * - cancellable: honors `AbortSignal` at every await checkpoint;
 * - stale-safe: the CALLER's generation check decides commit; this loader
 *   additionally throws on abort so a superseded prepare never decodes;
 * - fail-closed: manifest shape, byte length, checksum, finiteness and
 *   channel validation all pass BEFORE anything is cached/activated;
 * - bounded memory: decoded datasets live in a 2-entry cache
 *   (`cacheDataset`), raw ArrayBuffers are not retained after decode.
 *
 * No streaming/phased loading: the reduced asset is ~74 KB; measuring first
 * says splitting it buys nothing (DATA_PIPELINE §11 "do not over-engineer").
 */

import { BbmLoadError, cacheDataset, decodeBbm1, type BbmDataset } from './dataset.js';
import { readBodyWithProgress } from '../shared/assetTransfer.js';

export interface BbmManifestRuntime {
  readonly encoding: string;
  readonly schemaVersion: number;
  readonly filename: string;
  readonly samples: number;
  readonly bytes: number;
  readonly checksumSha256: string;
}

interface BbmManifestShape {
  readonly schemaVersion: number;
  readonly id: string;
  readonly phenomenon: string;
  readonly runtime: BbmManifestRuntime;
}

function isBbmManifest(value: unknown): value is BbmManifestShape {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const runtime = v['runtime'];
  if (v['schemaVersion'] !== 1) return false;
  if (typeof v['id'] !== 'string' || typeof v['phenomenon'] !== 'string') return false;
  if (runtime === null || typeof runtime !== 'object') return false;
  const r = runtime as Record<string, unknown>;
  return (
    r['encoding'] === 'bbm1' &&
    r['schemaVersion'] === 1 &&
    typeof r['filename'] === 'string' &&
    typeof r['samples'] === 'number' &&
    typeof r['bytes'] === 'number' &&
    typeof r['checksumSha256'] === 'string' &&
    /^[0-9a-f]{64}$/.test(r['checksumSha256'])
  );
}

/**
 * Reports preparation progress for the BBM transfer. Mapped onto the module's
 * `reportProgress` channel so the atlas stall gate sees real network events
 * (response headers, increasing received bytes) rather than a single
 * indeterminate await.
 */
export type BbmProgressCallback = (fraction01: number, label: string) => void;

export interface LoadBbmOptions {
  readonly signal?: AbortSignal | null;
  /** Override for tests/tools; defaults to the same-origin static root. */
  readonly baseUrl?: string;
  /** Optional byte-level progress reporter (atlas-error-reporting stall gate). */
  readonly onProgress?: BbmProgressCallback | null;
}

/** Load, validate and cache one dataset. Throws `BbmLoadError` fail-closed. */
export async function loadBbmDataset(
  assetId: string,
  options: LoadBbmOptions = {}
): Promise<BbmDataset> {
  const base = options.baseUrl ?? '/data/black-hole-merger';
  const signal = options.signal ?? null;
  const report = options.onProgress ?? null;

  const manifestUrl = `${base}/manifest.json`;
  const manifestResponse = await fetch(manifestUrl, { signal });
  if (!manifestResponse.ok) {
    throw new BbmLoadError('bad-magic', `manifest fetch failed: ${manifestResponse.status}`);
  }
  // Response headers arrived: this alone is a progress event.
  report?.(0.1, 'Reading dataset manifest');
  const manifestJson: unknown = await manifestResponse.json();
  if (!isBbmManifest(manifestJson)) {
    throw new BbmLoadError('bad-schema-version', 'manifest failed structural validation');
  }
  if (manifestJson.id !== assetId || manifestJson.phenomenon !== 'black-hole-merger') {
    throw new BbmLoadError(
      'bad-asset-id',
      `manifest is for '${manifestJson.id}' ('${manifestJson.phenomenon}')`
    );
  }

  const binUrl = `${base}/${manifestJson.runtime.filename}`;
  const binResponse = await fetch(binUrl, { signal });
  if (!binResponse.ok) {
    throw new BbmLoadError('bad-byte-length', `asset fetch failed: ${binResponse.status}`);
  }
  report?.(0.2, 'Downloading waveform dataset');
  const buffer = await readBodyWithProgress(
    binResponse,
    report === null
      ? null
      : (received, total) => {
          const denominator = total ?? manifestJson.runtime.bytes;
          const share =
            denominator > 0 ? Math.min(1, received / denominator) : Math.min(1, received / 1e6);
          report(0.2 + 0.55 * share, `Downloading waveform ${(received / 1024).toFixed(0)} KiB`);
        },
    manifestJson.runtime.bytes
  );
  report?.(0.8, 'Verifying dataset integrity');

  // Decode enforces byte length + embedded id + SHA-256 + channel sanity.
  const dataset = decodeBbm1(buffer, manifestJson.id, manifestJson.runtime.checksumSha256);
  if (dataset.sampleCount !== manifestJson.runtime.samples) {
    throw new BbmLoadError('bad-sample-count', 'manifest/binary sample mismatch');
  }
  cacheDataset(dataset);
  return dataset;
}
