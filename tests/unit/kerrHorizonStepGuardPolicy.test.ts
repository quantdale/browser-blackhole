/**
 * Near-horizon half-step guard policy (design.md D7). The TSL loop in
 * kerrIntegrator.ts cannot be evaluated headlessly, so this test pins the
 * numeric twin of the policy: with the GPU step heuristic (base 0.3) alone,
 * an RK4 stage crosses below r+ before the capture-band check fires and the
 * floored-delta metric blows the state past 1e30 (the browser-observed
 * RAY_NON_FINITE magenta). The guard bounds the full-step radial displacement
 * by the remaining horizon gap so every stage keeps delta > 0.
 *
 * Recorded ray: close-in corpus diag-b4.6 (camera r=10, a*=0.9) from the
 * `?kerrstatus` probe — the exact pixel that failed pre-guard.
 */
import { describe, expect, it } from 'vitest';

import {
  initKerrRay,
  rk4KerrStep,
  type KerrState
} from '../../src/phenomena/black-hole/kerr/reference.js';

const A_STAR = 0.9;
const MASS = 1;
const PROBE_POS: [number, number, number] = [0, 1.5437688027360954, 9.880120337511014];
const PROBE_DIR: [number, number, number] = [
  0.3252691193458118, 0.1842956520541688, -0.9274886051234963
];

const rPlus = MASS + MASS * Math.sqrt(Math.max(1 - A_STAR * A_STAR, 0));
const captureRadius = rPlus + 0.01 * MASS;

/** kerrIntegrator step-size policy (uBaseStep 0.3, uMinStep 0.001, uMaxStep 100). */
function policyStep(r: number, theta: number): number {
  const farScale = Math.max(r / (MASS * 10), 1) ** 1.5;
  const nearScale = Math.min(1, Math.max((r - rPlus) / MASS, 0.02));
  const poleFactor = Math.min(Math.max(Math.abs(Math.sin(theta)), 0.02), 1);
  const h = 0.3 * MASS * farScale * nearScale * poleFactor;
  return Math.min(100 * MASS, Math.max(0.001 * MASS, h));
}

/** kerrIntegrator guard: h <= (r - r+) / max(|delta*pr/sigma|, 1). */
function horizonGuard(r: number, theta: number, pr: number, h: number): number {
  const gap = Math.max(r - rPlus, 0);
  const delta = Math.max(r * r - 2 * MASS * r + A_STAR * A_STAR * MASS * MASS, 0);
  const sigma = Math.max(r * r + A_STAR * A_STAR * MASS * MASS * Math.cos(theta) ** 2, 1e-300);
  const drBound = Math.abs((delta * pr) / sigma);
  return Math.min(h, gap / Math.max(drBound, 1));
}

function runPolicy(guarded: boolean): { reason: string; steps: number } {
  const init = initKerrRay(PROBE_POS, PROBE_DIR, A_STAR, MASS);
  let s: KerrState = { ...init.state };
  let steps = 0;
  while (steps < 100_000) {
    if (s.r <= captureRadius) return { reason: 'captured-band', steps };
    const delta = s.r * s.r - 2 * MASS * s.r + A_STAR * A_STAR * MASS * MASS;
    if (s.pr < 0 && delta / (s.r * s.r + A_STAR * A_STAR * MASS * MASS) < 1e-3) {
      return { reason: 'captured-stall', steps };
    }
    if (s.r > 32 * MASS && s.pr > 0) return { reason: 'escaped', steps };
    const policy = policyStep(s.r, s.theta);
    const h = guarded ? horizonGuard(s.r, s.theta, s.pr, policy) : policy;
    s = rk4KerrStep(s, h, init.energy, init.lZ, A_STAR, MASS);
    steps += 1;
    const bound = 1e30;
    const vals = [s.r, s.theta, s.phi, s.pr, s.ptheta];
    if (vals.some((v) => !Number.isFinite(v) || Math.abs(v) >= bound)) {
      return { reason: 'NON_FINITE', steps };
    }
    if (s.theta < 0 || s.theta > Math.PI) return { reason: `theta-wrap`, steps };
  }
  return { reason: 'max-steps', steps };
}

describe('near-horizon half-step guard policy', () => {
  it('documents the unguarded defect: stages cross below r+ and the step blows up', () => {
    // The oracle reference throws when an RK4 stage evaluates r <= 0; the GPU
    // floors delta instead and lands in the >= 1e30 NON_FINITE status.
    expect(() => runPolicy(false)).toThrow(/radius must be finite and > 0/);
  });

  it('captures the probe ray cleanly when the guard is active', () => {
    const res = runPolicy(true);
    expect(res.reason).toBe('captured-band');
    expect(res.steps).toBeLessThan(5_000);
  });

  it('is inactive in the far field (policy step unchanged at r=10)', () => {
    const policy = policyStep(10, Math.PI / 2);
    const guarded = horizonGuard(10, Math.PI / 2, -1, policy);
    expect(guarded).toBe(policy);
  });

  it('stepwise radial displacement stays within the horizon gap (delta > 0 at every stage)', () => {
    const init = initKerrRay(PROBE_POS, PROBE_DIR, A_STAR, MASS);
    let s: KerrState = { ...init.state };
    for (let steps = 0; steps < 5_000; steps += 1) {
      if (s.r <= captureRadius) return;
      const h = horizonGuard(s.r, s.theta, s.pr, policyStep(s.r, s.theta));
      // Stage bound: each RK4 stage moves r by at most h * |dr| <= gap.
      const delta = Math.max(s.r * s.r - 2 * s.r + A_STAR * A_STAR, 0);
      const sigma = Math.max(s.r * s.r + A_STAR * A_STAR * Math.cos(s.theta) ** 2, 1e-300);
      const drBound = Math.abs((delta * s.pr) / sigma);
      expect(h * Math.max(drBound, 1)).toBeLessThanOrEqual(s.r - rPlus + 1e-12);
      s = rk4KerrStep(s, h, init.energy, init.lZ, A_STAR, MASS);
      // A completed step may land inside the capture band, never below r+ by
      // more than floating-point slack of the bound itself.
      expect(s.r).toBeGreaterThan(rPlus - 1e-9);
    }
    expect.fail('guarded policy must reach the capture band within 5000 steps');
  });
});
