/**
 * Stellar Explosion GPU ejecta particle plan (CA4-06 particle track).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 3 ("clumpy GPU
 *   particles", quality-dependent population);
 * - docs/cosmic-atlas/RENDERING_SERVICES.md section 3 (ParticleService
 *   config contract: emitters, lifetime, sizePx, colorRamp, blending);
 * - mission sections 26/27 (GPU population scaled by quality; particles and
 *   volume must share timeline/expansion/axis/seed so they describe the SAME
 *   explosion).
 *
 * This module is PURE DATA: the destination module feeds the returned plan
 * straight into `services.particles.createSystem`. Coherence is structural:
 * emitter radii/speeds derive from physics.shockRadiusUnits and the resolved
 * velocity scale; direction biases derive from the same anisotropy axis and
 * lobe weighting as the volume field; the seed family matches clumpingSeed.
 *
 * Population rationale (documented per tier; final tuning belongs to
 * benchmarks, not intuition):
 * - low    4_000  : keeps Low tier comfortably real-time alongside volume.
 * - medium 12_000 : interactive target on mainstream hardware.
 * - high   28_000 : dense clump structure for capable GPUs.
 * - ultra  60_000 : largest validated-looking population before draw cost
 *                    dominates; revisit only with benchmark evidence.
 */

import { shockRadiusUnits } from './physics.js';
import { representativeRampStops } from './emission.js';
import type {
  EjectaEmitterPlanEntry,
  EjectaParticlePlan,
  ExplosionTier,
  ResolvedScenario
} from './types.js';
import type { ExplosionPhase } from './types.js';

/** Per-tier capacities (see header rationale). */
const TIER_CAPACITY: Record<ExplosionTier, number> = {
  low: 4000,
  medium: 12000,
  high: 28000,
  ultra: 60000
};

/**
 * Phases in which the large ejecta population exists at all (mission
 * section 36 resource phase awareness). Progenitor/collapse keep every
 * expensive system OFF; flash initializes a minimal population.
 */
function phaseEnablesParticles(phase: ExplosionPhase): boolean {
  return (
    phase === 'flash' ||
    phase === 'shock-breakout' ||
    phase === 'expanding-ejecta' ||
    phase === 'nebular' ||
    phase === 'engine-ignition' ||
    phase === 'jet-breakout'
  );
}

/**
 * Fraction of capacity drawn during each enabled phase: the flash starts a
 * minimal population which ramps to full once expansion dominates.
 */
function phasePopulationFraction(phase: ExplosionPhase): number {
  switch (phase) {
    case 'flash':
      return 0.25;
    case 'shock-breakout':
    case 'engine-ignition':
      return 0.6;
    default:
      return 1;
  }
}

/**
 * Build the deterministic ejecta plan for the given scenario state, phase,
 * and quality tier.
 *
 * Emitter design: THREE concentric shell emitters spanning 0.8..1.2 R(t)
 * with speed variation +-20% around the free-expansion scale, so particles
 * ride WITH the analytic shell instead of expanding at an unrelated rate
 * (mission section 27). Direction bias collimates along the asymmetry axis
 * proportional to strength x lobe weighting — identical axis semantics to
 * the volume density field.
 */
export function buildEjectaEmitterPlan(
  tSeconds: number,
  phase: ExplosionPhase,
  tier: ExplosionTier,
  resolved: ResolvedScenario
): EjectaParticlePlan {
  const seed = resolved.clumpingSeed;
  const common = {
    lifetimeSeconds: [10, 30] as const,
    sizePx: [2, 7] as const,
    colorRamp: representativeRampStops(),
    blending: 'additive' as const,
    seed
  };

  if (!phaseEnablesParticles(phase)) {
    return { enabled: false, capacity: 0, emitters: [], ...common };
  }

  // Age since trigger drives shell radius/speeds (same clock as the volume).
  const age = Math.max(0, tSeconds - resolved.explosionTimeSeconds);
  const radius = Math.max(shockRadiusUnits(age, resolved), resolved.progenitorRadiusUnits);

  // Collimation strength shared with the volume's angular asymmetry.
  const biasMagnitude = 0.6 * resolved.anisotropyStrength * resolved.lobeWeighting;
  const bias: readonly [number, number, number] | null =
    biasMagnitude > 0
      ? [
          resolved.axis[0] * biasMagnitude,
          resolved.axis[1] * biasMagnitude,
          resolved.axis[2] * biasMagnitude
        ]
      : null;

  const bandFactors = [0.82, 1.0, 1.18];
  const speedFactors = [0.85, 1.0, 1.2];
  const emitters: EjectaEmitterPlanEntry[] = bandFactors.map((band, i) => ({
    kind: 'sphere-shell',
    origin: [0, 0, 0],
    radiusUnits: radius * band,
    // Same length by construction; guarded for noUncheckedIndexedAccess.
    speedUnitsS: resolved.velocityUnitsS * (speedFactors[i] ?? 1),
    directionBias: bias
  }));

  const fullCapacity = Math.max(
    1,
    Math.floor(TIER_CAPACITY[tier] * phasePopulationFraction(phase))
  );
  return { enabled: true, capacity: fullCapacity, emitters, ...common };
}
