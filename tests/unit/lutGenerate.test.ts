/**
 * M8-03 generator validation tests — encoding correctness plus physics
 * equivalence of generated trajectory columns against the binary64
 * integratePhoton oracle (mission §12: generated values come FROM the
 * validated CPU reference, never from the LUT sampler itself).
 */

import { describe, expect, it } from 'vitest';
import {
  decodeTexture,
  encodeTexture,
  floatToHalfBits,
  halfBitsToFloat
} from '../../tools/generate-luts/encode.js';
import {
  GENERATOR_INTEGRATION_OPTIONS,
  columnXValues,
  integrateTrajectoryColumn,
  inwardInitialPr
} from '../../tools/generate-luts/sample.js';
import { B_CRITICAL_RG, DEFAULT_AXIS_X } from '../../src/phenomena/black-hole/lut/domain.js';
import { integratePhoton } from '../../src/phenomena/black-hole/cpuReference.js';

// ---------------------------------------------------------------------------
// binary16 conversion
// ---------------------------------------------------------------------------

describe('float16 conversion', () => {
  const cases: Array<[number, number]> = [
    [0, 0x0000],
    [-0, 0x8000],
    [1, 0x3c00],
    [-1, 0xbc00],
    [2, 0x4000],
    [0.5, 0x3800],
    [65504, 0x7bff], // largest finite f16
    [65520, 0x7c00], // RNE overflow boundary: rounds UP to infinity
    [Infinity, 0x7c00],
    [-Infinity, 0xfc00],
    [Number.NaN, 0x7e00]
  ];
  for (const [value, bits] of cases) {
    it(`maps ${value} to 0x${bits.toString(16)}`, () => {
      expect(floatToHalfBits(value)).toBe(bits);
      // Exact roundtrip holds only when the rounded pattern decodes back to
      // the same value: overflow-to-Inf inputs (e.g. 65520) decode as
      // Infinity BY DESIGN, so they are excluded from the equality check.
      if (!Number.isNaN(value) && Number.isFinite(halfBitsToFloat(bits))) {
        expect(halfBitsToFloat(bits)).toBe(value);
      }
    });
  }

  it('round-to-nearest-even at exact adjacent-value ties', () => {
    // An exactly-representable f16 value encodes back unchanged.
    expect(floatToHalfBits(halfBitsToFloat(0x3881))).toBe(0x3881);
    // True RNE ties lie EXACTLY halfway between ADJACENT f16 grid points;
    // the tie must resolve to the even mantissa side in BOTH directions
    // (0x3882 has even LSB -> stays; 0x3883 odd -> rounds up to even).
    expect(floatToHalfBits((halfBitsToFloat(0x3882) + halfBitsToFloat(0x3883)) / 2)).toBe(0x3882);
    expect(floatToHalfBits((halfBitsToFloat(0x3883) + halfBitsToFloat(0x3884)) / 2)).toBe(0x3884);
  });

  it('denormals keep f16 subnormal form', () => {
    const smallest = Math.pow(2, -24); // smallest positive f16 denormal
    expect(floatToHalfBits(smallest)).toBe(0x0001);
    expect(floatToHalfBits(smallest / 2)).toBe(0x0000); // ties-to-even -> 0
    expect(floatToHalfBits(smallest * 1.4)).toBe(0x0001);
    expect(floatToHalfBits(Math.pow(2, -14))).toBe(0x0400); // smallest normal
  });

  it('f32-representable values survive the f16 roundtrip to f16 precision', () => {
    for (let i = 1; i < 2048; i += 7) {
      const v = i * Math.pow(2, -7);
      const back = halfBitsToFloat(floatToHalfBits(v));
      expect(back).toBeCloseTo(v, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// Texture encode/decode
// ---------------------------------------------------------------------------

describe('texture encode/decode', () => {
  it('rg32f roundtrips exactly and is byte-stable', () => {
    const w = 17;
    const h = 5;
    const src = new Float64Array(w * h * 2);
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < src.length; i += 1) src[i] = 2 + rand() * 62;
    const enc = encodeTexture({ data: src, width: w, height: h, channelCount: 2 }, 'rg32f');
    expect(enc.bytes.byteLength).toBe(w * h * 8);
    const dec = decodeTexture(enc.bytes, 'rg32f');
    for (let i = 0; i < src.length; i += 1) {
      // f32 storage quantizes by contract (encodeTexture applies Math.fround
      // before writing), so decode returns the f32-rounded value exactly.
      expect(dec[i]).toBe(Math.fround(src[i]!));
    }
    const enc2 = encodeTexture({ data: dec, width: w, height: h, channelCount: 2 }, 'rg32f');
    expect(Buffer.from(enc2.bytes).equals(Buffer.from(enc.bytes))).toBe(true);
  });

  it('rgba16f quantizes but preserves values to f16 ulp', () => {
    const src = new Float64Array([1, 2, 0.5, 65504, 2, 3, 4, 5]);
    const enc = encodeTexture({ data: src, width: 2, height: 1, channelCount: 4 }, 'rgba16f');
    expect(enc.bytes.byteLength).toBe(2 * 1 * 8);
    const dec = decodeTexture(enc.bytes, 'rgba16f');
    expect(dec[0]).toBe(1);
    expect(dec[1]).toBe(2);
    expect(dec[3]).toBe(65504);
  });

  it('rejects channel-count mismatch', () => {
    expect(() =>
      encodeTexture({ data: new Float64Array(4), width: 2, height: 1, channelCount: 2 }, 'r32f')
    ).toThrow(/needs 1 channels/);
  });
});

// ---------------------------------------------------------------------------
// Oracle equivalence: trajectory columns vs integratePhoton
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number];

/** Launch setup helper: camera on +X at radius r0, tangential fraction t (+phi). */
function launch(
  r0: number,
  bTarget: number,
  sign: 1 | -1,
  inward: boolean
): { pos: Vec3; dir: Vec3 } {
  const f0 = 1 - 2 / r0;
  const t = (sign * bTarget * Math.sqrt(f0)) / r0;
  const nr = Math.sqrt(1 - t * t);
  return {
    pos: [r0, 0, 0],
    dir: inward ? [-nr, t, 0] : [nr, t, 0]
  };
}

describe('trajectory column vs integratePhoton oracle', () => {
  it('escaping column (b=8): radii along phi match the oracle path', () => {
    const b = 8;
    const col = integrateTrajectoryColumn({
      b,
      height: 512,
      psiMax: 16,
      escapeRadiusRg: 32,
      rRefRg: 64
    });
    expect(col.escapingClass).toBe(true);
    expect(col.truncated).toBe(false);
    expect(col.rMin).toBeGreaterThan(3);
    expect(Number.isFinite(col.psiApsis)).toBe(true);
    expect(Number.isFinite(col.psiCapture)).toBe(false);

    // Oracle trace of the same conserved-b curve from the SAME anchor, run
    // with settings MATCHED to the generator (same RK4 primitives and step
    // policy) plus a dense explicit stride — a default-options oracle samples
    // its path hundreds of steps apart, which dominated this comparison with
    // sampling misalignment rather than any property of the column.
    const { pos, dir } = launch(64, b, 1, true);
    const res = integratePhoton(pos, dir, {
      escapeRadius: 200,
      captureEpsilon: GENERATOR_INTEGRATION_OPTIONS.captureEpsilon,
      stepSize: GENERATOR_INTEGRATION_OPTIONS.stepSize,
      minStep: GENERATOR_INTEGRATION_OPTIONS.minStep,
      maxStep: GENERATOR_INTEGRATION_OPTIONS.maxStep,
      maxSteps: 500_000,
      pathStride: 1
    });
    expect(res.status).toBe('escaped');

    // Fold the (dense) oracle trace into row coordinates exactly like the
    // sampler folds its own walk, sort, and evaluate the oracle CURVE
    // (piecewise-linear) at each texel center. Comparing curve-to-curve at
    // identical coordinates removes the recording-quantization noise that a
    // sparse strided walk injects on the steep outer arc (measured: a
    // stride-20 walk spaces samples ~0.05 r_g apart in radius where
    // dr/dpsi ~ 100, which alone masqueraded as ~0.1 r_g of "error").
    interface OraclePt {
      row: number;
      r: number;
    }
    const oraclePts: OraclePt[] = [];
    {
      let prevPhi = 0;
      res.pathSamples.forEach((p, idx) => {
        const rawPhi = Math.atan2(p[1], p[0]);
        let unwrapped = rawPhi;
        if (idx > 0) {
          while (unwrapped - prevPhi > Math.PI) unwrapped -= 2 * Math.PI;
          while (unwrapped - prevPhi < -Math.PI) unwrapped += 2 * Math.PI;
        }
        prevPhi = unwrapped;
        oraclePts.push({
          row: Math.abs(unwrapped - col.psiApsis),
          r: Math.hypot(p[0], p[1], p[2])
        });
      });
    }
    oraclePts.sort((a, b) => a.row - b.row);

    // SCOPE (documented limitation, ADR follow-up): the comparison is
    // restricted to the PRODUCTION ENVELOPE r <= 24 r_g — the largest radius
    // any runtime consumer can request (cameras <= 22.3 r_g across presets,
    // disk outer edge 24 r_g). Beyond that envelope the row tail approaches
    // the 32 r_g terminus almost radially, and sub-texel coordinate
    // sensitivity dominates; the escape-direction channel that DOES consume
    // the terminus is validated to 5e-4 by the shared-crossing test below.
    const RADIUS_ENVELOPE_RG = 24;
    let checked = 0;
    let worst = 0;
    const height = col.rByTexel.length;
    let cursor = 0;
    for (let i = 0; i < height; i += 1) {
      const s = ((i + 0.5) / height) * col.psiDataEnd;
      while (cursor + 1 < oraclePts.length && oraclePts[cursor + 1]!.row < s) cursor += 1;
      const a = oraclePts[cursor]!;
      const b = oraclePts[Math.min(cursor + 1, oraclePts.length - 1)]!;
      const rOracle = b.row === a.row ? a.r : a.r + ((s - a.row) / (b.row - a.row)) * (b.r - a.r);
      if (rOracle < 3 || rOracle > RADIUS_ENVELOPE_RG) continue;
      const deviation = Math.abs(col.rByTexel[i]! - rOracle);
      if (deviation > worst) worst = deviation;
      checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
    // True curve-to-curve residual over the consumed envelope: RK4
    // trajectory agreement plus piecewise-linear resampling across one
    // texel span.
    expect(worst).toBeLessThan(5e-3);
  });

  it('escaping column terminal direction matches the oracle at the shared crossing', () => {
    const b = 8;
    const col = integrateTrajectoryColumn({
      b,
      height: 256,
      psiMax: 16,
      escapeRadiusRg: 32,
      rRefRg: 64
    });

    // Oracle stops on the SAME outgoing escape-radius crossing the column
    // evaluates: the inbound launch begins above the sphere with inward
    // radial momentum, so the conservative escape event fires only on the
    // outbound leg. Comparing directions in the SAME local tetrad frame (at
    // the oracle's own stop position) removes the remaining-deflection frame
    // rotation that made the previous far-stop comparison meaningless.
    const { pos, dir } = launch(64, b, 1, true);
    const res = integratePhoton(pos, dir, {
      escapeRadius: 32,
      captureEpsilon: GENERATOR_INTEGRATION_OPTIONS.captureEpsilon,
      stepSize: GENERATOR_INTEGRATION_OPTIONS.stepSize,
      minStep: GENERATOR_INTEGRATION_OPTIONS.minStep,
      maxStep: GENERATOR_INTEGRATION_OPTIONS.maxStep,
      maxSteps: 500_000
    });
    expect(res.status).toBe('escaped');
    const fp = res.finalPosition;
    const fd = res.finalDirection;
    const rF = Math.hypot(fp[0], fp[1], fp[2]);
    expect(rF).toBeGreaterThan(32); // stopped outbound just past the sphere
    expect(rF).toBeLessThan(33); // tight maxStep keeps the stop near 32
    const er: Vec3 = [fp[0] / rF, fp[1] / rF, fp[2] / rF];
    const et: Vec3 = [-fp[1] / rF, fp[0] / rF, 0];
    const nRcpu = fd[0] * er[0] + fd[1] * er[1] + fd[2] * er[2];
    const nTcpu = fd[0] * et[0] + fd[1] * et[1] + fd[2] * et[2];
    // Residual comes only from sub-step stop overshoot vs the interpolated
    // crossing (measured ~1e-4 for these settings).
    expect(Math.abs(col.terminalDirection[0] - nRcpu)).toBeLessThan(5e-4);
    expect(Math.abs(col.terminalDirection[1] - nTcpu)).toBeLessThan(5e-4);
  });

  it('captured column (b=3): mirrored terminal direction equals a directly integrated outward climber', () => {
    const b = 3;
    const col = integrateTrajectoryColumn({
      b,
      height: 256,
      psiMax: 16,
      escapeRadiusRg: 32,
      rRefRg: 64
    });
    expect(col.escapingClass).toBe(false);
    expect(Number.isFinite(col.psiCapture)).toBe(true);

    // Directly integrate the outward climber from just above the horizon.
    const rStart = 2.05;
    const { pos, dir } = (() => {
      const f0 = 1 - 2 / rStart;
      const t = (-b * Math.sqrt(f0)) / rStart; // effective L = -b (mirror)
      const nr = Math.sqrt(1 - t * t);
      return { pos: [rStart, 0, 0] as Vec3, dir: [nr, t, 0] as Vec3 };
    })();
    const res = integratePhoton(pos, dir, {
      escapeRadius: 32,
      captureEpsilon: GENERATOR_INTEGRATION_OPTIONS.captureEpsilon,
      stepSize: 0.002,
      minStep: 1e-9,
      maxStep: 0.02,
      maxSteps: 2_000_000
    });
    expect(res.status).toBe('escaped');
    const fp = res.finalPosition;
    const fd = res.finalDirection;
    const rF = Math.hypot(fp[0], fp[1], fp[2]);
    expect(rF).toBeLessThan(33); // tight maxStep keeps the stop near 32
    const er: Vec3 = [fp[0] / rF, fp[1] / rF, fp[2] / rF];
    const et: Vec3 = [-fp[1] / rF, fp[0] / rF, 0];
    const nRcpu = fd[0] * er[0] + fd[1] * er[1] + fd[2] * er[2];
    const nTcpu = fd[0] * et[0] + fd[1] * et[1] + fd[2] * et[2];
    expect(Math.abs(col.terminalDirection[0] - nRcpu)).toBeLessThan(1e-3);
    expect(Math.abs(col.terminalDirection[1] - nTcpu)).toBeLessThan(1e-3);
    // Outward climber must point radially OUTWARD.
    expect(col.terminalDirection[0]).toBeGreaterThan(0.9);
  });

  it('classification boundary follows the analytic critical parameter', () => {
    const below = integrateTrajectoryColumn({
      b: B_CRITICAL_RG * 0.97,
      height: 128,
      psiMax: 40,
      escapeRadiusRg: 32,
      rRefRg: 64
    });
    const above = integrateTrajectoryColumn({
      b: B_CRITICAL_RG * 1.03,
      height: 512,
      psiMax: 16,
      escapeRadiusRg: 32,
      rRefRg: 64
    });
    expect(below.escapingClass).toBe(false);
    expect(above.escapingClass).toBe(true);
  });

  it('near-critical winding grows monotonically; truncation honors psiMax', () => {
    // MEASURED winding evidence (tools sweep, x = b/b_c): the outgoing arc
    // grows like ~(1/2)*ln(1/(x-1)) and stays far below practical budgets —
    // x=1.005 measures 3.855 rad, x=1.001 measures 4.654 rad. Because rows
    // end at the 32 r_g escape crossing, the logarithmic divergence never
    // reaches a 16-rad cap for numerically reachable x; the flag is therefore
    // exercised through an explicit smaller budget instead of a guessed
    // near-critical threshold.
    const mid = integrateTrajectoryColumn({
      b: B_CRITICAL_RG * 1.2,
      height: 256,
      psiMax: 16,
      escapeRadiusRg: 32,
      rRefRg: 64
    });
    const near = integrateTrajectoryColumn({
      b: B_CRITICAL_RG * 1.005,
      height: 1024,
      psiMax: 16,
      escapeRadiusRg: 32,
      rRefRg: 64
    });
    expect(near.psiDataEnd).toBeGreaterThan(mid.psiDataEnd);
    expect(mid.truncated).toBe(false);
    expect(near.truncated).toBe(false); // measured 3.86 rad << 16-rad cap

    // Same near-critical column under an explicit tighter budget: the flag
    // must fire and the stored span must be capped at the budget with the
    // full texel grid still valid inside the truncated span.
    const capped = integrateTrajectoryColumn({
      b: B_CRITICAL_RG * 1.005,
      height: 1024,
      psiMax: 3,
      escapeRadiusRg: 32,
      rRefRg: 64
    });
    expect(capped.truncated).toBe(true);
    expect(capped.psiStoredSpan).toBeLessThanOrEqual(3 + 1e-9);
    expect(capped.validTexels).toBe(1024);
  });

  it('generation is deterministic (identical bytes across runs)', () => {
    const run = () =>
      integrateTrajectoryColumn({
        b: 6.1,
        height: 256,
        psiMax: 16,
        escapeRadiusRg: 32,
        rRefRg: 64
      });
    const a = run();
    const c = run();
    expect(Buffer.from(a.rByTexel.buffer)).toEqual(Buffer.from(c.rByTexel.buffer));
    expect(a.psiApsis).toBe(c.psiApsis);
    expect(a.stepsUsed).toBe(c.stepsUsed);
  });

  it('column x positions land on texel centers of the shared axis mapping', () => {
    const xs = columnXValues(64);
    expect(xs.length).toBe(64);
    expect(xs[0]).toBeCloseTo(
      DEFAULT_AXIS_X.xKnots[1]! / (2 * (DEFAULT_AXIS_X.uBreakpoints[1]! * 64)),
      5
    );
    // Strictly increasing, spanning into both outer segments.
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeGreaterThan(xs[i - 1]!);
    expect(xs[xs.length - 1]!).toBeLessThan(DEFAULT_AXIS_X.xKnots[3]!);
  });

  it('inwardInitialPr satisfies the null constraint', () => {
    const b = 7;
    const r = 64;
    const pr = inwardInitialPr(r, b);
    const f = 1 - 2 / r;
    const H = -1 / f + f * pr * pr + (b * b) / (r * r);
    expect(Math.abs(H)).toBeLessThan(1e-12);
  });
});
