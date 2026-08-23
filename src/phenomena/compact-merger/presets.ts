/**
 * Compact Merger descriptor and production presets (CA5-01/CA5-11).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md section "Compact
 *   Merger" (scenario list; NS-BH is explicitly FUTURE and is NOT shipped);
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 4;
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md (preset descriptor shape, honest
 *   fidelity notes, deterministic seeds).
 *
 * SCENE SCALE: 1 scene unit = 10 km (types.ts). Camera positions use the
 * shared spherical convention around the origin with polar measured from the
 * +Y orbital-polar/jet axis:
 *
 *   dir = (sin(polar)*sin(azimuth), cos(polar), sin(polar)*cos(azimuth))
 *
 * Every preset's `viewingAngleDeg` MATCHES its camera polar so the observer
 * control and the model's viewing response stay coherent by construction.
 */

import { createCompactMergerModule as createRenderingModule } from './compactMergerModule.js';

import type {
  PhenomenonDescriptor,
  PhenomenonModule,
  PresetDescriptor
} from '../../atlas/types.js';
import type { CompactMergerPublicState } from './types.js';

const DESTINATION_ID = 'compact-merger';

/** Cross-import factory (call-time access, mirrors the SN co-location rule). */
export function createCompactMergerModule(): PhenomenonModule {
  return createRenderingModule();
}

/**
 * GPU memory estimates (MB): volume internal targets + particle buffers
 * dominate. ESTIMATES, not measurements — same disclosure policy as the
 * other destinations.
 */
export const COMPACT_MERGER_DESCRIPTOR: PhenomenonDescriptor = {
  id: DESTINATION_ID,
  title: 'Compact Merger',
  group: 'catastrophe',
  fidelity: 'PROCEDURAL_SCIENTIFIC',
  route: 'compact-merger',
  defaultPreset: 'equal-mass-nsns',
  requiredCapabilities: [],
  estimatedGpuMemoryMB: { low: 20, medium: 44, high: 88, ultra: 176 },
  load: async () => createCompactMergerModule
};

// ---------------------------------------------------------------------------
// State records (validated by normalizeCompactMergerState at runtime)
// ---------------------------------------------------------------------------

const EQUAL_MASS_STATE: CompactMergerPublicState = {
  massScenario: 'equal-mass',
  mass1Solar: 1.4,
  mass2Solar: 1.4,
  radiusKm: 12,
  initialSeparationKm: 120,
  ejectaScenario: 'two-component',
  remnantScenario: 'massive-ns',
  jetScenario: 'none',
  viewingAngleDeg: 75,
  seed: 97,
  timeSeconds: 0
};

const UNEQUAL_MASS_STATE: CompactMergerPublicState = {
  ...EQUAL_MASS_STATE,
  massScenario: 'unequal-mass',
  mass1Solar: 1.6,
  mass2Solar: 1.2,
  ejectaScenario: 'equatorial-tidal',
  remnantScenario: 'delayed-collapse',
  seed: 101,
  viewingAngleDeg: 80
};

const KILONOVA_FOCUS_STATE: CompactMergerPublicState = {
  ...EQUAL_MASS_STATE,
  ejectaScenario: 'two-component',
  remnantScenario: 'prompt-bh',
  viewingAngleDeg: 70,
  seed: 113
};

const GRB_ENGINE_STATE: CompactMergerPublicState = {
  ...EQUAL_MASS_STATE,
  ejectaScenario: 'polar-enhanced',
  remnantScenario: 'prompt-bh',
  jetScenario: 'thin',
  // Coherence contract: the model viewing angle MATCHES the preset camera
  // polar (8 deg from the +Y jet axis) so the response and the framing agree.
  viewingAngleDeg: 8,
  seed: 127
};

const GRB_OFF_AXIS_STATE: CompactMergerPublicState = {
  ...GRB_ENGINE_STATE,
  viewingAngleDeg: 68,
  seed: 131
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const EQUAL_MASS_PRESET: PresetDescriptor = {
  id: 'equal-mass-nsns',
  displayName: 'Equal-Mass NS–NS',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'DIRECT reduced inspiral (quadrupole GW decay law in closed form; Kepler ' +
    'orbit; deterministic contact). Post-contact: PROCEDURAL_SCIENTIFIC ' +
    'reduced models (flash, two-component ejecta, kilonova light curve). ' +
    'Not numerical relativity, not hydrodynamics.',
  state: { ...EQUAL_MASS_STATE },
  // polar 75deg (matches viewingAngleDeg), azimuth 40deg, d=26 units:
  // dir = (0.621, 0.259, 0.740)
  camera: { position: [16.1, 6.7, 19.2], target: [0, 0, 0], fovDeg: 55 },
  seed: 97,
  timelineInitialPhase: 0
};

const UNEQUAL_MASS_PRESET: PresetDescriptor = {
  id: 'unequal-mass-nsns',
  displayName: 'Unequal-Mass NS–NS',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'Same validated inspiral machinery as the equal-mass preset with a ' +
    '1.6/1.2 solar-mass pair: the COM-correct mass fractions shift both ' +
    'orbits, contact comes earlier, and the tidal (equatorial) ejecta ' +
    'scenario is selected. Delayed-collapse remnant scenario.',
  state: { ...UNEQUAL_MASS_STATE },
  // polar 80deg, azimuth -50deg, d=26: dir = (-0.754, 0.174, 0.633)
  camera: { position: [-19.6, 4.5, 16.5], target: [0, 0, 0], fovDeg: 55 },
  seed: 101,
  timelineInitialPhase: 0
};

const KILONOVA_FOCUS_PRESET: PresetDescriptor = {
  id: 'kilonova-focus',
  displayName: 'Kilonova Focus',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'Post-merger view at the kilonova light-curve peak (~0.7 day after ' +
    'contact, presentation-compressed expansion — see the ejecta module ' +
    'disclosure). Two-component ejecta cooling through the disclosed ' +
    'temperature trajectory; prompt-BH remnant with faint accretion glow.',
  state: { ...KILONOVA_FOCUS_STATE },
  // polar 70deg, azimuth 20deg, d=420 units (frames the day-scale shell):
  // dir = (0.321, 0.342, 0.884)
  camera: { position: [135, 144, 371], target: [0, 0, 0], fovDeg: 55 },
  seed: 113,
  // 0.68 of the scrub range lands inside the kilonova segment.
  timelineInitialPhase: 0.68
};

const GRB_ON_AXIS_PRESET: PresetDescriptor = {
  id: 'short-grb-on-axis',
  displayName: 'Short GRB — On Axis',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'Short-GRB scenario: bipolar jet (thin 8° scenario) viewed 4° off the ' +
    'polar axis. Viewing response is the inverse standard-beaming factor ' +
    '(bounded, disclosed) — on-axis saturates. Kinematic front, NOT ' +
    'relativistic MHD.',
  state: { ...GRB_ENGINE_STATE },
  // polar 8deg (near jet axis, matches viewingAngleDeg 8), az 15, d=30 units
  // (frames the ~5-unit jet front readably at engine-ignition+0.8 s):
  // dir = (0.036, 0.990, 0.135)
  camera: { position: [1.1, 29.7, 4.0], target: [0, 0, 0], fovDeg: 55 },
  seed: 127,
  // 0.52 lands inside the jet segment AFTER engine ignition (tau > 0.5 s),
  // where the front is expanding and the viewing response is active.
  timelineInitialPhase: 0.52
};

const GRB_OFF_AXIS_PRESET: PresetDescriptor = {
  id: 'short-grb-off-axis',
  displayName: 'Short GRB — Off Axis',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'IDENTICAL jet engine state to short-grb-on-axis; observer 68° off the ' +
    'polar axis so the on/off-axis difference is purely geometric through ' +
    'the disclosed viewing-response factor. No intrinsic state changes.',
  state: { ...GRB_OFF_AXIS_STATE },
  // polar 68deg, azimuth 30deg, d=30 units: dir = (0.464, 0.375, 0.803)
  camera: { position: [13.9, 11.2, 24.1], target: [0, 0, 0], fovDeg: 55 },
  seed: 131,
  timelineInitialPhase: 0.52
};

/** All compact-merger presets, default first. */
export const COMPACT_MERGER_PRESETS: PresetDescriptor[] = [
  EQUAL_MASS_PRESET,
  UNEQUAL_MASS_PRESET,
  KILONOVA_FOCUS_PRESET,
  GRB_ON_AXIS_PRESET,
  GRB_OFF_AXIS_PRESET
];
