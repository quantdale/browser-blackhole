import type { RuntimeSizeTelemetry } from './types.js';

/**
 * Single assembly point for the `runtimeTelemetry().size` payload
 * (quality-ladder-resolution-integrity D3 / A-03).
 *
 * The reported `renderScale` is the scale the kernel actually applied to the
 * drawing buffer (sampled via `IRendererKernel.appliedRenderScale()`), never
 * the tier's nominal scale; dimensions come from the live drawing buffer.
 * Before the first successful resize both inputs are null and the report is
 * null — an explicit "not yet known", never a fabricated nominal value.
 */
export function buildRenderSizeTelemetry(
  size: { widthPx: number; heightPx: number } | null,
  appliedRenderScale: number | null,
  devicePixelRatio: number
): RuntimeSizeTelemetry | null {
  if (size === null || appliedRenderScale === null) return null;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    widthPx: size.widthPx,
    heightPx: size.heightPx,
    effectivePixels: size.widthPx * size.heightPx,
    devicePixelRatio: dpr,
    renderScale: appliedRenderScale
  };
}
