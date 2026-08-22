/**
 * Stellar Explosion volume density field — ONE formula family, two faces
 * (CA4-05).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 3 (density model):
 *
 *     rho(p,t) = shell(r, R(t), width)
 *              x angularAsymmetry(direction)
 *              x clumpingNoise(p,t)
 *              x radialFalloff(r,t)
 *
 * - docs/cosmic-atlas/RENDERING_SERVICES.md section 4 (VolumeService density
 *   callback receives TSL nodes; procedural fields instead of dense grids);
 * - mission sections 24/29/30 (non-negativity, finiteness, bounded volume,
 *   deterministic seed, morphology-only clumping, bounded asymmetry).
 *
 * COHERENCE CONTRACT: the CPU evaluator ({@link cpuDensity}) and the TSL
 * graph ({@link buildTslDensityField}) implement the SAME formulas with the
 * SAME constants, including the shared sin-lattice hash (ParticleService's
 * gpuHash01 convention). They serve unit/reference tests and the VolumeService
 * march respectively. Known unavoidable divergence: CPU binary64 vs GPU f32,
 * so bit equality across backends is NOT claimed (same policy as
 * ParticleService).
 *
 * Purity: all pure functions of their arguments. The hash replaces
 * Math.random everywhere; identical (seed, position, time) reproduces
 * identical density on each backend.
 */

import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import {
  abs,
  dot,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  uniform,
  vec3
} from 'three/tsl';

import { SHELL_SUPPORT, shellProfile } from './shockShell.js';
import { shockRadiusUnits } from './physics.js';
import type { ResolvedScenario } from './types.js';

// ---------------------------------------------------------------------------
// Shared constants (single source of truth for both backends)
// ---------------------------------------------------------------------------

/** Asymmetry power (lobe sharpness). Higher = more collimated deformation. */
export const ASYMMETRY_POWER = 2;

/**
 * Upper bound of the multiplicative asymmetry factor: 1 + anisotropyStrength
 * <= 2 under valid state. With clumping <= 1 and falloff <= 1 this bounds
 * rho <= {@link MAX_DENSITY_FACTOR} x baseDensity.
 */
export const MAX_ASYMMETRY_FACTOR = 2;

/** Documented global bound: rho(p,t) <= MAX_DENSITY_FACTOR x baseDensity. */
export const MAX_DENSITY_FACTOR = MAX_ASYMMETRY_FACTOR;

/**
 * Clumping-noise base frequency (lattice cells across a shell radius),
 * drift rate per second, and octave weights. Positions are normalized by
 * R(t) before hashing so lattice coordinates stay O(10) and the sin-hash
 * stays well-conditioned in f32.
 */
const CLUMP_FREQUENCY = 5;
const CLUMP_DRIFT_PER_SECOND = 0.02;
const OCTAVE1_WEIGHT = 0.65;
const OCTAVE2_WEIGHT = 0.35;

/** Shell-width fraction/floor duplicated from shockShell for the GPU path. */
const WIDTH_FRACTION = 0.16;
const MIN_WIDTH_UNITS = 0.05;

// ---------------------------------------------------------------------------
// Deterministic hash + value noise (shared shape on CPU and GPU)
// ---------------------------------------------------------------------------

/**
 * Lattice hash shared VERBATIM between CPU (binary64) and GPU (f32) paths,
 * mirroring ParticleService's gpuHash01. Output nominally in [0, 1).
 */
function hash01Cpu(x: number): number {
  const v = Math.sin(x * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Trilinear value noise in [0, 1] over an integer-seeded lattice.
 * `q` components should be O(1..100) (callers normalize by R(t)).
 */
export function valueNoise3Cpu(qx: number, qy: number, qz: number, seed: number): number {
  const xi = Math.floor(qx);
  const yi = Math.floor(qy);
  const zi = Math.floor(qz);
  const fx = qx - xi;
  const fy = qy - yi;
  const fz = qz - zi;
  // Smoothstep lattice interpolation for C1-looking morphology.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);

  // Corner hash: deterministic fold of (lattice cell, seed) into one scalar.
  const corner = (i: number, j: number, k: number): number =>
    hash01Cpu(i * 127.1 + j * 311.7 + k * 74.7 + seed * 269.5);

  const c000 = corner(xi, yi, zi);
  const c100 = corner(xi + 1, yi, zi);
  const c010 = corner(xi, yi + 1, zi);
  const c110 = corner(xi + 1, yi + 1, zi);
  const c001 = corner(xi, yi, zi + 1);
  const c101 = corner(xi + 1, yi, zi + 1);
  const c011 = corner(xi, yi + 1, zi + 1);
  const c111 = corner(xi + 1, yi + 1, zi + 1);

  const x00 = c000 + (c100 - c000) * sx;
  const x10 = c010 + (c110 - c010) * sx;
  const x01 = c001 + (c101 - c001) * sx;
  const x11 = c011 + (c111 - c011) * sx;
  const y0 = x00 + (x10 - x00) * sy;
  const y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
}

/**
 * Two-octave clumping term in [0, 1]. Octave weights are fixed constants so
 * changing ONLY the seed changes the pattern while preserving statistics
 * (mission section 29: seed changes morphology, never bulk evolution).
 */
function clump01Cpu(
  px: number,
  py: number,
  pz: number,
  radius: number,
  tSeconds: number,
  resolved: ResolvedScenario
): number {
  const invR = CLUMP_FREQUENCY / Math.max(radius, 1e-6);
  const drift = tSeconds * CLUMP_DRIFT_PER_SECOND;
  const s = resolved.clumpingSeed % 1000;
  const n1 = valueNoise3Cpu(px * invR + drift + s, py * invR - drift, pz * invR + s * 0.37, s);
  const n2 = valueNoise3Cpu(
    px * invR * 2.17 - drift,
    py * invR * 2.17 + drift + s,
    pz * invR * 2.17,
    s + 977
  );
  return Math.min(1, Math.max(0, OCTAVE1_WEIGHT * n1 + OCTAVE2_WEIGHT * n2));
}

// ---------------------------------------------------------------------------
// Angular asymmetry + radial falloff (CPU reference forms)
// ---------------------------------------------------------------------------

/**
 * Angular asymmetry factor in [1, 1 + anisotropyStrength]: bipolar lobes
 * along the axis blended toward a unipolar lobe by lobeWeighting. Bounded
 * (mission section 30); no preset becomes a jet through this factor alone.
 */
export function angularAsymmetryCpu(
  dirX: number,
  dirY: number,
  dirZ: number,
  resolved: ResolvedScenario
): number {
  const d = dirX * resolved.axis[0]! + dirY * resolved.axis[1]! + dirZ * resolved.axis[2]!;
  const bipolar = Math.pow(Math.min(1, Math.abs(d)), ASYMMETRY_POWER);
  const unipolar = Math.pow(Math.min(1, Math.max(0, d)), ASYMMETRY_POWER);
  const shaped = (1 - resolved.lobeWeighting) * bipolar + resolved.lobeWeighting * unipolar;
  return 1 + resolved.anisotropyStrength * shaped;
}

/** Mild global falloff in (0, 1]; keeps the inner cavity faint. */
function radialFalloffCpu(r: number, radius: number): number {
  const rr = r / Math.max(2 * radius, 1e-9);
  return 1 / (1 + rr * rr * rr);
}

// ---------------------------------------------------------------------------
// Base density normalization (mass-proxy driven, disclosed scale)
// ---------------------------------------------------------------------------

/**
 * Visual-extinction proxy scale derived from the ejecta mass proxy. Units
 * are dimensionless (they feed the VolumeService absorption exponent, itself
 * a disclosed presentation parameter — NOT g/cm^2).
 */
export function baseDensity(resolved: ResolvedScenario): number {
  const m = Math.min(1, resolved.ejectaMassProxySolar / 10);
  return 0.35 + 0.65 * m;
}

// ---------------------------------------------------------------------------
// CPU reference evaluator
// ---------------------------------------------------------------------------

/**
 * CPU (binary64) evaluation of the full density model at world point
 * (x,y,z) on the simulation clock `tSeconds`. Returns a finite,
 * non-negative value bounded by {@link MAX_DENSITY_FACTOR} x
 * {@link baseDensity}; safe as a unit-test oracle and debug probe. Points
 * outside the bounded shell support short-circuit to 0 (mission section 24).
 */
export function cpuDensity(
  x: number,
  y: number,
  z: number,
  tSeconds: number,
  resolved: ResolvedScenario
): number {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    !Number.isFinite(tSeconds)
  ) {
    return 0;
  }
  const age = Math.max(0, tSeconds - resolved.explosionTimeSeconds);
  const radius = shockRadiusUnits(age, resolved);
  if (radius <= 0) return 0;
  const width = Math.max(radius * WIDTH_FRACTION, MIN_WIDTH_UNITS);

  const r = Math.hypot(x, y, z);
  if (r > radius + SHELL_SUPPORT * width) return 0;

  const shell = shellProfile(r, radius, width);
  if (shell <= 0) return 0;

  const invLen = r > 1e-12 ? 1 / r : 0;
  const asym = angularAsymmetryCpu(x * invLen, y * invLen, z * invLen, resolved);
  const clump =
    1 -
    resolved.clumpingLevel +
    resolved.clumpingLevel * clump01Cpu(x, y, z, radius, tSeconds, resolved);
  const value = baseDensity(resolved) * shell * asym * clump * radialFalloffCpu(r, radius);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// ---------------------------------------------------------------------------
// TSL face (VolumeService march) — uniforms + graph
// ---------------------------------------------------------------------------

/**
 * Per-frame uniform bundle for the TSL density graph. Node types are
 * deliberately INFERRED via ReturnType (see neutronStarModule.ts): under
 * @types/three 0.185 `uniform`'s generic parameter is a UniformValue KEY,
 * so explicit UniformNode annotations lose branding; inference tracks the
 * shipped overloads exactly.
 */
function createDensityUniforms() {
  return {
    /** Characteristic shell radius R(t), scene units. Mutated per frame. */
    shellRadius: uniform(1),
    /** Shell width w(t), scene units. Mutated per frame. */
    shellWidth: uniform(0.16),
    /** Simulation clock driving clump drift, seconds. Mutated per frame. */
    timeSeconds: uniform(0),
    /** Unit-length asymmetry axis. Vector3 held BY REFERENCE and mutated. */
    axis: uniform(new THREE.Vector3(0, 1, 0)),
    anisotropyStrength: uniform(0),
    lobeWeighting: uniform(0),
    clumpingLevel: uniform(0),
    /** Folded clumping seed (lattice offset domain; see configure below). */
    seedFold: uniform(0),
    baseDensityValue: uniform(1)
  };
}

/** Inferred bundle type (see note above). */
export type DensityUniformBundle = ReturnType<typeof createDensityUniforms>;

/**
 * Create the uniform bundle with neutral placeholders. Callers overwrite
 * every field through {@link configureDensityUniforms} before the first
 * frame; the axis Vector3 must be mutated component-wise, never replaced.
 */
export function createExplosionDensityUniforms(): DensityUniformBundle {
  return createDensityUniforms();
}

/**
 * Copy derived constants from a resolved scenario into the bundle. Per-frame
 * quantities start at their t=0 values; the destination module updates
 * shellRadius/shellWidth/timeSeconds each frame from its timeline state.
 */
export function configureDensityUniforms(
  u: DensityUniformBundle,
  resolved: ResolvedScenario
): void {
  u.shellRadius.value = 0;
  u.shellWidth.value = MIN_WIDTH_UNITS;
  u.timeSeconds.value = 0;
  u.axis.value.set(resolved.axis[0]!, resolved.axis[1]!, resolved.axis[2]!);
  u.anisotropyStrength.value = resolved.anisotropyStrength;
  u.lobeWeighting.value = resolved.lobeWeighting;
  u.clumpingLevel.value = resolved.clumpingLevel;
  // Fold the integer seed into the lattice-offset domain of the hash
  // (identical fold to the CPU path's `resolved.clumpingSeed % 1000`).
  u.seedFold.value = resolved.clumpingSeed % 1000;
  u.baseDensityValue.value = baseDensity(resolved);
}

/**
 * Build the TSL density callback for VolumeService (`config.density` shape:
 * `(args: { pos, dir }) => Node<'float'>`). Implements the SAME formulas and
 * constants as {@link cpuDensity}; see the module header for the precision
 * divergence disclosure. Method-chain form (.mul/.add) preserves literal
 * node-type branding under @types/three 0.185.
 */
export function buildTslDensityField(
  u: DensityUniformBundle
): (args: { pos: unknown; dir: unknown }) => Node<'float'> {
  void u.timeSeconds; // consumed via drift below

  return ({ pos }) => {
    const p = vec3(pos as Node<'vec3'>);
    const r = length(p);

    // --- shell factor -----------------------------------------------------
    const dist = abs(r.sub(u.shellRadius));
    const gaussArg = dist.div(u.shellWidth.max(MIN_WIDTH_UNITS));
    const gaussian = gaussArg.mul(gaussArg).negate().exp();
    const edge = min(dist.div(u.shellWidth.max(MIN_WIDTH_UNITS).mul(SHELL_SUPPORT)), 1);
    const window = edge.mul(edge).mul(3).sub(edge.mul(edge).mul(2)).oneMinus();
    const shell = gaussian.mul(window);

    // --- angular asymmetry --------------------------------------------------
    const dirN = normalize(p.max(vec3(1e-9)));
    const dAxis = dot(dirN, u.axis);
    const bipolar = pow(abs(dAxis), ASYMMETRY_POWER);
    const unipolar = pow(max(dAxis, 0), ASYMMETRY_POWER);
    const shaped = mix(bipolar, unipolar, u.lobeWeighting);
    const asym = u.anisotropyStrength.mul(shaped).add(1);

    // --- clumping (two-octave trilinear value noise, sin-hash lattice) -----
    const invR = u.shellRadius.max(1e-6).reciprocal().mul(CLUMP_FREQUENCY);
    const drift = u.timeSeconds.mul(CLUMP_DRIFT_PER_SECOND);
    const s = u.seedFold;

    // Octave 1 lattice coordinate (matches clump01Cpu exactly).
    const q1 = vec3(
      p.x.mul(invR).add(drift).add(s),
      p.y.mul(invR).sub(drift),
      p.z.mul(invR).add(s.mul(0.37))
    );
    // Octave 2 lattice coordinate (matches clump01Cpu exactly).
    const q2 = vec3(
      p.x.mul(invR).mul(2.17).sub(drift),
      p.y.mul(invR).mul(2.17).add(drift).add(s),
      p.z.mul(invR).mul(2.17)
    );

    const n1 = valueNoise3Tsl(q1, s);
    const n2 = valueNoise3Tsl(q2, s.add(977));
    const clumpN = min(n1.mul(OCTAVE1_WEIGHT).add(n2.mul(OCTAVE2_WEIGHT)), 1);
    const clumpTerm = u.clumpingLevel.oneMinus().add(u.clumpingLevel.mul(clumpN));

    // --- radial falloff -------------------------------------------------------
    const rr = r.div(u.shellRadius.max(1e-6).mul(2));
    const fall = rr.mul(rr).mul(rr).add(1).reciprocal();

    // --- combine, clamped non-negative ------------------------------------
    const rho = u.baseDensityValue.mul(shell).mul(asym).mul(clumpTerm).mul(fall);
    return max(rho, 0);
  };
}

/** GPU twin of the CPU corner hash (same constants, fract(sin) form). */
function cornerHashTsl(fold: Node<'float'>): Node<'float'> {
  return fract(sin(fold.mul(12.9898)).mul(43758.5453));
}

/**
 * Trilinear value-noise graph over lattice coordinate `q` with seed fold
 * `s`. Mirrors valueNoise3Cpu line-for-line (same corner constants, same
 * smoothstep weights).
 */
function valueNoise3Tsl(q: Node<'vec3'>, s: Node<'float'>): Node<'float'> {
  const xi = floor(q.x);
  const yi = floor(q.y);
  const zi = floor(q.z);
  const sx = smoothstep(0, 1, q.x.sub(xi));
  const sy = smoothstep(0, 1, q.y.sub(yi));
  const sz = smoothstep(0, 1, q.z.sub(zi));

  const corner = (i: Node<'float'>, j: Node<'float'>, k: Node<'float'>): Node<'float'> =>
    cornerHashTsl(i.mul(127.1).add(j.mul(311.7)).add(k.mul(74.7)).add(s.mul(269.5)));

  const c000 = corner(xi, yi, zi);
  const c100 = corner(xi.add(1), yi, zi);
  const c010 = corner(xi, yi.add(1), zi);
  const c110 = corner(xi.add(1), yi.add(1), zi);
  const c001 = corner(xi, yi, zi.add(1));
  const c101 = corner(xi.add(1), yi, zi.add(1));
  const c011 = corner(xi, yi.add(1), zi.add(1));
  const c111 = corner(xi.add(1), yi.add(1), zi.add(1));

  const x00 = mix(c000, c100, sx);
  const x10 = mix(c010, c110, sx);
  const x01 = mix(c001, c101, sx);
  const x11 = mix(c011, c111, sx);
  const y0 = mix(x00, x10, sy);
  const y1 = mix(x01, x11, sy);
  return mix(y0, y1, sz);
}
