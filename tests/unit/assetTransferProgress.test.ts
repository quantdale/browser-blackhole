import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadGc1Dataset } from '../../src/phenomena/galaxy-collision/loader.js';
import { loadBbmDataset } from '../../src/phenomena/black-hole-merger/loader.js';
import { readBodyWithProgress } from '../../src/phenomena/shared/assetTransfer.js';

/**
 * atlas-error-reporting — progress-event integrity for the network prepare
 * paths.
 *
 * The transition director's stall gate accepts a `reportProgress` report as a
 * PROGRESS EVENT only when the finite fraction is the first report or strictly
 * greater than the last accepted one. A module (or loader) that reports a lower
 * fraction after a download is therefore publishing a LABEL CHANGE, not
 * progress — which silently disarms the stall gate for the step that follows.
 * These rows pin the invariant at the source: every production network report
 * sequence is finite, strictly increasing, and bounded to [0, 1].
 */

interface Report {
  readonly fraction01: number;
  readonly label: string;
}

/** Collects the report sequence and asserts the invariant at the end. */
function recorder(): { reports: Report[]; report(f: number, l: string): void } {
  const reports: Report[] = [];
  return {
    reports,
    report(fraction01: number, label: string): void {
      reports.push({ fraction01, label });
    }
  };
}

function expectStrictlyIncreasing(reports: readonly Report[]): void {
  for (const r of reports) {
    expect(Number.isFinite(r.fraction01)).toBe(true);
    expect(r.fraction01).toBeGreaterThanOrEqual(0);
    expect(r.fraction01).toBeLessThanOrEqual(1);
  }
  for (let i = 1; i < reports.length; i += 1) {
    expect(
      reports[i]!.fraction01,
      `report ${i} ('${reports[i]!.label}') must exceed report ${i - 1} ('${reports[i - 1]!.label}')`
    ).toBeGreaterThan(reports[i - 1]!.fraction01);
  }
}

/** A body stream that emits `total` bytes in `chunks` pieces. */
function streamingResponse(total: number, chunks: number, contentType?: string): Response {
  const per = Math.ceil(total / chunks);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const size = Math.min(per, total - sent);
      controller.enqueue(new Uint8Array(size).fill(7));
      sent += size;
    }
  });
  return new Response(body, {
    status: 200,
    headers: contentType === undefined ? {} : { 'content-length': String(total) }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assetTransfer.readBodyWithProgress', () => {
  it('reports increasing received bytes and returns the whole body', async () => {
    const total = 64 * 1024;
    const seen: Array<{ received: number; declared: number | null }> = [];
    const buffer = await readBodyWithProgress(
      streamingResponse(total, 8, 'application/octet-stream'),
      (received, declared) => {
        seen.push({ received, declared });
      }
    );

    expect(buffer.byteLength).toBe(total);
    expect(seen.length).toBe(8);
    for (let i = 0; i < seen.length; i += 1) {
      expect(seen[i]!.received).toBeGreaterThan(i === 0 ? 0 : seen[i - 1]!.received);
      expect(seen[i]!.declared).toBe(total);
    }
    expect(seen[seen.length - 1]!.received).toBe(total);
  });

  it('falls back to the caller-supplied byte count when Content-Length is absent', async () => {
    const total = 32 * 1024;
    const seen: Array<{ received: number; declared: number | null }> = [];
    const buffer = await readBodyWithProgress(
      streamingResponse(total, 4),
      (received, declared) => {
        seen.push({ received, declared });
      },
      total
    );
    expect(buffer.byteLength).toBe(total);
    expect(seen.length).toBe(4);
    // The caller's expected total is surfaced so the reporter can build a real
    // fraction even when the server omits Content-Length.
    for (const sample of seen) expect(sample.declared).toBe(total);
    expect(seen[seen.length - 1]!.received).toBe(total);
  });

  it('does not stream when there is no progress consumer', async () => {
    const total = 4096;
    const response = streamingResponse(total, 4, 'application/octet-stream');
    const buffer = await readBodyWithProgress(response, null);
    expect(buffer.byteLength).toBe(total);
  });
});

describe('GC1 loader progress reporting', () => {
  it('emits a strictly increasing, bounded report sequence', async () => {
    const rec = recorder();
    const bytes = 40 * 1024;
    vi.stubGlobal('fetch', (url: string) => {
      if (url.endsWith('gc1.manifest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              id: 'gc1',
              phenomenon: 'galaxy-collision',
              runtime: {
                encoding: 'gc1',
                schemaVersion: 1,
                filename: 'gc1.bin',
                tracerCount: 2,
                keyframeCount: 2,
                bytes,
                checksumSha256: 'a'.repeat(64)
              }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        );
      }
      return Promise.resolve(streamingResponse(bytes, 5, 'application/octet-stream'));
    });

    // The loader is fail-closed, so the decode step rejects; the report
    // sequence up to that point is what this row pins.
    await loadGc1Dataset('gc1', { baseUrl: '/x', onProgress: rec.report }).catch(() => undefined);

    expect(rec.reports.length).toBeGreaterThan(3);
    // Headers event, download start, per-chunk byte events, verify event.
    expect(rec.reports[0]!.label).toContain('manifest');
    expect(rec.reports.some((r) => /MiB|Downloading/.test(r.label))).toBe(true);
    expectStrictlyIncreasing(rec.reports);
  });
});

describe('BBM loader progress reporting', () => {
  it('emits a strictly increasing, bounded report sequence', async () => {
    const rec = recorder();
    const bytes = 8 * 1024;
    vi.stubGlobal('fetch', (url: string) => {
      if (url.endsWith('manifest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              id: 'sxs-bbh-0001-lev5',
              phenomenon: 'black-hole-merger',
              runtime: {
                encoding: 'bbm1',
                schemaVersion: 1,
                filename: 'x.bin',
                samples: 4,
                bytes,
                checksumSha256: 'b'.repeat(64)
              }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        );
      }
      return Promise.resolve(streamingResponse(bytes, 4, 'application/octet-stream'));
    });

    await loadBbmDataset('sxs-bbh-0001-lev5', { baseUrl: '/x', onProgress: rec.report }).catch(
      () => undefined
    );

    expect(rec.reports.length).toBeGreaterThan(3);
    expect(rec.reports[0]!.label).toContain('manifest');
    expectStrictlyIncreasing(rec.reports);
  });
});
