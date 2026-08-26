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

// E2E_PORT lets a run move off a colliding local port; the webServer identity
// guard in the specs catches the case where a foreign app occupies the port.
const e2ePort = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  // M11-01: the default (Channel/desktop-Chrome) project runs the whole
  // suite; the firefox project runs ONLY the engine-agnostic compatibility
  // matrix (fallback/unsupported logic on a second engine). It is selected
  // explicitly (`--project=firefox`) so ordinary runs stay unchanged.
  projects: [
    {
      name: 'default',
      use: {
        ...(channel ? { channel } : {}),
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://127.0.0.1:${e2ePort}`
      }
    },
    {
      name: 'firefox',
      testMatch: /compatibility-matrix\.spec\.ts/,
      // Headless Firefox renders through software WebGL2: parallel workers
      // starve each other past the arrival polls. Serial keeps the run
      // honest (the suite asserts correctness, never speed).
      workers: 1,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://127.0.0.1:${e2ePort}`
      }
    }
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
