/**
 * Compact Merger deterministic anisotropic ejecta model (CA5-06/CA5-07).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 4 (anisotropic
 *   expanding kilonova component; GPU ejecta particles; procedural
 *   low-resolution volume);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 7 (ejecta begins only
 *   after the appropriate phase; monotonic expansion; finite/non-negative);
 * - mission section 13 (deterministic anisotropic ejecta; seed reproduces
 *   morphology; viewing angle never mutates intrinsic state).
 *
 * MODEL (disclosed reduced two-component kilonova morphology):
 * - PRESENTATION-COMPRESSED homologous expansion: the PHYSICAL law is
 *   R = v_ej * tau, but 0.2c over a day is solar-system scale — unframable
 *   next to a 24 km binary. The PRESENTED radius uses a disclosed sub-linear
 *   compression R_pres(tau) = K * min(tau, TAU_CAP)^EXP with
 *   EXP = 0.35, K = 3.15 units/s^EXP, capped at 7 days (afterglow holds
 *   radius and fades instead of outgrowing the frustum). Monotone,
 *   deterministic, bounded; the compression is a PRESENTATION choice and is
 *   disclosed in the fidelity notes — no physical scale is claimed.
 * - ANISOTROPY as a static direction weight w(dir): equatorial-tidal
 *   (lanthanide-rich, red, slower) vs polar (shock-heated, blue, faster)
 *   blended by the ejecta scenario. The weight field is a pure function of
 *   DIRECTION ONLY — rotating the observer never changes it (mission §13).
 * - Particle plan: pure data (emitter shell + direction bias + color ramp)
 *   consumed by the shared ParticleService; seeded deterministically.
 *
 * All quantities finite and non-negative by construction; bounds stay inside
 * the volume envelope computed by the module.
 */

import type { ResolvedMergerScenario } from './types.js';

/** Presentation-law constants (see module docblock; disclosed, not physical). */
export const EJECTA_PRESENTATION_K = 3.15;
export const EJECTA_PRESENTATION_EXP = 0.35;
export const EJECTA_TAU_CAP_SECONDS = 7 * 86400;

/** Seconds since contact (0 before contact). Pure clamp. */
export function ejectaAgeSeconds(tSeconds: number, contactSeconds: number): number {
  const t = Number.isFinite(tSeconds) ? tSeconds : 0;
  const tc = Number.isFinite(contactSeconds) ? contactSeconds : 0;
  return Math.max(0, t - tc);
}

/**
 * PRESENTED ejecta radius, scene units (monotone in tau; 0 before contact;
 * capped at the afterglow plateau). See the module docblock for the
 * compression disclosure.
 */
export function ejectaRadiusUnits(tauSeconds: number): number {
  const tau = Number.isFinite(tauSeconds) ? Math.max(0, tauSeconds) : 0;
  if (tau <= 0) return 0;
  const capped = Math.min(tau, EJECTA_TAU_CAP_SECONDS);
  const r = EJECTA_PRESENTATION_K * Math.pow(capped, EJECTA_PRESENTATION_EXP);
  return Number.isFinite(r) && r > 0 ? r : 0;
}

/**
 * Direction weight w(dir) in [0, 1] for the two-component morphology.
 * `dir` need not be normalized. Pure function of direction + scenario —
 * observer-independent by contract.
 */
export function ejectaDirectionWeight(
  dirX: number,
  dirY: number,
  dirZ: number,
  scenario: ResolvedMergerScenario
): number {
  const len = Math.hypot(dirX, dirY, dirZ);
  if (!(len > 1e-9)) return 0.5;
  const cosPolar = dirY / len; // +1 = +Y polar axis, 0 = orbital plane
  const equatorial = 1 - Math.abs(cosPolar); // 1 in the orbital plane
  switch (scenario.ejectaScenario) {
    case 'polar-enhanced':
      return Math.min(1, Math.max(0, 0.15 + 0.85 * Math.abs(cosPolar)));
    case 'equatorial-tidal':
      return Math.min(1, Math.max(0, 0.15 + 0.85 * equatorial));
    case 'two-component':
    default:
      return Math.min(1, Math.max(0, 0.25 + 0.75 * (0.5 * equatorial + 0.5 * Math.abs(cosPolar))));
  }
}

/**
 * Radial anisotropy factor multiplying the LOCAL shell radius: polar
 * components expand faster in the polar-enhanced scenario, tidal tails
 * stretch equatorially otherwise. Bounded [0.6, 1.4] — morphology only,
 * never the bulk homologous law.
 */
export function ejectaAnisotropyFactor(
  dirX: number,
  dirY: number,
  dirZ: number,
  scenario: ResolvedMergerScenario
): number {
  const len = Math.hypot(dirX, dirY, dirZ);
  if (!(len > 1e-9)) return 1;
  const cosPolar = dirY / len;
  const equatorial = 1 - Math.abs(cosPolar);
  if (scenario.ejectaScenario === 'polar-enhanced') {
    return 1 + 0.4 * Math.abs(cosPolar) * cosPolar; // 1..1.4 toward poles
  }
  if (scenario.ejectaScenario === 'equatorial-tidal') {
    return 1 + 0.4 * equatorial * equatorial; // 1..1.4 toward the plane
  }
  return 1 + 0.2 * (equatorial * equatorial - 0.5); // mild two-component
}

// ---------------------------------------------------------------------------
// Particle plan (pure data for the shared ParticleService)
// ---------------------------------------------------------------------------

/** Pure-data ejecta particle plan; no GPU handles; fully deterministic. */
export interface MergerEjectaParticlePlan {
  readonly capacity: number;
  readonly shellRadiusUnits: number;
  readonly speedUnitsS: number;
  /** Polar bias of spawn directions (0 = isotropic, 1 = strongly bipolar). */
  readonly polarBias: number;
  readonly lifetimeSeconds: readonly [number, number];
  readonly sizePx: readonly [number, number];
  readonly colorRamp: ReadonlyArray<{
    readonly t: number;
    readonly color: readonly [number, number, number];
    readonly alpha: number;
  }>;
  readonly seed: number;
}

/**
 * Build the ejecta particle plan for a tier. The emitter is ONE sphere shell
 * referenced to the early expansion (coherence with the volume field: same
 * velocity scale); phase gating happens per frame through
 * `setPopulationScale`, mirroring the stellar-explosion discipline.
 */
export function buildEjectaParticlePlan(
  scenario: ResolvedMergerScenario,
  capacity: number
): MergerEjectaParticlePlan {
  const refRadius = Math.max(scenario.contactSeparationUnits, 0.5);
  // Slow outward drift tracking the presented shell (see compression note).
  const driftSpeedUnitsS = 0.5;
  const polarBias =
    scenario.ejectaScenario === 'polar-enhanced'
      ? 0.8
      : scenario.ejectaScenario === 'equatorial-tidal'
        ? 0.2
        : 0.5;
  return {
    capacity: Math.max(0, Math.floor(capacity)),
    shellRadiusUnits: refRadius,
    speedUnitsS: driftSpeedUnitsS,
    polarBias,
    lifetimeSeconds: [6, 14],
    sizePx: [1, 2.5],
    colorRamp: [
      { t: 0, color: [1.1, 0.7, 0.4], alpha: 0.1 },
      { t: 0.45, color: [0.8, 0.36, 0.2], alpha: 0.07 },
      { t: 1, color: [0.4, 0.14, 0.1], alpha: 0.04 }
    ],
    seed: scenario.seed
  };
}
