/**
 * Atlas URL routing — canonical route form, parsing, resolution, and history
 * integration.
 *
 * Spec sources (do not contradict without updating docs):
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §2  (route parsing, canonical form,
 *   unknown-destination and invalid-preset policies)
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §14 (history behavior: validate
 *   route, preserve browser history semantics, never create history loops
 *   through internal redirects)
 *
 * Policies implemented here (STATE_AND_ROUTES §2):
 * - Unknown destination: `resolveDestination` redirects to
 *   {@link DEFAULT_DESTINATION} (`black-hole`). Callers should reflect the
 *   corrected URL with `replace()` (not `push()`) so the redirect never
 *   creates a history loop (§14).
 * - Invalid preset: `resolvePreset` falls back to the destination default
 *   (via the `null` sentinel or the supplied `descriptorDefault`). Startup
 *   never throws on malformed routes; every function in this module is total
 *   and returns fallbacks instead of raising.
 *
 * Validation model: this module holds lightweight allow-lists populated by
 * the app shell once the descriptor/preset registries load
 * ({@link setKnownDestinations}, {@link setKnownPresets}). Before
 * registration the resolvers are deliberately permissive (they cannot know
 * what exists yet) and defer final validation to the caller's registry
 * lookup. After registration they enforce the redirect/fallback policies
 * above.
 */

import type { DestinationId } from './types';

/** Literal first path segment of every atlas route. */
const ATLAS_PATH_PREFIX = 'atlas';

/** Canonical route base: `/${ATLAS_PATH_PREFIX}`. */
const BASE_PATH = `/${ATLAS_PATH_PREFIX}`;

/**
 * Fallback destination for direct loads without a route, unrecognized
 * routes, and unknown destinations (STATE_AND_ROUTES §2).
 */
export const DEFAULT_DESTINATION: DestinationId = 'black-hole';

/** Result of syntactic route parsing; `null` means "not present in URL". */
export interface ParsedRoute {
  /** Raw destination token from `/atlas/<destination>`, or `null`. */
  destination: string | null;
  /** Raw `?preset=` query value, or `null` when absent/empty. */
  preset: string | null;
}

// ---------------------------------------------------------------------------
// Known-destination / known-preset registries (populated by the app shell)
// ---------------------------------------------------------------------------

/** Either a bare destination id, or an id paired with its URL route token. */
export type KnownDestinationEntry =
  | string
  | { id: DestinationId; route?: string };

/**
 * Maps URL/route tokens and ids to canonical destination ids. `null` until
 * first registration (permissive mode).
 */
let destinationIndex: Map<string, DestinationId> | null = null;

/** Validated preset ids per destination id. Missing key = not yet known. */
const presetsByDestination = new Map<DestinationId, ReadonlySet<string>>();

/**
 * Register the set of valid destinations. Accepts descriptor-shaped entries
 * so both `descriptor.id` and `descriptor.route` resolve to the canonical id
 * (`PhenomenonDescriptor.route` is the canonical URL token and may differ
 * from the id). Replaces any previous registration.
 */
export function setKnownDestinations(entries: Iterable<KnownDestinationEntry>): void {
  const index = new Map<string, DestinationId>();
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const id = entry.trim();
      if (id.length > 0) index.set(id, id);
      continue;
    }
    const id = entry && typeof entry.id === 'string' ? entry.id.trim() : '';
    if (id.length === 0) continue;
    index.set(id, id);
    const route = entry && typeof entry.route === 'string' ? entry.route.trim() : '';
    if (route.length > 0) index.set(route, id);
  }
  destinationIndex = index;
}

/**
 * Register the valid preset ids for one destination. Replaces any previous
 * registration for that destination.
 */
export function setKnownPresets(destinationId: DestinationId, presetIds: Iterable<string>): void {
  const key = typeof destinationId === 'string' ? destinationId.trim() : '';
  if (key.length === 0) return;
  const ids = new Set<string>();
  for (const presetId of presetIds) {
    if (typeof presetId === 'string') {
      const trimmed = presetId.trim();
      if (trimmed.length > 0) ids.add(trimmed);
    }
  }
  presetsByDestination.set(key, ids);
}

/** Clear all registrations (back to permissive pre-registry mode). */
export function clearRoutingRegistries(): void {
  destinationIndex = null;
  presetsByDestination.clear();
}

// ---------------------------------------------------------------------------
// Parsing and building
// ---------------------------------------------------------------------------

/** `decodeURIComponent` that never throws; returns the input on failure. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Parse a location into a {@link ParsedRoute}. Syntactic only — validity of
 * the destination/preset tokens is decided by {@link resolveDestination} /
 * {@link resolvePreset}.
 *
 * Accepted canonical shape: `/atlas/<destination>?preset=<id>`. Anything
 * whose first path segment is not `atlas` (case-insensitive) parses to
 * `{ destination: null, preset: null }`, which resolves to the default
 * destination. Extra path segments beyond the destination token are ignored;
 * malformed encodings decode to their raw text; empty `?preset=` counts as
 * absent. Never throws.
 */
export function parseRoute(pathname: string, search: string): ParsedRoute {
  const rawPath = typeof pathname === 'string' ? pathname : '';
  const rawSearch = typeof search === 'string' ? search : '';

  // Tolerate query/hash accidentally included in the pathname argument.
  const pathOnly = rawPath.split(/[?#]/, 1)[0] ?? '';
  const segments = pathOnly
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(safeDecode);

  if (segments.length === 0 || segments[0]!.toLowerCase() !== ATLAS_PATH_PREFIX) {
    return { destination: null, preset: null };
  }

  const destinationToken = segments[1];
  const destination =
    destinationToken !== undefined && destinationToken.trim().length > 0
      ? destinationToken
      : null;

  const queryString = rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch;
  let preset: string | null = null;
  try {
    const params = new URLSearchParams(queryString);
    for (const value of params.getAll('preset')) {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        preset = trimmed;
        break;
      }
    }
  } catch {
    preset = null;
  }

  return { destination, preset };
}

/**
 * Build the canonical URL for a destination (and optionally a preset):
 * `/atlas/<destination>` plus `?preset=<id>` when a non-empty preset is
 * given. Blank/invalid-typed destination ids fall back to
 * {@link DEFAULT_DESTINATION} so the result is always a usable route.
 * Tokens are percent-encoded; this function performs no registry validation.
 */
export function buildRoute(destinationId: string, presetId?: string): string {
  const rawId = typeof destinationId === 'string' ? destinationId.trim() : '';
  const id = rawId.length > 0 ? rawId : DEFAULT_DESTINATION;
  const encodedDestination = encodeURIComponent(id.replace(/^\/+|\/+$/g, ''));

  const rawPreset = typeof presetId === 'string' ? presetId.trim() : '';
  const query = rawPreset.length > 0 ? `?preset=${encodeURIComponent(rawPreset)}` : '';

  return `${BASE_PATH}/${encodedDestination}${query}`;
}

// ---------------------------------------------------------------------------
// Resolution (syntactic token -> validated identity)
// ---------------------------------------------------------------------------

/**
 * Resolve a parsed route to a destination id.
 *
 * Policy (STATE_AND_ROUTES §2): `null`/blank destinations and unknown
 * destinations resolve to {@link DEFAULT_DESTINATION}; the caller should
 * mirror that redirect with `replace()` so browser history stays loop-free
 * (§14). Before {@link setKnownDestinations} is called the token cannot be
 * validated and is returned as-is (final validation defers to the caller's
 * registry lookup). Never throws.
 */
export function resolveDestination(parsed: ParsedRoute): DestinationId {
  const token =
    parsed && typeof parsed.destination === 'string' ? parsed.destination.trim() : '';
  if (token.length === 0) return DEFAULT_DESTINATION;
  if (destinationIndex === null) return token;

  return destinationIndex.get(token) ?? DEFAULT_DESTINATION;
}

/**
 * Resolve a parsed route to a preset id.
 *
 * Returns `null` when no preset was requested — the caller then uses the
 * destination descriptor's `defaultPreset`. When a preset was requested but
 * is not in the registered allow-list for the resolved destination, the
 * invalid-preset fallback policy (STATE_AND_ROUTES §2) applies: return
 * `descriptorDefault` (or `null` if that itself is blank) so startup lands
 * on the destination default instead of failing. Before
 * {@link setKnownPresets} registers the destination, the requested token is
 * returned as-is. Never throws.
 */
export function resolvePreset(parsed: ParsedRoute, descriptorDefault: string): string | null {
  const token = parsed && typeof parsed.preset === 'string' ? parsed.preset.trim() : '';
  if (token.length === 0) return null;

  const destinationId = resolveDestination(parsed);
  const known = presetsByDestination.get(destinationId);
  if (!known) return token;

  if (known.has(token)) return token;

  const fallback = typeof descriptorDefault === 'string' ? descriptorDefault.trim() : '';
  return fallback.length > 0 ? fallback : null;
}

// ---------------------------------------------------------------------------
// History integration
// ---------------------------------------------------------------------------

/** Callbacks installed by {@link installHistoryRouting}. */
export interface HistoryRoutingCallbacks {
  /**
   * Invoked for every applied navigation: programmatic `push`/`replace` and
   * browser back/forward (`popstate`). Receives the freshly parsed route.
   */
  onNavigate(route: ParsedRoute): void;
}

/** Routing controller returned by {@link installHistoryRouting}. */
export interface HistoryRoutingHandle {
  /** Apply the route now and add a history entry. */
  push(route: ParsedRoute): void;
  /** Apply the route now, replacing the current history entry. */
  replace(route: ParsedRoute): void;
  /** Detach the `popstate` listener. Idempotent. */
  unsubscribe(): void;
}

/**
 * Wire atlas navigation to the History API.
 *
 * - `push`/`replace` serialize the route to its canonical URL via
 *   {@link buildRoute}, mutate `history` accordingly, then invoke
 *   `onNavigate` so the application transitions immediately (SPA semantics).
 * - A `popstate` listener re-parses `location` and invokes `onNavigate`,
 *   preserving native back/forward semantics (STATE_AND_ROUTES §14).
 * - If the canonical URL of the new route equals the current one, the
 *   history mutation is skipped while `onNavigate` still fires — this keeps
 *   internal redirects from creating history loops (§14).
 * - Environments without `history` (SSR, tests) and sandboxes where
 *   `pushState` throws (e.g. `file://`) degrade gracefully: navigation is
 *   still applied through `onNavigate`, only the URL update is lost.
 *
 * All methods are total; a missing `onNavigate` degrades to a no-op.
 */
export function installHistoryRouting(callbacks: HistoryRoutingCallbacks): HistoryRoutingHandle {
  const notify = callbacks && typeof callbacks.onNavigate === 'function' ? callbacks.onNavigate : () => {};

  const canUseHistory =
    typeof window !== 'undefined' &&
    typeof window.history !== 'undefined' &&
    typeof window.history.pushState === 'function' &&
    typeof window.addEventListener === 'function' &&
    typeof window.removeEventListener === 'function';

  const applyRoute = (route: ParsedRoute, method: 'push' | 'replace'): void => {
    const safeRoute: ParsedRoute =
      route && typeof route === 'object'
        ? route
        : { destination: null, preset: null };
    const url = buildRoute(
      safeRoute.destination ?? DEFAULT_DESTINATION,
      safeRoute.preset ?? undefined,
    );

    if (canUseHistory) {
      let currentUrl: string | null = null;
      try {
        currentUrl = buildRoute(
          parseRoute(window.location.pathname, window.location.search),
        );
      } catch {
        currentUrl = null;
      }

      if (url !== currentUrl) {
        const state = { cosmicAtlasRoute: safeRoute };
        try {
          if (method === 'push') {
            window.history.pushState(state, '', url);
          } else {
            window.history.replaceState(state, '', url);
          }
        } catch {
          // Sandboxed context (e.g. file://): apply navigation without URL sync.
        }
      }
    }

    notify(safeRoute);
  };

  const onPopState = (): void => {
    notify(parseRoute(window.location.pathname, window.location.search));
  };

  if (canUseHistory) {
    window.addEventListener('popstate', onPopState);
  }

  return {
    push: (route: ParsedRoute) => applyRoute(route, 'push'),
    replace: (route: ParsedRoute) => applyRoute(route, 'replace'),
    unsubscribe: () => {
      if (canUseHistory) {
        window.removeEventListener('popstate', onPopState);
      }
    },
  };
}
