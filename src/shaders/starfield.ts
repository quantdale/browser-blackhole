/**
 * Deterministic procedural star field sampled by world direction (M1-03).
 *
 * Contract (docs/SHADER_CONTRACTS.md section 9, docs/RENDERING_PIPELINE.md
 * section 3): `sampleStarfieldRadiance(direction, params)` is a PURE function
 * of the normalized world direction, the parameter object, and the seed.
 * No time dependence, no camera dependence, no frame-order dependence — this
 * is what makes visual regression baselines possible.
 *
 * Formulation: cube-map cell hashing.
 *
 *   1. Map the direction onto one of 6 cube faces via its dominant axis.
 *   2. Subdivide each face into `cellsPerFaceSide^2` square cells.
 *   3. Hash (face, cellI, cellJ, seed) into a u32 stream (PCG-style mixing).
 *   4. The first hash draw decides whether the cell contains a star
 *      (probability = `starDensity`).
 *   5. Two further draws place the star inside the cell; one more draws its
 *      brightness from a bounded power-law distribution.
 *   6. A direction sees the star through a smooth quadratic falloff around
 *      the star's own direction with angular radius `starAngularRadius`.
 *   7. `backgroundRadiance` is added unconditionally (exact additive term).
 *
 * Every step uses only operations that exist identically in TypeScript and
 * TSL/WGSL:
 *
 *   | step            | TS                     | TSL                          |
 *   |-----------------|------------------------|------------------------------|
 *   | dominant axis   | comparisons, abs       | abs().greaterThanEqual(...)  |
 *   | cell index      | Math.floor             | floor()                      |
 *   | u32 hash        | Math.imul, >>>, ^, +   | uint ops: mul, shiftRight,   |
 *   |                 |                        | bitXor, add                  |
 *   | u32 -> float    | h * (1/4294967296)     | float(h).mul(1/4294967296)   |
 *   | power-law       | Math.pow               | pow()                        |
 *
 * Precision caveats (CPU f64 vs GPU f32):
 *   - The u32 hash itself is EXACT on both sides (WGSL u32 == JS imul/>>>).
 *   - `Math.floor` of an f64 coordinate can disagree with f32 `floor()` when
 *     the direction lands within ~1e-7 of a cell boundary. Integrators should
 *     treat boundary flicker as sub-pixel noise; do not build logic that
 *     depends on the exact cell of a boundary-exact direction.
 *   - `pow` implementations differ by a few ULP between CPU and GPU; brightness
 *     values agree only to f32 tolerance, not bitwise.
 *   - Direction normalization must happen BEFORE calling this function; the
 *     CPU reference normalizes defensively but the shader contract expects a
 *     unit input.
 */

export type Vec3 = [number, number, number];

/**
 * Optional second-scale environment population used by the cinematic
 * presentation.  The original StarfieldParams fields remain the scientific
 * baseline; this block is additive and deliberately absent from
 * `makeStarfieldParams()` so scientific parity stays exact.
 */
export interface CinematicEnvironmentParams {
  /** Grid resolution per cube-face side for unresolved stars. */
  denseCellsPerFaceSide: number;
  /** Probability that an unresolved cell contains a star. */
  denseStarDensity: number;
  denseBrightnessExponent: number;
  denseMinBrightness: number;
  denseMaxBrightness: number;
  denseStarAngularRadius: number;
  /** Linear HDR diffuse galactic component, before the detail budget. */
  diffuseRadiance: Vec3;
  /** Linear HDR dust/nebula tint, before the detail budget. */
  dustRadiance: Vec3;
  galacticBandStrength: number;
  nebulaStrength: number;
}

export const CINEMATIC_ENVIRONMENT_DEFAULTS: CinematicEnvironmentParams = {
  denseCellsPerFaceSide: 192,
  denseStarDensity: 0.16,
  denseBrightnessExponent: 2.2,
  denseMinBrightness: 0.012,
  denseMaxBrightness: 0.85,
  denseStarAngularRadius: 0.00135,
  diffuseRadiance: [0.003, 0.0012, 0.006],
  dustRadiance: [0.026, 0.008, 0.042],
  galacticBandStrength: 1,
  nebulaStrength: 0.55
};

export interface StarfieldParams {
  /** u32 seed; different seeds produce entirely different star layouts. */
  seed: number;
  /** Grid resolution per cube-face side. Total cells = 6 * n^2. */
  cellsPerFaceSide: number;
  /** Probability that a given cell hosts a star, in [0, 1]. */
  starDensity: number;
  /**
   * Power-law exponent alpha for brightnesses b in
   * [minBrightness, maxBrightness] with p(b) ∝ b^-alpha. alpha=0 is uniform;
   * larger alpha favors dim stars. alpha=1 falls back to log-uniform.
   */
  brightnessExponent: number;
  /** Brightness lower bound (> 0), multiplies peak radiance. */
  minBrightness: number;
  /** Brightness upper bound (>= minBrightness). */
  maxBrightness: number;
  /** Angular radius of a star's visible disk, in radians (> 0). */
  starAngularRadius: number;
  /** Unconditional linear HDR base radiance added under the stars. */
  backgroundRadiance: Vec3;
  /** Optional additive cinematic environment layer. */
  cinematic?: CinematicEnvironmentParams;
}

export interface StarfieldDefaults {
  seed: number;
  cellsPerFaceSide: number;
  starDensity: number;
  brightnessExponent: number;
  minBrightness: number;
  maxBrightness: number;
  starAngularRadius: number;
  backgroundRadiance: Vec3;
}

export const STARFIELD_DEFAULTS: StarfieldDefaults = {
  seed: 0x9e3779b9,
  cellsPerFaceSide: 64,
  starDensity: 0.08,
  brightnessExponent: 1.5,
  minBrightness: 0.25,
  maxBrightness: 8,
  starAngularRadius: 0.004,
  backgroundRadiance: [0.004, 0.005, 0.008]
};

/** Validates a parameter object; throws on out-of-contract values. */
export function validateStarfieldParams(p: StarfieldParams): void {
  if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > 0xffffffff) {
    throw new RangeError(`seed must be a u32 integer, got ${p.seed}`);
  }
  if (!Number.isInteger(p.cellsPerFaceSide) || p.cellsPerFaceSide < 1) {
    throw new RangeError(`cellsPerFaceSide must be an integer >= 1, got ${p.cellsPerFaceSide}`);
  }
  if (!(p.starDensity >= 0 && p.starDensity <= 1)) {
    throw new RangeError(`starDensity must be in [0, 1], got ${p.starDensity}`);
  }
  if (!(p.brightnessExponent >= 0)) {
    throw new RangeError(`brightnessExponent must be >= 0, got ${p.brightnessExponent}`);
  }
  if (!(p.minBrightness > 0 && p.maxBrightness >= p.minBrightness)) {
    throw new RangeError(
      `brightness bounds invalid: min=${p.minBrightness} max=${p.maxBrightness}`
    );
  }
  if (!(p.starAngularRadius > 0)) {
    throw new RangeError(`starAngularRadius must be > 0, got ${p.starAngularRadius}`);
  }
  for (const c of p.backgroundRadiance) {
    if (!(c >= 0)) {
      throw new RangeError(`backgroundRadiance channels must be >= 0, got ${c}`);
    }
  }
}

export function makeStarfieldParams(overrides: Partial<StarfieldParams> = {}): StarfieldParams {
  const p: StarfieldParams = { ...STARFIELD_DEFAULTS, ...overrides };
  validateStarfieldParams(p);
  return p;
}

/**
 * Builds the richer environment used by Cinematic mode.  It keeps the
 * scientific star population and background exactly intact, then appends a
 * separately seeded unresolved population and low-amplitude diffuse/dust
 * terms.  Callers still control its live contribution with the sampler's
 * detail uniform.
 */
export function makeCinematicStarfieldParams(
  overrides: Partial<StarfieldParams> = {},
  environmentOverrides: Partial<CinematicEnvironmentParams> = {}
): StarfieldParams {
  const p = makeStarfieldParams(overrides);
  const cinematic: CinematicEnvironmentParams = {
    ...CINEMATIC_ENVIRONMENT_DEFAULTS,
    ...environmentOverrides,
    diffuseRadiance: [
      environmentOverrides.diffuseRadiance?.[0] ??
        CINEMATIC_ENVIRONMENT_DEFAULTS.diffuseRadiance[0],
      environmentOverrides.diffuseRadiance?.[1] ??
        CINEMATIC_ENVIRONMENT_DEFAULTS.diffuseRadiance[1],
      environmentOverrides.diffuseRadiance?.[2] ?? CINEMATIC_ENVIRONMENT_DEFAULTS.diffuseRadiance[2]
    ],
    dustRadiance: [
      environmentOverrides.dustRadiance?.[0] ?? CINEMATIC_ENVIRONMENT_DEFAULTS.dustRadiance[0],
      environmentOverrides.dustRadiance?.[1] ?? CINEMATIC_ENVIRONMENT_DEFAULTS.dustRadiance[1],
      environmentOverrides.dustRadiance?.[2] ?? CINEMATIC_ENVIRONMENT_DEFAULTS.dustRadiance[2]
    ]
  };
  validateCinematicEnvironmentParams(cinematic);
  return { ...p, cinematic };
}

function validateCinematicEnvironmentParams(p: CinematicEnvironmentParams): void {
  if (!Number.isInteger(p.denseCellsPerFaceSide) || p.denseCellsPerFaceSide < 1) {
    throw new RangeError(
      `denseCellsPerFaceSide must be an integer >= 1, got ${p.denseCellsPerFaceSide}`
    );
  }
  if (!(p.denseStarDensity >= 0 && p.denseStarDensity <= 1)) {
    throw new RangeError(`denseStarDensity must be in [0, 1], got ${p.denseStarDensity}`);
  }
  if (!(p.denseBrightnessExponent >= 0)) {
    throw new RangeError(`denseBrightnessExponent must be >= 0, got ${p.denseBrightnessExponent}`);
  }
  if (!(p.denseMinBrightness > 0 && p.denseMaxBrightness >= p.denseMinBrightness)) {
    throw new RangeError(
      `dense brightness bounds invalid: min=${p.denseMinBrightness} max=${p.denseMaxBrightness}`
    );
  }
  if (!(p.denseStarAngularRadius > 0)) {
    throw new RangeError(`denseStarAngularRadius must be > 0, got ${p.denseStarAngularRadius}`);
  }
  if (!(p.galacticBandStrength >= 0 && p.nebulaStrength >= 0)) {
    throw new RangeError('cinematic environment strengths must be non-negative');
  }
  for (const color of [p.diffuseRadiance, p.dustRadiance]) {
    if (color.some((channel) => !Number.isFinite(channel) || channel < 0)) {
      throw new RangeError(
        'cinematic environment radiance channels must be finite and non-negative'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Cube-face decomposition
// ---------------------------------------------------------------------------

export interface CubeCell {
  /** Face id 0..5: +X, -X, +Y, -Y, +Z, -Z. */
  face: number;
  /** Cell column index in [0, cellsPerFaceSide). */
  i: number;
  /** Cell row index in [0, cellsPerFaceSide). */
  j: number;
}

/**
 * Dominant-axis cube-face projection. Returns null only for a zero vector
 * (the caller decides how to degrade; the shader path never passes one).
 */
export function directionToCubeCell(direction: Vec3, cellsPerFaceSide: number): CubeCell | null {
  const ax = Math.abs(direction[0]);
  const ay = Math.abs(direction[1]);
  const az = Math.abs(direction[2]);
  let face: number;
  let ma: number;
  let u: number;
  let v: number;
  if (ax >= ay && ax >= az) {
    ma = ax;
    face = direction[0] >= 0 ? 0 : 1;
    u = -direction[2];
    v = -direction[1];
  } else if (ay >= az) {
    ma = ay;
    face = direction[1] >= 0 ? 2 : 3;
    u = direction[0];
    v = direction[2];
  } else {
    ma = az;
    face = direction[2] >= 0 ? 4 : 5;
    u = direction[0];
    v = -direction[1];
  }
  if (ma === 0) {
    return null;
  }
  // Project to face plane: coordinates in [-1, 1].
  const fu = u / ma;
  const fv = v / ma;
  const n = cellsPerFaceSide;
  let i = Math.floor((fu * 0.5 + 0.5) * n);
  let j = Math.floor((fv * 0.5 + 0.5) * n);
  // Clamp away f64 roundoff at the +1 edge (floor can yield exactly n).
  i = Math.min(Math.max(i, 0), n - 1);
  j = Math.min(Math.max(j, 0), n - 1);
  return { face, i, j };
}

// ---------------------------------------------------------------------------
// u32 hash stream (exact in both TS and WGSL)
// ---------------------------------------------------------------------------

function imul(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

/**
 * One PCG-XSH-RR-flavored mixing step. All intermediate values stay exact u32
 * in JavaScript (Math.imul + unsigned shifts); WGSL compiles the same op
 * sequence on u32 with identical results.
 */
export function hashU32(x: number, seed: number): number {
  let h = (x ^ seed) >>> 0;
  h = imul(h, 0x68bc21eb);
  h = (h ^ (h >>> 13)) >>> 0;
  h = imul(h, 0x02e169be);
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

/** Maps a u32 draw uniformly to [0, 1). Exact same constant on GPU. */
export function u32ToUnit(h: number): number {
  return h * (1 / 4294967296);
}

/** Linear cell key packing: unique for face,i,j < 2^10 each. */
export function packCellKey(face: number, i: number, j: number): number {
  return ((face * 1024 + i) * 1024 + j) >>> 0;
}

// ---------------------------------------------------------------------------
// Star properties drawn from the cell hash stream
// ---------------------------------------------------------------------------

export function cellHasStar(face: number, i: number, j: number, p: StarfieldParams): boolean {
  const h = hashU32(packCellKey(face, i, j), p.seed);
  return u32ToUnit(h) < p.starDensity;
}

/**
 * Star center expressed as face-plane coordinates (fu, fv) in [-1, 1],
 * inset by half a cell so stars never straddle a face border cell edge.
 */
export function starFaceCoords(
  face: number,
  i: number,
  j: number,
  p: StarfieldParams
): {
  fu: number;
  fv: number;
} {
  const n = p.cellsPerFaceSide;
  const hI = hashU32(packCellKey(face, i, j) ^ 0xa5a5f00d, p.seed);
  const hJ = hashU32(packCellKey(face, i, j) ^ 0x1b3c6e97, p.seed);
  const fi = (i + 0.5 + (u32ToUnit(hI) - 0.5)) / n;
  const fj = (j + 0.5 + (u32ToUnit(hJ) - 0.5)) / n;
  return { fu: fi * 2 - 1, fv: fj * 2 - 1 };
}

/** Reconstructs the star's world direction from its face-plane coordinates. */
export function faceCoordsToDirection(face: number, fu: number, fv: number): Vec3 {
  let x: number;
  let y: number;
  let z: number;
  switch (face) {
    case 0:
      x = 1;
      y = -fv;
      z = -fu;
      break;
    case 1:
      x = -1;
      y = -fv;
      z = fu;
      break;
    case 2:
      x = fu;
      y = 1;
      z = fv;
      break;
    case 3:
      x = fu;
      y = -1;
      z = -fv;
      break;
    case 4:
      x = fu;
      y = fv;
      z = 1;
      break;
    default:
      x = -fu;
      y = fv;
      z = -1;
      break;
  }
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

/**
 * Inverse CDF of the bounded power law p(b) ∝ b^-alpha on [bMin, bMax].
 * u in [0, 1). alpha=0: uniform. alpha=1: log-uniform limit.
 */
export function sampleBrightness(u: number, p: StarfieldParams): number {
  const { brightnessExponent: alpha, minBrightness: bMin, maxBrightness: bMax } = p;
  const uu = Math.min(Math.max(u, 0), 1 - 1e-9);
  if (alpha === 1) {
    return bMin * Math.pow(bMax / bMin, uu);
  }
  const a = 1 - alpha;
  return Math.pow(bMin ** a + uu * (bMax ** a - bMin ** a), 1 / a);
}

/** Peak-brightness hash draw for a cell's star. */
export function starBrightness(face: number, i: number, j: number, p: StarfieldParams): number {
  const h = hashU32(packCellKey(face, i, j) ^ 0x7f4a7c15, p.seed);
  return sampleBrightness(u32ToUnit(h), p);
}

/**
 * Smooth quadratic falloff: 1 at center, 0 at the angular radius edge.
 * t runs 0 (edge) -> 1 (center); profile t*t. Polynomial (not exp/sin) so
 * CPU and TSL agree tightly.
 */
export function starFalloff(cosAngle: number, cosRadius: number): number {
  if (cosAngle <= cosRadius) {
    return 0;
  }
  const t = (cosAngle - cosRadius) / (1 - cosRadius);
  return t * t;
}

// ---------------------------------------------------------------------------
// Public sampling entry point (contract: docs/SHADER_CONTRACTS.md section 9)
// ---------------------------------------------------------------------------

/**
 * Samples the environment radiance for a normalized world direction.
 * Output is linear HDR RGB before exposure/tone mapping.
 */
export function sampleStarfieldRadiance(direction: Vec3, p: StarfieldParams): Vec3 {
  const cell = directionToCubeCell(direction, p.cellsPerFaceSide);
  const out: Vec3 = [p.backgroundRadiance[0], p.backgroundRadiance[1], p.backgroundRadiance[2]];
  if (!cell || !cellHasStar(cell.face, cell.i, cell.j, p)) {
    return out;
  }
  const { fu, fv } = starFaceCoords(cell.face, cell.i, cell.j, p);
  const starDir = faceCoordsToDirection(cell.face, fu, fv);
  const dot = direction[0] * starDir[0] + direction[1] * starDir[1] + direction[2] * starDir[2];
  const cosRadius = Math.cos(p.starAngularRadius);
  const falloff = starFalloff(dot, cosRadius);
  if (falloff === 0) {
    return out;
  }
  const b = starBrightness(cell.face, cell.i, cell.j, p);
  out[0] += b * falloff;
  out[1] += b * falloff;
  out[2] += b * falloff;
  return out;
}

/**
 * CPU reference for the optional cinematic layer.  This is intentionally a
 * separate function from `sampleStarfieldRadiance`: the latter is the locked
 * scientific parity contract, while this function documents the additive
 * presentation layer used by the GPU sampler.
 */
export function sampleCinematicEnvironmentRadiance(direction: Vec3, p: StarfieldParams): Vec3 {
  const out = sampleStarfieldRadiance(direction, p);
  const cinematic = p.cinematic;
  if (cinematic === undefined) return out;

  const denseCell = directionToCubeCell(direction, cinematic.denseCellsPerFaceSide);
  const band = Math.pow(Math.max(0, 1 - Math.abs(direction[1])), 2.2);
  const diffuseGain = band * cinematic.galacticBandStrength;
  out[0] += cinematic.diffuseRadiance[0] * diffuseGain;
  out[1] += cinematic.diffuseRadiance[1] * diffuseGain;
  out[2] += cinematic.diffuseRadiance[2] * diffuseGain;

  // One deterministic low-frequency cell controls the dust/nebular modulation
  // so the CPU reference remains cheap and reproduces the GPU's stable
  // orientation/seed rule without introducing a wall-clock dependency.
  const dustCell = directionToCubeCell(direction, 12);
  const dustUnit =
    dustCell === null
      ? 0
      : u32ToUnit(hashU32(packCellKey(dustCell.face, dustCell.i, dustCell.j) ^ 0x2a6f5d31, p.seed));
  const dustGain = band * cinematic.nebulaStrength * (0.45 + dustUnit * 0.55);
  out[0] += cinematic.dustRadiance[0] * dustGain;
  out[1] += cinematic.dustRadiance[1] * dustGain;
  out[2] += cinematic.dustRadiance[2] * dustGain;

  if (
    denseCell === null ||
    !cellHasStar(denseCell.face, denseCell.i, denseCell.j, {
      ...p,
      cellsPerFaceSide: cinematic.denseCellsPerFaceSide,
      starDensity: cinematic.denseStarDensity,
      brightnessExponent: cinematic.denseBrightnessExponent,
      minBrightness: cinematic.denseMinBrightness,
      maxBrightness: cinematic.denseMaxBrightness,
      starAngularRadius: cinematic.denseStarAngularRadius
    })
  ) {
    return out;
  }

  const denseParams: StarfieldParams = {
    ...p,
    cellsPerFaceSide: cinematic.denseCellsPerFaceSide,
    starDensity: cinematic.denseStarDensity,
    brightnessExponent: cinematic.denseBrightnessExponent,
    minBrightness: cinematic.denseMinBrightness,
    maxBrightness: cinematic.denseMaxBrightness,
    starAngularRadius: cinematic.denseStarAngularRadius
  };
  const { fu, fv } = starFaceCoords(denseCell.face, denseCell.i, denseCell.j, denseParams);
  const starDirection = faceCoordsToDirection(denseCell.face, fu, fv);
  const cosAngle =
    direction[0] * starDirection[0] +
    direction[1] * starDirection[1] +
    direction[2] * starDirection[2];
  const falloff = starFalloff(cosAngle, Math.cos(cinematic.denseStarAngularRadius));
  if (falloff === 0) return out;
  const brightness = starBrightness(denseCell.face, denseCell.i, denseCell.j, denseParams);
  const temperature = u32ToUnit(
    hashU32(packCellKey(denseCell.face, denseCell.i, denseCell.j) ^ 0x50f3a9d1, p.seed)
  );
  const warm: Vec3 = [1, 0.48, 0.2];
  const cool: Vec3 = [0.72, 0.86, 1];
  const gain = brightness * falloff;
  out[0] += (warm[0] * (1 - temperature) + cool[0] * temperature) * gain;
  out[1] += (warm[1] * (1 - temperature) + cool[1] * temperature) * gain;
  out[2] += (warm[2] * (1 - temperature) + cool[2] * temperature) * gain;
  return out;
}
