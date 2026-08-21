import './ui/styles.css';
import { createApp } from './app/App.js';
import { createAtlasApp } from './app/atlasApp.js';

/**
 * Boot path selection (Cosmic Atlas CA0-01): `/atlas/*` routes mount the
 * multi-destination atlas shell; the bare root keeps the legacy M0
 * diagnostic app. Both paths share one DOM skeleton and one canvas.
 */
function wantsAtlas(): boolean {
  return window.location.pathname.startsWith('/atlas/');
}

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('#app root element not found');
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
