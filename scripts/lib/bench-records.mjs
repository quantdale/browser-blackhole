/**
 * Shared benchmark-record helpers (benchmark-harness-integrity tasks 3.6/6.3).
 *
 * Pure functions extracted from the harnesses so they can be unit-tested:
 *
 * - `accumulateRefusal`: refusals ACCUMULATE — the old `record.refusal = x`
 *   assignment overwrote the first failure reason with whatever fired last
 *   (B-06), losing exactly the information a refusal exists to report.
 * - `normalizeRecord`: the matrix orchestrator's record normalisation
 *   (legacy and schema-2 shapes), tested so a shape drift fails here.
 */

/** Append a refusal reason; `record.refusal` reflects EVERY reason. */
export function accumulateRefusal(record, reason) {
  if (!Array.isArray(record.refusals)) record.refusals = [];
  record.refusals.push(String(reason));
  record.refusal = record.refusals.join('; ');
  return record;
}

/** Normalise a child benchmark record across the shapes in use. */
export function normalizeRecord(record) {
  const backend =
    typeof record.backend === 'string'
      ? record.backend
      : typeof record.backendApi === 'string'
        ? record.backendApi
        : typeof record.backend?.api === 'string'
          ? record.backend.api
          : null;
  const tier =
    typeof record.quality === 'string'
      ? record.quality
      : typeof record.quality?.effectiveTier === 'string'
        ? record.quality.effectiveTier
        : typeof record.tier === 'string'
          ? record.tier
          : typeof record.requestedQuality === 'string'
            ? record.requestedQuality
            : null;
  return {
    backend,
    tier,
    internal: record.effectiveRenderSize ?? record.internal ?? null,
    cpuMedian: record.frameCpuMs?.median ?? record.medianMs ?? null,
    gpuMs: record.frameGpuMs?.lastResolvedFrame ?? null,
    estimatedGpuBytes: record.memory?.estimatedGpuBytesTotal ?? null,
    consoleErrors: Array.isArray(record.consoleErrors) ? record.consoleErrors.length : 0
  };
}
