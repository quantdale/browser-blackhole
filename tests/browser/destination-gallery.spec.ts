import { expect, test, type Page } from '@playwright/test';
import './support/atlasHook.js';
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';

async function boot(page: Page): Promise<void> {
  await page.goto('/atlas/black-hole');
  await expect(page.getByRole('button', { name: 'Explore', exact: true })).toBeEnabled({
    timeout: ARRIVAL_TIMEOUT_MS
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          return (
            app &&
            !app.host.state.atlas.transition.active &&
            app.host.activeDestinationDebugSnapshot() !== null
          );
        }),
      { timeout: ARRIVAL_TIMEOUT_MS }
    )
    .toBe(true);
}

test('initialization shows honest loading feedback until the registry is ready', async ({
  page
}) => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/blackHoleDescriptor-[^/]+\.js$/, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/atlas/black-hole', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.atlas-loading')).toBeVisible();
    await expect(page.locator('.atlas-loading')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.atlas-status')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Explore', exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole('button', { name: 'Explore', exact: true })).toBeEnabled({
      timeout: ARRIVAL_TIMEOUT_MS
    });
    await expect(page.locator('.atlas-loading')).toHaveCount(0);
  } finally {
    release();
  }
});

test('explorer filters, recovers from empty results, and restores keyboard focus', async ({
  page
}) => {
  await boot(page);
  const before = await page.evaluate(
    () => window.__ATLAS_APP__!.host.state.atlas.activeDestination
  );
  const trigger = page.getByRole('button', { name: 'Explore', exact: true });
  await trigger.click();
  const gallery = page.getByRole('dialog', { name: 'Where to next?' });
  await expect(gallery).toBeVisible();
  const search = gallery.getByRole('searchbox');
  await expect(search).toBeFocused();
  await expect(gallery.locator('.atlas-destination-card')).toHaveCount(8);
  await expect(
    gallery.getByRole('button', { name: 'Visit Black Hole', exact: true })
  ).toHaveAccessibleDescription(/curved spacetime.*direct/);
  await search.fill('data driven');
  await expect(gallery.locator('.atlas-destination-card')).toHaveCount(2);
  await search.fill('galaxy');
  await expect(gallery.locator('.atlas-destination-card')).toHaveCount(1);
  await search.fill('unfindable-destination');
  await expect(gallery.getByText('Uncharted territory.')).toBeVisible();
  await gallery.getByRole('button', { name: 'Show all destinations' }).click();
  await expect(gallery.locator('.atlas-destination-card')).toHaveCount(8);
  await search.fill('black');
  await page.keyboard.press('Escape');
  await expect(gallery).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activeDestination)).toBe(
    before
  );
});

test('gallery navigation uses the canonical route and selected destination', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Visit Galaxy Collision', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activeDestination), {
      timeout: ARRIVAL_TIMEOUT_MS
    })
    .toBe('galaxy-collision');
  await expect(page).toHaveURL(/\/atlas\/galaxy-collision/);
  await expect(page.locator('.atlas-panel-head-title')).toHaveText('Galaxy Collision');
  const active = page.locator('.atlas-nav-chip.is-active');
  await expect(active).toHaveText('Galaxy Collision');
  const chipBox = await active.boundingBox();
  const navBox = await page.locator('.atlas-nav').boundingBox();
  expect(chipBox!.x).toBeGreaterThanOrEqual(navBox!.x);
  expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width + 1);
});

test('inspector preserves the scientific render rectangle and collapsed semantics', async ({
  page
}) => {
  await boot(page);
  const rect = await page.locator('#viewport').boundingBox();
  await expect(page.locator('.atlas-loading')).toHaveCount(0);
  expect(rect!.width).toBeCloseTo(972.8125, 1);
  expect(rect!.height).toBe(727);
  expect(rect!.x).toBeCloseTo(307.1875, 1);
  const observer = page.getByRole('button', { name: 'Observer', exact: true });
  await expect(page.getByRole('slider', { name: 'Field of view' })).not.toBeVisible();
  await observer.click();
  await expect(page.getByRole('slider', { name: 'Field of view' })).toBeVisible();
  await observer.click();
  await expect(page.getByRole('slider', { name: 'Field of view' })).not.toBeVisible();
});

test('320px layout and explorer stay within the screen with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  const gallery = page.getByRole('dialog');
  const rect = await gallery.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(320);
  expect(await gallery.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await gallery.getByRole('searchbox').fill('neutron');
  await gallery.getByRole('button', { name: 'Visit Neutron Star' }).click();
  await expect(page).toHaveURL(/\/atlas\/neutron-star/, { timeout: ARRIVAL_TIMEOUT_MS });
});

test('coarse-pointer mode choices and compact actions retain touch targets', async ({
  browser,
  baseURL
}) => {
  if (baseURL === undefined) throw new Error('Gallery checks require a configured baseURL');
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 740 },
    hasTouch: true,
    reducedMotion: 'reduce'
  });
  try {
    const page = await context.newPage();
    await boot(page);
    const bar = await page.locator('.atlas-topbar').boundingBox();
    for (const target of await page
      .locator('.atlas-mode-option, .atlas-explore, .atlas-panel-toggle')
      .all()) {
      const rect = await target.boundingBox();
      expect(rect!.height).toBeGreaterThanOrEqual(40);
      expect(rect!.width).toBeGreaterThanOrEqual(40);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(bar!.y + bar!.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.getByRole('button', { name: 'Controls', exact: true }).tap();
    await expect(page.locator('#panel')).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Controls', exact: true }).tap();
    await expect(page.getByRole('combobox', { name: 'Scenario' })).toBeVisible();
  } finally {
    await context.close();
  }
});
