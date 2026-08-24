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

import { createTidalDisruptionModule as createRenderingModule } from './tidalDisruptionModule.js';

import type {
  PhenomenonDescriptor,
  PhenomenonModule,
  PresetDescriptor
} from '../../atlas/types.js';
import type {
  PenetrationScenarioId,
  StellarPresetId,
  TidalDisruptionPublicState
} from './types.js';

const DESTINATION_ID = 'tidal-disruption';

/** Cross-import factory (call-time access, mirrors the SN co-location rule). */
export function createTidalDisruptionModule(): PhenomenonModule {
  return createRenderingModule();
}

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
  load: async () => createTidalDisruptionModule
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
  'GR apsidal precession, no radiative transfer.';

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
  // polar 62deg (matches observerInclinationDeg), azimuth 35, d=520 units:
  // dir = (0.507, 0.469, 0.723)
  camera: { position: [264, 244, 376], target: [0, 0, 0], fovDeg: 55 },
  seed: 211,
  timelineInitialPhase: 0
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
  // polar 55deg, azimuth -40, d=300 units (frames the tighter geometry):
  // dir = (-0.464, 0.574, 0.553)
  camera: { position: [-139, 172, 166], target: [0, 0, 0], fovDeg: 55 },
  seed: 223,
  timelineInitialPhase: 0
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
  // polar 70deg, azimuth 150, d=430 units: dir = (0.457, 0.342, -0.791)
  camera: { position: [197, 147, -340], target: [0, 0, 0], fovDeg: 55 },
  seed: 227,
  timelineInitialPhase: 0
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
  // polar 48deg, azimuth 20, d=1150 units (frames rt=215):
  // dir = (0.271, 0.669, 0.693)
  camera: { position: [311, 769, 797], target: [0, 0, 0], fovDeg: 55 },
  seed: 229,
  timelineInitialPhase: 0
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
  // polar 66deg, azimuth -15, d=1650 units (frames rt=378):
  // dir = (-0.251, 0.407, 0.879)
  camera: { position: [-414, 671, 1451], target: [0, 0, 0], fovDeg: 55 },
  seed: 233,
  timelineInitialPhase: 0
};

/** All tidal-disruption presets, default first. */
export const TIDAL_DISRUPTION_PRESETS: PresetDescriptor[] = [
  SOLAR_CANONICAL_PRESET,
  DEEP_PENETRATION_PRESET,
  GRAZING_FLYBY_PRESET,
  MASSIVE_BLACK_HOLE_PRESET,
  GIANT_STAR_PRESET
];
