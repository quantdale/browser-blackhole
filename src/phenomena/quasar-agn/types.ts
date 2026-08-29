/**
 * Quasar / AGN destination — public state schema, normalization, scale-zone
 * machine, and unit-conversion layer (CA7-01/CA7-02).
 *
 * Spec sources (implemented exactly; do not drift without updating docs):
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md §7 (Quasar/AGN: mixed
 *   fidelity — DIRECT central GR reuse + PROCEDURAL_SCIENTIFIC large-scale
 *   morphology; INNER/NUCLEAR/GALACTIC scale zones with hysteresis; blazar =
 *   observer ORIENTATION, not a different object);
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md §12 (central GR direct;
 *   jet/corona/torus/host initially illustrative/procedural; blazar mode is
 *   orientation-driven);
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md §Quasar/AGN (scenario
 *   presets, SMBH mass, observer angle to jet, scale jump Inner/Nuclear/
 *   Galactic, torus/host visibility, jet tracer density);
 * - docs/cosmic-atlas/WORK_PACKETS.md CA7-01..CA7-15.
 *
 * Scale/unit architecture (CA7-01):
 *
 * The three zones cannot share one linear scene (r_g : kpc ~ 1 : 2e11 for a
 * 1e8 M_sun hole), so EACH ZONE IS A SELF-CONTAINED DIORAMA at its own
 * documented scene scale, centered on the origin, with EXACTLY ONE zone
 * group visible at a time (CA7-12 double-render guard):
 *
 *   INNER    1 scene unit = 1 r_g      (BH + relativistic disk + corona)
 *   NUCLEAR  1 scene unit = 1e3 r_g   (outer disk + dusty torus + jet base)
 *   GALACTIC 1 scene unit = 1e7 r_g   (extended jet + host galaxy)
 *
 * All content dimensions below are specified IN r_g (mass-independent
 * normalized geometry, matching docs/PHYSICS.md §10 scale-invariance); the
 * per-zone multiplier converts them to scene units. `blackHoleMassSolar`
 * therefore changes the PHYSICAL READOUTS (AU/pc/kpc labels and derived
 * luminosity-scale notes) but never the normalized scene layout — the same
 * philosophy as the black-hole destination's normalized mode.
 *
 * Fidelity disclosures carried here and surfaced by the module:
 * - central BH + relativistic disk: DIRECT (validated LensingService pass);
 * - corona/torus/jet/host: PROCEDURAL_SCIENTIFIC illustrative morphology,
 *   dimensioned by order-of-magnitude literature values, NOT simulations;
 * - blazar mode: observer orientation toward the jet axis with a disclosed
 *   Doppler-ratio brightness asymmetry approximation — never claimed to be
 *   radiative transfer.
 */

import type { QualityTier } from '../../atlas/types.js';

// ---------------------------------------------------------------------------
// Public state schema (validated by normalizeQuasarAgnState — the ONE authority)
// ---------------------------------------------------------------------------

export type AgnZoneId = 'inner' | 'nuclear' | 'galactic';
export type AgnScenarioId = 'quasar-reference' | 'blazar-view' | 'radio-loud';
export type AgnJetLobeId = 'approaching' | 'receding';

export interface QuasarAgnPublicState {
  /** SMBH mass in solar masses (readouts + physical conversions only). */
  blackHoleMassSolar: number;
  /** Scenario selection (preset-aligned; normalizer clamps unknown values). */
  scenario: AgnScenarioId;
  /** Continuous zoom in [0, 1] driving the hysteresis zone machine. */
  zoom01: number;
  /** Observer angle from the jet axis, degrees [0, 90]. */
  observerAngleToJetDeg: number;
  /** Visual toggles (presentation domain — never alter zone physics). */
  torusVisible: boolean;
  hostVisible: boolean;
  /** Jet tracer/population gain fraction [0, 1]. */
  jetTracerDensity: number;
}

export const DEFAULT_QUASAR_AGN_STATE: Readonly<QuasarAgnPublicState> = {
  blackHoleMassSolar: 1e8,
  scenario: 'quasar-reference',
  zoom01: 0.18,
  observerAngleToJetDeg: 45,
  torusVisible: true,
  hostVisible: true,
  jetTracerDensity: 0.7
};

// ---------------------------------------------------------------------------
// Normalization (STATE_AND_ROUTES section 6: one normalizer, clamp-don't-reject)
// ---------------------------------------------------------------------------

const MASS_RANGE = { min: 1e6, max: 1e10 } as const;
const ANGLE_RANGE = { min: 0, max: 90 } as const;

const SCENARIOS: readonly AgnScenarioId[] = ['quasar-reference', 'blazar-view', 'radio-loud'];

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

function boolOr(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

/**
 * The ONE normalizer every public value flows through. Invalid input
 * collapses to documented defaults — never throws, never invents unbounded
 * values.
 */
export function normalizeQuasarAgnState(raw: unknown): QuasarAgnPublicState {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    blackHoleMassSolar: sanitizeNumber(
      source['blackHoleMassSolar'],
      MASS_RANGE,
      DEFAULT_QUASAR_AGN_STATE.blackHoleMassSolar
    ),
    scenario: enumOr(source['scenario'], SCENARIOS, DEFAULT_QUASAR_AGN_STATE.scenario),
    zoom01: sanitizeNumber(source['zoom01'], { min: 0, max: 1 }, DEFAULT_QUASAR_AGN_STATE.zoom01),
    observerAngleToJetDeg: sanitizeNumber(
      source['observerAngleToJetDeg'],
      ANGLE_RANGE,
      DEFAULT_QUASAR_AGN_STATE.observerAngleToJetDeg
    ),
    torusVisible: boolOr(source['torusVisible'], DEFAULT_QUASAR_AGN_STATE.torusVisible),
    hostVisible: boolOr(source['hostVisible'], DEFAULT_QUASAR_AGN_STATE.hostVisible),
    jetTracerDensity: sanitizeNumber(
      source['jetTracerDensity'],
      { min: 0, max: 1 },
      DEFAULT_QUASAR_AGN_STATE.jetTracerDensity
    )
  };
}

// ---------------------------------------------------------------------------
// Scale-zone machine (CA7-02): pure, deterministic, hysteresis-guarded
// ---------------------------------------------------------------------------

/**
 * Zoom-axis zone boundaries. Entering a higher zone happens at `enter`;
 * leaving it back toward lower zones requires dropping to `exit` (< enter),
 * producing a 0.06-wide hysteresis band that prevents flicker at the
 * boundary under noisy input (docs §7 "Transition between zones based on
 * camera distance with hysteresis").
 */
export const ZONE_BOUNDS: Readonly<{
  nuclearEnter: number;
  nuclearExit: number;
  galacticEnter: number;
  galacticExit: number;
}> = {
  nuclearEnter: 0.42,
  nuclearExit: 0.36,
  galacticEnter: 0.74,
  galacticExit: 0.68
};

/**
 * Resolve the ACTIVE zone from the continuous zoom input and the CURRENT
 * zone (hysteresis state). Pure; total over [0,1] x all zones; never throws.
 *
 * Rules (evaluated top-down):
 * - from any zone, zoom >= galacticEnter -> 'galactic'
 * - from galactic, zoom <= galacticExit -> 'nuclear' (hysteresis exit), or
 *   directly to 'inner' when a discrete jump crosses the inner exit boundary
 * - from inner/nuclear, zoom >= nuclearEnter -> 'nuclear' unless already past
 *   the galactic rule above
 * - from nuclear, zoom < nuclearExit -> 'inner' (hysteresis exit)
 */
export function resolveAgnZone(zoom01: number, current: AgnZoneId): AgnZoneId {
  if (!(zoom01 >= 0 && zoom01 <= 1)) {
    return current;
  }
  if (zoom01 >= ZONE_BOUNDS.galacticEnter) {
    return 'galactic';
  }
  if (current === 'galactic') {
    if (zoom01 <= ZONE_BOUNDS.nuclearExit) {
      return 'inner';
    }
    if (zoom01 <= ZONE_BOUNDS.galacticExit) {
      return 'nuclear';
    }
    return 'galactic';
  }
  if (zoom01 >= ZONE_BOUNDS.nuclearEnter) {
    return 'nuclear';
  }
  if (current === 'nuclear') {
    if (zoom01 <= ZONE_BOUNDS.nuclearExit) {
      return 'inner';
    }
    return 'nuclear';
  }
  return 'inner';
}

/** Discrete zone-jump targets for the Inner/Nuclear/Galactic UI buttons. */
export const ZONE_JUMP_ZOOM: Readonly<Record<AgnZoneId, number>> = {
  inner: 0.18,
  nuclear: 0.58,
  galactic: 0.88
};

// ---------------------------------------------------------------------------
// Unit conversion layer (CA7-01): r_g-native geometry <-> physical readouts
// ---------------------------------------------------------------------------

/** SI constants needed for readouts (mirrors src/physics/constants.ts style). */
const SOLAR_MASS_KG = 1.98892e30;
const G_SI = 6.6743e-11;
const C_SI = 2.99792458e8;
const PARSEC_M = 3.0856775814913673e16;

/** Per-zone scene-unit multipliers, in r_g per scene unit (locked table). */
export const ZONE_UNIT_RG: Readonly<Record<AgnZoneId, number>> = {
  inner: 1,
  nuclear: 1e3,
  galactic: 1e7
};

/**
 * Physical readout bundle derived purely from the SMBH mass: r_g in metres
 * and the per-zone scene-unit sizes expressed in AU / pc. Pure; allocation-
 * light; used by UI readouts and tests — never by geodesics.
 */
export interface AgnScaleReadout {
  /** Gravitational radius GM/c^2 in metres. */
  rgMetres: number;
  /** r_g in AU (for intuition at the INNER zone). */
  rgAu: number;
  /** One NUCLEAR-zone scene unit in parsecs. */
  nuclearUnitPc: number;
  /** One GALACTIC-zone scene unit in parsecs. */
  galacticUnitPc: number;
  /** 1 kpc expressed in this SMBH's r_g. */
  kpcInRg: number;
}

const AU_M = 1.495978707e11;

export function agnScaleReadout(blackHoleMassSolar: number): AgnScaleReadout {
  const mKg = blackHoleMassSolar * SOLAR_MASS_KG;
  const rgMetres = (G_SI * mKg) / (C_SI * C_SI);
  return {
    rgMetres,
    rgAu: rgMetres / AU_M,
    nuclearUnitPc: (ZONE_UNIT_RG.nuclear * rgMetres) / PARSEC_M,
    galacticUnitPc: (ZONE_UNIT_RG.galactic * rgMetres) / PARSEC_M,
    kpcInRg: (1e3 * PARSEC_M) / rgMetres
  };
}

// ---------------------------------------------------------------------------
// Content geometry (all dimensions IN r_g; converted by ZONE_UNIT_RG)
// ---------------------------------------------------------------------------

/**
 * OUTER DISK (NUCLEAR zone): large-scale thin accretion disk bridging the
 * inner relativistic disk (<= ~50 r_g, rendered by the DIRECT pass in the
 * INNER zone) out to the dust-sublimation radius where the torus begins.
 * Radii follow order-of-magnitude standard AGN model values (Shakura-Sunyaev
 * extension + dust sublimation ~0.1 pc for 1e8 M_sun), NOT a simulation.
 */
export const OUTER_DISK_INNER_RG = 200;
export const OUTER_DISK_OUTER_RG = 8000;

/**
 * DUSTY TORUS (NUCLEAR zone): equatorial oblate spheroid skirt from the
 * dust-sublimation radius outward (order-of-magnitude ~0.05-0.5 pc at
 * 1e8 M_sun => ~1e4-1e5 r_g), height-to-radius ratio ~0.5 (clumpy-torus
 * era IR morphology, disclosed as illustrative).
 */
export const TORUS_INNER_RG = 2e4;
export const TORUS_OUTER_RG = 1e5;
export const TORUS_HEIGHT_RATIO = 0.5;

/**
 * JET (NUCLEAR base + GALACTIC extension): bipolar along +Y/-Y (the spin
 * axis per WORLD_FRAME §1). Base collimation to ~50-500 r_g; extended jets
 * reach several kpc (~2e8-1e9 r_g) in radio-loud systems.
 */
export const JET_BASE_LENGTH_RG = 3000;
export const JET_BASE_HALF_WIDTH_RG = 120;
export const JET_EXTENDED_LENGTH_RG = 6e8;
export const JET_EXTENDED_HALF_WIDTH_RG = 4e6;

/**
 * CORONA (INNER zone): compact hot emission region hugging the BH
 * (order-of-magnitude few-to-tens of r_g), PROCEDURAL_SCIENTIFIC proxy.
 */
export const CORONA_RADIUS_RG = 12;

/**
 * HOST GALAXY (GALACTIC zone): procedural bulge + disk star context.
 * Stellar disk radius expressed directly IN r_g at the conventional
 * 15 kpc / 2.088e8 r_g-per-kpc conversion (mass-independent normalized
 * geometry; physical readouts scale with blackHoleMassSolar).
 */
export const HOST_DISK_RADIUS_KPC = 15;
export const KPC_IN_RG = 2.088e8;
export const HOST_DISK_RADIUS_RG = HOST_DISK_RADIUS_KPC * KPC_IN_RG;

/**
 * Doppler-ratio brightness approximation for the jet lobes (blazar/oriented
 * views): approaching/receding brightness ratio approximated by the
 * relativistic beaming power-law kappa exponent applied to the classic
 * delta^kappa ratio with a FIXED disclosed bulk Lorentz factor. This is an
 * ILLUSTRATIVE orientation-driven visualization (docs §12), not radiative
 * transfer.
 */
export const JET_BULK_LORENTZ_FACTOR = 8;
export const JET_BEAMING_EXPONENT = 3;

/**
 * Approaching/receding lobe brightness ratio for an observer at
 * `observerAngleToJetDeg` from the jet axis:
 *
 *   ratio = ((1 - beta cos i_rec) / (1 - beta cos i_app))^kappa
 *
 * evaluated with the disclosed fixed Gamma (beta from Gamma). Pure; > 1
 * always; approaches the kappa-power of (2 Gamma)^2 at small angles.
 */
export function jetLobeBrightnessRatio(observerAngleToJetDeg: number): number {
  const degRad = Math.PI / 180;
  const i = Math.min(90, Math.max(0, observerAngleToJetDeg)) * degRad;
  const gamma = JET_BULK_LORENTZ_FACTOR;
  const beta = Math.sqrt(1 - 1 / (gamma * gamma));
  const denomApp = 1 - beta * Math.cos(i);
  const denomRec = 1 - beta * Math.cos(Math.PI - i);
  const ratio = Math.pow(denomRec / denomApp, JET_BEAMING_EXPONENT);
  return Math.max(1, ratio);
}

// ---------------------------------------------------------------------------
// Renderer-facing derivation (pure; consumed by the module each frame)
// ---------------------------------------------------------------------------

export interface AgnZoneView {
  zone: AgnZoneId;
  /** Scene-unit multiplier actually applied (ZONE_UNIT_RG[zone]). */
  unitRg: number;
  /** True when the DIRECT lensing pass may render (INNER zone only). */
  grPassActive: boolean;
}

export function resolveZoneView(zone: AgnZoneId): AgnZoneView {
  return {
    zone,
    unitRg: ZONE_UNIT_RG[zone],
    grPassActive: zone === 'inner'
  };
}

/**
 * Per-zone camera framing (CA7-11): orbit DISTANCE ranges in each zone's
 * own scene units, driven by the continuous zoom input. Pure.
 *
 * zoom01 semantics: 0 = tightest view (INNER engine), 1 = widest
 * (GALACTIC context). Within a zone the distance interpolates smoothly
 * (exponential); across boundaries the zone machine switches dioramas.
 */
export function agnCameraDistance(zone: AgnZoneId, zoom01: number): number {
  const z = Math.min(1, Math.max(0, zoom01));
  const lerpExp = (a: number, b: number, t: number): number =>
    a * Math.pow(b / a, Math.min(1, Math.max(0, t)));
  switch (zone) {
    case 'inner':
      return lerpExp(42, 16, z / ZONE_BOUNDS.nuclearEnter);
    case 'nuclear':
      return lerpExp(
        190,
        330,
        (z - ZONE_BOUNDS.nuclearExit) / (ZONE_BOUNDS.galacticExit - ZONE_BOUNDS.nuclearExit)
      );
    case 'galactic':
      return lerpExp(760, 2400, (z - ZONE_BOUNDS.galacticEnter) / (1 - ZONE_BOUNDS.galacticEnter));
  }
}
export function agnPopulationBudget(tier: QualityTier): { hostStars: number; jetKnots: number } {
  switch (tier) {
    case 'low':
      return { hostStars: 2600, jetKnots: 24 };
    case 'medium':
      return { hostStars: 5200, jetKnots: 40 };
    case 'high':
      return { hostStars: 9000, jetKnots: 64 };
    case 'ultra':
      return { hostStars: 14000, jetKnots: 96 };
  }
}
