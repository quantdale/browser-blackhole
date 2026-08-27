import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';

/**
 * M8-09 — canonical trajectory-backend selection: browser coverage.
 *
 * Policy under test (docs/LUT_BACKEND_SPEC.md §15 precedence):
 *   1. explicit dev/test URL override `?trajectory=` wins;
 *   2. otherwise canonical `rendering.trajectoryBackend` preference;
 *   3. `auto` resolves through the measured gate (numerical until flipped);
 *   4. requested-but-unavailable LUT falls back to numerical with an
 *      explicit reason surfaced in the module debug snapshot.
 *
 * The debug snapshot is read through host.activeDestinationDebugSnapshot()
 * — the same truthful channel the diagnostics readout renders.
 */

interface TrajectorySnapshot {
  trajectoryBackendRequested?: unknown;
  trajectoryBackendEffective?: unknown;
  lutFallbackReason?: unknown;
  lutFamilyLoaded?: unknown;
}

async function waitForArrival(page: Page, destinationId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((dest) => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return app.host.state.atlas.activeDestination === dest
            ? 'arrived'
            : `at:${app.host.state.atlas.activeDestination}`;
        }, destinationId),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
}

async function trajectorySnapshot(page: Page): Promise<TrajectorySnapshot> {
  return page.evaluate(() => {
    const app = window.__ATLAS_APP__;
    if (!app) return {};
    const snap = app.host.activeDestinationDebugSnapshot();
    return snap === null ? {} : snap;
  });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !/powerPreference|readback|Failed to load resource/.test(text)) {
      errors.push(`console: ${text.slice(0, 200)}`);
    }
  });
  return errors;
}

test.describe('trajectory backend selection (M8-09)', () => {
  test('auto resolves through the measured gate: lut when assets are usable', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    // One deterministic frame so render() has resolved the policy at least once.
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();

    const snap = await trajectorySnapshot(page);
    expect(snap.trajectoryBackendRequested).toBe('auto');
    // M8-08 flipped the auto gate WITH recorded evidence (ADR §11/§12): auto
    // resolves to the LUT path when the validated family is loaded/usable.
    expect(snap.trajectoryBackendEffective).toBe('lut');
    expect(errors).toEqual([]);
  });

  test('auto falls back to numerical when LUT assets are unavailable', async ({ page }) => {
    const errors = collectErrors(page);
    await page.route(/\/luts\//, (route) => route.abort());
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();

    const snap = await trajectorySnapshot(page);
    expect(snap.trajectoryBackendRequested).toBe('auto');
    expect(snap.trajectoryBackendEffective).toBe('numerical');
    expect(errors).toEqual([]);
  });

  test('canonical lut preference switches the pass without reload', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');

    await page.evaluate(() => window.__ATLAS_APP__!.host.setTrajectoryBackend('lut'));
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();

    const snap = await trajectorySnapshot(page);
    expect(snap.trajectoryBackendRequested).toBe('lut');
    expect(snap.trajectoryBackendEffective).toBe('lut');
    expect(snap.lutFamilyLoaded).toBe(true);
    expect(snap.lutFallbackReason ?? null).toBeNull();

    // Canonical state reflects the preference for share serialization.
    const pref = await page.evaluate(
      () => window.__ATLAS_APP__!.host.state.rendering.trajectoryBackend
    );
    expect(pref).toBe('lut');
    expect(errors).toEqual([]);
  });

  test('requested-but-unavailable LUT falls back to numerical with an explicit reason', async ({
    page
  }) => {
    const errors = collectErrors(page);
    // Block LUT assets to simulate an unavailable/corrupt family deployment.
    await page.route(/\/luts\//, (route) => route.abort());
    await page.goto('/atlas/black-hole?trajectory=lut');
    await waitForArrival(page, 'black-hole');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();

    const snap = await trajectorySnapshot(page);
    expect(snap.trajectoryBackendRequested).toBe('lut');
    expect(snap.trajectoryBackendEffective).toBe('numerical');
    expect(snap.lutFallbackReason).toBe('lut-assets-unavailable');
    // A failed asset fetch is handled truthfully, not as a crash.
    expect(errors).toEqual([]);
  });

  test('explicit numerical override beats a canonical lut preference and says why', async ({
    page
  }) => {
    const errors = collectErrors(page);
    // Boot-time combination: the share link seeds canonical preference=lut,
    // the dev override forces numerical — precedence 1 beats 2, visibly.
    await page.goto('/atlas/black-hole?v=1&tb=lut&trajectory=numerical');
    await waitForArrival(page, 'black-hole');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();

    const pref = await page.evaluate(
      () => window.__ATLAS_APP__!.host.state.rendering.trajectoryBackend
    );
    expect(pref).toBe('lut'); // canonical state keeps the user preference

    const snap = await trajectorySnapshot(page);
    expect(snap.trajectoryBackendRequested).toBe('numerical');
    expect(snap.trajectoryBackendEffective).toBe('numerical');
    expect(snap.lutFallbackReason).toBe('numerical-forced-by-url-override');
    expect(errors).toEqual([]);
  });

  test('invalid ?trajectory= values are ignored (never poison state)', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole?trajectory=warp');
    await waitForArrival(page, 'black-hole');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();

    const snap = await trajectorySnapshot(page);
    expect(snap.trajectoryBackendRequested).toBe('auto');
    // Invalid values collapse to auto, which now resolves through the gate.
    expect(snap.trajectoryBackendEffective).toBe('lut');
    expect(errors).toEqual([]);
  });

  test('share-link tb= deep link applies the canonical preference at boot', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole?v=1&tb=lut');
    await waitForArrival(page, 'black-hole');
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();

    const pref = await page.evaluate(
      () => window.__ATLAS_APP__!.host.state.rendering.trajectoryBackend
    );
    expect(pref).toBe('lut');
    const snap = await trajectorySnapshot(page);
    expect(snap.trajectoryBackendEffective).toBe('lut');
    expect(errors).toEqual([]);
  });
});
