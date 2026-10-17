/**
 * Ambient declarations for the plain-JS benchmark helpers (TS7016 guard).
 *
 * The tooling's module resolvers disagree about which declaration file pairs
 * with an `.mjs` specifier (tsc resolves `compare-benchmarks.d.mts`; the
 * language server does not). These wildcard declarations satisfy every
 * resolver without duplicating the module or converting the runtime scripts
 * (they must stay plain JS — the harnesses execute them under bare node).
 */

declare module '*/compare-benchmarks.mjs' {
  export interface CompareDimensionDifference {
    dimension: string;
    baseline: string;
    candidate: string;
  }
  export interface CompareResult {
    status: 'refused' | 'comparable' | 'overridden';
    differing: CompareDimensionDifference[];
    message?: string;
    overrideNote?: string | null;
    baselineMedianMs?: number;
    candidateMedianMs?: number;
    deltaPct?: number;
  }
  export function compareRecords(
    baseline: unknown,
    candidate: unknown,
    override?: boolean
  ): CompareResult;
}

declare module '*/lib/bench-records.mjs' {
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
  export function accumulateRefusal(record: BenchRefusalRecord, reason: string): BenchRefusalRecord;
  export function normalizeRecord(record: unknown): NormalizedBenchRecord;
}
