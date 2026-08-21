/**
 * Shared trajectory service — analytic Kepler orbits, arc-length-parameterized
 * Catmull-Rom splines, keyframe tracks, and nonlinear timeline phase mappings.
 *
 * Spec sources:
 * - docs/cosmic-atlas/RENDERING_SERVICES.md §6 (TrajectoryService modes & requirements:
 *   deterministic evaluation at arbitrary timeline position, no prior-frame dependence,
 *   interpolation method recorded here)
 * - docs/cosmic-atlas/ARCHITECTURE.md §6 (TrajectoryService role)
 * Contracts implemented from src/atlas/types.ts: `ITrajectoryService`,
 * `KeplerElements`, `KeyframeTrack`.
 *
 * Model notes:
 * - `sampleKepler` is the Newtonian two-body solution: period T = 2*pi*sqrt(a^3/mu);
 *   eccentric anomaly from M = E - e*sin(E) via Newton iteration (max 12 iterations,
 *   tolerance 1e-10); plane placement R = Rz(Omega) * Rx(i) * Rz(omega) applied to the
 *   periapsis-frame coordinates x' = a(cos E - e), y' = a*sqrt(1-e^2)*sin E.
 *   Relativistic effects (periapsis precession, gravitational-wave decay) are NOT
 *   modeled — destinations must disclose this when presenting orbits scientifically.
 * - `buildSpline` is uniform Catmull-Rom with a 64-sample arc-length lookup table,
 *   so `sample(t01)` moves at constant speed with respect to t01. Table lengths are
 *   chordal approximations between consecutive samples.
 * - `sampleKeyframes` is piecewise-linear (optionally smoothstep-eased via the
 *   service-level `smoothstepKeyframes` option) with binary-search interval lookup;
 *   evaluation is stateless, so arbitrary timeline scrubbing is exact.
 * - `mapPhaseInspiral(phase01) = 1 - (1 - phase01)^3` concentrates UI phase resolution
 *   near merger (merger at internal = 1): half of the UI slider covers only the last
 *   ~12.5% of internal evolution. It is a presentation mapping, not GR inspiral
 *   dynamics; its scrubbing inverse is 1 - (1 - internal)^(1/3).
 * All functions are pure and deterministic; `dispose()` is a no-op-safe lifecycle hook.
 */

import * as THREE from 'three';
import type { ITrajectoryService, KeplerElements, KeyframeTrack } from '../../atlas/types';

const TWO_PI = Math.PI * 2;
/** Newton iteration cap for the eccentric-anomaly solve. */
const KEPLER_MAX_ITERATIONS = 12;
/** Convergence tolerance (radians) on the Newton step. */
const KEPLER_TOLERANCE = 1e-10;
/** Above this eccentricity the starter E0 = pi converges more reliably than E0 = M. */
const KEPLER_HIGH_ECCENTRICITY = 0.8;
/** Elliptical guard: keeps 1 - e*cos(E) strictly positive in the Newton divisor. */
const ECCENTRICITY_MAX = 1 - 1e-9;
/** Number of uniform raw-parameter samples in the spline arc-length table. */
const ARC_LENGTH_SAMPLES = 64;
/** Squared threshold under which a vector/length is treated as degenerate. */
const DEGENERATE_EPSILON_SQ = 1e-12;

export interface TrajectoryServiceOptions {
  /**
   * Ease keyframe interpolation with smoothstep (s*s*(3-2s)) instead of raw
   * piecewise-linear. Service-level flag per the ITrajectoryService contract note.
   */
  smoothstepKeyframes?: boolean;
}

/**
 * Uniform Catmull-Rom spline with arc-length parameterization.
 * Open splines duplicate the endpoints as phantom controls; closed splines wrap.
 */
class ArcLengthParametrizedSpline {
  private readonly points: THREE.Vector3[];
  private readonly closed: boolean;
  private readonly segmentCount: number;
  /** Raw curve parameter u_j for each table sample, ascending in [0, 1]. */
  private readonly sampleU: Float64Array;
  /** Cumulative chord length at each sample; cumulativeLength[j] >= cumulativeLength[j-1]. */
  private readonly cumulativeLength: Float64Array;
  private readonly evalScratch = new THREE.Vector3();
  readonly totalLength: number;

  constructor(points: readonly THREE.Vector3[], closed: boolean) {
    // Defensive snapshot: later caller mutation must not change built geometry.
    this.points = points.map((p) => p.clone());
    this.closed = closed && points.length >= 2;
    this.segmentCount = this.closed ? this.points.length : this.points.length - 1;

    this.sampleU = new Float64Array(ARC_LENGTH_SAMPLES);
    this.cumulativeLength = new Float64Array(ARC_LENGTH_SAMPLES);

    const prev = new THREE.Vector3();
    this.evaluateRaw(0, prev);
    let acc = 0;
    for (let j = 0; j < ARC_LENGTH_SAMPLES; j++) {
      const u = j / (ARC_LENGTH_SAMPLES - 1);
      this.sampleU[j] = u;
      this.evaluateRaw(u, this.evalScratch);
      acc += prev.distanceTo(this.evalScratch);
      this.cumulativeLength[j] = acc;
      prev.copy(this.evalScratch);
    }
    this.totalLength = acc;
  }

  /** Position at normalized arc-length fraction t01 in [0, 1] (clamped). */
  sample(t01: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.totalLength <= DEGENERATE_EPSILON_SQ) {
      out.copy(this.points[0]);
      return out;
    }
    const d = THREE.MathUtils.clamp(t01, 0, 1) * this.totalLength;

    // Binary search: first j with cumulativeLength[j] >= d.
    let lo = 0;
    let hi = ARC_LENGTH_SAMPLES - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cumulativeLength[mid] < d) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    if (lo === 0) {
      return this.evaluateRaw(this.sampleU[0], out);
    }
    const d0 = this.cumulativeLength[lo - 1];
    const span = this.cumulativeLength[lo] - d0;
    const f = span > DEGENERATE_EPSILON_SQ ? (d - d0) / span : 0;
    const u = this.sampleU[lo - 1] + f * (this.sampleU[lo] - this.sampleU[lo - 1]);
    return this.evaluateRaw(u, out);
  }

  /** Total curve length (chordal approximation over the 64-sample table). */
  arcLength(): number {
    return this.totalLength;
  }

  /** Uniform Catmull-Rom basis evaluation at raw parameter u01 in [0, 1]. */
  private evaluateRaw(u01: number, out: THREE.Vector3): THREE.Vector3 {
    const segCount = this.segmentCount;
    const x = THREE.MathUtils.clamp(u01, 0, 1) * segCount;
    let k = Math.floor(x);
    if (k >= segCount) {
      k = segCount - 1;
    }
    const s = x - k;
    const s2 = s * s;
    const s3 = s2 * s;

    const p0 = this.control(k - 1);
    const p1 = this.control(k);
    const p2 = this.control(k + 1);
    const p3 = this.control(k + 2);

    out.set(
      0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * s +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
      0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * s +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3),
      0.5 *
        (2 * p1.z +
          (-p0.z + p2.z) * s +
          (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * s2 +
          (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * s3),
    );
    return out;
  }

  /** Control index with endpoint duplication (open) or modular wrap (closed). */
  private control(index: number): THREE.Vector3 {
    const n = this.points.length;
    if (this.closed) {
      return this.points[((index % n) + n) % n];
    }
    return this.points[Math.min(Math.max(index, 0), n - 1)];
  }
}

/**
 * Host-owned trajectory math service. Stateless and allocation-light per call;
 * owns no GPU resources, so disposal is trivially idempotent.
 */
export class TrajectoryService implements ITrajectoryService {
  private readonly smoothstepKeyframes: boolean;

  constructor(options: TrajectoryServiceOptions = {}) {
    this.smoothstepKeyframes = options.smoothstepKeyframes === true;
  }

  sampleKepler(
    elements: KeplerElements,
    tSeconds: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const a = elements.semiMajor;
    const mu = elements.mu;
    if (!(a > 0) || !(mu > 0)) {
      // Non-finite or non-physical elements: deterministic origin fallback.
      out.set(0, 0, 0);
      return out;
    }
    const eRaw = elements.eccentricity;
    const e = Number.isFinite(eRaw) ? Math.min(Math.max(eRaw, 0), ECCENTRICITY_MAX) : 0;

    const period = TWO_PI * Math.sqrt((a * a * a) / mu);
    const revolutions = tSeconds / period;
    const meanAnomaly = TWO_PI * (revolutions - Math.floor(revolutions));

    // Newton iteration on f(E) = E - e*sin(E) - M; slope > 0 for e < 1.
    let ecc = e < KEPLER_HIGH_ECCENTRICITY ? meanAnomaly : Math.PI;
    for (let i = 0; i < KEPLER_MAX_ITERATIONS; i++) {
      const residual = ecc - e * Math.sin(ecc) - meanAnomaly;
      const slope = 1 - e * Math.cos(ecc);
      const step = residual / slope;
      ecc -= step;
      if (Math.abs(step) <= KEPLER_TOLERANCE) {
        break;
      }
    }

    // Orbital-plane coordinates, periapsis along +x'.
    const cosE = Math.cos(ecc);
    const sinE = Math.sin(ecc);
    const xp = a * (cosE - e);
    const yp = a * Math.sqrt(Math.max(0, 1 - e * e)) * sinE;

    // Plane placement: R = Rz(Omega) * Rx(i) * Rz(omega).
    const incl = THREE.MathUtils.degToRad(elements.inclinationDeg);
    const raan = THREE.MathUtils.degToRad(elements.longitudeOfAscendingNodeDeg);
    const peri = THREE.MathUtils.degToRad(elements.argumentOfPeriapsisDeg);
    const cosO = Math.cos(raan);
    const sinO = Math.sin(raan);
    const cosI = Math.cos(incl);
    const sinI = Math.sin(incl);
    const cosW = Math.cos(peri);
    const sinW = Math.sin(peri);

    out.set(
      xp * (cosW * cosO - sinW * cosI * sinO) - yp * (sinW * cosO + cosW * cosI * sinO),
      xp * (cosW * sinO + sinW * cosI * cosO) + yp * (cosW * cosI * cosO - sinW * sinO),
      (xp * sinW + yp * cosW) * sinI,
    );
    return out;
  }

  buildSpline(
    points: THREE.Vector3[],
    closed?: boolean,
  ): {
    sample(t01: number, out: THREE.Vector3): THREE.Vector3;
    arcLength(): number;
  } {
    if (!points || points.length < 2) {
      throw new Error('TrajectoryService.buildSpline requires at least 2 points');
    }
    return new ArcLengthParametrizedSpline(points, closed === true);
  }

  sampleKeyframes(track: KeyframeTrack, tSeconds: number, out: THREE.Vector3): THREE.Vector3 {
    const keyCount = Math.min(track.times.length, Math.floor(track.positions.length / 3));
    if (keyCount === 0) {
      out.set(0, 0, 0);
      return out;
    }
    const times = track.times;
    const positions = track.positions;

    if (tSeconds <= times[0]) {
      return this.readKeyframe(positions, 0, out);
    }
    if (tSeconds >= times[keyCount - 1]) {
      return this.readKeyframe(positions, keyCount - 1, out);
    }

    // Binary search: largest i with times[i] <= tSeconds; active interval [i, i+1].
    let lo = 0;
    let hi = keyCount - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (times[mid] <= tSeconds) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const span = times[hi] - times[lo];
    let s = span > 0 ? (tSeconds - times[lo]) / span : 0;
    if (this.smoothstepKeyframes) {
      s = s * s * (3 - 2 * s);
    }

    const base = lo * 3;
    const next = hi * 3;
    out.set(
      THREE.MathUtils.lerp(positions[base + 0], positions[next + 0], s),
      THREE.MathUtils.lerp(positions[base + 1], positions[next + 1], s),
      THREE.MathUtils.lerp(positions[base + 2], positions[next + 2], s),
    );
    return out;
  }

  mapPhaseLinear(phase01: number): number {
    return phase01;
  }

  mapPhaseInspiral(phase01: number): number {
    // internal = 1 - (1 - phase01)^3 — inverse-cubic ease concentrating UI
    // resolution near merger; see header notes for the disclosure wording.
    return 1 - Math.pow(1 - phase01, 3);
  }

  dispose(): void {
    // Stateless service owning no GPU/window resources; nothing to release.
    // Kept as an explicit no-op-safe lifecycle hook for HostServices symmetry.
  }

  private readKeyframe(positions: Float32Array, key: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(positions[key * 3], positions[key * 3 + 1], positions[key * 3 + 2]);
  }
}
