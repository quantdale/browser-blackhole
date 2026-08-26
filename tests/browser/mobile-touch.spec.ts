import { expect, test, type Page } from '@playwright/test';

import './support/atlasHook.js';

/**
 * M11-02 mobile / touch / responsive / DPR hardening (Gate F/H).
 *
 * Device-EMULATED coverage: portrait/landscape flips, high-DPR internal
 * pixel cap, touch-era pointer interaction, and control operability without
 * hover. This suite executes on the desktop GPU stack — it makes NO mobile
 * performance or real-device GPU claim (docs/COMPATIBILITY_MATRIX.md).
 */

const REAL_ERROR_FILTER = /powerPreference|readback|Failed to load resource/;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !REAL_ERROR_FILTER.test(m.text())) {
      errors.push(`console: ${m.text().slice(0, 200)}`);
    }
  });
  return errors;
}

async function gotoAtlasBlackHole(page: Page): Promise<void> {
  await page.goto('/atlas/black-hole');
  await expect(
    page.locator('#scene'),
    'served page has no #scene — a foreign server is answering on the e2e port (set E2E_PORT)'
  ).toBeAttached({ timeout: 10_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return app.host.activeDestinationDebugSnapshot() === null ? 'preparing' : 'arrived';
        }),
      { timeout: 60_000, intervals: [250] }
    )
    .toBe('arrived');
}

interface InventoryView {
  internal: [number, number];
  dpr: number;
  renderScale: number;
}

async function inventory(page: Page): Promise<InventoryView> {
  return page.evaluate(() => {
    const app = window.__ATLAS_APP__;
    const inv = app!.host.debugInventory();
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    return {
      internal: [canvas.width, canvas.height] as [number, number],
      dpr: window.devicePixelRatio,
      renderScale: app!.host.renderScaleOverride ?? inv.governor.renderScale
    };
  });
}

test.describe('M11-02 mobile/touch/DPR hardening', () => {
  test.describe.configure({ mode: 'serial' });

  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3 });

  test('portrait high-DPR boot: ready, capped internal pixels, clean console', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    const inv = await inventory(page);
    expect(inv.dpr).toBe(3);
    // Locked pixel-density cap (maxEffectiveDpr = 2): a 3x device must never
    // allocate 3x internal pixels.
    expect(inv.internal[0]).toBeLessThanOrEqual(390 * 2 + 1);
    expect(inv.internal[1]).toBeLessThanOrEqual(844 * 2 + 1);
    expect(inv.internal[0]).toBeGreaterThan(0);
    expect(inv.internal[1]).toBeGreaterThan(0);
    await expect(page.locator('.atlas-status')).toHaveText('Atlas ready');
    const samples = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    expect(new Set(samples!).size, 'presented frame should not be uniform').toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });

  test('orientation flip while active keeps rendering with a tracking aspect', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    await page.setViewportSize({ width: 844, height: 390 });
    // The canvas tracks its #viewport ELEMENT (which shares space with the
    // control panel in landscape), not the raw window.
    await expect
      .poll(
        async () => {
          const inv = await inventory(page);
          const rect = await page.locator('#viewport').boundingBox();
          if (!rect || rect.width < 1 || rect.height < 1) return false;
          return Math.abs(inv.internal[0] / inv.internal[1] - rect.width / rect.height) < 0.05;
        },
        { timeout: 10_000, intervals: [250] }
      )
      .toBe(true);
    const samples = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    expect(new Set(samples!).size).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });

  test('narrow-viewport recovery after a tiny-viewport excursion', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    await page.setViewportSize({ width: 200, height: 300 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(
        async () => {
          const inv = await inventory(page);
          return inv.internal[0] > 0 && inv.internal[1] > 0;
        },
        { timeout: 10_000, intervals: [250] }
      )
      .toBe(true);
    const samples = await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    expect(new Set(samples!).size).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });

  test('canvas drag orbits the view and the drag never scrolls the page', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    const before = await page.evaluate(() => {
      const c = window.__ATLAS_APP__!.host.camera.position;
      return { x: c.x, y: c.y, z: c.z, scrollY: window.scrollY };
    });
    const box = await page.locator('#scene').boundingBox();
    if (!box) throw new Error('canvas has no bounding box');
    // Mobile layout: the control panel docks as a bottom sheet over the
    // canvas's lower portion; the exposed upper region is the drag surface.
    const dragY = box.y + box.height * 0.25;
    // Pointer drag (mouse pointer class drives the same pointer-event path a
    // touch pointer produces after conversion).
    await page.mouse.move(box.x + box.width / 2, dragY);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) {
      await page.mouse.move(box.x + box.width / 2 + i * 8, dragY + i * 4);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const c = window.__ATLAS_APP__!.host.camera.position;
      return { x: c.x, y: c.y, z: c.z, scrollY: window.scrollY };
    });
    const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    expect(moved, 'camera should respond to pointer drag').toBeGreaterThan(0.01);
    // The canvas drag must not scroll the page (no gesture trapping either way).
    expect(after.scrollY).toBe(before.scrollY);
    expect(errors).toEqual([]);
  });

  test('control panel is operable without hover: observer mode via tap/select', async ({
    page
  }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    await page.evaluate(() => window.__ATLAS_APP__!.captureFrame());
    // Open the controls panel (tap-equivalent click), then the observer
    // section, then change the mode through the select — the production
    // control channel must reflect it in canonical state.
    await page.getByRole('button', { name: 'Controls' }).tap();
    const observerSection = page.getByRole('button', { name: 'Observer (relativistic)' });
    if ((await observerSection.getAttribute('aria-expanded')) !== 'true') {
      await observerSection.tap();
    }
    const modeSelect = page.getByRole('combobox', { name: 'Observer mode' });
    await expect(modeSelect).toBeVisible();
    await modeSelect.selectOption('static');
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const state = window.__ATLAS_APP__!.host.state.destinations['black-hole']?.state as
              Record<string, unknown> | undefined;
            const obs = state?.['observer'] as Record<string, unknown> | undefined;
            return String(obs?.['mode'] ?? 'camera');
          }),
        { timeout: 10_000, intervals: [200] }
      )
      .toBe('static');
    // Restore camera mode so the serial chain leaves a neutral state.
    await modeSelect.selectOption('camera');
    expect(errors).toEqual([]);
  });
});
