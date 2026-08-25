/**
 * M10 observer layer — physical observer worldlines (OBSERVER_FRAME_ADR §2).
 *
 * - `circular`: exact equatorial timelike circular geodesic ([BPT72]
 *   eqs 2.16/2.17 generalized to BOTH senses relative to SIGNED spin;
 *   existence boundary = the sense's photon orbit, eq 2.18). Closed-form
 *   evolution phi(tau) — deterministic by construction.
 * - `flyby` / `freefall`: TIMELIKE geodesics integrated with RK4 on the same
 *   first-order BL Hamiltonian structure as the validated null solver
 *   (`kerrRhs` reused verbatim — the Hamiltonian derivatives are independent
 *   of the mass-shell value; only the constraint differs: 2H = -1 not 0).
 *   Conserved E, L_z are exact parameters of the formulation; the Carter
 *   constant is a monitored diagnostic.
 *
 * Horizon policy (ADR §3): integration uses the regular-at-horizon radial
 * equation and stops at r_stop = r_+ * (1 + 1e-3) with an explicit
 * 'horizon-approach' terminal state. Coordinate time is integrated alongside
 * for display only (it diverges logarithmically and is never integrated
 * through the horizon).
 */

import {
  embedKerr,
  kerrHamiltonian2,
  kerrRhs,
  type KerrState
} from '../kerr/reference.js';
import { kerrHorizonRadii, kerrIscoRadius, kerrPhotonOrbitRadius } from '../kerr/characteristics.js';
import type { CoordinateFourVector } from './types.js';
import { staticLapse } from './metric.js';

export const HORIZON_STOP_FACTOR = 1e-3;
/** Base proper-time RK4 substep (t_g units), scaled down near the horizon. */
const WORLDLINE_STEP_DTAU = 0.0005;
/** Floor for the proximity-scaled substep (t_g units). */
const WORLDLINE_STEP_FLOOR = 1e-5;
/** Upper bound on substeps per advance() call (frame-budget guard). */
const MAX_SUBSTEPS_PER_CALL = 40000;
/** Normalized timelike-constraint failure threshold (NM §6 form). */
const CONSTRAINT_DRIFT_MAX = 1e-6;

/** Stop radius (r_g) below which the advertised domain ends (ADR section 3). */
export function horizonStopRadius(aStar: number): number {
  return kerrHorizonRadii(aStar).outerRg * (1 + HORIZON_STOP_FACTOR);
}

// ---------------------------------------------------------------------------
// Circular observer (analytic)
// ---------------------------------------------------------------------------

export interface CircularKinetics {
  readonly valid: boolean;
  /** Coordinate angular velocity dphi/dt (sign carries the sense). */
  readonly omega: number;
  /** dt/dtau of the orbiting observer. */
  readonly uT: number;
  /** Existence boundary (photon orbit of this sense) in r_g. */
  readonly photonOrbitRadiusRg: number;
  /** ISCO of this sense in r_g (stability disclosure boundary). */
  readonly iscoRadiusRg: number;
}

/**
 * Equatorial circular TIMELIKE geodesic for orbit sense `s = ±1` at signed
 * spin aStar (M = 1), OBSERVER_FRAME_ADR section 2:
 *
 *   Omega = s / (r^{3/2} + s a*)
 *   u^t   = (r^{3/2} + s a*) / sqrt(r^3 - 3 r^2 + 2 s a* r^{3/2})
 *
 * Existence requires r > r_ph of the branch's effective spin s*a*
 * ([BPT72] eq 2.18). Below it valid=false ("no orbit") — callers must never
 * fabricate an orbit there.
 */
export function circularKinetics(
  aStar: number,
  radiusRg: number,
  sense: 1 | -1
): CircularKinetics {
  const branchSpin = sense * aStar;
  const rPh = kerrPhotonOrbitRadius(branchSpin);
  const isco = kerrIscoRadius(branchSpin);
  const r = radiusRg;
  if (!Number.isFinite(r) || r <= rPh) {
    return { valid: false, omega: 0, uT: 0, photonOrbitRadiusRg: rPh, iscoRadiusRg: isco };
  }
  const r32 = Math.pow(r, 1.5);
  const omega = sense / (r32 + branchSpin);
  const denominator = r * r * (r - 3) + 2 * branchSpin * r32;
  if (!(denominator > 0)) {
    return { valid: false, omega: 0, uT: 0, photonOrbitRadiusRg: rPh, iscoRadiusRg: isco };
  }
  const uT = (r32 + branchSpin) / Math.sqrt(denominator);
  return { valid: true, omega, uT, photonOrbitRadiusRg: rPh, iscoRadiusRg: isco };
}

/** Closed-form event on the circular worldline at proper time tau. */
export function circularEventAt(
  aStar: number,
  radiusRg: number,
  sense: 1 | -1,
  phi0Rad: number,
  tau: number
): { position: KerrState; u: CoordinateFourVector } | null {
  const kinetics = circularKinetics(aStar, radiusRg, sense);
  if (!kinetics.valid) return null;
  // dphi/dtau = Omega * u^t, both constant along the orbit:
  const phi = phi0Rad + kinetics.omega * kinetics.uT * tau;
  return {
    position: { r: radiusRg, theta: Math.PI / 2, phi, pr: 0, ptheta: 0 },
    u: { t: kinetics.uT, r: 0, th: 0, ph: kinetics.omega * kinetics.uT }
  };
}

// ---------------------------------------------------------------------------
// Geodesic worldlines (flyby / freefall)
// ---------------------------------------------------------------------------

export type WorldlineStatus =
  | 'running'
  | 'horizon-approach'
  | 'escaped'
  | 'non-finite';

/**
 * Radial potential R(r) of the equatorial timelike geodesic (Q = 0):
 * R = P^2 - Delta [r^2 + (L_z - aE)^2],  P = E(r^2 + a^2) - a L_z.
 */
function equatorialRadialPotential(
  r: number,
  energy: number,
  lZ: number,
  aStar: number
): number {
  const a = aStar;
  const bigP = energy * (r * r + a * a) - a * lZ;
  const delta = r * r - 2 * r + a * a;
  return bigP * bigP - delta * (r * r + (lZ - a * energy) * (lZ - a * energy));
}

interface WorldlineInit {
  readonly r: number;
  readonly theta: number;
  readonly phi: number;
  readonly pr: number;
  readonly ptheta: number;
  readonly energy: number;
  readonly lZ: number;
}

/** Freefall seed: dropped from rest relative to STATIC observers at r0 (equatorial). */
export function seedFreefall(
  aStar: number,
  releaseRadiusRg: number
): { ok: true; worldline: TimelikeWorldline } | { ok: false; reason: string } {
  if (!Number.isFinite(aStar) || !Number.isFinite(releaseRadiusRg)) {
    return { ok: false, reason: 'non-finite-parameter' };
  }
  const lapse = staticLapse({
    metric: 'kerr',
    effectiveSpin: aStar,
    r: releaseRadiusRg,
    theta: Math.PI / 2,
    phiWorldRad: 0
  });
  if (!(lapse > 0)) return { ok: false, reason: 'release-inside-ergosphere' };
  if (!(releaseRadiusRg > horizonStopRadius(aStar))) {
    return { ok: false, reason: 'release-below-stop-band' };
  }
  // u(0) = e_(t)(r0): conserved E = sqrt(f_s); p_phi = g_tphi u^t != 0 in
  // Kerr because frame dragging makes "rest relative to statics" rotate in
  // BL azimuth (OBSERVER_FRAME_ADR section 2).
  const e0 = Math.sqrt(lapse);
  const sigmaEq = releaseRadiusRg * releaseRadiusRg;
  const gTPhi = (-2 * aStar * releaseRadiusRg) / sigmaEq;
  const lZ = gTPhi / e0;
  return {
    ok: true,
    worldline: new TimelikeWorldline(
      {
        r: releaseRadiusRg,
        theta: Math.PI / 2,
        phi: 0,
        pr: 0,
        ptheta: 0,
        energy: e0,
        lZ
      },
      aStar
    )
  };
}

/** Flyby seed: unbound equatorial geodesic with conserved (E > 1, L_z). */
export function seedFlyby(
  aStar: number,
  energy: number,
  lZ: number,
  startRadiusRg: number
): { ok: true; worldline: TimelikeWorldline } | { ok: false; reason: string } {
  if (!Number.isFinite(energy) || !(energy > 1)) {
    return { ok: false, reason: 'flyby-energy-not-unbound' };
  }
  if (!Number.isFinite(lZ)) return { ok: false, reason: 'non-finite-parameter' };
  const minStart = Math.max(horizonStopRadius(aStar) * 2, kerrIscoRadius(aStar));
  if (!Number.isFinite(startRadiusRg) || !(startRadiusRg > minStart)) {
    return { ok: false, reason: 'flyby-start-radius-out-of-domain' };
  }
  const rr = equatorialRadialPotential(startRadiusRg, energy, lZ, aStar);
  if (!(rr > 0)) return { ok: false, reason: 'flyby-start-radius-no-inward-motion' };
  const delta = startRadiusRg * startRadiusRg - 2 * startRadiusRg + aStar * aStar;
  const prInward = -Math.sqrt(rr) / delta;
  return {
    ok: true,
    worldline: new TimelikeWorldline(
      {
        r: startRadiusRg,
        theta: Math.PI / 2,
        phi: 0,
        pr: prInward,
        ptheta: 0,
        energy,
        lZ
      },
      aStar
    )
  };
}

export type WorldlineStatusId = WorldlineStatus;

export interface WorldlineSample {
  readonly status: WorldlineStatus;
  readonly tau: number;
  readonly coordinateTime: number;
  readonly position: KerrState;
  /** Four-velocity u^mu (contravariant BL) at the current event. */
  readonly u: CoordinateFourVector;
  /** Normalized timelike-constraint drift diagnostic |2H + 1|. */
  readonly constraintDrift: number;
  /** Maximum accumulated |Q(tau) - Q(0)| since seeding. */
  readonly carterDrift: number;
}

interface Derivatives extends Record<string, unknown> {
  readonly dr: number;
  readonly dtheta: number;
  readonly dphi: number;
  readonly dpr: number;
  readonly dptheta: number;
  readonly dt: number;
}

function fragmentsAt(r: number, theta: number, aStar: number): {
  sigma: number;
  delta: number;
  bigA: number;
  aSq: number;
  sinTheta: number;
  cosTheta: number;
  sin2: number;
} {
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const sigma = Math.max(r * r + aStar * aStar * cosTheta * cosTheta, 1e-300);
  const delta = Math.max(r * r - 2 * r + aStar * aStar, 1e-300);
  const sin2 = Math.max(sinTheta * sinTheta, 1e-12);
  const bigA = (r ** 2 + aStar ** 2) ** 2 - aStar ** 2 * delta * sin2;
  return { sigma, delta, bigA, aSq: aStar * aStar, sinTheta, cosTheta, sin2 };
}

/** u^mu = g^{mu nu} p_nu at an arbitrary state (inverse-metric recovery). */
function fourVelocityAt(
  x: KerrState,
  energy: number,
  lZ: number,
  aStar: number
): CoordinateFourVector {
  const fr = fragmentsAt(x.r, x.theta, aStar);
  const sigmaDelta = fr.sigma * fr.delta;
  return {
    t: (fr.bigA * energy - 2 * aStar * x.r * lZ) / sigmaDelta,
    r: (fr.delta * x.pr) / fr.sigma,
    th: x.ptheta / fr.sigma,
    ph:
      (2 * aStar * x.r * energy +
        ((fr.delta - fr.aSq * fr.sin2) * lZ) / fr.sin2) /
      sigmaDelta
  };
}

/**
 * Stateful deterministic proper-time worldline. `advance(dTau)` integrates
 * fixed-substep RK4 over the SHARED Hamiltonian RHS (`kerrRhs`); identical
 * inputs always produce identical trajectories (no wall-clock anywhere).
 */
export class TimelikeWorldline {
  private tCoordinate = 0;
  private x: KerrState;
  private tauValue = 0;
  private statusValue: WorldlineStatus = 'running';
  private carterInitialValue: number;
  private carterDriftValue = 0;
  private minRadiusSeen: number;
  private lastFiniteResidual = 0;

  constructor(private readonly init: WorldlineInit, private readonly aStar: number) {
    this.x = {
      r: init.r,
      theta: init.theta,
      phi: init.phi,
      pr: init.pr,
      ptheta: init.ptheta
    };
    this.minRadiusSeen = init.r;
    this.carterInitialValue = this.carterDiagnostic();
  }

  get tau(): number {
    return this.tauValue;
  }

  get status(): WorldlineStatus {
    return this.statusValue;
  }

  private hamiltonian2(): number {
    return kerrHamiltonian2(this.x, this.init.energy, this.init.lZ, this.aStar, 1);
  }

  /**
   * NORMALIZED timelike-constraint residual (NM section 6 form):
   * |2H + mu^2| / max(individual Hamiltonian terms, eps) — an excellent
   * relative conservation must not read as large absolute drift when the
   * momentum terms themselves grow near the horizon.
   */
  private constraintResidual(): number {
    const fr = fragmentsAt(this.x.r, this.x.theta, this.aStar);
    const { energy, lZ } = this.init;
    const sigmaDelta = fr.sigma * fr.delta;
    const termA = (fr.bigA * energy ** 2) / sigmaDelta;
    const termB = Math.abs((2 * this.aStar * this.x.r * energy * lZ) / sigmaDelta);
    const termC =
      (Math.abs(fr.delta - fr.aSq * fr.sin2) * lZ ** 2) / (sigmaDelta * fr.sin2);
    const termD = (fr.delta * this.x.pr ** 2) / fr.sigma;
    const termE = this.x.ptheta ** 2 / fr.sigma;
    const scale = Math.max(termA, termB, termC, termD, termE, 1);
    const raw = this.hamiltonian2();
    if (!Number.isFinite(raw)) return Number.NaN;
    return Math.abs(raw + 1) / scale;
  }

  private carterDiagnostic(): number {
    const fr = fragmentsAt(this.x.r, this.x.theta, this.aStar);
    const cosTheta = fr.cosTheta;
    return (
      this.x.ptheta * this.x.ptheta -
      fr.aSq * this.init.energy ** 2 * cosTheta * cosTheta +
      (this.init.lZ ** 2 * cosTheta * cosTheta) / fr.sin2
    );
  }

  fourVelocity(): CoordinateFourVector {
    return fourVelocityAt(this.x, this.init.energy, this.init.lZ, this.aStar);
  }

  sample(): WorldlineSample {
    const residual = this.constraintResidual();
    if (Number.isFinite(residual)) this.lastFiniteResidual = residual;
    return {
      status: this.statusValue,
      tau: this.tauValue,
      coordinateTime: this.tCoordinate,
      position: { ...this.x },
      u: this.fourVelocity(),
      // Post-terminal states may overflow the raw Hamiltonian pieces; the
      // last finite normalized residual is the honest reported diagnostic.
      constraintDrift: Number.isFinite(residual)
        ? residual
        : this.lastFiniteResidual,
      carterDrift: this.carterDriftValue
    };
  }

  /** Advance deterministically by dTau total proper time (fixed substeps). */
  advance(dTau: number): void {
    if (this.statusValue !== 'running') return;
    if (!Number.isFinite(dTau) || dTau <= 0) return;
    let remaining = dTau;
    let substeps = 0;
    const rPlus = kerrHorizonRadii(this.aStar).outerRg;
    const span = Math.max(this.init.r - rPlus, 1);
    while (remaining > 1e-15 && substeps < MAX_SUBSTEPS_PER_CALL) {
      // Proximity-scaled substep: shrink toward the declared stop band so
      // accumulated RK4 error cannot masquerade as physics there (NM §9/§20
      // philosophy applied to TIMELIKE integration).
      const proximity = (this.x.r - rPlus) / span;
      const scaled = WORLDLINE_STEP_DTAU * Math.min(1, Math.max(proximity * proximity, 0.01));
      const h = Math.min(Math.max(scaled, WORLDLINE_STEP_FLOOR), remaining);
      this.stepRK4(h);
      remaining -= h;
      substeps += 1;
      if (
        !Number.isFinite(this.x.r) ||
        !Number.isFinite(this.x.pr) ||
        !Number.isFinite(this.x.theta)
      ) {
        this.statusValue = 'non-finite';
        return;
      }
      if (this.x.r <= horizonStopRadius(this.aStar)) {
        this.statusValue = 'horizon-approach';
        return;
      }
      // Scattering complete: outbound past the seed radius after a real
      // encounter (prevents unbounded integration of the outgoing asymptote).
      if (
        this.x.pr > 0 &&
        this.x.r >= this.init.r &&
        this.minRadiusSeen < this.init.r * 0.99
      ) {
        this.statusValue = 'escaped';
        return;
      }
      const residual = this.constraintResidual();
      if (!Number.isFinite(residual) || residual > CONSTRAINT_DRIFT_MAX) {
        this.statusValue = 'non-finite';
        return;
      }
    }
  }

  private stepRK4(h: number): void {
    const { energy, lZ } = this.init;
    const deriv = (s: KerrState): Derivatives => {
      const rhs = kerrRhs(s, energy, lZ, this.aStar, 1);
      const uT = fourVelocityAt(s, energy, lZ, this.aStar).t;
      return { ...rhs, dt: uT };
    };
    const x = this.x;
    const k1 = deriv(x);
    const k2 = deriv(offset(x, k1, h / 2));
    const k3 = deriv(offset(x, k2, h / 2));
    const k4 = deriv(offset(x, k3, h));
    const sixth = h / 6;
    this.tCoordinate += sixth * (k1.dt + 2 * k2.dt + 2 * k3.dt + k4.dt);
    this.x = {
      r: x.r + sixth * (k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr),
      theta: x.theta + sixth * (k1.dtheta + 2 * k2.dtheta + 2 * k3.dtheta + k4.dtheta),
      phi: x.phi + sixth * (k1.dphi + 2 * k2.dphi + 2 * k3.dphi + k4.dphi),
      pr: x.pr + sixth * (k1.dpr + 2 * k2.dpr + 2 * k3.dpr + k4.dpr),
      ptheta:
        x.ptheta + sixth * (k1.dptheta + 2 * k2.dptheta + 2 * k3.dptheta + k4.dptheta)
    };
    this.tauValue += h;
    if (this.x.r < this.minRadiusSeen) this.minRadiusSeen = this.x.r;
    const drift = Math.abs(this.carterDiagnostic() - this.carterInitialValue);
    if (drift > this.carterDriftValue) this.carterDriftValue = drift;
  }
}

function offset(
  x: KerrState,
  d: Derivatives,
  h: number
): KerrState {
  return {
    r: x.r + d.dr * h,
    theta: x.theta + d.dtheta * h,
    phi: x.phi + d.dphi * h,
    pr: x.pr + d.dpr * h,
    ptheta: x.ptheta + d.dptheta * h
  };
}

/** Embedded world-space position of a BL event (+Y axis conventions). */
export function worldPositionOf(
  r: number,
  theta: number,
  phiWorld: number
): [number, number, number] {
  return embedKerr(r, theta, phiWorld);
}
