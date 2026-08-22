/**
 * M8-04 domain/error study (BH-163 seed): measures candidate LUT domains so
 * the axis mapping, resolutions, and encoding are FROZEN FROM EVIDENCE, not
 * intuition (LUT_BACKEND_SPEC §6/§8, ADR §6).
 *
 * Methodology (the part that matters):
 * - Test columns are placed at OFF-GRID x positions (between texel centers),
 *   because that is what runtime bilinear filtering actually consumes: a
 *   lookup blends two neighboring COLUMNS. On-grid evaluation cannot see
 *   cross-column interpolation error and systematically underestimates it.
 * - Each test column is compared curve-to-curve against a dense oracle walk
 *   of the same conserved b (the lutGenerate.test.ts methodology), sampled
 *   only where inverse mapping is well-conditioned: radius in [6, 16] r_g
 *   with per-texel slope guard (the steep outer rim is reported separately
 *   as tailFraction rather than folded into disk-hit error).
 * - Terminal-direction angular error uses aux-channel interpolation across
 *   the two bracketing columns vs the shared-crossing oracle direction.
 * - Quantization error for each format is measured by encoding one fixed
 *   high-resolution grid both ways (no extra integration cost).
 *
 * CLI: npm run lut:study [-- --quick]
 */

import {
  B_CRITICAL_RG,
  DEFAULT_AXIS_X,
  DEFAULT_ESCAPE_RADIUS_RG,
  DEFAULT_R_REF_RG,
  uToX
} from '../../src/phenomena/black-hole/lut/domain.js';
import type { LutAxisMapping } from '../../src/phenomena/black-hole/lut/types.js';
import { encodeTexture, decodeTexture } from './encode.js';
import {
  GENERATOR_INTEGRATION_OPTIONS,
  integrateTrajectoryColumn,
  inwardInitialPr
} from './sample.js';
import {
  integratePhoton,
  rk4PlaneStep,
  stepSizeAt,
  type PhotonIntegrationOptions,
  type Vec3
} from '../../src/phenomena/black-hole/cpuReference.js';
import { pathToFileURL } from 'node:url';

export interface AxisVariant {
  readonly label: string;
  readonly axis: LutAxisMapping;
}

/** Candidate critical-region mappings (ADR §6: concentrate samples near x=1). */
export const AXIS_VARIANTS: readonly AxisVariant[] = [
  { label: 'default [.85,1.15]', axis: DEFAULT_AXIS_X },
  {
    label: 'tight [.95,1.05]',
    axis: { uBreakpoints: [0, 1 / 3, 2 / 3, 1], xKnots: [0, 0.95, 1.05, 3] }
  },
  {
    label: 'wide [.70,1.30]',
    axis: { uBreakpoints: [0, 1 / 3, 2 / 3, 1], xKnots: [0, 0.7, 1.3, 3] }
  }
];

const WIDTHS = [512, 768, 1024, 1536] as const;
const HEIGHTS = [512, 1024, 2048] as const;

const DISK_MIN = 6;
const DISK_MAX = 16;
const SLOPE_GUARD = 1.0;

interface StudyConfig {
  width: number;
  height: number;
  psiMax: number;
  axis: LutAxisMapping;
}

interface ColumnResult {
  radiusErrMax: number;
  radiusErrRms: number;
  angularErrMax: number;
  samples: number;
}

// ---------------------------------------------------------------------------
// Dense oracle curve for an arbitrary conserved b (validated primitives)
// ---------------------------------------------------------------------------

function denseOracleCurve(
  b: number,
  rRefRg: number,
  escapeRadiusRg: number,
  psiApsis: number
): (row: number) => number {
  const g = GENERATOR_INTEGRATION_OPTIONS;
  const m = g.massRg;
  const walkOptions: PhotonIntegrationOptions = {
    massRg: m,
    stepSize: g.stepSize,
    minStep: g.minStep,
    maxStep: g.maxStep,
    maxSteps: g.maxSteps,
    escapeRadius: escapeRadiusRg,
    captureEpsilon: g.captureEpsilon,
    pathStride: 1
  };
  let state = { r: rRefRg, phi: 0, pr: inwardInitialPr(rRefRg, b, m) };
  const phis: number[] = [state.phi];
  const rs: number[] = [state.r];
  for (let s = 0; s < g.maxSteps; s += 1) {
    const h = stepSizeAt(state.r, walkOptions);
    state = rk4PlaneStep(state, h, m, b);
    if (!Number.isFinite(state.r)) break;
    phis.push(state.phi);
    rs.push(state.r);
    if (state.pr > 0 && state.r >= rRefRg) break;
  }
  const rows = phis.map((p) => Math.abs(p - psiApsis));
  return (row: number): number => {
    for (let k = 1; k < rows.length; k += 1) {
      const a = rows[k - 1]!;
      const c = rows[k]!;
      if (a <= row && row <= c && c > a) {
        const t = (row - a) / (c - a);
        return rs[k - 1]! + t * (rs[k]! - rs[k - 1]!);
      }
    }
    return NaN;
  };
}

function terminalAngleError(
  col: ReturnType<typeof integrateTrajectoryColumn>,
  o: { rRefRg: number; escapeRadiusRg: number }
): number {
  const g = GENERATOR_INTEGRATION_OPTIONS;
  const f0 = 1 - 2 / o.rRefRg;
  const t = (col.b * Math.sqrt(f0)) / o.rRefRg;
  const res = integratePhoton([o.rRefRg, 0, 0], [-Math.sqrt(Math.max(0, 1 - t * t)), t, 0], {
    escapeRadius: o.escapeRadiusRg,
    captureEpsilon: g.captureEpsilon,
    stepSize: g.stepSize,
    minStep: g.minStep,
    maxStep: g.maxStep,
    maxSteps: 500_000
  });
  if (res.status !== 'escaped') return NaN;
  const fp = res.finalPosition;
  const fd = res.finalDirection;
  const rF = Math.hypot(fp[0], fp[1], fp[2]);
  const er: Vec3 = [fp[0] / rF, fp[1] / rF, fp[2] / rF];
  const et: Vec3 = [-fp[1] / rF, fp[0] / rF, 0];
  const nRcpu = fd[0]! * er[0]! + fd[1]! * er[1]! + fd[2]! * er[2]!;
  const nTcpu = fd[0]! * et[0]! + fd[1]! * et[1]! + fd[2]! * et[2]!;
  const dot = col.terminalDirection[0]! * nRcpu + col.terminalDirection[1]! * nTcpu;
  const cross = col.terminalDirection[0]! * nTcpu - col.terminalDirection[1]! * nRcpu;
  return Math.abs(Math.atan2(cross, dot));
}

// ---------------------------------------------------------------------------
// One configuration measurement over a deterministic off-grid test set
// ---------------------------------------------------------------------------

/**
 * Deterministic off-grid x positions (odd multiples of 0.5 texel widths at
 * the STUDY reference width so they never coincide with any swept grid's
 * centers), mapped through the config's own axis to conserved b values.
 */
function offGridXPositions(count: number, refWidth: number, axis: LutAxisMapping): number[] {
  const xs: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const u = ((2 * i + 1) / (2 * count)) * 0.5 + 0.25; // interior quarter..three-quarters band coverage
    // Place at half-texel offsets of the REFERENCE grid: guaranteed between
    // centers of any even-width grid.
    const uOffset = (Math.floor(u * refWidth) + 0.5) / refWidth;
    xs.push(uToX(Math.min(1, Math.max(0, uOffset)), axis));
  }
  return xs;
}

async function measureConfig(cfg: StudyConfig, testCount: number): Promise<ColumnResult> {
  const g = GENERATOR_INTEGRATION_OPTIONS;
  void g;
  let radiusErrMax = 0;
  let radiusAccSq = 0;
  let radiusN = 0;
  let angularErrMax = 0;
  let samples = 0;

  // Build the grid ONCE for this config.
  const xsGrid = new Float64Array(cfg.width);
  for (let i = 0; i < cfg.width; i += 1) {
    xsGrid[i] = uToX((i + 0.5) / cfg.width, cfg.axis);
  }
  const columns = new Array(testCount === 0 ? 0 : cfg.width);
  for (let i = 0; i < cfg.width; i += 1) {
    columns[i] = integrateTrajectoryColumn({
      b: xsGrid[i]! * B_CRITICAL_RG,
      height: cfg.height,
      psiMax: cfg.psiMax,
      rRefRg: DEFAULT_R_REF_RG,
      escapeRadiusRg: DEFAULT_ESCAPE_RADIUS_RG
    });
  }

  const testXs = offGridXPositions(testCount, cfg.width, cfg.axis);
  for (const xt of testXs) {
    const bTest = xt * B_CRITICAL_RG;
    // Bracketing grid columns (runtime bilinear pair).
    const u = inverseAxis(xt, cfg.axis);
    const fi = u * cfg.width - 0.5;
    const i0 = Math.min(cfg.width - 1, Math.max(0, Math.floor(fi)));
    const i1 = Math.min(cfg.width - 1, i0 + 1);
    const wx = Math.min(1, Math.max(0, fi - i0));
    const colA = columns[i0] as ReturnType<typeof integrateTrajectoryColumn>;
    const colB = columns[i1] as ReturnType<typeof integrateTrajectoryColumn>;

    // Shared anchor: use the interpolated apsis azimuth so row coordinates
    // line up across the pair exactly like the GPU sampler will.
    const psiApsisMix =
      Number.isFinite(colA.psiApsis) && Number.isFinite(colB.psiApsis)
        ? colA.psiApsis * (1 - wx) + colB.psiApsis * wx
        : Number.isFinite(colA.psiApsis)
          ? colA.psiApsis
          : colB.psiApsis;

    const dense = denseOracleCurve(bTest, DEFAULT_R_REF_RG, DEFAULT_ESCAPE_RADIUS_RG, psiApsisMix);

    // Row solve against the BLENDED table then compare blended radius.
    const span = Math.min(colA.psiStoredSpan, colB.psiStoredSpan);
    const H = cfg.height;
    for (let targetR = DISK_MIN; targetR <= DISK_MAX; targetR += 2) {
      // find rows on each column where stored radius crosses targetR
      const rowA = solveRowForRadius(colA, targetR);
      const rowB = solveRowForRadius(colB, targetR);
      if (!Number.isFinite(rowA) || !Number.isFinite(rowB)) continue;
      const rowMix = rowA * (1 - wx) + rowB * wx;
      if (rowMix > span) continue;
      // slope guard via neighbor spacing of the blended pair
      const kA = Math.round((rowA / (colA.psiStoredSpan || 1)) * H - 0.5);
      const kB = Math.round((rowB / (colB.psiStoredSpan || 1)) * H - 0.5);
      const jA = Math.min(H - 1, Math.max(0, kA));
      const jB = Math.min(H - 1, Math.max(0, kB));
      const nextA = colA.rByTexel[Math.min(H - 1, jA + 1)]!;
      const prevB = colB.rByTexel[Math.max(0, jB - 1)]!;
      if (
        Math.abs(nextA - colA.rByTexel[jA]!) > SLOPE_GUARD ||
        Math.abs(colB.rByTexel[jB]! - prevB) > SLOPE_GUARD
      ) {
        continue;
      }
      const truth = dense(rowMix);
      if (!Number.isFinite(truth)) continue;
      // blended table value at (column mix, row mix) — bilinear in both axes
      const vA = sampleRows(colA, rowMix);
      const vB = sampleRows(colB, rowMix);
      const vMix = vA * (1 - wx) + vB * wx;
      const err = Math.abs(vMix - truth);
      radiusErrMax = Math.max(radiusErrMax, err);
      radiusAccSq += err * err;
      radiusN += 1;
      samples += 1;
    }

    if (Number.isFinite(psiApsisMix)) {
      const angA = terminalAngleError(colA, {
        rRefRg: DEFAULT_R_REF_RG,
        escapeRadiusRg: DEFAULT_ESCAPE_RADIUS_RG
      });
      const angB = terminalAngleError(colB, {
        rRefRg: DEFAULT_R_REF_RG,
        escapeRadiusRg: DEFAULT_ESCAPE_RADIUS_RG
      });
      const angMix =
        Number.isFinite(angA) && Number.isFinite(angB) ? angA * (1 - wx) + angB * wx : NaN;
      if (Number.isFinite(angMix)) {
        angularErrMax = Math.max(angularErrMax, angMix);
        samples += 1;
      }
    }
  }

  return {
    radiusErrMax,
    radiusErrRms: radiusN > 0 ? Math.sqrt(radiusAccSq / radiusN) : 0,
    angularErrMax,
    samples
  };
}

function solveRowForRadius(
  col: ReturnType<typeof integrateTrajectoryColumn>,
  target: number
): number {
  const H = col.rByTexel.length;
  for (let k = 1; k < H; k += 1) {
    const a = col.rByTexel[k - 1]!;
    const c = col.rByTexel[k]!;
    if (!(a <= c)) continue; // outbound monotone segment only
    if (a <= target && target <= c) {
      return ((k - 1 + (target - a) / (c - a) + 0.5) / H) * col.psiStoredSpan;
    }
  }
  return NaN;
}

function sampleRows(col: ReturnType<typeof integrateTrajectoryColumn>, row: number): number {
  const H = col.rByTexel.length;
  const x = (row / col.psiStoredSpan) * H - 0.5;
  const i0 = Math.min(H - 2, Math.max(0, Math.floor(x)));
  const f = Math.min(1, Math.max(0, x - i0));
  return col.rByTexel[i0]! * (1 - f) + col.rByTexel[i0 + 1]! * f;
}

function inverseAxis(x: number, m: LutAxisMapping): number {
  const [x0, x1, x2, x3] = m.xKnots;
  const [u0, u1, u2, u3] = m.uBreakpoints;
  if (x <= x1!) return u0! + ((x - x0!) / (x1! - x0!)) * (u1! - u0!);
  if (x <= x2!) return u1! + ((x - x1!) / (x2! - x1!)) * (u2! - u1!);
  if (x >= x3!) return 1;
  return u2! + ((x - x2!) / (x3! - x2!)) * (u3! - u2!);
}

// ---------------------------------------------------------------------------
// Format quantization study (no integration cost)
// ---------------------------------------------------------------------------

export function measureFormatQuantization(): Array<{
  format: string;
  maxAbs: number;
  rms: number;
}> {
  const w = 64;
  const h = 64;
  const src = new Float64Array(w * h);
  for (let k = 0; k < src.length; k += 1) {
    // radii sweep 2..64 with log-ish distribution like real tables
    src[k] = 2 + 62 * Math.pow(k / src.length, 2);
  }
  const out: Array<{ format: string; maxAbs: number; rms: number }> = [];
  for (const fmt of ['r16f', 'r32f'] as const) {
    const enc = encodeTexture({ data: src, width: w, height: h, channelCount: 1 }, fmt);
    const dec = decodeTexture(enc.bytes, fmt);
    let mx = 0;
    let acc = 0;
    for (let k = 0; k < src.length; k += 1) {
      const e = Math.abs(dec[k]! - src[k]!);
      mx = Math.max(mx, e);
      acc += e * e;
    }
    out.push({ format: fmt, maxAbs: mx, rms: Math.sqrt(acc / src.length) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Study driver
// ---------------------------------------------------------------------------

export interface StudyRow {
  readonly label: string;
  readonly radiusErrMax: number;
  readonly radiusErrRms: number;
  readonly angularErrMax: number;
  readonly bytesPerPixel: number;
  readonly sizeMiB: number;
  readonly samples: number;
}

export async function runDomainStudy(testColumnsPerConfig = 12): Promise<StudyRow[]> {
  const rows: StudyRow[] = [];

  // Stage A: axis variant x width at height 1024.
  for (const variant of AXIS_VARIANTS) {
    for (const width of WIDTHS) {
      const cfg: StudyConfig = { width, height: 1024, psiMax: 16, axis: variant.axis };
      const res = await measureConfig(cfg, testColumnsPerConfig);
      const bpp = 2; // r16f trajectory channel
      rows.push({
        label: `A ${variant.label} w=${width} h=1024`,
        radiusErrMax: res.radiusErrMax,
        radiusErrRms: res.radiusErrRms,
        angularErrMax: res.angularErrMax,
        bytesPerPixel: bpp,
        sizeMiB: (width * 1024 * bpp) / (1024 * 1024),
        samples: res.samples
      });
    }
  }

  // Stage B: height at the default axis, best-behaved width=1024.
  for (const height of HEIGHTS) {
    if (height === 1024) continue;
    const cfg: StudyConfig = { width: 1024, height, psiMax: 16, axis: DEFAULT_AXIS_X };
    const res = await measureConfig(cfg, testColumnsPerConfig);
    rows.push({
      label: `B default w=1024 h=${height}`,
      radiusErrMax: res.radiusErrMax,
      radiusErrRms: res.radiusErrRms,
      angularErrMax: res.angularErrMax,
      bytesPerPixel: 2,
      sizeMiB: (1024 * height * 2) / (1024 * 1024),
      samples: res.samples
    });
  }

  return rows;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

async function cliMain(): Promise<void> {
  const quick = process.argv.includes('--quick');
  const perConfig = quick ? 4 : 12;
  console.log(`[lut:study] domain study (testColumns=${perConfig}/config)`);
  const t0 = Date.now();
  const rows = await runDomainStudy(perConfig);
  console.log('config | radiusErrMax | radiusErrRms | angErrMax | MiB');
  for (const r of rows) {
    console.log(
      `${r.label} | ${r.radiusErrMax.toExponential(3)} | ${r.radiusErrRms.toExponential(3)} | ${r.angularErrMax.toExponential(3)} | ${r.sizeMiB.toFixed(2)}`
    );
  }
  for (const f of measureFormatQuantization()) {
    console.log(
      `format ${f.format}: quantization max=${f.maxAbs.toExponential(3)} rms=${f.rms.toExponential(3)}`
    );
  }
  console.log(`[lut:study] done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (invokedDirectly) void cliMain();
