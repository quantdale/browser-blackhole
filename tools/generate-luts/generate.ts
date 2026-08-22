/**
 * Deterministic Schwarzschild LUT family builder (M8-03 completion, BH-162).
 *
 * Pipeline (all inputs explicit; identical inputs => BYTE-IDENTICAL outputs):
 *
 *   columnXValues(axisX, width)
 *     -> integrateTrajectoryColumn(b)          [validated binary64 primitives]
 *     -> encodeTexture(traj R16F, aux RGBA16F) [explicit little-endian]
 *     -> sha256 per asset                      [WebCrypto, lowercase hex]
 *     -> LutManifest assembly                  [lut/types.ts wire schema]
 *     -> content-addressed directory name      [<family>-<hash8>]
 *
 * DETERMINISM CONTRACT (mission §5): every field that could vary between two
 * runs is either measured data, an explicit option, or derived from the SOURCE
 * REVISION — never from wall-clock time. `generatedAt` defaults to the source
 * commit's committer date (git %cI) so provenance records WHEN THE PHYSICS WAS
 * AUTHORED rather than when bytes were emitted; builds outside a git checkout
 * fall back to a fixed epoch constant. Both fields are overridable for tests.
 *
 * FORMAT DEFAULTS (interim, pending the measured M8-04 study): R16F
 * trajectory + RGBA16F aux. Rationale recorded here until then: half-float
 * formats are texture-FILTERABLE in core WebGL2 (ES 3.0 table 3.13) while
 * 32F formats require OES_texture_float_linear, so the default family stays
 * truthfully usable by a WebGL2 backend instead of silently degrading it.
 *
 * AUX CHANNEL SEMANTICS (lut/types.ts LutTextureEntry.channels):
 *   0 nR, 1 nT  — terminal tetrad direction components at the escape-radius
 *                 crossing (escaping class) or their time-reversed mirror
 *                 (captured class).
 *   2 psiExit   — row-coordinate azimuth of the outgoing escape-radius
 *                 crossing; SENTINEL -1 marks a CAPTURED row (valid values
 *                 are > 0), which also implies nR/nT carry the mirrored
 *                 climber direction.
 *   3 psiApsis  — apsis azimuth in launch coordinates; -1 when captured.
 * Per-row truncation is intentionally NOT stored: rays inside the manifest's
 * hybridBandHalfWidthX route to the numerical backend wholesale (ADR §6).
 *
 * gFactorRelativeErrorMax is reported as 0 in v1 families: g is a RENDERER-
 * level quantity (b_z x disk model), not derivable offline; it is measured by
 * the M8-07 image equivalence campaign and backfilled into regenerated
 * manifests there. Recording a fake offline bound would be dishonest.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  B_CRITICAL_RG,
  DEFAULT_AXIS_X,
  DEFAULT_ESCAPE_RADIUS_RG,
  DEFAULT_R_REF_RG,
  uToX
} from '../../src/phenomena/black-hole/lut/domain.js';
import {
  LUT_FAMILY_SCHWARZSCHILD_V1,
  LUT_SCHEMA_VERSION,
  type LutAxisMapping,
  type LutManifest,
  type LutTextureFormat
} from '../../src/phenomena/black-hole/lut/types.js';
import { sha256Hex } from '../../src/phenomena/black-hole/lut/validate.js';
import {
  DEFAULT_WIDTH,
  GENERATOR_INTEGRATION_OPTIONS,
  columnXValues,
  integrateTrajectoryColumn,
  inwardInitialPr,
  type TrajectoryColumn
} from './sample.js';
import {
  integratePhoton,
  rk4PlaneStep,
  stepSizeAt,
  type PhotonIntegrationOptions,
  type Vec3
} from '../../src/phenomena/black-hole/cpuReference.js';
import { encodeTexture } from './encode.js';

/** Semantic version of THIS generator implementation. */
export const GENERATOR_VERSION = '1.0.0';

/** Fixed fallback timestamp for builds outside a git checkout (see header). */
export const FALLBACK_GENERATED_AT = '1970-01-01T00:00:00.000Z';

/** Fallback commit id for builds outside a git checkout. */
export const FALLBACK_GENERATOR_COMMIT = 'unknown';

/** Radii above this are outside every runtime consumer's envelope (r_g).
 * Disk-hit error sampling additionally stops at 16: beyond it the row tail
 * turns steep (see measureValidation) and is excluded by the slope guard. */
const RADIUS_ENVELOPE_RG = 16;
/** Disk-hit error semantics start at the ISCO inner edge (no disk below). */
const DISK_HIT_MIN_RADIUS_RG = 6;

export interface GenerateFamilyOptions {
  /** Columns along x = b/b_c. Default {@link DEFAULT_WIDTH}. */
  width?: number;
  /** Rows along psi (uniform texel grid). Default 1024. */
  height?: number;
  /** Row-domain winding budget (radians). Default 16. */
  psiMax?: number;
  /** Inward launch sphere (r_g). Default {@link DEFAULT_R_REF_RG}. */
  rRefRg?: number;
  /** Escape/observer-envelope radius defining row end (r_g). */
  escapeRadiusRg?: number;
  /** Nonlinear critical-axis mapping. Default {@link DEFAULT_AXIS_X}. */
  axisX?: LutAxisMapping;
  /** Trajectory encoding. Default 'r16f' (WebGL2-filterable; see header). */
  trajectoryFormat?: LutTextureFormat;
  /** Aux encoding. Default 'rgba16f'. */
  auxFormat?: LutTextureFormat;
  /** Overrides detected source revision (tests pin this for determinism). */
  generatorCommit?: string;
  /** Overrides the derived ISO timestamp (tests pin this). */
  generatedAtIso?: string;
}

export interface GeneratedFamily {
  readonly manifest: LutManifest;
  /** Asset filename (relative to the family directory) -> raw bytes. */
  readonly assets: ReadonlyMap<string, Uint8Array>;
  /** Content-addressed directory name: `<family>-<hash8>` (types.ts contract). */
  readonly directoryName: string;
}

// ---------------------------------------------------------------------------
// Source-revision probes (best-effort, deterministic per checkout)
// ---------------------------------------------------------------------------

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function resolveGeneratorCommit(explicit?: string): string {
  if (explicit !== undefined) return explicit;
  return git(['rev-parse', 'HEAD']) ?? FALLBACK_GENERATOR_COMMIT;
}

function resolveGeneratedAt(explicit?: string, commit?: string): string {
  if (explicit !== undefined) return explicit;
  if (commit !== undefined && commit !== FALLBACK_GENERATOR_COMMIT) {
    const iso = git(['log', '-1', '--format=%cI', commit]);
    if (iso !== null && iso.length > 0) return iso;
  }
  return FALLBACK_GENERATED_AT;
}

// ---------------------------------------------------------------------------
// Column sweep
// ---------------------------------------------------------------------------

interface SweepOptions {
  width: number;
  height: number;
  psiMax: number;
  rRefRg: number;
  escapeRadiusRg: number;
  axisX: LutAxisMapping;
}

interface SweepResult {
  readonly columns: TrajectoryColumn[];
  /** Absolute x positions of columns whose winding exceeded psiMax. */
  readonly truncatedXValues: number[];
  /** Half-width of one column in x units (band bookkeeping margin). */
  readonly halfColumnWidthX: number;
}

function sweepColumns(o: SweepOptions): SweepResult {
  const xs = columnXValues(o.width, o.axisX);
  const columns: TrajectoryColumn[] = new Array(xs.length);
  const truncatedXValues: number[] = [];
  const halfColumnWidthX =
    o.width > 1 ? Math.abs(uToX(1 / o.width, o.axisX) - uToX(0, o.axisX)) * 0.5 : 0;
  for (let i = 0; i < xs.length; i += 1) {
    const col = integrateTrajectoryColumn({
      b: xs[i]! * B_CRITICAL_RG,
      height: o.height,
      psiMax: o.psiMax,
      rRefRg: o.rRefRg,
      escapeRadiusRg: o.escapeRadiusRg
    });
    columns[i] = col;
    if (col.truncated) truncatedXValues.push(xs[i]!);
  }
  return { columns, truncatedXValues, halfColumnWidthX };
}

// ---------------------------------------------------------------------------
// Measured validation summary (BH-163 seed; image-level g deferred to M8-07)
// ---------------------------------------------------------------------------

interface ProbeStats {
  classificationMismatchRate: number;
  escapeDirectionAngularErrorRadMax: number;
  escapeDirectionAngularErrorRadRms: number;
  /** Reserved: renderer-level quantity, measured by M8-07 (module header). */
  gFactorRelativeErrorMax: number;
  diskHitRadiusErrorRgMax: number;
  diskHitRadiusErrorRgRms: number;
}

/**
 * Small in-process equivalence corpus baked into the manifest:
 * - classification of EVERY column vs the analytic boundary b > b_c
 *   (exact statement per ADR §6 — no interpolation across the boundary);
 * - every PROBE_STRIDE-th escaping column's terminal direction compared
 *   against an integratePhoton oracle stopped on the SAME outgoing crossing
 *   (matched tight settings), angular error between planar components;
 * - grid-vs-oracle radius error over the consumed envelope for probed
 *   columns (curve-to-curve at texel centers; this bounds any future
 *   disk-hit radius error, whose full image-level metric is an M8-07 task).
 */
const PROBE_STRIDE = 48;

function measureValidation(
  sweep: SweepResult,
  o: { width: number; height: number; rRefRg: number; escapeRadiusRg: number }
): ProbeStats {
  let mismatch = 0;
  for (const col of sweep.columns) {
    if (col.escapingClass !== col.b > B_CRITICAL_RG) mismatch += 1;
  }

  const angleErrors: number[] = [];
  const radiusErrors: number[] = [];
  for (let i = 0; i < sweep.columns.length; i += PROBE_STRIDE) {
    const col = sweep.columns[i]!;
    if (!col.escapingClass || !Number.isFinite(col.psiApsis)) continue;

    angleErrors.push(...terminalAngleErrors(col, o));

    // Curve-to-curve radius comparison on the same probe column, sampled
    // only where the grid inverse-mapping is well-conditioned: inside the
    // production disk annulus (6..16 r_g) AND away from the steep outer
    // rim, marked by per-texel radius steps > 1 r_g (there dr/dpsi > 100:
    // the photon flies nearly radially and sub-texel coordinate placement,
    // not table quality, dominates — the same effect quantified in
    // lutGenerate.test.ts; the rim gets dedicated treatment in M8-04).
    const dense = denseOracleCurve(col.b, o.rRefRg, o.escapeRadiusRg, col.psiApsis);
    const H = col.rByTexel.length;
    for (let k = 0; k < H; k += 1) {
      const stored = col.rByTexel[k]!;
      if (!(stored >= DISK_HIT_MIN_RADIUS_RG && stored <= RADIUS_ENVELOPE_RG)) continue;
      if (k + 1 < H && Math.abs(col.rByTexel[k + 1]! - stored) > 1.0) continue;
      if (k > 0 && Math.abs(stored - col.rByTexel[k - 1]!) > 1.0) continue;
      const s = ((k + 0.5) / H) * col.psiStoredSpan;
      const truth = dense(s);
      if (Number.isFinite(truth)) radiusErrors.push(Math.abs(stored - truth));
    }
  }

  return {
    classificationMismatchRate: sweep.columns.length > 0 ? mismatch / sweep.columns.length : 0,
    escapeDirectionAngularErrorRadMax: maxOf(angleErrors),
    escapeDirectionAngularErrorRadRms: rmsOf(angleErrors),
    gFactorRelativeErrorMax: 0,
    diskHitRadiusErrorRgMax: maxOf(radiusErrors),
    diskHitRadiusErrorRgRms: rmsOf(radiusErrors)
  };
}

/** Angular error between the column's terminal direction and an integratePhoton
 * oracle stopped on the same outgoing escape-radius crossing (shared frame). */
function terminalAngleErrors(
  col: TrajectoryColumn,
  o: { rRefRg: number; escapeRadiusRg: number }
): number[] {
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
  if (res.status !== 'escaped') return [];
  const fp = res.finalPosition;
  const fd = res.finalDirection;
  const rF = Math.hypot(fp[0], fp[1], fp[2]);
  const er: Vec3 = [fp[0] / rF, fp[1] / rF, fp[2] / rF];
  const et: Vec3 = [-fp[1] / rF, fp[0] / rF, 0];
  const nRcpu = fd[0]! * er[0]! + fd[1]! * er[1]! + fd[2]! * er[2]!;
  const nTcpu = fd[0]! * et[0]! + fd[1]! * et[1]! + fd[2]! * et[2]!;
  const dot = col.terminalDirection[0]! * nRcpu + col.terminalDirection[1]! * nTcpu;
  const cross = col.terminalDirection[0]! * nTcpu - col.terminalDirection[1]! * nRcpu;
  return [Math.abs(Math.atan2(cross, dot))];
}

/**
 * Dense outbound oracle curve for one conserved-b geodesic: integrates with
 * the SAME exported primitives as the generator recording EVERY step, folds
 * around the column's own apsis anchor, returns a piecewise-linear evaluator
 * over row coordinates (methodology validated in lutGenerate.test.ts).
 */
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
    if (!Number.isFinite(state.r) || !Number.isFinite(state.phi) || !Number.isFinite(state.pr)) {
      break;
    }
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

function maxOf(v: number[]): number {
  return v.length > 0 ? Math.max(...v) : 0;
}

function rmsOf(v: number[]): number {
  if (v.length === 0) return 0;
  let acc = 0;
  for (const x of v) acc += x * x;
  return Math.sqrt(acc / v.length);
}

// ---------------------------------------------------------------------------
// Family assembly
// ---------------------------------------------------------------------------

/**
 * Resamples one column's row grid onto the SHARED normalized span
 * (M8-05 contract): every column in a family must map v=1 to the same psi,
 * otherwise cross-column bilinear filtering is meaningless. Columns whose
 * own data end short of the shared span are CLAMP-EXTENDED with their final
 * valid radius: for escaping columns that is the escape-envelope crossing
 * (physically exact — the photon leaves the envelope there), for captured
 * columns the capture-band radius (classification never consults those
 * rows). Filtering therefore always sees finite, semantically inert values.
 */
function resampleToSharedSpan(col: TrajectoryColumn, span: number, height: number): Float64Array {
  const out = new Float64Array(height);
  const srcSpan = col.psiStoredSpan;
  let lastValid = Number.NaN;
  for (let j = 0; j < height; j += 1) {
    const psi = ((j + 0.5) / height) * span;
    if (psi <= col.psiDataEnd && Number.isFinite(lastValid || 0)) {
      // still inside this column's real data: sample its own grid
      const x = (psi / srcSpan) * col.rByTexel.length - 0.5;
      const i0 = Math.min(col.rByTexel.length - 2, Math.max(0, Math.floor(x)));
      const f = Math.min(1, Math.max(0, x - i0));
      out[j] = col.rByTexel[i0]! * (1 - f) + col.rByTexel[i0 + 1]! * f;
      lastValid = out[j]!;
    } else if (!Number.isFinite(lastValid)) {
      // before any valid sample can only happen at j=0 with degenerate span
      out[j] = col.rByTexel[0] ?? Number.NaN;
      lastValid = out[j]!;
    } else {
      out[j] = lastValid;
    }
  }
  return out;
}

export async function buildFamily(options: GenerateFamilyOptions = {}): Promise<GeneratedFamily> {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? 1024;
  const psiMax = options.psiMax ?? 16;
  const rRefRg = options.rRefRg ?? DEFAULT_R_REF_RG;
  const escapeRadiusRg = options.escapeRadiusRg ?? DEFAULT_ESCAPE_RADIUS_RG;
  const axisX = options.axisX ?? DEFAULT_AXIS_X;
  const trajFormat = options.trajectoryFormat ?? 'r16f';
  const auxFormat = options.auxFormat ?? 'rgba16f';
  if (!(width > 0) || !(height > 0)) throw new RangeError('width/height must be positive');
  if (!(psiMax > 0) || !(escapeRadiusRg < rRefRg)) {
    throw new RangeError('psiMax must be positive and escapeRadiusRg < rRefRg');
  }

  const sweep = sweepColumns({ width, height, psiMax, rRefRg, escapeRadiusRg, axisX });

  // Shared normalized span (M8-05): every column resampled onto the same
  // row grid so texture filtering is well-defined. The span is the longest
  // escaping arc (capped by the winding budget); shorter columns — including
  // all captured ones — are clamp-extended with their terminal radius.
  let storedSpan = 0;
  for (const col of sweep.columns) {
    if (col.escapingClass) storedSpan = Math.max(storedSpan, col.psiStoredSpan);
  }
  if (!(storedSpan > 0)) {
    // Degenerate sweep (no escaping columns at all — cannot happen across a
    // full b_c-scaled axis, but never emit a broken family).
    storedSpan = Math.min(psiMax, 1);
  }
  const rowGrids = sweep.columns.map((col) => resampleToSharedSpan(col, storedSpan, height));

  // --- trajectory texels: channel layout r[texel = j*width + i] -----------
  const trajChannels = new Float64Array(width * height);
  for (let i = 0; i < width; i += 1) {
    for (let j = 0; j < height; j += 1) {
      trajChannels[j * width + i] = rowGrids[i]![j]!;
    }
  }
  const traj = encodeTexture({ data: trajChannels, width, height, channelCount: 1 }, trajFormat);

  // --- aux texels: [nR, nT, psiExit, psiApsis] per column ------------------
  // psiExit stores the ROW-COORDINATE span of valid escaping data (= the
  // stored span), matching how the runtime walks outward from the launch
  // solve; captured rows carry the -1 sentinel.
  const auxChannels = new Float64Array(width * 4);
  for (let i = 0; i < width; i += 1) {
    const col = sweep.columns[i]!;
    const base = i * 4;
    auxChannels[base] = col.terminalDirection[0]!;
    auxChannels[base + 1] = col.terminalDirection[1]!;
    if (col.escapingClass) {
      // Physical (uncapped) outbound arc of THIS column: lets consumers know
      // where clamped padding begins inside the shared span.
      auxChannels[base + 2] = col.psiDataEnd;
      auxChannels[base + 3] = col.psiApsis;
    } else {
      auxChannels[base + 2] = -1;
      auxChannels[base + 3] = -1;
    }
  }
  const aux = encodeTexture({ data: auxChannels, width, height: 1, channelCount: 4 }, auxFormat);

  const trajSha = await sha256Hex(traj.bytes);
  const auxSha = await sha256Hex(aux.bytes);

  const validation = measureValidation(sweep, { width, height, rRefRg, escapeRadiusRg });

  const generatorCommit = resolveGeneratorCommit(options.generatorCommit);
  const generatedAt = resolveGeneratedAt(options.generatedAtIso, generatorCommit);

  // Hybrid band: half-width around x = 1 containing any winding-truncated
  // column plus one half-column margin; 0 when the budget never binds.
  let band = 0;
  for (const xt of sweep.truncatedXValues) band = Math.max(band, Math.abs(xt - 1));
  const hybridBandHalfWidthX =
    sweep.truncatedXValues.length > 0 ? band + sweep.halfColumnWidthX : 0;

  const manifest: LutManifest = {
    schemaVersion: LUT_SCHEMA_VERSION,
    family: LUT_FAMILY_SCHWARZSCHILD_V1,
    generatorVersion: GENERATOR_VERSION,
    generatorCommit,
    physicsConvention: 'schwarzschild-M1-static-observer, geometric units G=c=M=1',
    coordinateConvention:
      'planar state (r, phi, p_r), E-normalized L=b; pos=r*(cos(phi)e0+sin(phi)e1); backwards ray tracing; terminal direction is the static-observer tetrad projection',
    referenceSolverVersion: `cpuReference.ts@${generatorCommit}#stepSize=${GENERATOR_INTEGRATION_OPTIONS.stepSize},maxStep=${GENERATOR_INTEGRATION_OPTIONS.maxStep}`,
    generatedAt,
    provenance: {
      paper:
        'Eric Bruneton, Real-time High-Quality Rendering of Non-Rotating Black Holes, arXiv:2010.08735 (2020)',
      implementation: 'github.com/ebruneton/black_hole_shader (BSD-3-Clause)',
      license: 'this repository MIT; reference BSD-3-Clause (concepts only, no code copied)',
      adaptation:
        'CONCEPTS ADAPTED, CODE INDEPENDENT: precomputed-trajectory idea and critical-region sampling strategy adapted; all tables generated by tools/generate-luts from src/phenomena/black-hole/cpuReference.ts'
    },
    physics: {
      massGeometric: 1,
      bCriticalRg: B_CRITICAL_RG,
      rRefRg,
      escapeRadiusRg
    },
    textures: [
      {
        id: 'trajectory',
        file: 'trajectory.bin',
        width,
        height,
        format: trajFormat,
        interpolation: 'bilinear',
        domain: { kind: 'trajectory', axisX, psiMax, storedSpanRg: storedSpan },
        channels: { r: 0 },
        sha256: trajSha,
        byteLength: traj.bytes.byteLength
      },
      {
        id: 'aux',
        // NOTE: not 'aux.bin' — AUX is a reserved DOS device name; such files
        // cannot be opened via normal Win32 paths and break git checkouts on
        // Windows.
        file: 'aux-data.bin',
        width,
        height: 1,
        format: auxFormat,
        interpolation: 'nearest',
        domain: { kind: 'aux', axisX, storedSpanRg: storedSpan },
        channels: { nR: 0, nT: 1, psiExit: 2, psiApsis: 3 },
        sha256: auxSha,
        byteLength: aux.bytes.byteLength
      }
    ],
    validation,
    hybridBandHalfWidthX
  };

  // Content-addressed directory per the types.ts contract: the name embeds
  // the MANIFEST content hash. The manifest itself carries both asset SHA-256
  // digests, so data, metadata and decoder assumptions are immutably paired —
  // a stale cache can never mix a new family with old tables.
  const manifestHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(manifest)));
  const directoryName = `${LUT_FAMILY_SCHWARZSCHILD_V1}-${manifestHash.slice(0, 8)}`;

  const assets = new Map<string, Uint8Array>([
    ['trajectory.bin', traj.bytes],
    ['aux-data.bin', aux.bytes]
  ]);
  return { manifest, assets, directoryName };
}

// ---------------------------------------------------------------------------
// Disk writer + CLI
// ---------------------------------------------------------------------------

export async function writeFamily(family: GeneratedFamily, outRoot: string): Promise<string> {
  const dir = path.join(outRoot, family.directoryName);
  await mkdir(dir, { recursive: true });
  for (const [name, bytes] of family.assets) {
    await writeFile(path.join(dir, name), bytes);
  }
  await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(family.manifest, null, 2)}\n`);
  return dir;
}

async function main(): Promise<void> {
  const started = Date.now();
  const family = await buildFamily();
  const dir = await writeFamily(family, path.resolve('public/luts'));
  console.log(`[lut:generate] wrote ${dir}`);
  console.log(
    `[lut:generate] trajectory ${family.manifest.textures[0]?.byteLength ?? 0} bytes (${family.manifest.textures[0]?.format})`
  );
  console.log(
    `[lut:generate] aux ${family.manifest.textures[1]?.byteLength ?? 0} bytes (${family.manifest.textures[1]?.format})`
  );
  console.log(
    `[lut:generate] validation: classMismatch=${family.manifest.validation.classificationMismatchRate.toFixed(6)}, angErrMax=${family.manifest.validation.escapeDirectionAngularErrorRadMax.toExponential(3)}, diskErrMax=${family.manifest.validation.diskHitRadiusErrorRgMax.toExponential(3)}`
  );
  console.log(`[lut:generate] hybridBandHalfWidthX=${family.manifest.hybridBandHalfWidthX}`);
  console.log(`[lut:generate] done in ${Date.now() - started} ms`);
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) void main();
