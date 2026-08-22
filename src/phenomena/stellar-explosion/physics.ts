/**
 * Stellar Explosion reduced-model physics (CA4-03/04).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 3 (expanding shock
 *   shell, temperature/emissivity evolution, hypernova structural difference);
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md PROCEDURAL_SCIENTIFIC;
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 6 (invariant list:
 *   monotone radius, finite/non-negative fields, deterministic presets).
 *
 * APPROXIMATION DISCLOSURES (all deliberate, none hidden):
 *
 * 1. Shock expansion: {@link shockRadius} is a BLENDED KINEMATIC LAW — a
 *    free-expansion branch R = v0 t crossing smoothly (C1) into a
 *    Sedov-INSPIRED decelerating tail R ~ t^0.4. The blend is chosen for
 *    monotonicity and smoothness, not derived from the Sedov-Taylor
 *    self-similar solution; no blast-wave hydrodynamics is solved.
 * 2. Photospheric temperature: an empirical rise-to-peak + power-law decay
 *    envelope. It reproduces the qualitative "hot blue flash then cooling,
 *    reddening ejecta" trend; it is NOT spectral synthesis and NOT a
 *    radiation-transport solution.
 * 3. Luminosity proxy: arbitrary normalized units (peak = 1), shaped like
 *    observed supernova light curves (fast rise, slower decline). No
 *    bolometric correction, no Ni-56 heating model.
 * 4. Hypernova differs STRUCTURALLY from core collapse: higher velocity
 *    scale, stronger anisotropy, unipolar lobe weighting — explicitly not a
 *    brightness multiplier (mission section 31).
 *
 * Purity contract: every exported function is a pure function of its
 * arguments. No wall-clock reads, no Math.random, no module-level mutable
 * state. Same inputs => same outputs, always.
 */

import {
  C_KM_S,
  SCENE_UNIT_KM,
  SOLAR_RADIUS_KM,
  type ExplosionPhase,
  type ResolvedScenario,
  type StellarExplosionPublicState
} from './types.js';

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Clamp into [lo, hi]; inputs are already sanitized upstream. */
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Smooth 0..1 step (3t^2 - 2t^3). */
function smoothstep01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ---------------------------------------------------------------------------
// Scenario resolution (single derivation point for derived constants)
// ---------------------------------------------------------------------------

/** Default crossover scale when a preset does not pin one: 12 hours. */
const DEFAULT_CROSSOVER_SECONDS = 12 * 3600;

/**
 * Default presented progenitor dwell before the collapse trigger (seconds of
 * SIMULATION time; the UI timeline compresses this phase nonlinearly).
 */
export const PROGENITOR_DWELL_SECONDS = 90;

/**
 * Derive the immutable resolved scenario every subsystem consumes. All
 * numeric inputs are re-clamped defensively here so even a hand-assembled
 * state record cannot produce a non-finite or out-of-range resolution.
 */
export function resolveScenario(state: StellarExplosionPublicState): ResolvedScenario {
  const grb = state.scenarioId === 'long-grb';

  const velocityKmS = clamp(state.expansionVelocityScaleKmS, 1000, 60000);
  const axis = normalizeAxis(state.anisotropyAxis);
  const halfOpeningDeg =
    state.jet.enabled || grb ? clamp(state.jet.halfOpeningAngleDeg, 1, 25) : 10;
  const beta = clamp(state.jet.velocityProxyC, 0.05, 0.995);

  return {
    scenarioId: state.scenarioId,
    grb,
    progenitorRadiusUnits:
      (clamp(state.progenitorRadiusSolar, 0.05, 3000) * SOLAR_RADIUS_KM) / SCENE_UNIT_KM,
    progenitorTemperatureK: clamp(state.progenitorTemperatureK, 1500, 50000),
    velocityKmS,
    velocityUnitsS: velocityKmS / SCENE_UNIT_KM,
    energyProxyFoe: clamp(state.energyProxyFoe, 0.01, 100),
    ejectaMassProxySolar: clamp(state.ejectaMassProxySolar, 0.05, 60),
    axis,
    anisotropyStrength: clamp(state.anisotropyStrength, 0, 1),
    lobeWeighting: clamp(state.lobeWeighting, 0, 1),
    clumpingLevel: clamp(state.clumpingLevel, 0, 1),
    clumpingSeed: Math.max(1, Math.floor(state.clumpingSeed)),
    jet: {
      enabled: grb || state.jet.enabled,
      halfOpeningAngleRad: (halfOpeningDeg * Math.PI) / 180,
      velocityProxyC: beta,
      velocityUnitsS: (beta * C_KM_S) / SCENE_UNIT_KM,
      viewingAngleDeg: clamp(state.jet.viewingAngleDeg, 0, 180)
    },
    crossoverSeconds: DEFAULT_CROSSOVER_SECONDS,
    explosionTimeSeconds: PROGENITOR_DWELL_SECONDS
  };
}

/** Normalize an axis vector; degenerate input falls back to +Y (world up). */
export function normalizeAxis(
  axis: readonly [number, number, number]
): readonly [number, number, number] {
  const [x, y, z] = axis;
  const nx = typeof x === 'number' && Number.isFinite(x) ? x : 0;
  const ny = typeof y === 'number' && Number.isFinite(y) ? y : 1;
  const nz = typeof z === 'number' && Number.isFinite(z) ? z : 0;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return [0, 1, 0];
  return [nx / len, ny / len, nz / len];
}

// ---------------------------------------------------------------------------
// Shock expansion (blended free-expansion -> Sedov-like kinematic law)
// ---------------------------------------------------------------------------

/** Sedov-inspired time exponent used in the decelerating branch. */
export const SEDOV_EXPONENT = 0.4;

/** Blend sharpness of the crossover (higher = sharper). Fixed, disclosed. */
const BLEND_SHARPNESS = 6;

/**
 * Shock/ejecta characteristic radius at physical age `t` seconds since the
 * explosion trigger (`t <= 0` yields 0).
 *
 * Law (DISCLOSED APPROXIMATION — kinematic blend, not hydrodynamics):
 *
 *   R(t) = v0 * t * (1 + (t/t_x)^n)^((p - 1)/n),   n = BLEND_SHARPNESS,
 *                                                   p = SEDOV_EXPONENT
 *
 * - t << t_x: R ~ v0 t            (free expansion, coasting ejecta)
 * - t >> t_x: R ~ v0 t_x (t/t_x)^p  (Sedov-INSPIRED deceleration, p = 0.4)
 * - C1-smooth at all t; dR/dt > 0 for every t > 0 (monotonicity invariant).
 *
 * `t_x` is `resolved.crossoverSeconds` — the order-of-magnitude time at which
 * swept-up mass begins to matter. It is a presentation parameter, not a fit
 * to any specific event's light curve.
 */
export function shockRadiusUnits(tSeconds: number, resolved: ResolvedScenario): number {
  if (!Number.isFinite(tSeconds) || tSeconds <= 0) return 0;
  const v0 = resolved.velocityUnitsS;
  const tx = Math.max(resolved.crossoverSeconds, 1e-6);
  const u = tSeconds / tx;
  // (1 + u^n)^((p-1)/n): equals 1 for u<<1, u^(p-1) for u>>1.
  const blend = Math.pow(1 + Math.pow(u, BLEND_SHARPNESS), (SEDOV_EXPONENT - 1) / BLEND_SHARPNESS);
  const r = v0 * tSeconds * blend;
  return Number.isFinite(r) ? r : 0;
}

/**
 * dR/dt in scene units/s. Strictly positive for t > 0 under every valid
 * preset (VALIDATION_TESTING section 6 invariant).
 */
export function shockVelocityUnitsS(tSeconds: number, resolved: ResolvedScenario): number {
  if (!Number.isFinite(tSeconds) || tSeconds <= 0) return 0;
  const h = Math.max(Math.abs(tSeconds) * 1e-5, 1e-4); // central-difference step
  const rPlus = shockRadiusUnits(tSeconds + h, resolved);
  const rMinus = shockRadiusUnits(Math.max(tSeconds - h, 0), resolved);
  const v = (rPlus - rMinus) / (tSeconds + h - Math.max(tSeconds - h, 0));
  return Number.isFinite(v) ? Math.max(v, 0) : 0;
}

// ---------------------------------------------------------------------------
// Temperature / luminosity proxies
// ---------------------------------------------------------------------------

/**
 * Peak photospheric temperature proxy at flash/shock-breakout, kelvin.
 * ILLUSTRATIVE: early supernova shocks are UV/X-ray bright; the visible-band
 * proxy peaks near 2e5 K and cools through the observed SN temperature range.
 */
const FLASH_PEAK_TEMPERATURE_K = 2.0e5;

/** Temperature floor: below this the modelled photosphere stops evolving. */
export const TEMPERATURE_FLOOR_K = 1000;

/** Power-law cooling exponent after peak (disclosed empirical choice). */
const COOLING_EXPONENT = 0.55;

/** Rise duration of the flash in seconds after the explosion trigger. */
export const FLASH_RISE_SECONDS = 6 * 3600;

/**
 * Photospheric temperature proxy at age `t` seconds since trigger.
 *
 * Shape (DISCLOSED APPROXIMATION):
 * - before the explosion: constant progenitor surface temperature;
 * - rise over FLASH_RISE_SECONDS to FLASH_PEAK_TEMPERATURE_K;
 * - power-law decay T ~ (t - t_peak)^-COOLING_EXPONENT joined continuously,
 *   floored at TEMPERATURE_FLOOR_K.
 *
 * Monotone NON-INCREASING after the peak; finite everywhere.
 */
export function photosphericTemperatureK(tSeconds: number, resolved: ResolvedScenario): number {
  if (!Number.isFinite(tSeconds)) return resolved.progenitorTemperatureK;
  const dt = tSeconds - resolved.explosionTimeSeconds;
  if (dt <= 0) return resolved.progenitorTemperatureK;

  if (dt >= FLASH_RISE_SECONDS) {
    const decayed = FLASH_PEAK_TEMPERATURE_K * Math.pow(dt / FLASH_RISE_SECONDS, -COOLING_EXPONENT);
    return Number.isFinite(decayed) ? Math.max(TEMPERATURE_FLOOR_K, decayed) : TEMPERATURE_FLOOR_K;
  }

  // Continuous rise: start/end match the neighbouring branches exactly.
  const s = smoothstep01(dt / FLASH_RISE_SECONDS);
  const tPeak =
    resolved.progenitorTemperatureK +
    (FLASH_PEAK_TEMPERATURE_K - resolved.progenitorTemperatureK) * s;
  return Number.isFinite(tPeak) ? Math.max(TEMPERATURE_FLOOR_K, tPeak) : TEMPERATURE_FLOOR_K;
}

/**
 * Luminosity proxy, normalized so the flash/breakout peak is exactly 1.
 * Arbitrary units by design (peak-normalized light-curve SHAPE only):
 * fast rise (~FLASH_RISE_SECONDS), then t^-1.1-style decline. NOT a
 * radiometric prediction and NOT integrated against any filter bandpass.
 */
export function luminosityProxy(tSeconds: number, resolved: ResolvedScenario): number {
  if (!Number.isFinite(tSeconds)) return 0;
  const dt = tSeconds - resolved.explosionTimeSeconds;
  if (dt <= 0) return 0;
  if (dt < FLASH_RISE_SECONDS) {
    const s = smoothstep01(dt / FLASH_RISE_SECONDS);
    return 0.02 + 0.98 * s;
  }
  const declined = Math.pow(dt / FLASH_RISE_SECONDS, -1.1);
  return Number.isFinite(declined) ? Math.max(declined, 1e-4) : 1e-4;
}

/**
 * Structural difference check used by tests and UI fidelity notes: the
 * hypernova preset must differ from core collapse in MODEL STATE (velocity,
 * anisotropy, lobes), never merely in brightness. Returns true when the two
 * resolved scenarios differ in any structural field.
 */
export function structurallyDistinct(a: ResolvedScenario, b: ResolvedScenario): boolean {
  return (
    a.scenarioId !== b.scenarioId ||
    a.velocityKmS !== b.velocityKmS ||
    a.anisotropyStrength !== b.anisotropyStrength ||
    a.lobeWeighting !== b.lobeWeighting
  );
}

// ---------------------------------------------------------------------------
// Phase queries (thin wrappers over timeline; kept here for physics callers)
// ---------------------------------------------------------------------------

/** Convenience: is the given phase one where ejecta/particles should exist? */
export function phaseHasEjecta(phase: ExplosionPhase): boolean {
  return (
    phase === 'shock-breakout' ||
    phase === 'expanding-ejecta' ||
    phase === 'nebular' ||
    phase === 'jet-breakout'
  );
}
