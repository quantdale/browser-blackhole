/**
 * Final Cinematic Visual Fidelity benchmark matrix.
 *
 * This is an orchestration layer over the destination-specific benchmark
 * harnesses. It pins one commit, Edge, 1280x800 CSS pixels, a short warm-up,
 * a bounded sample window, one deterministic phase per workload, and an
 * explicitly requested renderer backend. Each child still reports its own
 * renderer/resource/timing schema; this script only gathers those records
 * into one ignored artifact for the campaign certification.
 *
 * Defaults:
 *   MATRIX_BACKENDS=webgpu
 *   MATRIX_TIERS=low,medium,high,ultra
 *   MATRIX_FRAMES=60 (the child harnesses enforce their own minimum)
 *   MATRIX_WARMUP_MS=1000
 *
 * For the compatibility/performance companion:
 *   MATRIX_BACKENDS=webgl2 MATRIX_TIERS=low,high npm run bench:cinematic-matrix
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const commit = process.env.BENCH_COMMIT ?? readCommit();
const backends = csv(process.env.MATRIX_BACKENDS ?? 'webgpu');
const tiers = csv(process.env.MATRIX_TIERS ?? 'low,medium,high,ultra');
const frames = Math.max(60, numberEnv('MATRIX_FRAMES', 60));
const warmupMs = Math.max(0, numberEnv('MATRIX_WARMUP_MS', 1000));
const channel = process.env.MATRIX_CHANNEL ?? 'msedge';
const width = Math.max(320, numberEnv('MATRIX_WIDTH', 1280));
const height = Math.max(240, numberEnv('MATRIX_HEIGHT', 800));
const outputRoot = resolve(
  process.env.MATRIX_OUTPUT ??
    resolve(root, 'artifacts', 'cinematic-visual-fidelity', `benchmark-${commit}`)
);

const validBackends = new Set(['webgpu', 'webgl2']);
const validTiers = new Set(['low', 'medium', 'high', 'ultra']);
if (backends.length === 0 || backends.some((backend) => !validBackends.has(backend))) {
  throw new Error('MATRIX_BACKENDS must contain webgpu and/or webgl2');
}
if (tiers.length === 0 || tiers.some((tier) => !validTiers.has(tier))) {
  throw new Error('MATRIX_TIERS must contain low, medium, high and/or ultra');
}

/** Workloads cover every production destination plus both flagship paths. */
const workloads = [
  { id: 'black-hole', script: 'bench-black-hole.mjs', args: ['--preset=default'] },
  {
    id: 'black-hole-kerr',
    script: 'bench-kerr.mjs',
    args: ['--preset=kerr-high-prograde', '--spin=0.9']
  },
  { id: 'neutron-star', script: 'bench-neutron-star.mjs', args: ['--preset=surface'] },
  {
    id: 'stellar-explosion',
    script: 'bench-stellar-explosion.mjs',
    args: ['--preset=core-collapse', '--phase=0.55']
  },
  {
    id: 'compact-merger',
    script: 'bench-compact-merger.mjs',
    args: ['--preset=equal-mass-nsns', '--phase=0.7']
  },
  {
    id: 'tidal-disruption',
    script: 'bench-tidal-disruption.mjs',
    args: ['--preset=solar-canonical', '--phase=0.78']
  },
  {
    id: 'quasar-agn-inner',
    script: 'bench-quasar-agn.mjs',
    args: ['--preset=quasar-reference', '--zone=inner']
  },
  {
    id: 'quasar-agn-galactic',
    script: 'bench-quasar-agn.mjs',
    args: ['--preset=radio-galaxy', '--zone=galactic']
  },
  {
    id: 'black-hole-merger',
    script: 'bench-black-hole-merger.mjs',
    args: ['--preset=sxs-bbh-0001-inspiral', '--phase=inspiral']
  },
  {
    id: 'galaxy-collision',
    script: 'bench-galaxy-collision.mjs',
    args: ['--preset=bridge-tail', '--phase=0.5']
  }
];

const records = [];
const failures = [];
let port = 4700;

for (const backend of backends) {
  for (const tier of tiers) {
    for (const workload of workloads) {
      const scriptPath = resolve(root, 'scripts', workload.script);
      if (!existsSync(scriptPath)) {
        failures.push({ backend, tier, workload: workload.id, error: `missing ${scriptPath}` });
        continue;
      }
      const args = [
        scriptPath,
        ...workload.args,
        `--quality=${tier}`,
        `--frames=${frames}`,
        `--channel=${channel}`,
        `--width=${width}`,
        `--height=${height}`,
        `--force-backend=${backend}`,
        `--label=cinematic-${backend}-${tier}-${workload.id}`,
        `--port=${port++}`
      ];
      // The BBH harness persists its own raw record. Route that write into the
      // ignored artifact root rather than the repository's historical results.
      if (workload.script === 'bench-black-hole-merger.mjs') {
        args.push(`--outdir=../../artifacts/cinematic-visual-fidelity/benchmark-${commit}`);
      }
      if (usesWarmupMs(workload.script)) args.push(`--warmupMs=${warmupMs}`);
      else args.push(`--warmup-ms=${warmupMs}`);

      console.log(`MATRIX ${backend} ${tier} ${workload.id}`);
      try {
        const output = execFileSync(process.execPath, args, {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, BENCH_COMMIT: commit },
          maxBuffer: 32 * 1024 * 1024
        });
        const record = parseRecord(output);
        if (record === null) {
          failures.push({
            backend,
            tier,
            workload: workload.id,
            error: 'child emitted no JSON record',
            output: output.slice(-2000)
          });
          continue;
        }
        const normalized = normalizeRecord(record);
        const backendString = normalized.backend;
        const tierString = normalized.tier;
        if (backendString !== backend) {
          failures.push({
            backend,
            tier,
            workload: workload.id,
            error: `effective backend ${String(normalized.backend)}`
          });
        }
        if (tierString !== null && tierString !== tier) {
          failures.push({
            backend,
            tier,
            workload: workload.id,
            error: `effective tier ${tierString}`
          });
        }
        if (normalized.consoleErrors !== 0) {
          failures.push({
            backend,
            tier,
            workload: workload.id,
            error: `consoleErrors=${normalized.consoleErrors}`
          });
        }
        records.push({
          matrix: { workload: workload.id, requestedBackend: backend, requestedTier: tier },
          normalized,
          record
        });
      } catch (error) {
        failures.push({
          backend,
          tier,
          workload: workload.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}

mkdirSync(outputRoot, { recursive: true });
const manifest = {
  schemaVersion: 1,
  kind: 'cinematic-visual-fidelity-benchmark-matrix',
  commit,
  capturedAt: new Date().toISOString(),
  node: process.version,
  os: `${os.type()} ${os.release()} (${process.platform})`,
  browserChannel: channel,
  viewportCss: [width, height],
  requestedBackends: backends,
  requestedTiers: tiers,
  frames,
  warmupMs,
  workloads: workloads.map((workload) => workload.id),
  records,
  failures
};
writeFileSync(resolve(outputRoot, 'matrix.json'), JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify(
    {
      outputRoot,
      commit,
      requestedRuns: backends.length * tiers.length * workloads.length,
      records: records.length,
      failures: failures.length
    },
    null,
    2
  )
);

if (failures.length > 0) {
  console.error(JSON.stringify({ failures }, null, 2));
  process.exitCode = 1;
}

function csv(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function readCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
}

function usesWarmupMs(script) {
  return script === 'bench-stellar-explosion.mjs' || script === 'bench-galaxy-collision.mjs';
}

function normalizeRecord(record) {
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
    renderTelemetry: record.renderTelemetry ?? null,
    rendererInfo: record.rendererInfo ?? null,
    consoleErrors: Number(record.consoleErrors ?? 0)
  };
}

/** Extract the last balanced JSON object containing a benchmark identity key. */
function parseRecord(output) {
  const candidates = [];
  for (let start = 0; start < output.length; start += 1) {
    if (output[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < output.length; index += 1) {
      const char = output[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') {
        quoted = true;
        continue;
      }
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const candidate = JSON.parse(output.slice(start, index + 1));
            if (candidate && typeof candidate === 'object') candidates.push(candidate);
          } catch {
            // A nested object or log fragment; continue scanning candidates.
          }
          break;
        }
      }
    }
  }
  return (
    candidates
      .reverse()
      .find((candidate) =>
        ['commit', 'destination', 'scene', 'preset', 'backend'].some((key) => key in candidate)
      ) ?? null
  );
}
