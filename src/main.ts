import './ui/styles.css';
import { createApp } from './app/App.js';

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('#app root element not found');
  const app = await createApp(root);
  (window as unknown as Record<string, unknown>)['__BLACKHOLE_APP__'] = app;
}

boot().catch((err: unknown) => {
  // Last-resort fatal overlay; uses textContent so no string is parsed as HTML.
  const notice = document.createElement('p');
  notice.className = 'noscript-warning';
  notice.textContent = `Fatal startup error: ${String(err)}`;
  document.body.append(notice);
});
