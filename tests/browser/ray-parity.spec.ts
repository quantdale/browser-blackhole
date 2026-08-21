import { expect, test } from '@playwright/test';
import { makeCameraRayDirection, type CameraRayParams } from '../../src/shaders/cameraRayMath.js';
import {
  collectErrors,
  gotoApp,
  sampleColorsAtNdc,
  waitForTerminalPhase,
  type NdcPoint
} from './support/appHarness.js';

/**
 * M1-01 CPU-vs-GPU selected-pixel parity (docs/MILESTONE_WORK_PACKETS.md).
 *
 * The GPU diagnostic pass maps the reconstructed camera-ray direction to
 * color as `dir * 0.5 + 0.5` in LINEAR space; three.js then applies the sRGB
 * OETF on output. This spec samples presented-frame pixels at known NDC
 * points and compares them against the CPU reference in
 * src/shaders/cameraRayMath.ts after applying the same encoding.
 */

/** IEC 61966-2-1 sRGB channel encoding (linear -> encoded). */
function encodeSrgb(linear: number): number {
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

interface BasisView {
  position: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
  tanHalfFovY: number;
  aspect: number;
}

async function readCameraBasis(page: { evaluate<T>(fn: () => T): Promise<T> }): Promise<BasisView> {
  return page.evaluate(() => {
    const hooks = (window as unknown as Record<string, unknown>)['__BLACKHOLE_TEST__'];
    if (typeof hooks !== 'object' || hooks === null) {
      throw new Error('test hooks missing');
    }
    return (hooks as { getCameraBasis(): BasisView }).getCameraBasis();
  });
}

test.describe('M1-01 CPU-vs-GPU ray parity', () => {
  test('presented colors match CPU ray reconstruction at sampled NDC points', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await gotoApp(page);
    const status = await waitForTerminalPhase(page);
    if (status.phase !== 'ready') test.skip(true, 'no usable backend in this environment');

    const basis = await readCameraBasis(page);
    const params: CameraRayParams = basis;

    // Center, edge midpoints, all four corners (kept off the exact frame edge
    // to avoid antialiased boundary pixels), and one asymmetric interior point.
    const points: NdcPoint[] = [
      { x: 0, y: 0 },
      { x: 0.9, y: 0 },
      { x: -0.9, y: 0 },
      { x: 0, y: 0.9 },
      { x: 0, y: -0.9 },
      { x: 0.85, y: 0.85 },
      { x: -0.85, y: 0.85 },
      { x: 0.85, y: -0.85 },
      { x: -0.85, y: -0.85 },
      { x: 0.37, y: -0.62 }
    ];

    const samples = await sampleColorsAtNdc(page, points);
    for (const s of samples) {
      const dir = makeCameraRayDirection(s.x, s.y, params).direction;
      const expected = [
        Math.round(encodeSrgb(dir[0] * 0.5 + 0.5) * 255),
        Math.round(encodeSrgb(dir[1] * 0.5 + 0.5) * 255),
        Math.round(encodeSrgb(dir[2] * 0.5 + 0.5) * 255)
      ];
      // Tolerance covers 8-bit quantization and the steep sRGB slope near
      // black (d(encoded)/d(linear) = 12.92 there).
      expect(Math.abs(s.r - (expected[0] ?? 0)), `r @ ndc(${s.x},${s.y})`).toBeLessThanOrEqual(4);
      expect(Math.abs(s.g - (expected[1] ?? 0)), `g @ ndc(${s.x},${s.y})`).toBeLessThanOrEqual(4);
      expect(Math.abs(s.b - (expected[2] ?? 0)), `b @ ndc(${s.x},${s.y})`).toBeLessThanOrEqual(4);
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
