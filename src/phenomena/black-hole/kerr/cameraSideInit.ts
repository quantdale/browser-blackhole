/**
 * Numeric single-source mirror of the Kerr GPU camera-side construction in
 * `kerrIntegrator.ts`. The TSL graph in `kerrIntegrator.ts` implements the
 * SAME formulas with node algebra; this module exists so the formulas are
 * unit-testable against the binary64 CPU oracle (observer/metric.ts and
 * kerr/reference.ts). Browser parity rows in kerr-parity.spec.ts are the
 * GPU-side proof that the TSL graph tracks this mirror.
 *
 * Keep every formula below byte-identical in meaning to the TSL factory.
 */

/** Kerr quartic A = (r^2 + a^2)^2 - a^2 Delta sin^2(theta), physical a = spin * massRg. */
export function kerrCameraBigA(r: number, theta: number, spin: number, massRg = 1): number {
  // D6 threading: `spin` is the dimensionless a*, metric terms use a = a* * M
  // (mirrors the aPhysSq argument the TSL factory passes into bigANode).
  const aSq = (spin * massRg) ** 2;
  const delta = r * r - 2 * massRg * r + aSq;
  const sin2 = Math.sin(theta) * Math.sin(theta);
  // Fixed 2026-10-03: shared single-source quartic (ADR §1.x / metricFragments).
  return (r * r + aSq) ** 2 - aSq * delta * sin2;
}

/** Static-frame conserved L_z frame-dragging term: n_ph sin(theta) sqrt(Delta/f_s) + g_tphi/sqrt(f_s). */
export function staticLzTerm(
  nPh: number,
  sinTheta: number,
  delta: number,
  fS: number,
  gTphi: number
): number {
  // Fixed 2026-10-03: sqrt(f_s) normalisation matching ADR §1.8.
  return nPh * sinTheta * Math.sqrt(delta / fS) + gTphi / Math.sqrt(fS);
}
