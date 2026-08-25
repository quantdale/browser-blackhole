/**
 * M10 — Observer frame core validation (OBSERVER_FRAME_ADR + campaign §15).
 *
 * Gates tested here (CPU binary64 reference layer):
 * - TETRAD: orthonormality, u-orthogonality, photon null constraint by
 *   construction, static-mode EXACT equivalence with the validated
 *   initKerrRay decomposition (the compatibility anchor);
 * - MODES: circular kinetics vs Schwarzschild closed forms and spin->0
 *   limits; freefall/flyby conserved quantities, constraint drift,
 *   determinism/replay, horizon stop-band terminal state;
 * - RELATIVITY: SR aberration/longitudinal energy transformation recovered
 *   from the full tetrad construction in the flat-space limit;
 * - DOMAINS: truthful invalid reasons (ergosphere, on-axis, no-orbit).
 */

import { describe, expect, it } from 'vitest';

import { initKerrRay } from '../../src/phenomena/black-hole/kerr/reference.js';
import {
  kerrIscoRadius,
  kerrPhotonOrbitRadius
} from '../../src/phenomena/black-hole/kerr/characteristics.js';
import { metricInner } from '../../src/phenomena/black-hole/observer/metric.js';
import { staticOrthonormalTriad } from '../../src/phenomena/black-hole/observer/metric.js';
import {
  buildObserverTetrad,
  coordinateVectorToWorldDirection,
  type CameraAxisDirections
} from '../../src/phenomena/black-hole/observer/tetrad.js';
import { buildObserverFrameSnapshot } from '../../src/phenomena/black-hole/observer/snapshot.js';
import {
  circularKinetics,
  seedFlyby,
  seedFreefall
} from '../../src/phenomena/black-hole/observer/worldlines.js';

function sub3(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize3(v: readonly [number, number, number]): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Camera axes looking from `position` toward the origin (+Y-ish up). */
function axesLookingAt(position: readonly [number, number, number]): CameraAxisDirections {
  const forward = normalize3(sub3([0, 0, 0], position));
  const right = normalize3(cross3(forward, Math.abs(forward[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]));
  const up = cross3(right, forward);
  return { right, up, forward };
}

interface SnapshotArgs {
  mode: 'camera' | 'static' | 'circular' | 'flyby' | 'freefall';
  metricId?: 'schwarzschild' | 'kerr';
  effectiveSpin?: number;
  properTimeTau?: number;
  cameraPositionWorld?: [number, number, number];
  cameraAxes?: CameraAxisDirections;
  circularRadiusRg?: number;
  circularSense?: 1 | -1;
  geodesicWorldline?: Parameters<typeof buildObserverFrameSnapshot>[0]['geodesicWorldline'];
}

function makeRequest(args: SnapshotArgs): Parameters<typeof buildObserverFrameSnapshot>[0] {
  return {
    mode: args.mode,
    metricId: args.metricId ?? 'kerr',
    effectiveSpin: args.effectiveSpin ?? 0,
    properTimeTau: args.properTimeTau ?? 0,
    cameraPositionWorld: args.cameraPositionWorld ?? [16, 2.5, 8],
    cameraAxes: args.cameraAxes ?? axesLookingAt(args.cameraPositionWorld ?? [16, 2.5, 8]),
    circularRadiusRg: args.circularRadiusRg ?? Number.NaN,
    circularSense: args.circularSense ?? 1,
    circularPhi0Rad: 0,
    geodesicWorldline: args.geodesicWorldline ?? null
  };
}

describe('M10 observer tetrads', () => {
  it('static mode reproduces the validated initKerrRay decomposition exactly', () => {
    // Align the camera axes with the STATIC orthonormal triad at the event;
    // with beta = 0 the projector is the identity on the rest space, so our
    // legs must equal the ADR section 1.8 legs and the extracted conserved
    // quantities must match initKerrRay's closed forms for n = (n1,n2,n3).
    const cases: Array<{ pos: [number, number, number]; aStar: number }> = [
      { pos: [16, 2.5, 0], aStar: 0 },
      { pos: [10, 4, 6], aStar: 0 },
      { pos: [12, 0.5, 9], aStar: 0.9 },
      { pos: [14, 3, -7], aStar: -0.7 }
    ];
    for (const c of cases) {
      const probe = buildObserverFrameSnapshot(
        makeRequest({ mode: 'static', effectiveSpin: c.aStar, cameraPositionWorld: c.pos })
      );
      expect(probe.snapshot.valid).toBe(true);
      const ctx = {
        metric: 'kerr' as const,
        effectiveSpin: c.aStar,
        r: probe.snapshot.radiusRg,
        theta: probe.snapshot.thetaRad,
        phiWorldRad: probe.snapshot.phiWorldRad
      };
      const triad = staticOrthonormalTriad(ctx)!;
      const worldDirs = triad.map((leg) => coordinateVectorToWorldDirection(leg, ctx));
      const alignedAxes = worldDirs.map((w) => normalize3(w as [number, number, number]));
      const built = buildObserverFrameSnapshot(
        makeRequest({
          mode: 'static',
          effectiveSpin: c.aStar,
          cameraPositionWorld: c.pos,
          cameraAxes: {
            right: alignedAxes[0]!,
            up: alignedAxes[1]!,
            forward: alignedAxes[2]!
          }
        })
      );
      expect(built.snapshot.valid).toBe(true);
      const u = built.snapshot.fourVelocity!;
      const legs = built.snapshot.tetradLegs!;

      // Metric pieces at the event:
      const sigma = ctx.r ** 2 + c.aStar ** 2 * Math.cos(ctx.theta) ** 2;
      const delta = ctx.r ** 2 - 2 * ctx.r + c.aStar ** 2;
      const sinTheta = Math.sin(ctx.theta);
      const bigA = (ctx.r ** 2 + c.aStar ** 2) ** 2 - c.aStar ** 2 * delta * sinTheta ** 2;
      const gTT = -(1 - (2 * ctx.r) / sigma);
      const gTPh = (-2 * ctx.r * c.aStar * sinTheta ** 2) / sigma;
      const gPhPh = (bigA * sinTheta ** 2) / sigma;

      for (const n of [
        [1, 0, 0],
        [-0.3, 0.2, 0.9],
        [0.05, -0.9, 0.1]
      ] as const) {
        const nn = normalize3(n);
        const k = {
          t: u.t + nn[0] * legs[0].t + nn[1] * legs[1].t + nn[2] * legs[2].t,
          r: u.r + nn[0] * legs[0].r + nn[1] * legs[1].r + nn[2] * legs[2].r,
          th: u.th + nn[0] * legs[0].th + nn[1] * legs[1].th + nn[2] * legs[2].th,
          ph: u.ph + nn[0] * legs[0].ph + nn[1] * legs[1].ph + nn[2] * legs[2].ph
        };
        const energyMine = -(gTT * k.t + gTPh * k.ph);
        const lZMine = gTPh * k.t + gPhPh * k.ph;
        const prMine = (sigma / delta) * k.r;
        const pthetaMine = sigma * k.th;

        // initKerrRay consumes a WORLD direction; hand it the world direction
        // of local frame axis 3 rotated into the requested n by combining the
        // triad's world directions (linear combination of orthonormal axes).
        const w = normalize3([
          nn[0] * alignedAxes[0]![0] + nn[1] * alignedAxes[1]![0] + nn[2] * alignedAxes[2]![0],
          nn[0] * alignedAxes[0]![1] + nn[1] * alignedAxes[1]![1] + nn[2] * alignedAxes[2]![1],
          nn[0] * alignedAxes[0]![2] + nn[1] * alignedAxes[1]![2] + nn[2] * alignedAxes[2]![2]
        ]);
        const reference = initKerrRay(c.pos, w, c.aStar);
        expect(energyMine).toBeCloseTo(reference.energy, 10);
        expect(lZMine).toBeCloseTo(reference.lZ, 9);
        expect(prMine).toBeCloseTo(reference.state.pr, 9);
        expect(pthetaMine).toBeCloseTo(reference.state.ptheta, 9);
      }
    }
  });

  it('tetrad legs are orthonormal, orthogonal to u, and photons stay null', () => {
    const drop = seedFreefall(0.6, 12);
    expect(drop.ok).toBe(true);
    if (drop.ok) drop.worldline.advance(20);

    const cases = [
      makeRequest({ mode: 'static', effectiveSpin: 0.9, cameraPositionWorld: [14, 3, -7] }),
      makeRequest({ mode: 'camera', effectiveSpin: 0, cameraPositionWorld: [18, 4, 2] }),
      makeRequest({
        mode: 'freefall',
        effectiveSpin: 0.6,
        properTimeTau: 20,
        geodesicWorldline: drop.ok ? drop.worldline : null
      })
    ];

    for (const request of cases) {
      const built = buildObserverFrameSnapshot(request);
      expect(built.snapshot.valid).toBe(true);
      const u = built.snapshot.fourVelocity!;
      const legs = built.snapshot.tetradLegs!;
      const ctx = {
        metric: request.metricId,
        effectiveSpin: request.effectiveSpin,
        r: built.snapshot.radiusRg,
        theta: built.snapshot.thetaRad,
        phiWorldRad: built.snapshot.phiWorldRad
      };
      expect(metricInner(ctx, u, u)).toBeCloseTo(-1, 9);
      for (let i = 0; i < 3; i += 1) {
        const li = legs[i]!;
        expect(Math.abs(metricInner(ctx, u, li))).toBeLessThan(1e-9);
        for (let j = 0; j < 3; j += 1) {
          const expected = i === j ? 1 : 0;
          expect(metricInner(ctx, li, legs[j]!)).toBeCloseTo(expected, 9);
        }
      }
      for (const raw of [
        [0, 0, 1],
        [0.3, -0.4, 0.5],
        [-0.8, 0.1, 0.2]
      ] as const) {
        const nn = normalize3(raw);
        const k = {
          t: u.t + nn[0] * legs[0].t + nn[1] * legs[1].t + nn[2] * legs[2].t,
          r: u.r + nn[0] * legs[0].r + nn[1] * legs[1].r + nn[2] * legs[2].r,
          th: u.th + nn[0] * legs[0].th + nn[1] * legs[1].th + nn[2] * legs[2].th,
          ph: u.ph + nn[0] * legs[0].ph + nn[1] * legs[1].ph + nn[2] * legs[2].ph
        };
        expect(Math.abs(metricInner(ctx, k, k))).toBeLessThan(1e-9);
        expect(metricInner(ctx, k, u)).toBeCloseTo(-1, 9);
      }
    }
  });

  it('flat-space limit recovers SR aberration and the longitudinal energy shift', () => {
    const beta = 0.5;
    const gamma = 1 / Math.sqrt(1 - beta * beta);
    const ctx = {
      metric: 'schwarzschild' as const,
      effectiveSpin: 0,
      r: 1e12,
      theta: Math.PI / 2,
      phiWorldRad: 0
    };
    const u = { t: gamma, r: gamma * beta, th: 0, ph: 0 };
    // forward = motion direction (+x); right/up span the transverse plane.
    const axes: CameraAxisDirections = {
      right: [0, 1, 0],
      up: [0, 0, 1],
      forward: [1, 0, 0]
    };
    const legs = buildObserverTetrad(u, axes, ctx);
    expect(legs).not.toBeNull();

    const checkPhoton = (rawN: readonly [number, number, number]): void => {
      const nStatic = normalize3(rawN);
      // Static-frame photon built with the SAME axis convention as the moving
      // observer (camera-aligned static legs at beta -> 0), so n are genuine
      // local-frame components in both frames.
      const uStatic0 = { t: 1, r: 0, th: 0, ph: 0 };
      const staticLegs = buildObserverTetrad(uStatic0, axes, ctx)!;
      const k = {
        t: uStatic0.t,
        // Local-component pairing: x <-> forward leg [2], y <-> right [0],
        // z <-> up [1].
        r:
          uStatic0.r +
          nStatic[1] * staticLegs[0].r +
          nStatic[2] * staticLegs[1].r +
          nStatic[0] * staticLegs[2].r,
        th:
          uStatic0.th +
          nStatic[1] * staticLegs[0].th +
          nStatic[2] * staticLegs[1].th +
          nStatic[0] * staticLegs[2].th,
        ph:
          uStatic0.ph +
          nStatic[1] * staticLegs[0].ph +
          nStatic[2] * staticLegs[1].ph +
          nStatic[0] * staticLegs[2].ph
      };
      // Measured photon energy fixes the local scale: nu' = -k.u.
      const nuObs = -metricInner(ctx, k, u);
      // Observer-frame DIRECTION: k = nu'(u + n') => n'_a = (k.A_a)/nu'.
      const nObs = legs!.map((leg) => metricInner(ctx, k, leg) / nuObs) as unknown as [
        number,
        number,
        number
      ];
      // legs[2] = forward -> motion direction (+x); 0/1 transverse:
      const expectedParallel = (nStatic[0] - beta) / (1 - beta * nStatic[0]);
      expect(nuObs).toBeCloseTo(gamma * (1 - beta * nStatic[0]), 8);
      expect(nObs[2]).toBeCloseTo(expectedParallel, 8);
      const scale = gamma * (1 - beta * nStatic[0]);
      expect(nObs[0]).toBeCloseTo(nStatic[1] / scale, 8);
      expect(nObs[1]).toBeCloseTo(nStatic[2] / scale, 8);
      expect(Math.hypot(nObs[0], nObs[1], nObs[2])).toBeCloseTo(1, 8);
    };

    checkPhoton([1, 0, 0]);
    checkPhoton([-1, 0, 0]);
    checkPhoton([0, 0.6, 0.8]);
    checkPhoton([0.5, 0.5, 0.5]);
  });
});

describe('M10 physical circular observer', () => {
  it('matches Schwarzschild closed forms and is sense-symmetric at a*=0', () => {
    const omega = circularKinetics(0, 8, 1);
    expect(omega.valid).toBe(true);
    expect(omega.omega).toBeCloseTo(Math.pow(8, -1.5), 14);
    expect(omega.uT).toBeCloseTo(1 / Math.sqrt(1 - 3 / 8), 14);
    const retro = circularKinetics(0, 8, -1);
    expect(retro.omega).toBeCloseTo(-omega.omega, 14);
    expect(retro.uT).toBeCloseTo(omega.uT, 14);
    expect(circularKinetics(0, 3, 1).valid).toBe(false);
    expect(circularKinetics(0, 3.0000001, 1).valid).toBe(true);
    expect(circularKinetics(0, 8, 1).photonOrbitRadiusRg).toBeCloseTo(3, 12);
    expect(circularKinetics(0, 8, 1).iscoRadiusRg).toBeCloseTo(kerrIscoRadius(0), 12);
  });

  it('frame dragging shifts prograde/retrograde branches per BPT at fixed r', () => {
    // At FIXED r, BPT eq 2.16 gives Omega = s/(r^{3/2} + s a*): prograde
    // Omega DROPS below the a*=0 value while |Omega_retrograde| RISES.
    const a = 0.6;
    const r = 9;
    const schwarzschildOmega = Math.pow(r, -1.5);
    const prograde = circularKinetics(a, r, 1);
    const retrograde = circularKinetics(a, r, -1);
    expect(prograde.valid).toBe(true);
    expect(retrograde.valid).toBe(true);
    expect(prograde.omega).toBeLessThan(schwarzschildOmega);
    expect(retrograde.omega).toBeLessThan(-schwarzschildOmega);
    expect(prograde.omega).toBeCloseTo(1 / (Math.pow(r, 1.5) + a), 14);
    expect(retrograde.omega).toBeCloseTo(-1 / (Math.pow(r, 1.5) - a), 14);
    expect(prograde.photonOrbitRadiusRg).toBeCloseTo(kerrPhotonOrbitRadius(a), 12);
    expect(retrograde.photonOrbitRadiusRg).toBeCloseTo(kerrPhotonOrbitRadius(-a), 12);
    expect(prograde.iscoRadiusRg).toBeCloseTo(kerrIscoRadius(a), 12);
    expect(retrograde.iscoRadiusRg).toBeCloseTo(kerrIscoRadius(-a), 12);
  });

  it('u.mu u^mu = -1 against the RAW metric for both senses/spins', () => {
    for (const aStar of [0, 0.6, -0.7]) {
      for (const sense of [1, -1] as const) {
        const r = Math.max(kerrPhotonOrbitRadius(sense * aStar) + 1.5, 4);
        const k = circularKinetics(aStar, r, sense);
        expect(k.valid).toBe(true);
        const u = { t: k.uT, r: 0, th: 0, ph: k.omega * k.uT };
        const ctx = {
          metric: 'kerr' as const,
          effectiveSpin: aStar,
          r,
          theta: Math.PI / 2,
          phiWorldRad: 0
        };
        expect(metricInner(ctx, u, u)).toBeCloseTo(-1, 9);
      }
    }
  });

  it('circular snapshot carries disclosure state and rejects no-orbit radii', () => {
    const a = 0.6;
    const sense = 1;
    const isco = kerrIscoRadius(a);
    const rStable = isco + 2;
    const kinetics = circularKinetics(a, rStable, sense);
    const built = buildObserverFrameSnapshot(
      makeRequest({
        mode: 'circular',
        effectiveSpin: a,
        circularRadiusRg: rStable,
        circularSense: sense,
        properTimeTau: 3
      }),
      { omega: kinetics.omega, unstable: false }
    );
    expect(built.snapshot.valid).toBe(true);
    expect(built.snapshot.circularUnstable).toBe(false);
    expect(built.snapshot.radiusRg).toBeCloseTo(rStable, 12);
    expect(built.snapshot.betaMagnitude).toBeGreaterThan(0);
    expect(built.snapshot.betaMagnitude).toBeLessThan(1);

    const invalid = buildObserverFrameSnapshot(
      makeRequest({
        mode: 'circular',
        effectiveSpin: a,
        circularRadiusRg: kerrPhotonOrbitRadius(a) - 0.1,
        circularSense: sense
      })
    );
    expect(invalid.snapshot.valid).toBe(false);
    expect(invalid.snapshot.invalidReason).toBe('no-circular-orbit-below-photon-orbit');
  });
});

describe('M10 flyby/freefall worldlines', () => {
  it('freefall conserves formulation parameters and lands in the stop band', () => {
    const seeded = seedFreefall(0.6, 14);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const wl = seeded.worldline;
    let last = wl.sample();
    let steps = 0;
    while (wl.status === 'running' && steps < 60000) {
      wl.advance(0.05);
      last = wl.sample();
      steps += 1;
      expect(last.constraintDrift).toBeLessThan(1e-6);
      expect(Number.isFinite(last.position.r)).toBe(true);
      expect(last.u.t).toBeGreaterThan(0);
    }
    expect(wl.status).toBe('horizon-approach');
    const stopBand = (1 + Math.sqrt(1 - 0.36)) * (1 + 1e-3);
    expect(last.position.r).toBeLessThanOrEqual(stopBand + 1e-6);

    // Determinism/replay: identical chunked advance sequence -> bit-identical
    // trajectory (a single mega-call would truncate at the substep cap).
    const replay = seedFreefall(0.6, 14);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    for (let s = 0; s < steps; s += 1) replay.worldline.advance(0.05);
    const replaySample = replay.worldline.sample();
    expect(replaySample.status).toBe('horizon-approach');
    expect(replaySample.position.r).toBe(last.position.r);
    expect(replaySample.coordinateTime).toBe(last.coordinateTime);
    expect(replaySample.tau).toBe(last.tau);
  });

  it('flyby scatters back out and its periastron converges under step halving', () => {
    // E = 1.5 with L_z = 10 turns outside r ~ 7 (a genuine scattering orbit;
    // L_z = 4.5 at this energy would capture instead).
    const run = (advancePerCall: number): { minR: number; status: string } => {
      const seeded = seedFlyby(0, 1.5, 10, 40);
      expect(seeded.ok).toBe(true);
      if (!seeded.ok) throw new Error('unreachable');
      const wl = seeded.worldline;
      let minR = Infinity;
      let guard = 0;
      while (wl.status === 'running' && guard < 20000) {
        wl.advance(advancePerCall);
        const s = wl.sample();
        minR = Math.min(minR, s.position.r);
        guard += 1;
      }
      return { minR, status: wl.status };
    };
    const coarse = run(0.04);
    const fine = run(0.02);
    expect(coarse.status).toBe('escaped');
    expect(fine.status).toBe('escaped');
    expect(coarse.minR).toBeGreaterThan(2);
    // Convergence of the periastron observable under halved step (NM §20).
    expect(Math.abs(coarse.minR - fine.minR)).toBeLessThan(5e-3);
  });

  it('near-horizon classes stay distinct: invalid static vs terminal freefall', () => {
    // Static inside the ergosphere (a*=0.9 equatorial r_E ~ 1.9):
    const invalidStatic = buildObserverFrameSnapshot(
      makeRequest({ mode: 'static', effectiveSpin: 0.9, cameraPositionWorld: [1.5, 0, 0.1] })
    );
    expect(invalidStatic.snapshot.valid).toBe(false);
    expect(invalidStatic.snapshot.invalidReason).toBe('static-inside-ergosphere');
    expect(invalidStatic.observerActive).toBe(0);

    // On-axis static observer: distinct reason.
    const onAxis = buildObserverFrameSnapshot(
      makeRequest({ mode: 'static', effectiveSpin: 0.9, cameraPositionWorld: [0, 15, 0] })
    );
    expect(onAxis.snapshot.valid).toBe(false);
    expect(onAxis.snapshot.invalidReason).toBe('observer-on-axis');

    // Freefall terminates in the DECLARED band, not as a failure:
    const ff = seedFreefall(0.998, 10);
    expect(ff.ok).toBe(true);
    if (ff.ok) {
      let guard = 0;
      while (ff.worldline.status === 'running' && guard < 100000) {
        ff.worldline.advance(0.05);
        guard += 1;
      }
      expect(ff.worldline.status).toBe('horizon-approach');
      expect(ff.worldline.sample().u.t).toBeGreaterThan(0);
      expect(Number.isFinite(ff.worldline.sample().coordinateTime)).toBe(true);
    }
  });

  it('beta -> 0 recovers the static measurement chain', () => {
    const snap = buildObserverFrameSnapshot(
      makeRequest({ mode: 'static', effectiveSpin: 0.6, cameraPositionWorld: [9, 0.5, 0] })
    );
    expect(snap.snapshot.valid).toBe(true);
    expect(snap.snapshot.betaMagnitude).toBeCloseTo(0, 12);
    expect(snap.snapshot.gammaFactor).toBeCloseTo(1, 12);
  });
});
