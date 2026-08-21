/**
 * Atlas-level global state: default construction, sanitizing validation, and
 * compact URL (share-link) serialization.
 *
 * Spec sources:
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §1 (state schema), §2 (unknown
 *   destination / invalid preset fall back instead of throwing), §6 (every
 *   public value passes one normalizer: finite checks, enum whitelists,
 *   clamped control ranges, cross-field constraints), §9 (share links carry a
 *   compact subset only), §10 (unsupported schema versions are rejected, never
 *   silently reinterpreted).
 * - docs/cosmic-atlas/ARCHITECTURE.md §9 (URL serialization carries stable
 *   public state only; runtime handles never serialize).
 *
 * Validation policy: this module NEVER throws on user/route-supplied input.
 * Invalid fields are replaced with documented defaults; supported fields are
 * clamped into their documented ranges.
 */

import type {
  CosmicAtlasStateV1,
  DestinationId,
  TransitionPhase,
  TransitionPublicState,
  VersionedDestinationState
} from './types';

// ---------------------------------------------------------------------------
// Defaults and documented control ranges (STATE_AND_ROUTES §6)
// ---------------------------------------------------------------------------

/** Fallback destination for unknown/invalid ids (STATE_AND_ROUTES §2). */
export const DEFAULT_ACTIVE_DESTINATION: DestinationId = 'black-hole';

export const TONE_MAPPING_VALUES = ['aces-filmic', 'agx', 'neutral', 'linear'] as const;
export const QUALITY_MODE_VALUES = ['auto', 'low', 'medium', 'high', 'ultra'] as const;
export const TRANSITION_PHASE_VALUES = ['preparing', 'outgoing', 'hyperspace', 'arriving'] as const;

/**
 * Host-side control clamps. These bound UI-facing presentation controls only;
 * they never alter scientific parameters (STATE_AND_ROUTES §12).
 */
export const EXPOSURE_RANGE = { min: 0.05, max: 8 } as const;
export const BLOOM_STRENGTH_RANGE = { min: 0, max: 4 } as const;
export const RENDER_SCALE_OVERRIDE_RANGE = { min: 0.25, max: 2 } as const;
export const CAMERA_FOV_DEG_RANGE = { min: 10, max: 150 } as const;
export const CAMERA_POLAR_DEG_RANGE = { min: 0, max: 180 } as const;
/**
 * Camera distance lives in destination scene units (r_g for compact objects),
 * so these bounds only reject non-finite and non-positive values rather than
 * imposing a physical scale.
 */
export const CAMERA_DISTANCE_RANGE = { min: 1e-4, max: 1e12 } as const;

/**
 * Empty `activePreset` means "use the destination descriptor's
 * `defaultPreset`" (STATE_AND_ROUTES §2: invalid presets fall back to the
 * destination default).
 */
export const DEFAULT_ACTIVE_PRESET = '';

// ---------------------------------------------------------------------------
// Small sanitized-field helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Finite-clamp with fallback; NaN/Infinity/non-numbers collapse to `fallback`. */
function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  const n = finiteNumberOrNull(value);
  return n === null ? fallback : clamp(n, min, max);
}

/** Finite-clamp where absence/invalidity yields `null` (nullable overrides). */
function clampFiniteOrNull(value: unknown, min: number, max: number): number | null {
  const n = finiteNumberOrNull(value);
  return n === null ? null : clamp(n, min, max);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function enumOr<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function normalizeAzimuthDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Known-id whitelists (optional second argument of validateAtlasState)
// ---------------------------------------------------------------------------

export interface AtlasStateKnownIds {
  /**
   * Registry destination ids. When provided, any state referencing an id
   * outside the whitelist falls back to `DEFAULT_ACTIVE_DESTINATION` and
   * `destinations` entries outside the whitelist are dropped.
   */
  destinationIds?: ReadonlySet<string> | readonly string[];
  /**
   * Allowed preset ids per destination id. A destination without an entry
   * accepts any preset id (per-destination registries may not be loaded yet).
   */
  presetIdsByDestination?: Readonly<Record<string, readonly string[] | ReadonlySet<string>>>;
}

function idListContains(
  ids: ReadonlySet<string> | readonly string[] | undefined,
  id: string
): boolean {
  if (ids === undefined) return true;
  return typeof (ids as ReadonlySet<string>).has === 'function'
    ? (ids as ReadonlySet<string>).has(id)
    : (ids as readonly string[]).includes(id);
}

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

/**
 * Fresh, fully-populated default atlas state. `activePreset` is
 * {@link DEFAULT_ACTIVE_PRESET} (descriptor default). Camera values are a
 * neutral framing placeholder; destination arrival presets override them on
 * enter (ARCHITECTURE §4).
 */
export function createDefaultAtlasState(
  activeDestination: DestinationId = DEFAULT_ACTIVE_DESTINATION
): CosmicAtlasStateV1 {
  return {
    schemaVersion: 1,
    atlas: {
      activeDestination,
      activePreset: DEFAULT_ACTIVE_PRESET,
      targetDestination: null,
      targetPreset: null,
      transition: { active: false, phase: null, progress: 0 }
    },
    sharedVisual: {
      exposure: 1,
      bloomEnabled: true,
      bloomStrength: 0.5,
      toneMapping: 'aces-filmic'
    },
    rendering: {
      qualityMode: 'auto',
      targetFps: 60,
      renderScaleOverride: null
    },
    accessibility: {
      reducedMotion: false,
      highContrastUi: false
    },
    camera: {
      azimuthDeg: 0,
      polarDeg: 90,
      distance: 20,
      fovDeg: 60
    },
    destinations: {}
  };
}

// ---------------------------------------------------------------------------
// Validation (sanitizing, never throwing — STATE_AND_ROUTES §6)
// ---------------------------------------------------------------------------

/**
 * Normalize arbitrary input (deep-parsed JSON, history state, postMessage)
 * into a valid {@link CosmicAtlasStateV1}.
 *
 * Behavior:
 * - missing/malformed top level or a `schemaVersion` other than 1 returns the
 *   default state (§10: unsupported versions are rejected, not migrated);
 * - numbers are finite-checked and clamped to documented ranges;
 * - enums are whitelisted;
 * - unknown destination ids fall back to `black-hole` when a whitelist is
 *   given (§2);
 * - invalid preset ids fall back to the destination default (§2);
 * - `targetPreset` is dropped whenever `targetDestination` is null
 *   (cross-field constraint);
 * - `destinations` keeps only entries whose key is a known id (when
 *   `knownIds.destinationIds` is given) and whose payload is a well-formed
 *   {@link VersionedDestinationState}. Per-destination `schemaVersion` is any
 *   positive integer; migration is each destination's responsibility (§10).
 *
 * The input object is never mutated; the returned state is freshly allocated.
 */
export function validateAtlasState(
  input: unknown,
  knownIds?: AtlasStateKnownIds
): CosmicAtlasStateV1 {
  const defaults = createDefaultAtlasState();
  if (!isPlainObject(input)) return defaults;

  const version = finiteNumberOrNull(input['schemaVersion']);
  if (version !== 1) return defaults;

  const destinationWhitelisted = (id: string): boolean =>
    idListContains(knownIds?.destinationIds, id);

  const presetAllowed = (destinationId: string, presetId: string): boolean => {
    const allowed = knownIds?.presetIdsByDestination?.[destinationId];
    return allowed === undefined ? true : idListContains(allowed, presetId);
  };

  // --- atlas ---------------------------------------------------------------
  const atlasRaw = isPlainObject(input['atlas']) ? input['atlas'] : {};

  const rawActiveDestination = nonEmptyString(atlasRaw['activeDestination']);
  const activeDestination: DestinationId =
    rawActiveDestination !== null && destinationWhitelisted(rawActiveDestination)
      ? rawActiveDestination
      : DEFAULT_ACTIVE_DESTINATION;

  const rawActivePreset = nonEmptyString(atlasRaw['activePreset']);
  const activePreset: string =
    rawActivePreset !== null && presetAllowed(activeDestination, rawActivePreset)
      ? rawActivePreset
      : DEFAULT_ACTIVE_PRESET;

  const rawTargetDestination = nonEmptyString(atlasRaw['targetDestination']);
  const targetDestination: DestinationId | null =
    rawTargetDestination !== null && destinationWhitelisted(rawTargetDestination)
      ? rawTargetDestination
      : null;

  const rawTargetPreset = nonEmptyString(atlasRaw['targetPreset']);
  let targetPreset: string | null =
    rawTargetPreset !== null &&
    targetDestination !== null &&
    presetAllowed(targetDestination, rawTargetPreset)
      ? rawTargetPreset
      : null;
  if (targetDestination === null) targetPreset = null;

  const transitionRaw = isPlainObject(atlasRaw['transition']) ? atlasRaw['transition'] : {};
  const rawTransitionPhase = transitionRaw['phase'];
  const transitionPhase: TransitionPhase | null =
    typeof rawTransitionPhase === 'string' &&
    (TRANSITION_PHASE_VALUES as readonly string[]).includes(rawTransitionPhase)
      ? (rawTransitionPhase as TransitionPhase)
      : null;
  const transition: TransitionPublicState = {
    active: boolOr(transitionRaw['active'], false),
    phase: transitionPhase,
    progress: clampFinite(transitionRaw['progress'], 0, 1, 0)
  };

  // --- sharedVisual ----------------------------------------------------------
  const visualRaw = isPlainObject(input['sharedVisual']) ? input['sharedVisual'] : {};

  // --- rendering -------------------------------------------------------------
  const renderingRaw = isPlainObject(input['rendering']) ? input['rendering'] : {};

  // --- accessibility -----------------------------------------------------------
  const accessRaw = isPlainObject(input['accessibility']) ? input['accessibility'] : {};

  // --- camera ------------------------------------------------------------------
  const cameraRaw = isPlainObject(input['camera']) ? input['camera'] : {};

  // --- destinations --------------------------------------------------------------
  const destinations: Record<string, VersionedDestinationState> = {};
  const destinationsRaw = input['destinations'];
  if (isPlainObject(destinationsRaw)) {
    for (const [id, entry] of Object.entries(destinationsRaw)) {
      if (!destinationWhitelisted(id)) continue;
      if (!isPlainObject(entry)) continue;
      const entryVersion = finiteNumberOrNull(entry['schemaVersion']);
      if (entryVersion === null || !Number.isInteger(entryVersion) || entryVersion < 1) continue;
      const entryState = entry['state'];
      if (!isPlainObject(entryState)) continue;
      destinations[id] = { schemaVersion: entryVersion, state: entryState };
    }
  }

  return {
    schemaVersion: 1,
    atlas: {
      activeDestination,
      activePreset,
      targetDestination,
      targetPreset,
      transition
    },
    sharedVisual: {
      exposure: clampFinite(visualRaw['exposure'], EXPOSURE_RANGE.min, EXPOSURE_RANGE.max, 1),
      bloomEnabled: boolOr(visualRaw['bloomEnabled'], true),
      bloomStrength: clampFinite(
        visualRaw['bloomStrength'],
        BLOOM_STRENGTH_RANGE.min,
        BLOOM_STRENGTH_RANGE.max,
        0.5
      ),
      toneMapping: enumOr(visualRaw['toneMapping'], TONE_MAPPING_VALUES, 'aces-filmic')
    },
    rendering: {
      qualityMode: enumOr(renderingRaw['qualityMode'], QUALITY_MODE_VALUES, 'auto'),
      targetFps: finiteNumberOrNull(renderingRaw['targetFps']) === 30 ? 30 : 60,
      renderScaleOverride: clampFiniteOrNull(
        renderingRaw['renderScaleOverride'],
        RENDER_SCALE_OVERRIDE_RANGE.min,
        RENDER_SCALE_OVERRIDE_RANGE.max
      )
    },
    accessibility: {
      reducedMotion: boolOr(accessRaw['reducedMotion'], false),
      highContrastUi: boolOr(accessRaw['highContrastUi'], false)
    },
    camera: {
      azimuthDeg: normalizeAzimuthDeg(
        clampFinite(cameraRaw['azimuthDeg'], -3600, 3600, defaults.camera.azimuthDeg)
      ),
      polarDeg: clampFinite(
        cameraRaw['polarDeg'],
        CAMERA_POLAR_DEG_RANGE.min,
        CAMERA_POLAR_DEG_RANGE.max,
        defaults.camera.polarDeg
      ),
      distance: clampFinite(
        cameraRaw['distance'],
        CAMERA_DISTANCE_RANGE.min,
        CAMERA_DISTANCE_RANGE.max,
        defaults.camera.distance
      ),
      fovDeg: clampFinite(
        cameraRaw['fovDeg'],
        CAMERA_FOV_DEG_RANGE.min,
        CAMERA_FOV_DEG_RANGE.max,
        defaults.camera.fovDeg
      )
    },
    destinations
  };
}

// ---------------------------------------------------------------------------
// URL share serialization (STATE_AND_ROUTES §9 compact subset)
// ---------------------------------------------------------------------------

/**
 * Query keys of the compact share subset. Unknown keys are ignored on parse so
 * future fields can be added without breaking older parsers.
 */
const SHARE_SCHEMA_VERSION = '1';

function formatNumberCompact(value: number): string {
  return String(Number(value.toFixed(3)));
}

/**
 * Serialize the documented compact subset to a canonical query string
 * (no leading `?`):
 *
 * - `v` share-schema version (always first);
 * - `d` atlas.activeDestination (always present);
 * - `p` atlas.activePreset (omitted when it is the descriptor default);
 * - `e` sharedVisual.exposure, `b` bloomEnabled, `bs` bloomStrength,
 *   `t` toneMapping (each omitted when equal to its default);
 * - `q` rendering.qualityMode (omitted when `auto`);
 * - `rm` accessibility.reducedMotion (omitted when false).
 *
 * The input is re-normalized through {@link validateAtlasState} first, so the
 * output is canonical for equivalent states. Runtime-only fields (transition,
 * targets, camera, destination payloads) are intentionally excluded (§9).
 */
export function serializeForUrl(state: CosmicAtlasStateV1): string {
  const s = validateAtlasState(state);
  const parts: string[] = [`v=${SHARE_SCHEMA_VERSION}`];
  parts.push(`d=${encodeURIComponent(s.atlas.activeDestination)}`);
  if (s.atlas.activePreset !== DEFAULT_ACTIVE_PRESET) {
    parts.push(`p=${encodeURIComponent(s.atlas.activePreset)}`);
  }
  if (s.sharedVisual.exposure !== 1) {
    parts.push(`e=${formatNumberCompact(s.sharedVisual.exposure)}`);
  }
  if (!s.sharedVisual.bloomEnabled) parts.push('b=0');
  if (s.sharedVisual.bloomStrength !== 0.5) {
    parts.push(`bs=${formatNumberCompact(s.sharedVisual.bloomStrength)}`);
  }
  if (s.sharedVisual.toneMapping !== 'aces-filmic') {
    parts.push(`t=${s.sharedVisual.toneMapping}`);
  }
  if (s.rendering.qualityMode !== 'auto') parts.push(`q=${s.rendering.qualityMode}`);
  if (s.accessibility.reducedMotion) parts.push('rm=1');
  return parts.join('&');
}

/**
 * Extract the query component from a bare query string (`d=x&p=y`), a query
 * with leading `?`/`#`, or a full URL. Returns the inner query text.
 */
function extractQueryComponent(raw: string): string {
  let s = raw.trim();
  const hashIndex = s.indexOf('#');
  if (hashIndex >= 0) s = s.slice(0, hashIndex);
  if (s.includes('://')) {
    try {
      return new URL(s).search.replace(/^\?/, '');
    } catch {
      // Not a parsable absolute URL; treat the text as a query string below.
    }
  }
  return s.replace(/^\?/, '');
}

/**
 * Parse a share string produced by {@link serializeForUrl} (or a superset
 * query containing those keys) into a partial atlas state.
 *
 * Contract:
 * - unknown query keys are ignored (forward compatibility);
 * - unrecognized values collapse to section defaults;
 * - a `v` other than the supported share-schema version rejects the whole
 *   payload (empty result) per STATE_AND_ROUTES §10;
 * - every present top-level section is emitted COMPLETE (parsed keys merged
 *   over section defaults), so callers can safely replace whole sections:
 *   `{ ...current, ...parsed }`.
 *
 * Parsed destination/preset ids are structurally sanitized here but NOT
 * checked against the live registry — route/id validation against registered
 * descriptors is the navigation layer's job (STATE_AND_ROUTES §2).
 */
export function parseFromUrl(serialized: string): Partial<CosmicAtlasStateV1> {
  const params = new URLSearchParams(extractQueryComponent(serialized));
  const read = (key: string): string | null => {
    const value = params.get(key);
    return value === null ? null : value.trim();
  };

  const versionRaw = read('v');
  if (versionRaw !== null && versionRaw !== SHARE_SCHEMA_VERSION) return {};

  const defaults = createDefaultAtlasState();
  const result: Partial<CosmicAtlasStateV1> = {};

  const destination = read('d');
  const preset = read('p');
  if (destination !== null || preset !== null) {
    result.atlas = {
      activeDestination:
        destination !== null && destination.length > 0
          ? destination
          : defaults.atlas.activeDestination,
      activePreset: preset ?? DEFAULT_ACTIVE_PRESET,
      targetDestination: null,
      targetPreset: null,
      transition: { active: false, phase: null, progress: 0 }
    };
  }

  const exposure = read('e');
  const bloomEnabled = read('b');
  const bloomStrength = read('bs');
  const toneMapping = read('t');
  if (
    exposure !== null ||
    bloomEnabled !== null ||
    bloomStrength !== null ||
    toneMapping !== null
  ) {
    result.sharedVisual = {
      exposure:
        exposure !== null
          ? clampFinite(Number(exposure), EXPOSURE_RANGE.min, EXPOSURE_RANGE.max, 1)
          : defaults.sharedVisual.exposure,
      bloomEnabled:
        bloomEnabled !== null ? bloomEnabled !== '0' : defaults.sharedVisual.bloomEnabled,
      bloomStrength:
        bloomStrength !== null
          ? clampFinite(
              Number(bloomStrength),
              BLOOM_STRENGTH_RANGE.min,
              BLOOM_STRENGTH_RANGE.max,
              0.5
            )
          : defaults.sharedVisual.bloomStrength,
      toneMapping:
        toneMapping !== null
          ? enumOr(toneMapping, TONE_MAPPING_VALUES, 'aces-filmic')
          : defaults.sharedVisual.toneMapping
    };
  }

  const qualityMode = read('q');
  if (qualityMode !== null) {
    result.rendering = {
      qualityMode: enumOr(qualityMode, QUALITY_MODE_VALUES, 'auto'),
      targetFps: defaults.rendering.targetFps,
      renderScaleOverride: defaults.rendering.renderScaleOverride
    };
  }

  const reducedMotion = read('rm');
  if (reducedMotion !== null) {
    result.accessibility = {
      reducedMotion: reducedMotion !== '0' && reducedMotion !== '',
      highContrastUi: defaults.accessibility.highContrastUi
    };
  }

  return result;
}
