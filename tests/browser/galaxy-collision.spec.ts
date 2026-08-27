import { expect, test, type Page } from '@playwright/test';

import './support/atlasHook.js';
import { ARRIVAL_TIMEOUT_MS, collectErrors } from './support/appHarness.js';

/**
 * CA9 — Galaxy Collision destination suite.
 *
 * Coverage map to openspec/changes/ca9-galaxy-collision/tasks.md:
 * - route boot reaches READY with the validated data-driven tracer cloud;
 * - no uncaught page/console errors on representative flows;
 * - tracer positions are interpolation-driven and time-dependent (scrubbing to
 *   two phases yields different finite probe positions);
 * - determinism: same phase twice yields identical probe positions;
 * - pause/scrub behaves deterministically;
 * - forced WebGL2 backend runs the same truthful data-driven path;
 * - repeated leave/re-enter cycles stay error-free (bounded resources).
 */

const BENIGN_ERROR = /powerPreference|readback|Failed to load resource|favicon|webgpu.*backend/i;

async function waitForArrival(page: Page, destId: string, presetId?: string): Promise<void> {
  await expect(page.locator('#scene'), 'served page has no #scene').toBeAttached({
    timeout: 10_000
  });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return app.host.state.atlas.activeDestination === undefined ? 'waiting' : 'arrived';
        }),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
  await expect
    .poll(() => page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activeDestination))
    .toBe(destId);
  if (presetId !== undefined) {
    await expect
      .poll(() =>
        page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activePreset || 'default')
      )
      .toBe(presetId);
  }
}

async function readDebugSnapshot(page: Page): Promise<Record<string, unknown>> {
  const raw: unknown = await page.evaluate(() =>
    window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot()
  );
  expect(raw, 'active destination debug snapshot must exist').toBeTruthy();
  return raw as Record<string, unknown>;
}

async function scrubTo(page: Page, phase01: number): Promise<void> {
  await page.evaluate((p) => {
    const h = window.__ATLAS_APP__!.host;
    h.time.pause();
    h.time.scrubTo(p);
  }, phase01);
  // Allow a couple of frames for interpolation to settle.
  await page.waitForTimeout(300);
}

type Vec3 = [number, number, number];

function asVec3(v: unknown): Vec3 {
  const a = v as number[];
  return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
}

function filteredErrors(errs: ReturnType<typeof collectErrors>): string[] {
  const { consoleErrors, pageErrors } = errs;
  return [...consoleErrors.filter((t) => !BENIGN_ERROR.test(t)), ...pageErrors];
}

test('direct route boots the Galaxy Collision destination into stable finite state', async ({
  page
}) => {
  const errs = collectErrors(page);
  await page.goto('/atlas/galaxy-collision?preset=encounter');
  await waitForArrival(page, 'galaxy-collision', 'encounter');
  await page.waitForTimeout(400);

  const snap = await readDebugSnapshot(page);
  expect(snap.assetId).toBe('gc1-nequal');
  expect(typeof snap.tracerCount).toBe('number');
  expect((snap.tracerCount as number) > 0).toBe(true);
  expect(typeof snap.keyframeCount).toBe('number');
  const p0 = asVec3(snap.probe0);
  expect(Number.isFinite(p0[0])).toBe(true);
  expect(Number.isFinite(p0[1])).toBe(true);
  expect(Number.isFinite(p0[2])).toBe(true);
  expect(filteredErrors(errs)).toEqual([]);
});

test('tracer positions are interpolation-driven and change with timeline phase', async ({
  page
}) => {
  const errs = collectErrors(page);
  await page.goto('/atlas/galaxy-collision?preset=encounter');
  await waitForArrival(page, 'galaxy-collision', 'encounter');

  await scrubTo(page, 0.0);
  const a = asVec3((await readDebugSnapshot(page)).probe0);
  await scrubTo(page, 0.5);
  const b = asVec3((await readDebugSnapshot(page)).probe0);

  expect(Number.isFinite(a[0]) && Number.isFinite(b[0])).toBe(true);
  // Phase 0 is far pre-pericenter; phase 0.5 is near/after pericenter — the
  // tracer cloud must have visibly evolved (not identical).
  const delta = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  expect(delta).toBeGreaterThan(1e-3);
  expect(filteredErrors(errs)).toEqual([]);
});

test('scrub to the same phase is deterministic', async ({ page }) => {
  const errs = collectErrors(page);
  await page.goto('/atlas/galaxy-collision?preset=bridge-tail');
  await waitForArrival(page, 'galaxy-collision', 'bridge-tail');

  await scrubTo(page, 0.5);
  const first = asVec3((await readDebugSnapshot(page)).probe1);
  await scrubTo(page, 0.2);
  await scrubTo(page, 0.5);
  const second = asVec3((await readDebugSnapshot(page)).probe1);

  expect(first[0]).toBeCloseTo(second[0], 6);
  expect(first[1]).toBeCloseTo(second[1], 6);
  expect(first[2]).toBeCloseTo(second[2], 6);
  expect(filteredErrors(errs)).toEqual([]);
});

test('forced WebGL2 backend runs the same truthful data-driven path', async ({ page }) => {
  const errs = collectErrors(page);
  await page.goto('/atlas/galaxy-collision?preset=encounter&backend=webgl2');
  await waitForArrival(page, 'galaxy-collision', 'encounter');
  await page.waitForTimeout(400);

  const snap = await readDebugSnapshot(page);
  expect(snap.assetId).toBe('gc1-nequal');
  expect(typeof snap.tracerCount).toBe('number');
  const p0 = asVec3(snap.probe0);
  expect(Number.isFinite(p0[0])).toBe(true);
  expect(filteredErrors(errs)).toEqual([]);
});

test('repeated leave/re-enter cycles stay error-free and bounded', async ({ page }) => {
  const errs = collectErrors(page);
  await page.goto('/atlas/galaxy-collision?preset=encounter');
  await waitForArrival(page, 'galaxy-collision', 'encounter');
  for (let i = 0; i < 3; i++) {
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');
    await page.goto('/atlas/galaxy-collision?preset=post-encounter');
    await waitForArrival(page, 'galaxy-collision', 'post-encounter');
    await page.waitForTimeout(200);
  }
  const snap = await readDebugSnapshot(page);
  expect(snap.assetId).toBe('gc1-nequal');
  expect(filteredErrors(errs)).toEqual([]);
});
