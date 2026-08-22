/**
 * Offline LUT trajectory-column sampler (M8-03, BH-162/163).
 *
 * SOURCE OF TRUTH POLICY (mission §12): every column is integrated with the
 * SAME validated RHS/RK4 primitives exported from
 * src/phenomena/black-hole/cpuReference.ts (the binary64 oracle). The LUT
 * sampler never generates its own truth: it reuses the oracle's equations
 * verbatim at tighter-than-production settings and records convergence
 * metadata per family. Equivalence to the public integratePhoton() API is
 * enforced by unit tests (tests/unit/lutGenerate.test.ts).
 *
 * COLUMN SEMANTICS (docs/LUT_BACKEND_ADR.md §4-§7):
 * - Physical coordinate x = b / b_c; each column integrates ONE conserved-b
 *   planar null geodesic launched at the reference sphere r_ref moving
 *   inward (p_r < 0), E normalized to 1 so L = b.
 * - Columns for b > b_c ("escaping" class) are ANCHORED AT APSIS:
 *   row coordinate psi_a = |phi - phi_apsis| in [0, psiRowEnd]; r(psi_a) is
 *   exactly even (trajectory symmetry), covering both branches. psiRowEnd is
 *   the outgoing arc's crossing of the ESCAPE radius.
 * - Columns for b < b_c ("captured" class) are ANCHORED AT r_ref:
 *   row coordinate psi_e = phi in [0, min(psiCapture, psiMax)]; the runtime
 *   uses the exact even extension r(-psi) = r(psi) for outward-launched rays,
 *   whose escape-direction channels are the time-reverse mirror of the
 *   incoming sub-path above the escape radius.
 * - Rows are resampled onto a UNIFORM psi texel grid because disk-plane
 *   crossing candidates are equally spaced in psi (ADR §7).
 */

import {
  DEFAULT_AXIS_X,
  DEFAULT_ESCAPE_RADIUS_RG,
  DEFAULT_R_REF_RG,
  uToX
} from '../../src/phenomena/black-hole/lut/domain.js';
import {
  rk4PlaneStep,
  stepSizeAt,
  type PhotonIntegrationOptions
} from '../../src/phenomena/black-hole/cpuReference.js';

/** Tight reference settings for generation (tighter than production GPU). */
export const GENERATOR_INTEGRATION_OPTIONS: Readonly<
  Pick<
    PhotonIntegrationOptions,
    'massRg' | 'stepSize' | 'minStep' | 'maxStep' | 'maxSteps' | 'captureEpsilon'
  >
> = {
  massRg: 1,
  stepSize: 0.002,
  minStep: 1e-9,
  maxStep: 40,
  maxSteps: 4_000_000,
  captureEpsilon: 1e-6
};

export interface TrajectoryColumnOptions {
  /** Conserved impact parameter b = L/E (r_g). */
  b: number;
  /** Reference sphere where inward launches begin (r_g). */
  rRefRg?: number;
  /** Escape radius defining the outgoing row end / terminal direction (r_g). */
  escapeRadiusRg?: number;
  /** Uniform row-grid texel count. */
  height: number;
  /** Row-domain cap (radians); columns needing more are flagged truncated. */
  psiMax: number;
  /** Integration overrides (tests may tighten further). */
  integration?: Partial<typeof GENERATOR_INTEGRATION_OPTIONS>;
}

/** One uniformly resampled row value; NaN marks "beyond valid data". */
export interface TrajectoryColumn {
  /** Conserved b this column was built from. */
  readonly b: number;
  /** True when b > b_c (row anchored at apsis). */
  readonly escapingClass: boolean;
  /**
   * Resampled radii at texel centers psi_i = (i+0.5)/height * psiSpan, in
   * ROW coordinates: psi_a = |phi - phi_apsis| when escapingClass, else
   * psi_e = phi measured from the r_ref anchor. NaN beyond data end.
   */
  readonly rByTexel: Float64Array;
  /** Valid (non-NaN) texels from index 0; also the enumeration extent. */
  readonly validTexels: number;
  /** Physical span covered by valid data (radians). */
  readonly psiDataEnd: number;
  /** Apsis azimuth in launch coordinates (escaping class only, else NaN). */
  readonly psiApsis: number;
  /** Periapsis radius (escaping class only, else NaN). */
  readonly rMin: number;
  /** Capture azimuth (captured class only, else NaN). */
  readonly psiCapture: number;
  /** True when required extent exceeded psiMax (hybrid-routing band member). */
  readonly truncated: boolean;
  /** Terminal tetrad direction at the OUTGOING escape-radius crossing:
   * [nR, nT] with n radial/outward-positive; NaN when the column never
   * reaches escape radius (captured class without valid mirror). */
  readonly terminalDirection: readonly [number, number];
  /** Convergence metadata for provenance. */
  readonly stepsUsed: number;
  readonly maxConstraintResidual: number;
}

/**
 * Initial inward radial momentum at r with conserved b (null constraint,
 * E = 1): p_r = -sqrt((1/f - b^2/r^2)/f), f = 1 - 2M/r. Requires the launch
 * radius to be outside the (b-dependent) radial turning structure, which
 * r_ref >> b guarantees for the supported domain.
 */
export function inwardInitialPr(r: number, b: number, massRg = 1): number {
  const f = 1 - (2 * massRg) / r;
  const inner = (1 / f - (b * b) / (r * r)) / f;
  if (!(inner > 0)) {
    throw new RangeError(
      `no inward null momentum at r=${r} for b=${b} (turning structure outside domain)`
    );
  }
  return -Math.sqrt(inner);
}

/** Tetrad-projected local static-observer direction components at a state. */
function terminalComponents(r: number, pr: number, b: number, massRg = 1): [number, number] {
  const f = Math.max(1 - (2 * massRg) / r, 1e-30);
  const vr = f * pr;
  const vt = b / r;
  const norm = Math.sqrt((vr * vr) / f + vt * vt);
  if (!(norm > 0)) return [NaN, NaN];
  return [vr / (Math.sqrt(f) * norm), vt / norm];
}

interface RawEventSample {
  psi: number;
  r: number;
  pr: number;
}

/**
 * Integrates one conserved-b trajectory and resamples it onto the uniform
 * row grid. See module docs for anchoring semantics per class.
 */
export function integrateTrajectoryColumn(opts: TrajectoryColumnOptions): TrajectoryColumn {
  const m = GENERATOR_INTEGRATION_OPTIONS.massRg;
  const intOpts = { ...GENERATOR_INTEGRATION_OPTIONS, ...opts.integration };
  const rRef = opts.rRefRg ?? DEFAULT_R_REF_RG;
  const escapeR = opts.escapeRadiusRg ?? DEFAULT_ESCAPE_RADIUS_RG;
  if (!(escapeR < rRef)) throw new RangeError('escapeRadiusRg must be < rRefRg');
  const b = opts.b;
  const height = opts.height;

  // --- Raw integration walk (launch coordinates: phi = 0 at r_ref inbound) --
  let r = rRef;
  let phi = 0;
  let pr = inwardInitialPr(rRef, b, m);
  let steps = 0;
  let maxResidual = 0;
  const raw: RawEventSample[] = [{ psi: 0, r, pr }];

  let psiApsis = NaN;
  let rMin = NaN;
  let psiCapture = NaN;
  let psiEscapeOut = NaN;
  let terminalOut: [number, number] = [NaN, NaN];
  // Incoming-side crossing of the escape radius (mirror source for captured
  // class terminal directions; unused otherwise).
  let psiEscapeInMirror = NaN;
  let prevPr = pr;
  let prevR = r;

  while (steps < intOpts.maxSteps) {
    const h = stepSizeAt(r, { ...(intOpts as PhotonIntegrationOptions) });
    const next = rk4PlaneStep({ r, phi, pr }, h, m, b);
    const nR_ = next.r;
    const nPhi = next.phi;
    const nPr = next.pr;
    steps += 1;

    // Constraint residual monitor (NUMERICAL_METHODS §6, E = 1).
    const fHere = Math.max(1 - (2 * m) / Math.max(nR_, 1e-300), 1e-300);
    const kinetic = fHere * nPr * nPr + (b * b) / (nR_ * nR_);
    const residual = Math.abs(kinetic - 1 / fHere) / Math.max(1 / fHere, kinetic, 1e-30);
    if (residual > maxResidual) maxResidual = residual;

    r = nR_;
    phi = nPhi;
    pr = nPr;

    // Apsis detection: inward -> outward radial-momentum sign change.
    if (Number.isNaN(psiApsis) && prevPr < 0 && pr >= 0) {
      // Linear root estimate within the step (tight steps => sub-micro-rad).
      const t = prevPr === pr ? 0.5 : prevPr / (prevPr - pr);
      psiApsis = phi - h + t * h;
      rMin = r;
    }
    // Outgoing escape-radius crossing (escaping class row end).
    if (!Number.isNaN(psiApsis) && Number.isNaN(psiEscapeOut) && prevR < escapeR && r >= escapeR) {
      const t = (escapeR - prevR) / (r - prevR);
      psiEscapeOut = phi - h + t * h;
      terminalOut = terminalComponents(r, pr, b, m);
    }
    // Incoming-side escape-radius crossing (captured-class mirror source):
    // first descent through escapeR before any apsis exists.
    if (
      Number.isNaN(psiApsis) &&
      Number.isNaN(psiEscapeInMirror) &&
      prevR > escapeR &&
      r <= escapeR
    ) {
      psiEscapeInMirror = phi - h + t01(prevR, r, escapeR) * h;
    }
    // Horizon capture.
    if (r <= 2 * m + intOpts.captureEpsilon * m) {
      psiCapture = phi;
      break;
    }
    // Outgoing return to r_ref closes the escaping-class row.
    if (!Number.isNaN(psiApsis) && pr > 0 && r >= rRef) {
      break;
    }

    prevPr = pr;
    prevR = r;
    raw.push({ psi: phi, r, pr });
  }

  const escapingClass = !Number.isNaN(psiApsis);

  // --- Captured-class terminal direction: time-reverse mirror of the ---
  // --- incoming sub-path at the escape radius (module docs).          ---
  let terminal: [number, number] = terminalOut;
  if (!escapingClass && !Number.isNaN(psiCapture)) {
    const mirrorPsi = psiEscapeInMirror;
    if (mirrorPsi !== undefined && Number.isFinite(mirrorPsi)) {
      // Find the raw sample nearest the incoming escape crossing.
      let best = raw[0]!;
      for (const s of raw) {
        if (Math.abs(s.psi - mirrorPsi) < Math.abs(best.psi - mirrorPsi)) best = s;
      }
      // Time-reversal negates ALL momenta (dr/dlambda AND dphi/dlambda:
      // the outward climber carries effective L = -b in launch coordinates),
      // so the climber's local direction is the FULL NEGATION of the
      // descending state's tetrad components at the same radius. Verified
      // against direct outward integrations in lutGenerate.test.ts.
      const c = terminalComponents(best.r, best.pr, b, m);
      terminal = [-c[0], -c[1]];
    } else {
      terminal = [NaN, NaN];
    }
  }

  // --- Row anchoring + uniform resampling ---------------------------------
  const rByTexel = new Float64Array(height).fill(NaN);
  const anchorOffset = escapingClass ? psiApsis : 0;
  const dataEnd = escapingClass
    ? psiEscapeOut - anchorOffset
    : Number.isNaN(psiCapture)
      ? phi
      : psiCapture;
  const psiSpan = Math.min(dataEnd, opts.psiMax);
  const truncated = dataEnd > opts.psiMax + 1e-9;

  // Map each raw sample into row coordinates and piecewise-linearly fill the
  // texel grid. Row coordinate: psi_row = |psi - anchorOffset| (escaping) or
  // psi (captured). Even extension is implicit: texels cover [0, span].
  interface Pt {
    psiRow: number;
    r: number;
  }
  const pts: Pt[] = [];
  for (const s of raw) {
    const psiRow = escapingClass ? Math.abs(s.psi - anchorOffset) : s.psi;
    pts.push({ psiRow, r: s.r });
  }
  // Escaping rows fold to [0, ...]; sort by row coordinate for monotonic fill.
  if (escapingClass) pts.sort((p, q) => p.psiRow - q.psiRow);
  let cursor = 0;
  for (let i = 0; i < height; i += 1) {
    const psiI = ((i + 0.5) / height) * psiSpan;
    if (psiI > dataEnd + 1e-12) break;
    while (cursor + 1 < pts.length && pts[cursor + 1]!.psiRow < psiI) cursor += 1;
    const a = pts[cursor]!;
    const bPt = pts[Math.min(cursor + 1, pts.length - 1)]!;
    let value: number;
    if (bPt.psiRow === a.psiRow) {
      value = a.r;
    } else {
      const t = (psiI - a.psiRow) / (bPt.psiRow - a.psiRow);
      value = a.r + t * (bPt.r - a.r);
    }
    rByTexel[i] = value;
  }
  let validTexels = 0;
  for (let i = 0; i < height; i += 1) {
    if (Number.isFinite(rByTexel[i])) validTexels += 1;
    else break;
  }

  return {
    b,
    escapingClass,
    rByTexel,
    validTexels,
    psiDataEnd: dataEnd,
    psiApsis,
    rMin,
    psiCapture,
    truncated,
    terminalDirection: terminal,
    stepsUsed: steps,
    maxConstraintResidual: maxResidual
  };
}

function t01(a: number, bVal: number, target: number): number {
  return (target - a) / (bVal - a);
}

// ---------------------------------------------------------------------------
// Convenience: build the full column set for a family version
// ---------------------------------------------------------------------------

/** Default column count (x resolution). Domain study may override. */
export const DEFAULT_WIDTH = 1024;

/**
 * Non-uniform x sample positions: texel centers mapped through the manifest
 * axis mapping, so generator columns land EXACTLY where runtime bilinear
 * texel centers live (no off-by-half drift between writer and reader).
 */
export function columnXValues(width: number, axisX = DEFAULT_AXIS_X): Float64Array {
  const xs = new Float64Array(width);
  for (let i = 0; i < width; i += 1) {
    xs[i] = uToX((i + 0.5) / width, axisX);
  }
  return xs;
}
