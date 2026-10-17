/**
 * Shared temperature -> linear-light RGB ramp interpolation (U-19).
 *
 * One algorithm, disclosed per-destination calibrations. Before this module
 * existed, the same log-anchor interpolation was implemented twice
 * (`stellar-explosion/emission.ts` and the neutron-star module) with
 * divergent anchor tables, and a third, structurally different empirical fit
 * lived in `compact-merger/emission.ts`. The divergence is now confined to
 * CALIBRATION DATA — each destination keeps its own documented anchor table
 * (or the compact-merger locus fit) with its valid domain — while the
 * interpolation algorithm has exactly one implementation.
 *
 * NOT Planck-law integration. Every calibration is a hand-picked
 * Planckian-locus-inspired palette carrying no radiometric claim; consumers
 * must keep that disclosure at their call sites.
 */

/** One calibration point: log10(T/Kelvin) -> linear-light RGB in [0, 1]. */
export interface TemperatureRampAnchor {
  readonly logT: number;
  readonly rgb: readonly [number, number, number];
}

/**
 * Piecewise-linear interpolation of `anchors` over log10(T). Total function:
 * input is clamped to the table's domain (first/last anchor), non-finite
 * kelvin falls back to the coldest anchor, and the result is always finite
 * with components in the anchors' range. Anchors must be sorted by `logT`
 * ascending (calibration tables are declared literal-sorted at their sites).
 */
export function interpolateTemperatureRamp(
  anchors: ReadonlyArray<TemperatureRampAnchor>,
  kelvin: number
): [number, number, number] {
  const first = anchors[0];
  const last = anchors.at(-1);
  if (first === undefined || last === undefined) return [1, 1, 1];
  const logT = Number.isFinite(kelvin) ? Math.log10(Math.max(1e-300, kelvin)) : first.logT;
  if (logT <= first.logT) return [first.rgb[0], first.rgb[1], first.rgb[2]];
  if (logT >= last.logT) return [last.rgb[0], last.rgb[1], last.rgb[2]];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (a !== undefined && b !== undefined && logT >= a.logT && logT <= b.logT) {
      const f = (logT - a.logT) / (b.logT - a.logT);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f
      ];
    }
  }
  return [last.rgb[0], last.rgb[1], last.rgb[2]];
}
