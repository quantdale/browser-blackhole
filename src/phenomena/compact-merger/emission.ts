/**
 * Compact Merger kilonova emission evolution (CA5-10).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 4 (kilonova phase;
 *   anisotropic expanding component);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 7 (kilonova
 *   expansion/cooling ordering is monotonic under the model);
 * - mission section 13 (the kilonova is NOT "turn the scene orange": radius,
 *   emission and temperature derive from an explicit reduced model).
 *
 * MODEL (disclosed reduced arctan-rise / power-law-fall light curve, the
 * standard qualitative kilonova shape):
 *
 *   tau        = t - t_contact            (0 before contact)
 *   L(tau)     = peak * rise(tau) * fall(tau)
 *   rise       = 2/pi * atan(tau / tau_peak)          (smooth 0 -> 1)
 *   fall       = (max(tau,tau_peak)/tau_peak)^(-1.3)   (declining tail)
 *   T(tau)     = T0 * (max(tau, tau0)/tau0)^(-0.55)    (diffusive cooling)
 *
 * Temperature maps to linear RGB through the shared blackbody approximation
 * discipline (bounded, overflow-guarded). Everything is finite and
 * non-negative; the function is pure in (tau, scenario).
 */

import type { ResolvedMergerScenario } from './types.js';

/** Kilonova light-curve peak time, seconds (~0.7 day, illustrative). */
export const KILONOVA_PEAK_SECONDS = 60_000;
/** Cooling reference time, seconds (~0.5 day). */
const TAU0 = 43_200;
/** Photospheric temperature at tau0, kelvin (illustrative canonical). */
export const KILONOVA_T0_K = 4500;
/** Peak luminosity proxy in arbitrary scene radiance units. */
export const KILONOVA_PEAK_GAIN = 2.6;

/** Seconds since contact (0 before contact). */
export function kilonovaAge(tSeconds: number, contactSeconds: number): number {
  const t = Number.isFinite(tSeconds) ? tSeconds : 0;
  const tc = Number.isFinite(contactSeconds) ? contactSeconds : 0;
  return Math.max(0, t - tc);
}

/** Luminosity proxy in [0, peak] scene radiance units (0 before contact). */
export function kilonovaLuminosity(tauSeconds: number, peakGain = KILONOVA_PEAK_GAIN): number {
  const tau = Number.isFinite(tauSeconds) ? Math.max(0, tauSeconds) : 0;
  if (tau <= 0) return 0;
  const rise = (2 / Math.PI) * Math.atan(tau / KILONOVA_PEAK_SECONDS);
  const fall = Math.pow(Math.max(tau, KILONOVA_PEAK_SECONDS) / KILONOVA_PEAK_SECONDS, -1.3);
  const value = peakGain * rise * fall;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Photospheric temperature proxy, kelvin (monotone DECLINING in tau). */
export function kilonovaTemperatureK(tauSeconds: number): number {
  const tau = Number.isFinite(tauSeconds) ? Math.max(1e-6, tauSeconds) : TAU0;
  const t = KILONOVA_T0_K * Math.pow(Math.max(tau, TAU0) / TAU0, -0.55);
  return Number.isFinite(t) && t > 0 ? t : KILONOVA_T0_K;
}

/**
 * Bounded blackbody-ish kelvin -> linear RGB (monotone empirical Planckian
 * locus fit over 1000..40000 K; presentation only, same discipline as the
 * stellar-explosion emission module). Output components are finite, >= 0,
 * <= 1, and the chromaticity moves redward monotonically as T falls.
 */
export function kelvinToLinearRgb(kelvin: number): [number, number, number] {
  const t = Number.isFinite(kelvin) ? Math.min(40000, Math.max(1000, kelvin)) : 6000;
  const ref = 6600;
  const ratio = ref / t;
  const r = t >= ref ? Math.pow(ratio, 0.28) : 1;
  const g = t >= ref ? Math.pow(ratio, 0.14) : Math.pow(t / ref, 0.24);
  const b = t >= ref ? 1 : Math.pow(t / ref, 0.9);
  const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  // Linear-light shaping (gamma 2.2 on the sRGB-ish approximations).
  const shape = (v: number): number => Math.pow(clamp01(v), 2.2);
  return [shape(r), shape(g), shape(b)];
}

/** Resolved kilonova presentation sample at time t (pure). */
export interface KilonovaSample {
  readonly ageSeconds: number;
  readonly luminosity: number;
  readonly temperatureK: number;
  /** Linear RGB tint from the temperature proxy. */
  readonly tint: readonly [number, number, number];
}

export function kilonovaSampleAt(
  tSeconds: number,
  scenario: ResolvedMergerScenario,
  peakGain = KILONOVA_PEAK_GAIN
): KilonovaSample {
  const age = kilonovaAge(tSeconds, scenario.contactSeconds);
  const luminosity = kilonovaLuminosity(age, peakGain);
  const temperatureK = kilonovaTemperatureK(age);
  return { ageSeconds: age, luminosity, temperatureK, tint: kelvinToLinearRgb(temperatureK) };
}
