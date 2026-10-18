/**
 * Quasar / AGN jet volume field — ONE formula family, two faces.
 *
 * The nuclear base and galactic extension used to be additive
 * `CylinderGeometry` core/sheath pairs. A sub-pixel open cylinder rasterizes
 * as a hard spike or disappears; it has no internal depth. This module is the
 * density/emission field marched by the EXISTING VolumeService V2. It does
 * not add a volume engine.
 *
 * WHAT IS PHYSICALLY CONSTRAINED
 * - Axis: bipolar ±Y, the documented spin axis.
 * - Length: `JET_BASE_LENGTH_RG` / `JET_EXTENDED_LENGTH_RG`, unchanged.
 * - Collimated half-width: `JET_*_HALF_WIDTH_RG` is the spine TARGET. The
 *   rendered spine sigma is broadened only when that target is narrower than
 *   the constant-step march can hit (`JET_SPINE_SIGMA_FLOOR_FRACTION`).
 * - Approaching/receding brightness is NOT in this field. The module still
 *   multiplies emission by the live per-lobe gain from
 *   `jetLobeBrightnessRatio`.
 * - Nuclear light-travel delay is NOT in this field. The module multiplies
 *   base-jet emission by the existing continuum surrogate evaluated at
 *   `t - outward * delayPerUnit`. Galactic jets get no delay pattern: a
 *   200-day variation is smoothed away over a ~10^4 yr light-crossing time.
 *
 * WHAT IS ILLUSTRATIVE
 * - The wider Gaussian is an entrained cocoon, not a revision of the launch
 *   collimation and not a radio-lobe simulation.
 * - Helical filament offset, axial knots, and two-octave value noise are
 *   deterministic presentation. They are not GRMHD, not synchrotron transfer,
 *   and not a measured opening angle.
 * - Optical depth is normalized to a transverse spine tau of order 1 so the
 *   march reads as glowing plasma rather than an opaque rod. VolumeService
 *   remains single-scattering emission-absorption.
 *
 * COHERENCE: {@link sampleAgnJetField} and {@link createAgnJetVolumeCallbacks}
 * use the same constants, including the sin-lattice hash shared with
 * ParticleService / the stellar-explosion field. CPU binary64 vs GPU f32
 * means bit equality is NOT claimed.
 */

import type { Node } from 'three/webgpu';
import {
  clamp,
  cos,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  sin,
  smoothstep,
  sqrt,
  vec3
} from 'three/tsl';

import type { QualityTier, TslDensityFn } from '../../atlas/types.js';
import {
  JET_BASE_HALF_WIDTH_RG,
  JET_BASE_LENGTH_RG,
  JET_EXTENDED_HALF_WIDTH_RG,
  JET_EXTENDED_LENGTH_RG,
  ZONE_UNIT_RG,
  type AgnZoneId
} from './types.js';

export const JET_VOLUME_DISCLOSURE =
  'Jets are optically thin VolumeService emission-absorption marches ' +
  '(single-scattering, no multiple scattering, no synchrotron transfer). ' +
  'The spine targets the documented collimated half-width and is broadened ' +
  'only enough for the constant-step march to hit it. The wider Gaussian is ' +
  'an illustrative entrained cocoon, not a revision of the launch ' +
  'collimation and not GRMHD. Approaching/receding brightness remains the ' +
  'disclosed fixed-Gamma beaming ratio. Nuclear light-travel delay still ' +
  'uses the continuum surrogate; the galactic jet stays static on this timeline.';

/**
 * Cocoon Gaussian sigma as a multiple of the documented collimated half-width.
 *
 * Base (nuclear): ~10× keeps the launch glow inside the torus funnel at the
 * documented camera (a few pixels) and resolves filaments when the rig is
 * dollied in. Extended (galactic): ~21× is the smallest cocoon that is a
 * readable bipolar glow at the radio-galaxy preset instead of a sub-pixel
 * cylinder the rasterizer drops. Both are presentation scales.
 */
export const JET_COCOON_SIGMA_SCALE = {
  base: 9.5,
  extended: 21
} as const;

/**
 * Spine sigma is at least this fraction of the cocoon sigma. The documented
 * half-width is often narrower than one march sample across the cocoon box;
 * without the floor the integrator skips the spine and the jet collapses
 * back to a smooth sheath.
 */
export const JET_SPINE_SIGMA_FLOOR_FRACTION = 0.2;

/** Box half-width in cocoon-sigma units. exp(-this^2) is the cocoon edge. */
export const JET_BOUNDS_OVER_COCOON = 2.05;

/** Target transverse optical depth through the spine Gaussian (order 1). */
export const JET_TARGET_SPINE_TAU = 0.62;

/** Sheath peak density / spine peak density. Sheath stays optically thinner. */
export const JET_SHEATH_DENSITY_FRACTION = 0.22;

/**
 * Primary kink amplitude / cocoon sigma. A large single helix reads as a
 * braid or DNA ribbon — a new geometric silhouette. This stays a gentle
 * wander inside the cocoon. A second incommensurate kink is added in the
 * field so the path is not one sine wave.
 */
export const JET_HELIX_AMPLITUDE = 0.12;
export const JET_KINK_SECOND_TURNS = 2.615;
export const JET_KINK_SECOND_AMPLITUDE = 0.055;

/** Second filament weight relative to the primary spine Gaussian. */
export const JET_FILAMENT_WEIGHT = 0.4;

export const JET_SPINE_RADIANCE = 1.7;
export const JET_SHEATH_RADIANCE = 0.75;

const JET_MARCH_STEPS: Readonly<
  Record<QualityTier, Readonly<Record<'base' | 'extended', number>>>
> = {
  low: { base: 24, extended: 28 },
  medium: { base: 32, extended: 40 },
  high: { base: 40, extended: 56 },
  ultra: { base: 48, extended: 72 }
};

const NOISE_AXIAL_CELLS = 0.45;
const NOISE_TRANSVERSE_CELLS = 1.35;
const NOISE_OCTAVE_2 = 2.15;
const OCTAVE1_WEIGHT = 0.62;
const OCTAVE2_WEIGHT = 0.38;

export interface AgnJetVolumeLayout {
  readonly kind: 'base' | 'extended';
  readonly side: 'plus' | 'minus';
  readonly zone: AgnZoneId;
  readonly lengthUnits: number;
  readonly collimatedHalfWidthUnits: number;
  readonly spineSigmaUnits: number;
  readonly cocoonSigmaUnits: number;
  readonly spinePeakDensity: number;
  readonly sheathPeakDensity: number;
  readonly helixTurns: number;
  readonly seedFold: number;
  readonly baseMaxSteps: number;
  readonly bounds: {
    readonly center: [number, number, number];
    readonly halfExtents: [number, number, number];
  };
}

export interface AgnJetFieldSample {
  readonly density: number;
  readonly spineWeight: number;
  readonly outwardUnits: number;
  readonly axialWindow: number;
}

export function agnJetVolumeLayout(
  kind: 'base' | 'extended',
  side: 'plus' | 'minus',
  seed: number,
  tier: QualityTier
): AgnJetVolumeLayout {
  const zone: AgnZoneId = kind === 'base' ? 'nuclear' : 'galactic';
  const lengthRg = kind === 'base' ? JET_BASE_LENGTH_RG : JET_EXTENDED_LENGTH_RG;
  const widthRg = kind === 'base' ? JET_BASE_HALF_WIDTH_RG : JET_EXTENDED_HALF_WIDTH_RG;
  const lengthUnits = lengthRg / ZONE_UNIT_RG[zone];
  const collimatedHalfWidthUnits = widthRg / ZONE_UNIT_RG[zone];
  const cocoonSigmaUnits = collimatedHalfWidthUnits * JET_COCOON_SIGMA_SCALE[kind];
  const spineSigmaUnits = Math.max(
    collimatedHalfWidthUnits,
    cocoonSigmaUnits * JET_SPINE_SIGMA_FLOOR_FRACTION
  );
  const halfWidth = cocoonSigmaUnits * JET_BOUNDS_OVER_COCOON;
  const tipPad = cocoonSigmaUnits * 0.35;
  const halfLength = lengthUnits * 0.5 + tipPad;
  const centerY = (side === 'plus' ? 1 : -1) * lengthUnits * 0.5;
  const spinePeakDensity = JET_TARGET_SPINE_TAU / (spineSigmaUnits * Math.sqrt(Math.PI));
  const sheathPeakDensity = spinePeakDensity * JET_SHEATH_DENSITY_FRACTION;
  const seedMix =
    (Math.imul(seed | 0, 0x9e3779b9) ^
      (side === 'plus' ? 0x5a17c3 : 0xa31d91) ^
      (kind === 'base' ? 0x11 : 0x22)) >>>
    0;
  return {
    kind,
    side,
    zone,
    lengthUnits,
    collimatedHalfWidthUnits,
    spineSigmaUnits,
    cocoonSigmaUnits,
    spinePeakDensity,
    sheathPeakDensity,
    helixTurns: kind === 'base' ? 0.7 : 0.65,
    seedFold: seedMix % 1000,
    baseMaxSteps: JET_MARCH_STEPS[tier][kind],
    bounds: {
      center: [0, centerY, 0],
      halfExtents: [halfWidth, halfLength, halfWidth]
    }
  };
}

function smooth01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function gaussian(radius: number, sigma: number): number {
  const q = radius / Math.max(sigma, 1e-6);
  return Math.exp(-q * q);
}

function hash01Cpu(x: number): number {
  const v = Math.sin(x * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

function valueNoise3Cpu(qx: number, qy: number, qz: number, seed: number): number {
  const xi = Math.floor(qx);
  const yi = Math.floor(qy);
  const zi = Math.floor(qz);
  const sx = smooth01(0, 1, qx - xi);
  const sy = smooth01(0, 1, qy - yi);
  const sz = smooth01(0, 1, qz - zi);
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

function axialWindow(outward01: number, _seedFold: number): number {
  // No sinusoidal beads. Axial clumps come from the noise lattice so the jet
  // does not grow a second regular geometric pattern on top of the kink.
  const launch = smooth01(0, 0.08, outward01);
  const tip = 1 - smooth01(0.7, 1.04, outward01);
  return launch * tip;
}

function spineCenter(
  outward: number,
  layout: AgnJetVolumeLayout,
  noise: number,
  noiseCross: number
): { x: number; z: number; filamentX: number; filamentZ: number } {
  const u = outward / layout.lengthUnits;
  const s = layout.cocoonSigmaUnits;
  const phaseA = u * layout.helixTurns * Math.PI * 2 + layout.seedFold * 0.01;
  const phaseB =
    u * layout.helixTurns * JET_KINK_SECOND_TURNS * Math.PI * 2 + layout.seedFold * 0.041;
  const x =
    Math.cos(phaseA) * s * JET_HELIX_AMPLITUDE +
    Math.cos(phaseB) * s * JET_KINK_SECOND_AMPLITUDE +
    (noise - 0.5) * s * 0.2;
  const z =
    Math.sin(phaseA + 0.6) * s * JET_HELIX_AMPLITUDE * 0.7 +
    Math.sin(phaseB) * s * JET_KINK_SECOND_AMPLITUDE +
    (noiseCross - 0.5) * s * 0.16;
  const filamentPhase = u * layout.helixTurns * 1.73 * Math.PI * 2 + 1.9;
  return {
    x,
    z,
    filamentX: x + Math.cos(filamentPhase) * s * 0.32,
    filamentZ: z + Math.sin(filamentPhase + 0.8) * s * 0.24
  };
}

function jetNoise01(x: number, outward: number, z: number, layout: AgnJetVolumeLayout): number {
  const s = Math.max(layout.cocoonSigmaUnits, 1e-6);
  const seed = layout.seedFold;
  const n1 = valueNoise3Cpu(
    x * (NOISE_TRANSVERSE_CELLS / s) + seed,
    outward * (NOISE_AXIAL_CELLS / s),
    z * (NOISE_TRANSVERSE_CELLS / s) + seed * 0.37,
    seed
  );
  const n2 = valueNoise3Cpu(
    x * ((NOISE_TRANSVERSE_CELLS * NOISE_OCTAVE_2) / s),
    outward * ((NOISE_AXIAL_CELLS * NOISE_OCTAVE_2) / s) + seed,
    z * ((NOISE_TRANSVERSE_CELLS * NOISE_OCTAVE_2) / s),
    seed + 977
  );
  return Math.min(1, Math.max(0, OCTAVE1_WEIGHT * n1 + OCTAVE2_WEIGHT * n2));
}

/** Full deterministic field, including turbulence. Non-negative and finite. */
export function sampleAgnJetField(
  x: number,
  y: number,
  z: number,
  layout: AgnJetVolumeLayout
): AgnJetFieldSample {
  const sign = layout.side === 'plus' ? 1 : -1;
  const outward = y * sign;
  const outward01 = outward / layout.lengthUnits;
  const axial = axialWindow(outward01, layout.seedFold);
  if (!(axial > 0)) {
    return {
      density: 0,
      spineWeight: 0,
      outwardUnits: Math.max(0, outward),
      axialWindow: 0
    };
  }
  const noise = jetNoise01(x, outward, z, layout);
  const noiseCross = jetNoise01(z, outward, x, layout);
  const center = spineCenter(outward, layout, noise, noiseCross);
  const rSpine = Math.hypot(x - center.x, z - center.z);
  const rFilament = Math.hypot(x - center.filamentX, z - center.filamentZ);
  const rSheath = Math.hypot(x, z);
  const spineCore = gaussian(rSpine, layout.spineSigmaUnits);
  const filament = gaussian(rFilament, layout.spineSigmaUnits * 1.6) * JET_FILAMENT_WEIGHT;
  const sheath = gaussian(rSheath, layout.cocoonSigmaUnits);
  const spineRho = layout.spinePeakDensity * (spineCore + filament) * (0.15 + 1.35 * noise);
  const sheathRho = layout.sheathPeakDensity * sheath * (0.05 + 1.3 * noise);
  const density = Math.max(0, (spineRho + sheathRho) * axial);
  const spineWeight = spineRho / Math.max(spineRho + sheathRho, 1e-8);
  return {
    density,
    spineWeight,
    outwardUnits: Math.max(0, outward),
    axialWindow: axial
  };
}

/**
 * Macro field with turbulence forced to 0.5 (the noise mean). Used to lock
 * silhouette and spine/sheath ordering without a particular seed's clumps.
 */
export function sampleAgnJetMacro(
  x: number,
  y: number,
  z: number,
  layout: AgnJetVolumeLayout
): AgnJetFieldSample {
  const sign = layout.side === 'plus' ? 1 : -1;
  const outward = y * sign;
  const outward01 = outward / layout.lengthUnits;
  const axial = axialWindow(outward01, layout.seedFold);
  if (!(axial > 0)) {
    return {
      density: 0,
      spineWeight: 0,
      outwardUnits: Math.max(0, outward),
      axialWindow: 0
    };
  }
  const noise = 0.5;
  const center = spineCenter(outward, layout, noise, noise);
  const rSpine = Math.hypot(x - center.x, z - center.z);
  const rFilament = Math.hypot(x - center.filamentX, z - center.filamentZ);
  const rSheath = Math.hypot(x, z);
  const spineCore = gaussian(rSpine, layout.spineSigmaUnits);
  const filament = gaussian(rFilament, layout.spineSigmaUnits * 1.6) * JET_FILAMENT_WEIGHT;
  const sheath = gaussian(rSheath, layout.cocoonSigmaUnits);
  const spineRho = layout.spinePeakDensity * (spineCore + filament) * (0.15 + 1.35 * noise);
  const sheathRho = layout.sheathPeakDensity * sheath * (0.05 + 1.3 * noise);
  const density = Math.max(0, (spineRho + sheathRho) * axial);
  return {
    density,
    spineWeight: spineRho / Math.max(spineRho + sheathRho, 1e-8),
    outwardUnits: Math.max(0, outward),
    axialWindow: axial
  };
}

type JetFieldNodes = {
  density: Node<'float'>;
  spineWeight: Node<'float'>;
  outward: Node<'float'>;
};

function cornerHashTsl(fold: Node<'float'>): Node<'float'> {
  return fract(sin(fold.mul(12.9898)).mul(43758.5453));
}

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

function buildFieldNodes(layout: AgnJetVolumeLayout, pos: unknown): JetFieldNodes {
  const p = vec3(pos as Node<'vec3'>);
  const sign = float(layout.side === 'plus' ? 1 : -1);
  const outward = p.y.mul(sign);
  const axisLength = float(layout.lengthUnits);
  const outward01 = outward.div(axisLength);
  const launch = smoothstep(0, 0.08, outward01);
  const tip = smoothstep(0.7, 1.04, outward01).oneMinus();
  const axial = launch.mul(tip);

  const gauss = (radius: Node<'float'>, sigma: number): Node<'float'> => {
    const q = radius.div(float(Math.max(sigma, 1e-6)));
    return q.mul(q).negate().exp();
  };
  const s = Math.max(layout.cocoonSigmaUnits, 1e-6);
  const seed = float(layout.seedFold);
  const noiseAt = (qx: Node<'float'>, qz: Node<'float'>): Node<'float'> => {
    const n1 = valueNoise3Tsl(
      vec3(
        qx.mul(NOISE_TRANSVERSE_CELLS / s).add(seed),
        outward.mul(NOISE_AXIAL_CELLS / s),
        qz.mul(NOISE_TRANSVERSE_CELLS / s).add(seed.mul(0.37))
      ),
      seed
    );
    const n2 = valueNoise3Tsl(
      vec3(
        qx.mul((NOISE_TRANSVERSE_CELLS * NOISE_OCTAVE_2) / s),
        outward.mul((NOISE_AXIAL_CELLS * NOISE_OCTAVE_2) / s).add(seed),
        qz.mul((NOISE_TRANSVERSE_CELLS * NOISE_OCTAVE_2) / s)
      ),
      seed.add(977)
    );
    return min(max(n1.mul(OCTAVE1_WEIGHT).add(n2.mul(OCTAVE2_WEIGHT)), 0), 1);
  };
  const noise = noiseAt(p.x, p.z);
  const noiseCross = noiseAt(p.z, p.x);
  const phaseA = outward01.mul(layout.helixTurns * Math.PI * 2).add(layout.seedFold * 0.01);
  const phaseB = outward01
    .mul(layout.helixTurns * JET_KINK_SECOND_TURNS * Math.PI * 2)
    .add(layout.seedFold * 0.041);
  const cocoon = float(s);
  const hx = cos(phaseA)
    .mul(cocoon.mul(JET_HELIX_AMPLITUDE))
    .add(cos(phaseB).mul(cocoon.mul(JET_KINK_SECOND_AMPLITUDE)))
    .add(noise.sub(0.5).mul(cocoon.mul(0.2)));
  const hz = sin(phaseA.add(0.6))
    .mul(cocoon.mul(JET_HELIX_AMPLITUDE * 0.7))
    .add(sin(phaseB).mul(cocoon.mul(JET_KINK_SECOND_AMPLITUDE)))
    .add(noiseCross.sub(0.5).mul(cocoon.mul(0.16)));
  const filamentPhase = outward01.mul(layout.helixTurns * 1.73 * Math.PI * 2).add(1.9);
  const fx = hx.add(cos(filamentPhase).mul(cocoon.mul(0.32)));
  const fz = hz.add(sin(filamentPhase.add(0.8)).mul(cocoon.mul(0.24)));
  const rSpine = sqrt(
    p.x
      .sub(hx)
      .mul(p.x.sub(hx))
      .add(p.z.sub(hz).mul(p.z.sub(hz)))
  );
  const rFilament = sqrt(
    p.x
      .sub(fx)
      .mul(p.x.sub(fx))
      .add(p.z.sub(fz).mul(p.z.sub(fz)))
  );
  const rSheath = sqrt(p.x.mul(p.x).add(p.z.mul(p.z)));
  const spineCore = gauss(rSpine, layout.spineSigmaUnits);
  const filament = gauss(rFilament, layout.spineSigmaUnits * 1.6).mul(JET_FILAMENT_WEIGHT);
  const sheath = gauss(rSheath, layout.cocoonSigmaUnits);
  const spineRho = float(layout.spinePeakDensity)
    .mul(spineCore.add(filament))
    .mul(noise.mul(1.35).add(0.15));
  const sheathRho = float(layout.sheathPeakDensity).mul(sheath).mul(noise.mul(1.3).add(0.05));
  const density = max(spineRho.add(sheathRho).mul(axial), 0);
  const spineWeight = spineRho.div(max(spineRho.add(sheathRho), float(1e-8)));
  return { density, spineWeight, outward: max(outward, 0) };
}

/**
 * Density and emission callbacks that share one field graph per position node.
 * VolumeService evaluates both callbacks with the same `pos` during graph
 * build; caching on that node keeps the noise lattice from being compiled twice.
 * Gradient/self-shadow taps are left off by the caller — each would be a new
 * position and a second lattice, which an optically thin jet does not need.
 */
export function createAgnJetVolumeCallbacks(args: {
  layout: AgnJetVolumeLayout;
  gain: Node<'float'>;
  timeDays: Node<'float'>;
  delayPerUnit: Node<'float'>;
  /** Null for the galactic extension (no fake light-travel pattern). */
  continuumAt: ((tDays: Node<'float'>) => Node<'float'>) | null;
}): { density: TslDensityFn; emission: TslDensityFn } {
  const cache = new Map<unknown, JetFieldNodes>();
  const fieldFor = (pos: unknown): JetFieldNodes => {
    const hit = cache.get(pos);
    if (hit !== undefined) return hit;
    const built = buildFieldNodes(args.layout, pos);
    cache.set(pos, built);
    return built;
  };
  const length = args.layout.lengthUnits;
  return {
    density: ({ pos }) => fieldFor(pos).density as unknown,
    emission: ({ pos }) => {
      const field = fieldFor(pos);
      const spineColor = vec3(0.86, 0.93, 1.0);
      const sheathColor = vec3(0.3, 0.48, 0.88);
      const color = mix(sheathColor, spineColor, field.spineWeight);
      const along = clamp(field.outward.div(float(length)), 0, 1);
      const dim = mix(float(1.15), float(0.42), along);
      const scale = mix(float(JET_SHEATH_RADIANCE), float(JET_SPINE_RADIANCE), field.spineWeight);
      let radiance = color.mul(scale).mul(dim).mul(args.gain);
      if (args.continuumAt !== null) {
        radiance = radiance.mul(
          args.continuumAt(args.timeDays.sub(field.outward.mul(args.delayPerUnit)))
        );
      }
      return radiance as unknown;
    }
  };
}
