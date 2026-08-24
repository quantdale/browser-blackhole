/**
 * Tidal Disruption Event public state schema and resolved-encounter types
 * (CA6-01).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 6 (TDE: reduced/
 *   procedural star-debris model; renderer reuse; phase-dependent activation;
 *   avoid unvalidated continuous controls);
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md section "Tidal
 *   Disruption" (physical/model: BH mass, stellar type preset, penetration
 *   scenario, observer orientation);
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md sections 2/4/10 (no fake
 *   precision, TDE policy, disclosed approximations);
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md section 6 (one normalizer,
 *   clamp-don't-reject, finite guards).
 *
 * FIDELITY CLASS (destination): PROCEDURAL_SCIENTIFIC driven by validated
 * orbital/tidal parameters. The encounter trajectory is a DIRECT reduced
 * Newtonian model (parabolic Kepler orbit in closed form via Barker's
 * equation); deformation/disruption/debris are disclosed reduced proxies.
 * This is NOT hydrodynamics, NOT SPH, NOT GRMHD, NOT numerical relativity,
 * NOT predictive radiative transfer. The stream winding is differential
 * Kepler motion of an energy-spread debris family (Newtonian); apsidal
 * GR precession is deliberately NOT modeled.
 *
 * SCENE SCALE: 1 scene unit = {@link SCENE_UNIT_SOLAR_RADII} solar radii.
 * A sun-like star therefore has radius exactly 1.0 units at every preset;
 * the tidal radius r_t = R_* (M_BH/M_*)^(1/3) lands in the tens-to-hundreds
 * range while the horizon 2 r_g stays far inside the encounter for every
 * supported black-hole mass (the Hills limit for a sun-like star is
 * ~1.1e8 M_sun; the normalizer caps M_BH at 5e7, ~2x below it).
 *
 * PHYSICAL CONSTANTS: CODATA/IAU nominal values, same discipline as
 * compact-merger/types.ts. All conversions happen once, here.
 */

import type { QualityTier } from '../../atlas/types.js';

// ---------------------------------------------------------------------------
// Scenario taxonomy (DESTINATION_CONTROL_CATALOG "Tidal Disruption")
// ---------------------------------------------------------------------------

/**
 * Stellar archetype preset. SCENARIO-based (no freeform mass/radius sliders —
 * the reduced model has no validated continuous stellar-structure mapping).
 * Each entry forces its canonical (mass, radius) pair like compact-merger
 * mass scenarios do.
 */
export type StellarPresetId = 'solar-type' | 'low-mass-k' | 'evolved-subgiant';

/**
 * Encounter penetration scenario, mapped onto the dimensionless penetration
 * factor beta = r_t / r_p:
 * - `grazing`  beta = 0.85 -> partial stripping regime (star survives);
 * - `canonical` beta = 1.0 -> full disruption threshold encounter;
 * - `deep`     beta = 2.5  -> strong penetration, fast fallback/winding.
 */
export type PenetrationScenarioId = 'grazing' | 'canonical' | 'deep';

/** Penetration factor per scenario (centralized convention, see above). */
export const PENETRATION_BETA: Record<PenetrationScenarioId, number> = {
  grazing: 0.85,
  canonical: 1.0,
  deep: 2.5
};

/** Canonical (mass [M_sun], radius [R_sun]) per stellar archetype. */
export const STELLAR_PRESET_MASS_RADIUS: Record<
  StellarPresetId,
  { mSolar: number; rSolar: number }
> = {
  'solar-type': { mSolar: 1.0, rSolar: 1.0 },
  'low-mass-k': { mSolar: 0.7, rSolar: 0.7 },
  'evolved-subgiant': { mSolar: 1.5, rSolar: 3.0 }
};

/** Timeline phases in presentation order (mission Wave 3 / CA6-12). */
export type TdePhase =
  'approach' | 'deformation' | 'disruption' | 'debris' | 'winding' | 'shock' | 'nascent-disk';

export const TDE_PHASE_ORDER: readonly TdePhase[] = [
  'approach',
  'deformation',
  'disruption',
  'debris',
  'winding',
  'shock',
  'nascent-disk'
];

// ---------------------------------------------------------------------------
// Public state schema (validated by normalizeTidalDisruptionState)
// ---------------------------------------------------------------------------

/**
 * Validated, unit-explicit public state. Every field passes through exactly
 * one normalizer; renderer modules never consume raw preset records.
 */
export interface TidalDisruptionPublicState {
  /** Black-hole mass, solar masses. Bounded well below the Hills limit. */
  blackHoleMassSolar: number;
  stellarPreset: StellarPresetId;
  penetrationScenario: PenetrationScenarioId;
  /**
   * Observer orientation from the ORBITAL POLAR AXIS (+Y), degrees
   * (0 = pole-on, 90 = edge-on). Drives the presented viewpoint coherently
   * with the preset camera; the reduced model itself has NO viewing-angle-
   * dependent physics (disclosed: this is an orientation control, not a
   * beaming/transfer model).
   */
  observerInclinationDeg: number;
  /** Deterministic seed for procedural morphology. Positive integer. */
  seed: number;
  /**
   * Deterministic timeline offset in seconds relative to PERIAPSIS PASSAGE
   * (negative = approaching, 0 = disruption window, positive = outbound /
   * debris evolution). The whole destination shares this single clock.
   */
  timeSeconds: number;
}

// ---------------------------------------------------------------------------
// Constants and unit conversion (single conversion point)
// ---------------------------------------------------------------------------

/** Solar radii per scene unit. Star radius is exactly 1.0 scene units. */
export const SCENE_UNIT_SOLAR_RADII = 1;

/** Solar radius, metres (IAU nominal). */
export const SOLAR_RADIUS_M = 6.957e8;
/** SI constants (CODATA/IAU nominal), shared discipline with CA5. */
export const G_SI = 6.6743e-11;
export const C_SI = 2.99792458e8;
export const SOLAR_MASS_KG = 1.98892e30;

/** Metres per scene unit (derived; kept explicit for tests). */
export const METRES_PER_SCENE_UNIT = SOLAR_RADIUS_M * SCENE_UNIT_SOLAR_RADII;

// ---------------------------------------------------------------------------
// Disruption criterion thresholds (CA6-04, centralized conventions)
// ---------------------------------------------------------------------------

/**
 * beta >= BETA_FULL_DISRUPTION -> full disruption in the reduced model.
 * Convention: beta = r_t/r_p >= 1 means periapsis at/inside the tidal radius,
 * the classical full-disruption criterion for a parabolic encounter
 * (order-of-magnitude literature consensus; exact value depends on stellar
 * structure — treated as a threshold proxy, not a sharp physical boundary).
 */
export const BETA_FULL_DISRUPTION = 1.0;

/**
 * beta below this value produces no significant mass loss in the reduced
 * model (fly-by). Between PARTIAL and FULL the star survives with partial
 * envelope stripping. Both constants are disclosed reduced-model conventions.
 */
export const BETA_PARTIAL_STRIPPING = 0.75;

/**
 * Presentation stretch cap: maximum fractional elongation of the ellipsoid
 * deformation proxy at any supported state (bounded by contract CA6-03).
 */
export const DEFORMATION_STRETCH_CAP = 2.6;

/** Tidal-deformation gain: stretch = 1 + DEFORMATION_GAIN * min(xi, cap). */
export const DEFORMATION_GAIN = 0.45;

/**
 * Effective-spread fraction applied to the energy-spread estimate in the
 * partial-stripping regime (weakly stripped envelope proxy). Single source
 * of truth lives here; debris.ts consumes it.
 */
export const PARTIAL_SPREAD_FRACTION = 0.35;

/**
 * DISCLOSED PRESENTATION EXAGGERATION (CA6-01): a sun-like star has radius
 * 1 scene unit while the encounter lives at tens-to-hundreds of units, so
 * the TRUE disc would subtend ~1 px. Rendered stellar discs therefore use
 * max(R_*, VISUAL_STAR_MIN_FRACTION_OF_RT * r_t) — a pure DISPLAY choice;
 * every model quantity (deformation, disruption, debris energies, stream
 * orbits) continues to use the true radius. Stated in preset fidelity
 * notes and the destination disclosure.
 */
export const VISUAL_STAR_MIN_FRACTION_OF_RT = 0.12;

// ---------------------------------------------------------------------------
// Resolved scenario (derived constants consumed by renderers)
// ---------------------------------------------------------------------------

/**
 * Fully derived, sanitized encounter used by every subsystem. Constructed
 * once by {@link resolveTidalDisruptionEncounter}; treat as immutable.
 */
export interface ResolvedTdeEncounter {
  readonly blackHoleMassSolar: number;
  readonly stellarPreset: StellarPresetId;
  readonly penetrationScenario: PenetrationScenarioId;
  readonly seed: number;
  readonly observerInclinationDeg: number;

  /** Masses, kg and solar masses. */
  readonly mBhKg: number;
  readonly mStarKg: number;
  readonly mStarSolar: number;

  /** Star radius, scene units (exactly the R_sun value per unit). */
  readonly rStarUnits: number;

  /** Gravitational radius r_g = GM/c² in scene units, plus landmarks. */
  readonly rgUnits: number;
  readonly horizonUnits: number; // 2 r_g
  readonly photonSphereUnits: number; // 3 r_g
  readonly iscoUnits: number; // 6 r_g

  /** Tidal radius r_t = R_* (M_BH/M_*)^(1/3), scene units. */
  readonly rtUnits: number;
  /** Penetration factor beta = r_t / r_p. */
  readonly beta: number;
  /** Periapsis distance r_p = r_t / beta, scene units. */
  readonly rpUnits: number;

  /** Gravitational parameter mu = G (M_BH + M_*), SI m^3/s^2. */
  readonly muSiM3S2: number;
  /** Barker coefficient sqrt(2 q^3/mu) in seconds (q = r_p in metres). */
  readonly barkerSecondsPerD: number;

  /** True when beta reaches the full-disruption threshold. */
  readonly disrupts: boolean;
  /** True when partial (sub-threshold) stripping applies. */
  readonly partialStripping: boolean;
  /** True when the periapsis stays outside the horizon (supported presets always true). */
  readonly outsideHorizon: boolean;
  /** Diagnostic margin log2(rt / horizon): >0 means disruptable. */
  readonly hillsMarginLog2: number;

  /** Effective-spread fraction applied in the partial regime. */
  readonly partialSpreadFraction: number;

  /**
   * Specific-energy spread of the debris family, J/kg:
   * DeltaEps = scale x G M_BH R_* / r_p^2 (standard tidal-tensor order-of-
   * magnitude estimate evaluated AT THE ACTUAL PERIAPSIS; scales as beta^2 by
   * construction — no invented exponent). Full disruption uses scale=1;
   * partial stripping {@link PARTIAL_SPREAD_FRACTION}; fly-by zero.
   */
  readonly energySpreadJPerKg: number;

  /**
   * Fallback/shock reference time, seconds after periapsis: the FIRST
   * PERIAPSIS RETURN of the most-bound debris element (epsilon = -spread/2,
   * a = mu/spread). Elements start AT periapsis moving outbound, so the
   * first return is one full period P = 2 pi sqrt(a^3/mu) later — derived
   * from the model's own bound-orbit family rather than a fitted formula.
   * Zero when no disruption occurs.
   */
  readonly fallbackSeconds: number;
}

// ---------------------------------------------------------------------------
// Normalization (STATE_AND_ROUTES section 6: one normalizer, clamp-don't-reject)
// ---------------------------------------------------------------------------

const STELLAR_PRESETS: readonly StellarPresetId[] = [
  'solar-type',
  'low-mass-k',
  'evolved-subgiant'
];
const PENETRATION_SCENARIOS: readonly PenetrationScenarioId[] = ['grazing', 'canonical', 'deep'];

/**
 * BH mass bounds, solar masses. Upper bound keeps every supported preset
 * safely below the ~1.1e8 M_sun Hills limit for a sun-like star (and far
 * below it for larger stars); lower bound keeps r_t comfortably resolved.
 */
const BLACK_HOLE_MASS_RANGE = { min: 1e5, max: 5e7 } as const;
const INCLINATION_DEG_RANGE = { min: 0, max: 90 } as const;

function sanitizeNumber(
  raw: unknown,
  range: { readonly min: number; readonly max: number },
  fallback: number
): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
  return Math.min(range.max, Math.max(range.min, n));
}

function enumOr<T extends string>(raw: unknown, values: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

/**
 * The ONE normalizer every public value flows through. Invalid input
 * collapses to documented defaults — never throws, never invents unbounded
 * values. Stellar presets force their canonical (mass, radius) pairs so
 * scenario presets stay scenario-true.
 */
export function normalizeTidalDisruptionState(
  raw: Record<string, unknown>
): TidalDisruptionPublicState {
  return {
    blackHoleMassSolar: sanitizeNumber(raw['blackHoleMassSolar'], BLACK_HOLE_MASS_RANGE, 1e6),
    stellarPreset: enumOr(raw['stellarPreset'], STELLAR_PRESETS, 'solar-type'),
    penetrationScenario: enumOr(raw['penetrationScenario'], PENETRATION_SCENARIOS, 'canonical'),
    observerInclinationDeg: sanitizeNumber(
      raw['observerInclinationDeg'],
      INCLINATION_DEG_RANGE,
      62
    ),
    seed:
      typeof raw['seed'] === 'number' && Number.isFinite(raw['seed'])
        ? Math.max(1, Math.floor(raw['seed']))
        : 211,
    timeSeconds: sanitizeNumber(raw['timeSeconds'], { min: -1e12, max: 1e12 }, 0)
  };
}

// ---------------------------------------------------------------------------
// Scenario resolution (pure physics derivation)
// ---------------------------------------------------------------------------

/**
 * Derive every renderer-facing constant from the normalized state. Pure,
 * deterministic, allocation-light. All SI->scene-unit conversion happens
 * here once (metres per scene unit = one solar radius).
 */
export function resolveTidalDisruptionEncounter(
  state: TidalDisruptionPublicState
): ResolvedTdeEncounter {
  const mBhKg = state.blackHoleMassSolar * SOLAR_MASS_KG;
  const stellar = STELLAR_PRESET_MASS_RADIUS[state.stellarPreset];
  const mStarKg = stellar.mSolar * SOLAR_MASS_KG;
  const rStarUnits = stellar.rSolar * SCENE_UNIT_SOLAR_RADII;
  const u = METRES_PER_SCENE_UNIT;

  const rgUnits = (G_SI * mBhKg) / (C_SI * C_SI) / u;
  const rtUnits = rStarUnits * Math.pow(state.blackHoleMassSolar / stellar.mSolar, 1 / 3);

  const beta = PENETRATION_BETA[state.penetrationScenario];
  const rpUnits = rtUnits / beta;

  const muSiM3S2 = G_SI * (mBhKg + mStarKg);
  // Barker's coefficient: t(D) = sqrt(2 q^3 / mu) * (D + D^3/3), q in metres.
  const qMetres = rpUnits * u;
  const barkerSecondsPerD = Math.sqrt((2 * qMetres * qMetres * qMetres) / muSiM3S2);

  const disrupts = beta >= BETA_FULL_DISRUPTION;
  const partialStripping = !disrupts && beta >= BETA_PARTIAL_STRIPPING;
  const horizonUnits = 2 * rgUnits;
  const outsideHorizon = rpUnits > horizonUnits;
  const hillsMarginLog2 = Math.log2(Math.max(rtUnits, 1e-9) / Math.max(horizonUnits, 1e-9));

  // Debris energy spread (tidal-tensor estimate at the actual periapsis).
  // Full disruption uses the full estimate; partial stripping keeps only a
  // disclosed fraction (weakly stripped envelope); fly-by produces none.
  const spreadScale = disrupts ? 1 : beta >= BETA_PARTIAL_STRIPPING ? PARTIAL_SPREAD_FRACTION : 0;
  const energySpreadJPerKg =
    spreadScale * ((G_SI * mBhKg * (rStarUnits * u)) / (qMetres * qMetres));

  // Fallback reference: first periapsis RETURN of the most-bound element
  // (elements start at periapsis outbound => one full period).
  let fallbackSeconds = 0;
  if (energySpreadJPerKg > 0) {
    const aMostBound = muSiM3S2 / energySpreadJPerKg;
    fallbackSeconds = 2 * Math.PI * Math.sqrt((aMostBound * aMostBound * aMostBound) / muSiM3S2);
  }

  return {
    blackHoleMassSolar: state.blackHoleMassSolar,
    stellarPreset: state.stellarPreset,
    penetrationScenario: state.penetrationScenario,
    seed: state.seed,
    observerInclinationDeg: state.observerInclinationDeg,
    mBhKg,
    mStarKg,
    mStarSolar: stellar.mSolar,
    rStarUnits,
    rgUnits,
    horizonUnits,
    photonSphereUnits: 3 * rgUnits,
    iscoUnits: 6 * rgUnits,
    rtUnits,
    beta,
    rpUnits,
    muSiM3S2,
    barkerSecondsPerD,
    disrupts,
    partialStripping,
    outsideHorizon,
    hillsMarginLog2,
    energySpreadJPerKg,
    partialSpreadFraction: PARTIAL_SPREAD_FRACTION,
    fallbackSeconds
  };
}

/**
 * Rendered stellar-disc radius (scene units): the disclosed display
 * exaggeration above. Model code must never consume this.
 */
export function visualStarRadius(encounter: ResolvedTdeEncounter): number {
  return Math.max(encounter.rStarUnits, VISUAL_STAR_MIN_FRACTION_OF_RT * encounter.rtUnits);
}

// ---------------------------------------------------------------------------
// Quality-tier mapping (single global governor -> destination workload)
// ---------------------------------------------------------------------------

/** Shock-volume march budget per tier (VolumeService scales steps live). */
export const TIER_VOLUME_STEPS: Record<QualityTier, number> = {
  low: 40,
  medium: 72,
  high: 110,
  ultra: 150
};

/** Live step-length multiplier per tier (>1 = finer sampling). */
export const TIER_STEP_SCALE: Record<QualityTier, number> = {
  low: 0.75,
  medium: 1,
  high: 1.3,
  ultra: 1.7
};

/** Debris accent-particle population per tier (documented rationale: gas glow). */
export const TIER_PARTICLE_CAPACITY: Record<QualityTier, number> = {
  low: 1600,
  medium: 4200,
  high: 9500,
  ultra: 17000
};

/** Stream-spine sample count per tier (bound/unbound ribbons share it). */
export const TIER_STREAM_SAMPLES: Record<QualityTier, number> = {
  low: 64,
  medium: 96,
  high: 140,
  ultra: 200
};

/** Star sphere tessellation per tier (bounded, governor-aware). */
export const TIER_STAR_SEGMENTS: Record<QualityTier, { width: number; height: number }> = {
  low: { width: 40, height: 26 },
  medium: { width: 56, height: 38 },
  high: { width: 76, height: 50 },
  ultra: { width: 100, height: 66 }
};
