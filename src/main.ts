import './ui/styles.css';
import { createApp } from './app/App.js';
import { createAtlasApp } from './app/atlasApp.js';

/**
 * Boot path selection (Cosmic Atlas CA0-01).
 *
 * The PRODUCT is the Cosmic Atlas (`/atlas/*`). A user landing on the bare
 * root must arrive IN the product, not on the legacy M0 diagnostic harness —
 * so the bare root redirects to the flagship destination before boot. The
 * legacy diagnostic app (deterministic gradient / environment view / forced
 * unsupported UX) stays reachable for development and browser smoke tests via
 * `?legacy=1`; it is no longer the default landing.
 */
const DEFAULT_ATLAS_ROUTE = '/atlas/black-hole';

/** True when the legacy M0 diagnostic app is explicitly requested. */
function wantsLegacyRoot(params: URLSearchParams): boolean {
  return params.has('legacy');
}

function wantsAtlas(): boolean {
  return window.location.pathname.startsWith('/atlas/');
}

/**
 * On the bare root without `?legacy=1`, rewrite the URL to the flagship atlas
 * route (preserving any query, e.g. share/backend params) so `wantsAtlas()`
 * then mounts the product. `replaceState` keeps the Back button clean and a
 * later reload hits `/atlas/black-hole` directly (SPA deep-link fallback).
 */
function redirectRootToAtlas(): void {
  if (window.location.pathname !== '/') return;
  const params = new URLSearchParams(window.location.search);
  if (wantsLegacyRoot(params)) return;
  const query = window.location.search;
  try {
    window.history.replaceState({}, '', `${DEFAULT_ATLAS_ROUTE}${query}`);
  } catch {
    // Environments where pushState throws (e.g. file://) fall through to the
    // legacy root rather than crashing; still a truthful terminal state.
  }
}

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('#app root element not found');
  redirectRootToAtlas();
  const app = wantsAtlas() ? await createAtlasApp(root) : await createApp(root);
  (window as unknown as Record<string, unknown>)['__BLACKHOLE_APP__'] = app;
}

boot().catch((err: unknown) => {
  // Last-resort fatal overlay; uses textContent so no string is parsed as HTML.
  const notice = document.createElement('p');
  notice.className = 'noscript-warning';
  notice.textContent = `Fatal startup error: ${String(err)}`;
  document.body.append(notice);
});
