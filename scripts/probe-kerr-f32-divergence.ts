/**
 * f32 vs binary64 divergence probe for near-axis Kerr rays.
 *
 * This is the evidence behind the campaign's central claim: rays the
 * pole-passage gate rejects are well-conditioned in binary64 but NOT
 * representable in f32. It reproduces the table in
 * docs/VISUAL_FIDELITY_KERR_MAGENTA_BAND.md §6 and writes it to JSON.
 *
 * The emulation is deliberately faithful to production:
 *   - the same RK4 stage sequence,
 *   - the same kerrStepSizeAt step policy,
 *   - the same near-horizon half-step guard (r - r+ bound),
 *   - float32 rounding of the state after every stage (Math.fround), which is
 *     the thing that matters; an input-perturbation test cannot measure it.
 *
 * Usage: npx tsx scripts/probe-kerr-f32-divergence.ts
 *        [--out=artifacts/visual-fidelity-kerr-band/diagnostics]
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DEFAULT_KERR_PHOTON_OPTIONS,
  initKerrRay,
  integrateKerrPhoton,
  kerrRhs,
  kerrStepSizeAt,
  terminalLocalDirection,
  type KerrState,
  type Vec3
} from '../src/phenomena/black-hole/kerr/reference.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const outDir = resolve(arg('out', 'artifacts/visual-fidelity-kerr-band/diagnostics'));
mkdirSync(outDir, { recursive: true });

const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
})();

const SPIN = 0.9;
/** Production camera used by the diagnostic captures (kerr-high-prograde). */
const CAMERA_POSITION: Vec3 = [12, 1.6, 6];
const ESCAPE_RADIUS_RG = 32;
const PRODUCTION_POLE_SIN = 0.04;

const OPTIONS = {
  ...DEFAULT_KERR_PHOTON_OPTIONS,
  aStar: SPIN,
  massRg: 1,
  escapeRadiusRg: ESCAPE_RADIUS_RG,
  captureEpsilon: 0.01
};

/** Outer horizon r+ = M + sqrt(M^2 - a^2), M = 1. */
const R_PLUS = 1 + Math.sqrt(Math.max(1 - SPIN * SPIN, 0));
const CAPTURE_RADIUS = R_PLUS + 0.01;

function dirToward(target: Vec3): Vec3 {
  const d: Vec3 = [
    target[0] - CAMERA_POSITION[0],
    target[1] - CAMERA_POSITION[1],
    target[2] - CAMERA_POSITION[2]
  ];
  const n = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / n, d[1] / n, d[2] / n];
}

function angleBetweenDeg(a: Vec3 | null, b: Vec3 | null): number | null {
  if (a === null || b === null) return null;
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return +((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI).toFixed(3);
}

interface F32Trace {
  kind: string;
  state: KerrState;
  minSin: number;
  energy: number;
  lZ: number;
  steps: number;
}

/** Production-faithful f32 integration. */
function traceF32(dir: Vec3): F32Trace {
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
  const guardA = SPIN * SPIN;

  try {
    for (let i = 0; i < 200_000; i += 1) {
      if (
        !Number.isFinite(state.r) ||
        !Number.isFinite(state.theta) ||
        !Number.isFinite(state.pr) ||
        !Number.isFinite(state.ptheta)
      ) {
        return { kind: 'nonfinite', state, minSin, energy, lZ, steps: i };
      }
      if (state.r > ESCAPE_RADIUS_RG && state.pr > 0) {
        return { kind: 'escaped', state, minSin, energy, lZ, steps: i };
      }
      if (state.r < CAPTURE_RADIUS) {
        return { kind: 'captured', state, minSin, energy, lZ, steps: i };
      }
      if (state.theta < 0 || state.theta > Math.PI) {
        return { kind: 'wrapped', state, minSin, energy, lZ, steps: i };
      }

      // Production near-horizon half-step guard: bound the full-step radial
      // displacement by the remaining horizon gap, or an f32 stage can be
      // evaluated below r+ and the floored-delta metric blows up.
      const rawStep = Math.fround(kerrStepSizeAt(state.r, state.theta, OPTIONS));
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
        return { kind: 'nonfinite', state, minSin, energy, lZ, steps: i };
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
          state.theta + Math.fround(sixth * (k1.dtheta + 2 * k2.dtheta + 2 * k3.dtheta + k4.dtheta))
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
    return {
      kind: `threw: ${(error as Error).message}`,
      state,
      minSin,
      energy,
      lZ,
      steps: -1
    };
  }
  return { kind: 'maxsteps', state, minSin, energy, lZ, steps: -1 };
}

/** Offsets (r_g along world +Y on the symmetry axis) spanning the gate. */
const OFFSETS = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 12.0];

interface Row {
  offsetRg: number;
  f64Classification: string;
  f64MinSinTheta: number;
  f64GatedByProductionPolicy: boolean;
  f64NullResidual: number;
  f64CarterDrift: number;
  f32Classification: string;
  f32MinSinTheta: number;
  f32Steps: number;
  directionErrorDeg: number | null;
}

const rows: Row[] = [];
for (const offset of OFFSETS) {
  const dir = dirToward([0, offset, 0]);
  const f64 = integrateKerrPhoton(CAMERA_POSITION, dir, OPTIONS);
  // Ungated oracle: what the honest f64 answer WOULD be if the gate were off.
  const ungated = integrateKerrPhoton(CAMERA_POSITION, dir, { ...OPTIONS, poleFailureSin: 0 });
  const f32 = traceF32(dir);
  let directionErrorDeg: number | null = null;
  if (f32.kind === 'escaped') {
    directionErrorDeg = angleBetweenDeg(
      ungated.finalDirection,
      terminalLocalDirection(f32.state, f32.energy, f32.lZ, SPIN, 1)
    );
  }
  rows.push({
    offsetRg: offset,
    f64Classification: f64.classification,
    f64MinSinTheta: +f64.minSinTheta.toExponential(4),
    f64GatedByProductionPolicy: f64.classification === 'numerical-failure',
    f64NullResidual: +f64.conserved.nullResidualMax.toExponential(3),
    f64CarterDrift: +f64.conserved.carterDrift.toExponential(3),
    f32Classification: f32.kind,
    f32MinSinTheta: +f32.minSin.toExponential(4),
    f32Steps: f32.steps,
    directionErrorDeg
  });
}

const gated = rows.filter((r) => r.f64GatedByProductionPolicy);
const gatedWithError = gated.filter((r) => r.directionErrorDeg !== null);
const summary = {
  commit,
  spin: SPIN,
  cameraPosition: CAMERA_POSITION,
  escapeRadiusRg: ESCAPE_RADIUS_RG,
  productionPoleSin: PRODUCTION_POLE_SIN,
  note:
    'directionErrorDeg compares the f32-emulated terminal direction against the ' +
    'UNGATED binary64 oracle. null means the f32 run never produced a direction ' +
    '(non-finite, wrapped, or captured), which is itself the finding.',
  gatedRayCount: gated.length,
  gatedRaysWithDirectionError: gatedWithError.length,
  gatedDirectionErrorDegRange:
    gatedWithError.length === 0
      ? null
      : [
          Math.min(...gatedWithError.map((r) => r.directionErrorDeg as number)),
          Math.max(...gatedWithError.map((r) => r.directionErrorDeg as number))
        ],
  rows
};

writeFileSync(join(outDir, 'f32-divergence.json'), JSON.stringify(summary, null, 2));
console.log('offset  f64            minSin(f64)  gated?  f32            dirErr(deg)  nullResidual');
for (const row of rows) {
  console.log(
    `${String(row.offsetRg).padStart(5)}   ${row.f64Classification.padEnd(14)} ` +
      `${String(row.f64MinSinTheta).padEnd(12)} ${String(row.f64GatedByProductionPolicy).padEnd(7)} ` +
      `${row.f32Classification.padEnd(14)} ${String(row.directionErrorDeg).padEnd(12)} ` +
      `${row.f64NullResidual}`
  );
}
console.log(
  `\nGated rays: ${summary.gatedRayCount}; with an f32 direction to compare: ` +
    `${summary.gatedRaysWithDirectionError}; error range ` +
    `${JSON.stringify(summary.gatedDirectionErrorDegRange)} deg`
);
