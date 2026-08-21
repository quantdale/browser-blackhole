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

/** Navigates and asserts the served page is THIS app before proceeding.
 * `reuseExistingServer` only checks URL reachability, so a foreign dev server
 * on the e2e port would otherwise produce confusing per-test timeouts. */
export async function gotoApp(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
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

export async function waitForTerminalPhase(page: Page, timeoutMs = 30_000): Promise<StatusView> {
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
