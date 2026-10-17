/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

/**
 * U-04 (`docs/MASTER_PLAN.md`, change `destination-control-truthfulness`):
 * the `__ATLAS_APP__` test hook exposes the host — including the forced
 * continuous-render entry point and a synchronous framebuffer readback — to
 * any script on the page. It must not ship in a production build.
 *
 * The gate is two-part and explicit:
 *   - a development build always installs it (`import.meta.env.DEV`);
 *   - a PRODUCTION build installs it only when the build was made with
 *     `VITE_ATLAS_TEST_HOOKS=1` (`npm run build:e2e`).
 *
 * So `npm run build` — the artifact CI checks and any deployment serves —
 * carries no hook at all, while the Playwright suite runs against a bundle
 * built by `build:e2e`. The opt-in is a BUILD input, not a runtime toggle a
 * visitor could discover or enable.
 */
const atlasTestHooksOptIn = process.env['VITE_ATLAS_TEST_HOOKS'] === '1';

/**
 * O-07/1.3 (operations-and-deployment-readiness): the deployment base path
 * is configurable at build time — `BASE_PATH=/sub-path/ npm run build`
 * produces a sub-path build. Empty/unset keeps the root assumption (`/`)
 * that `public/404.html`'s navigation fallback and the reference host
 * configs document. Both are stated in docs/DEPLOYMENT.md.
 */
const basePath = process.env['BASE_PATH'] ?? '/';

export default defineConfig({
  base: basePath,
  define: {
    __ATLAS_TEST_HOOKS_OPT_IN__: JSON.stringify(atlasTestHooksOptIn)
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // three/webgpu is a large single module; the default 500 kB warning is noise for this app.
    chunkSizeWarningLimit: 2000
  },
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts']
  }
});
