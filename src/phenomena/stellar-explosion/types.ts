/**
 * Stellar Explosion public state schema and resolved-scenario types (CA4-01).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 3 "Stellar Explosion"
 *   (taxonomy, density model contract, hypernova/GRB requirements);
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md section "Stellar
 *   Explosion" (control vocabulary: scenario/model/timeline/visual split);
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md "PROCEDURAL_SCIENTIFIC" (every
 *   approximation must be disclosed; no predictive-solver claims);
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md section 6 normalization discipline
 *   (one normalizer, finite guards, clamped ranges, clamp-don't-reject).
 *
 * FIDELITY CLASS: PROCEDURAL_SCIENTIFIC. This is a scientifically constrained
 * REDUCED visual model informed by supernova morphology. It is NOT
 * hydrodynamics, NOT radiation-hydrodynamics, and NOT a stellar-evolution
 * simulation; every formula in this package carries an explicit disclosure of
 * what it does and does not represent.
 *
 * SCENE SCALE CONVENTION: 1 scene unit = {@link SCENE_UNIT_KM} kilometres.
 * All conversions funnel through that single constant so a future rescale
 * touches exactly one place (mirrors the neutron-star destination's
 * KM_TO_SCENE_UNITS discipline).
 */

import type { QualityTier } from '../../atlas/types.js';

// ---------------------------------------------------------------------------
// Scenario taxonomy (PHENOMENA_IMPLEMENTATION section 3)
// ---------------------------------------------------------------------------

/**
 * Scenario ids. Hypernova and Long GRB are PRESETS/SCENARIOS within this
 * destination, never separate top-level destinations (mission taxonomy).
 */
export type ExplosionScenarioId = 'core-collapse' | 'stripped-envelope' | 'hypernova' | 'long-grb';

/** Timeline phases. GRB scenarios additionally use engine/jet phases. */
export type ExplosionPhase =
  | 'progenitor'
  | 'collapse'
  | 'flash'
  | 'shock-breakout'
  | 'expanding-ejecta'
  | 'nebular'
  // Long-GRB-only phases (collapsar central-engine picture):
  | 'engine-ignition'
  | 'jet-breakout';

export function isGrbScenario(id: ExplosionScenarioId): boolean {
  return id === 'long-grb';
}

// ---------------------------------------------------------------------------
// Public state schema (validated by normalizeStellarExplosionState)
// ---------------------------------------------------------------------------

/** Bipolar jet configuration (Long GRB / collapsar mode). */
export interface JetConfig {
  /** Jet present at all. Non-GRB presets default this off. */
  enabled: boolean;
  /** Half-opening angle of each lobe, degrees. Bounded 1..25. */
  halfOpeningAngleDeg: number;
  /**
   * Jet-front speed as a fraction of c. ILLUSTRATIVE proxy: the rendered jet
   * front is a kinematic pattern, not a relativistic MHD outflow.
   * Bounded 0.05..0.995.
   */
  velocityProxyC: number;
  /**
   * Observer viewing angle from the jet axis, degrees (0 = looking straight
   * down the jet). Bounded 0..180. Drives {@link JetViewingResponse}.
   */
  viewingAngleDeg: number;
}

/**
 * Validated, unit-explicit public state for the stellar-explosion
 * destination. Every field passes through exactly one normalizer
 * ({@link normalizeStellarExplosionState}); renderer modules must never
 * consume raw preset records directly.
 */
export interface StellarExplosionPublicState {
  scenarioId: ExplosionScenarioId;
  /** Progenitor photospheric radius, solar radii. */
  progenitorRadiusSolar: number;
  /** Progenitor surface temperature proxy, kelvin. */
  progenitorTemperatureK: number;
  /**
   * Explosion kinetic-energy proxy in foe (1 foe = 1e51 erg). Drives the
   * expansion velocity scale via the documented reduced relation; it is NOT
   * a solved hydrodynamic energy budget.
   */
  energyProxyFoe: number;
  /** Ejecta mass proxy, solar masses (sets density normalization only). */
  ejectaMassProxySolar: number;
  /** Initial shock velocity scale, km/s (free-expansion phase). */
  expansionVelocityScaleKmS: number;
  /** Global deviation from spherical symmetry, clamped 0..1. */
  anisotropyStrength: number;
  /** Asymmetry/jet axis; normalized to unit length by the sanitizer. */
  anisotropyAxis: [number, number, number];
  /**
   * Lobe weighting 0..1: 0 = symmetric bipolar deformation, 1 = unipolar
   * (single-lobe) deformation along the axis.
   */
  lobeWeighting: number;
  /** Small-scale clumping amplitude 0..1 (morphology only, never bulk). */
  clumpingLevel: number;
  /** Deterministic seed for clumping noise. Positive integer. */
  clumpingSeed: number;
  jet: JetConfig;
  /** Deterministic timeline offset, seconds since explosion trigger. */
  timeSeconds: number;
}

// ---------------------------------------------------------------------------
// Resolved scenario (derived constants consumed by renderers)
// ---------------------------------------------------------------------------

/** Kilometres per scene unit. Single conversion point for this destination.
 *
 * Chosen so the whole presented evolution fits a sane world range: a 500
 * R_sun red-supergiant progenitor is ~35 scene units, day-old ejecta ~100
 * units, and month-old ejecta a few thousand units — all inside typical
 * camera far planes without rescaling mid-timeline.
 */
export const SCENE_UNIT_KM = 1e7;

/** Speed of light, km/s (SI exact value). */
export const C_KM_S = 299792.458;

/** Solar radius, km (IAU nominal). */
export const SOLAR_RADIUS_KM = 6.957e5;

/**
 * Fully derived, sanitized scenario used by every subsystem (density,
 * emission, timeline, ejecta plan, jet). Constructed once by
 * {@link resolveScenario}; treat it as immutable.
 */
export interface ResolvedScenario {
  readonly scenarioId: ExplosionScenarioId;
  readonly grb: boolean;

  /** Progenitor radius, scene units. */
  readonly progenitorRadiusUnits: number;
  readonly progenitorTemperatureK: number;

  /** Initial shock velocity, km/s and scene-units/s (free expansion). */
  readonly velocityKmS: number;
  readonly velocityUnitsS: number;

  /** Energy/mass proxies (disclosed reduced-model inputs, not budgets). */
  readonly energyProxyFoe: number;
  readonly ejectaMassProxySolar: number;

  /** Unit-length asymmetry axis. */
  readonly axis: readonly [number, number, number];
  readonly anisotropyStrength: number;
  readonly lobeWeighting: number;
  readonly clumpingLevel: number;
  readonly clumpingSeed: number;

  readonly jet: {
    readonly enabled: boolean;
    readonly halfOpeningAngleRad: number;
    readonly velocityProxyC: number;
    /** Jet front speed, scene units/s (beta * c). */
    readonly velocityUnitsS: number;
    readonly viewingAngleDeg: number;
  };

  /**
   * Blend time-scale of the free-expansion -> Sedov-like crossover
   * (seconds). See physics.shockRadius for the exact blended law.
   */
  readonly crossoverSeconds: number;
  /** Physical time of collapse trigger on the presented timeline (s). */
  readonly explosionTimeSeconds: number;
}

// ---------------------------------------------------------------------------
// Ejecta particle plan (pure data for ParticleService config)
// ---------------------------------------------------------------------------

/** Particle population sizes per quality tier (documented rationale below). */
export type ExplosionTier = QualityTier;

export interface EjectaEmitterPlanEntry {
  kind: 'sphere-shell';
  origin: readonly [number, number, number];
  /** Shell radius band centre at spawn, scene units. */
  radiusUnits: number;
  /** Radial spawn speed magnitude, scene units/s. */
  speedUnitsS: number;
  /** Collimation direction (anisotropy axis scaled), or null for isotropic. */
  directionBias: readonly [number, number, number] | null;
}

/**
 * Pure-data description the destination module turns into a
 * ParticleService system. Contains no GPU handles; fully deterministic.
 */
export interface EjectaParticlePlan {
  /** false before the explosion reaches particle-bearing phases. */
  enabled: boolean;
  capacity: number;
  emitters: EjectaEmitterPlanEntry[];
  lifetimeSeconds: readonly [number, number];
  sizePx: readonly [number, number];
  colorRamp: ReadonlyArray<{ t: number; color: readonly [number, number, number]; alpha: number }>;
  blending: 'additive';
  seed: number;
}

// ---------------------------------------------------------------------------
// Normalization (STATE_AND_ROUTES section 6: one normalizer, clamp-don't-reject)
// ---------------------------------------------------------------------------

const SCENARIO_IDS: readonly ExplosionScenarioId[] = [
  'core-collapse',
  'stripped-envelope',
  'hypernova',
  'long-grb'
];

/** Sanitizer bounds (documented control ranges; see DESTINATION_CONTROL_CATALOG). */
const RADIUS_SOLAR_RANGE = { min: 0.05, max: 3000 } as const;
const TEMPERATURE_K_RANGE = { min: 1500, max: 50000 } as const;
const ENERGY_FOE_RANGE = { min: 0.01, max: 100 } as const;
const MASS_SOLAR_RANGE = { min: 0.05, max: 60 } as const;
const VELOCITY_KM_S_RANGE = { min: 1000, max: 60000 } as const;
const UNIT_INTERVAL = { min: 0, max: 1 } as const;
const HALF_OPENING_DEG_RANGE = { min: 1, max: 25 } as const;
const VELOCITY_PROXY_C_RANGE = { min: 0.05, max: 0.995 } as const;
const VIEWING_DEG_RANGE = { min: 0, max: 180 } as const;
const TIME_SECONDS_MAX = 1e12;

function sanitizeNumber(
  raw: unknown,
  range: { readonly min: number; readonly max: number },
  fallback: number
): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
  return Math.min(range.max, Math.max(range.min, n));
}

function sanitizeUnitVector(raw: unknown): [number, number, number] {
  if (Array.isArray(raw) && raw.length >= 3) {
    const x = raw[0];
    const y = raw[1];
    const z = raw[2];
    if (
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof z === 'number' &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(z)
    ) {
      const len = Math.hypot(x, y, z);
      if (len > 1e-9) return [x / len, y / len, z / len];
    }
  }
  return [0, 1, 0]; // +Y fallback mirrors the neutron-star sanitizer
}

function sanitizeJet(raw: unknown): JetConfig {
  const jet = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    enabled: jet['enabled'] === true,
    halfOpeningAngleDeg: sanitizeNumber(jet['halfOpeningAngleDeg'], HALF_OPENING_DEG_RANGE, 10),
    velocityProxyC: sanitizeNumber(jet['velocityProxyC'], VELOCITY_PROXY_C_RANGE, 0.5),
    viewingAngleDeg: sanitizeNumber(jet['viewingAngleDeg'], VIEWING_DEG_RANGE, 90)
  };
}

/**
 * The ONE normalizer every public value flows through
 * (STATE_AND_ROUTES section 6 discipline, mirroring the neutron-star
 * destination): finite guards, enum whitelist, documented clamps,
 * axis re-normalization. Invalid input collapses to documented defaults —
 * never throws, never silently invents unbounded values.
 */
export function normalizeStellarExplosionState(
  raw: Record<string, unknown>
): StellarExplosionPublicState {
  const scenarioId = SCENARIO_IDS.includes(raw['scenarioId'] as ExplosionScenarioId)
    ? (raw['scenarioId'] as ExplosionScenarioId)
    : 'core-collapse';
  return {
    scenarioId,
    progenitorRadiusSolar: sanitizeNumber(raw['progenitorRadiusSolar'], RADIUS_SOLAR_RANGE, 500),
    progenitorTemperatureK: sanitizeNumber(
      raw['progenitorTemperatureK'],
      TEMPERATURE_K_RANGE,
      3800
    ),
    energyProxyFoe: sanitizeNumber(raw['energyProxyFoe'], ENERGY_FOE_RANGE, 1),
    ejectaMassProxySolar: sanitizeNumber(raw['ejectaMassProxySolar'], MASS_SOLAR_RANGE, 8),
    expansionVelocityScaleKmS: sanitizeNumber(
      raw['expansionVelocityScaleKmS'],
      VELOCITY_KM_S_RANGE,
      11000
    ),
    anisotropyStrength: sanitizeNumber(raw['anisotropyStrength'], UNIT_INTERVAL, 0.3),
    anisotropyAxis: sanitizeUnitVector(raw['anisotropyAxis']),
    lobeWeighting: sanitizeNumber(raw['lobeWeighting'], UNIT_INTERVAL, 0.3),
    clumpingLevel: sanitizeNumber(raw['clumpingLevel'], UNIT_INTERVAL, 0.5),
    clumpingSeed:
      typeof raw['clumpingSeed'] === 'number' && Number.isFinite(raw['clumpingSeed'])
        ? Math.max(1, Math.floor(raw['clumpingSeed']))
        : 41,
    jet: sanitizeJet(raw['jet']),
    timeSeconds: sanitizeNumber(raw['timeSeconds'], { min: 0, max: TIME_SECONDS_MAX }, 0)
  };
}
