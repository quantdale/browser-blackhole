/**
 * M10 observer layer — normalized observer-frame snapshot
 * (OBSERVER_FRAME_ADR §5/§6).
 *
 * Builds the per-frame CPU payload consumed by CPU reference tests, GPU
 * uniforms, debug UI, and browser tests:
 *
 *   - tetrad legs {U, A1, A2, A3} in BL coordinates (per-EVENT construction;
 *     per-pixel work reduces to k^mu = U + sum n_a A_a);
 *   - frequency convention selection (locked dual convention):
 *       'observer' — moving modes (circular/flyby/freefall): the image is
 *                    what THIS observer records; g uses -k.u_obs = 1.
 *       'infinity' — camera/static modes: the historical distant-astronomer
 *                    recording; g keeps the pre-M10 value EXACTLY (visual
 *                    regression anchor; KERR_BACKEND_ADR section 1.16 form).
 *     Both are computed from the same traced k; the backend multiplies the
 *     legacy factor by 1/E_ray when the observer convention is active.
 */

import { kerrHorizonRadii } from '../kerr/characteristics.js';
import {
  metricInner,
  staticFourVelocity,
  staticLapse,
  staticOrthonormalTriad,
  type MetricContext
} from './metric.js';
import {
  buildObserverTetrad,
  type CameraAxisDirections,
  type ObserverTetradLegs
} from './tetrad.js';
import {
  circularEventAt,
  horizonStopRadius,
  worldPositionOf,
  type TimelikeWorldline
} from './worldlines.js';
import type {
  CoordinateFourVector,
  MetricId,
  ObserverFrameSnapshot,
  ObserverInvalidReason,
  ObserverPhysicsMode,
  ObserverTerminalReason
} from './types.js';

export interface SnapshotRequest {
  mode: ObserverPhysicsMode;
  metricId: MetricId;
  /** Effective signed spin driving the observer physics (Schwarzschild => 0). */
  effectiveSpin: number;

  /** Deterministic proper time of the worldline clock (t_g units). */
  properTimeTau: number;

  /**
   * Physical observer position source:
   * - camera/static modes: the CURRENT CAMERA POSITION in world r_g (this is
   *   the pre-M10 ray-origin semantic, preserved exactly);
   * - worldline modes: ignored (worldline owns position).
   */
  cameraPositionWorld: readonly [number, number, number];

  /** User look axes (presentation inputs only). */
  cameraAxes: CameraAxisDirections;

  /** Circular parameters + seed azimuth. */
  readonly circularRadiusRg: number;
  readonly circularSense: 1 | -1;
  readonly circularPhi0Rad: number;

  /** Active geodesic worldline for flyby/freefall (seeded by the owner). */
  readonly geodesicWorldline: TimelikeWorldline | null;

  /** Specific seeding failure to surface verbatim when the worldline is null. */
  readonly seedFailureReason?: string | null;
}

/** Minimal circular diagnostics surfaced on the snapshot. */
export interface CircularKineticsLike {
  readonly omega: number | null;
  readonly unstable: boolean;
}

/** Runtime set of valid reasons for verbatim pass-through validation. */
const INVALID_REASON_SET: ReadonlySet<string> = new Set([
  'static-inside-ergosphere',
  'observer-at-or-inside-horizon',
  'observer-on-axis',
  'no-circular-orbit-below-photon-orbit',
  'degenerate-camera-axis',
  'non-finite-parameter',
  'flyby-captured-worldline',
  'non-finite-worldline-state',
  'release-inside-ergosphere',
  'release-below-stop-band',
  'flyby-energy-not-unbound',
  'flyby-start-radius-out-of-domain',
  'flyby-start-radius-no-inward-motion'
]);

export interface SnapshotWithUniforms {
  readonly snapshot: ObserverFrameSnapshot;
  /** Flat leg vectors for the GPU block (BL contravariant components). */
  readonly legU: readonly [number, number, number, number];
  readonly legA1: readonly [number, number, number, number];
  readonly legA2: readonly [number, number, number, number];
  readonly legA3: readonly [number, number, number, number];
  readonly observerActive: 0 | 1;
  /** True when shading must apply the comoving-observer frequency convention. */
  readonly observerFrequencyConvention: boolean;
  /** Declared stop radius for worldline modes (r_g). */
  readonly horizonStopRadiusRg: number;
}

function invalidSnapshot(
  request: SnapshotRequest,
  reason: ObserverInvalidReason,
  terminal: ObserverTerminalReason = null
): SnapshotWithUniforms {
  const zero4: [number, number, number, number] = [0, 0, 0, 0];
  return {
    snapshot: {
      mode: request.mode,
      metric: request.metricId,
      effectiveSpin: request.effectiveSpin,
      valid: false,
      invalidReason: reason,
      terminalReason: terminal,
      radiusRg: Number.NaN,
      thetaRad: Number.NaN,
      phiWorldRad: Number.NaN,
      positionWorld: [Number.NaN, Number.NaN, Number.NaN],
      fourVelocity: null,
      tetradLegs: null,
      betaStatic: null,
      betaMagnitude: Number.NaN,
      gammaFactor: Number.NaN,
      properTimeTau: request.properTimeTau,
      coordinateTimeT: Number.NaN,
      circularOmega: null,
      circularUnstable: false,
      horizonStopFactor: 1e-3
    },
    legU: zero4,
    legA1: zero4,
    legA2: zero4,
    legA3: zero4,
    observerActive: 0,
    observerFrequencyConvention: false,
    horizonStopRadiusRg: horizonStopRadius(request.effectiveSpin)
  };
}

/** World cartesian -> BL spherical for the canonical embedding (+Y axis). */
export function worldToPolar(pos: readonly [number, number, number]): {
  r: number;
  theta: number;
  phiWorld: number;
} {
  const x = pos[0];
  const y = pos[1];
  const z = pos[2];
  const r = Math.hypot(x, y, z);
  return {
    r,
    theta: Math.acos(Math.min(1, Math.max(-1, y / (r || 1)))),
    phiWorld: Math.atan2(z, x)
  };
}

function betaRelativeToStatics(
  ctx: MetricContext,
  u: CoordinateFourVector
): { beta: [number, number, number] | null; magnitude: number; gamma: number } {
  const eT = staticFourVelocity(ctx);
  const triad = staticOrthonormalTriad(ctx);
  if (!eT || !triad) return { beta: null, magnitude: Number.NaN, gamma: Number.NaN };
  const gammaValue = -metricInner(ctx, u, eT);
  if (!(gammaValue > 0)) return { beta: null, magnitude: Number.NaN, gamma: Number.NaN };
  const components = triad.map((leg) => metricInner(ctx, u, leg) / gammaValue);
  const bR = components[0] ?? Number.NaN;
  const bTh = components[1] ?? Number.NaN;
  const bPh = components[2] ?? Number.NaN;
  const magnitude = Math.hypot(bR, bTh, bPh);
  return {
    beta: [bR, bTh, bPh],
    magnitude,
    gamma: gammaValue
  };
}

/**
 * Assemble the observer snapshot + flat uniform legs for the requested
 * configuration. Never throws: unsupported configurations produce a valid
 *=false snapshot carrying the specific reason (campaign section 14).
 */
export function buildObserverFrameSnapshot(
  request: SnapshotRequest,
  circularInfo?: CircularKineticsLike
): SnapshotWithUniforms {
  const spin = request.effectiveSpin;

  // --- Position source -----------------------------------------------------
  let polar: { r: number; theta: number; phiWorld: number };
  let u: CoordinateFourVector | null;
  let coordinateTime = Number.NaN;
  let statusOk = true;
  let terminalReason: ObserverTerminalReason = null;
  const invalidReason: ObserverInvalidReason | null = null;

  if (request.mode === 'circular') {
    const event =
      circularEventAt(
        spin,
        request.circularRadiusRg,
        request.circularSense,
        request.circularPhi0Rad,
        request.properTimeTau
      ) ?? null;
    if (!event) {
      return invalidSnapshot(request, 'no-circular-orbit-below-photon-orbit');
    }
    polar = {
      r: event.position.r,
      theta: event.position.theta,
      phiWorld: event.position.phi
    };
    u = event.u;
    // Coordinate time along the orbit: dt/dtau = u^t (constant):
    coordinateTime = event.u.t * request.properTimeTau;
  } else if (request.mode === 'flyby' || request.mode === 'freefall') {
    const wl: TimelikeWorldline | null = request.geodesicWorldline;
    if (!wl) {
      // Surface the SPECIFIC seed failure verbatim (e.g.
      // 'release-inside-ergosphere'); fall back only when the owner did not
      // provide one. The reason string must already be a valid
      // ObserverInvalidReason by the seeder's contract.
      const specific = request.seedFailureReason ?? null;
      return invalidSnapshot(
        request,
        specific !== null && INVALID_REASON_SET.has(specific)
          ? (specific as ObserverInvalidReason)
          : 'non-finite-parameter'
      );
    }
    const sample = wl.sample();
    if (sample.status === 'non-finite') {
      return invalidSnapshot(request, 'non-finite-worldline-state');
    }
    const p = sample.position;
    polar = { r: p.r, theta: p.theta, phiWorld: p.phi };
    u = sample.u;
    coordinateTime = sample.coordinateTime;
    statusOk = true;
    terminalReason = sample.status === 'horizon-approach' ? 'horizon-approach' : null;
  } else {
    // camera / static: position IS the camera position (pre-M10 semantics).
    polar = worldToPolar(request.cameraPositionWorld);
    coordinateTime = 0;
    // Domain classification BEFORE constructing u so each unsupported
    // configuration reports its SPECIFIC reason (campaign section 8):
    if (!(polar.r > kerrHorizonRadii(spin).outerRg)) {
      return invalidSnapshot(request, 'observer-at-or-inside-horizon');
    }
    if (!(Math.sin(polar.theta) > 1e-9)) {
      return invalidSnapshot(request, 'observer-on-axis');
    }
    const lapse = staticLapse({
      metric: request.metricId,
      effectiveSpin: spin,
      r: polar.r,
      theta: polar.theta,
      phiWorldRad: polar.phiWorld
    });
    if (!(lapse > 0)) {
      return invalidSnapshot(request, 'static-inside-ergosphere');
    }
    u = staticFourVelocity({
      metric: request.metricId,
      effectiveSpin: spin,
      r: polar.r,
      theta: polar.theta,
      phiWorldRad: polar.phiWorld
    });
  }

  if (!u || !Number.isFinite(polar.r) || !(polar.r > 0)) {
    return invalidSnapshot(request, 'observer-at-or-inside-horizon');
  }

  // --- Tetrad ---------------------------------------------------------------
  const ctx: MetricContext = {
    metric: request.metricId,
    effectiveSpin: spin,
    r: polar.r,
    theta: polar.theta,
    phiWorldRad: polar.phiWorld
  };
  const legs: ObserverTetradLegs | null = buildObserverTetrad(u, request.cameraAxes, ctx);
  if (!legs) {
    return invalidSnapshot(request, 'degenerate-camera-axis', terminalReason);
  }

  const betaInfo = betaRelativeToStatics(ctx, u);

  const snapshot: ObserverFrameSnapshot = {
    mode: request.mode,
    metric: request.metricId,
    effectiveSpin: spin,
    valid: statusOk,
    invalidReason,
    terminalReason,
    radiusRg: polar.r,
    thetaRad: polar.theta,
    phiWorldRad: polar.phiWorld,
    positionWorld: worldPositionOf(polar.r, polar.theta, polar.phiWorld),
    fourVelocity: u,
    tetradLegs: legs,
    betaStatic: betaInfo.beta,
    betaMagnitude: betaInfo.magnitude,
    gammaFactor: betaInfo.gamma,
    properTimeTau: request.properTimeTau,
    coordinateTimeT: coordinateTime,
    circularOmega: circularInfo?.omega ?? null,
    circularUnstable: circularInfo?.unstable ?? false,
    horizonStopFactor: 1e-3
  };

  const flatten = (v: CoordinateFourVector): [number, number, number, number] => [
    v.t,
    v.r,
    v.th,
    v.ph
  ];

  return {
    snapshot,
    legU: flatten(u),
    legA1: flatten(legs[0]),
    legA2: flatten(legs[1]),
    legA3: flatten(legs[2]),
    observerActive: 1,
    observerFrequencyConvention:
      request.mode === 'circular' || request.mode === 'flyby' || request.mode === 'freefall',
    horizonStopRadiusRg: horizonStopRadius(spin)
  };
}

/** Re-exported for destination diagnostics. */
export { worldPositionOf };
