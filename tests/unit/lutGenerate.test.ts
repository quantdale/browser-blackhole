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
    [65520, 0x7c00], // rounds to infinity
    [Infinity, 0x7c00],
    [-Infinity, 0xfc00],
    [Number.NaN, 0x7e00]
  ];
  for (const [value, bits] of cases) {
    it(`maps ${value} to 0x${bits.toString(16)}`, () => {
      expect(floatToHalfBits(value)).toBe(bits);
      if (!Number.isNaN(value)) expect(halfBitsToFloat(bits)).toBe(value);
    });
  }

  it('round-to-nearest-even at the mantissa tie', () => {
    // 0x3881 = 1.0078125 (odd LSB); one ULP less/more ties decide by evenness.
    expect(floatToHalfBits(halfBitsToFloat(0x3881))).toBe(0x3881);
    const tiePlus = halfBitsToFloat(0x3882) + halfBitsToFloat(0x3884);
    // value exactly halfway between 0x3882 and 0x3884 -> rounds to even 0x3882
    expect(floatToHalfBits(tiePlus / 2)).toBe(0x3882);
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
    for (let i = 0; i < src.length; i += 1) expect(dec[i]).toBe(src[i]);
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

function unwrap(angle: number, prev: number): number {
  let a = angle;
  while (a - prev > Math.PI) a -= 2 * Math.PI;
  while (a - prev < -Math.PI) a += 2 * Math.PI;
  return a;
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

    // Oracle trace of the same conserved-b curve from the SAME anchor.
    const { pos, dir } = launch(64, b, 1, true);
    const res = integratePhoton(pos, dir, {
      escapeRadius: 200,
      captureEpsilon: GENERATOR_INTEGRATION_OPTIONS.captureEpsilon,
      maxSteps: 500_000
    });
    expect(res.status).toBe('escaped');

    // Walk oracle samples, unwrap phi, compare radius at matching row coord.
    let prevPhi = 0;
    let checked = 0;
    for (const p of res.pathSamples) {
      const rOracle = Math.hypot(p[0], p[1], p[2]);
      if (rOracle < 3 || rOracle > 63.5) continue; // skip endpoint noise zones
      const rawPhi = Math.atan2(p[1], p[0]);
      prevPhi = checked === 0 ? rawPhi : unwrap(rawPhi, prevPhi);
      const psiRow = Math.abs(prevPhi - col.psiApsis);
      if (psiRow >= col.psiDataEnd) continue;
      // Sample the column linearly at texel resolution.
      const height = col.rByTexel.length;
      const fi = (psiRow / col.psiDataEnd) * col.validTexels - 0.5;
      const i0 = Math.max(0, Math.min(col.validTexels - 1, Math.floor(fi)));
      const i1 = Math.min(col.validTexels - 1, i0 + 1);
      const frac = Math.min(1, Math.max(0, fi - i0));
      const rCol = col.rByTexel[i0]! * (1 - frac) + col.rByTexel[i1]! * frac;
      void height;
      expect(Math.abs(rCol - rOracle)).toBeLessThan(0.02);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('escaping column terminal direction matches the oracle asymptotic exit', () => {
    const b = 8;
    const col = integrateTrajectoryColumn({
      b,
      height: 256,
      psiMax: 16,
      escapeRadiusRg: 32,
      rRefRg: 64
    });
    const { pos, dir } = launch(64, b, 1, true);
    const res = integratePhoton(pos, dir, {
      escapeRadius: 300,
      captureEpsilon: GENERATOR_INTEGRATION_OPTIONS.captureEpsilon
    });
    expect(res.status).toBe('escaped');
    const fp = res.finalPosition;
    const fd = res.finalDirection;
    const rF = Math.hypot(fp[0], fp[1], fp[2]);
    const er: Vec3 = [fp[0] / rF, fp[1] / rF, fp[2] / rF];
    const et: Vec3 = [-fp[1] / rF, fp[0] / rF, 0];
    const nRcpu = fd[0] * er[0] + fd[1] * er[1] + fd[2] * er[2];
    const nTcpu = fd[0] * et[0] + fd[1] * et[1] + fd[2] * et[2];
    // Deflection accumulated between r=32 (column terminal) and the oracle's
    // actual stop radius adds a small tail; tolerance covers it.
    const tail = (4 / b) * (1 - Math.sqrt(Math.max(0, 1 - (b * b) / (rF * rF))));
    expect(tail).toBeLessThan(5e-4);
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

  it('near-critical columns demand more winding and can truncate', () => {
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
    expect(near.truncated).toBe(true); // exceeds the 16-rad cap -> hybrid band
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
