import { describe, expect, it } from 'vitest';

import { buildRenderSizeTelemetry } from '../../src/atlas/renderTelemetry.js';

/**
 * Quality-ladder-resolution-integrity tasks 1.2/5.1/5.2 — telemetry
 * truthfulness (A-03).
 *
 * The reported render scale must be the scale actually applied to the drawing
 * buffer (sampled from the renderer), not the tier's nominal scale, and the
 * report must be explicitly unknown before the first successful resize.
 *
 * `buildRenderSizeTelemetry` is the single assembly point host.runtimeTelemetry
 * uses for its `size` payload.
 */

describe('render size telemetry truthfulness (A-03)', () => {
  it('reports the scale applied to the buffer together with the live dimensions', () => {
    const report = buildRenderSizeTelemetry({ widthPx: 583, heightPx: 436 }, 0.6, 1);
    expect(report).toEqual({
      widthPx: 583,
      heightPx: 436,
      effectivePixels: 583 * 436,
      devicePixelRatio: 1,
      renderScale: 0.6
    });
  });

  it('reports null (unknown) before the first successful resize', () => {
    expect(buildRenderSizeTelemetry(null, null, 1)).toBeNull();
  });
});
