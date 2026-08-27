/**
 * M10 — Relativistic observer modes: browser/E2E validation.
 *
 * Proves through the PRODUCTION control channel (`setDestinationControl`)
 * and the destination debug snapshot that:
 * - legacy boots stay in `camera` mode with a valid static-frame readout;
 * - circular/freefall modes drive PHYSICAL observer quantities (radius,
 *   beta, gamma, proper time evolve through the deterministic worldline —
 *   not camera coordinates);
 * - pause freezes the proper-time clock while rendering continues;
 * - unsupported domains report TRUTHFUL invalid reasons (never silent);
 * - rapid mode switching stays bounded and console-clean.
 */

import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';

const REAL_ERROR_FILTER = /powerPreference|readback|Failed to load resource/;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !REAL_ERROR_FILTER.test(text)) {
      errors.push(`console: ${text.slice(0, 200)}`);
    }
  });
  return errors;
}

async function waitForArrival(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          if (app.host.state.atlas.activeDestination !== 'black-hole') return 'at-other';
          return app.host.activeDestinationDebugSnapshot() === null ? 'preparing' : 'arrived';
        }),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
}

async function snapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot() ?? {});
}

async function setObserver(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((p) => {
    window.__ATLAS_APP__!.host.setDestinationControl('black-hole', {
      observer: p as Record<string, unknown>
    });
  }, patch);
  await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
}

test.describe('M10 relativistic observer modes', () => {
  test('legacy boot reports camera-mode observer with a valid readout', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    const snap = await snapshot(page);
    expect(snap['observerMode']).toBe('camera');
    const readout = snap['observerReadout'] as Record<string, unknown>;
    expect(readout).toBeTruthy();
    expect(readout['valid']).toBe(true);
    expect(readout['invalidReason']).toBeNull();
    expect(readout['radiusRg'] as number).toBeGreaterThan(2);
    expect(readout['betaMagnitude']).toBeCloseTo(0, 9);
    expect(errors).toEqual([]);
  });

  test('circular observer drives physical beta/gamma and deterministic proper time', async ({
    page
  }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await setObserver(page, {
      mode: 'circular',
      circularRadiusRg: 12,
      circularSense: 1,
      timeScale: 3
    });
    const snap = await snapshot(page);
    expect(snap['observerMode']).toBe('circular');
    const readout = snap['observerReadout'] as Record<string, unknown>;
    expect(readout['valid']).toBe(true);
    // Circular speed at r=12 (Schwarzschild) measured by static observers:
    // v = 1/sqrt(r-1) ~ 0.302 -> gamma ~ 1.048. Physical range assertions.
    const beta = readout['betaMagnitude'] as number;
    const gamma = readout['gammaFactor'] as number;
    expect(beta).toBeGreaterThan(0.2);
    expect(beta).toBeLessThan(0.5);
    expect(gamma).toBeGreaterThan(1);
    const tauA = readout['properTimeTau'] as number;
    await page.waitForTimeout(400);
    const tauB = ((await snapshot(page))['observerReadout'] as Record<string, unknown>)[
      'properTimeTau'
    ] as number;
    expect(tauB).toBeGreaterThan(tauA);
    expect(errors).toEqual([]);
  });

  test('pause freezes the worldline clock while rendering continues', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await setObserver(page, { mode: 'circular', circularRadiusRg: 12, timeScale: 3 });
    await page.evaluate(() => window.__ATLAS_APP__!.host.time.pause());
    const tauA = ((await snapshot(page))['observerReadout'] as Record<string, unknown>)[
      'properTimeTau'
    ] as number;
    await page.waitForTimeout(350);
    const tauB = ((await snapshot(page))['observerReadout'] as Record<string, unknown>)[
      'properTimeTau'
    ] as number;
    expect(tauB).toBeCloseTo(tauA, 6);
    expect(await page.evaluate(() => window.__ATLAS_APP__!.captureFrame())).not.toBeNull();
    await page.evaluate(() => window.__ATLAS_APP__!.host.time.play());
    expect(errors).toEqual([]);
  });

  test('freefall radius decreases along the physical worldline', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    await setObserver(page, { mode: 'freefall', freefallReleaseRadiusRg: 14, timeScale: 5 });
    const radiusAt = async (): Promise<number> =>
      ((await snapshot(page))['observerReadout'] as Record<string, unknown>)['radiusRg'] as number;
    const r0 = await radiusAt();
    // The clock may already have ticked a few frames before the first read.
    expect(r0).toBeGreaterThan(13);
    expect(r0).toBeLessThan(14.01);
    await page.waitForTimeout(1200);
    const r1 = await radiusAt();
    expect(r1).toBeLessThan(r0);
    expect(r1).toBeGreaterThan(2.05); // still outside the stop band early on
    expect(errors).toEqual([]);
  });

  test('unsupported freefall release inside the Kerr ergosphere reports truthfully', async ({
    page
  }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole?preset=kerr-moderate-prograde');
    await waitForArrival(page);
    await setObserver(page, { mode: 'freefall', freefallReleaseRadiusRg: 1.2 });
    const snap = await snapshot(page);
    expect(snap['metric']).toBe('kerr');
    const readout = (snap['observerReadout'] ?? {}) as Record<string, unknown>;
    expect(readout['valid']).toBe(false);
    expect(readout['invalidReason']).toBe('release-inside-ergosphere');
    expect(errors).toEqual([]);
  });

  test('rapid observer-mode switching stays bounded and console-clean', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/atlas/black-hole');
    await waitForArrival(page);
    for (const mode of ['static', 'circular', 'flyby', 'freefall', 'camera', 'static']) {
      await setObserver(page, { mode });
    }
    const inv = await page.evaluate(() => window.__ATLAS_APP__!.host.debugInventory());
    expect(inv['pendingPrepares']).toBe(0);
    expect(errors).toEqual([]);
  });
});
