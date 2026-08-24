/**
 * Production launch catalog — single source of truth for destination
 * navigation order and production/beta visibility (CA8 integration debt fix;
 * campaign §15).
 *
 * Problem this solves: the app shell previously carried its own hardcoded
 * destination list that silently drifted from the registry (Quasar/AGN was
 * registered yet unreachable from normal production navigation). The shell
 * must derive chips from THIS catalog + the live registry, never from a
 * private copy.
 *
 * Contract (unit-tested in tests/unit/launchCatalog.test.ts):
 * - every id here is unique;
 * - every REGISTERED destination id appears here unless it is the debug-only
 *   Diagnostic destination — so a future destination cannot be registered
 *   but accidentally omitted from production navigation;
 * - `beta: true` destinations stay hidden from the production selector until
 *   promoted (CA12-07 policy hook);
 * - labels come from registry descriptors, not duplicated strings.
 */

export interface LaunchCatalogEntry {
  readonly id: string;
  /** Beta destinations are registered but NOT production-visible. */
  readonly beta?: boolean;
}

export const DEBUG_DESTINATION_ID = 'diagnostic';

/** Top-bar production destinations in taxonomy/launch order. */
export const LAUNCH_CATALOG: readonly LaunchCatalogEntry[] = [
  { id: 'black-hole' },
  { id: 'neutron-star' },
  { id: 'stellar-explosion' },
  { id: 'compact-merger' },
  { id: 'tidal-disruption' },
  { id: 'quasar-agn' },
  { id: 'black-hole-merger' }
];

/** Production-visible ids (order preserved), for chips and deep-link UX. */
export function productionDestinationIds(): string[] {
  return LAUNCH_CATALOG.filter((entry) => entry.beta !== true).map((entry) => entry.id);
}
