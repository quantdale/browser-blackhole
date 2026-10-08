/**
 * Progress-observable asset transfer shared by the network-backed phenomenon
 * loaders.
 *
 * The atlas stall gate defines a PROGRESS EVENT as one of: the prepare
 * operation settling; a `reportProgress` report whose finite fraction is the
 * first report or strictly greater than the last accepted one; receipt of
 * response headers for that operation; or an increase in received response
 * bytes. A loader that merely awaited `arrayBuffer()` would expose only the
 * headers event, so a slow multi-second body transfer would look identical to
 * a hung request and the gate would abort a healthy load. Reading the body as
 * a stream and reporting cumulative bytes makes those events observable and
 * keeps the gate honest.
 *
 * The abort signal is honoured exactly as `arrayBuffer()` honours it: an
 * aborted read rejects, which the callers already propagate fail-closed.
 */

/** Receives cumulative received bytes and the expected total (when known). */
export type BodyProgressCallback = (receivedBytes: number, totalBytes: number | null) => void;

/** Byte count of a response body, from `Content-Length` when the server sends one. */
export function contentLengthOf(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Read a response body to completion, reporting cumulative received bytes.
 *
 * Falls back to a plain `arrayBuffer()` when there is no progress consumer or
 * no readable body stream, so non-browser/edge environments keep working.
 */
export async function readBodyWithProgress(
  response: Response,
  onProgress: BodyProgressCallback | null,
  fallbackTotalBytes: number | null = null
): Promise<ArrayBuffer> {
  if (onProgress === null || response.body === null) {
    return response.arrayBuffer();
  }

  const declared = contentLengthOf(response) ?? fallbackTotalBytes;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined && value.byteLength > 0) {
      chunks.push(value);
      received += value.byteLength;
      onProgress(received, declared);
    }
  }

  if (chunks.length === 1) {
    const only = chunks[0];
    return only === undefined ? new ArrayBuffer(0) : (only.buffer as ArrayBuffer);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}
