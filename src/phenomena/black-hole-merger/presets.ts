/**
 * Black-Hole Merger descriptor and production presets (CA8).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DATA_SOURCES_BBH_MERGER.md §6 (fidelity classes);
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md §9 (required disclosure
 *   language for approximate binary-BH visuals);
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §3 (preset schema; honest fidelity
 *   notes; deterministic seeds/timeline phases).
 *
 * PRESETS ARE REFERENCE-EVENT VIEWS, not freeform physics: every preset
 * shows the SAME pinned NR dataset (CA-ADR-021) from a documented timeline
 * position / camera. Arbitrary mass/spin sliders are deliberately absent —
 * the loaded source supports exactly one physical configuration.
 */

import type { PhenomenonDescriptor, PresetDescriptor } from '../../atlas/types.js';
import type { BlackHoleMergerPublicState } from './types.js';

const DESTINATION_ID = 'black-hole-merger';

export const BLACK_HOLE_MERGER_DESCRIPTOR: PhenomenonDescriptor = {
  id: DESTINATION_ID,
  title: 'Black-Hole Merger',
  group: 'compact',
  // Destination-level class. The MIXED breakdown is disclosed per-preset and
  // in the About panel: dynamics DATA_DRIVEN, illustrative lensing
  // PROCEDURAL_SCIENTIFIC, remnant GR pass DIRECT reuse of the Kerr backend.
  fidelity: 'DATA_DRIVEN',
  route: 'black-hole-merger',
  defaultPreset: 'sxs-bbh-0001-inspiral',
  requiredCapabilities: [],
  estimatedGpuMemoryMB: { low: 10, medium: 24, high: 52, ultra: 110 },
  /**
   * WS3/tasks.md §5: dynamic import, so registry setup fetches only this
   * lightweight preset/metadata module at boot. A static import here would
   * pull the whole render graph into the startup chunk for every boot,
   * including boots that route elsewhere.
   */
  load: async () => (await import('./blackHoleMergerModule.js')).createBlackHoleMergerModule
};

const BASE_STATE: BlackHoleMergerPublicState = {
  referenceEvent: 'SXS-BBH-0001',
  showOrbitTrails: true,
  illustrativeLensing: true
};

/** Required disclosure sentence (SCIENTIFIC_FIDELITY §9). */
export const BBM_DISCLOSURE =
  'Orbital motion and waveform are derived from numerical-relativity data ' +
  '(SXS:BBH:0001, CC-BY-4.0). The live lensing visualization is illustrative ' +
  'and does not ray trace the full dynamical spacetime. The remnant phase ' +
  'reuses the validated Kerr backend with source-derived remnant mass/spin; ' +
  'its glow is an illustrative presentation proxy.';

const INSPIRAL_PRESET: PresetDescriptor = {
  id: 'sxs-bbh-0001-inspiral',
  displayName: 'SXS:BBH:0001 — Inspiral',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote: `${BBM_DISCLOSURE} View: late inspiral, ~4 orbits before the merger anchor.`,
  state: { ...BASE_STATE },
  // Camera frames the ~12.2 M initial separation from ~20 deg above the
  // orbital plane (polar 70 deg), azimuth 35 deg.
  camera: { position: [16.5, 8.7, 23.6], target: [0, 0, 0], fovDeg: 55 },
  seed: 211,
  timelineInitialPhase: 0.08
};

const MERGER_PRESET: PresetDescriptor = {
  id: 'sxs-bbh-0001-merger',
  displayName: 'SXS:BBH:0001 — Merger',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote: `${BBM_DISCLOSURE} View: the merger anchor window around the h22 amplitude peak.`,
  state: { ...BASE_STATE },
  camera: { position: [13.2, 6.9, 18.9], target: [0, 0, 0], fovDeg: 55 },
  seed: 223,
  timelineInitialPhase: 0.61
};

const RINGDOWN_PRESET: PresetDescriptor = {
  id: 'sxs-bbh-0001-ringdown',
  displayName: 'SXS:BBH:0001 — Ringdown',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote: `${BBM_DISCLOSURE} View: ringdown — the distorted remnant settles while the emitted h22 amplitude decays.`,
  state: { ...BASE_STATE },
  camera: { position: [11.0, 5.8, 15.7], target: [0, 0, 0], fovDeg: 55 },
  seed: 227,
  timelineInitialPhase: 0.68
};

const REMNANT_PRESET: PresetDescriptor = {
  id: 'sxs-bbh-0001-remnant',
  displayName: 'SXS:BBH:0001 — Remnant',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote: `${BBM_DISCLOSURE} View: final Kerr black hole with the source-derived remnant (mass 0.9516 M, spin |chi| = 0.6865).`,
  state: { ...BASE_STATE, showOrbitTrails: false },
  camera: { position: [9.6, 5.1, 13.7], target: [0, 0, 0], fovDeg: 55 },
  seed: 229,
  timelineInitialPhase: 0.85
};

/** All black-hole-merger presets, default first. */
export const BLACK_HOLE_MERGER_PRESETS: PresetDescriptor[] = [
  INSPIRAL_PRESET,
  MERGER_PRESET,
  RINGDOWN_PRESET,
  REMNANT_PRESET
];
