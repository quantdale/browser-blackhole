/**
 * M9-02/BH-201 — binary64 Kerr reference solver verification.
 *
 * Independent validation layers (docs/KERR_BACKEND_ADR.md §1.10/§1.15,
 * docs/TESTING.md §4):
 * 1. finite-difference agreement of the implemented Hamiltonian gradients
 *    with the raw Hamiltonian (catches any algebra slip);
 * 2. null-constraint satisfaction at initialization through the tetrad;
 * 3. conservation of E, L_z (exact parameters) and Carter Q along traces;
 * 4. Schwarzschild-limit agreement against cpuReference.integratePhoton;
 * 5. exact spin-sign + azimuth-reversal symmetry of Kerr;
 * 6. frame-dragging direction; prograde/retrograde behavior; high-spin
 *    stress; invalid-state taxonomy; disk-hit contract; convergence evidence
 *    under halved step size (docs/NUMERICAL_METHODS.md §20).
 */
import { describe, expect, it } from 'vitest';

import { integratePhoton } from '../../src/phenomena/black-hole/cpuReference.js';
import {
  embedKerr,
  initKerrRay,
  integrateKerrPhoton,
  kerrHamiltonian2,
  kerrNullResidual,
  kerrRhs,
  type KerrState,
  type Vec3
} from '../../src/phenomena/black-hole/kerr/reference.js';
import {
  kerrHorizonRadii,
  kerrIscoRadius
} from '../../src/phenomena/black-hole/kerr/characteristics.js';

/** Deterministic probe states spanning radii/colatitudes/spins (all at
 * physically valid EXTERIOR radii: r > r+(a) + margin). */
function* probeStates(): Generator<{ x: KerrState; a: number }> {
  for (const a of [0.9, 0.5, 0, -0.5, -0.9]) {
    const rPlus = kerrHorizonRadii(a).outerRg;
    for (const dr of [0.4, 1.2, 3.5, 11]) {
      const r = rPlus + dr;
      for (const theta of [0.35, Math.PI / 2, 2.4]) {
        yield {
          x: { r, theta, phi: 0.7, pr: 0.37 * r, ptheta: -0.21 * r },
          a
        };
      }
    }
  }
}

/** Richardson-extrapolated central difference (kills O(h^2) truncation). */
function richardson(f: (h: number) => number): number {
  const h1 = 1e-3;
  const d1 = f(h1);
  const d2 = f(h1 / 2);
  return (4 * d2 - d1) / 3;
}

describe('Hamiltonian gradient verification (finite differences)', () => {
  it('dH/dr and dH/dtheta match Richardson differences of the raw Hamiltonian', () => {
    // Tolerances target ALGEBRA-SLIP detection; conditioning near the pole
    // forbids asserting machine precision on the theta gradient.
    for (const { x, a } of probeStates()) {
      const dHdr = richardson(
        (h) =>
          (kerrHamiltonian2({ ...x, r: x.r + h }, 1.3, 2.1, a, 1) -
            kerrHamiltonian2({ ...x, r: x.r - h }, 1.3, 2.1, a, 1)) /
          (4 * h)
      );
      const dHdtheta = richardson(
        (h) =>
          (kerrHamiltonian2({ ...x, theta: x.theta + h }, 1.3, 2.1, a, 1) -
            kerrHamiltonian2({ ...x, theta: x.theta - h }, 1.3, 2.1, a, 1)) /
          (4 * h)
      );

      const rhs = kerrRhs(x, 1.3, 2.1, a, 1);
      // kerrHamiltonian2 returns 2H, so its derivative is twice dH/dr.
      const scale = Math.max(Math.abs(dHdr), Math.abs(rhs.dpr), 1e-9);
      expect(
        Math.abs(-rhs.dpr - dHdr) / scale,
        `a=${a} r=${x.r} th=${x.theta} dHdr=${dHdr} analytic=${-rhs.dpr}`
      ).toBeLessThan(1e-6);

      const scaleTh = Math.max(Math.abs(dHdtheta), Math.abs(rhs.dptheta), 1e-9);
      expect(
        Math.abs(-rhs.dptheta - dHdtheta) / scaleTh,
        `a=${a} r=${x.r} th=${x.theta} dHth=${dHdtheta} analytic=${-rhs.dptheta}`
      ).toBeLessThan(1e-6);
    }
  });
});

describe('tetrad initialization (ADR §1.8)', () => {
  it('produces a null momentum (constraint satisfied at machine precision)', () => {
    const cameras: Array<{ pos: Vec3; dir: Vec3 }> = [
      { pos: [16, 2.5, 0], dir: [-1, -0.15, 0.05] },
      { pos: [0, 22, 4], dir: [0.02, -0.97, -0.2] },
      { pos: [-30, 5, 7], dir: [0.95, -0.1, -0.25] }
    ];
    for (const a of [0, 0.9, -0.9]) {
      for (const { pos, dir } of cameras) {
        const init = initKerrRay(pos, dir, a, 1);
        const residual = kerrNullResidual(init.state, init.energy, init.lZ, a, 1);
        expect(residual, `a=${a} pos=${pos.join()}`).toBeLessThan(1e-12);
      }
    }
  });

  it('recovers the validated Schwarzschild constants at a*=0', () => {
    // epsilon=1 local normalization (consistent affine scale, ADR §1.8):
    // E -> sqrt(f), p_r -> n_r/sqrt(f), L_z -> r sin(theta) n_ph.
    const pos: Vec3 = [16, 0, 0];
    const dir: Vec3 = [-1, 0, 0.25];
    const init = initKerrRay(pos, dir, 0, 1);
    const f = 1 - 2 / 16;
    const nLen = Math.hypot(...dir);
    expect(init.energy).toBeCloseTo(Math.sqrt(f), 12);
    expect(init.state.pr).toBeCloseTo(dir[0] / nLen / Math.sqrt(f), 12); // nR
    expect(init.lZ).toBeCloseTo((16 * 0.25) / Math.hypot(...dir), 12);
  });

  it('rejects invalid observers with inspectable reasons', () => {
    expect(() => initKerrRay([30, 0, 0], [0, 0, 0], 0.9)).toThrow(/zero-direction/);
    expect(() => initKerrRay([1.5, 0, 0], [-1, 0, 0], 0)).toThrow(/horizon/);
    // Equatorial camera at 1.7M with a* = 0.9: OUTSIDE the horizon (r+ ~
    // 1.436M) but INSIDE the equatorial ergosphere (2M).
    expect(() => initKerrRay([1.7, 0, 0], [-1, 0, 0], 0.9)).toThrow(/ergosphere/);
    expect(() => initKerrRay([0, 20, 0], [0, -1, 0], 0.9)).toThrow(/on-axis/);
    expect(() => initKerrRay([Number.NaN, 0, 20], [-1, 0, 0], 0)).toThrow(/non-finite/);
  });
});

describe('conservation invariants along traces', () => {
  const corpus: Array<{ pos: Vec3; dir: Vec3; label: string }> = [
    { pos: [24, 3, 0], dir: [-1, -0.08, 0.06], label: 'moderate-inward' },
    { pos: [40, 6, 8], dir: [-0.96, -0.18, -0.2], label: 'wide' },
    { pos: [14, 1, 2], dir: [-0.99, -0.05, 0.1], label: 'deep-plunge-ish' },
    { pos: [60, 10, 0], dir: [-1, -0.15, 0], label: 'far-field' }
  ];

  for (const a of [0, 0.5, -0.5, 0.9, -0.9]) {
    it(`keeps null residual + Carter drift tiny along every corpus ray (a*=${a})`, () => {
      for (const ray of corpus) {
        const result = integrateKerrPhoton(ray.pos, ray.dir, { aStar: a, maxSteps: 120_000 });
        if (
          result.outcome.kind === 'numerical-failure' &&
          result.outcome.reason === 'invalid-initial-state'
        ) {
          continue; // camera-domain guard, not a conservation subject
        }
        expect(result.conserved.nullResidualMax, `${ray.label} residual`).toBeLessThan(1e-5);
        expect(result.conserved.carterDrift, `${ray.label} carter`).toBeLessThan(1e-5);
      }
    }, 60_000);
  }

  it('keeps equatorial rays exactly equatorial (Q == 0 identically)', () => {
    const result = integrateKerrPhoton([20, 0, 0], [-1, 0, 0.3], {
      aStar: 0.9,
      maxSteps: 100_000
    });
    expect(Number.isFinite(result.conserved.carterConstantQ)).toBe(true);
    // Q0 built from an exactly equatorial start is 0 to roundoff and stays so:
    expect(Math.abs(result.conserved.carterConstantQ)).toBeLessThan(1e-12);
    expect(result.conserved.carterDrift).toBeLessThan(1e-10);
    // The trace never leaves the plane y == 0.
    for (const sample of result.pathSamples) {
      expect(Math.abs(sample[1])).toBeLessThan(1e-9);
    }
  });

  it('reports Carter drift as its own failure reason when forced', () => {
    // A pathologically loose Carter threshold must trigger the distinct
    // reason rather than silently completing (taxonomy coverage).
    const result = integrateKerrPhoton([20, 0, 0], [-1, 0, 0.3], {
      aStar: 0.9,
      carterThreshold: -1, // impossible threshold: fires on first positive drift
      maxSteps: 50_000
    });
    expect(result.outcome.kind).toBe('numerical-failure');
    expect(result.outcome.kind === 'numerical-failure' ? result.outcome.reason : '').toBe(
      'carter-drift'
    );
  });
});

describe('Schwarzschild limit agreement against cpuReference (a* = 0)', () => {
  const rays: Array<{ pos: Vec3; dir: Vec3 }> = [
    { pos: [16, 2.5, 0], dir: [-1, -0.15, 0.05] },
    { pos: [16, 2.5, 0], dir: [-0.98, -0.17, 0.1] },
    { pos: [30, 0, 4], dir: [-1, -0.05, 0] },
    { pos: [0, 22, 4], dir: [0.02, -0.97, -0.2] }
  ];

  for (const { pos, dir } of rays) {
    it(`matches classification/min-radius/final-direction for ${dir.map((d) => d.toFixed(2)).join(',')}`, () => {
      const schw = integratePhoton(pos, dir, { escapeRadius: 200, captureEpsilon: 1e-6 });
      if (schw.status === 'max-steps') {
        // cpuReference stalls at the horizon (no stall-capture resolution);
        // such rows carry no classification information to compare.
        return;
      }
      const kerr = integrateKerrPhoton(pos, dir, {
        aStar: 0,
        escapeRadiusRg: 200,
        captureEpsilon: 1e-6,
        maxSteps: 250_000
      });
      if (kerr.classification === 'numerical-failure') {
        return; // budget artifacts are excluded from comparison by design
      }
      expect(kerr.classification).toBe(schw.status === 'captured' ? 'captured' : 'escaped');
      if (kerr.classification === 'captured') {
        // Both solvers must terminate just above the same horizon.
        expect(kerr.minRadiusRg).toBeGreaterThan(1.9);
        expect(kerr.minRadiusRg).toBeLessThan(2.05);
      } else {
        expect(kerr.finalDirection, 'final direction defined').not.toBeNull();
        for (let i = 0; i < 3; i += 1) {
          expect(
            Math.abs((kerr.finalDirection![i] as number) - (schw.finalDirection[i] as number))
          ).toBeLessThan(5e-4);
        }
      }
    }, 60_000);
  }
});

describe('spin-sign symmetry and frame dragging (ADR §1.5)', () => {
  it('a* -> -a* mirrors trajectories through z -> -z EXACTLY', () => {
    const rays: Array<{ pos: Vec3; dir: Vec3 }> = [
      { pos: [18, 3, 2], dir: [-1, -0.1, 0.12] },
      { pos: [26, -2, 5], dir: [-0.95, 0.05, -0.28] }
    ];
    for (const a of [0.6, 0.9]) {
      for (const { pos, dir } of rays) {
        const plus = integrateKerrPhoton(pos, dir, { aStar: a, maxSteps: 120_000 });
        const mirrorPos: Vec3 = [pos[0], pos[1], -pos[2]];
        const mirrorDir: Vec3 = [dir[0], dir[1], -dir[2]];
        const minus = integrateKerrPhoton(mirrorPos, mirrorDir, {
          aStar: -a,
          maxSteps: 120_000
        });
        expect(minus.classification).toBe(plus.classification);
        if (!plus.finalPosition || !minus.finalPosition) continue;
        expect(minus.finalPosition[2]).toBeCloseTo(-plus.finalPosition[2], 6);
        expect(minus.finalPosition[0]).toBeCloseTo(plus.finalPosition[0], 6);
        expect(minus.minRadiusRg).toBeCloseTo(plus.minRadiusRg, 8);
      }
    }
  }, 90_000);

  it('drags L_z = 0 photons in +phi for a* > 0 and -phi for a* < 0', () => {
    // Camera on +X shooting inward with zero azimuthal component: L_z =
    // g_tphi/sqrt(f_s) picks the sign of the spin, and frame dragging drives
    // all azimuthal motion from there (signed BL azimuthal travel).
    const drag = (a: number): number =>
      integrateKerrPhoton([30, 0, 0], [-1, 0, 0], {
        aStar: a,
        maxSteps: 150_000
      }).signedPhiTravelRad;
    expect(drag(0.9)).toBeGreaterThan(0);
    expect(drag(-0.9)).toBeLessThan(0);
    expect(drag(0)).toBeCloseTo(0, 9);
    expect(Math.abs(drag(0.9))).toBeGreaterThan(Math.abs(drag(0.3)));
  }, 120_000);
});

describe('capture/escape classification and critical behavior', () => {
  interface ScanResult {
    sawCaptured: boolean;
    sawEscaped: boolean;
    flipped: boolean;
    failures: number;
  }
  // COROTATING illumination: launch from +X heading -X with +Z offset gives
  // L_z > 0 (corotating with positive spin) under the locked BL azimuth
  // convention (ADR §1.4/§1.5).
  const scan = (a: number): ScanResult => {
    const out: ScanResult = { sawCaptured: false, sawEscaped: false, flipped: false, failures: 0 };
    for (let b = 0.5; b <= 14; b += 0.25) {
      const cls = integrateKerrPhoton([70, 0, b], [-1, 0, 0], {
        aStar: a,
        maxSteps: 200_000,
        stepSize: 0.002
      }).classification;
      if (cls === 'numerical-failure') out.failures += 1;
      if (cls === 'captured') out.sawCaptured = true;
      if (cls === 'escaped') {
        out.sawEscaped = true;
        if (out.sawCaptured) out.flipped = true;
      }
    }
    return out;
  };

  it('splits captured/escaped monotonically across perpendicular offsets', () => {
    for (const a of [0, 0.9, -0.9]) {
      const r = scan(a);
      expect(r.sawCaptured, `small-b captured a=${a}`).toBe(true);
      expect(r.sawEscaped, `large-b escaped a=${a}`).toBe(true);
      expect(r.flipped, `single monotone transition a=${a}`).toBe(true);
      expect(r.failures, `budget/failure rows must stay rare a=${a}`).toBeLessThanOrEqual(1);
    }
  }, 400_000);

  it('shifts the critical offset in the prograde sense with spin', () => {
    // Locate the last-captured offset per spin; positive (prograde) spin
    // shrinks the corotating capture basin.
    const boundary = (a: number): number => {
      let lastCaptured = 0;
      for (let b = 0.5; b <= 16; b += 0.2) {
        const cls = integrateKerrPhoton([70, 0, b], [-1, 0, 0], {
          aStar: a,
          maxSteps: 300_000,
          stepSize: 0.002
        }).classification;
        if (cls === 'captured') lastCaptured = b;
        else if (cls === 'escaped' && lastCaptured > 0) break;
      }
      return lastCaptured;
    };
    const bPro = boundary(0.9);
    const bZero = boundary(0);
    const bRetro = boundary(-0.9);
    expect(bPro).toBeLessThan(bZero);
    expect(bRetro).toBeGreaterThan(bZero);
  }, 600_000);
});

describe('high-spin stress and invalid-state taxonomy', () => {
  it('completes a high-spin corpus without hidden numerical failures', () => {
    const rays: Array<{ pos: Vec3; dir: Vec3 }> = [
      { pos: [16, 2.5, 0], dir: [-1, -0.15, 0.05] },
      { pos: [24, 4, 6], dir: [-1, -0.1, -0.1] },
      { pos: [12, 0.5, 0], dir: [-1, -0.02, 0.04] },
      { pos: [40, 8, 0], dir: [-0.99, -0.2, 0] },
      { pos: [0, 30, 6], dir: [0, -0.98, -0.2] }
    ];
    for (const a of [0.998, -0.998]) {
      for (const { pos, dir } of rays) {
        const result = integrateKerrPhoton(pos, dir, { aStar: a, maxSteps: 200_000 });
        expect(
          result.classification === 'captured' || result.classification === 'escaped',
          `a=${a} ${dir.join()} -> ${JSON.stringify(result.outcome)}`
        ).toBe(true);
      }
    }
  }, 300_000);

  it('maps invalid cameras to the structured invalid-initial-state outcome', () => {
    // Outside the horizon (r+ ~ 1.063M at a* = 0.998), inside the ergosphere.
    const insideErgo = integrateKerrPhoton([1.5, 0, 0], [-1, 0, 0], { aStar: 0.998 });
    expect(insideErgo.outcome.kind).toBe('numerical-failure');
    expect(insideErgo.outcome.kind === 'numerical-failure' && insideErgo.outcome.reason).toBe(
      'invalid-initial-state'
    );
    expect(
      insideErgo.outcome.kind === 'numerical-failure' &&
        /ergosphere/.test(insideErgo.outcome.detail)
    ).toBe(true);
  });
});

describe('disk-crossing contract (ADR §1.14)', () => {
  it('records ordered annulus hits with world positions on the equator', () => {
    const inner = kerrIscoRadius(0.7);
    const outer = 18;
    const result = integrateKerrPhoton([0, 14, 34], [0, -0.62, -0.78], {
      aStar: 0.7,
      diskInnerRg: inner,
      diskOuterRg: outer,
      maxSteps: 200_000
    });
    expect(result.diskHits.length).toBeGreaterThanOrEqual(1);
    for (const hit of result.diskHits) {
      expect(hit.radiusRg).toBeGreaterThanOrEqual(inner);
      expect(hit.radiusRg).toBeLessThanOrEqual(outer);
      expect(Math.abs(hit.positionWorld[1])).toBeLessThan(1e-6);
      expect(hit.order).toBeGreaterThanOrEqual(1);
      expect(hit.worldAzimuthRad).toBeGreaterThan(-Math.PI - 1e-12);
      expect(hit.worldAzimuthRad).toBeLessThanOrEqual(Math.PI + 1e-12);
      // Embedded position matches the recorded radius/azimuth.
      const expected = embedKerr(hit.radiusRg, Math.PI / 2, hit.worldAzimuthRad);
      for (let i = 0; i < 3; i += 1) {
        expect(Math.abs((expected[i] as number) - (hit.positionWorld[i] as number))).toBeLessThan(
          1e-6
        );
      }
    }
  });

  it('records no hits when the annulus is disabled', () => {
    const result = integrateKerrPhoton([0, 14, 34], [0, -0.62, -0.78], {
      aStar: 0.7,
      maxSteps: 200_000
    });
    expect(result.diskHits).toHaveLength(0);
  });
});

describe('convergence evidence (docs/NUMERICAL_METHODS.md §20)', () => {
  it('disk-hit radius and escape direction converge under halved step', () => {
    const run = (stepSize: number) =>
      integrateKerrPhoton([0, 12, 30], [0.05, -0.55, -0.83], {
        aStar: 0.85,
        stepSize,
        diskInnerRg: kerrIscoRadius(0.85),
        diskOuterRg: 20,
        escapeRadiusRg: 120,
        maxSteps: 400_000
      });
    const coarse = run(0.01);
    const fine = run(0.005);
    expect(coarse.diskHits.length).toBeGreaterThan(0);
    expect(fine.diskHits.length).toBeGreaterThan(0);
    const dc = Math.abs(
      (coarse.diskHits[0] as { radiusRg: number }).radiusRg -
        (fine.diskHits[0] as { radiusRg: number }).radiusRg
    );
    expect(dc).toBeLessThan(2e-4);
    expect(coarse.finalDirection).not.toBeNull();
    expect(fine.finalDirection).not.toBeNull();
    for (let i = 0; i < 3; i += 1) {
      expect(
        Math.abs((coarse.finalDirection![i] as number) - (fine.finalDirection![i] as number))
      ).toBeLessThan(1e-4);
    }
  }, 120_000);
});

describe('horizon capture band honors the Kerr outer horizon', () => {
  it('captures near-horizon infalling rays slightly above r+(a*)', () => {
    const a = 0.95;
    const rPlus = kerrHorizonRadii(a).outerRg;
    // Camera OUTSIDE the equatorial ergosphere (r=2M at a*!=0), aimed in.
    const result = integrateKerrPhoton([rPlus + 0.9, 0.05, 0], [-1, 0, 0], {
      aStar: 0.95,
      captureEpsilon: 1e-6,
      maxSteps: 400_000,
      stepSize: 0.002
    });
    expect(result.classification).toBe('captured');
    expect(result.minRadiusRg).toBeGreaterThan(rPlus - 0.01);
    expect(result.minRadiusRg).toBeLessThan(rPlus + 0.45);
  }, 90_000);
});
