/**
 * Stellar Explosion descriptor and production presets (CA4-01/07).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md section "Stellar
 *   Explosion" (scenario list: core-collapse, stripped-envelope-like,
 *   hypernova, long-GRB/jetted collapse; hypernova alters MODEL state, not
 *   only brightness);
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 3 (taxonomy:
 *   hypernova and Long GRB are presets WITHIN this destination);
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md (preset descriptor shape, honest
 *   fidelity notes, deterministic seeds).
 *
 * SCENE SCALE: 1 scene unit = 1e7 km (types.ts SCENE_UNIT_KM). Camera
 * positions below are computed from spherical coordinates around the origin
 * exactly like the neutron-star presets (polar measured from the +Y spin /
 * jet axis):
 *
 *   dir = (sin(polar)*sin(azimuth), cos(polar), sin(polar)*cos(azimuth))
 *   position = distance * dir, target = origin
 *
 * Physical parameter values are ILLUSTRATIVE-but-plausible canonical values
 * within observed population ranges; none are measurements of a specific
 * event. Every preset discloses its PROCEDURAL_SCIENTIFIC reduced model in
 * `fidelityNote` — the destination claims no hydrodynamics.
 */

import type { PhenomenonDescriptor, PresetDescriptor } from '../../atlas/types.js';
import type { StellarExplosionPublicState } from './types.js';

/** Shared destination id. */
const DESTINATION_ID = 'stellar-explosion';

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

/**
 * GPU memory estimates (MB): half-res volume internal targets + particle
 * buffers dominate; tier scaling follows VolumeService/ParticleService byte
 * models. ESTIMATES, not measurements — same disclosure policy as the
 * black-hole descriptor.
 */
export const STELLAR_EXPLOSION_DESCRIPTOR: PhenomenonDescriptor = {
  id: DESTINATION_ID,
  title: 'Stellar Explosion',
  group: 'catastrophe',
  fidelity: 'PROCEDURAL_SCIENTIFIC',
  route: 'stellar-explosion',
  defaultPreset: 'core-collapse',
  requiredCapabilities: [],
  estimatedGpuMemoryMB: { low: 24, medium: 48, high: 96, ultra: 192 },
  /**
   * WS3/tasks.md §5: dynamic import, so registry setup fetches only this
   * lightweight preset/metadata module at boot. A static import here would
   * pull the whole render graph into the startup chunk for every boot,
   * including boots that route elsewhere.
   */
  load: async () => (await import('./stellarExplosionModule.js')).createStellarExplosionModule
};

// ---------------------------------------------------------------------------
// State records (validated by normalizeStellarExplosionState at runtime)
// ---------------------------------------------------------------------------

/** Core-collapse red-supergiant canonical state. */
const CORE_COLLAPSE_STATE: StellarExplosionPublicState = {
  scenarioId: 'core-collapse',
  progenitorRadiusSolar: 500,
  progenitorTemperatureK: 3800,
  energyProxyFoe: 1.2,
  ejectaMassProxySolar: 9,
  expansionVelocityScaleKmS: 11000,
  anisotropyStrength: 0.35,
  anisotropyAxis: [0, 1, 0],
  lobeWeighting: 0.3,
  clumpingLevel: 0.55,
  clumpingSeed: 41,
  jet: { enabled: false, halfOpeningAngleDeg: 10, velocityProxyC: 0.5, viewingAngleDeg: 90 },
  timeSeconds: 0
};

/** Stripped-envelope compact-progenitor variant. */
const STRIPPED_ENVELOPE_STATE: StellarExplosionPublicState = {
  scenarioId: 'stripped-envelope',
  progenitorRadiusSolar: 3,
  progenitorTemperatureK: 12000,
  energyProxyFoe: 1.5,
  ejectaMassProxySolar: 4,
  expansionVelocityScaleKmS: 15000,
  anisotropyStrength: 0.45,
  anisotropyAxis: [0.2, 0.95, 0.25],
  lobeWeighting: 0.45,
  clumpingLevel: 0.5,
  clumpingSeed: 43,
  jet: { enabled: false, halfOpeningAngleDeg: 10, velocityProxyC: 0.5, viewingAngleDeg: 90 },
  timeSeconds: 0
};

/**
 * Hypernova: STRUCTURALLY different model state (>2x velocity scale, strong
 * unipolar-dominant asymmetry, central-engine morphology) — explicitly not
 * a brightness multiplier (mission section 31).
 */
const HYPERNOVA_STATE: StellarExplosionPublicState = {
  scenarioId: 'hypernova',
  progenitorRadiusSolar: 100,
  progenitorTemperatureK: 20000,
  energyProxyFoe: 10,
  ejectaMassProxySolar: 12,
  expansionVelocityScaleKmS: 28000,
  anisotropyStrength: 0.75,
  anisotropyAxis: [0.1, 0.99, 0.05],
  lobeWeighting: 0.8,
  clumpingLevel: 0.6,
  clumpingSeed: 47,
  jet: { enabled: true, halfOpeningAngleDeg: 8, velocityProxyC: 0.9, viewingAngleDeg: 90 },
  timeSeconds: 0
};

/**
 * Long-GRB physical engine state shared by BOTH viewing presets; the two
 * presets differ in OBSERVER geometry only (viewing angle + camera), so the
 * on/off-axis distinction is genuinely geometric (mission section 33).
 */
const GRB_ENGINE_STATE: StellarExplosionPublicState = {
  scenarioId: 'long-grb',
  progenitorRadiusSolar: 5,
  progenitorTemperatureK: 40000,
  energyProxyFoe: 4,
  ejectaMassProxySolar: 6,
  expansionVelocityScaleKmS: 18000,
  anisotropyStrength: 0.6,
  anisotropyAxis: [0, 1, 0],
  lobeWeighting: 0.85,
  clumpingLevel: 0.5,
  clumpingSeed: 53,
  jet: { enabled: true, halfOpeningAngleDeg: 5, velocityProxyC: 0.985, viewingAngleDeg: 4 },
  timeSeconds: 0
};

/** Off-axis observer copy: ONLY the viewing angle changes. */
const GRB_OFF_AXIS_STATE: StellarExplosionPublicState = {
  ...GRB_ENGINE_STATE,
  clumpingSeed: 59,
  jet: { ...GRB_ENGINE_STATE.jet, viewingAngleDeg: 68 }
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const CORE_COLLAPSE_PRESET: PresetDescriptor = {
  id: 'core-collapse',
  displayName: 'Core Collapse',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'PROCEDURAL_SCIENTIFIC reduced model: blended free-expansion/Sedov-inspired kinematic shell, ' +
    'procedural clumping noise, empirical temperature/luminosity envelopes. No hydrodynamics, no ' +
    'radiation transport, no stellar-evolution simulation.',
  state: { ...CORE_COLLAPSE_STATE },
  // polar 65deg, azimuth 40deg, d=170 units:
  // dir = (sin65*sin40, cos65, sin65*cos40) = (0.589, 0.423, 0.702)
  camera: { position: [100, 72, 119], target: [0, 0, 0], fovDeg: 55 },
  seed: 41,
  timelineInitialPhase: 0
};

const STRIPPED_ENVELOPE_PRESET: PresetDescriptor = {
  id: 'stripped-envelope',
  displayName: 'Stripped Envelope',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'PROCEDURAL_SCIENTIFIC reduced model, compact helium-star-like progenitor: same disclosed ' +
    'kinematic/procedural machinery as core collapse with faster, more asymmetric ejecta.',
  state: { ...STRIPPED_ENVELOPE_STATE },
  // polar 75deg, azimuth -60deg, d=90 units:
  // dir = (sin75*sin(-60), cos75, sin75*cos(-60)) = (-0.837, 0.259, 0.483)
  camera: { position: [-75, 23, 43], target: [0, 0, 0], fovDeg: 55 },
  seed: 43,
  timelineInitialPhase: 0
};

const HYPERNOVA_PRESET: PresetDescriptor = {
  id: 'hypernova',
  displayName: 'Hypernova',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'PROCEDURAL_SCIENTIFIC, structurally distinct scenario: >2x expansion velocity scale, strong ' +
    'unipolar asymmetry, central-engine morphology proxy. ILLUSTRATIVE — not fitted to any ' +
    'observed event; still no hydrodynamic claim.',
  state: { ...HYPERNOVA_STATE },
  // polar 80deg, azimuth 140deg, d=260 units:
  // dir = (sin80*sin140, cos80, sin80*cos140) = (0.633, 0.174, -0.754)
  camera: { position: [165, 45, -196], target: [0, 0, 0], fovDeg: 55 },
  seed: 47,
  timelineInitialPhase: 0
};

const GRB_ON_AXIS_PRESET: PresetDescriptor = {
  id: 'long-grb-on-axis',
  displayName: 'Long GRB — On Axis',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'Long-GRB / collapsar scenario, observer 4 deg from the jet axis: bipolar narrow jet with ' +
    'beaming-INSPIRED (clamped delta^3) viewing response. Kinematic pattern, NOT relativistic MHD.',
  state: { ...GRB_ENGINE_STATE },
  // polar 8deg (near jet axis), azimuth 15deg, d=420 units:
  // dir = (sin8*sin15, cos8, sin8*cos15) = (0.036, 0.990, 0.135)
  camera: { position: [15, 416, 57], target: [0, 0, 0], fovDeg: 55 },
  seed: 53,
  timelineInitialPhase: 0
};

const GRB_OFF_AXIS_PRESET: PresetDescriptor = {
  id: 'long-grb-off-axis',
  displayName: 'Long GRB — Off Axis',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'Identical physical/engine state to long-grb-on-axis; observer 68 deg off the jet axis so the ' +
    'on/off-axis difference is purely GEOMETRIC (cone solid angle + response factor).',
  state: { ...GRB_OFF_AXIS_STATE },
  // polar 68deg (68 deg from the jet axis), azimuth 30deg, d=420 units:
  // dir = (sin68*sin30, cos68, sin68*cos30) = (0.464, 0.375, 0.803)
  camera: { position: [195, 157, 337], target: [0, 0, 0], fovDeg: 55 },
  seed: 59,
  timelineInitialPhase: 0
};

/** All stellar-explosion presets, default first ('core-collapse'). */
export const STELLAR_EXPLOSION_PRESETS: PresetDescriptor[] = [
  CORE_COLLAPSE_PRESET,
  STRIPPED_ENVELOPE_PRESET,
  HYPERNOVA_PRESET,
  GRB_ON_AXIS_PRESET,
  GRB_OFF_AXIS_PRESET
];
