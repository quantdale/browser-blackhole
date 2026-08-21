import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser selection policy:
 *  - PLAYWRIGHT_BROWSER_CHANNEL env var wins (e.g. `msedge`, `chrome`);
 *  - otherwise, outside CI, a system Microsoft Edge is used when present so a
 *    fresh checkout can run `npm run e2e` without downloading a browser;
 *  - otherwise (and always in CI) the Playwright-managed Chromium is used;
 *    install it with `npx playwright install chromium`.
 *
 * Smoke tests assert READY-or-fallback-or-useful-unsupported status and never
 * a specific backend: headless environments frequently lack WebGPU.
 */
function resolveBrowserChannel(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
  if (explicit) return explicit;
  if (process.env.CI) return undefined;

  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/opt/microsoft/msedge/msedge',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ];
  if (edgePaths.some((p) => existsSync(p))) return 'msedge';
  return undefined;
}

const channel = resolveBrowserChannel();

export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    ...(channel ? { channel } : {}),
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    baseURL: 'http://127.0.0.1:4173'
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
