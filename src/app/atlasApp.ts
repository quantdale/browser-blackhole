/**
 * Cosmic Atlas application shell — boots the CosmicAtlasHost into the shared
 * DOM skeleton and drives exactly one frame loop (CA0-01 integration surface,
 * CA0-07 deep links, CA1 transitions).
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §3 (host topology), §7 (frame lifecycle)
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §3 (routes), §14 (history)
 * - docs/cosmic-atlas/PRODUCT_UX_AND_TRANSITIONS.md §4 (transition UX)
 *
 * One application, one renderer lifecycle: this shell never constructs a
 * second renderer; the host owns SharedRendererKernel, and destinations are
 * modules inside it. Boot path selection lives in main.ts: `/atlas/*` routes
 * mount THIS shell; the bare root keeps the legacy M0 diagnostic app so its
 * existing test hooks and panels stay functional.
 *
 * Determinism note: the rAF loop clamps dt the same way the host does
 * (<= 0.25 s) so background-tab pauses cannot inject huge time steps.
 */

import { CosmicAtlasHost } from '../atlas/host.js';
import type { NavigationIntent } from '../atlas/navigation.js';

export interface AtlasAppHandle {
  dispose(): void;
}

interface AtlasAppWindowHook {
  host: CosmicAtlasHost;
  navigate(destinationId: string, presetId?: string): NavigationIntent | null;
}

/** Top-level destination buttons (Phase 14 taxonomy order). */
const NAV_DESTINATIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'black-hole', label: 'Black Hole' },
  { id: 'neutron-star', label: 'Neutron Star' },
  { id: 'diagnostic', label: 'Diagnostic' }
];

export async function createAtlasApp(root: HTMLElement): Promise<AtlasAppHandle> {
  const canvas = root.querySelector<HTMLCanvasElement>('#scene');
  const viewport = root.querySelector<HTMLElement>('#viewport');
  const panelHost = root.querySelector<HTMLElement>('#panel');
  if (!canvas || !viewport || !panelHost) {
    throw new Error('required DOM skeleton (#scene, #viewport, #panel) not found');
  }

  // --- minimal atlas UI ----------------------------------------------------
  // Destination switching goes through host.navigate() so the
  // TransitionDirector owns the visual handoff and route commit. Status is a
  // single truthful text line fed by the InitStatusTracker.
  const nav = document.createElement('nav');
  nav.className = 'atlas-nav';
  nav.setAttribute('aria-label', 'Cosmic Atlas destinations');

  const status = document.createElement('p');
  status.className = 'atlas-status';
  status.setAttribute('role', 'status');
  panelHost.append(nav, status);

  const host = new CosmicAtlasHost(canvas);

  for (const destination of NAV_DESTINATIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = destination.label;
    button.addEventListener('click', () => {
      host.navigate(destination.id);
    });
    nav.append(button);
  }

  // --- boot ----------------------------------------------------------------
  try {
    await host.init();
  } catch (err) {
    status.textContent = `Atlas failed to initialize: ${String(err)}`;
    throw err;
  }
  status.textContent = 'Atlas ready';

  // --- resize plumbing ------------------------------------------------------
  // Mirrors the M0 ResizeController policy (CSS-size driven, DPR handled
  // inside the kernel) at atlas scope.
  const applyResize = (): void => {
    const rect = viewport.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      host.handleResize(rect.width, rect.height);
    }
  };
  const resizeObserver = new ResizeObserver(applyResize);
  resizeObserver.observe(viewport);
  applyResize();

  // --- single frame loop ----------------------------------------------------
  let rafId = 0;
  let lastMs = performance.now();
  const tick = (nowMs: number): void => {
    const dtSeconds = Math.min((nowMs - lastMs) / 1000, 0.25);
    lastMs = nowMs;
    host.frame(dtSeconds);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  const unsubscribeStatus = host.status.subscribe((snapshot) => {
    if (snapshot.failed) {
      status.textContent = `Atlas error [${snapshot.errorCode ?? 'UNKNOWN'}]: ${snapshot.message}`;
    } else if (!snapshot.ready) {
      status.textContent = `Atlas: ${snapshot.message}`;
    }
  });

  // Test/inspection hook (mirrors __BLACKHOLE_APP__ convention from main.ts).
  const hook: AtlasAppWindowHook = {
    host,
    navigate: (destinationId, presetId) => host.navigate(destinationId, presetId)
  };
  (window as unknown as Record<string, unknown>)['__ATLAS_APP__'] = hook;

  return {
    dispose(): void {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      unsubscribeStatus();
      delete (window as unknown as Record<string, unknown>)['__ATLAS_APP__'];
      host.dispose();
      panelHost.innerHTML = '';
    }
  };
}
