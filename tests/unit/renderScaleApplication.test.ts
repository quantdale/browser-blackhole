import { describe, expect, it } from 'vitest';

import type { IPerformanceGovernor, RendererLike } from '../../src/atlas/types.js';
import { ResourceScope } from '../../src/renderer/shared/ResourceScope.js';
import { SharedPost } from '../../src/renderer/shared/SharedPost.js';
import {
  SharedRendererKernel,
  type SharedRendererKernelOptions
} from '../../src/renderer/SharedRendererKernel.js';

/**
 * Quality-ladder-resolution-integrity tasks 1.1/2.4 — render scale applied
 * exactly once.
 *
 * Spec contract: at a non-unity render scale the HDR render target's
 * dimensions must equal the drawing buffer's dimensions AND both must equal
 * `floor(cssSize * effectiveDpr * renderScale)`. Equality alone is explicitly
 * not sufficient (both could be scaled twice), so the formula is asserted.
 *
 * The test drives the REAL SharedRendererKernel against a REAL SharedPost
 * (node-safe: ResourceScope + structural renderer stubs, same pattern as
 * temporalService.test), so the HDR dimension read below is the actual
 * allocated target, not a simulation of SharedPost's arithmetic.
 *
 * Pre-fix wiring (SharedRendererKernel.handleResize) folds the scale into the
 * pixel ratio, computes the post dimensions from that already-scaled ratio,
 * and passes the scale AGAIN to SharedPost.ensureSize, which multiplies a
 * second time (SharedPost.ts:173-175): HDR lands at css*dpr*scale^2 while the
 * drawing buffer sits at css*dpr*scale.
 */

const CSS_WIDTH = 973;
const CSS_HEIGHT = 727;
/** Node environment: no `window` → readDevicePixelRatio() = 1. */
const EFFECTIVE_DPR = 1;

type SizeTarget = {
  x: number;
  y: number;
  set(x: number, y: number): SizeTarget;
  floor(): SizeTarget;
};

function fakePostRenderer(): RendererLike {
  return {
    getRenderTarget: () => null,
    setRenderTarget: () => undefined,
    render: () => undefined
  } as unknown as RendererLike;
}

function fakeKernelRenderer(): RendererLike {
  let cssW = 0;
  let cssH = 0;
  let pixelRatio = 1;
  return {
    setSize: (width: number, height: number): void => {
      cssW = width;
      cssH = height;
    },
    setPixelRatio: (ratio: number): void => {
      pixelRatio = ratio;
    },
    // Mirrors three's WebGLRenderer.getDrawingBufferSize: floor(css * ratio).
    getDrawingBufferSize: (target: SizeTarget): SizeTarget =>
      target.set(Math.floor(cssW * pixelRatio), Math.floor(cssH * pixelRatio)).floor()
  } as unknown as RendererLike;
}

function buildKernelWithPost(): { kernel: SharedRendererKernel; post: SharedPost } {
  const post = new SharedPost({
    renderer: fakePostRenderer(),
    scope: new ResourceScope('render-scale-test')
  });
  const options: SharedRendererKernelOptions = {
    governor: {} as unknown as IPerformanceGovernor,
    post,
    getTimeInfo: () => ({}) as never,
    getQuality: () => 'high' as never,
    dprCap: 2
  };
  const kernel = new SharedRendererKernel(options);
  (kernel as unknown as { rendererValue: RendererLike | null }).rendererValue =
    fakeKernelRenderer();
  return { kernel, post };
}

function hdrSize(post: SharedPost): { width: number; height: number } {
  const target = (post as unknown as { hdrTarget: { width: number; height: number } | null })
    .hdrTarget;
  if (target === null) throw new Error('HDR target was never allocated');
  return target;
}

describe('render scale applied exactly once (A-04)', () => {
  for (const scale of [0.6, 0.8] as const) {
    it(`HDR target and drawing buffer both equal floor(css * effDpr * ${scale})`, () => {
      const { kernel, post } = buildKernelWithPost();
      kernel.handleResize(CSS_WIDTH, CSS_HEIGHT, scale);

      const expectedWidth = Math.floor(CSS_WIDTH * EFFECTIVE_DPR * scale);
      const expectedHeight = Math.floor(CSS_HEIGHT * EFFECTIVE_DPR * scale);

      const buffer = kernel.effectiveSize();
      if (buffer === null) {
        throw new Error('kernel must report a drawing-buffer size after resize');
      }
      expect(buffer).toEqual({ widthPx: expectedWidth, heightPx: expectedHeight });

      const hdr = hdrSize(post);
      expect(hdr.width, 'HDR width must follow the documented formula').toBe(expectedWidth);
      expect(hdr.height, 'HDR height must follow the documented formula').toBe(expectedHeight);
      // Equality AND formula — the spec requires both, in this order of intent.
      expect({ width: hdr.width, height: hdr.height }).toEqual({
        width: buffer.widthPx,
        height: buffer.heightPx
      });
    });
  }
});
