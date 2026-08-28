/**
 * Quasar/AGN continuum variability surrogate (phenomena-animation campaign).
 *
 * WHAT THIS IS
 * A deterministic, scrubbable, band-limited light curve used to modulate the
 * nuclear continuum brightness so the destination is not a still life. It is a
 * SURROGATE, not a stochastic simulation:
 *
 *   L(t) = 1 + sum_k a_k * sin(2*pi*t/P_k + phi_k)
 *
 * with logarithmically spaced periods `P_k` inside the observed variability
 * band and amplitudes weighted so the resulting structure function rises like
 * the observed power law.
 *
 * WHY A SURROGATE AND NOT A DRW
 * Observed quasar optical variability is well described statistically by a
 * damped random walk (Kelly et al. 2009; MacLeod et al. 2010; Andrae, Kim &
 * Bailer-Jones 2013) with a damping timescale of order hundreds of days —
 * Dexter & Agol (2011) adopt tau = 200 d for their disc-fluctuation toy model,
 * and 20-year baselines push the measured median toward ~750 d (Stone et al.
 * 2022) — and a structure function well fitted by a single power law of index
 * gamma ~= 0.246 from days to years (Andrae et al. 2013).
 *
 * A DRW is a STOCHASTIC process: a realization depends on its entire history,
 * so it cannot be evaluated at an arbitrary timeline coordinate. This app
 * requires the opposite property — every visual must be a pure function of the
 * timeline coordinate so that scrubbing, reset and looping are deterministic
 * and reproducible (STATE_AND_ROUTES §11/§13). A fixed-phase sinusoid sum is
 * that pure function, and with power-law amplitude weighting it reproduces the
 * shape of the observed structure function inside the modelled band while
 * making no claim to be a DRW realization.
 *
 * WHAT IS AND IS NOT CLAIMED
 * - Claimed: order-of-magnitude timescales and fractional amplitude typical of
 *   quasar optical continuum variability; a structure function that rises with
 *   lag as a power law and saturates above the damping timescale.
 * - NOT claimed: a specific object's light curve, correct stochastic
 *   statistics, wavelength dependence, or inter-band lags.
 *
 * The disclosure string below is surfaced through the destination's fidelity
 * readout; do not weaken it.
 */

/** Longest modelled timescale (days). Dexter & Agol (2011) disc-toy tau. */
export const DRW_DAMPING_TIMESCALE_DAYS = 200;

/** Observed structure-function power-law index (Andrae et al. 2013). */
export const STRUCTURE_FUNCTION_INDEX = 0.246;

/** Fractional RMS of the modelled continuum variation (dimensionless). */
export const VARIABILITY_RMS = 0.16;

/** Number of octave-spaced components below the damping timescale. */
const COMPONENT_COUNT = 6;

export const VARIABILITY_DISCLOSURE =
  'Continuum variability is a deterministic band-limited surrogate: a ' +
  'fixed-phase sinusoid sum spanning 6-200 d with amplitudes weighted to the ' +
  'observed structure-function index (gamma ~ 0.25). It reproduces the ' +
  'timescales and ~16% fractional amplitude typical of quasar optical ' +
  'variability; it is NOT a damped-random-walk realization and not any ' +
  'specific object.';

/** One sinusoid component of the surrogate light curve. */
export interface VariabilityComponent {
  /** Period in days. */
  periodDays: number;
  /** Fractional amplitude (dimensionless). */
  amplitude: number;
  /** Fixed phase offset in radians. */
  phase: number;
}

/** Deterministic unit hash (same integer mix used elsewhere in the repo). */
function hash01(index: number, seed: number): number {
  let h = (index + seed + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x68bc21eb) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x02e169be) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Build the component set: octave-spaced periods from the damping timescale
 * downward, amplitudes proportional to `P^gamma` (so power grows with
 * timescale exactly as the observed structure function does), normalized so
 * the quadrature sum equals {@link VARIABILITY_RMS}, and phases fixed by a
 * seeded hash so a given seed always yields the same curve.
 */
export function buildVariabilityComponents(seed = 0): VariabilityComponent[] {
  const raw: { periodDays: number; weight: number; phase: number }[] = [];
  for (let k = 0; k < COMPONENT_COUNT; k += 1) {
    const periodDays = DRW_DAMPING_TIMESCALE_DAYS / 2 ** k;
    raw.push({
      periodDays,
      weight: periodDays ** STRUCTURE_FUNCTION_INDEX,
      phase: hash01(k, seed) * Math.PI * 2
    });
  }
  // Normalize in quadrature: independent sinusoids add in power, so the RMS of
  // the sum is sqrt(sum(a_k^2 / 2)).
  const power = raw.reduce((acc, c) => acc + c.weight ** 2 / 2, 0);
  const scale = power > 0 ? VARIABILITY_RMS / Math.sqrt(power) : 0;
  return raw.map((c) => ({
    periodDays: c.periodDays,
    amplitude: c.weight * scale,
    phase: c.phase
  }));
}

/**
 * Evaluate the surrogate light curve at `tDays`. Returns a multiplicative
 * brightness factor centred on 1, clamped to stay strictly positive so no
 * caller can be handed a negative radiance.
 */
export function variabilityFactor(
  tDays: number,
  components: readonly VariabilityComponent[]
): number {
  if (!Number.isFinite(tDays)) return 1;
  let sum = 0;
  for (const c of components) {
    sum += c.amplitude * Math.sin((2 * Math.PI * tDays) / c.periodDays + c.phase);
  }
  const factor = 1 + sum;
  return factor < 0.05 ? 0.05 : factor;
}

/**
 * Structure function of the surrogate at lag `lagDays`, in the same
 * RMS-of-differences sense as the observational quantity:
 * `SF(dt) = sqrt(sum_k a_k^2 * (1 - cos(2*pi*dt/P_k)))`.
 *
 * Exposed because it is the property this model is actually claiming: it must
 * rise with lag and saturate above the damping timescale, and the unit tests
 * pin that behaviour.
 */
export function structureFunction(
  lagDays: number,
  components: readonly VariabilityComponent[]
): number {
  if (!Number.isFinite(lagDays)) return 0;
  let sum = 0;
  for (const c of components) {
    sum += c.amplitude ** 2 * (1 - Math.cos((2 * Math.PI * lagDays) / c.periodDays));
  }
  return Math.sqrt(Math.max(sum, 0));
}
