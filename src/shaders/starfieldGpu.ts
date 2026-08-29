/**
 * GPU (TSL) starfield/environment sampler node (M1-03/M1-04 shader side).
 *
 * Implements the environment-sampling contract of docs/SHADER_CONTRACTS.md
 * section 9 (`sampleEnvironment(direction, environmentParams) ->
 * linearRadianceRGB`) and the non-finite guard policy of section 14. This
 * module is a faithful TSL port of the CPU reference in
 * src/shaders/starfield.ts: same hash constants (0x68bc21eb, 0x02e169be),
 * same salt constants (0xa5a5f00d, 0x1b3c6e97, 0x7f4a7c15), same operation
 * order, same inverse-CDF branch structure for alpha === 1.
 *
 * Graph structure (mirrors sampleStarfieldRadiance step for step):
 *   1. Dominant-axis cube-face decomposition via abs + >= comparisons.
 *   2. Cell index i/j = floor((faceCoord * 0.5 + 0.5) * n), clamped to
 *      [0, n-1] against the +1 roundoff edge.
 *   3. Linear cell key ((face * 1024 + i) * 1024 + j) on u32 nodes.
 *   4. PCG-style u32 hash: x ^ seed, mul 0x68bc21eb, ^ (h >> 13),
 *      mul 0x02e169be, ^ (h >> 16). WGSL u32 arithmetic wraps mod 2^32,
 *      exactly matching Math.imul + unsigned shifts on the CPU, so the hash
 *      stream is EXACT on both sides given identical integer inputs.
 *   5. u32 -> unit float scale by 1/4294967296.
 *   6. Presence draw (< starDensity), two salted position draws, one salted
 *      brightness draw through the bounded power-law inverse CDF. The
 *      alpha === 1 log-uniform branch is selected at graph-construction time
 *      because params are baked literals, not runtime nodes.
 *   7. Quadratic falloff around the reconstructed star direction, with the
 *      CPU's `cosAngle <= cosRadius` early-out expressed as a select; the
 *      background term is added unconditionally (exact additive term).
 *
 * Params are baked into the graph ONCE at factory time as literal constants;
 * the returned closures map a normalized vec3 direction NODE to a linear-HDR
 * vec3 radiance NODE. No textures, no uniforms, no time dependence: a pure
 * function of the direction node, per the section 9 determinism contract.
 *
 * Precision caveats (CPU f64 vs GPU f32), extending src/shaders/starfield.ts:
 *   - The u32 hash itself is EXACT on both sides given identical integer
 *     inputs (face, i, j).
 *   - u32ToUnit diverges slightly: the CPU multiplies the exact integer by
 *     1/2^32 in f64; the GPU rounds the u32 to f32 first (integers above 2^24
 *     lose low bits), so star positions and brightnesses agree only to f32
 *     tolerance (~1e-7 relative), not bitwise.
 *   - f32 floor() can disagree with f64 Math.floor within ~1e-7 of a cell
 *     boundary (sub-pixel flicker; do not build logic on the exact cell of a
 *     boundary-exact direction).
 *   - Star-direction normalization uses f32 sqrt(x^2+y^2+z^2) vs the CPU's
 *     hypot; the falloff edge differs by ULPs near the angular radius.
 *   - pow differs by a few ULP between CPU and GPU backends; brightness
 *     values agree to f32 tolerance only.
 *   - cos(starAngularRadius) and the inverse-CDF constants (bMin^a,
 *     bMax^a - bMin^a, 1/a, bMax/bMin) are computed once in f64 here and
 *     baked as literals; the CPU reference recomputes them per call.
 *
 * Non-finite policy (section 14): createEnvironmentSamplerNode sanitizes its
 * output per channel — NaN (detected as c != c, which holds only for IEEE
 * NaN) maps to black, negatives and -Inf clamp to 0, and +Inf/runaway
 * magnitudes clamp to ENV_RADIANCE_CEILING. A degenerate direction therefore
 * degrades to explicit black sky instead of propagating NaN/Inf downstream.
 * Future environment terms (equirect HDR cubemap, nebula layers) compose
 * additively at the marked point inside createEnvironmentSamplerNode so they
 * share this guard.
 */

import {
  abs,
  bitXor,
  clamp,
  dot,
  float,
  floor,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  normalize,
  pow,
  select,
  uint,
  vec3
} from 'three/tsl';
import type { StarfieldParams } from './starfield.js';

/**
 * Widest TSL float-node type. Inferred rather than imported because the
 * 'three/tsl' entry point does not re-export the base `Node` type; `dot` is
 * declared with a single signature returning `Node<'float'>`.
 */
type FloatNode = ReturnType<typeof dot>;

/** Widest TSL u32-node type (the u32 overload is last on the bit operators). */
type UintNode = ReturnType<typeof bitXor>;

/** Structural view of any TSL vec3 node's swizzled components. */
interface Vec3Components {
  readonly x: FloatNode;
  readonly y: FloatNode;
  readonly z: FloatNode;
}

/** u32 -> [0, 1) scale factor; identical constant on CPU and GPU. */
const U32_TO_UNIT = 1 / 4294967296;

/**
 * Finite HDR ceiling for the section 14 guard. Legitimate starfield radiance
 * is O(10); the ceiling only catches runaway +Inf/huge upstream values.
 */
const ENV_RADIANCE_CEILING = 1e6;

/**
 * Builds a TSL graph computing the procedural starfield radiance for a
 * direction node, numerically mirroring `sampleStarfieldRadiance` from
 * src/shaders/starfield.ts.
 *
 * @param params Baked parameter set (build it with `makeStarfieldParams` so
 *   it is validated before reaching this factory).
 * @returns Closure mapping a normalized vec3 direction node to a linear-HDR
 *   vec3 radiance node. Typed `unknown` at the boundary to keep this module
 *   decoupled from consumer node typing; the values are ordinary TSL nodes.
 */
export function createStarfieldSamplerNode(
  params: StarfieldParams
): (direction: unknown) => unknown {
  // --- Parameters baked once as literal constants (CPU f64 -> shader f32) ---
  const nCells = params.cellsPerFaceSide;
  const nMinus1 = nCells - 1;
  const seedConst = uint(params.seed >>> 0);
  const densityConst = params.starDensity;
  const cosRadiusConst = Math.cos(params.starAngularRadius);

  /**
   * One PCG-XSH-RR-flavored mixing step, op-for-op identical to hashU32 in
   * src/shaders/starfield.ts. Exact vs the CPU: WGSL u32 mul/xor/shift wrap
   * and truncate exactly like Math.imul + unsigned shifts.
   */
  const hashU32 = (x: UintNode): UintNode => {
    // h = (x ^ seed) >>> 0
    let h: UintNode = x.bitXor(seedConst);
    // h = imul(h, 0x68bc21eb)
    h = h.mul(uint(0x68bc21eb));
    // h = (h ^ (h >>> 13)) >>> 0
    h = h.bitXor(h.shiftRight(uint(13)));
    // h = imul(h, 0x02e169be)
    h = h.mul(uint(0x02e169be));
    // h = (h ^ (h >>> 16)) >>> 0
    h = h.bitXor(h.shiftRight(uint(16)));
    return h;
  };

  /** u32ToUnit: float(h) * (1 / 2^32). See header for the f32 caveat. */
  const u32ToUnit = (h: UintNode): FloatNode => float(h).mul(U32_TO_UNIT);

  /** packCellKey: ((face * 1024 + i) * 1024 + j) on wrapping u32 lanes. */
  const packCellKey = (face: UintNode, i: UintNode, j: UintNode): UintNode =>
    face.mul(uint(1024)).add(i).mul(uint(1024)).add(j);

  /**
   * Inverse CDF of the bounded power law p(b) ∝ b^-alpha on
   * [minBrightness, maxBrightness]. Branch structure mirrors the CPU
   * sampleBrightness; the alpha === 1 test happens at bake time.
   */
  const sampleBrightness = (u: FloatNode): FloatNode => {
    // uu = min(max(u, 0), 1 - 1e-9)
    const uu = min(max(u, 0), 1 - 1e-9);
    if (params.brightnessExponent === 1) {
      // Log-uniform limit: bMin * (bMax / bMin)^uu
      return float(params.minBrightness).mul(
        pow(float(params.maxBrightness / params.minBrightness), uu)
      );
    }
    const a = 1 - params.brightnessExponent;
    // (bMin^a + uu * (bMax^a - bMin^a))^(1/a); powers of the bounds are f64
    // constants baked above the graph.
    const base = float(Math.pow(params.minBrightness, a));
    const span = float(Math.pow(params.maxBrightness, a) - Math.pow(params.minBrightness, a));
    return pow(base.add(uu.mul(span)), float(1 / a));
  };

  return (direction: unknown) => {
    // Boundary cast: consumers pass any TSL vec3 node (a normalize() output,
    // a varying, ...); swizzled float components exist on every vec3 node.
    const dir = direction as Vec3Components;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;

    // --- Dominant-axis cube-face decomposition (directionToCubeCell) ---
    // WEBGL2 CONSTRAINT: TSL select()/and() wrap their branches in
    // IsolateNodes; deeply NESTED conditionals make the WebGL2 backend's GLSL
    // flow stage resolve types through an IsolateNode whose VarNode has no
    // base stack ("Cannot read properties of undefined (reading
    // 'addToStack')" in VarNode.build — WebGPU is unaffected). The whole
    // sampler is therefore BRANCH-FREE: every decision below is a flat 0/1
    // weight from a single-level select with constant leaves, combined by
    // arithmetic. Semantics are identical to the CPU reference.
    const ax = abs(dx);
    const ay = abs(dy);
    const az = abs(dz);

    const one = float(1);
    const zero = float(0);

    // Winning-axis weights (mutually exclusive, sum to exactly 1):
    //   wX = (ax >= ay && ax >= az); wY = !wX && ay >= az; wZ = remainder.
    const wX = select(ax.greaterThanEqual(ay), one, zero).mul(
      select(ax.greaterThanEqual(az), one, zero)
    );
    const cY = select(ay.greaterThanEqual(az), one, zero);
    const wY = one.sub(wX).mul(cY);
    const wZ = one.sub(wX).mul(one.sub(cY));

    // Per-face weights: face k gets wAxis * signHalf. f0..f5 sum to 1.
    const posX = select(dx.greaterThanEqual(0), one, zero);
    const posY = select(dy.greaterThanEqual(0), one, zero);
    const posZ = select(dz.greaterThanEqual(0), one, zero);
    const f0 = wX.mul(posX);
    const f1 = wX.mul(one.sub(posX));
    const f2 = wY.mul(posY);
    const f3 = wY.mul(one.sub(posY));
    const f4 = wZ.mul(posZ);
    const f5 = wZ.mul(one.sub(posZ));

    // Face id for the cell key (weights are exact 0/1, so the weighted sum
    // is the exact integer id): 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z.
    const faceF = f1.add(f2.mul(2)).add(f3.mul(3)).add(f4.mul(4)).add(f5.mul(5));
    const face = uint(faceF);

    // Face-plane coordinates per the CPU sign conventions:
    //   u: -z on +/-X faces, x otherwise; v: -y on +/-X and +/-Z faces,
    //   z on +/-Y faces.
    const u = wX.mul(dz.mul(-1)).add(wY.add(wZ).mul(dx));
    const v = wY.mul(dz).add(wX.add(wZ).mul(dy.mul(-1)));

    // ma = max(|x|, |y|, |z|): equals the winning axis magnitude in every
    // branch, so the division below reproduces u / ma and v / ma exactly.
    const ma = max(ax, max(ay, az));

    // Face coordinates in [-1, 1]; a zero direction yields NaN here, which
    // the hasCell gate below turns into the CPU null-cell behavior.
    const fu = u.div(ma);
    const fv = v.div(ma);

    // i = floor((fu * 0.5 + 0.5) * n), clamped to [0, n-1] (the CPU clamps
    // the same f64 roundoff at the +1 edge). Clamp before the uint cast so
    // no negative value ever reaches a float->uint conversion.
    const cellI = uint(clamp(floor(fu.mul(0.5).add(0.5).mul(nCells)), 0, nMinus1));
    const cellJ = uint(clamp(floor(fv.mul(0.5).add(0.5).mul(nCells)), 0, nMinus1));

    // Zero direction (ma === 0) mirrors the CPU null-cell path: background
    // only, no star term.
    const hasCellF = select(ma.greaterThan(0), one, zero);

    // --- Cell hash stream (exact vs CPU) ---
    const key = packCellKey(face, cellI, cellJ);

    // cellHasStar as a 0/1 weight: u32ToUnit(hash(key)) < starDensity.
    const presenceF = select(u32ToUnit(hashU32(key)).lessThan(densityConst), one, zero);

    // starFaceCoords: salted position draws, inset by half a cell.
    const drawI = u32ToUnit(hashU32(key.bitXor(uint(0xa5a5f00d))));
    const drawJ = u32ToUnit(hashU32(key.bitXor(uint(0x1b3c6e97))));

    // fi = (i + 0.5 + (drawI - 0.5)) / n; fu = fi * 2 - 1 (same for j/v).
    const starFu = float(cellI).add(0.5).add(drawI.sub(0.5)).div(nCells).mul(2).sub(1);
    const starFv = float(cellJ).add(0.5).add(drawJ.sub(0.5)).div(nCells).mul(2).sub(1);

    // --- faceCoordsToDirection via per-face weight tables ---
    // Component tables transcribed from the CPU switch:
    //   x: 1, -1, fu, fu, fu, -fu
    //   y: -fv, -fv, 1, -1, fv, fv
    //   z: -fu, fu, fv, -fv, 1, -1
    const xC = f0
      .add(f1.mul(-1))
      .add(f2.add(f3).add(f4).mul(starFu))
      .add(f5.mul(starFu.mul(-1)));
    const yC = f0.add(f1).mul(starFv.mul(-1)).add(f2).add(f3.mul(-1)).add(f4.add(f5).mul(starFv));
    const zC = f0
      .mul(starFu.mul(-1))
      .add(f1.mul(starFu))
      .add(f2.mul(starFv))
      .add(f3.mul(starFv.mul(-1)))
      .add(f4)
      .add(f5.mul(-1));
    const starDir = normalize(vec3(xC, yC, zC));

    // cosAngle = direction . starDir (the CPU sums the same three products).
    const cosAngle = dot(vec3(dx, dy, dz), starDir);

    // starFalloff: 0 when cosAngle <= cosRadius, else
    // t = (cosAngle - cosRadius) / (1 - cosRadius), profile t*t
    // (1 at the star center, 0 at the angular-radius edge). Polynomial only,
    // so CPU and TSL agree tightly. Mirrors the corrected CPU starFalloff.
    const falloffT = max(cosAngle.sub(cosRadiusConst), 0).div(float(1).sub(cosRadiusConst));
    const edgeGate = select(cosAngle.greaterThan(cosRadiusConst), one, zero);
    const falloff = falloffT.mul(falloffT).mul(edgeGate);

    // starBrightness: salted draw through the inverse CDF.
    const brightness = sampleBrightness(u32ToUnit(hashU32(key.bitXor(uint(0x7f4a7c15)))));

    // The CPU early-outs (null cell / no star / zero falloff) all reduce to
    // adding exactly 0, so a single gated contribution reproduces them.
    const contribution = brightness.mul(falloff).mul(presenceF).mul(hasCellF);

    // out = backgroundRadiance + b * falloff on every channel (linear HDR).
    return vec3(
      float(params.backgroundRadiance[0]).add(contribution),
      float(params.backgroundRadiance[1]).add(contribution),
      float(params.backgroundRadiance[2]).add(contribution)
    );
  };
}

/**
 * Environment sampler per docs/SHADER_CONTRACTS.md section 9: composes the
 * procedural starfield term with the section 14 non-finite clamp, ready for
 * later additive terms (equirect HDR cubemap, nebula layers).
 *
 * @param params Baked parameter set (see {@link createStarfieldSamplerNode}).
 * @returns Closure mapping a normalized vec3 direction node to a sanitized
 *   linear-HDR vec3 radiance node.
 */
export function createEnvironmentSamplerNode(
  params: StarfieldParams,
  cinematicDetail?: unknown
): (direction: unknown) => unknown {
  const sampleStars = createStarfieldSamplerNode(params);
  const cinematic = params.cinematic;
  const detail =
    cinematicDetail === undefined
      ? float(cinematic === undefined ? 0 : 1)
      : (cinematicDetail as FloatNode);
  const environmentSeed = uint(params.seed >>> 0);
  const environmentHash = (x: UintNode): UintNode => {
    let h: UintNode = x.bitXor(environmentSeed);
    h = h.mul(uint(0x68bc21eb));
    h = h.bitXor(h.shiftRight(uint(13)));
    h = h.mul(uint(0x02e169be));
    return h.bitXor(h.shiftRight(uint(16)));
  };
  const environmentUnit = (h: UintNode): FloatNode => float(h).mul(U32_TO_UNIT);
  const environmentPackCell = (face: UintNode, i: UintNode, j: UintNode): UintNode =>
    face.mul(uint(1024)).add(i).mul(uint(1024)).add(j);

  /** Additive V2 environment terms; all values remain linear HDR. */
  const sampleCinematicLayer = (direction: unknown): FloatNode[] => {
    if (cinematic === undefined) return [float(0), float(0), float(0)];
    const dir = direction as Vec3Components;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;
    const ax = abs(dx);
    const ay = abs(dy);
    const az = abs(dz);
    const one = float(1);
    const zero = float(0);
    const wX = select(ax.greaterThanEqual(ay), one, zero).mul(
      select(ax.greaterThanEqual(az), one, zero)
    );
    const cY = select(ay.greaterThanEqual(az), one, zero);
    const wY = one.sub(wX).mul(cY);
    const wZ = one.sub(wX).mul(one.sub(cY));
    const posX = select(dx.greaterThanEqual(0), one, zero);
    const posY = select(dy.greaterThanEqual(0), one, zero);
    const posZ = select(dz.greaterThanEqual(0), one, zero);
    const f0 = wX.mul(posX);
    const f1 = wX.mul(one.sub(posX));
    const f2 = wY.mul(posY);
    const f3 = wY.mul(one.sub(posY));
    const f4 = wZ.mul(posZ);
    const f5 = wZ.mul(one.sub(posZ));
    const faceF = f1.add(f2.mul(2)).add(f3.mul(3)).add(f4.mul(4)).add(f5.mul(5));
    const face = uint(faceF);
    const u = wX.mul(dz.mul(-1)).add(wY.add(wZ).mul(dx));
    const v = wY.mul(dz).add(wX.add(wZ).mul(dy.mul(-1)));
    const ma = max(ax, max(ay, az));
    const fu = u.div(ma);
    const fv = v.div(ma);
    const n = cinematic.denseCellsPerFaceSide;
    const denseI = uint(clamp(floor(fu.mul(0.5).add(0.5).mul(n)), 0, n - 1));
    const denseJ = uint(clamp(floor(fv.mul(0.5).add(0.5).mul(n)), 0, n - 1));
    const key = environmentPackCell(face, denseI, denseJ);
    const present = select(
      environmentUnit(environmentHash(key)).lessThan(cinematic.denseStarDensity),
      one,
      zero
    );
    const drawI = environmentUnit(environmentHash(key.bitXor(uint(0xa5a5f00d))));
    const drawJ = environmentUnit(environmentHash(key.bitXor(uint(0x1b3c6e97))));
    const starFu = float(denseI).add(0.5).add(drawI.sub(0.5)).div(n).mul(2).sub(1);
    const starFv = float(denseJ).add(0.5).add(drawJ.sub(0.5)).div(n).mul(2).sub(1);
    const xC = f0
      .add(f1.mul(-1))
      .add(f2.add(f3).add(f4).mul(starFu))
      .add(f5.mul(starFu.mul(-1)));
    const yC = f0.add(f1).mul(starFv.mul(-1)).add(f2).add(f3.mul(-1)).add(f4.add(f5).mul(starFv));
    const zC = f0
      .mul(starFu.mul(-1))
      .add(f1.mul(starFu))
      .add(f2.mul(starFv))
      .add(f3.mul(starFv.mul(-1)))
      .add(f4)
      .add(f5.mul(-1));
    const starDir = normalize(vec3(xC, yC, zC));
    const cosAngle = dot(vec3(dx, dy, dz), starDir);
    const cosRadius = Math.cos(cinematic.denseStarAngularRadius);
    const falloffT = max(cosAngle.sub(cosRadius), 0).div(float(1).sub(cosRadius));
    const falloff = falloffT.mul(falloffT).mul(select(cosAngle.greaterThan(cosRadius), one, zero));
    const uu = min(
      max(environmentUnit(environmentHash(key.bitXor(uint(0x7f4a7c15)))), 0),
      1 - 1e-9
    );
    const a = 1 - cinematic.denseBrightnessExponent;
    const denseBrightness =
      cinematic.denseBrightnessExponent === 1
        ? float(cinematic.denseMinBrightness).mul(
            pow(cinematic.denseMaxBrightness / cinematic.denseMinBrightness, uu)
          )
        : pow(
            float(Math.pow(cinematic.denseMinBrightness, a)).add(
              uu.mul(
                Math.pow(cinematic.denseMaxBrightness, a) -
                  Math.pow(cinematic.denseMinBrightness, a)
              )
            ),
            float(1 / a)
          );
    const temperature = environmentUnit(environmentHash(key.bitXor(uint(0x50f3a9d1))));
    const warm = vec3(1, 0.48, 0.2);
    const cool = vec3(0.72, 0.86, 1);
    const dense = mix(warm, cool, temperature).mul(
      denseBrightness
        .mul(falloff)
        .mul(present)
        .mul(select(ma.greaterThan(0), one, zero))
    );

    const band = one.sub(abs(dy)).clamp(0, 1).pow(2.2);
    const diffuse = vec3(
      cinematic.diffuseRadiance[0],
      cinematic.diffuseRadiance[1],
      cinematic.diffuseRadiance[2]
    ).mul(band.mul(cinematic.galacticBandStrength));
    const dustNoise = mx_fractal_noise_float(
      vec3(dx.mul(2.8), dy.mul(2.8).add(params.seed * 0.00001), dz.mul(2.8)),
      3,
      2.0,
      0.5
    )
      .mul(0.5)
      .add(0.5);
    const dust = vec3(
      cinematic.dustRadiance[0],
      cinematic.dustRadiance[1],
      cinematic.dustRadiance[2]
    ).mul(band.mul(dustNoise.mul(0.55).add(0.45)).mul(cinematic.nebulaStrength));
    const layer = dense.add(diffuse).add(dust).mul(detail);
    return [layer.x, layer.y, layer.z];
  };

  return (direction: unknown) => {
    // Composition point: later environment terms append ADDITIVELY here so
    // they share the section 14 guard below. Only stars exist today.
    const starsOnly = sampleStars(direction) as Vec3Components;
    const cinematicLayer = sampleCinematicLayer(direction);
    const radiance = {
      x: starsOnly.x.add(cinematicLayer[0]!),
      y: starsOnly.y.add(cinematicLayer[1]!),
      z: starsOnly.z.add(cinematicLayer[2]!)
    };

    // Per-channel guard: NaN (c != c holds only for IEEE NaN) -> 0, i.e. an
    // explicit black-sky numerical failure; negatives and -Inf -> 0 via
    // max(c, 0); +Inf/runaway magnitudes -> ENV_RADIANCE_CEILING.
    const sanitize = (c: FloatNode): FloatNode =>
      min(max(select(c.notEqual(c), 0, c), 0), ENV_RADIANCE_CEILING);

    return vec3(sanitize(radiance.x), sanitize(radiance.y), sanitize(radiance.z));
  };
}
