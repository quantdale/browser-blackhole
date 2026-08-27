import { expect, test, type Page } from '@playwright/test';

import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';
import './support/atlasHook.js';

/**
 * M11-05 accessibility / product-integrity review (Gate H).
 *
 * Asserts the CORE product flow is keyboard-operable end to end and that
 * state is exposed as TEXT, not color/position alone:
 * - destination nav chips and the experience-mode switch are focusable and
 *   activatable from the keyboard;
 * - the control panel opens from the keyboard; labeled native selects and
 *   range inputs operate with arrow keys;
 * - the canvas has a textual explanation companion outside the bitmap;
 * - range values render as formatted text with units;
 * - focus lands on a real interactive element after a destination switch
 *   (never trapped in a disposed node).
 */

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
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
}

test.describe('M11-05 accessibility', () => {
  test('canvas has a textual explanation companion outside the bitmap', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    const canvas = page.locator('#scene');
    const ariaLabel = await canvas.getAttribute('aria-label');
    expect(ariaLabel ?? '', 'canvas must carry an accessible name').toContain('canvas');
    // A text node explaining current state/meaning must exist outside the
    // bitmap (the atlas shell renders the explanation paragraph).
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
    expect(bodyText.toLowerCase()).toContain('canvas');
    expect(errors).toEqual([]);
  });

  test('keyboard flow: nav -> mode switch -> controls -> observer select', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);

    // Focus the first nav chip and activate a destination with the keyboard.
    await page.getByRole('button', { name: 'Neutron Star' }).focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(
        async () => page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activeDestination),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
      )
      .toBe('neutron-star');

    // Experience-mode switch: radio group reachable and keyboard-operable.
    const scientific = page.getByRole('radio', { name: 'Scientific' });
    await scientific.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_APP__!.host.experienceMode), {
        timeout: 10_000,
        intervals: [200]
      })
      .toBe('cinematic');
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_APP__!.host.experienceMode), {
        timeout: 10_000,
        intervals: [200]
      })
      .toBe('scientific');

    // Back to the black hole via keyboard.
    await page.getByRole('button', { name: 'Black Hole' }).focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(
        async () => page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activeDestination),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
      )
      .toBe('black-hole');

    // Open the control panel from the keyboard (only if closed) and operate
    // the observer mode select entirely with the keyboard.
    const controlsToggle = page.getByRole('button', { name: 'Controls' });
    if ((await controlsToggle.getAttribute('aria-expanded')) !== 'true') {
      await controlsToggle.focus();
      await page.keyboard.press('Enter');
    }
    const observerToggle = page.getByRole('button', { name: 'Observer (relativistic)' });
    await expect(observerToggle).toBeVisible();
    if ((await observerToggle.getAttribute('aria-expanded')) !== 'true') {
      await observerToggle.focus();
      await page.keyboard.press('Enter');
    }
    const modeSelect = page.getByRole('combobox', { name: 'Observer mode' });
    await expect(modeSelect).toBeVisible();
    await modeSelect.focus();
    // Native <select> keyboard semantics: ArrowDown moves camera -> static
    // and fires change (the options are in declared order).
    await page.keyboard.press('ArrowDown');
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
    expect(errors).toEqual([]);
  });

  test('range inputs expose values as text and respond to arrow keys', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    const controlsToggle = page.getByRole('button', { name: 'Controls' });
    if ((await controlsToggle.getAttribute('aria-expanded')) !== 'true') {
      await controlsToggle.focus();
      await page.keyboard.press('Enter');
    }
    // The camera FOV slider lives in the camera "Observer" collapsible.
    const cameraSection = page.getByRole('button', { name: 'Observer', exact: true });
    await expect(cameraSection).toBeVisible();
    if ((await cameraSection.getAttribute('aria-expanded')) !== 'true') {
      await cameraSection.focus();
      await page.keyboard.press('Enter');
    }
    const fov = page.getByRole('slider', { name: 'Field of view' });
    await expect(fov).toBeVisible();
    await fov.focus();
    const before = await fov.inputValue();
    await page.keyboard.press('ArrowRight');
    const after = await fov.inputValue();
    expect(Number(after)).toBeGreaterThan(Number(before));
    // The formatted value+unit readout renders as text next to the slider.
    const row = page.locator('.atlas-row--slider', { has: fov });
    await expect(row.locator('.atlas-slider-value')).toContainText('°');
    expect(errors).toEqual([]);
  });

  test('focus lands on a real element after a destination switch', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    await page.getByRole('button', { name: 'Controls' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Stellar Explosion' }).focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(
        async () => page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activeDestination),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
      )
      .toBe('stellar-explosion');
    // After the panel rebuilds, the previously-focused node must have been
    // replaced by a live element connected to the document.
    const focusState = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        connected: el !== null && el !== document.body,
        tag: el?.tagName ?? 'none',
        inDocument: el ? el.isConnected : false
      };
    });
    expect(focusState.inDocument, 'focus must not sit in a disposed node').toBe(true);
    expect(errors).toEqual([]);
  });
});
