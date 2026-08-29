import { expect, test, type Page } from '@playwright/test';

// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import { ARRIVAL_TIMEOUT_MS } from './support/appHarness.js';

/**
 * Kerr terminal-class census across render backends (campaign §22 "check
 * dynamic-loop compiler behavior"; START_HERE "reject any win caused by
 * increased failure/MAX_STEPS").
 *
 * The §0 baseline measured the Kerr pass running roughly twice as fast under
 * WebGL2 as under WebGPU on the same adapter, resolution, tier and step
 * budget. A timing gap like that has two very different explanations, and
 * only one of them is a real performance finding:
 *
 *  1. the WebGPU codegen for this shader is genuinely worse — real, and worth
 *     chasing; or
 *  2. the WebGL2 path is executing FEWER loop iterations (different dynamic
 *     loop bound, earlier MAX_STEPS termination) — in which case it is a
 *     fidelity difference wearing a performance costume.
 *
 * Ray parity alone cannot settle this: it samples specific rays against the
 * CPU oracle, while a per-frame step-budget difference shows up only in the
 * aggregate. So this counts TERMINAL CLASSES over the whole frame, using the
 * `?kerrstatus` per-pixel classification view (OBSERVABILITY_DIAGNOSTICS
 * §8.1), and requires the two backends to agree.
 *
 * Measured 2026-08-28: identical to three decimal places on both backends,
 * which refuted (2) and established the timing gap as real. Keeping it as a
 * gate means a future optimization cannot buy speed by quietly capturing or
 * abandoning more rays on one backend.
 */

const PRESET = 'kerr-high-prograde';
/** Settle time for the arrival ease + first Kerr pipeline compile. */
const WARMUP_MS = 9000;

interface ClassCensus {
  total: number;
  capturedBlack: number;
  escapedCyan: number;
  maxStepsOrange: number;
  thetaWrapRed: number;
  poleYellow: number;
  otherMagenta: number;
  unclassified: number;
}

async function classCensus(page: Page, backend: 'webgpu' | 'webgl2'): Promise<ClassCensus> {
  await page.goto(`/atlas/black-hole?preset=${PRESET}&kerrstatus&backend=${backend}`);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return app.host.activeDestinationDebugSnapshot() === null ? 'preparing' : 'arrived';
        }),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [500] }
    )
    .toBe('arrived');

  // Pin the tier so the step budget is identical on both runs; freeze time so
  // the classification describes one deterministic camera/ray set.
  await page.evaluate(() => {
    const host = window.__ATLAS_APP__!.host;
    host.governor.setForcedTier('medium');
    host.time.pause();
    // Classify the raw diagnostic colors, not a user display profile. The
    // cinematic overhaul makes Scientific's default bloom-off state explicit;
    // this census must remain invariant to exposure/bloom/tone-map settings.
    host.post.setBloom(false, 0);
    host.post.setExposure(1);
    host.post.setToneMapping('linear');
  });
  await page.waitForTimeout(WARMUP_MS);

  const shot = (await page.locator('#viewport').screenshot()).toString('base64');
  return page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('2d context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    bitmap.close();

    const out = {
      total: 0,
      capturedBlack: 0,
      escapedCyan: 0,
      maxStepsOrange: 0,
      thetaWrapRed: 0,
      poleYellow: 0,
      otherMagenta: 0,
      unclassified: 0
    };
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      out.total += 1;
      if (r < 40 && g < 40 && b < 40) out.capturedBlack += 1;
      else if (r < 80 && g > 150 && b > 150) out.escapedCyan += 1;
      else if (r > 180 && g > 90 && g < 190 && b < 80) out.maxStepsOrange += 1;
      else if (r > 180 && g < 80 && b < 80) out.thetaWrapRed += 1;
      else if (r > 180 && g > 180 && b < 90) out.poleYellow += 1;
      else if (r > 120 && g < 90 && b > 120) out.otherMagenta += 1;
      else out.unclassified += 1;
    }
    return out;
  }, shot);
}

test.describe('Kerr terminal-class census across backends (§22)', () => {
  test('WebGPU and WebGL2 classify the same rays the same way', async ({ page }) => {
    test.setTimeout(180_000);

    const webgpu = await classCensus(page, 'webgpu');
    const webgl2 = await classCensus(page, 'webgl2');

    expect(webgpu.total).toBe(webgl2.total);
    expect(webgpu.total).toBeGreaterThan(100_000);

    // Tolerance is in FRACTION OF FRAME, not relative to the class count: the
    // classes that matter most here (max-steps, the non-finite reasons) are
    // rare by design, so a relative tolerance would be meaningless on them.
    // 0.05% of the frame is far tighter than the ~2x timing gap this exists
    // to explain, and far looser than the observed agreement (identical to
    // three decimal places when this was written).
    const tolerance = 0.0005;
    const keys = [
      'capturedBlack',
      'escapedCyan',
      'maxStepsOrange',
      'thetaWrapRed',
      'poleYellow',
      'otherMagenta',
      'unclassified'
    ] as const;

    for (const key of keys) {
      const a = webgpu[key] / webgpu.total;
      const b = webgl2[key] / webgl2.total;
      expect(
        Math.abs(a - b),
        `${key}: webgpu ${(a * 100).toFixed(3)}% vs webgl2 ${(b * 100).toFixed(3)}% — ` +
          'a backend-dependent terminal-class split means a speed difference ' +
          'between these two paths is a FIDELITY difference, not a win'
      ).toBeLessThan(tolerance);
    }
  });
});
