/**
 * Benchmark regression comparator (benchmark-harness-integrity 5.3-5.5/B-07).
 *
 * Implements docs/BENCHMARK_MATRIX.md §12: a comparison REFUSES mismatched
 * benchmark metadata unless explicitly overridden, naming every differing
 * dimension. Only comparable runs produce a percentage regression claim —
 * a percentage across incomparable runs is the exact lie this gate exists
 * to prevent.
 *
 * Comparability dimensions (§12): backend, quality/tier, preset, unit of
 * work (scene/label), internal resolution, browser, adapter, sample count,
 * schema version.
 *
 * Usage:
 *   node scripts/compare-benchmarks.mjs <baseline.json> <candidate.json> [--override]
 */

import { readFileSync } from 'node:fs';

const DIMENSIONS = [
  'schemaVersion',
  'backend',
  'quality',
  'preset',
  'unitOfWork',
  'internalResolution',
  'browser',
  'adapter',
  'sampleCount'
];

function dim(record, name) {
  switch (name) {
    case 'schemaVersion':
      return String(record.schemaVersion ?? 1);
    case 'backend':
      return String(record.backend ?? record.backendApi ?? '?');
    case 'quality':
      return String(record.quality ?? record.requestedQuality ?? '?');
    case 'preset':
      return String(record.preset ?? record.scene ?? '?');
    case 'unitOfWork':
      return String(record.scene ?? record.label ?? '?');
    case 'internalResolution':
      return JSON.stringify(record.internal ?? record.effectiveRenderSize ?? null);
    case 'browser':
      return String(record.browser ?? '?');
    case 'adapter':
      return String(record.adapter ?? '?');
    case 'sampleCount':
      return String(record.samples ?? record.frameCpuMs?.samples ?? '?');
    default:
      return '?';
  }
}

export function compareRecords(baseline, candidate, override = false) {
  const differing = [];
  for (const name of DIMENSIONS) {
    const a = dim(baseline, name);
    const b = dim(candidate, name);
    if (a !== b) differing.push({ dimension: name, baseline: a, candidate: b });
  }
  if (differing.length > 0 && !override) {
    return {
      status: 'refused',
      differing,
      message: `records are NOT comparable — differing dimensions: ${differing
        .map((d) => `${d.dimension} (${d.baseline} -> ${d.candidate})`)
        .join(', ')}`
    };
  }
  const a = baseline.medianMs ?? baseline.frameCpuMs?.median ?? null;
  const b = candidate.medianMs ?? candidate.frameCpuMs?.median ?? null;
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0) {
    return {
      status: 'refused',
      differing,
      message: 'records carry no comparable median to regress against'
    };
  }
  const deltaPct = ((b - a) / a) * 100;
  return {
    status: override && differing.length > 0 ? 'overridden' : 'comparable',
    differing,
    overrideNote:
      override && differing.length > 0
        ? `comparability was OVERRIDDEN; differing dimensions: ${differing
            .map((d) => d.dimension)
            .join(', ')}`
        : null,
    baselineMedianMs: a,
    candidateMedianMs: b,
    deltaPct
  };
}

// CLI entry (5.8: documented command surface — package script bench:compare).
const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('compare-benchmarks.mjs');
if (isMain) {
  const [baselinePath, candidatePath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const override = process.argv.includes('--override');
  if (baselinePath === undefined || candidatePath === undefined) {
    console.error(
      'usage: node scripts/compare-benchmarks.mjs <baseline.json> <candidate.json> [--override]'
    );
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
  const result = compareRecords(baseline, candidate, override);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'refused') process.exitCode = 1;
}
