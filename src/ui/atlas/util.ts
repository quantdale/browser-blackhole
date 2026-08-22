/**
 * Pure helpers for the Atlas UI kit — no DOM, no three.js, unit-testable.
 *
 * Spec sources:
 * - docs/UI_UX.md §5 (parameter safety: bounded validated ranges; clamp, never
 *   silently reject), §6 (physical/cinematic/display classification).
 *
 * Every interactive control routes raw input through these guards before any
 * consumer callback fires, so downstream state setters only ever see finite,
 * bounded numbers.
 */

/**
 * Returns the value when finite, otherwise `null`. Guards NaN/Infinity that
 * DOM inputs can produce on programmatic writes.
 */
export function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Clamp a finite number into [min, max]; non-finite input collapses to `min`. */
export function finiteClamp(value: unknown, min: number, max: number): number {
  const n = finiteOrNull(value);
  if (n === null) return min;
  return n < min ? min : n > max ? max : n;
}

/** Clamp into [0, 1]; non-finite input collapses to 0. */
export function clamp01(value: unknown): number {
  return finiteClamp(value, 0, 1);
}

/**
 * Number of decimal places implied by a range-input step. Non-positive or
 * non-finite steps yield 0; more than 6 decimals collapses to 6 so readouts
 * stay human-sized even for float steps like 0.001.
 */
export function decimalsFromStep(step: unknown): number {
  const n = finiteOrNull(step);
  if (n === null || n <= 0) return 0;
  const text = String(n);
  const dot = text.indexOf('.');
  if (dot < 0) return 0;
  return Math.min(text.length - dot - 1, 6);
}

/**
 * Format a slider value for its numeric readout: fixed decimals derived from
 * the step, optional unit suffix separated by one space.
 */
export function formatSliderValue(value: unknown, step: unknown, unit?: string): string {
  const n = finiteOrNull(value);
  const decimals = decimalsFromStep(step);
  const body = (n ?? 0).toFixed(decimals);
  return unit && unit.length > 0 ? `${body} ${unit}` : body;
}
