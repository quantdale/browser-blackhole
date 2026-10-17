/**
 * Type declarations for the benchmark comparator (the CLI consumes the
 * plain-JS module at runtime; the tests type it here).
 */

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

export declare function compareRecords(
  baseline: unknown,
  candidate: unknown,
  override?: boolean
): CompareResult;
