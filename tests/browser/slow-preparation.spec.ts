import { expect, test, type Page } from '@playwright/test';

import './support/atlasHook.js';
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';

/**
 * atlas-terminal-state-visibility — a slow destination open.
 *
 * The director already emitted `slow-load` and nothing rendered it, so the user
 * got no "still opening" state before a hang became a failure. These rows pin
 * the user-visible half: the notice names the destination, is perceivable with
 * the panel collapsed, never claims a failure, and does not outlive the attempt
 * it describes.
 *
 * The slowness is produced the same way the transition-failure rows produce
 * failures — through the HTTP layer (a delayed lazy chunk), which is exactly the
 * production condition (a slow network, a cold cache). No product code is
 * patched, and no director internals are poked.
 */

/** Wall-clock name of the delayed lazy chunk for one destination. */
const GALAXY_COLLISION_CHUNK = '**/galaxyCollisionModule-*.js';

/** Holds `route.continue()` past an abort so a superseded attempt is silent. */
async function holdRoute(page: Page, pattern: string, holdMs: number): Promise<void> {
  await page.route(pattern, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    try {
      await route.continue();
    } catch {
      // The request was already aborted (a newer navigation superseded it).
    }
  });
}

/** Collapses the control drawer exactly as a keyboard user would. */
async function collapseControlPanel(page: Page): Promise<void> {
  const controlsToggle = page.getByRole('button', { name: 'Controls' });
  await expect(controlsToggle).toHaveAttribute('aria-expanded', 'true');
  await controlsToggle.focus();
  await page.keyboard.press('Enter');
  await expect(controlsToggle).toHaveAttribute('aria-expanded', 'false');
}

async function gotoAtlasBlackHole(page: Page): Promise<void> {
  await page.goto('/atlas/black-hole');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          const t = app.host.state.atlas.transition;
          if (t.active) return 'transitioning';
          return app.host.state.atlas.activeDestination === 'black-hole'
            ? 'arrived'
            : `at:${app.host.state.atlas.activeDestination}`;
        }),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
}

/**
 * Records every text the notice region ever shows, with a marker appended on
 * demand. Used to prove the notice stops naming a superseded destination
 * instead of merely asserting that it is hidden at one sampled instant.
 */
async function startRecordingNotice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const recorder: string[] =
      ((window as unknown as Record<string, unknown>)['__SLOWPREP_LOG'] as string[] | undefined) ??
      [];
    (window as unknown as Record<string, unknown>)['__SLOWPREP_LOG'] = recorder;
    const region = document.querySelector('.atlas-slowprep');
    if (region === null) return;
    new MutationObserver(() => {
      const el = document.querySelector('.atlas-slowprep');
      if (el !== null && !el.hasAttribute('hidden')) recorder.push(el.textContent ?? '');
    }).observe(region, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden']
    });
  });
}

async function readNoticeLog(page: Page): Promise<string[]> {
  return page.evaluate(
    () => ((window as unknown as Record<string, unknown>)['__SLOWPREP_LOG'] as string[]) ?? []
  );
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !/powerPreference|readback|Failed to load resource/.test(text)) {
      errors.push(`console: ${text.slice(0, 160)}`);
    }
  });
  return errors;
}

test.describe('slow-preparation notice', () => {
  test('a slow open is announced without claiming the destination failed', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    // 3.5s of chunk hold: comfortably past the 900ms slow-load threshold and far
    // short of the 9s stall window, so this is a SLOW open, not a stalled one.
    await holdRoute(page, GALAXY_COLLISION_CHUNK, 3500);
    await startRecordingNotice(page);
    await collapseControlPanel(page);

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('galaxy-collision'));

    const notice = page.locator('.atlas-slowprep');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    // It names the destination being opened — not a spinner, not a countdown.
    await expect(notice).toContainText('Galaxy Collision');
    // Elapsed waiting SHALL NOT by itself be presented as a failure.
    await expect(notice).not.toContainText(/fail|could not|cannot|error/i);

    // A different thing from an error, so it uses the polite channel and does
    // not raise the assertive failure banner.
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(page.locator('.atlas-alert-region')).toBeHidden();

    // Outside #panel, so a collapsed (and inert) drawer cannot hide it.
    const placement = await page.evaluate(() => {
      const el = document.querySelector('.atlas-slowprep');
      const panel = document.getElementById('panel');
      let node = el?.parentElement ?? null;
      let inInertSubtree = false;
      while (node !== null) {
        if ((node as HTMLElement).inert === true) inInertSubtree = true;
        node = node.parentElement;
      }
      return {
        exists: el !== null,
        insidePanel: el !== null && panel !== null && el.closest('#panel') !== null,
        panelInert: panel?.inert === true,
        inInertSubtree
      };
    });
    expect(placement.exists).toBe(true);
    expect(placement.insidePanel).toBe(false);
    expect(placement.panelInert).toBe(true);
    expect(placement.inInertSubtree).toBe(false);

    // The previous destination stays available: nothing has been torn down.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const inv = window.__ATLAS_APP__!.host.debugInventory();
            return inv.activeDestinationId;
          }),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
      )
      .toBe('black-hole');

    expect(errors).toEqual([]);
  });

  test('the notice is cleared when the destination becomes interactive', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    await holdRoute(page, GALAXY_COLLISION_CHUNK, 3000);
    await collapseControlPanel(page);

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('galaxy-collision'));
    await expect(page.locator('.atlas-slowprep')).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = window.__ATLAS_APP__!;
            const t = app.host.state.atlas.transition;
            if (t.active) return 'transitioning';
            return app.host.state.atlas.activeDestination === 'galaxy-collision' ? 'arrived' : 'at';
          }),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
      )
      .toBe('arrived');

    // Interactive: "still opening" would be a lie, so the notice goes away.
    await expect(page.locator('.atlas-slowprep')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('a newer request takes the notice over from the superseded destination', async ({
    page
  }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    await holdRoute(page, GALAXY_COLLISION_CHUNK, 4000);
    await startRecordingNotice(page);

    await page.evaluate(() => window.__ATLAS_APP__!.navigate('galaxy-collision'));
    await expect(page.locator('.atlas-slowprep')).toContainText('Galaxy Collision', {
      timeout: 20_000
    });

    // Retarget while the first open is still slow. From here on the notice must
    // either follow the newer request or stay hidden — it must never keep
    // naming the destination the user is no longer going to.
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>)['__SLOWPREP_LOG'] as string[]).push(
        '__RETARGET__'
      );
      window.__ATLAS_APP__!.navigate('compact-merger');
    });

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = window.__ATLAS_APP__!;
            const t = app.host.state.atlas.transition;
            if (t.active) return 'transitioning';
            return app.host.state.atlas.activeDestination === 'compact-merger'
              ? 'arrived'
              : `at:${app.host.state.atlas.activeDestination}`;
          }),
        { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
      )
      .toBe('arrived');

    await expect(page.locator('.atlas-slowprep')).toBeHidden();
    const log = await readNoticeLog(page);
    const afterRetarget = log.slice(log.indexOf('__RETARGET__') + 1);
    expect(
      afterRetarget.filter((entry) => entry !== '' && entry.includes('Galaxy Collision')),
      `notice kept naming the superseded destination: ${JSON.stringify(log)}`
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
});
