import { expect, test, type Page } from '@playwright/test';

import './support/atlasHook.js';
import {
  ARRIVAL_TIMEOUT_MS,
  collectErrors,
  expectPresentedMotion,
  measurePresentedMotion
} from './support/appHarness.js';

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
 * - repeated leave/re-enter cycles stay error-free (bounded resources);
 * - the encounter ACTUALLY PLAYS: the presented image evolves on its own and
 *   the timeline is paced in wall-clock seconds and loops (phenomena-animation
 *   campaign). Before that campaign this destination registered no phase
 *   mapping at all, so the shared identity mapping ran 0->1 in one second and
 *   held there: every assertion above passed against a permanently frozen
 *   final keyframe.
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

test('the encounter plays on its own: the presented image evolves while running', async ({
  page
}) => {
  const errs = collectErrors(page);
  await page.goto('/atlas/galaxy-collision');
  await waitForArrival(page, 'galaxy-collision');

  const motion = await measurePresentedMotion(page, { captures: 4, framesBetween: 24 });
  expectPresentedMotion(motion, { label: 'galaxy-collision' });
  expect(filteredErrors(errs)).toEqual([]);
});

test('timeline is paced in wall-clock seconds and loops instead of holding', async ({ page }) => {
  const errs = collectErrors(page);
  await page.goto('/atlas/galaxy-collision');
  await waitForArrival(page, 'galaxy-collision');

  const snap = await page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot());
  // GC1 spans 120 model-time units; a paced mapping advances many units per
  // wall second, and an unpaced one exactly 1 (the legacy identity behavior
  // that made the scene freeze one second after arrival).
  expect(snap.basePlaybackRate, 'timeline must declare a wall-clock pace').toBeGreaterThan(1);
  expect(snap.loop, 'a finite encounter must loop rather than hold on its last frame').toBe(true);
  expect(snap.paused).toBe(false);

  // Play past the end of the window and confirm it wrapped rather than pinned.
  await page.evaluate(() => {
    const h = window.__ATLAS_APP__!.host;
    h.time.scrubTo(0.995);
    h.time.play();
  });
  await expect
    .poll(() => page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot().simulationPhase), {
      timeout: 20_000,
      intervals: [200]
    })
    .toBeLessThan(0.9);
  expect(filteredErrors(errs)).toEqual([]);
});
