/**
 * CA9 — Galaxy Collision descriptor + presets (lightweight; heavy module is
 * reached through `descriptor.load()` so registration never pulls the renderer
 * code into the initial bundle).
 *
 * Fidelity: DATA_DRIVEN. The tracer trajectories are regenerated offline from
 * the source-locked Toomre & Toomre (1972) restricted three-body model
 * (docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION_SOURCE_LOCK.md). The
 * specific numeric scenario is a repository-derived default within that
 * framework, NOT a transcription of a named system's figure caption. Gas, dust,
 * starburst and self-gravity are procedural/omitted and labeled as such.
 */

import type { PhenomenonDescriptor, PresetDescriptor } from '../../atlas/types.js';

export const GALAXY_COLLISION_DESCRIPTOR: PhenomenonDescriptor = {
  id: 'galaxy-collision',
  title: 'Galaxy Collision',
  group: 'galactic',
  fidelity: 'DATA_DRIVEN',
  route: 'galaxy-collision',
  defaultPreset: 'encounter',
  requiredCapabilities: [],
  estimatedGpuMemoryMB: { low: 16, medium: 32, high: 64, ultra: 96 },
  load: async () => {
    const mod = await import('./galaxyCollisionModule.js');
    return mod.createGalaxyCollisionModule;
  }
};

const FIDELITY_NOTE =
  'Tidal tracer trajectories from the source-locked Toomre & Toomre (1972) ' +
  'restricted three-body model (regenerated offline). Specific encounter ' +
  'geometry is a repository-derived default; gas/dust/starburst omitted.';

export const GALAXY_COLLISION_PRESETS: PresetDescriptor[] = [
  {
    id: 'encounter',
    displayName: 'Encounter',
    destinationId: 'galaxy-collision',
    stateSchemaVersion: 1,
    fidelityNote: FIDELITY_NOTE,
    state: {},
    camera: { position: [0, 6, 14], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 1972,
    timelineInitialPhase: 0.0
  },
  {
    id: 'bridge-tail',
    displayName: 'Bridge & Tail',
    destinationId: 'galaxy-collision',
    stateSchemaVersion: 1,
    fidelityNote: FIDELITY_NOTE,
    state: {},
    camera: { position: [8, 4, 12], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 1972,
    timelineInitialPhase: 0.5
  },
  {
    id: 'post-encounter',
    displayName: 'Post-Encounter Tails',
    destinationId: 'galaxy-collision',
    stateSchemaVersion: 1,
    fidelityNote: FIDELITY_NOTE,
    state: {},
    camera: { position: [10, 2, 10], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 1972,
    timelineInitialPhase: 0.9
  }
];
