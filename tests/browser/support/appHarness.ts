/**
 * Shared browser-test harness: app navigation with identity guard, runtime
 * status polling, error collection, and presented-frame pixel sampling.
 *
 * Frame evidence always comes from CLIPPED SCREENSHOTS decoded in-page:
 * direct canvas readback of a WebGPU canvas returns transparent black after
 * present, so it cannot be used as render evidence.
 */
import { expect, type Page } from '@playwright/test';

export interface StatusView {
  phase: string;
  backend: string;
  errorCode: string | null;
  internalWidth: number | null;
  internalHeight: number | null;
}

/**
 * Arrival/terminal-phase polling ceiling. On a hosted CI runner every scene
 * renders through software WebGL2 (SwiftShader/llvmpipe) with no GPU, so heavy
 * arrival transitions integrate far more slowly than on a real GPU — the app IS
 * arriving, just at a low frame rate that stretches the (correctly dt-clamped)
 * transition clock across many seconds. CI therefore gets a generous, honest
 * correctness ceiling (NEVER a performance claim); local/GPU runs stay tight to
 * keep real regressions fast to surface. This mirrors the 90s rationale already
 * documented in compatibility-matrix.spec.ts, centralized so every arrival poll
 * agrees. Override with ARRIVAL_TIMEOUT_MS for a specific environment.
 */
export const ARRIVAL_TIMEOUT_MS = ((): number => {
  const override = Number(process.env.ARRIVAL_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return override;
  // 180s in CI: measured cold arrival on a hosted 2-vCPU software-WebGL2 runner
  // is >10x a local GPU (the heaviest per-pixel shader, Kerr, is slowest to
  // compile), so this leaves comfortable headroom above the real ~30-90s while
  // still failing a genuinely stuck boot in bounded time.
  return process.env.CI ? 180_000 : 30_000;
})();

/** Navigates to the legacy M0 diagnostic app and asserts the served page is
 * THIS app before proceeding. The bare root now redirects to the atlas product
 * (`main.ts`), so this harness pins `?legacy=1` to keep exercising the cheap,
 * backend-agnostic legacy boot/fallback/unsupported surface (the hosted-CI
 * smoke target). `reuseExistingServer` only checks URL reachability, so a
 * foreign dev server on the e2e port would otherwise produce confusing
 * per-test timeouts. */
export async function gotoApp(page: Page, query = ''): Promise<void> {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  params.set('legacy', '1');
  await page.goto(`/?${params.toString()}`);
  await expect(
    page.locator('#scene'),
    'served page has no #scene — a foreign server is answering on the e2e port (set E2E_PORT)'
  ).toBeAttached({ timeout: 10_000 });
}

function parseStatus(raw: unknown): StatusView {
  if (typeof raw !== 'object' || raw === null) throw new Error('runtime status missing');
  const r = raw as Record<string, unknown>;
  return {
    phase: String(r['phase'] ?? ''),
    backend: String(r['backend'] ?? ''),
    errorCode: r['errorCode'] == null ? null : String(r['errorCode']),
    internalWidth: typeof r['internalWidth'] === 'number' ? r['internalWidth'] : null,
    internalHeight: typeof r['internalHeight'] === 'number' ? r['internalHeight'] : null
  };
}

export async function readStatus(page: Page): Promise<StatusView | null> {
  const raw: unknown = await page.evaluate(() => {
    const hooks = (window as unknown as Record<string, unknown>)['__BLACKHOLE_TEST__'];
    if (typeof hooks !== 'object' || hooks === null) return null;
    return (hooks as { getRuntimeStatus(): unknown }).getRuntimeStatus();
  });
  return raw === null ? null : parseStatus(raw);
}

export async function waitForTerminalPhase(
  page: Page,
  timeoutMs = ARRIVAL_TIMEOUT_MS
): Promise<StatusView> {
  const deadline = Date.now() + timeoutMs;
  // Hooks appear only after async renderer init; tolerate their absence while
  // polling and fail with evidence if the app never exposes them.
  let last: StatusView | null = null;
  while (Date.now() < deadline) {
    last = await readStatus(page);
    if (last && ['ready', 'unsupported', 'failed'].includes(last.phase)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`renderer did not reach a terminal phase; last=${JSON.stringify(last)}`);
}

export function collectErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  return { consoleErrors, pageErrors };
}

/** Takes a clipped screenshot of the canvas, base64-encoded for in-page decode. */
async function takeDecodedScreenshot(page: Page): Promise<{ dataUrl: string }> {
  const canvas = page.locator('#scene');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const shot = await page.screenshot({ clip: box });
  return { dataUrl: `data:image/png;base64,${shot.toString('base64')}` };
}

export interface PixelSampleView {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Samples a 5x5 grid from the PRESENTED frame via clipped screenshot. */
export async function sampleFrameViaScreenshot(page: Page): Promise<PixelSampleView[]> {
  const { dataUrl } = await takeDecodedScreenshot(page);
  const raw: unknown = await page.evaluate(async (src: string) => {
    const blob = await (await fetch(src)).blob();
    const bmp = await createImageBitmap(blob);
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, size, size);
    const out: { x: number; y: number; r: number; g: number; b: number; a: number }[] = [];
    for (let gy = 0; gy < 5; gy += 1) {
      for (let gx = 0; gx < 5; gx += 1) {
        const x = Math.floor(((gx + 0.5) / 5) * size);
        const y = Math.floor(((gy + 0.5) / 5) * size);
        const d = ctx.getImageData(x, y, 1, 1).data;
        out.push({ x, y, r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0, a: d[3] ?? 0 });
      }
    }
    return out;
  }, dataUrl);
  expect(Array.isArray(raw), 'frame sampling must return samples').toBe(true);
  return raw as PixelSampleView[];
}

/** Asserts the diagnostic gradient is actually rendered and oriented. */
export function expectDiagnosticVariance(samples: PixelSampleView[]): void {
  const distinct = new Set(samples.map((s) => `${s.r},${s.g},${s.b}`));
  expect(distinct.size, 'gradient should produce many distinct colors').toBeGreaterThan(8);
  const topLeft = samples[0];
  const bottomRight = samples[samples.length - 1];
  if (!topLeft || !bottomRight) throw new Error('missing corner samples');
  const dr = bottomRight.r - topLeft.r;
  // Red increases left->right across the whole grid, so opposite corners differ.
  expect(Math.abs(dr)).toBeGreaterThan(20);
}

export interface NdcPoint {
  x: number;
  y: number;
}

export interface NdcColorSample extends NdcPoint {
  r: number;
  g: number;
  b: number;
}

/**
 * Samples PRESENTED-frame sRGB colors at specific NDC points by decoding a
 * clipped screenshot at native resolution. NDC (+x right, +y up) maps onto
 * the screenshot rectangle linearly, matching src/shaders/cameraRayMath.ts
 * `pixelToNdc` inverted.
 */
export async function sampleColorsAtNdc(page: Page, points: NdcPoint[]): Promise<NdcColorSample[]> {
  const { dataUrl } = await takeDecodedScreenshot(page);
  const raw: unknown = await page.evaluate(
    async ({ src, pts }) => {
      const blob = await (await fetch(src)).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0);
      return pts.map((p) => {
        const px = Math.round(((p.x + 1) / 2) * (bmp.width - 1));
        const py = Math.round(((1 - p.y) / 2) * (bmp.height - 1));
        const d = ctx.getImageData(px, py, 1, 1).data;
        return { x: p.x, y: p.y, r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0 };
      });
    },
    { src: dataUrl, pts: points }
  );
  expect(Array.isArray(raw), 'NDC sampling must return samples').toBe(true);
  return raw as NdcColorSample[];
}

/**
 * Timeline-mutation helpers that wait on the ACTIVE DESTINATION actually
 * consuming a new coordinate.
 *
 * `TimeController.scrubTo` only mutates shared timeline state; a destination's
 * debug readout is written inside its `update()`, which runs on the next
 * rendered frame. A fixed `waitForTimeout` is therefore not a postcondition:
 * whenever a frame stalls longer than the sleep, the following snapshot still
 * reports the PREVIOUS scrub's state. That is not hypothetical — entering the
 * black-hole-merger `ringdown` phase makes the Kerr remnant subgraph visible
 * for the first time, and that first pipeline compile stalls the frame loop
 * for well over a second on slower/WebGL2-fallback hosts, so the final scrub
 * of a phase-ordering sweep could be read before it was ever applied (the
 * observed failure: the last expected phase never appears).
 *
 * `timeField` is the destination's own debug time readout (for example
 * `timeM` for black-hole-merger, `timeSeconds` for compact-merger).
 */
/** Reads the active destination's own debug time readout (null when absent). */
export async function readDestinationTime(page: Page, timeField: string): Promise<number | null> {
  return page.evaluate((field) => {
    const snap = window.__ATLAS_APP__?.host.activeDestinationDebugSnapshot() ?? {};
    const value = snap[field];
    return typeof value === 'number' ? value : null;
  }, timeField);
}

/**
 * Wait until the active destination has consumed the CURRENT shared timeline
 * coordinate, given the destination time readout captured immediately before
 * the mutation (`previous`, from {@link readDestinationTime}).
 *
 * Succeeds when the readout equals the shared physical coordinate, or — for
 * readouts a destination clamps into its own data support — when it has moved
 * off the pre-mutation value. Both clauses mean "a frame ran with the new
 * coordinate"; neither weakens what the caller then asserts.
 */
export async function awaitDestinationTimeApplied(
  page: Page,
  timeField: string,
  previous: number | null,
  timeoutMs = ARRIVAL_TIMEOUT_MS
): Promise<void> {
  await page.waitForFunction(
    ({ field, prev }) => {
      const host = window.__ATLAS_APP__?.host;
      if (host === undefined) return false;
      const snap = host.activeDestinationDebugSnapshot();
      if (snap === null) return false;
      const seen = snap[field];
      if (typeof seen !== 'number') return false;
      const shared = host.time.snapshot().physicalTime;
      if (typeof shared === 'number' && seen === shared) return true;
      return prev !== null && seen !== prev;
    },
    { field: timeField, prev: previous },
    { timeout: timeoutMs, polling: 50 }
  );
}

/** Pause + scrub, then await the destination consuming the new coordinate. */
export async function scrubAndAwaitDestination(
  page: Page,
  phase01: number,
  timeField: string,
  timeoutMs = ARRIVAL_TIMEOUT_MS
): Promise<void> {
  const previous = await readDestinationTime(page, timeField);
  await page.evaluate((phase) => {
    const host = window.__ATLAS_APP__!.host;
    host.time.pause();
    host.time.scrubTo(phase);
  }, phase01);
  await awaitDestinationTimeApplied(page, timeField, previous, timeoutMs);
}
