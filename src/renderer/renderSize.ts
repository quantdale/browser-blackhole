/**
 * Internal render size calculation (M0-06).
 *
 * Pure policy so it is unit-testable: effective DPR is the native DPR capped
 * by `maxEffectiveDpr`, scaled by `renderScale`; internal pixels are CSS size
 * times effective DPR, never below 1x1. Non-positive or non-finite viewport
 * sizes return null so callers defer resizing instead of allocating zero-size
 * surfaces (docs/FAILURE_RECOVERY.md section 14).
 */

export interface ViewportSize {
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
}

export interface RenderSizePolicy {
  renderScale: number;
  maxEffectiveDpr: number;
}

export interface InternalRenderSize {
  cssWidth: number;
  cssHeight: number;
  effectiveDpr: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeInternalRenderSize(
  viewport: ViewportSize,
  policy: RenderSizePolicy
): InternalRenderSize | null {
  const { cssWidth, cssHeight } = viewport;
  if (
    !Number.isFinite(cssWidth) ||
    !Number.isFinite(cssHeight) ||
    cssWidth <= 0 ||
    cssHeight <= 0
  ) {
    return null;
  }
  const nativeDpr =
    Number.isFinite(viewport.devicePixelRatio) && viewport.devicePixelRatio > 0
      ? viewport.devicePixelRatio
      : 1;
  const cappedDpr = clamp(nativeDpr, 0.5, policy.maxEffectiveDpr);
  const scale = clamp(policy.renderScale, 0.25, 2);
  const effectiveDpr = cappedDpr * scale;
  return {
    cssWidth,
    cssHeight,
    effectiveDpr,
    width: Math.max(1, Math.round(cssWidth * effectiveDpr)),
    height: Math.max(1, Math.round(cssHeight * effectiveDpr))
  };
}
