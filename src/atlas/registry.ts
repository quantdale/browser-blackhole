/**
 * DestinationRegistry — validated registry of Cosmic Atlas destinations
 * (CA0-02).
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §3 "Destination descriptor" — id, route,
 *   group, fidelity, default preset, lazy loader.
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §2 — routes are unique; presets
 *   belong to exactly one destination; invalid ids fall back, never throw at
 *   navigation time (so validation happens here, at registration).
 * - docs/cosmic-atlas/WORK_PACKETS.md CA0-02 — duplicate IDs/routes rejected;
 *   invalid presets rejected.
 *
 * Registration is the only mutation; lookups are total and return `undefined`
 * for unknown ids. The descriptor's `load()` thunk is stored untouched so the
 * lazy dynamic import stays lazy — this module never pulls destination code
 * into the initial bundle.
 */

import type { DestinationId, PhenomenonDescriptor, PresetDescriptor } from './types';

/** Everything registered under one destination id. */
export interface RegisteredDestination {
  readonly descriptor: PhenomenonDescriptor;
  /** Presets in registration order. */
  readonly presets: readonly PresetDescriptor[];
  /** Preset lookup by id (same objects as `presets`). */
  readonly presetById: ReadonlyMap<string, PresetDescriptor>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`DestinationRegistry: ${label} must be a non-empty string.`);
  }
  return value;
}

export class DestinationRegistry {
  private readonly byId = new Map<string, RegisteredDestination>();
  private readonly byRoute = new Map<string, DestinationId>();

  /**
   * Register one destination with its presets.
   *
   * Throws (fail loud — programmer error, not user input) when:
   * - the destination id or route is missing/duplicate;
   * - a preset's `destinationId` does not match the descriptor id;
   * - preset ids are duplicated within the registration;
   * - the preset list is empty or `defaultPreset` is not among the presets;
   * - `descriptor.load` is not a function (lazy loading must stay intact).
   */
  register(descriptor: PhenomenonDescriptor, presets: PresetDescriptor[]): void {
    if (descriptor === null || typeof descriptor !== 'object') {
      throw new TypeError('DestinationRegistry.register: descriptor must be an object.');
    }
    const id = requireNonEmptyString(descriptor.id, 'descriptor.id');
    const route = requireNonEmptyString(descriptor.route, 'descriptor.route');

    if (this.byId.has(id)) {
      throw new Error(`DestinationRegistry: duplicate destination id '${id}'.`);
    }
    const existingRouteOwner = this.byRoute.get(route);
    if (existingRouteOwner !== undefined) {
      throw new Error(
        `DestinationRegistry: duplicate route '${route}' (already owned by '${existingRouteOwner}').`
      );
    }
    if (typeof descriptor.load !== 'function') {
      throw new TypeError(
        `DestinationRegistry: descriptor '${id}' must provide a lazy load() function.`
      );
    }

    if (!Array.isArray(presets) || presets.length === 0) {
      throw new Error(`DestinationRegistry: destination '${id}' needs at least one preset.`);
    }

    const presetById = new Map<string, PresetDescriptor>();
    for (const preset of presets) {
      if (preset === null || typeof preset !== 'object') {
        throw new TypeError(`DestinationRegistry: destination '${id}' has a malformed preset.`);
      }
      const presetId = requireNonEmptyString(preset.id, `preset.id (destination '${id}')`);
      if (preset.destinationId !== id) {
        throw new Error(
          `DestinationRegistry: preset '${presetId}' declares destinationId '${String(preset.destinationId)}' ` +
            `but is registered under '${id}'.`
        );
      }
      if (presetById.has(presetId)) {
        throw new Error(
          `DestinationRegistry: duplicate preset id '${presetId}' in destination '${id}'.`
        );
      }
      presetById.set(presetId, preset);
    }

    const defaultPresetId = requireNonEmptyString(
      descriptor.defaultPreset,
      `descriptor.defaultPreset ('${id}')`
    );
    if (!presetById.has(defaultPresetId)) {
      throw new Error(
        `DestinationRegistry: descriptor '${id}' defaultPreset '${defaultPresetId}' is not in its preset list.`
      );
    }

    this.byId.set(id, { descriptor, presets: [...presets], presetById });
    this.byRoute.set(route, id);
  }

  /** Registered destination record, or `undefined` for unknown ids. */
  get(id: string): RegisteredDestination | undefined {
    return this.byId.get(id);
  }

  /** True when a destination with this exact id is registered. */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** All descriptors in registration order (defensive copy). */
  list(): PhenomenonDescriptor[] {
    return [...this.byId.values()].map((entry) => entry.descriptor);
  }

  /**
   * Resolve a canonical route suffix (`/atlas/<suffix>`) to its descriptor.
   * Matches `descriptor.route` first, then falls back to the destination id
   * itself (routes.js indexes both). Returns `undefined` when nothing matches.
   */
  resolveRoute(routeSuffix: string): PhenomenonDescriptor | undefined {
    const token = typeof routeSuffix === 'string' ? routeSuffix.trim() : '';
    if (token.length === 0) return undefined;
    const viaRoute = this.byRoute.get(token);
    if (viaRoute !== undefined) return this.byId.get(viaRoute)?.descriptor;
    // Ids are also addressable as routes unless a real route collides.
    return this.byId.has(token) ? this.byId.get(token)?.descriptor : undefined;
  }

  /** The destination's default preset, or `undefined` for unknown ids. */
  defaultPreset(id: string): PresetDescriptor | undefined {
    const entry = this.byId.get(id);
    if (entry === undefined) return undefined;
    return entry.presetById.get(entry.descriptor.defaultPreset);
  }

  /** All presets of a destination in registration order (empty when unknown). */
  presetsFor(id: string): PresetDescriptor[] {
    const entry = this.byId.get(id);
    return entry === undefined ? [] : [...entry.presets];
  }
}
