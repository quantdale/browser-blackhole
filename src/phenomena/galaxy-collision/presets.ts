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
    // Framed against the measured GC1 geometry: tracer extent runs ~11.5 disk
    // radii at t=-50, tightens to ~5 at pericenter and reaches ~19 by t=+40, so
    // a ~35-unit standoff keeps the whole encounter in frame while it plays.
    camera: { position: [0, 10, 23], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 1972,
    // t = -20 tau: the approach is already tidally distorting both disks, which
    // is a live scene on arrival instead of two distant undisturbed blobs.
    timelineInitialPhase: 0.25
  },
  {
    id: 'bridge-tail',
    displayName: 'Bridge & Tail',
    destinationId: 'galaxy-collision',
    stateSchemaVersion: 1,
    fidelityNote: FIDELITY_NOTE,
    state: {},
    camera: { position: [10, 7, 19], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 1972,
    // t = +10 tau: bridge and both tails are developed, separation ~6.
    timelineInitialPhase: 0.5
  },
  {
    id: 'post-encounter',
    displayName: 'Post-Encounter Tails',
    destinationId: 'galaxy-collision',
    stateSchemaVersion: 1,
    fidelityNote: FIDELITY_NOTE,
    state: {},
    // Tails reach ~26 disk radii by t=+58; pull back so they stay on screen.
    camera: { position: [16, 12, 44], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 1972,
    timelineInitialPhase: 0.9
  }
];
