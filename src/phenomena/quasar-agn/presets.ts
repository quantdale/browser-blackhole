/**
 * Quasar / AGN descriptor and production presets (CA7-01..CA7-10).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md section "Quasar / AGN"
 *   (scenario vocabulary: quasar/AGN reference, blazar viewing, radio-loud);
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md §7 (scale zones; blazar =
 *   observer orientation near the jet axis);
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md §12 (central GR direct;
 *   large-scale morphology illustrative/procedural).
 *
 * Camera positions are zone-local scene units (see types.ts ZONE_UNIT_RG):
 * each preset boots INSIDE its documented zone with the zoom01 value that
 * resolves to that zone under the hysteresis machine — orientation and
 * navigation stay coherent by construction.
 */

import type { PhenomenonDescriptor, PresetDescriptor } from '../../atlas/types.js';
import type { AgnScenarioId, QuasarAgnPublicState } from './types.js';

const DESTINATION_ID = 'quasar-agn';

/** GPU memory estimates (MB): volumes + particle buffers + lensing pass. */
export const QUASAR_AGN_DESCRIPTOR: PhenomenonDescriptor = {
  id: DESTINATION_ID,
  title: 'Quasar / AGN',
  group: 'galactic',
  fidelity: 'PROCEDURAL_SCIENTIFIC',
  route: DESTINATION_ID,
  defaultPreset: 'quasar-reference',
  requiredCapabilities: [],
  estimatedGpuMemoryMB: { low: 40, medium: 90, high: 180, ultra: 360 },
  /**
   * WS3/tasks.md §5: dynamic import, so registry setup fetches only this
   * lightweight preset/metadata module at boot. A static import here would
   * pull the whole render graph into the startup chunk for every boot,
   * including boots that route elsewhere.
   */
  load: async () => (await import('./quasarAgnModule.js')).createQuasarAgnModule
};

// ---------------------------------------------------------------------------
// State records (validated by normalizeQuasarAgnState at runtime)
// ---------------------------------------------------------------------------

function stateOf(
  scenario: AgnScenarioId,
  zoom01: number,
  observerAngleToJetDeg: number,
  overrides: Partial<QuasarAgnPublicState> = {}
): QuasarAgnPublicState {
  return {
    blackHoleMassSolar: 1e8,
    scenario,
    zoom01,
    observerAngleToJetDeg,
    torusVisible: true,
    hostVisible: true,
    jetTracerDensity: 0.7,
    ...overrides
  };
}

const NUCLEAR_STATE = stateOf('quasar-reference', 0.58, 45);
const INNER_STATE = stateOf('quasar-reference', 0.18, 35);
const BLAZAR_STATE = stateOf('blazar-view', 0.58, 3);
const RADIO_LOUD_STATE = stateOf('radio-loud', 0.88, 65, { jetTracerDensity: 1 });

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const FIDELITY_BASE =
  'MIXED fidelity, disclosed per component: central SMBH + relativistic disk ' +
  'are DIRECT (the validated black-hole lensing backend, reused); corona, ' +
  'outer disk, dusty torus, jets and host galaxy are PROCEDURAL_SCIENTIFIC ' +
  'illustrative morphologies dimensioned by order-of-magnitude AGN model ' +
  'values (r_g-native geometry; zone scales in types.ts). NOT GRMHD, not ' +
  'radiative transfer, not a unified-model simulation. Blazar mode is an ' +
  'observer ORIENTATION toward the jet axis with a disclosed fixed-Gamma ' +
  'beaming-ratio brightness approximation — not a separate object class.';

const QUASAR_REFERENCE_PRESET: PresetDescriptor = {
  id: 'quasar-reference',
  displayName: 'Quasar Reference (Nuclear Zone)',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    FIDELITY_BASE +
    ' Frames the NUCLEAR zone of a 10^8 M_sun quasar: large-scale accretion ' +
    'disk, dusty torus skirt, and bipolar jet base at ~45 deg from the jet axis.',
  state: { ...NUCLEAR_STATE },
  // Coherence contract: d = agnCameraDistance('nuclear', 0.58) ~277.328,
  // polar 62 deg, azimuth 0 (dir = (0, cos, sin) convention).
  camera: { position: [0, 130.376142, 245.20186], target: [0, 0, 0], fovDeg: 55 },
  seed: 307,
  timelineInitialPhase: 0
};

const INNER_ENGINE_PRESET: PresetDescriptor = {
  id: 'inner-engine',
  displayName: 'Inner Engine (Inner Zone)',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    FIDELITY_BASE +
    ' Zooms INTO the INNER zone: the DIRECT gravitational-lensing pass around ' +
    'the SMBH plus the procedural corona glow, viewed at 35 deg from the jet axis.',
  state: { ...INNER_STATE },
  // d = agnCameraDistance('inner', 0.18) = 27.7738, polar 35 deg.
  camera: { position: [0, 22.750291, 15.929926], target: [0, 0, 0], fovDeg: 55 },
  seed: 307,
  timelineInitialPhase: 0
};

const BLAZAR_VIEW_PRESET: PresetDescriptor = {
  id: 'blazar-view',
  displayName: 'Blazar View (down the jet)',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    FIDELITY_BASE +
    ' Observer placed ~3 deg from the jet axis in the NUCLEAR zone: the ' +
    'approaching lobe carries the disclosed beaming-ratio boost while the ' +
    'receding lobe dims — orientation-driven visualization only.',
  state: { ...BLAZAR_STATE },
  // d = agnCameraDistance('nuclear', 0.58) ~277.328, polar ~3 deg from the
  // +Y jet axis (azimuth 0).
  camera: { position: [0, 277.327694, 14.534129], target: [0, 0, 0], fovDeg: 55 },
  seed: 311,
  timelineInitialPhase: 0
};

const RADIO_GALAXY_PRESET: PresetDescriptor = {
  id: 'radio-galaxy',
  displayName: 'Radio-Loud Galaxy (Galactic Zone)',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    FIDELITY_BASE +
    ' GALACTIC zone of a radio-loud source: kpc-scale bipolar jets with ' +
    'traced knots over a procedural bulge+disk host, seen 65 deg off-axis. ' +
    'The inner engine is intentionally culled at this scale (cost guard).',
  state: { ...RADIO_LOUD_STATE },
  // d = agnCameraDistance('galactic', 0.88) = 1411.90 (recomputed), polar 65 deg, az 30 deg.
  camera: { position: [639.684363, 596.579435, 1107.965818], target: [0, 0, 0], fovDeg: 55 },
  seed: 313,
  timelineInitialPhase: 0
};

/** All quasar/AGN presets, default first. */
export const QUASAR_AGN_PRESETS: PresetDescriptor[] = [
  QUASAR_REFERENCE_PRESET,
  INNER_ENGINE_PRESET,
  BLAZAR_VIEW_PRESET,
  RADIO_GALAXY_PRESET
];
