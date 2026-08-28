/**
 * Stellar Explosion temperature/emissivity evolution (CA4-08).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 3 ("temperature/
 *   emissivity evolution", "early phase hotter/brighter, later ejecta cooler/
 *   dimmer/redder");
 * - mission section 28 (the RGB trend must be tied to a DOCUMENTED
 *   temperature/emissivity proxy — never random cinematic orange; no claims
 *   of full spectral synthesis);
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md PROCEDURAL_SCIENTIFIC.
 *
 * DISCLOSED APPROXIMATION: kelvinToLinearRgb is a piecewise-linear ramp over
 * log10(T) anchored on a Planckian-locus-inspired palette (same technique as
 * the neutron-star module's TEMPERATURE_RAMP_ANCHORS). It is NOT Planck-law
 * integration and carries no radiometric claim. Emission intensity follows
 * physics.luminosityProxy (peak-normalized shape only).
 *
 * Two faces per formula (coherence contract): CPU evaluators for tests/UI
 * and a TSL uniform bundle + color graph consumed by the volume march and
 * particle ramp generation.
 */

import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import { uniform, vec3, vec4 } from 'three/tsl';

import { luminosityProxy, photosphericTemperatureK, TEMPERATURE_FLOOR_K } from './physics.js';
import type { ResolvedScenario } from './types.js';

// ---------------------------------------------------------------------------
// Temperature -> linear-light RGB ramp
// ---------------------------------------------------------------------------

/** Ramp anchors over log10(T). Hand-picked Planck-inspired palette. */
const TEMPERATURE_RAMP_ANCHORS: ReadonlyArray<{
  readonly logT: number;
  readonly rgb: readonly [number, number, number];
}> = [
  { logT: 3.0, rgb: [1.0, 0.18, 0.02] }, // 1000 K, deep ember red
  { logT: 3.48, rgb: [1.0, 0.36, 0.09] }, // ~3000 K, dull red-orange
  { logT: 3.78, rgb: [1.0, 0.87, 0.72] }, // ~6000 K, warm white
  { logT: 4.0, rgb: [0.86, 0.91, 1.0] }, // 1e4 K, white-blue
  { logT: 4.48, rgb: [0.68, 0.79, 1.0] }, // ~3e4 K, blue-white
  { logT: 7.0, rgb: [0.55, 0.66, 1.0] } // asymptote for shock-flash blues
];

/** Valid input domain; values outside are clamped (never extrapolated). */
export const KELVIN_RAMP_MIN_K = 1000;
export const KELVIN_RAMP_MAX_K = 1e7;

/**
 * Map a photospheric temperature to linear-light RGB via piecewise-linear
 * interpolation of {@link TEMPERATURE_RAMP_ANCHORS} over log10(T).
 * NOT Planck integration (see header disclosure). Total function: clamps,
 * never throws, always returns finite components in [0, 1].
 */
export function kelvinToLinearRgb(temperatureK: number): [number, number, number] {
  const t = Number.isFinite(temperatureK)
    ? Math.min(KELVIN_RAMP_MAX_K, Math.max(KELVIN_RAMP_MIN_K, temperatureK))
    : KELVIN_RAMP_MIN_K;
  const logT = Math.log10(t);
  const anchors = TEMPERATURE_RAMP_ANCHORS;
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (logT <= first.logT) return [...first.rgb];
  if (logT >= last.logT) return [...last.rgb];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (logT >= a.logT && logT <= b.logT) {
      const f = (logT - a.logT) / (b.logT - a.logT);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f
      ];
    }
  }
  return [1, 1, 1]; // unreachable given the clamps above
}

// ---------------------------------------------------------------------------
// Emission state at time t (CPU reference form)
// ---------------------------------------------------------------------------

export interface EmissionSample {
  /** Linear-light RGB from the disclosed temperature ramp. */
  readonly rgb: readonly [number, number, number];
  /** Peak-normalized intensity from luminosityProxy (arbitrary units). */
  readonly intensity: number;
  /** The driving proxy temperature (kelvin) — surfaced for UI/debug honesty. */
  readonly temperatureK: number;
}

/**
 * Full emission sample at simulation-clock time `tSeconds`. Early phases are
 * hot/blue-white/bright; late ejecta cool/redden/dim, driven by the physics
 * module's monotone-after-peak temperature law.
 */
export function emissionColorAndGain(tSeconds: number, resolved: ResolvedScenario): EmissionSample {
  const temperatureK = photosphericTemperatureK(tSeconds, resolved);
  const intensity = luminosityProxy(tSeconds, resolved);
  return { rgb: kelvinToLinearRgb(temperatureK), intensity, temperatureK };
}

/**
 * Representative emission ages used by the ejecta particle color ramp:
 * flash (hot blue-white), breakout (white-yellow), expansion (orange),
 * nebular (deep red). Returned as normalized ramp stops with alpha fading
 * toward the cold end (late ejecta dimmer — mission section 28 trend).
 */
export function representativeRampStops(): ReadonlyArray<{
  t: number;
  color: readonly [number, number, number];
  alpha: number;
}> {
  // ALPHAS ARE PER-PARTICLE AND THE BLENDING IS ADDITIVE. With a population of
  // 4k-60k sprites concentrated in a shell, per-particle alphas of 0.3-0.9
  // accumulate to hundreds of units of linear radiance: the ejecta presented as
  // a featureless blown-out white ball with a bloom haze filling the frame. The
  // shape of the ramp (hot/blue -> cool/red with declining opacity) is the model
  // statement and is unchanged; only the accumulation scale is corrected.
  return [
    { t: 0, color: kelvinToLinearRgb(2e5), alpha: 0.04 },
    { t: 0.35, color: kelvinToLinearRgb(3e4), alpha: 0.03 },
    { t: 0.65, color: kelvinToLinearRgb(8e3), alpha: 0.022 },
    { t: 1, color: kelvinToLinearRgb(TEMPERATURE_FLOOR_K * 2), alpha: 0.01 }
  ];
}

// ---------------------------------------------------------------------------
// TSL face — uniforms + emissive color graph
// ---------------------------------------------------------------------------

/** Inferred uniform bundle (ReturnType pattern; see density.ts note). */
function createEmissionUniforms() {
  return {
    /** Current emission tint (linear RGB). Vector3 BY REFERENCE, mutated. */
    tint: uniform(new THREE.Vector3(1, 1, 1)),
    /** Peak-normalized emission gain. Mutated per frame. */
    gain: uniform(1)
  };
}

export type EmissionUniformBundle = ReturnType<typeof createEmissionUniforms>;

/** Create the bundle; callers overwrite via {@link configureEmissionUniforms}. */
export function createExplosionEmissionUniforms(): EmissionUniformBundle {
  return createEmissionUniforms();
}

/**
 * Write an {@link EmissionSample} into the bundle. Called once per frame by
 * the destination module; no graph rebuild occurs at runtime.
 */
export function configureEmissionUniforms(u: EmissionUniformBundle, sample: EmissionSample): void {
  u.tint.value.set(sample.rgb[0], sample.rgb[1], sample.rgb[2]);
  u.gain.value = sample.intensity;
}

/**
 * HDR emissive color node for volume/particle materials: tint x gain in
 * linear space, alpha 1 (alpha is handled by the respective blend paths).
 * Consumes ONLY display-side uniforms — this multiplies presentation
 * radiance and never feeds back into any physical quantity.
 */
export function buildEmissionColorNode(u: EmissionUniformBundle): Node<'vec4'> {
  return vec4(vec3(u.tint).mul(u.gain), 1);
}

/** Mix helper kept local so callers do not import three/tsl twice. */
export function mixRgbStops(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  f: number
): [number, number, number] {
  const g = Math.min(1, Math.max(0, f));
  return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g];
}
