/**
 * M10 — observer-frame uniform payload builder.
 *
 * Bridges the canonical observer physics (OBSERVER_FRAME_ADR) to the GPU
 * backends' flat `setUniformsFromState` records. Per frame the CPU computes
 * the tetrad legs ONCE (per-EVENT construction); per pixel the shader only
 * forms k^mu = U + sum(n_a A_a) and reads conserved quantities off the
 * precomputed covariant components shipped alongside.
 *
 * Frequency convention (ADR §6, locked dual convention):
 * - mode 'camera'/'static' -> 'infinity': legacy distant-astronomer recording;
 *   the emitted multiplier is exactly 1 so historical output is preserved.
 * - moving modes -> 'observer': the comoving measurement; the backend scales
 *   the legacy emitter factor by 1/E_ray with E_ray the traced photon's
 *   conserved energy (nu_obs = 1 by construction).
 */

import {
  effectiveSpin,
  type BlackHoleControlState,
  type ObserverControlState
} from '../controlState.js';
import { buildObserverFrameSnapshot, type SnapshotWithUniforms } from './snapshot.js';
import { circularKinetics, seedFlyby, seedFreefall } from './worldlines.js';
import type { TimelikeWorldline } from './worldlines.js';
import { kerrErgosphereRadius } from '../kerr/characteristics.js';
import type { CameraAxisDirections } from './tetrad.js';

export interface ObserverFrameInput {
  readonly controls: BlackHoleControlState;
  /** Camera world position (r_g) — ray origin for camera/static modes. */
  readonly cameraPositionWorld: readonly [number, number, number];
  /** Camera look axes in WORLD space (presentation only). */
  readonly cameraAxes: CameraAxisDirections;
  /** Deterministic proper time carried by the destination's clock (t_g). */
  readonly tau: number;
  /** Live geodesic worldline for flyby/freefall modes (owned by destination). */
  readonly geodesicWorldline: TimelikeWorldline | null;
}

export interface ObserverReadout {
  readonly valid: boolean;
  readonly invalidReason: string | null;
  readonly terminalReason: string | null;
  readonly radiusRg: number;
  readonly betaMagnitude: number;
  readonly gammaFactor: number;
  readonly properTimeTau: number;
  readonly coordinateTimeT: number;
  readonly circularOmega: number | null;
  readonly circularUnstable: boolean;
  /** Embedded world-space observer position (r_g) when valid. */
  readonly positionWorld: readonly [number, number, number];
}

export interface ObserverUniformPayload {
  /** Flat keys merged into the passes' `setUniformsFromState` record. */
  readonly stateKeys: Record<string, unknown>;
  readonly readout: ObserverReadout;
}

/** Conserved specific angular momentum of the parameterized flyby. */
export function flybyAngularMomentum(observer: ObserverControlState): number {
  const gammaInfinity = 1 / Math.sqrt(1 - observer.flybyBetaInfinity ** 2);
  return gammaInfinity * observer.flybyBetaInfinity * observer.flybyImpactParameterRg;
}

/** Flyby asymptotic Lorentz factor (conserved specific energy). */
export function flybyEnergy(observer: ObserverControlState): number {
  return 1 / Math.sqrt(1 - observer.flybyBetaInfinity ** 2);
}

/**
 * Seed the geodesic worldline implied by current controls, or report the
 * specific domain violation. Deterministic; called on every control change /
 * preset load / reset — never per frame.
 */
export function seedGeodesicWorldline(
  controls: BlackHoleControlState
): { ok: true; worldline: TimelikeWorldline } | { ok: false; reason: string } {
  const spin = effectiveSpin(controls);
  const observer = controls.observer;
  if (observer.mode === 'freefall') {
    // Domain guard: release must admit a static rest frame (outside the
    // ergosphere at the equator) — OBSERVER_FRAME_ADR section 9.
    if (
      controls.metric === 'kerr' &&
      !(spin === 0 || Math.abs(spin) < 1) &&
      observer.freefallReleaseRadiusRg <= kerrErgosphereRadius(spin, Math.PI / 2)
    ) {
      return { ok: false, reason: 'release-inside-ergosphere' };
    }
    return seedFreefall(spin, observer.freefallReleaseRadiusRg);
  }
  if (observer.mode === 'flyby') {
    return seedFlyby(spin, flybyEnergy(observer), flybyAngularMomentum(observer), 40);
  }
  return { ok: false, reason: 'mode-has-no-worldline' };
}

/** Circular existence/stability disclosure for the requested branch. */
export function circularDiagnostics(controls: BlackHoleControlState): {
  omega: number | null;
  unstable: boolean;
  invalidReason: string | null;
} {
  const spin = effectiveSpin(controls);
  const observer = controls.observer;
  const kinetics = circularKinetics(spin, observer.circularRadiusRg, observer.circularSense);
  if (!kinetics.valid) {
    return { omega: null, unstable: false, invalidReason: 'no-circular-orbit-below-photon-orbit' };
  }
  return {
    omega: kinetics.omega,
    unstable: observer.circularRadiusRg < kinetics.iscoRadiusRg,
    invalidReason: null
  };
}

/**
 * Build the complete per-frame observer payload. Never throws; unsupported
 * configurations deactivate the block with a truthful reason.
 */
export function buildObserverUniformPayload(input: ObserverFrameInput): ObserverUniformPayload {
  const { controls } = input;
  const spin = effectiveSpin(controls);
  const observer = controls.observer;

  const geodesic = input.geodesicWorldline;
  let seedFailure: string | null = null;
  if (observer.mode === 'flyby' || observer.mode === 'freefall') {
    if (geodesic === null) {
      seedFailure = 'worldline-not-seeded';
    }
  }

  let circular: ReturnType<typeof circularDiagnostics> | null = null;
  if (observer.mode === 'circular') {
    circular = circularDiagnostics(controls);
  }

  const built: SnapshotWithUniforms = buildObserverFrameSnapshot(
    {
      mode: observer.mode,
      metricId: controls.metric,
      effectiveSpin: spin,
      properTimeTau: input.tau,
      cameraPositionWorld: input.cameraPositionWorld,
      cameraAxes: input.cameraAxes,
      circularRadiusRg: observer.circularRadiusRg,
      circularSense: observer.circularSense,
      circularPhi0Rad: 0,
      geodesicWorldline: geodesic
    },
    circular ?? undefined
  );

  const invalidReason =
    built.snapshot.invalidReason ??
    (seedFailure && !built.snapshot.valid ? seedFailure : null);

  // LOCKED GPU policy (OBSERVER_FRAME_ADR §5 note): only MOVING modes drive
  // the tetrad init path on the GPU. Camera/static keep the legacy init
  // BIT-FOR-BIT (f32 reordering inside an algebraically identical path still
  // shifts golden frames) — the static-equivalence gate lives in the CPU
  // reference suite, where it holds to machine precision.
  const movingMode =
    observer.mode === 'circular' ||
    observer.mode === 'flyby' ||
    observer.mode === 'freefall';
  const active = movingMode && built.observerActive === 1 && invalidReason === null ? 1 : 0;

  // World-space directions of the three spatial legs at this event (used by
  // the plane-solver backends to orient each ray's geodesic plane).
  const legWorldDirs =
    built.snapshot.tetradLegs?.map((leg) => {
      const st = Math.sin(built.snapshot.thetaRad);
      const ct = Math.cos(built.snapshot.thetaRad);
      const sp = Math.sin(built.snapshot.phiWorldRad);
      const cp = Math.cos(built.snapshot.phiWorldRad);
      return [
        leg.r * st * cp +
          built.snapshot.radiusRg * leg.th * ct * cp -
          built.snapshot.radiusRg * st * leg.ph * sp,
        leg.r * ct - built.snapshot.radiusRg * leg.th * st,
        leg.r * st * sp +
          built.snapshot.radiusRg * leg.th * ct * sp +
          built.snapshot.radiusRg * st * leg.ph * cp
      ] as [number, number, number];
    }) ?? null;

  const activeFinal = active;
  const stateKeys: Record<string, unknown> = {
    observerLegU: activeFinal ? built.legU : [0, 0, 0, 0],
    observerLegA1: activeFinal ? built.legA1 : [0, 0, 0, 0],
    observerLegA2: activeFinal ? built.legA2 : [0, 0, 0, 0],
    observerLegA3: activeFinal ? built.legA3 : [0, 0, 0, 0],
    observerLegW1: activeFinal ? (legWorldDirs?.[0] ?? [0, 0, 0]) : [0, 0, 0],
    observerLegW2: activeFinal ? (legWorldDirs?.[1] ?? [0, 0, 0]) : [0, 0, 0],
    observerLegW3: activeFinal ? (legWorldDirs?.[2] ?? [0, 0, 0]) : [0, 0, 0],
    observerActive: activeFinal,
    observerFrequencyComoving:
      built.observerFrequencyConvention && activeFinal === 1 ? 1 : 0
  };

  return {
    stateKeys,
    readout: {
      valid: active === 1,
      invalidReason,
      terminalReason: built.snapshot.terminalReason,
      radiusRg: built.snapshot.radiusRg,
      betaMagnitude: built.snapshot.betaMagnitude,
      gammaFactor: built.snapshot.gammaFactor,
      properTimeTau: built.snapshot.properTimeTau,
      coordinateTimeT: built.snapshot.coordinateTimeT,
      circularOmega: built.snapshot.circularOmega,
      circularUnstable: built.snapshot.circularUnstable,
      positionWorld: built.snapshot.positionWorld
    }
  };
}
