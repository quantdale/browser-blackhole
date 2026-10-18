/**
 * NUCLEAR outer-disk photosphere (visual-fidelity vertical slice).
 *
 * WHAT THIS IS
 * A representation-layer, finite-thickness annular SHELL that replaces the
 * zero-thickness `RingGeometry` outer accretion disk of the NUCLEAR zone. It
 * has a top photospheric surface, a bottom surface, inner and outer radial
 * rims, a restrained flared scale height, and a deterministic surface
 * structure model. It exists so the disk has real perspective, parallax and
 * self-occlusion instead of reading as a flat translucent annulus.
 *
 * WHAT THIS IS NOT
 * - NOT a solved vertical disk model: the scale height is an explicitly
 *   illustrative representation-layer approximation (H/R <= 0.04 at the
 *   outer edge), not a hydrostatic structure.
 * - NOT GRMHD, not radiative transfer, not a new accretion solver. No new
 *   authoritative physics is introduced here.
 * - NOT a change to the validated inner GR pass (6-18 r_g DIRECT lensing) or
 *   to any Kerr/geodesic code.
 *
 * WHAT IS PRESERVED (the destination's existing disk laws)
 * - Radial boundaries: OUTER_DISK_INNER_RG = 200 r_g .. OUTER_DISK_OUTER_RG
 *   = 8000 r_g, converted with ZONE_UNIT_RG.nuclear exactly as before.
 * - Radial colour law: warm inner -> violet outer mix over smoothstep
 *   (0.25, 0.92, t) and the soft radial edge law over t (identical formula).
 * - Continuum variability response: brightness follows the uContinuum
 *   surrogate factor.
 * - Keplerian differential rotation: Omega(r) = uOmegaScale * (r/r_g)^(-3/2)
 *   carries the azimuthal pattern (DISK_PATTERN_ARMS = 2 wave + a faster
 *   fine harmonic), unchanged.
 * - Deterministic timeline behaviour: every animated term is a pure function
 *   of the time-days uniform, so scrubbing and replay are reproducible.
 *
 * SURFACE STRUCTURE (disclosed procedural detail)
 * - Broad radial emissivity falloff toward the outer disk.
 * - Two octaves of deterministic value noise sampled on a cylinder whose
 *   azimuthal coordinate is sheared at the LOCAL Keplerian rate, so features
 *   orbit differentially and shear with radius over time. No screen-space
 *   noise, no per-frame randomness, no concentric stripes, no repeated
 *   spirals.
 * - Illustrative surface shading: the bottom face and rim walls are dimmer
 *   than the top photosphere (a limb-darkening presentation cue, not a
 *   solved radiative boundary condition).
 *
 * COMPOSITION
 * Normal alpha blending with depth writes enabled, so the shell occludes
 * itself and the scene behind it (the old annulus was additive with no depth
 * writes). The body is optically thick: alpha is the preserved soft radial
 * edge law only, not the brightness pattern.
 */
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  MeshBasicNodeMaterial,
  NormalBlending,
  Uint32BufferAttribute,
  type Node
} from 'three/webgpu';
import {
  atan,
  attribute,
  cos,
  float,
  length,
  max,
  mix,
  positionLocal,
  select,
  sin,
  smoothstep,
  vec3,
  vec4
} from 'three/tsl';

import { OUTER_DISK_INNER_RG, OUTER_DISK_OUTER_RG, ZONE_UNIT_RG } from './types.js';

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

export const OUTER_DISK_PHOTOSPHERE_DISCLOSURE =
  'PROCEDURAL_SCIENTIFIC representation-layer photosphere: a finite-thickness ' +
  'emissive annular shell with an illustrative flared scale height ' +
  '(H/R <= 0.04 at the outer edge) providing parallax and self-occlusion. ' +
  'NOT a solved vertical disk model, NOT GRMHD, NOT radiative transfer. The ' +
  'existing radial colour law, soft edges, continuum response and Keplerian ' +
  'shear are preserved; bottom/rim dimming is an illustrative limb-darkening ' +
  'presentation cue.';

// ---------------------------------------------------------------------------
// Constants (locked; unit tests pin the ordering and thinness invariants)
// ---------------------------------------------------------------------------

/** Azimuthal brightness arms of the preserved Keplerian pattern. */
export const OUTER_DISK_PATTERN_ARMS = 2;

/** Faster azimuthal harmonic multiplier of the preserved fine pattern. */
export const OUTER_DISK_PATTERN_FINE_MULTIPLIER = 5;

/**
 * Presentation contrast of the azimuthal pattern around its base level. The
 * MOTION law (Omega(r) shear, two harmonics, time dependence) is preserved
 * exactly; the contrast is tuned down from the flat annulus (0.32/0.14 at
 * base 0.62) because the same amplitudes read as hard radial spokes on the
 * resolved photospheric surface and saturated to white under the display
 * gain. Range: [base - wave - fine, base + wave + fine] = [0.45, 0.99].
 */
export const OUTER_DISK_PATTERN_BASE = 0.72;
export const OUTER_DISK_PATTERN_WAVE_AMPLITUDE = 0.2;
export const OUTER_DISK_PATTERN_FINE_AMPLITUDE = 0.04;

/** Display gain of the emissive shell (kept below 1 so peaks do not clip). */
export const DISK_EMISSIVE_GAIN = 0.55;

/**
 * Illustrative scale height as a fraction of the OUTER radius: total shell
 * thickness at rOut. Flared, geometrically thin, deliberately restrained.
 */
export const DISK_THICKNESS_AT_ROUT_FRACTION = 0.04;

/** Radial flare exponent: thickness(r) ~ r^exponent. */
export const DISK_FLARE_EXPONENT = 1.15;

/** Segmentation of the shell (geometry cost is tiny; silhouette smoothness matters). */
export const DISK_AZIMUTH_SEGMENTS = 160;
export const DISK_RADIAL_SEGMENTS = 16;

/** Surface identity per vertex, stored as the `aSurface` attribute. */
export const DISK_SURFACE = {
  top: 0,
  bottom: 1,
  innerRim: 2,
  outerRim: 3
} as const;

/**
 * Illustrative limb-darkening gains per surface. Presentation only: the
 * shell is emissive and unlit, so these are explicit shading choices, not a
 * radiative boundary condition.
 */
export const DISK_SURFACE_GAIN = {
  top: 1.0,
  bottom: 0.7,
  innerRim: 0.85,
  outerRim: 0.8
} as const;

/** Broad radial emissivity: full at the inner edge, this fraction at t = 1. */
export const DISK_RADIAL_EMISSIVITY_OUTER_FRACTION = 0.55;

/** Multi-scale deterministic detail amplitudes (two octaves, restrained). */
export const DISK_DETAIL_OCTAVE1 = 0.26;
export const DISK_DETAIL_OCTAVE2 = 0.12;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface OuterDiskLayout {
  /** Preset seed (geometry is seed-independent; the noise domain is not). */
  readonly seed: number;
  /** Deterministic noise-domain offset derived from the seed. */
  readonly seedOffset: number;
  /** Inner radius in NUCLEAR scene units. */
  readonly rInUnits: number;
  /** Outer radius in NUCLEAR scene units. */
  readonly rOutUnits: number;
  /** Total shell thickness at the outer edge (scene units). */
  readonly thicknessAtOuterUnits: number;
  /** Total shell thickness at the inner edge (scene units). */
  readonly thicknessAtInnerUnits: number;
  readonly radialSegments: number;
  readonly azimuthSegments: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/** Total shell thickness at radius r (scene units). Flared, monotone, finite. */
export function outerDiskThicknessAt(rUnits: number, layout: OuterDiskLayout): number {
  const r = Math.max(rUnits, 1e-6);
  return layout.thicknessAtOuterUnits * Math.pow(r / layout.rOutUnits, DISK_FLARE_EXPONENT);
}

/** Radial parameter t in [0, 1] using the destination's original formula. */
export function outerDiskRadialT(rUnits: number, layout: OuterDiskLayout): number {
  return (rUnits - layout.rInUnits) / Math.max(layout.rOutUnits - layout.rInUnits, 1e-4);
}

/**
 * Soft INNER radial fade. The outer boundary of the photosphere is defined
 * (rim wall), not faded: a fading alpha cannot write depth without cutting
 * the background behind it, which rendered a hard dark band around the old
 * translucent annulus. This is the one deliberate deviation from the old
 * ring's edge treatment; the colour and emissivity laws are unchanged.
 */
export function outerDiskEdgeFalloff(t: number): number {
  const smooth = (edge0: number, edge1: number, x: number): number => {
    // GLSL smoothstep semantics: the span may be negative; only a zero span
    // is degenerate.
    const span = edge1 - edge0;
    const u = span === 0 ? 0 : Math.min(1, Math.max(0, (x - edge0) / span));
    return u * u * (3 - 2 * u);
  };
  return smooth(0, 0.07, t);
}

/** Preserved radial colour law: warm inner -> violet outer. */
export function outerDiskColorAt(t: number): readonly [number, number, number] {
  const u = Math.min(1, Math.max(0, (t - 0.25) / Math.max(0.92 - 0.25, 1e-6)));
  const s = u * u * (3 - 2 * u);
  return [1.0 + (0.72 - 1.0) * s, 0.87 + (0.56 - 0.87) * s, 0.63 + (0.96 - 0.63) * s];
}

/** Local Keplerian angular rate in rad/day (shared with the module uniform). */
export function outerDiskOmegaPerDay(rRg: number, omegaScale: number): number {
  return omegaScale * Math.pow(Math.max(rRg, 1e-3), -1.5);
}

/**
 * Preserved azimuthal brightness pattern (2 arms + faster fine harmonic),
 * carried at the local Keplerian rate. Pure function of the timeline days.
 */
export function outerDiskPatternAt(
  phi: number,
  rRg: number,
  timeDays: number,
  omegaScale: number
): number {
  const omega = outerDiskOmegaPerDay(rRg, omegaScale);
  const wave = Math.sin(phi * OUTER_DISK_PATTERN_ARMS - omega * timeDays);
  const fine = Math.sin(
    phi * OUTER_DISK_PATTERN_ARMS * OUTER_DISK_PATTERN_FINE_MULTIPLIER - omega * timeDays * 1.6
  );
  return (
    OUTER_DISK_PATTERN_BASE +
    OUTER_DISK_PATTERN_WAVE_AMPLITUDE * wave +
    OUTER_DISK_PATTERN_FINE_AMPLITUDE * fine
  );
}

// Deterministic value noise on a cylinder. The corner hash is the same
// sin-fract integer mix used by jetVolumeField's TSL lattice, so the CPU and
// GPU evaluators share one lattice definition (they may differ in the last
// float bits across precision; no pixel parity is claimed from the CPU side).
function hash01(x: number): number {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise3Cpu(qx: number, qy: number, qz: number, seed: number): number {
  const xi = Math.floor(qx);
  const yi = Math.floor(qy);
  const zi = Math.floor(qz);
  const smooth = (u: number): number => u * u * (3 - 2 * u);
  const sx = smooth(qx - xi);
  const sy = smooth(qy - yi);
  const sz = smooth(qz - zi);
  const corner = (i: number, j: number, k: number): number =>
    hash01(i * 127.1 + j * 311.7 + k * 74.7 + seed * 269.5);
  const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
  const x00 = lerp(corner(xi, yi, zi), corner(xi + 1, yi, zi), sx);
  const x10 = lerp(corner(xi, yi + 1, zi), corner(xi + 1, yi + 1, zi), sx);
  const x01 = lerp(corner(xi, yi, zi + 1), corner(xi + 1, yi, zi + 1), sx);
  const x11 = lerp(corner(xi, yi + 1, zi + 1), corner(xi + 1, yi + 1, zi + 1), sx);
  return lerp(lerp(x00, x10, sy), lerp(x01, x11, sy), sz);
}

/**
 * Multi-scale deterministic brightness detail at a sheared azimuth. The
 * azimuthal coordinate `phiSheared = phi - Omega(r) * t` orbits at the LOCAL
 * rate, so features shear differentially with radius. Returns a gain in
 * [1 - 2*(oct1+oct2)/2 ... ] = [0.68, 1.32] for the locked amplitudes.
 */
export function outerDiskDetailAt(
  phi: number,
  tRadial: number,
  timeDays: number,
  omegaScale: number,
  rRg: number,
  seedOffset: number
): number {
  const omega = outerDiskOmegaPerDay(rRg, omegaScale);
  const phiS = phi - omega * timeDays;
  const qx = Math.cos(phiS) + seedOffset;
  const qy = Math.sin(phiS) + seedOffset * 0.37;
  const qz = tRadial * 2.4;
  const n1 = valueNoise3Cpu(qx * 2.6, qy * 2.6, qz * 2.6, 11.3 + seedOffset * 0.01);
  const n2 = valueNoise3Cpu(qx * 7.3 + 19.7, qy * 7.3, qz * 7.3, 29.1 + seedOffset * 0.01);
  return 1 + DISK_DETAIL_OCTAVE1 * (n1 - 0.5) * 2 + DISK_DETAIL_OCTAVE2 * (n2 - 0.5) * 2;
}

/** Broad radial emissivity law (full inner -> DISK_RADIAL_EMISSIVITY_* outer). */
export function outerDiskRadialEmissivity(tRadial: number): number {
  const t = Math.min(1, Math.max(0, tRadial));
  return 1 + (DISK_RADIAL_EMISSIVITY_OUTER_FRACTION - 1) * t;
}

export function outerDiskLayout(seed: number): OuterDiskLayout {
  const rInUnits = OUTER_DISK_INNER_RG / ZONE_UNIT_RG.nuclear;
  const rOutUnits = OUTER_DISK_OUTER_RG / ZONE_UNIT_RG.nuclear;
  const thicknessAtOuterUnits = rOutUnits * DISK_THICKNESS_AT_ROUT_FRACTION;
  const thicknessAtInnerUnits =
    thicknessAtOuterUnits * Math.pow(rInUnits / rOutUnits, DISK_FLARE_EXPONENT);
  const rings = DISK_RADIAL_SEGMENTS + 1;
  const surfaceVertices = rings * DISK_AZIMUTH_SEGMENTS;
  const vertexCount = 2 * surfaceVertices + 4 * DISK_AZIMUTH_SEGMENTS;
  const triangleCount =
    4 * DISK_RADIAL_SEGMENTS * DISK_AZIMUTH_SEGMENTS + 4 * DISK_AZIMUTH_SEGMENTS;
  // Same deterministic integer fold as the jet field: geometry is identical
  // for every seed; only the noise-domain offset follows the preset.
  const seedMix = Math.imul(seed | 0, 0x9e3779b9) ^ Math.imul((seed | 0) + 0x85ebca6b, 0xc2b2ae35);
  const seedFold = Math.abs(seedMix % 1000);
  return {
    seed,
    seedOffset: seedFold * 0.618,
    rInUnits,
    rOutUnits,
    thicknessAtOuterUnits,
    thicknessAtInnerUnits,
    radialSegments: DISK_RADIAL_SEGMENTS,
    azimuthSegments: DISK_AZIMUTH_SEGMENTS,
    vertexCount,
    triangleCount
  };
}

// ---------------------------------------------------------------------------
// Geometry: closed annular shell (top + bottom + two rims)
// ---------------------------------------------------------------------------

export function buildOuterDiskPhotosphereGeometry(layout: OuterDiskLayout): BufferGeometry {
  const az = layout.azimuthSegments;
  const rad = layout.radialSegments;
  const rings = rad + 1;
  const surfaceVertices = rings * az;
  const topOffset = 0;
  const bottomOffset = surfaceVertices;
  const innerRimOffset = 2 * surfaceVertices;
  const outerRimOffset = innerRimOffset + 2 * az;
  const vertexCount = layout.vertexCount;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const surfaces = new Float32Array(vertexCount);

  const put = (
    index: number,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    surface: number
  ): void => {
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
    normals[index * 3] = nx;
    normals[index * 3 + 1] = ny;
    normals[index * 3 + 2] = nz;
    surfaces[index] = surface;
  };

  // Top and bottom photospheric surfaces. The flare slope tilts the surface
  // normals inward; thickness ~ r^1.15 gives a shallow flared skirt.
  for (let j = 0; j <= rad; j += 1) {
    const u = j / rad;
    const r = layout.rInUnits + (layout.rOutUnits - layout.rInUnits) * u;
    const halfThickness = outerDiskThicknessAt(r, layout) / 2;
    const slope =
      (layout.thicknessAtOuterUnits / 2) *
      (DISK_FLARE_EXPONENT / layout.rOutUnits) *
      Math.pow(r / layout.rOutUnits, DISK_FLARE_EXPONENT - 1);
    const invLen = 1 / Math.sqrt(1 + slope * slope);
    for (let i = 0; i < az; i += 1) {
      const phi = (2 * Math.PI * i) / az;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      put(
        topOffset + j * az + i,
        r * c,
        halfThickness,
        r * s,
        -slope * c * invLen,
        invLen,
        -slope * s * invLen,
        DISK_SURFACE.top
      );
      put(
        bottomOffset + j * az + i,
        r * c,
        -halfThickness,
        r * s,
        -slope * c * invLen,
        -invLen,
        -slope * s * invLen,
        DISK_SURFACE.bottom
      );
    }
  }

  // Inner and outer rim walls (vertical at this thickness; outward normals
  // point into the hole / away from the disk).
  const rimRow = (
    base: number,
    r: number,
    halfThickness: number,
    nx: number,
    nz: number,
    surface: number
  ): void => {
    for (let i = 0; i < az; i += 1) {
      const phi = (2 * Math.PI * i) / az;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      put(base + i * 2, r * c, halfThickness, r * s, nx * c, 0, nz * s, surface);
      put(base + i * 2 + 1, r * c, -halfThickness, r * s, nx * c, 0, nz * s, surface);
    }
  };
  rimRow(
    innerRimOffset,
    layout.rInUnits,
    layout.thicknessAtInnerUnits / 2,
    -1,
    -1,
    DISK_SURFACE.innerRim
  );
  rimRow(
    outerRimOffset,
    layout.rOutUnits,
    layout.thicknessAtOuterUnits / 2,
    1,
    1,
    DISK_SURFACE.outerRim
  );

  const indices = new Uint32Array(layout.triangleCount * 3);
  let cursor = 0;
  const tri = (a: number, b: number, c: number): void => {
    indices[cursor] = a;
    indices[cursor + 1] = b;
    indices[cursor + 2] = c;
    cursor += 3;
  };
  for (let j = 0; j < rad; j += 1) {
    for (let i = 0; i < az; i += 1) {
      const iNext = (i + 1) % az;
      const a = topOffset + j * az + i;
      const b = topOffset + j * az + iNext;
      const c = topOffset + (j + 1) * az + iNext;
      const d = topOffset + (j + 1) * az + i;
      tri(a, b, c);
      tri(a, c, d);
      const a2 = bottomOffset + j * az + i;
      const b2 = bottomOffset + j * az + iNext;
      const c2 = bottomOffset + (j + 1) * az + iNext;
      const d2 = bottomOffset + (j + 1) * az + i;
      tri(a2, c2, b2);
      tri(a2, d2, c2);
    }
  }
  for (let i = 0; i < az; i += 1) {
    const iNext = (i + 1) % az;
    const t0 = innerRimOffset + i * 2;
    const t1 = innerRimOffset + i * 2 + 1;
    const t2 = innerRimOffset + iNext * 2 + 1;
    const t3 = innerRimOffset + iNext * 2;
    tri(t0, t1, t2);
    tri(t0, t2, t3);
    const u0 = outerRimOffset + i * 2;
    const u1 = outerRimOffset + i * 2 + 1;
    const u2 = outerRimOffset + iNext * 2 + 1;
    const u3 = outerRimOffset + iNext * 2;
    tri(u0, u2, u1);
    tri(u0, u3, u2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('aSurface', new Float32BufferAttribute(surfaces, 1));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  return geometry;
}

// ---------------------------------------------------------------------------
// Material: preserved emission laws + deterministic surface structure
// ---------------------------------------------------------------------------

function cornerHashTsl(fold: Node<'float'>): Node<'float'> {
  return fold.mul(12.9898).sin().mul(43758.5453).fract();
}

function valueNoise3Tsl(
  qx: Node<'float'>,
  qy: Node<'float'>,
  qz: Node<'float'>,
  seed: number
): Node<'float'> {
  const xi = qx.floor();
  const yi = qy.floor();
  const zi = qz.floor();
  const sx = smoothstep(0, 1, qx.sub(xi));
  const sy = smoothstep(0, 1, qy.sub(yi));
  const sz = smoothstep(0, 1, qz.sub(zi));
  const s = float(seed);
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
  return mix(mix(x00, x10, sy), mix(x01, x11, sy), sz);
}

export function createOuterDiskPhotosphereMaterial(args: {
  layout: OuterDiskLayout;
  /** Live timeline-days uniform (pure animation driver). */
  timeDays: Node<'float'>;
  /** Live continuum variability factor (preserved response). */
  continuum: Node<'float'>;
  /** Live Keplerian scale (mass-dependent; same uniform as before). */
  omegaScale: Node<'float'>;
}): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  // Optically thick photosphere: normal alpha blending with depth writes, so
  // the shell occludes itself and the scene behind it. The old annulus was
  // additive without depth writes and read as a flat translucent veil.
  material.transparent = true;
  material.blending = NormalBlending;
  material.depthWrite = true;
  material.depthTest = true;
  material.side = DoubleSide;

  const rIn = args.layout.rInUnits;
  const rOut = args.layout.rOutUnits;

  const rUnits = length(positionLocal.xz);
  // Preserved radial parameterization and soft edges.
  const t = rUnits.sub(float(rIn)).div(max(float(rOut - rIn), float(1e-4)));
  const edges = smoothstep(float(0), float(0.07), t);
  // Preserved radial colour law (warm inner -> violet outer).
  const body = mix(
    vec3(1.0, 0.87, 0.63),
    vec3(0.72, 0.56, 0.96),
    smoothstep(float(0.25), float(0.92), t)
  );

  // Preserved Keplerian differential rotation of the azimuthal pattern.
  const rRg = max(rUnits.mul(float(ZONE_UNIT_RG.nuclear)), float(1e-3));
  const omega = args.omegaScale.mul(rRg.pow(float(-1.5)));
  const phi = atan(positionLocal.z, positionLocal.x);
  const wave = sin(phi.mul(float(OUTER_DISK_PATTERN_ARMS)).sub(omega.mul(args.timeDays)));
  const fine = sin(
    phi
      .mul(float(OUTER_DISK_PATTERN_ARMS * OUTER_DISK_PATTERN_FINE_MULTIPLIER))
      .sub(omega.mul(args.timeDays).mul(1.6))
  );
  const pattern = float(OUTER_DISK_PATTERN_BASE)
    .add(wave.mul(float(OUTER_DISK_PATTERN_WAVE_AMPLITUDE)))
    .add(fine.mul(float(OUTER_DISK_PATTERN_FINE_AMPLITUDE)));

  // Deterministic multi-scale detail on a cylinder sheared at the LOCAL
  // Keplerian rate: features orbit differentially and shear with radius.
  const phiS = phi.sub(omega.mul(args.timeDays));
  const qz = t.clamp(0, 1).mul(float(2.4));
  const seedOffset = float(args.layout.seedOffset);
  const n1 = valueNoise3Tsl(
    cos(phiS).add(seedOffset).mul(float(2.6)),
    sin(phiS)
      .add(seedOffset.mul(float(0.37)))
      .mul(float(2.6)),
    qz.mul(float(2.6)),
    11.3 + args.layout.seedOffset * 0.01
  );
  const n2 = valueNoise3Tsl(
    cos(phiS).add(seedOffset).mul(float(7.3)).add(float(19.7)),
    sin(phiS)
      .add(seedOffset.mul(float(0.37)))
      .mul(float(7.3)),
    qz.mul(float(7.3)),
    29.1 + args.layout.seedOffset * 0.01
  );
  const detail = float(1)
    .add(n1.sub(0.5).mul(float(DISK_DETAIL_OCTAVE1 * 2)))
    .add(n2.sub(0.5).mul(float(DISK_DETAIL_OCTAVE2 * 2)));

  const radialGain = mix(float(1), float(DISK_RADIAL_EMISSIVITY_OUTER_FRACTION), t);
  const brightness = pattern.mul(detail).mul(radialGain).mul(args.continuum).mul(float(1.08));

  // Illustrative limb darkening by surface identity (top/bottom/rims).
  const surface = attribute('aSurface') as Node<'float'>;
  const surfaceGain = select(
    surface.lessThan(0.5),
    float(DISK_SURFACE_GAIN.top),
    select(
      surface.lessThan(1.5),
      float(DISK_SURFACE_GAIN.bottom),
      select(
        surface.lessThan(2.5),
        float(DISK_SURFACE_GAIN.innerRim),
        float(DISK_SURFACE_GAIN.outerRim)
      )
    )
  );

  const emissive = body.mul(brightness).mul(surfaceGain).mul(float(DISK_EMISSIVE_GAIN));
  // The outer rim wall keeps a defined photospheric edge continuous with the
  // surfaces (which no longer fade out at the outer boundary); the inner rim
  // folds into the soft inner fade and is discarded by alphaTest. Alpha and
  // depth writes stay coherent via alphaTest: below-threshold fragments are
  // discarded instead of writing depth against a near-transparent alpha
  // (which cut the background into a hard dark band around the shell).
  const isOuterRim = surface.greaterThan(2.5);
  const isSurface = surface.lessThan(1.5);
  material.colorNode = vec4(
    emissive.mul(select(isOuterRim, float(1), edges)),
    select(isOuterRim, float(0.92), select(isSurface, edges.mul(float(0.95)), float(0)))
  );
  material.alphaTest = 0.5;
  return material;
}
