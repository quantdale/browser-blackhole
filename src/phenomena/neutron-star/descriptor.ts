/**
 * Neutron-star destination DESCRIPTOR — deliberately lightweight.
 *
 * WS3/tasks.md §5 (whole-atlas performance optimization): the descriptor used
 * to live in `neutronStarModule.ts`, so registry setup had to fetch and
 * evaluate the whole heavy implementation on every boot just to learn the
 * route, title and memory estimates — even when the boot routed elsewhere.
 * Splitting the metadata out restores the lazy pattern the registry expects:
 * `load` dynamically imports the implementation, which imports this
 * descriptor back (a static edge in that direction only, so no cycle).
 *
 * Preset data lives in the equally lightweight `./presets.js`.
 */

import type { PhenomenonDescriptor } from '../../atlas/types.js';

/**
 * GPU memory estimates (MB, conservative): the surface pass is a fullscreen
 * triangle (<0.001 MB geometry) whose cost lives in the compiled pipeline,
 * dipole lines ~0.15 MB, materials/uniform buffers <0.05 MB; the remainder
 * is driver/headroom margin. Shared HDR targets and post chains are
 * host-owned and intentionally excluded.
 */
export const NEUTRON_STAR_DESCRIPTOR: PhenomenonDescriptor = {
  id: 'neutron-star',
  title: 'Neutron Star',
  group: 'compact',
  fidelity: 'DIRECT',
  route: 'neutron-star',
  defaultPreset: 'surface',
  requiredCapabilities: [],
  estimatedGpuMemoryMB: { low: 0.5, medium: 0.75, high: 1, ultra: 2 },
  load: async () => (await import('./neutronStarModule.js')).createNeutronStarModule
};
