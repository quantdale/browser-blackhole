/**
 * Shared cinematic representation primitives.
 *
 * These are presentation-layer materials, not physics.  Destinations supply
 * already-resolved model values (temperature, radius, gain, seed and model
 * time); the primitives add bounded spatial structure so a physical/procedural
 * object does not collapse into a flat unlit card.  Every graph is built from
 * Three.js TSL and therefore follows the same WebGPU-preferred/WebGL2 fallback
 * path as the rest of the atlas.
 *
 * Determinism rules:
 * - all variation is derived from the supplied seed and model time;
 * - no shader global time or wall-clock reads are used;
 * - paused frames are stable because the caller controls the time uniform;
 * - geometry/material ownership remains with the destination ResourceScope.
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  asin,
  atan,
  cameraPosition,
  clamp,
  dot,
  floor,
  fract,
  hash,
  length,
  mix,
  mx_fractal_noise_float,
  normalLocal,
  normalize,
  oneMinus,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4
} from 'three/tsl';

import type { QualityTier } from '../../atlas/types';

const TAU = Math.PI * 2;
const MIN_INTENSITY = 0;
const MAX_INTENSITY = 32;
const MIN_BACKDROP_RADIUS = 128;
const BACKDROP_RADIUS_MARGIN = 128;
const BACKDROP_RADIUS_FRACTION = 0.12;

/** Bounded visual-detail knobs selected once by the global quality tier. */
export interface CinematicDetail {
  backdropSegments: { width: number; height: number };
  backdropOctaves: number;
  surfaceOctaves: number;
  haloSegments: { width: number; height: number };
}

export const CINEMATIC_DETAIL_BY_TIER: Readonly<Record<QualityTier, CinematicDetail>> = {
  low: {
    backdropSegments: { width: 24, height: 16 },
    backdropOctaves: 2,
    surfaceOctaves: 2,
    haloSegments: { width: 20, height: 12 }
  },
  medium: {
    backdropSegments: { width: 32, height: 20 },
    backdropOctaves: 3,
    surfaceOctaves: 3,
    haloSegments: { width: 28, height: 18 }
  },
  high: {
    backdropSegments: { width: 48, height: 28 },
    backdropOctaves: 4,
    surfaceOctaves: 4,
    haloSegments: { width: 36, height: 24 }
  },
  ultra: {
    backdropSegments: { width: 64, height: 36 },
    backdropOctaves: 5,
    surfaceOctaves: 5,
    haloSegments: { width: 48, height: 32 }
  }
};

/** Stable scalar seed fold shared by every primitive. */
export function cinematicSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0.137;
  const integer = Math.abs(Math.trunc(seed)) >>> 0;
  let mixed = integer ^ 0x9e3779b9;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
  mixed = (mixed ^ (mixed >>> 16)) >>> 0;
  return (mixed % 100000) / 1000 + 0.137;
}

/** Clamp a presentation gain without permitting NaN/Infinity into a graph. */
export function cinematicIntensity(value: number, fallback = 1): number {
  const safeFallback = Number.isFinite(fallback) ? fallback : 1;
  const candidate = Number.isFinite(value) ? value : safeFallback;
  return THREE.MathUtils.clamp(candidate, MIN_INTENSITY, MAX_INTENSITY);
}

export interface CinematicSurfaceOptions {
  tint: readonly [number, number, number];
  /** Secondary tint used by deterministic granulation/temperature variation. */
  secondaryTint?: readonly [number, number, number];
  seed: number;
  radiance?: number;
  noiseScale?: number;
  noiseStrength?: number;
  rimStrength?: number;
  noiseOctaves?: number;
  transparent?: boolean;
  blending?: THREE.Blending;
  side?: THREE.Side;
}

export interface CinematicMaterialHandle {
  readonly material: MeshBasicNodeMaterial;
  setTint(tint: readonly [number, number, number]): void;
  setSecondaryTint(tint: readonly [number, number, number]): void;
  setGain(gain: number): void;
  setTime(time: number): void;
  dispose(): void;
}

/**
 * Emissive surface with analytic limb response and seeded granulation.
 *
 * The limb term is deliberately a display approximation: it communicates a
 * resolved photosphere/compact surface without claiming an atmosphere solver.
 * `normalLocal` is used instead of position so the primitive remains correct
 * when a destination applies a model-driven local deformation.
 */
export function createCinematicSurfaceMaterial(
  options: CinematicSurfaceOptions
): CinematicMaterialHandle {
  const tint = uniform(toVector3(options.tint, [1, 1, 1]));
  const secondaryTint = uniform(toVector3(options.secondaryTint ?? options.tint, [1, 1, 1]));
  const gain = uniform(cinematicIntensity(options.radiance ?? 1));
  const modelTime = uniform(0);
  const seed = uniform(cinematicSeed(options.seed));

  const material = new MeshBasicNodeMaterial();
  material.transparent = options.transparent === true;
  material.depthWrite = !material.transparent;
  material.depthTest = true;
  material.side = options.side ?? THREE.FrontSide;
  if (options.blending !== undefined) material.blending = options.blending;
  material.userData['cinematicEmissive'] = true;

  const surfaceNormal = normalize(normalLocal);
  const view = normalize(cameraPosition.sub(positionWorld));
  const facing = clamp(dot(surfaceNormal, view), 0, 1);
  // A fractional limb exponent keeps the center broad and the silhouette
  // readable at low internal resolution.
  const limb = facing.pow(0.42);
  const rim = oneMinus(facing).pow(2.2);

  const octaves = Math.max(1, Math.min(6, Math.floor(options.noiseOctaves ?? 3)));
  const scale = Math.max(0.01, options.noiseScale ?? 3.2);
  const noisePoint = vec3(
    positionLocal.x.mul(scale).add(modelTime.mul(0.017)),
    positionLocal.y.mul(scale).sub(modelTime.mul(0.011)),
    positionLocal.z.mul(scale).add(seed.mul(0.013))
  );
  const grain = mx_fractal_noise_float(noisePoint, octaves, 2.0, 0.5).mul(0.5).add(0.5);
  const noiseStrength = clamp(options.noiseStrength ?? 0.2, 0, 1);
  const granularMix = grain.sub(0.5).mul(noiseStrength).add(0.5);
  const localColor = mix(tint, secondaryTint, granularMix);
  const intensity = limb
    .mul(0.7)
    .add(rim.mul(options.rimStrength ?? 1.6))
    .add(0.18);
  const granulation = grain.mul(0.24).add(0.88);

  material.colorNode = vec4(localColor.mul(gain).mul(intensity).mul(granulation), 1);

  return {
    material,
    setTint(value) {
      tint.value.copy(toVector3(value, [1, 1, 1]));
    },
    setSecondaryTint(value) {
      secondaryTint.value.copy(toVector3(value, [1, 1, 1]));
    },
    setGain(value) {
      gain.value = cinematicIntensity(value, 0);
    },
    setTime(value) {
      modelTime.value = Number.isFinite(value) ? value : 0;
    },
    dispose() {
      material.dispose();
    }
  };
}

export interface CinematicHaloOptions {
  tint: readonly [number, number, number];
  seed: number;
  gain?: number;
  alpha?: number;
  noiseOctaves?: number;
  noiseScale?: number;
  side?: THREE.Side;
}

/**
 * Additive optically-thin atmosphere/halo. It is a spatial shell with a
 * view-angle profile, not a post-process blur, so the source morphology still
 * reads with bloom disabled.
 */
export function createCinematicHalo(options: CinematicHaloOptions): CinematicMaterialHandle {
  const tint = uniform(toVector3(options.tint, [1, 1, 1]));
  const gain = uniform(cinematicIntensity(options.gain ?? 1));
  const alpha = Math.max(0, Math.min(1, options.alpha ?? 0.35));
  const modelTime = uniform(0);
  const seed = uniform(cinematicSeed(options.seed));

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = options.side ?? THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  material.userData['cinematicEmissive'] = true;

  const surfaceNormal = normalize(normalLocal);
  const view = normalize(cameraPosition.sub(positionWorld));
  const edge = oneMinus(dot(surfaceNormal, view).abs()).pow(1.65);
  const radialNoise = mx_fractal_noise_float(
    vec3(
      positionLocal.x.mul(options.noiseScale ?? 2.4).add(seed.mul(0.01)),
      positionLocal.y.mul(options.noiseScale ?? 2.4).add(modelTime.mul(0.013)),
      positionLocal.z.mul(options.noiseScale ?? 2.4).sub(seed.mul(0.017))
    ),
    Math.max(1, Math.min(5, Math.floor(options.noiseOctaves ?? 3))),
    2.0,
    0.5
  )
    .mul(0.5)
    .add(0.5);
  const wisps = radialNoise.mul(0.45).add(0.7);
  material.colorNode = vec4(tint.mul(gain).mul(edge.add(0.08)).mul(wisps), edge.mul(alpha));

  return {
    material,
    setTint(value) {
      tint.value.copy(toVector3(value, [1, 1, 1]));
    },
    setSecondaryTint() {
      // Halo has one physically meaningful color; keep the interface symmetric
      // so destinations can hold one representation handle type.
    },
    setGain(value) {
      gain.value = cinematicIntensity(value, 0);
    },
    setTime(value) {
      modelTime.value = Number.isFinite(value) ? value : 0;
    },
    dispose() {
      material.dispose();
    }
  };
}

export interface CinematicShellOptions {
  tint: readonly [number, number, number];
  secondaryTint?: readonly [number, number, number];
  seed: number;
  gain?: number;
  alpha?: number;
  structureScale?: number;
  noiseOctaves?: number;
}

/**
 * Thin structured shell skin for explosive ejecta. The VolumeService remains
 * the authoritative density/emission path; this layer only supplies a stable
 * high-frequency silhouette cue at the shock boundary so a thin shell does not
 * collapse into a uniformly lit disc at reduced internal resolution.
 */
export function createCinematicShellMaterial(
  options: CinematicShellOptions
): CinematicMaterialHandle {
  const tint = uniform(toVector3(options.tint, [1, 1, 1]));
  const secondaryTint = uniform(toVector3(options.secondaryTint ?? options.tint, [1, 1, 1]));
  const gain = uniform(cinematicIntensity(options.gain ?? 1));
  const alpha = Math.max(0, Math.min(1, options.alpha ?? 0.22));
  const phase = uniform(0);
  const seed = uniform(cinematicSeed(options.seed));
  const scale = Math.max(0.2, options.structureScale ?? 4.5);

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  material.userData['cinematicEmissive'] = true;
  material.userData['cinematicRepresentation'] = 'structured-shock-shell';

  const direction = normalize(positionLocal);
  const noise = mx_fractal_noise_float(
    vec3(
      direction.x.mul(scale).add(seed.mul(0.017)),
      direction.y.mul(scale * 1.23).sub(phase.mul(0.011)),
      direction.z.mul(scale * 0.83).add(seed.mul(0.023))
    ),
    Math.max(1, Math.min(5, Math.floor(options.noiseOctaves ?? 3))),
    2.0,
    0.5
  )
    .mul(0.5)
    .add(0.5);
  const ridged = oneMinus(noise.mul(2).sub(1).abs()).pow(2.6);
  const filamentArgument = direction.x
    .mul(scale * 5.2)
    .add(direction.z.mul(scale * 3.1))
    .add(direction.y.mul(scale * 4.1))
    .add(noise.mul(8.0))
    .add(phase.mul(0.016))
    .add(seed.mul(0.031));
  const filamentWave = sin(filamentArgument);
  const filaments = oneMinus(filamentWave.abs()).pow(6.8).mul(noise.mul(0.8).add(0.2));
  const lobe = direction.y.abs().pow(1.35).mul(0.55).add(0.45);
  const structure = ridged.mul(0.42).add(filaments.mul(0.74)).mul(lobe);
  const color = mix(tint, secondaryTint, noise.mul(0.68).add(0.16));
  const viewFacing = oneMinus(dot(normalLocal, normalize(cameraPosition.sub(positionWorld))).abs());
  material.colorNode = vec4(
    color.mul(gain).mul(structure.add(0.18)),
    viewFacing.mul(structure).mul(alpha)
  );

  return {
    material,
    setTint(value) {
      tint.value.copy(toVector3(value, [1, 1, 1]));
    },
    setSecondaryTint(value) {
      secondaryTint.value.copy(toVector3(value, [1, 1, 1]));
    },
    setGain(value) {
      gain.value = cinematicIntensity(value, 0);
    },
    setTime(value) {
      phase.value = Number.isFinite(value) ? value : 0;
    },
    dispose() {
      material.dispose();
    }
  };
}

export interface CinematicBackdropOptions {
  seed: number;
  intensity?: number;
  dustColor?: readonly [number, number, number];
  starColor?: readonly [number, number, number];
  segments?: { width: number; height: number };
  octaves?: number;
  starCells?: { x: number; y: number };
  denseStarCells?: { x: number; y: number };
  denseStarDensity?: number;
  galacticBandStrength?: number;
  nebulaStrength?: number;
}

export interface CinematicBackdropHandle {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, MeshBasicNodeMaterial>;
  readonly geometry: THREE.SphereGeometry;
  readonly material: MeshBasicNodeMaterial;
  setTime(time: number): void;
  setIntensity(value: number): void;
  /** Apply the global environment-detail budget without rebuilding the graph. */
  setDetail(value: number): void;
  syncToCamera(camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

/**
 * Deterministic inside-facing deep-space context for non-fullscreen scenes.
 * A sphere keeps the background tied to camera direction while remaining a
 * single bounded draw; depth is disabled so it cannot interfere with the
 * destination's actual geometry or lensing pass.
 */
export function createCinematicBackdrop(
  options: CinematicBackdropOptions
): CinematicBackdropHandle {
  const segments = options.segments ?? { width: 32, height: 20 };
  const geometry = new THREE.SphereGeometry(1, segments.width, segments.height);
  const material = new MeshBasicNodeMaterial();
  material.name = 'cinematic-deep-space-backdrop';
  material.side = THREE.BackSide;
  material.depthTest = false;
  material.depthWrite = false;

  const modelTime = uniform(0);
  const intensity = uniform(cinematicIntensity(options.intensity ?? 1));
  const detail = uniform(1);
  const seed = uniform(cinematicSeed(options.seed));
  const dust = options.dustColor ?? [0.045, 0.018, 0.09];
  const stars = options.starColor ?? [0.72, 0.86, 1];
  const starCells = options.starCells ?? { x: 180, y: 90 };
  const denseStarCells = options.denseStarCells ?? { x: starCells.x * 4, y: starCells.y * 4 };
  const denseStarDensity = Math.max(0, Math.min(1, options.denseStarDensity ?? 0.2));
  const galacticBandStrength = Math.max(0, Math.min(2, options.galacticBandStrength ?? 1));
  const nebulaStrength = Math.max(0, Math.min(2, options.nebulaStrength ?? 0.55));

  const direction = normalize(positionLocal);
  const longitude = atan(direction.z, direction.x).div(TAU).add(0.5);
  const latitude = asin(direction.y).div(Math.PI).add(0.5);
  const cells = vec2(longitude.mul(starCells.x), latitude.mul(starCells.y));
  const cell = floor(cells);
  const cellId = cell.x.add(cell.y.mul(starCells.x)).add(seed);
  const jitter = vec2(hash(cellId.add(11.7)), hash(cellId.add(47.3))).sub(0.5);
  const local = fract(cells).sub(0.5).sub(jitter.mul(0.72));
  const starRadius = hash(cellId.add(83.1)).mul(0.035).add(0.012);
  const starGate = step(0.975, hash(cellId.add(101.9)));
  const starShape = oneMinus(smoothstep(0, starRadius, length(local))).pow(2.4);
  const starBrightness = hash(cellId.add(151.2)).pow(5).mul(3.2).add(0.12);
  const starTemperature = hash(cellId.add(211.8));
  const warmStar = vec3(1.0, 0.52, 0.24);
  const coolStar = vec3(stars[0], stars[1], stars[2]);
  const starTint = mix(warmStar, coolStar, starTemperature);

  // A second, denser unresolved population supplies low-amplitude angular
  // structure between the sparse bright stars. Both populations are pure
  // functions of the canonical local direction and seed.
  const denseCells = vec2(longitude.mul(denseStarCells.x), latitude.mul(denseStarCells.y));
  const denseCell = floor(denseCells);
  const denseCellId = denseCell.x.add(denseCell.y.mul(denseStarCells.x)).add(seed.mul(1.37));
  const denseJitter = vec2(hash(denseCellId.add(271.4)), hash(denseCellId.add(319.7))).sub(0.5);
  const denseLocal = fract(denseCells).sub(0.5).sub(denseJitter.mul(0.76));
  const denseRadius = hash(denseCellId.add(383.6)).mul(0.018).add(0.004);
  const denseShape = oneMinus(smoothstep(0, denseRadius, length(denseLocal))).pow(1.6);
  const denseGate = step(1 - denseStarDensity, hash(denseCellId.add(431.2)));
  const denseBrightness = hash(denseCellId.add(479.8)).pow(3.5).mul(0.42).add(0.018);
  const denseTemperature = hash(denseCellId.add(521.1));
  const denseTint = mix(vec3(1.0, 0.48, 0.2), coolStar, denseTemperature);

  const octaves = Math.max(1, Math.min(6, Math.floor(options.octaves ?? 3)));
  const dustNoise = mx_fractal_noise_float(
    vec3(
      direction.x.mul(2.8).add(modelTime.mul(0.003)),
      direction.y.mul(2.8).sub(seed.mul(0.005)),
      direction.z.mul(2.8).add(modelTime.mul(0.002))
    ),
    octaves,
    2.0,
    0.5
  )
    .mul(0.5)
    .add(0.5);
  const fineDustNoise = mx_fractal_noise_float(
    vec3(
      direction.x.mul(7.4).add(seed.mul(0.009)),
      direction.y.mul(7.4).sub(modelTime.mul(0.005)),
      direction.z.mul(7.4).add(seed.mul(0.014))
    ),
    Math.max(1, Math.min(5, octaves + 1)),
    2.0,
    0.5
  )
    .mul(0.5)
    .add(0.5);
  const galacticBand = direction.y.abs().oneMinus().clamp(0, 1).pow(2.2);
  const dustBand = smoothstep(0.3, 0.82, dustNoise)
    .mul(fineDustNoise.mul(0.5).add(0.5))
    .mul(galacticBand)
    .mul(0.82);
  const starTerm = starTint.mul(starShape.mul(starGate).mul(starBrightness));
  const denseTerm = denseTint.mul(denseShape.mul(denseGate).mul(denseBrightness));
  const dustTerm = vec3(dust[0], dust[1], dust[2]).mul(dustBand.mul(nebulaStrength));
  const bandTerm = vec3(0.022, 0.009, 0.035).mul(
    galacticBand.mul(dustNoise.mul(0.55).add(0.45)).mul(galacticBandStrength)
  );
  const deepGradient = vec3(
    direction.y.abs().oneMinus().mul(0.008),
    direction.y.abs().oneMinus().mul(0.005),
    direction.y.abs().oneMinus().mul(0.02)
  );
  material.colorNode = vec4(
    deepGradient
      .add(bandTerm.mul(detail))
      .add(dustTerm.mul(detail))
      .add(starTerm)
      .add(denseTerm.mul(detail)),
    1
  ).mul(intensity);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'cinematic-deep-space-backdrop';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  return {
    mesh,
    geometry,
    material,
    setTime(value) {
      modelTime.value = Number.isFinite(value) ? value : 0;
    },
    setIntensity(value) {
      intensity.value = cinematicIntensity(value, 1);
    },
    setDetail(value) {
      detail.value = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 1;
    },
    syncToCamera(camera) {
      const distance = camera.position.length();
      const radius = Math.max(
        MIN_BACKDROP_RADIUS,
        distance + Math.max(BACKDROP_RADIUS_MARGIN, distance * BACKDROP_RADIUS_FRACTION)
      );
      mesh.scale.setScalar(radius);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    }
  };
}

export interface CinematicDiscOptions {
  innerRadius: number;
  outerRadius: number;
  innerTint: readonly [number, number, number];
  outerTint: readonly [number, number, number];
  seed: number;
  gain?: number;
  arms?: number;
  noiseOctaves?: number;
}

/**
 * Structured emissive annulus for non-ray-traced destination accents. The
 * radial gradient and differential phase are presentation structure; callers
 * still own any authoritative disk intersection or emission model.
 */
export function createCinematicDiscMaterial(
  options: CinematicDiscOptions
): CinematicMaterialHandle {
  const inner = uniform(toVector3(options.innerTint, [1, 1, 1]));
  const outer = uniform(toVector3(options.outerTint, [1, 1, 1]));
  const gain = uniform(cinematicIntensity(options.gain ?? 1));
  const phase = uniform(0);
  const seed = uniform(cinematicSeed(options.seed));

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  material.userData['cinematicEmissive'] = true;

  const radius = length(positionLocal.xz);
  const radial = clamp(
    radius.sub(options.innerRadius).div(Math.max(options.outerRadius - options.innerRadius, 1e-5)),
    0,
    1
  );
  const angle = atan(positionLocal.z, positionLocal.x);
  const shear = phase.mul(radial.add(0.08).pow(-1.5));
  const arms = Math.max(1, Math.floor(options.arms ?? 2));
  const spiral = sin(angle.mul(arms).sub(shear).add(seed.mul(0.01)))
    .mul(0.2)
    .add(0.82);
  const texture = mx_fractal_noise_float(
    vec3(
      positionLocal.x.mul(0.08).add(seed.mul(0.01)),
      positionLocal.y.mul(0.08),
      positionLocal.z.mul(0.08).sub(phase.mul(0.01))
    ),
    Math.max(1, Math.min(5, Math.floor(options.noiseOctaves ?? 3))),
    2.0,
    0.5
  )
    .mul(0.2)
    .add(0.9);
  const rim = smoothstep(0, 0.22, oneMinus(radial));
  const fade = smoothstep(0, 0.08, oneMinus(radial)).mul(oneMinus(smoothstep(0.88, 1, radial)));
  const color = mix(inner, outer, radial).mul(spiral).mul(texture).mul(rim.add(0.28));
  material.colorNode = vec4(color.mul(gain), fade.mul(0.92));

  return {
    material,
    setTint(value) {
      inner.value.copy(toVector3(value, [1, 1, 1]));
    },
    setSecondaryTint(value) {
      outer.value.copy(toVector3(value, [1, 1, 1]));
    },
    setGain(value) {
      gain.value = cinematicIntensity(value, 0);
    },
    setTime(value) {
      phase.value = Number.isFinite(value) ? value : 0;
    },
    dispose() {
      material.dispose();
    }
  };
}

export interface CinematicCausticOptions {
  innerRadius: number;
  outerRadius: number;
  tint: readonly [number, number, number];
  secondaryTint?: readonly [number, number, number];
  seed: number;
  gain?: number;
  alpha?: number;
  lobes?: number;
}

/**
 * Illustrative spacetime-caustic annulus for vacuum compact binaries. It is
 * explicitly not an accretion-disc or gas material: its gain is tied to the
 * NR trajectory/amplitude by the destination and its color/arc variation only
 * communicates lensing-like distortion around the source marker.
 */
export function createCinematicCausticMaterial(
  options: CinematicCausticOptions
): CinematicMaterialHandle {
  const inner = uniform(toVector3(options.tint, [1, 1, 1]));
  const outer = uniform(toVector3(options.secondaryTint ?? options.tint, [1, 1, 1]));
  const gain = uniform(cinematicIntensity(options.gain ?? 1));
  const alpha = Math.max(0, Math.min(1, options.alpha ?? 0.4));
  const phase = uniform(0);
  const seed = uniform(cinematicSeed(options.seed));
  const lobeCount = Math.max(1, Math.floor(options.lobes ?? 3));
  const radius = length(positionLocal.xz);
  const radial = clamp(
    radius.sub(options.innerRadius).div(Math.max(options.outerRadius - options.innerRadius, 1e-5)),
    0,
    1
  );
  const angle = atan(positionLocal.z, positionLocal.x);
  const arcNoise = mx_fractal_noise_float(
    vec3(
      positionLocal.x.mul(3.4).add(seed.mul(0.011)),
      positionLocal.y.mul(3.4).add(phase.mul(0.013)),
      positionLocal.z.mul(3.4).sub(seed.mul(0.017))
    ),
    2,
    2.0,
    0.5
  )
    .mul(0.5)
    .add(0.5);
  const arc = sin(angle.mul(lobeCount).add(phase.mul(0.08)).add(arcNoise.mul(2.6)))
    .abs()
    .pow(4.2);
  const edge = smoothstep(0, 0.16, radial).mul(oneMinus(smoothstep(0.76, 1, radial)));
  const color = mix(inner, outer, radial).mul(arc.mul(0.82).add(0.18));

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  material.userData['cinematicEmissive'] = true;
  material.userData['cinematicRepresentation'] = 'vacuum-spacetime-caustic';
  material.colorNode = vec4(color.mul(gain), edge.mul(alpha).mul(arc.mul(0.65).add(0.35)));

  return {
    material,
    setTint(value) {
      inner.value.copy(toVector3(value, [1, 1, 1]));
    },
    setSecondaryTint(value) {
      outer.value.copy(toVector3(value, [1, 1, 1]));
    },
    setGain(value) {
      gain.value = cinematicIntensity(value, 0);
    },
    setTime(value) {
      phase.value = Number.isFinite(value) ? value : 0;
    },
    dispose() {
      material.dispose();
    }
  };
}

export interface CinematicJetOptions {
  tint: readonly [number, number, number];
  secondaryTint?: readonly [number, number, number];
  seed: number;
  gain?: number;
  alpha?: number;
  noiseOctaves?: number;
}

/**
 * Soft, additive cone material for a destination that already exposes a
 * resolved jet-front/axis model. Geometry supplies the finite cone; this
 * material adds an axial engine-to-tip profile and seeded sheath variation.
 */
export function createCinematicJetMaterial(options: CinematicJetOptions): CinematicMaterialHandle {
  const tint = uniform(toVector3(options.tint, [1, 1, 1]));
  const secondaryTint = uniform(toVector3(options.secondaryTint ?? options.tint, [1, 1, 1]));
  const gain = uniform(cinematicIntensity(options.gain ?? 1));
  const phase = uniform(0);
  const seed = uniform(cinematicSeed(options.seed));
  const alpha = Math.max(0, Math.min(1, options.alpha ?? 0.65));

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  material.userData['cinematicEmissive'] = true;

  const axial = clamp(positionLocal.y, 0, 1);
  const baseFade = smoothstep(0, 0.12, axial).mul(oneMinus(smoothstep(0.72, 1, axial)));
  const sheath = mx_fractal_noise_float(
    vec3(
      positionLocal.x.mul(5).add(seed.mul(0.013)),
      positionLocal.y.mul(7).add(phase.mul(0.02)),
      positionLocal.z.mul(5).sub(seed.mul(0.017))
    ),
    Math.max(1, Math.min(5, Math.floor(options.noiseOctaves ?? 3))),
    2.0,
    0.5
  )
    .mul(0.5)
    .add(0.5);
  const core = oneMinus(length(positionLocal.xz).mul(1.3)).clamp(0, 1);
  const mixed = mix(secondaryTint, tint, core.mul(0.75).add(0.25));
  material.colorNode = vec4(
    mixed
      .mul(gain)
      .mul(baseFade.mul(0.72).add(core.mul(0.55)))
      .mul(sheath.mul(0.35).add(0.8)),
    baseFade.mul(alpha).mul(sheath.mul(0.35).add(0.65))
  );

  return {
    material,
    setTint(value) {
      tint.value.copy(toVector3(value, [1, 1, 1]));
    },
    setSecondaryTint(value) {
      secondaryTint.value.copy(toVector3(value, [1, 1, 1]));
    },
    setGain(value) {
      gain.value = cinematicIntensity(value, 0);
    },
    setTime(value) {
      phase.value = Number.isFinite(value) ? value : 0;
    },
    dispose() {
      material.dispose();
    }
  };
}

function toVector3(
  value: readonly [number, number, number],
  fallback: readonly [number, number, number]
): THREE.Vector3 {
  const values = [value[0], value[1], value[2]];
  return new THREE.Vector3(
    finiteOr(values[0], fallback[0]),
    finiteOr(values[1], fallback[1]),
    finiteOr(values[2], fallback[2])
  );
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
