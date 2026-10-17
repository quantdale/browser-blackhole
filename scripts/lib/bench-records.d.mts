/**
 * Type declarations for the pure benchmark-record helpers (the harnesses
 * consume the plain-JS module at runtime; the tests type it here).
 */

export interface BenchRefusalRecord {
  refusal: string | null;
  refusals?: string[];
}

export interface NormalizedBenchRecord {
  backend: string | null;
  tier: string | null;
  internal: unknown;
  cpuMedian: number | null;
  gpuMs: number | null;
  estimatedGpuBytes: number | null;
  consoleErrors: number;
}

export declare function accumulateRefusal(
  record: BenchRefusalRecord,
  reason: string
): BenchRefusalRecord;

export declare function normalizeRecord(record: unknown): NormalizedBenchRecord;
