/**
 * Tidal Disruption descriptor and production presets (CA6-01).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md section "Tidal
 *   Disruption" (physical/model scenario vocabulary);
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 6;
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md (preset shape, honest fidelity
 *   notes, deterministic seeds).
 *
 * SCENE SCALE: 1 scene unit = 1 solar radius (types.ts), so the star radius
 * is exactly its R_sun value. Camera positions use the shared spherical
 * convention around the black hole (origin) with polar measured from +Y:
 *
 *   dir = (sin(polar)*sin(azimuth), cos(polar), sin(polar)*cos(azimuth))
 *
 * Every preset's `observerInclinationDeg` MATCHES its camera polar so the
 * orientation control and the presented viewpoint stay coherent by
 * construction (the reduced model itself has no viewing-angle physics).
 */

import type { PhenomenonDescriptor, PresetDescriptor } from '../../atlas/types.js';
import type {
  PenetrationScenarioId,
  StellarPresetId,
  TidalDisruptionPublicState
} from './types.js';

const DESTINATION_ID = 'tidal-disruption';

/** GPU memory estimates (MB): volume targets + particle buffers dominate. */
export const TIDAL_DISRUPTION_DESCRIPTOR: PhenomenonDescriptor = {
  id: DESTINATION_ID,
  title: 'Tidal Disruption',
  group: 'catastrophe',
  fidelity: 'PROCEDURAL_SCIENTIFIC',
  route: DESTINATION_ID,
  defaultPreset: 'solar-canonical',
  requiredCapabilities: [],
  estimatedGpuMemoryMB: { low: 18, medium: 40, high: 80, ultra: 160 },
  /**
   * WS3/tasks.md §5: dynamic import, so registry setup fetches only this
   * lightweight preset/metadata module at boot. A static import here would
   * pull the whole render graph into the startup chunk for every boot,
   * including boots that route elsewhere.
   */
  load: async () => (await import('./tidalDisruptionModule.js')).createTidalDisruptionModule
};

// ---------------------------------------------------------------------------
// State records (validated by normalizeTidalDisruptionState at runtime)
// ---------------------------------------------------------------------------

function stateOf(
  blackHoleMassSolar: number,
  stellarPreset: StellarPresetId,
  penetrationScenario: PenetrationScenarioId,
  observerInclinationDeg: number,
  seed: number
): TidalDisruptionPublicState {
  return {
    blackHoleMassSolar,
    stellarPreset,
    penetrationScenario,
    observerInclinationDeg,
    seed,
    timeSeconds: 0
  };
}

const SOLAR_CANONICAL_STATE = stateOf(1e6, 'solar-type', 'canonical', 62, 211);
const DEEP_PENETRATION_STATE = stateOf(1e6, 'solar-type', 'deep', 55, 223);
const GRAZING_FLYBY_STATE = stateOf(1e6, 'solar-type', 'grazing', 70, 227);
const MASSIVE_BH_STATE = stateOf(1e7, 'solar-type', 'canonical', 48, 229);
const GIANT_STAR_STATE = stateOf(3e6, 'evolved-subgiant', 'canonical', 66, 233);

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const FIDELITY_BASE =
  'PROCEDURAL_SCIENTIFIC driven by validated orbital/tidal parameters: ' +
  'closed-form parabolic Kepler encounter (Barker timing), tidal-tensor ' +
  'deformation proxy, energy-spread debris family on Newtonian Kepler ' +
  'orbits. Not hydrodynamics/SPH, not GRMHD, not numerical relativity, no ' +
  'GR apsidal precession, no radiative transfer. Display note: the stellar ' +
  'disc is rendered at an exaggerated radius for visibility; every model ' +
  'quantity uses the true radius.';

const SOLAR_CANONICAL_PRESET: PresetDescriptor = {
  id: 'solar-canonical',
  displayName: 'Solar Star — Canonical Disruption',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    FIDELITY_BASE +
    ' Sun-like star around a 10^6 M_sun black hole at beta=1 (periapsis at ' +
    'the tidal radius): full disruption, ~116 day first fallback.',
  state: { ...SOLAR_CANONICAL_STATE },
  // Arrival centers the BOOT-PHASE star (all presets boot at Barker D=-1.088:
  // star at azimuth -4.8 deg, r=2.184 q) with the black hole ~9.5 deg
  // off-axis above it — subject-centered and stable across presets.
  camera: { position: [-29.3, 28.2, 346.6], target: [-18.4, 0, 217.6], fovDeg: 55 },
  seed: 211,
  // secondsToUiPhase(-1.517 * barkerCoef) — boots at Barker D=-1.088.
  timelineInitialPhase: 0.160087
};

const DEEP_PENETRATION_PRESET: PresetDescriptor = {
  id: 'deep-penetration',
  displayName: 'Deep Penetration (beta 2.5)',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    FIDELITY_BASE +
    ' Same star/black hole as solar-canonical but beta=2.5: periapsis well ' +
    'inside the tidal radius, 6.25x wider energy spread -> faster fallback, ' +
    'more compact and rapidly winding debris.',
  state: { ...DEEP_PENETRATION_STATE },
  // Same star-centered discipline at polar 55 (observer-coherent), q=40.
  camera: { position: [-14.1, 34.4, 166.5], target: [-7.4, 0, 87], fovDeg: 55 },
  seed: 223,
  // Boots at the shared Barker D=-1.088 for this encounter's coefficients.
  timelineInitialPhase: 0.250088
};

const GRAZING_FLYBY_PRESET: PresetDescriptor = {
  id: 'grazing-flyby',
  displayName: 'Grazing Encounter (beta 0.85)',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    FIDELITY_BASE +
    ' beta=0.85 stays below the full-disruption threshold: partial envelope ' +
    'stripping only, the star survives and recedes. Debris/shock/disk phases ' +
    'intentionally present nothing — the reduced model produces no full ' +
    'disruption for this scenario.',
  state: { ...GRAZING_FLYBY_STATE },
  // Same star-centered discipline at polar 70 (observer-coherent), q=117.7.
  camera: { position: [-34.1, 20.5, 401.8], target: [-21.7, 0, 256], fovDeg: 55 },
  seed: 227,
  // Boots at the shared Barker D=-1.088 for this encounter's coefficients.
  timelineInitialPhase: 0.136741
};

const MASSIVE_BLACK_HOLE_PRESET: PresetDescriptor = {
  id: 'massive-black-hole',
  displayName: 'Massive Black Hole (10^7 M_sun)',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    FIDELITY_BASE +
    ' Ten-times-larger black hole at beta=1: tidal radius scales as ' +
    'M^(1/3), the horizon as M — the encounter moves relatively deeper into ' +
    'the strong-field zone while every length/time scale grows.',
  state: { ...MASSIVE_BH_STATE },
  // rt=215 stretches the corridor: same star-centered discipline, q=215.4.
  camera: { position: [-57.4, 40.1, 677.1], target: [-39.7, 0, 468.7], fovDeg: 55 },
  seed: 229,
  timelineInitialPhase: 0.160087
};

const GIANT_STAR_PRESET: PresetDescriptor = {
  id: 'giant-star',
  displayName: 'Evolved Subgiant Star',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    FIDELITY_BASE +
    ' A 1.5 M_sun / 3 R_sun evolved subgiant around a 3x10^6 M_sun black ' +
    'hole at beta=1: tripled stellar radius stretches the tidal radius and ' +
    'lengthens the fallback chain relative to the canonical event.',
  state: { ...GIANT_STAR_STATE },
  // rt=378: same star-centered discipline, q=378.
  camera: { position: [-98.6, 24.4, 1164.7], target: [-69.6, 0, 822.3], fovDeg: 55 },
  seed: 233,
  timelineInitialPhase: 0.160087
};

/** All tidal-disruption presets, default first. */
export const TIDAL_DISRUPTION_PRESETS: PresetDescriptor[] = [
  SOLAR_CANONICAL_PRESET,
  DEEP_PENETRATION_PRESET,
  GRAZING_FLYBY_PRESET,
  MASSIVE_BLACK_HOLE_PRESET,
  GIANT_STAR_PRESET
];
