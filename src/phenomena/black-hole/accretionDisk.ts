/**
 * Accretion-disk physics and emission model (M4 emission + M3 support math).
 *
 * Spec sources (implemented exactly; do not drift without updating docs):
 * - docs/PHYSICS.md
 *     §7  thin equatorial disk, Keplerian velocity model, documented radial
 *         emissivity/temperature profiles, ISCO ~ 6 r_g scientific preset
 *     §8  frequency-shift factor g = nu_obs/nu_emit; specific-intensity
 *         transform I_nu,obs = g^3 I_nu,emit; bolometric differs — never mix
 *     §9  simplified blackbody approximation sufficient; physical temperature
 *         stays separate from display exposure/tone mapping
 *     §10 geometric-unit scale invariance (all lengths below are in r_g)
 * - docs/NUMERICAL_METHODS.md
 *     §15 circular Schwarzschild emitter: Omega = sqrt(M/r^3),
 *         u^t = 1/sqrt(1 - 3M/r), u^phi = Omega*u^t, stable orbits r >= 6M
 *     §16 frequency shift g = (-k·u_obs)/(-k·u_emit), positive for
 *         future-directed photons/observers
 *     §17 Liouville invariance of I_nu/nu^3; this module stores g^3-scaled
 *         SPECIFIC intensity at corresponding frequency, never g^4
 * - docs/STATE_SCHEMA.md §4 DiskState: temperatureModel
 *   'power-law' | 'thin-disk-approx'; deterministic u32 seed; cinematic
 *   turbulence must not change geodesic geometry (here it only modulates
 *   emitted radiance, never rays or g).
 * - src/shaders/starfield.ts: dual-port CPU/TSL documentation pattern and the
 *   PCG-style u32 hash whose mixing constants are REUSED verbatim so the CPU
 *   reference and the TSL turbulence field agree exactly on the hash stream.
 *
 * Units and conventions:
 * - Geometric units M = 1; lengths in r_g = GM/c^2. Horizon r = 2, photon
 *   sphere r = 3, Schwarzschild ISCO r = 6.
 * - Emitter radii are equatorial distances from the black-hole center;
 *   `phi` is the disk-plane azimuth in radians.
 * - `bzImpactParameter` is the conserved axial photon invariant b_z = L_z/E,
 *   supplied by the caller's geodesic integrator (see diskRedshiftFactor).
 * - All colors/intensities are LINEAR HDR before exposure and tone mapping
 *   (docs/PHYSICS.md §9 separation of physics from display).
 *
 * Fidelity class — honest disclosures:
 * - The temperature profile is the classic Shakura-Sunyaev zero-torque
 *   thin-disk SHAPE; `temperatureScale` carries an ARBITRARY normalization
 *   (no mass/accretion-rate conversion is attempted), so temperatures are
 *   relative model quantities, not physical Kelvin predictions.
 * - blackbodyRgb is a COMPACT ANALYTIC APPROXIMATION of the Planckian locus
 *   (piecewise cubic-Hermite fit of chromaticity vs log10 T, the graphics
 *   tradition of Bartlett/Helland-style log-temperature fits). It is NOT a
 *   Planck spectrum solver and not colorimetry; plausible ~1000..40000 K.
 * - Turbulence is seeded procedural value noise modulating radiance only.
 */

import {
  Fn,
  bitXor,
  div,
  exp,
  float,
  floor,
  fract,
  log,
  max,
  min,
  mix,
  mul,
  oneMinus,
  pow,
  select,
  shiftRight,
  smoothstep,
  step,
  sub,
  uint,
  vec3
} from 'three/tsl';
import type { Node } from 'three/webgpu';

// ---------------------------------------------------------------------------
// Model parameters and validation
// ---------------------------------------------------------------------------

export interface DiskModelParams {
  /** Disk inner edge in r_g. Scientific default is ISCO = 6 (see validate). */
  innerRadiusRg: number;
  /** Disk outer edge in r_g; must exceed innerRadiusRg. */
  outerRadiusRg: number;
  /** Radial emissivity power-law index eps(r) ∝ (r/r_in)^-index. */
  emissivityIndex: number;
  /** Arbitrary temperature normalization of the selected profile. */
  temperatureScale: number;
  /** Overall linear-radiance gain (also scales turbulence amplitude). >= 0. */
  densityScale: number;
  /** Turbulence amplitude fraction in [0, 1]. */
  turbulence: number;
  /** Deterministic u32 seed for the procedural turbulence field. */
  seed: number;
}

/**
 * Visualization floor for the inner edge. Circular timelike orbits require
 * r > 3 r_g (photon sphere); between 3 and 6 they are unstable, which is why
 * ISCO = 6 r_g is the SCIENTIFIC DEFAULT preset inner edge (docs/PHYSICS.md
 * §7, docs/STATE_SCHEMA.md §4). Inner edges in (2.25, 6] visualize the
 * unstable-orbit/plunging regime and are allowed WITH that disclosure; at or
 * below 3 r_g no circular orbit exists, so emitterAngularVelocity,
 * emitterUt, and diskRedshiftFactor all report "no orbit" there.
 */
export const DISK_MIN_INNER_RADIUS_RG = 2.25;

/** Schwarzschild ISCO in r_g — scientific default disk inner edge. */
export const DISK_ISCO_RG = 6;

/** Photon sphere in r_g — hard validity floor for the orbital formulas. */
export const DISK_PHOTON_SPHERE_RG = 3;

/**
 * Validates a parameter object; throws RangeError on out-of-contract values:
 * outer <= inner; inner < {@link DISK_MIN_INNER_RADIUS_RG}; non-finite
 * scales or emissivity index; negative densityScale; turbulence outside
 * [0, 1]; seed not a u32 integer.
 */
export function validateDiskModelParams(p: DiskModelParams): void {
  if (!(p.innerRadiusRg >= DISK_MIN_INNER_RADIUS_RG)) {
    throw new RangeError(
      `innerRadiusRg must be >= ${DISK_MIN_INNER_RADIUS_RG} r_g ` +
        `(ISCO = ${DISK_ISCO_RG} r_g is the scientific default; smaller values ` +
        `visualize the unstable-orbit/plunging regime only), got ${p.innerRadiusRg}`
    );
  }
  if (!(p.outerRadiusRg > p.innerRadiusRg)) {
    throw new RangeError(
      `outerRadiusRg (${p.outerRadiusRg}) must be > innerRadiusRg (${p.innerRadiusRg})`
    );
  }
  if (!Number.isFinite(p.emissivityIndex)) {
    throw new RangeError(`emissivityIndex must be finite, got ${p.emissivityIndex}`);
  }
  if (!Number.isFinite(p.temperatureScale)) {
    throw new RangeError(`temperatureScale must be finite, got ${p.temperatureScale}`);
  }
  if (!Number.isFinite(p.densityScale)) {
    throw new RangeError(`densityScale must be finite, got ${p.densityScale}`);
  }
  if (!(p.densityScale >= 0)) {
    throw new RangeError(`densityScale must be >= 0, got ${p.densityScale}`);
  }
  if (!(p.turbulence >= 0 && p.turbulence <= 1)) {
    throw new RangeError(`turbulence must be in [0, 1], got ${p.turbulence}`);
  }
  if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > 0xffffffff) {
    throw new RangeError(`seed must be a u32 integer, got ${p.seed}`);
  }
}

// ---------------------------------------------------------------------------
// Radial structure: Shakura-Sunyaev thin-disk profiles
// ---------------------------------------------------------------------------

/**
 * Thin-disk temperature profile (Shakura-Sunyaev zero-torque inner boundary,
 * M = 1):
 *
 *   T(r) = temperatureScale * (r/r_in)^(-3/4) * (1 - sqrt(r_in/r))^(1/4)
 *          for r > r_in; 0 at or below r_in.
 *
 * The (1 - sqrt(r_in/r))^(1/4) factor enforces the torque-free inner edge
 * and the -3/4 radial exponent is the standard thin-dissipation result.
 * `temperatureScale` carries the arbitrary normalization (it absorbs the
 * physical prefactor involving accretion rate and viscosity, which this
 * relative model does not convert — see header disclosure). Pow arguments
 * are guarded so fractional powers never see negatives; returns 0 for any
 * non-finite or out-of-domain radius.
 */
export function diskTemperature(rOverRg: number, p: DiskModelParams): number {
  const rIn = p.innerRadiusRg;
  if (!Number.isFinite(rOverRg) || !(rOverRg > rIn)) {
    return 0;
  }
  const x = rOverRg / rIn;
  const falloff = Math.pow(x, -0.75);
  // 1 - x^(-1/2) lies in [0, 1) for x > 1; clamp defends f64 roundoff at x~1.
  const boundaryTerm = Math.max(0, 1 - 1 / Math.sqrt(x));
  return p.temperatureScale * falloff * Math.pow(boundaryTerm, 0.25);
}

/**
 * Radial emissivity with smooth edge windows so images do not alias at the
 * disk boundaries:
 *
 *   eps(r) = (r/r_in)^(-index)
 *            * smoothstep window rising at the inner edge
 *            * (1 - smoothstep window falling at the outer edge),
 *
 * each window fading over ~5% of the full [r_in, r_out] span. The windows
 * are a rendering-motivated anti-alias mask multiplying the pure power-law
 * core eps_core(r) ∝ (r/r_in)^(-index); they are not part of the underlying
 * physics. Returns 0 outside [r_in, r_out] and for non-finite input.
 */
export function diskEmissivity(rOverRg: number, p: DiskModelParams): number {
  if (!Number.isFinite(rOverRg)) {
    return 0;
  }
  const rIn = p.innerRadiusRg;
  const rOut = p.outerRadiusRg;
  const span = rOut - rIn;
  if (!(span > 0) || rOverRg <= rIn || rOverRg >= rOut) {
    return 0;
  }
  const core = Math.pow(rOverRg / rIn, -p.emissivityIndex);
  const fade = span * 0.05;
  const innerWindow = smoothstepNumber(rIn, rIn + fade, rOverRg);
  const outerWindow = 1 - smoothstepNumber(rOut - fade, rOut, rOverRg);
  return core * innerWindow * outerWindow;
}

/** Hermite smoothstep on scalars; clamps t outside [edge0, edge1]. */
function smoothstepNumber(edge0: number, edge1: number, x: number): number {
  if (!(edge1 > edge0)) {
    return 0;
  }
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Circular Schwarzschild emitters (docs/NUMERICAL_METHODS.md §15)
// ---------------------------------------------------------------------------

/**
 * Coordinate angular velocity of a circular equatorial geodesic, M = 1:
 * Omega = sqrt(M/r^3) = r^(-3/2) (Keplerian value in Schwarzschild
 * coordinate time; docs/NUMERICAL_METHODS.md §15). Meaningful for r > 3 r_g;
 * callers detect "no orbit" via {@link emitterUt} returning 0.
 */
export function emitterAngularVelocity(rOverRg: number): number {
  return Math.pow(rOverRg, -1.5);
}

/**
 * Time component of the circular-orbit four-velocity, dt/dtau:
 * u^t = 1/sqrt(1 - 3M/r) (docs/NUMERICAL_METHODS.md §15).
 *
 * For r <= 3 r_g no circular orbit exists: returns 0 (NOT Infinity) so every
 * caller can branch once on `ut === 0` and treat those radii as invisible /
 * plunging instead of propagating infinities downstream.
 */
export function emitterUt(rOverRg: number): number {
  const arg = 1 - 3 / rOverRg; // M = 1
  if (!Number.isFinite(rOverRg) || rOverRg <= DISK_PHOTON_SPHERE_RG || !(arg > 0)) {
    return 0;
  }
  return 1 / Math.sqrt(arg);
}

/**
 * Combined gravitational + special-Doppler frequency-shift factor for a
 * CIRCULAR EQUATORIAL emitter seen by a static observer at infinity,
 * expressed through the conserved axial impact parameter b_z = L_z/E:
 *
 *   g = nu_obs / nu_emit = 1 / ( u^t * (1 - Omega * b_z) ).
 *
 * Derivation sketch (Bardeen/CTT form; Bardeen 1972, Cunningham & Bardeen
 * 1973, Luminet 1979): in a stationary axisymmetric spacetime the photon
 * constants k_t = -E and k_phi = L_z are conserved along the ray, so
 * contracting the photon momentum with the emitter four-velocity
 * u = u^t (dt_hat + Omega dphi_hat) gives
 * nu_emit = -k·u = u^t (E - Omega L_z) = u^t E (1 - Omega b_z).
 * A static observer at infinity measures nu_obs = E, hence g above. This is
 * EXACT for circular equatorial emitters in Schwarzschild precisely because
 * axial L_z is conserved regardless of the ray's out-of-plane excursion;
 * inclination enters only through the b_z supplied by the integrator. The
 * static-frame gravitational redshift is folded into u^t, whose 1 - 3M/r
 * combines gravitational and orbital terms (docs §15/§16).
 *
 * Guards:
 * - r <= 3 r_g or non-finite input: returns 0 — no circular orbit.
 * - denominator u^t (1 - Omega b_z) <= 0: returns 0; the caller must treat
 *   the sample as INVISIBLE — under this convention no future-directed
 *   photon from that emitter state reaches the observer with positive
 *   measured frequency (the formal Doppler-divergent region behind the
 *   capture shadow).
 * - b_z = 0 reduces to 1/u^t = sqrt(1 - 3/r) < 1: net redshift, as expected.
 */
export function diskRedshiftFactor(rOverRg: number, bzImpactParameter: number): number {
  const ut = emitterUt(rOverRg);
  if (ut === 0 || !Number.isFinite(bzImpactParameter)) {
    return 0;
  }
  const omega = emitterAngularVelocity(rOverRg);
  const denominator = ut * (1 - omega * bzImpactParameter);
  if (!(denominator > 0)) {
    return 0;
  }
  return 1 / denominator;
}

// ---------------------------------------------------------------------------
// Compact analytic blackbody color (approximation — see disclosure)
// ---------------------------------------------------------------------------

/**
 * Chromaticity knot table shared verbatim by the CPU {@link blackbodyRgb}
 * and the TSL ramp in {@link makeDiskEmissionNode}, guaranteeing the two
 * implementations mirror each other structurally.
 *
 * Piecewise cubic Hermite fit of blackbody chromaticity vs y = log10(T) over
 * three segments covering ~1000 K to ~40000 K, in the graphics tradition of
 * log-temperature Planckian-locus fits (Bartlett/Helland-style tables fit
 * with polynomial segments). Each channel stores [value@start, slope@start,
 * value@end, slope@end]; slopes are per unit of y. Segment knots are C1
 * continuous (shared values AND slopes at y = 3.5 and y = 3.9). The curve
 * passes near neutral white around 6000-8000 K, deep red at 1000 K, pale
 * blue at 40000 K, with saturating end slopes so chroma never clips hard.
 */
interface BlackbodySegment {
  readonly yStart: number;
  readonly yEnd: number;
  readonly r: readonly [number, number, number, number];
  readonly g: readonly [number, number, number, number];
  readonly b: readonly [number, number, number, number];
}

const BLACKBODY_SEGMENTS: readonly [BlackbodySegment, BlackbodySegment, BlackbodySegment] = [
  {
    // 1000 K (deep red) -> ~3162 K (orange).
    yStart: 3.0,
    yEnd: 3.5,
    r: [1.0, 0.0, 0.878, -1.2],
    g: [0.066, 0.55, 0.512, 1.6],
    b: [0.004, 0.05, 0.048, 0.3]
  },
  {
    // ~3162 K (orange) -> ~7943 K (near-white, slightly cool).
    yStart: 3.5,
    yEnd: 3.9,
    r: [0.878, -1.2, 0.78, -0.45],
    g: [0.512, 1.6, 0.843, 0.9],
    b: [0.048, 0.3, 0.86, 2.2]
  },
  {
    // ~7943 K -> 40000 K (pale blue, saturating).
    yStart: 3.9,
    yEnd: 4.60206,
    r: [0.78, -0.45, 0.585, -0.35],
    g: [0.843, 0.9, 0.75, 0.12],
    b: [0.86, 2.2, 1.0, 0.25]
  }
];

const BLACKBODY_Y_MIN = BLACKBODY_SEGMENTS[0].yStart;
const BLACKBODY_Y_MAX = BLACKBODY_SEGMENTS[2].yEnd;

/** Reference temperature for the relative Stefan-Boltzmann energy factor. */
const BLACKBODY_T_REF = 6500;

/** Clamp bound on the natural-log exponent fed to exp() (overflow guard). */
const BLACKBODY_MAX_EXPONENT = 50;

/** Cubic Hermite between (y0,v0) slope m0 and (y1,v1) slope m1 at y. */
function hermiteNumber(
  y: number,
  y0: number,
  v0: number,
  m0: number,
  y1: number,
  v1: number,
  m1: number
): number {
  const h = y1 - y0;
  const t = Math.min(1, Math.max(0, (y - y0) / h));
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * v0 +
    (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * v1 +
    (t3 - t2) * h * m1
  );
}

/**
 * Linear-RGB blackbody color approximation (NOT a Planck spectrum solver —
 * see the knot-table disclosure above).
 *
 * Output: linear RGB normalized to unit luminance
 * (Y = 0.2126 R + 0.7152 G + 0.0722 B = 1) times the relative
 * Stefan-Boltzmann energy factor (T/6500 K)^4, giving an HDR-ready triple.
 * Temperatures are clamped to [1000, 40000] K (documented extrapolation
 * stop, not physics); non-finite input returns [0, 0, 0]. The exponent
 * argument of exp() is clamped to +/-50 so hostile inputs cannot overflow.
 * Monotone-plausible hue across the range; passes near white ~6500 K.
 *
 * @param temperature Temperature in Kelvin.
 * @returns [R, G, B] linear HDR triple, components >= 0.
 */
export function blackbodyRgb(temperature: number): [number, number, number] {
  if (!Number.isFinite(temperature)) {
    return [0, 0, 0];
  }
  const tClamped = Math.min(40000, Math.max(1000, temperature));
  const y = Math.min(BLACKBODY_Y_MAX, Math.max(BLACKBODY_Y_MIN, Math.log10(tClamped)));

  // Bounded segment selection over the fixed 3-segment table.
  const [segA, segB, segC] = BLACKBODY_SEGMENTS;
  let seg = segA;
  if (y > segA.yEnd) {
    seg = segB;
  }
  if (y > segB.yEnd) {
    seg = segC;
  }
  let r = hermiteNumber(y, seg.yStart, seg.r[0], seg.r[1], seg.yEnd, seg.r[2], seg.r[3]);
  let g = hermiteNumber(y, seg.yStart, seg.g[0], seg.g[1], seg.yEnd, seg.g[2], seg.g[3]);
  let b = hermiteNumber(y, seg.yStart, seg.b[0], seg.b[1], seg.yEnd, seg.b[2], seg.b[3]);

  // Clamp polynomial overshoot, normalize to unit Rec.709 luminance, apply
  // the relative bolometric energy factor with an overflow-guarded exponent.
  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (!(luminance > 0)) {
    return [0, 0, 0];
  }
  const invLum = 1 / luminance;
  const exponent = Math.min(
    BLACKBODY_MAX_EXPONENT,
    Math.max(-BLACKBODY_MAX_EXPONENT, 4 * Math.log(tClamped / BLACKBODY_T_REF))
  );
  const energy = Math.exp(exponent);
  return [r * invLum * energy, g * invLum * energy, b * invLum * energy];
}

// ---------------------------------------------------------------------------
// TSL emission node factory
// ---------------------------------------------------------------------------

/** Turbulence lattice cells around the full azimuth (fixed literal). */
const NOISE_PHI_CELLS = 24;

/** Turbulence lattice cells across the disk span (fixed literal). */
const NOISE_R_CELLS = 6;

/** Row stride of the noise lattice key packing (unique for iv < 2^20). */
const NOISE_KEY_STRIDE = 1048576;

type FloatNode = Node<'float'>;
type Vec3Node = Node<'vec3'>;
type UintNode = Node<'uint'>;

/**
 * Builds the disk emission graph ONCE from baked parameters (params become
 * WGSL literals, not uniforms — rebuild the node when params change).
 *
 * `emit({ r, gFactor, phi })` evaluates per sample entirely with loop-free
 * node math:
 *
 *   1. eps(r): power-law emissivity with the same smoothstep edge windows as
 *      {@link diskEmissivity}.
 *   2. T(r): Shakura-Sunyaev profile identical to {@link diskTemperature}.
 *   3. Beaming: multiply by gFactor^3 — the Liouville transform of SPECIFIC
 *      intensity I_nu,obs = g^3 I_nu,emit at corresponding frequencies
 *      (docs/NUMERICAL_METHODS.md §17; bolometric would carry a different
 *      power — do not change this exponent ad hoc). gFactor <= 0 marks an
 *      unreachable/invisible sample and yields exactly vec3(0).
 *   4. Color: effective OBSERVED temperature T_obs = gFactor * T(r) pushed
 *      through the analytic RGB ramp mirroring {@link blackbodyRgb}
 *      node-for-node via the SHARED {@link BLACKBODY_SEGMENTS} table
 *      (pow/mix/select only, no textures/LUTs).
 *   5. Turbulence: seeded PCG-u32 value noise over (phi*k1, r*k2) using the
 *      SAME hash constants as src/shaders/starfield.ts (exact in TS and WGSL
 *      u32 arithmetic), bilinearly interpolated, centered to zero mean, and
 *      ADDED with amplitude `turbulence`; cosmetic only — never affects
 *      geodesics or g.
 *   6. Overall gain `densityScale` (so the net turbulence amplitude is
 *      turbulence * densityScale, per contract); final non-finite guard
 *      (NaN -> 0 via x != x, negatives -> 0) so one bad sample cannot poison
 *      the frame.
 *
 * Inputs are plain nodes ({@link Node}s typed unknown at the boundary):
 * `r` in r_g, `phi` in radians (any branch; wrapped internally), `gFactor`
 * the dimensionless g of {@link diskRedshiftFactor}. Returns a linear-HDR
 * vec3 node.
 */
export function makeDiskEmissionNode(p: DiskModelParams): {
  emit: (inputs: { r: unknown; gFactor: unknown; phi: unknown }) => unknown;
} {
  validateDiskModelParams(p);

  // Bake validated params into closure constants (WGSL literals downstream).
  const rIn = p.innerRadiusRg;
  const rOut = p.outerRadiusRg;
  const emIdx = p.emissivityIndex;
  const tScale = p.temperatureScale;
  const dScale = p.densityScale;
  const turbAmp = p.turbulence;
  const seed = p.seed >>> 0;
  const rK = NOISE_R_CELLS / (rOut - rIn);

  /**
   * One PCG-XSH-RR-flavored mixing step on uint nodes — op-for-op the same
   * sequence and constants as hashU32() in src/shaders/starfield.ts
   * (imul -> xorshift13 -> imul -> xorshift16). WGSL u32 multiplication
   * wraps mod 2^32, identical to Math.imul's low word, so the stream is
   * exact on both sides.
   */
  const hashU32Node = Fn(([x]: [UintNode]): UintNode => {
    let h: UintNode = bitXor(x, uint(seed));
    h = h.mul(uint(0x68bc21eb));
    h = shiftRight(h, uint(13)).bitXor(h);
    h = h.mul(uint(0x02e169be));
    h = shiftRight(h, uint(16)).bitXor(h);
    return h;
  });

  /** u32 draw -> [0, 1) with the starfield.ts conversion rule. */
  const drawUnit = (key: FloatNode): FloatNode =>
    mul(float(hashU32Node(uint(clampNode(key, 0, 1e7)))), 1 / 4294967296);

  /**
   * Value noise over the (phi, r) lattice: four corner hashes from the PCG
   * stream above, smooth-bilinear blend. Azimuth wraps through fract() and a
   * modular cell index so the field is continuous across phi = 0; radius
   * needs no wrap (r > 0 always). Returns a [0, 1]-centered field.
   */
  const turbulenceNoise = (phiN: FloatNode, rN: FloatNode): FloatNode => {
    // Wrap azimuth into [0, 1) turns BEFORE scaling, so negative phi inputs
    // land on the correct periodic cell instead of a seam.
    const uNorm = fract(div(phiN, 2 * Math.PI));
    const u = mul(uNorm, NOISE_PHI_CELLS);
    const v = mul(clampNode(rN, 0, 1e6), rK);
    const iu = floor(u);
    const iv = floor(v);
    const fu = fract(u);
    const fv = fract(v);
    // Smooth 3t^2 - 2t^3 blend weights (polynomial: CPU/GPU agree tightly).
    const su = mul(mul(fu, fu), mul(fu, -2).add(3));
    const sv = mul(mul(fv, fv), mul(fv, -2).add(3));
    // Modular cell index: (iu + off) mod NOISE_PHI_CELLS, loop-free.
    const cellI = (off: number): FloatNode =>
      sub(iu.add(off), mul(NOISE_PHI_CELLS, floor(div(iu.add(off), NOISE_PHI_CELLS))));
    // Lattice key packing: iu * STRIDE + iv, unique for iv < 2^20, iu < 2^11.
    const key = (ci: FloatNode, cj: number | FloatNode): FloatNode =>
      mul(ci, NOISE_KEY_STRIDE).add(cj) as FloatNode;
    const n00 = drawUnit(key(cellI(0), iv));
    const n10 = drawUnit(key(cellI(1), iv));
    const n01 = drawUnit(key(cellI(0), iv.add(1)));
    const n11 = drawUnit(key(cellI(1), iv.add(1)));
    const nx0 = mix(n00, n10, su);
    const nx1 = mix(n01, n11, su);
    return mix(nx0, nx1, sv);
  };

  /** One-channel cubic Hermite for a table segment, node form. */
  const hermiteChannel = (
    y: FloatNode,
    knots: readonly [number, number, number, number],
    seg: BlackbodySegment
  ): FloatNode => {
    const h = seg.yEnd - seg.yStart;
    const t = clampNode(div(sub(y, float(seg.yStart)), float(h)), 0, 1);
    const t2 = mul(t, t);
    const t3 = mul(t2, t);
    const w00 = mul(t3, 2).sub(mul(t2, 3)).add(1);
    const w10 = t3.sub(mul(t2, 2)).add(t);
    const w01 = mul(t3, -2).add(mul(t2, 3));
    const w11 = t3.sub(t2);
    return w00
      .mul(knots[0])
      .add(w10.mul(h * knots[1]))
      .add(w01.mul(knots[2]))
      .add(w11.mul(h * knots[3]));
  };

  /** Full RGB chromaticity ramp: evaluates all segments, blends by steps. */
  const blackbodyChromaNode = (tKelvin: FloatNode): Vec3Node => {
    const y = clampNode(
      mul(log(max(tKelvin, float(1e-30))), 1 / Math.LN10),
      BLACKBODY_Y_MIN,
      BLACKBODY_Y_MAX
    );
    const segB = step(float(BLACKBODY_SEGMENTS[1].yStart), y);
    const segC = step(float(BLACKBODY_SEGMENTS[2].yStart), y);
    const channel = (
      pick: (seg: BlackbodySegment) => readonly [number, number, number, number]
    ): FloatNode => {
      const a = hermiteChannel(y, pick(BLACKBODY_SEGMENTS[0]), BLACKBODY_SEGMENTS[0]);
      const bSeg = hermiteChannel(y, pick(BLACKBODY_SEGMENTS[1]), BLACKBODY_SEGMENTS[1]);
      const cSeg = hermiteChannel(y, pick(BLACKBODY_SEGMENTS[2]), BLACKBODY_SEGMENTS[2]);
      return mix(mix(a, bSeg, segB), cSeg, segC);
    };
    const r = max(
      channel((s) => s.r),
      0
    );
    const g = max(
      channel((s) => s.g),
      0
    );
    const b = max(
      channel((s) => s.b),
      0
    );
    // Normalize to unit Rec.709 luminance (mirrors blackbodyRgb).
    const lum = mul(r, 0.2126).add(mul(g, 0.7152)).add(mul(b, 0.0722));
    const invLum = select(lum.greaterThan(0), div(float(1), max(lum, 1e-6)), float(0));
    return vec3(mul(r, invLum), mul(g, invLum), mul(b, invLum));
  };

  const emitFn = Fn(([rInNode, gInNode, phiInNode]: [unknown, unknown, unknown]): Vec3Node => {
    // Boundary cast: the integrator supplies float-valued nodes; Node<'float'>
    // satisfies the TSL float() conversion's ScalarNode parameter.
    const r = float(rInNode as Node<'float'>);
    const g = float(gInNode as Node<'float'>);
    const phi = float(phiInNode as Node<'float'>);

    // --- Edge windows (mirror diskEmissivity) -----------------------------
    const span = rOut - rIn;
    const fade = span * 0.05;
    const innerWindow = smoothstep(float(rIn), float(rIn + fade), r);
    const outerWindow = oneMinus(smoothstep(float(rOut - fade), float(rOut), r));

    // --- Emissivity core: (r/rIn)^(-emIdx), domain-clamped ----------------
    const x = div(max(r, float(rIn)), float(rIn));
    const core = pow(x, float(-emIdx));
    const eps = mul(mul(core, innerWindow), outerWindow);

    // --- Shakura-Sunyaev temperature (mirror diskTemperature) -------------
    const active = select(r.greaterThan(float(rIn)), float(1), float(0));
    const boundaryTerm = pow(max(oneMinus(pow(x, float(-0.5))), float(0)), float(0.25));
    const temperature = mul(active, mul(pow(x, float(-0.75)), boundaryTerm).mul(tScale));

    // --- Beaming: specific-intensity transform g^3 (docs §17) -------------
    const beamable = select(g.greaterThan(0), float(1), float(0));
    const beaming = mul(pow(max(g, float(0)), float(3)), beamable);

    // --- Observed-color ramp at T_obs = g * T(r) --------------------------
    const tObs = mul(g, temperature);
    const tClamped = clampNode(tObs, 1000, 40000);
    const chroma = blackbodyChromaNode(tClamped);
    // Relative bolometric energy (T/6500)^4 with an overflow-guarded
    // exponent (mirrors the +/-50 clamp in blackbodyRgb).
    const energyExponent = clampNode(
      mul(
        float(4),
        sub(log(max(div(tClamped, BLACKBODY_T_REF), float(1e-30))), log(float(BLACKBODY_T_REF)))
      ),
      -BLACKBODY_MAX_EXPONENT,
      BLACKBODY_MAX_EXPONENT
    );
    const energy = exp(energyExponent);

    // --- Assemble: chroma * eps * beaming * energy ------------------------
    const shaded = mul(chroma, mul(mul(eps, beaming), energy));

    // --- Seeded turbulence: centered noise added pre-gain -----------------
    const noise = turbulenceNoise(phi, r);
    const fluctuation = mul(noise, 2).sub(1); // center to [-1, 1]
    const turbulent = shaded.add(fluctuation.mul(float(turbAmp)));

    // --- Overall gain, then non-finite guard ------------------------------
    const gained = mul(turbulent, float(dScale));
    // NaN != NaN under IEEE semantics: equal() is false exactly for NaN.
    return gained.equal(gained).select(max(gained, vec3(0)), vec3(0));
  });

  return {
    emit: (inputs: { r: unknown; gFactor: unknown; phi: unknown }) =>
      emitFn(inputs.r, inputs.gFactor, inputs.phi)
  };
}

// ---------------------------------------------------------------------------
// Small node helpers (local to this module's graph style)
// ---------------------------------------------------------------------------

/** Clamps a float node to [lo, hi] scalars (also routes NaN to lo via max). */
function clampNode(x: FloatNode, lo: number, hi: number): FloatNode {
  return min(max(x, float(lo)), float(hi)) as FloatNode;
}
