import { expect, test, type Page } from '@playwright/test';

import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';
import './support/atlasHook.js';

/**
 * M11-03 renderer/device-loss recovery torture (Gate B/G).
 *
 * Deterministic fault injection through the kernel's PRODUCTION loss path
 * (`host.simulateDeviceLoss()` -> `notifyDeviceLoss` -> subscribers), not a
 * parallel fake state machine. Real GPU device loss cannot be triggered
 * reliably in headless CI; the injected fault exercises the identical
 * notify -> host terminal-state -> UI presentation chain.
 *
 * Locked product contract (M11): a lost device is TERMINAL for the session
 * with an explicit user-visible "reload required" state — never a misleading
 * READY, never a silent fake. Repeated injection must stay bounded (the
 * terminal state latches; listeners/resources do not grow).
 */

const REAL_ERROR_FILTER = /powerPreference|readback|Failed to load resource|GPU_DEVICE_LOST/;

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

/**
 * Terminal-surface helpers.
 *
 * The status line lives INSIDE `#panel`, which is collapsed (and made `inert`)
 * on a narrow viewport and rebuilt on every destination change. A message that
 * only exists there is unreachable exactly when the user most needs it, so the
 * terminal surface must live outside that subtree.
 */

/** Collapses the control drawer exactly as a keyboard user would. */
async function collapseControlPanel(page: Page): Promise<void> {
  const controlsToggle = page.getByRole('button', { name: 'Controls' });
  await expect(controlsToggle).toHaveAttribute('aria-expanded', 'true');
  await controlsToggle.focus();
  await page.keyboard.press('Enter');
  await expect(controlsToggle).toHaveAttribute('aria-expanded', 'false');
}

test.describe('M11-03 device-loss recovery', () => {
  test('injected device loss surfaces the explicit terminal reload state', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    const generationBefore = await page.evaluate(
      () => window.__ATLAS_APP__!.host.debugInventory().rendererGeneration
    );
    await page.evaluate(() => window.__ATLAS_APP__!.host.simulateDeviceLoss());
    await page.waitForTimeout(300);

    // Terminal, user-visible, truthful — on the app's error surface.
    await expect(page.locator('.atlas-status')).toContainText('GPU_DEVICE_LOST');
    await expect(page.locator('.atlas-status')).toContainText('reload the page');

    // The kernel latched the loss and the generation advanced exactly once.
    const state = await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host;
      return {
        generation: host.debugInventory().rendererGeneration,
        fatal: host.isFatalDeviceLoss
      };
    });
    expect(state.generation).toBe(generationBefore + 1);
    expect(state.fatal).toBe(true);
    expect(errors).toEqual([]);
  });

  test('repeated loss injection stays bounded: terminal state latches, generation advances once', async ({
    page
  }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    const generationBefore = await page.evaluate(
      () => window.__ATLAS_APP__!.host.debugInventory().rendererGeneration
    );
    for (let i = 0; i < 5; i += 1) {
      await page.evaluate(() => window.__ATLAS_APP__!.host.simulateDeviceLoss());
    }
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host;
      const inv = host.debugInventory();
      return {
        generation: inv.rendererGeneration,
        fatal: host.isFatalDeviceLoss,
        pending: inv.pendingPrepares
      };
    });
    // Deduplicated loss notification: one generation bump for the physical
    // loss event, latched terminal state, no pending prepare churn.
    expect(state.generation).toBe(generationBefore + 1);
    expect(state.fatal).toBe(true);
    expect(state.pending).toBe(0);
    await expect(page.locator('.atlas-status')).toContainText('GPU_DEVICE_LOST');
    expect(errors).toEqual([]);
  });

  test('navigation after device loss does not resurrect a dead renderer', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    await page.evaluate(() => window.__ATLAS_APP__!.host.simulateDeviceLoss());
    await page.waitForTimeout(200);
    // A user (or history echo) navigating after the terminal state must not
    // produce uncaught errors or clear the truthful status.
    await page.evaluate(() => window.__ATLAS_APP__!.host.navigate('diagnostic'));
    await page.waitForTimeout(500);
    await expect(page.locator('.atlas-status')).toContainText('GPU_DEVICE_LOST');
    expect(errors).toEqual([]);
  });
});

/**
 * atlas-terminal-state-visibility — a lost graphics device is session-terminal,
 * so its presentation must survive the circumstances that destroy an ordinary
 * status line: a collapsed panel (inert, off-canvas below 720px) and the panel
 * rebuild every destination change performs.
 */
test.describe('device-loss terminal surface', () => {
  test('device loss is perceivable with the control panel collapsed', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);

    await collapseControlPanel(page);
    await expect(page.locator('#panel')).toHaveAttribute('inert', '');

    await page.evaluate(() => window.__ATLAS_APP__!.host.simulateDeviceLoss());

    // The terminal card is outside #panel, so collapsing the drawer cannot hide
    // it — and it is not inside any inert subtree, so it stays in the a11y tree.
    const card = page.locator('.atlas-alert');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Graphics device was lost');
    // What happened and that the session cannot continue, in text.
    await expect(card).toContainText('cannot continue rendering');

    const placement = await page.evaluate(() => {
      const el = document.querySelector('.atlas-alert');
      const panel = document.getElementById('panel');
      let node = el?.parentElement ?? null;
      let inInertSubtree = false;
      while (node !== null) {
        if ((node as HTMLElement).inert === true) inInertSubtree = true;
        node = node.parentElement;
      }
      return {
        cardExists: el !== null,
        insidePanel: el !== null && panel !== null && el.closest('#panel') !== null,
        panelInert: panel?.inert === true,
        inInertSubtree
      };
    });
    expect(placement.cardExists).toBe(true);
    expect(placement.insidePanel).toBe(false);
    expect(placement.panelInert).toBe(true);
    expect(placement.inInertSubtree).toBe(false);

    // Reload is the recovery action, and it is keyboard-operable.
    const reload = page.getByRole('button', { name: 'Reload page' });
    await expect(reload).toBeVisible();
    await reload.focus();
    const focusInAlert = await page.evaluate(
      () => document.activeElement?.closest('.atlas-alert') !== null
    );
    expect(focusInAlert).toBe(true);

    // The panel status line still mirrors the fact, so the existing contract
    // holds — it is just no longer the only surface.
    await expect(page.locator('.atlas-status')).toContainText('GPU_DEVICE_LOST');
    expect(errors).toEqual([]);
  });

  test('device loss survives a panel rebuild and is not a destination retry', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);
    await page.evaluate(() => window.__ATLAS_APP__!.host.simulateDeviceLoss());
    const card = page.locator('.atlas-alert');
    await expect(card).toBeVisible({ timeout: 10_000 });

    // A destination change rebuilds nav + panel wholesale. The terminal surface
    // is created once, outside that path, so it must still be here afterwards.
    await page.evaluate(() => window.__ATLAS_APP__!.host.navigate('diagnostic'));
    await page.waitForTimeout(500);

    await expect(card).toBeVisible();
    await expect(card).toContainText('Graphics device was lost');
    // Terminal, not recoverable: the only action reloads, and there is no
    // destination retry and no dismiss affordance to abandon the explanation.
    await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);

    await expect(page.locator('.atlas-status')).toContainText('GPU_DEVICE_LOST');
    expect(errors).toEqual([]);
  });

  test('the terminal surface states the meaning in text and does not move the pinned chrome', async ({
    page
  }) => {
    const errors = collectErrors(page);
    await gotoAtlasBlackHole(page);

    const readChrome = async (): Promise<{ topbar: number; panel: number }> =>
      page.evaluate(() => {
        const root = document.querySelector('.atlas-shell') ?? document.body;
        const styles = getComputedStyle(root);
        return {
          topbar: Number.parseFloat(styles.getPropertyValue('--atlas-topbar-h')),
          panel: Number.parseFloat(styles.getPropertyValue('--atlas-panel-w'))
        };
      });

    const before = await readChrome();
    // The surface is absolutely positioned, so showing it cannot resize the
    // pinned chrome the visual-regression viewport depends on.
    await page.evaluate(() => window.__ATLAS_APP__!.host.simulateDeviceLoss());
    await expect(page.locator('.atlas-alert')).toBeVisible({ timeout: 10_000 });
    const after = await readChrome();

    expect(after.topbar).toBe(before.topbar);
    expect(after.panel).toBe(before.panel);

    // Not conveyed by colour alone: the whole meaning is in the card's text.
    const text = (await page.locator('.atlas-alert').innerText()).toLowerCase();
    expect(text).toContain('graphics device was lost');
    expect(text).toContain('reload');
    expect(errors).toEqual([]);
  });
});

/**
 * atlas-terminal-state-visibility §4 — the occluding-overlay question, settled
 * by MEASUREMENT rather than by changing overlay rendering.
 *
 * `renderOverlay` returns early when the renderer is gone, so the last valid
 * overlay texture is held and the presented frame freezes mid-transition. The
 * suspicion was that a loss during `outgoing`/`hyperspace` would leave that
 * held overlay as an unexplained full-screen occlusion hiding the terminal
 * surface.
 *
 * PROBE RESULT (recorded, both phases, msedge 1280x800): NOT reproduced. In both
 * phases the terminal card is the topmost element at its own centre, is outside
 * `#panel`, and is not inside an inert subtree. `destinationOccluded` was true
 * in `hyperspace` (the envelope is mathematically opaque there by design), yet
 * the still-presented frame underneath is occluded BY the card, not vice versa.
 * Overlay rendering was therefore left unchanged.
 *
 * These rows pin that negative result: if a later change buries the card under
 * the canvas or moves it into the panel, they fail.
 */
test.describe('device loss under an occluding transition', () => {
  for (const phase of ['outgoing', 'hyperspace'] as const) {
    test(`the terminal surface stays on top of the held overlay during ${phase}`, async ({
      page
    }) => {
      test.slow();
      const errors = collectErrors(page);
      await gotoAtlasBlackHole(page);

      // Start the transition, then watch the phase in-page on rAF and inject the
      // loss the instant the phase opens. The prepare step (a lazy chunk load)
      // precedes `outgoing`, so there is wide margin before the window opens and
      // no round-trip latency to let the phase advance past it.
      await page.evaluate(() => window.__ATLAS_APP__!.navigate('diagnostic'));
      const caught = await page.evaluate((target) => {
        const app = window.__ATLAS_APP__;
        if (!app) return 'no-app';
        const started = performance.now();
        return new Promise<string>((resolve) => {
          const step = (): void => {
            const t = app.host.state.atlas.transition;
            if (String(t.phase) === target) {
              app.host.simulateDeviceLoss();
              resolve(target);
              return;
            }
            if (performance.now() > started + 60_000) {
              resolve(`timeout@${String(t.phase)}`);
              return;
            }
            requestAnimationFrame(step);
          };
          step();
        });
      }, phase);
      expect(caught, `expected to catch the ${phase} phase`).toBe(phase);

      await page.waitForTimeout(700);

      // The card exists, is outside the panel's hiding subtree, and nothing is
      // drawn on top of it — which is exactly what "the overlay is not the only
      // content on screen" means for a DOM surface over a frozen canvas.
      const evidence = await page.evaluate(() => {
        const card = document.querySelector('.atlas-alert');
        const panel = document.getElementById('panel');
        const box = card?.getBoundingClientRect();
        const topmost =
          box === undefined || box === null
            ? null
            : (document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
                ?.className ?? null);
        let node = card?.parentElement ?? null;
        let inInert = false;
        while (node !== null) {
          if ((node as HTMLElement).inert === true) inInert = true;
          node = node.parentElement;
        }
        return {
          exists: card !== null,
          insidePanel: card !== null && panel !== null && card.closest('#panel') !== null,
          inInertSubtree: inInert,
          topmost
        };
      });

      expect(evidence.exists).toBe(true);
      expect(evidence.insidePanel).toBe(false);
      expect(evidence.inInertSubtree).toBe(false);
      expect(String(evidence.topmost)).toContain('atlas-alert');

      await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
      await expect(page.locator('.atlas-status')).toContainText('GPU_DEVICE_LOST');
      expect(errors).toEqual([]);
    });
  }
});
