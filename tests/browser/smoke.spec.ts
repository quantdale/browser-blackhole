import { expect, type Page, test } from '@playwright/test';

/**
 * M0 browser smoke (Gate B).
 *
 * These tests are backend-agnostic on purpose: headless environments often
 * lack WebGPU, so they assert READY-or-fallback status (or a useful terminal
 * unsupported state), positive canvas dimensions, a rendered diagnostic
 * frame, safe interaction/resize, and zero uncaught page/console errors.
 */

interface StatusView {
  phase: string;
  backend: string;
  errorCode: string | null;
  internalWidth: number | null;
  internalHeight: number | null;
}

interface PixelSampleView {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
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

async function readStatus(page: Page): Promise<StatusView | null> {
  const raw: unknown = await page.evaluate(() => {
    const hooks = (window as unknown as Record<string, unknown>)['__BLACKHOLE_TEST__'];
    if (typeof hooks !== 'object' || hooks === null) return null;
    return (hooks as { getRuntimeStatus(): unknown }).getRuntimeStatus();
  });
  return raw === null ? null : parseStatus(raw);
}

async function waitForTerminalPhase(page: Page, timeoutMs = 30_000): Promise<StatusView> {
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

function collectErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  return { consoleErrors, pageErrors };
}

/**
 * Samples a 5x5 pixel grid from the PRESENTED frame by taking a clipped
 * screenshot and decoding it inside the browser. This works for every
 * backend: direct canvas readback of a WebGPU canvas returns transparent
 * black after present, so it cannot be used as render evidence.
 */
async function sampleFrameViaScreenshot(page: Page): Promise<PixelSampleView[]> {
  const canvas = page.locator('#scene');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const shot = await page.screenshot({ clip: box });
  const dataUrl = `data:image/png;base64,${shot.toString('base64')}`;
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
function expectDiagnosticVariance(samples: PixelSampleView[]): void {
  const distinct = new Set(samples.map((s) => `${s.r},${s.g},${s.b}`));
  expect(distinct.size, 'gradient should produce many distinct colors').toBeGreaterThan(8);
  const topLeft = samples[0];
  const bottomRight = samples[samples.length - 1];
  if (!topLeft || !bottomRight) throw new Error('missing corner samples');
  const dr = bottomRight.r - topLeft.r;
  // Red increases left->right across the whole grid, so opposite corners differ.
  expect(Math.abs(dr)).toBeGreaterThan(20);
}

test.describe('M0 smoke', () => {
  test('boots to ready/fallback with valid canvas and clean console', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await page.goto('/');
    const status = await waitForTerminalPhase(page);

    if (status.phase === 'unsupported') {
      // Useful terminal unsupported state is acceptable per Gate B, but it
      // must be visible and explained, never a blank canvas.
      await expect(page.locator('.status-region')).toBeVisible();
      await expect(page.locator('.status-headline')).not.toHaveText('');
      return;
    }
    expect(status.phase, `errorCode=${status.errorCode ?? 'none'}`).toBe('ready');
    expect(['webgpu', 'webgl2']).toContain(status.backend);

    const dims = await page.evaluate(() => {
      const c = document.querySelector('#scene') as HTMLCanvasElement | null;
      return c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null;
    });
    expect(dims).not.toBeNull();
    expect(dims?.w).toBeGreaterThan(0);
    expect(dims?.h).toBeGreaterThan(0);
    expect(dims?.cw).toBeGreaterThan(0);
    expect(dims?.ch).toBeGreaterThan(0);

    expectDiagnosticVariance(await sampleFrameViaScreenshot(page));

    await page.screenshot({ path: 'artifacts/m0-diagnostic.png' });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('camera interaction does not throw and keeps rendering', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await page.goto('/');
    const status = await waitForTerminalPhase(page);
    if (status.phase !== 'ready') test.skip(true, 'no usable backend in this environment');

    const canvas = page.locator('#scene');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');

    // Orbit drag.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(box.x + box.width / 2 + i * 6, box.y + box.height / 2 + i * 3, {
        steps: 1
      });
    }
    await page.mouse.up();

    // Wheel zoom.
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(500);

    const uncaught: unknown = await page.evaluate(() => {
      const hooks = (window as unknown as Record<string, unknown>)['__BLACKHOLE_TEST__'];
      if (typeof hooks !== 'object' || hooks === null) return null;
      return (hooks as { getUncaughtErrors(): string[] }).getUncaughtErrors();
    });
    expect(uncaught).toEqual([]);
    expectDiagnosticVariance(await sampleFrameViaScreenshot(page));
    expect((await readStatus(page))?.phase).toBe('ready');
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('resize portrait/landscape keeps rendering without errors', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await page.goto('/');
    const status = await waitForTerminalPhase(page);
    if (status.phase !== 'ready') test.skip(true, 'no usable backend in this environment');

    for (const viewport of [
      { width: 480, height: 800 }, // portrait
      { width: 900, height: 500 } // landscape
    ]) {
      await page.setViewportSize(viewport);
      const deadline = Date.now() + 5_000;
      let internal: StatusView | null = null;
      while (Date.now() < deadline) {
        internal = await readStatus(page);
        if (
          internal?.internalWidth != null &&
          internal.internalHeight != null &&
          Math.abs(
            internal.internalWidth / internal.internalHeight - viewport.width / viewport.height
          ) < 0.05
        ) {
          break;
        }
        await page.waitForTimeout(200);
      }
      expect(internal?.internalWidth).toBeGreaterThan(0);
      expect(internal?.internalHeight).toBeGreaterThan(0);
      expectDiagnosticVariance(await sampleFrameViaScreenshot(page));
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
