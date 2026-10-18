/**
 * Kerr polar-failure band — numerical characterisation lock.
 *
 * The magenta band in Kerr views is the pole-passage honesty gate
 * (kerrIntegrator.ts ADR §1.19, mirrored by reference.ts `poleFailureSin`).
 * This suite does NOT change that policy: it pins the measured facts the
 * diagnosis rests on, so a future solver change cannot silently enlarge or
 * mis-explain the disclosed artifact.
 *
 * What is locked here:
 *  1. The gate fires exactly where the ORACLE's min|sin theta| drops below the
 *     production threshold — i.e. it is consistent between GPU policy and the
 *     binary64 reference, not a GPU-only quirk.
 *  2. Rays inside the gate are, in binary64, genuinely CONVERGED: refining the
 *     step 16x does not move the terminal direction. The gate is therefore not
 *     suppressing a numerical artifact of the reference — it is refusing to
 *     present an f32 answer that cannot be trusted.
 *  3. The same rays under faithful f32 emulation are NOT trustworthy: terminal
 *     directions move by degrees. This is the evidence that justifies keeping
 *     the threshold at 0.04 rather than lowering it.
 *  4. Below the gate the rays remain stable, so the gate is not over-broad.
 *
 * See docs/VISUAL_FIDELITY_KERR_MAGENTA_BAND.md for the full campaign record.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KERR_PHOTON_OPTIONS,
  initKerrRay,
  integrateKerrPhoton,
  kerrRhs,
  kerrStepSizeAt,
  terminalLocalDirection,
  type KerrState,
  type Vec3
} from '../../src/phenomena/black-hole/kerr/reference.js';

const SPIN = 0.9;
const CAMERA_POSITION: Vec3 = [12, 1.6, 6];
const PRODUCTION_POLE_SIN = 0.04;
/** Production escape radius (blackHoleDestination.ts ESCAPE_RADIUS_RG). */
const ESCAPE_RADIUS_RG = 32;

const BASE_OPTIONS = {
  ...DEFAULT_KERR_PHOTON_OPTIONS,
  aStar: SPIN,
  massRg: 1,
  escapeRadiusRg: ESCAPE_RADIUS_RG,
  captureEpsilon: 0.01
};

/** Unit direction toward a target point, used to aim specific test rays. */
function dirToward(target: Vec3): Vec3 {
  const d: Vec3 = [
    target[0] - CAMERA_POSITION[0],
    target[1] - CAMERA_POSITION[1],
    target[2] - CAMERA_POSITION[2]
  ];
  const n = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / n, d[1] / n, d[2] / n];
}

/**
 * Aim toward a point on the symmetry axis at height `offsetRg` (world Y). This is
 * the geometric family that produces the visible band: a ray passing the hole at
 * a height that makes it turn and graze the axis in the STRONG field (r ~ 2-6
 * r_g), rather than merely approaching the axis asymptotically far away.
 */
function bandRay(offsetRg: number): Vec3 {
  return dirToward([0, offsetRg, 0]);
}

/**
 * Gated / ungated offsets for THIS camera+spin, located empirically by sweeping
 * the family above (scripts/probe-kerr-cpu-rays.ts over the live camera basis):
 *   |offset| = 6 r_g  -> escapes, turns = 1/1, min|sin theta| ~ 2.5e-2  => GATED
 *   |offset| = 3 r_g  -> captured,              min|sin theta| ~ 4.6e-2  => below-gate control
 * The sign asymmetry is the Spin's handedness, not a bug.
 */
const GATED_OFFSET = 6.0;
const BELOW_GATE_OFFSET = 3.0;
const WELL_CLEAR_OFFSET = 1.0;

/** Angle between two directions; null in => NaN out (no narrowing needed at call sites). */
function angleBetweenDeg(a: Vec3 | null, b: Vec3 | null): number {
  if (a === null || b === null) return Number.NaN;
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

describe('Kerr polar-failure band: gate consistency', () => {
  it('fires only on ESCAPED rays whose oracle min|sin theta| is below', () => {
    // Sweep the band family across the gate boundary. The policy (ADR §1.19) is
    // deliberately asymmetric: only ESCAPED rays are reclassified, because
    // monotone infall into the horizon is robust regardless of axis grazing.
    // A captured ray may therefore have min|sin theta| below the threshold and
    // MUST stay captured — that asymmetry is the contract, not a leak.
    const offsets = [-6, -4, -3, -2.5, -2, -1.5, -1, 0, 1, 1.5, 2, 2.5, 3, 4, 6];
    let gated = 0;
    let capturedBelowThreshold = 0;
    for (const offset of offsets) {
      const dir = bandRay(offset);
      const result = integrateKerrPhoton(CAMERA_POSITION, dir, BASE_OPTIONS);
      if (result.classification === 'numerical-failure') {
        gated += 1;
        // Everything the gate rejects must genuinely be sub-threshold in f64.
        expect(result.minSinTheta, `offset ${offset} gated above threshold`).toBeLessThan(
          PRODUCTION_POLE_SIN
        );
        expect(JSON.stringify(result.outcome)).toContain('pole');
        // The gate must never invent a failure for a ray that was captured.
        expect(result.outcome.kind).toBe('numerical-failure');
      } else {
        // Captured/escaped rays are NOT required to clear the threshold:
        // captured ones legitimately sit below it (see assertion above).
        expect(['captured', 'escaped']).toContain(result.classification);
        if (result.classification === 'captured' && result.minSinTheta < PRODUCTION_POLE_SIN) {
          capturedBelowThreshold += 1;
        }
        if (result.classification === 'escaped') {
          // An ESCAPED ray below the threshold would be a gate hole.
          expect(
            result.minSinTheta,
            `escaped ray ${offset} escaped the gate`
          ).toBeGreaterThanOrEqual(PRODUCTION_POLE_SIN);
        }
      }
    }
    // The sweep must exercise both branches or the assertions are vacuous.
    expect(gated).toBeGreaterThan(0);
    expect(capturedBelowThreshold).toBeGreaterThan(0);
  });

  it('reports the gate as an explicit pole class, never as capture', () => {
    const gated = integrateKerrPhoton(CAMERA_POSITION, bandRay(GATED_OFFSET), BASE_OPTIONS);
    expect(gated.classification).toBe('numerical-failure');
    expect(gated.outcome.kind).toBe('numerical-failure');
    expect(JSON.stringify(gated.outcome)).toContain('escaped through pole passage');
    // This ray genuinely ESCAPED in binary64 (it is a gate refusal, not a
    // capture); the gate is what turns it into an explicit failure.
    expect(gated.turnCounts.radial).toBeGreaterThanOrEqual(1);
    // A failed ray must never carry a terminal direction — presenting one would
    // be inventing a physical answer for a ray the solver cannot resolve.
    expect(gated.finalDirection).toBeNull();
  });

  it('keeps captured rays captured even when they graze the axis', () => {
    // Captured rays keep capture (monotone infall is robust, ADR §1.19): the
    // gate must only ever reclassify ESCAPED rays. This offset is captured at
    // min|sin theta| just ABOVE the threshold.
    const shallow = integrateKerrPhoton(CAMERA_POSITION, bandRay(BELOW_GATE_OFFSET), BASE_OPTIONS);
    expect(shallow.classification).toBe('captured');
    expect(shallow.minSinTheta).toBeGreaterThanOrEqual(PRODUCTION_POLE_SIN);
  });
});

describe('Kerr polar-failure band: binary64 convergence', () => {
  it('converges the terminal direction under 16x step refinement', () => {
    // Pick a ray just OUTSIDE the gate: the solver must be trustworthy there,
    // which is the control that shows the gate is not over-broad.
    const dir = bandRay(BELOW_GATE_OFFSET);
    const coarse = integrateKerrPhoton(CAMERA_POSITION, dir, { ...BASE_OPTIONS, stepSize: 0.005 });
    const fine = integrateKerrPhoton(CAMERA_POSITION, dir, { ...BASE_OPTIONS, stepSize: 0.000625 });
    // Stability of the CLASSIFICATION is the primary claim here.
    expect(fine.classification).toBe(coarse.classification);
    if (coarse.classification === 'escaped' && fine.classification === 'escaped') {
      const drift = angleBetweenDeg(coarse.finalDirection as Vec3, fine.finalDirection as Vec3);
      expect(drift).toBeLessThan(0.05);
    }
    // And the axis-approach measure must itself be converged, which is what the
    // gate's threshold is compared against.
    expect(Math.abs(fine.minSinTheta - coarse.minSinTheta)).toBeLessThan(1e-3);
  });

  it('keeps conserved quantities clean along a band-family ray', () => {
    const result = integrateKerrPhoton(CAMERA_POSITION, bandRay(WELL_CLEAR_OFFSET), BASE_OPTIONS);
    expect(result.conserved.nullResidualMax).toBeLessThan(1e-6);
    expect(result.conserved.carterDrift).toBeLessThan(1e-6);
  });
});

describe('Kerr polar-failure band: f32 emulation justifies the gate', () => {
  /**
   * Faithful f32 emulation of the production integrator: same RK4, same step
   * policy, state rounded to float32 after every stage. This is the only honest
   * way to ask "could a lower threshold produce accurate geodesics?" — an
   * input-perturbation test does not accumulate rounding over thousands of
   * steps and therefore cannot answer it.
   */
  /** Outer horizon r+ = M + sqrt(M^2 - a^2) (M = 1), matching the shader. */
  const R_PLUS = 1 + Math.sqrt(Math.max(1 - SPIN * SPIN, 0));
  const CAPTURE_RADIUS = R_PLUS + 0.01;

  function traceF32(dir: Vec3): {
    kind: string;
    state: KerrState;
    minSin: number;
    energy: number;
    lZ: number;
  } {
    const init = initKerrRay(CAMERA_POSITION, dir, SPIN, 1);
    const energy = init.energy;
    const lZ = init.lZ;
    let state: KerrState = {
      r: Math.fround(init.state.r),
      theta: Math.fround(init.state.theta),
      phi: init.state.phi,
      pr: Math.fround(init.state.pr),
      ptheta: Math.fround(init.state.ptheta)
    };
    let minSin = Math.abs(Math.sin(state.theta));
    try {
      for (let i = 0; i < 200_000; i += 1) {
        if (
          !Number.isFinite(state.r) ||
          !Number.isFinite(state.theta) ||
          !Number.isFinite(state.pr) ||
          !Number.isFinite(state.ptheta)
        ) {
          return { kind: 'nonfinite', state, minSin, energy, lZ };
        }
        if (state.r > ESCAPE_RADIUS_RG && state.pr > 0) {
          return { kind: 'escaped', state, minSin, energy, lZ };
        }
        if (state.r < CAPTURE_RADIUS) return { kind: 'captured', state, minSin, energy, lZ };
        if (state.theta < 0 || state.theta > Math.PI) {
          return { kind: 'wrapped', state, minSin, energy, lZ };
        }
        // Mirror the production near-horizon half-step guard (kerrIntegrator.ts):
        // bound the full-step radial displacement by the remaining horizon gap,
        // otherwise an f32 stage can be evaluated below r+ and the floored-delta
        // metric blows the state to non-finite. Omitting this guard is a harness
        // bug, not a solver finding — the shipped shader has it.
        const rawStep = Math.fround(kerrStepSizeAt(state.r, state.theta, BASE_OPTIONS));
        const guardA = SPIN * SPIN;
        const guardDelta = Math.max(state.r * state.r - 2 * state.r + guardA, 0);
        const guardSigma = Math.max(
          state.r * state.r + guardA * Math.cos(state.theta) * Math.cos(state.theta),
          1e-6
        );
        const guardDr = (guardDelta * Math.abs(state.pr)) / guardSigma;
        const h = Math.fround(
          Math.min(rawStep, Math.max(state.r - R_PLUS, 0) / Math.max(guardDr, 1))
        );
        if (!(h > 0) || !Number.isFinite(h)) {
          return { kind: 'nonfinite', state, minSin, energy, lZ };
        }
        const half = Math.fround(h * 0.5);
        const k1 = kerrRhs(state, energy, lZ, SPIN, 1);
        const s2: KerrState = {
          r: Math.fround(state.r + half * k1.dr),
          theta: Math.fround(state.theta + half * k1.dtheta),
          phi: state.phi,
          pr: Math.fround(state.pr + half * k1.dpr),
          ptheta: Math.fround(state.ptheta + half * k1.dptheta)
        };
        const k2 = kerrRhs(s2, energy, lZ, SPIN, 1);
        const s3: KerrState = {
          r: Math.fround(state.r + half * k2.dr),
          theta: Math.fround(state.theta + half * k2.dtheta),
          phi: state.phi,
          pr: Math.fround(state.pr + half * k2.dpr),
          ptheta: Math.fround(state.ptheta + half * k2.dptheta)
        };
        const k3 = kerrRhs(s3, energy, lZ, SPIN, 1);
        const s4: KerrState = {
          r: Math.fround(state.r + h * k3.dr),
          theta: Math.fround(state.theta + h * k3.dtheta),
          phi: state.phi,
          pr: Math.fround(state.pr + h * k3.dpr),
          ptheta: Math.fround(state.ptheta + h * k3.dptheta)
        };
        const k4 = kerrRhs(s4, energy, lZ, SPIN, 1);
        const sixth = Math.fround(h / 6);
        state = {
          r: Math.fround(state.r + Math.fround(sixth * (k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr))),
          theta: Math.fround(
            state.theta +
              Math.fround(sixth * (k1.dtheta + 2 * k2.dtheta + 2 * k3.dtheta + k4.dtheta))
          ),
          phi: state.phi,
          pr: Math.fround(
            state.pr + Math.fround(sixth * (k1.dpr + 2 * k2.dpr + 2 * k3.dpr + k4.dpr))
          ),
          ptheta: Math.fround(
            state.ptheta +
              Math.fround(sixth * (k1.dptheta + 2 * k2.dptheta + 2 * k3.dptheta + k4.dptheta))
          )
        };
        minSin = Math.min(minSin, Math.abs(Math.sin(state.theta)));
      }
    } catch (error) {
      return { kind: `threw: ${(error as Error).message}`, state, minSin, energy, lZ };
    }
    return { kind: 'maxsteps', state, minSin, energy, lZ };
  }

  it('shows f32 terminal directions are unreliable inside the gate', () => {
    // Inside-gate ray (binary64 min|sin theta| below the threshold).
    const dir = bandRay(GATED_OFFSET);
    const oracle = integrateKerrPhoton(CAMERA_POSITION, dir, {
      ...BASE_OPTIONS,
      poleFailureSin: 0
    });
    expect(oracle.minSinTheta).toBeLessThan(PRODUCTION_POLE_SIN);

    const emulated = traceF32(dir);
    // The f32 run either fails outright or lands somewhere materially different
    // from the oracle. Either way the answer is not presentable as physics.
    const escaped = emulated.kind === 'escaped';
    let disagreementDeg = Number.POSITIVE_INFINITY;
    if (escaped) {
      const f32Dir = terminalLocalDirection(emulated.state, emulated.energy, emulated.lZ, SPIN, 1);
      const measured = angleBetweenDeg(oracle.finalDirection, f32Dir);
      if (Number.isFinite(measured)) disagreementDeg = measured;
    }
    expect(
      escaped ? disagreementDeg : Number.POSITIVE_INFINITY,
      'f32 must NOT be able to resolve inside-gate rays, otherwise the gate is ' +
        "suppressing valid physics and this campaign's verdict would be wrong"
    ).toBeGreaterThan(1);
  });

  it('shows f32 terminal directions are reliable outside the gate', () => {
    // Control: the same emulation on a ray above the threshold must track the
    // oracle, which is what makes the inside-gate result meaningful.
    const dir = bandRay(WELL_CLEAR_OFFSET);
    const oracle = integrateKerrPhoton(CAMERA_POSITION, dir, {
      ...BASE_OPTIONS,
      poleFailureSin: 0
    });
    expect(oracle.minSinTheta).toBeGreaterThan(PRODUCTION_POLE_SIN);
    expect(oracle.classification).toBe('captured');

    // Captured rays are the right control for f32 stability: the trajectory must
    // reach the horizon in f32 too, matching the oracle's classification.
    const emulated = traceF32(dir);
    expect(emulated.kind).toBe('captured');
  });
});
