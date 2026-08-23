/**
 * Compact Merger public state schema and resolved-scenario types (CA5-01).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 4 (Compact Merger:
 *   NS-NS inspiral -> contact -> short GRB -> kilonova -> remnant; mixed
 *   fidelity; avoid exposing unvalidated continuous parameters);
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md section "Compact
 *   Merger" (scenario/model/timeline control vocabulary; NS-BH is FUTURE and
 *   deliberately NOT a preset here);
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md (every approximation disclosed);
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md section 6 (one normalizer,
 *   clamp-don't-reject, finite guards).
 *
 * FIDELITY CLASS (destination): PROCEDURAL_SCIENTIFIC with a DIRECT reduced
 * inspiral model. The inspiral is the validated quadrupole-order
 * gravitational-wave decay law in CLOSED FORM (deterministic, scrubbable);
 * everything after contact is a disclosed reduced/procedural model. This is
 * NOT numerical relativity, NOT hydrodynamics/GRMHD, NOT radiative transfer.
 *
 * SCENE SCALE: 1 scene unit = {@link SCENE_UNIT_KM} kilometres (single
 * conversion point, mirroring the stellar-explosion discipline). Neutron
 * stars default to R = 12 km -> 1.2 units; the canonical inspiral starts at
 * a = 120 km -> 12 units, giving a physical contact time of order one
 * second for canonical masses (the real quadrupole timescale, not an
 * invented one).
 */

import type { QualityTier } from '../../atlas/types.js';
import { inspiralContactSeconds } from './inspiral.js';

// ---------------------------------------------------------------------------
// Scenario taxonomy (PHENOMENA_IMPLEMENTATION section 4)
// ---------------------------------------------------------------------------

/** Mass scenario. NS-BH is intentionally ABSENT (no supported model yet). */
export type MassScenarioId = 'equal-mass' | 'unequal-mass';

/** Two-component ejecta morphology preset (dynamical vs wind components). */
export type EjectaScenarioId = 'two-component' | 'polar-enhanced' | 'equatorial-tidal';

/**
 * Remnant outcome. SCENARIO-based selection (DESTINATION_CONTROL_CATALOG:
 * avoid continuous freeform remnant selection — no predictive mapping is
 * implemented or claimed).
 */
export type RemnantScenarioId = 'massive-ns' | 'prompt-bh' | 'delayed-collapse';

/** Jet configuration scenario (short-GRB central engine). */
export type JetScenarioId = 'none' | 'thin' | 'wide';

/** Timeline phases in presentation order (mission section 8). */
export type MergerPhase = 'inspiral' | 'contact' | 'merger' | 'jet' | 'kilonova' | 'afterglow';

export const MERGER_PHASE_ORDER: readonly MergerPhase[] = [
  'inspiral',
  'contact',
  'merger',
  'jet',
  'kilonova',
  'afterglow'
];

// ---------------------------------------------------------------------------
// Public state schema (validated by normalizeCompactMergerState)
// ---------------------------------------------------------------------------

/**
 * Validated, unit-explicit public state. Every field passes through exactly
 * one normalizer; renderer modules never consume raw preset records.
 */
export interface CompactMergerPublicState {
  massScenario: MassScenarioId;
  /** Primary neutron-star gravitational mass, solar masses. */
  mass1Solar: number;
  /** Secondary neutron-star gravitational mass, solar masses. */
  mass2Solar: number;
  /** Neutron-star radius (shared), km. Bounded to observed NS ranges. */
  radiusKm: number;
  /** Initial orbital separation, km (the presented inspiral window). */
  initialSeparationKm: number;
  ejectaScenario: EjectaScenarioId;
  remnantScenario: RemnantScenarioId;
  jetScenario: JetScenarioId;
  /**
   * Observer viewing angle from the ORBITAL POLAR AXIS (+Y), degrees.
   * 0 = face-down onto the orbital plane pole (on-axis jet), 90 = edge-on
   * (in the orbital plane). Drives camera-independent model response.
   */
  viewingAngleDeg: number;
  /** Deterministic seed for procedural morphology. Positive integer. */
  seed: number;
  /** Deterministic timeline offset, seconds since inspiral-window start. */
  timeSeconds: number;
}

// ---------------------------------------------------------------------------
// Resolved scenario (derived constants consumed by renderers)
// ---------------------------------------------------------------------------

/** Kilometres per scene unit. Single conversion point for this destination. */
export const SCENE_UNIT_KM = 10;

/** SI constants used by the reduced model (CODATA/IAU nominal values). */
export const G_SI = 6.6743e-11;
export const C_SI = 2.99792458e8;
export const SOLAR_MASS_KG = 1.98892e30;

/** Canonical NS surface temperature proxies (kelvin), presentation-level. */
export const REMNANT_TEMPERATURE_K = 1.2e9;
export const NS_SURFACE_TEMPERATURE_K = 6e5;

/**
 * Fully derived, sanitized scenario used by every subsystem. Constructed
 * once by {@link resolveCompactMergerScenario}; treat as immutable.
 */
export interface ResolvedMergerScenario {
  readonly massScenario: MassScenarioId;
  readonly ejectaScenario: EjectaScenarioId;
  readonly remnantScenario: RemnantScenarioId;
  readonly jetScenario: JetScenarioId;
  readonly seed: number;

  /** Component masses, kg and solar masses. */
  readonly m1Solar: number;
  readonly m2Solar: number;
  readonly m1Kg: number;
  readonly m2Kg: number;
  readonly totalKg: number;

  /** Component and contact radii, scene units. */
  readonly r1Units: number;
  readonly r2Units: number;
  readonly contactSeparationUnits: number;

  /** Initial separation, scene units. */
  readonly a0Units: number;

  /**
   * Quadrupole inspiral decay constant K = (64/5) G^3 m1 m2 M / c^5 in
   * unit^4/s (see inspiral.ts for the closed-form law it drives).
   */
  readonly decayKUnits4S: number;
  /** Kepler parameter sqrt(G M) in unit^1.5/s (orbital frequency law). */
  readonly keplerSqrtMu: number;
  /** Deterministic physical contact time, seconds (inspiral-window start). */
  readonly contactSeconds: number;

  /** Ejecta velocity proxy, fraction of c (two-component model). */
  readonly ejectaVelocityC: number;
  /** Jet half-opening angle, radians (thin/wide scenario presets). */
  readonly jetHalfOpeningRad: number;
  /** Jet front speed proxy, fraction of c. */
  readonly jetVelocityC: number;
  /** Jet engine ignition delay after contact, seconds (illustrative). */
  readonly jetDelaySeconds: number;
  /** Delayed-collapse remnant switch time after contact (scenario only). */
  readonly delayedCollapseSeconds: number;
}

// ---------------------------------------------------------------------------
// Normalization (STATE_AND_ROUTES section 6: one normalizer, clamp-don't-reject)
// ---------------------------------------------------------------------------

const MASS_SCENARIOS: readonly MassScenarioId[] = ['equal-mass', 'unequal-mass'];
const EJECTA_SCENARIOS: readonly EjectaScenarioId[] = [
  'two-component',
  'polar-enhanced',
  'equatorial-tidal'
];
const REMNANT_SCENARIOS: readonly RemnantScenarioId[] = [
  'massive-ns',
  'prompt-bh',
  'delayed-collapse'
];
const JET_SCENARIOS: readonly JetScenarioId[] = ['none', 'thin', 'wide'];

/** Sanitizer bounds (documented control ranges; DESTINATION_CONTROL_CATALOG). */
const MASS_SOLAR_RANGE = { min: 0.8, max: 2.5 } as const;
const RADIUS_KM_RANGE = { min: 9, max: 15 } as const;
const SEPARATION_KM_RANGE = { min: 40, max: 400 } as const;
const VIEWING_DEG_RANGE = { min: 0, max: 90 } as const;

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
 * values. Mass scenarios FORCE the documented canonical pair when the
 * scenario id says so (scenario presets stay scenario-true).
 */
export function normalizeCompactMergerState(
  raw: Record<string, unknown>
): CompactMergerPublicState {
  const massScenario = enumOr(raw['massScenario'], MASS_SCENARIOS, 'equal-mass');
  const canonical = massScenario === 'equal-mass' ? { m1: 1.4, m2: 1.4 } : { m1: 1.6, m2: 1.2 };
  return {
    massScenario,
    mass1Solar: sanitizeNumber(raw['mass1Solar'], MASS_SOLAR_RANGE, canonical.m1),
    mass2Solar: sanitizeNumber(raw['mass2Solar'], MASS_SOLAR_RANGE, canonical.m2),
    radiusKm: sanitizeNumber(raw['radiusKm'], RADIUS_KM_RANGE, 12),
    initialSeparationKm: sanitizeNumber(raw['initialSeparationKm'], SEPARATION_KM_RANGE, 120),
    ejectaScenario: enumOr(raw['ejectaScenario'], EJECTA_SCENARIOS, 'two-component'),
    remnantScenario: enumOr(raw['remnantScenario'], REMNANT_SCENARIOS, 'massive-ns'),
    jetScenario: enumOr(raw['jetScenario'], JET_SCENARIOS, 'none'),
    viewingAngleDeg: sanitizeNumber(raw['viewingAngleDeg'], VIEWING_DEG_RANGE, 75),
    seed:
      typeof raw['seed'] === 'number' && Number.isFinite(raw['seed'])
        ? Math.max(1, Math.floor(raw['seed']))
        : 97,
    timeSeconds: sanitizeNumber(raw['timeSeconds'], { min: 0, max: 1e9 }, 0)
  };
}

// ---------------------------------------------------------------------------
// Scenario resolution (pure physics derivation)
// ---------------------------------------------------------------------------

/**
 * Derive every renderer-facing constant from the normalized state. Pure,
 * deterministic, allocation-light. The inspiral constants come from the
 * quadrupole-order decay law in SI units, converted once into scene units.
 */
export function resolveCompactMergerScenario(
  state: CompactMergerPublicState
): ResolvedMergerScenario {
  const m1Kg = state.mass1Solar * SOLAR_MASS_KG;
  const m2Kg = state.mass2Solar * SOLAR_MASS_KG;
  const totalKg = m1Kg + m2Kg;

  const kmToUnits = 1 / SCENE_UNIT_KM;
  const r1Units = state.radiusKm * kmToUnits;
  const r2Units = state.radiusKm * kmToUnits;
  const contactSeparationUnits = r1Units + r2Units;
  const a0Units = state.initialSeparationKm * kmToUnits;

  // K = (64/5) G^3 m1 m2 M / c^5  [SI m^4/s] -> scene units: 1 m = 1e-4 units
  // so m^4 -> (1e-4)^4 = 1e-16 unit^4.
  const kSi = ((64 / 5) * Math.pow(G_SI, 3) * m1Kg * m2Kg * totalKg) / Math.pow(C_SI, 5);
  const decayKUnits4S = kSi * 1e-16;
  // Kepler: omega = sqrt(G M / a^3) [SI]; sqrt(GM) in m^1.5/s -> unit^1.5/s
  // via (1e-4)^1.5 = 1e-6.
  const keplerSqrtMu = Math.sqrt(G_SI * totalKg) * 1e-6;

  const contactSeconds = inspiralContactSeconds(a0Units, contactSeparationUnits, decayKUnits4S);

  const jetHalfOpeningRad =
    state.jetScenario === 'thin'
      ? (8 * Math.PI) / 180
      : state.jetScenario === 'wide'
        ? (20 * Math.PI) / 180
        : 0;

  return {
    massScenario: state.massScenario,
    ejectaScenario: state.ejectaScenario,
    remnantScenario: state.remnantScenario,
    jetScenario: state.jetScenario,
    seed: state.seed,
    m1Solar: state.mass1Solar,
    m2Solar: state.mass2Solar,
    m1Kg,
    m2Kg,
    totalKg,
    r1Units,
    r2Units,
    contactSeparationUnits,
    a0Units,
    decayKUnits4S,
    keplerSqrtMu,
    contactSeconds,
    // Two-component kilonova proxies (disclosed reduced model):
    ejectaVelocityC: state.ejectaScenario === 'polar-enhanced' ? 0.25 : 0.18,
    jetHalfOpeningRad,
    jetVelocityC: state.jetScenario === 'none' ? 0 : 0.95,
    jetDelaySeconds: 0.5,
    delayedCollapseSeconds: 10
  };
}

// ---------------------------------------------------------------------------
// Quality-tier mapping (single global governor -> destination workload)
// ---------------------------------------------------------------------------

/** Volume march budget per tier (VolumeService scales step length live). */
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

/** Ejecta particle population per tier (documented rationale: kilonova glow). */
export const TIER_PARTICLE_CAPACITY: Record<QualityTier, number> = {
  low: 1500,
  medium: 4000,
  high: 9000,
  ultra: 16000
};

/** Compact-star sphere tessellation per tier (bounded, governor-aware). */
export const TIER_STAR_SEGMENTS: Record<QualityTier, { width: number; height: number }> = {
  low: { width: 36, height: 24 },
  medium: { width: 52, height: 36 },
  high: { width: 72, height: 48 },
  ultra: { width: 96, height: 64 }
};
