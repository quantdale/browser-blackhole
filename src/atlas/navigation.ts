/**
 * NavigationController — selection state + URL routing for Cosmic Atlas
 * (CA0-07).
 *
 * Spec sources:
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §2 — unknown destination falls back
 *   to `DEFAULT_DESTINATION`; invalid preset falls back to the destination
 *   default; both are logged corrections, never throws.
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §14 — history semantics: programmatic
 *   navigation pushes a history entry, browser back/forward applies routes via
 *   `popstate` without pushing, and internal redirects correct the URL with
 *   `replace()` so no history loops are created.
 * - docs/cosmic-atlas/WORK_PACKETS.md CA0-07 — `/atlas/<id>` plus preset
 *   parsing/validation.
 *
 * Generation discipline (STATE_AND_ROUTES §5): every accepted navigation
 * request increments a monotonically increasing generation token that rides on
 * the emitted intent; downstream consumers (TransitionDirector) use it to
 * invalidate stale async work.
 *
 * History echo suppression: `navigate()` updates the in-memory selection
 * BEFORE pushing the canonical route, so the synchronous `onNavigate` callback
 * fired by `installHistoryRouting` resolves to the current selection and is
 * suppressed instead of re-entering navigation (no double generation bump, no
 * duplicate intents). The same guard makes `commitRoute`'s `replaceState`
 * idempotent.
 */

import {
  DEFAULT_DESTINATION,
  buildRoute,
  installHistoryRouting,
  parseRoute,
  setKnownDestinations,
  setKnownPresets
} from './routes';
import type { HistoryRoutingHandle, ParsedRoute } from './routes';
import type { DestinationId } from './types';
import type { DestinationRegistry } from './registry';

/** Current destination/preset pair held by the controller. */
export interface NavigationSelection {
  destinationId: DestinationId;
  presetId: string;
}

/** What triggered a navigation intent. */
export type NavigationIntentSource = 'request' | 'history' | 'initial';

/** Emitted for every accepted navigation; consumed by the host → director. */
export interface NavigationIntent extends NavigationSelection {
  /** Monotonically increasing; bumped on every accepted request. */
  generation: number;
  source: NavigationIntentSource;
}

type IntentListener = (intent: NavigationIntent) => void;

export class NavigationController {
  private readonly registry: DestinationRegistry;

  private selectionValue: NavigationSelection | null = null;
  private generationValue = 0;
  private disposed = false;

  private readonly intentListeners = new Set<IntentListener>();
  private historyHandle: HistoryRoutingHandle | null = null;

  constructor(registry: DestinationRegistry) {
    this.registry = registry;
  }

  // -------------------------------------------------------------------------
  // Subscriptions / readouts
  // -------------------------------------------------------------------------

  /** Subscribe to navigation intents; returns an unsubscribe function. */
  onIntent(cb: IntentListener): () => void {
    this.intentListeners.add(cb);
    return () => {
      this.intentListeners.delete(cb);
    };
  }

  /** Current selection, or `null` before the first successful navigation. */
  getSelection(): NavigationSelection | null {
    return this.selectionValue === null ? null : { ...this.selectionValue };
  }

  /** Monotonic generation token of the last accepted navigation. */
  getGeneration(): number {
    return this.generationValue;
  }

  // -------------------------------------------------------------------------
  // Validation (pure; shared by navigate/history/host.resolveTarget)
  // -------------------------------------------------------------------------

  /**
   * Validate a requested destination/preset against the registry applying the
   * documented fallbacks (STATE_AND_ROUTES §2). Logs a `console.warn` with the
   * reason whenever a fallback fires. Returns `null` only when the registry is
   * empty (nothing to fall back to).
   */
  resolveSelection(destinationId: DestinationId, presetId?: string): NavigationSelection | null {
    let resolvedDestination = destinationId;
    if (!this.registry.has(resolvedDestination)) {
      const fallback = this.fallbackDestination(destinationId);
      if (fallback === null) {
        console.warn(
          `[NavigationController] cannot resolve '${destinationId}': registry is empty.`
        );
        return null;
      }
      console.warn(
        `[NavigationController] unknown destination '${destinationId}', falling back to '${fallback}'.`
      );
      resolvedDestination = fallback;
    }

    const presets = this.registry.presetsFor(resolvedDestination);
    let resolvedPreset =
      typeof presetId === 'string' && presets.some((preset) => preset.id === presetId)
        ? presetId
        : null;
    if (resolvedPreset === null) {
      const requested = typeof presetId === 'string' ? `'${presetId}'` : '(none)';
      const fallbackPreset =
        this.registry.defaultPreset(resolvedDestination)?.id ?? presets[0]?.id ?? null;
      if (fallbackPreset === null) {
        console.warn(
          `[NavigationController] destination '${resolvedDestination}' has no usable preset.`
        );
        return null;
      }
      if (presetId !== undefined) {
        console.warn(
          `[NavigationController] invalid preset ${requested} for '${resolvedDestination}', ` +
            `falling back to '${fallbackPreset}'.`
        );
      }
      resolvedPreset = fallbackPreset;
    }

    return { destinationId: resolvedDestination, presetId: resolvedPreset };
  }

  // -------------------------------------------------------------------------
  // Navigation entry points
  // -------------------------------------------------------------------------

  /**
   * Request navigation to a destination (and optional preset). Always bumps
   * the generation, then validates with fallbacks; emits an intent unless
   * nothing resolvable exists. When history routing is attached, pushes the
   * canonical route as a new history entry (the resulting synchronous echo is
   * suppressed by the equality guard).
   */
  navigate(destinationId: DestinationId, presetId?: string): NavigationIntent | null {
    if (this.disposed) return null;
    this.generationValue += 1;

    const selection = this.resolveSelection(destinationId, presetId);
    if (selection === null) return null;

    this.selectionValue = selection;
    this.emit({ ...selection, generation: this.generationValue, source: 'request' });

    this.historyHandle?.push(this.toParsedRoute(selection));
    return { ...selection, generation: this.generationValue, source: 'request' };
  }

  /**
   * Apply the initial document route (deep link). Never touches history — the
   * eventual correction happens through `commitRoute`'s replaceState once the
   * destination activates (§14 redirect policy).
   */
  applyInitialRoute(pathname?: string, search?: string): void {
    if (this.disposed) return;
    const location_ = readLocation(pathname, search);
    if (location_ === null) return;
    this.applyRoute(parseRoute(location_.pathname, location_.search), 'initial');
  }

  /**
   * Reflect a committed destination/preset into the URL via `replaceState`.
   * Called by the host at the director's route-commit point so redirects and
   * fallbacks end up canonicalized without adding history entries.
   */
  commitRoute(destinationId: DestinationId, presetId?: string): void {
    if (this.disposed || this.historyHandle === null) return;
    this.historyHandle.replace({
      destination: destinationId,
      preset: typeof presetId === 'string' && presetId.length > 0 ? presetId : null
    });
  }

  // -------------------------------------------------------------------------
  // History integration
  // -------------------------------------------------------------------------

  /** Install the History API wiring. Idempotent. */
  attachHistory(): void {
    if (this.disposed || this.historyHandle !== null) return;
    this.historyHandle = installHistoryRouting({
      onNavigate: (route) => this.applyRoute(route, 'history')
    });
  }

  /** Push the registry contents into routes.js allow-lists (call after registration). */
  syncRoutingRegistries(): void {
    const descriptors = this.registry.list();
    setKnownDestinations(
      descriptors.map((descriptor) => ({ id: descriptor.id, route: descriptor.route }))
    );
    for (const descriptor of descriptors) {
      setKnownPresets(
        descriptor.id,
        this.registry.presetsFor(descriptor.id).map((preset) => preset.id)
      );
    }
  }

  /** Canonical URL for a selection (exposed for tests/debug surfaces). */
  routeFor(selection: NavigationSelection): string {
    return buildRoute(selection.destinationId, selection.presetId);
  }

  /** Detach history listeners and drop intent subscribers. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.historyHandle?.unsubscribe();
    this.historyHandle = null;
    this.intentListeners.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private applyRoute(parsed: ParsedRoute, source: NavigationIntentSource): void {
    if (this.disposed) return;

    const requestedDestination = parsed.destination ?? DEFAULT_DESTINATION;
    const selection = this.resolveSelection(requestedDestination, parsed.preset ?? undefined);
    if (selection === null) return;

    const current = this.selectionValue;
    if (
      current !== null &&
      current.destinationId === selection.destinationId &&
      current.presetId === selection.presetId
    ) {
      // Echo of our own push/replace, or back/forward onto the live route:
      // not a navigation request, so no generation bump and no intent.
      return;
    }

    this.generationValue += 1;
    this.selectionValue = selection;
    this.emit({ ...selection, generation: this.generationValue, source });
  }

  private emit(intent: NavigationIntent): void {
    for (const cb of Array.from(this.intentListeners)) cb(intent);
  }

  private toParsedRoute(selection: NavigationSelection): ParsedRoute {
    return { destination: selection.destinationId, preset: selection.presetId };
  }

  /**
   * Fallback chain for unknown destinations: the documented default, then the
   * first registered destination, else nothing.
   */
  private fallbackDestination(requested: DestinationId): DestinationId | null {
    if (requested !== DEFAULT_DESTINATION && this.registry.has(DEFAULT_DESTINATION)) {
      return DEFAULT_DESTINATION;
    }
    const first = this.registry.list()[0];
    return first?.id ?? null;
  }
}

function readLocation(
  pathname: string | undefined,
  search: string | undefined
): { pathname: string; search: string } | null {
  if (typeof pathname === 'string' && typeof search === 'string') {
    return { pathname, search };
  }
  if (typeof window === 'undefined') return null;
  return { pathname: window.location.pathname, search: window.location.search };
}
