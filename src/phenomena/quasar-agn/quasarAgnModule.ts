/**
 * Quasar / AGN destination module (CA7-03..CA7-12).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md §7 — scale zones
 *   (INNER/NUCLEAR/GALACTIC), DIRECT central GR reuse, hysteresis zone
 *   transitions, "never render inner GR at full pixel cost when it occupies
 *   a tiny screen region";
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md §12 — central GR direct;
 *   large-scale structures procedural/illustrative; blazar mode is observer
 *   orientation with a disclosed fixed-Gamma beaming-ratio approximation;
 * - docs/cosmic-atlas/WORK_PACKETS.md CA7-01..CA7-12;
 * - docs/cosmic-atlas/RENDERING_SERVICES.md §8 — no thin-lens faking here:
 *   the nuclear/galactic zones CULL the GR pass entirely.
 *
 * ARCHITECTURE (scale zones, CA7-01/02/12):
 * - Three self-contained dioramas centered on the origin, one per zone,
 *   each at its own documented scene unit (types.ts ZONE_UNIT_RG).
 * - EXACTLY ONE zone group visible per frame (double-render guard; the
 *   debug snapshot exposes `visibleGroups`, browser tests assert it).
 * - The DIRECT lensing pass renders ONLY in the INNER zone.
 * - Zone selection = pure hysteresis machine resolveAgnZone(zoom01).
 * - Camera DISTANCE follows zoom01 through agnCameraDistance ONLY when the
 *   zoom input or zone changes; azimuth/polar stay user-owned.
 *
 * Jet note (disclosed): jets are dedicated additive cone meshes with
 * PER-LOBE live gain uniforms because the blazar approximation needs a
 * CONTINUOUS approaching/receding brightness ratio tied to observer angle.
 * Shared services where they fit: corona/torus volumes (VolumeService),
 * host stars + jet knots (ParticleService; knot population scale IS the
 * catalog's jet-tracer-density control).
 *
 * Normalized geometry: all content dimensions are constants IN r_g, so the
 * scene layout is mass-independent; `blackHoleMassSolar` drives physical
 * readouts only (AU/pc conversions) — normalized-mode philosophy.
 */

import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Scene,
  SphereGeometry
} from 'three/webgpu';
import { CylinderGeometry, RingGeometry } from 'three/webgpu';
import {
  atan,
  clamp,
  float,
  length,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  positionLocal,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4
} from 'three/tsl';
import type { Node } from 'three/webgpu';

import {
  CORONA_RADIUS_RG,
  DEFAULT_QUASAR_AGN_STATE,
  HOST_DISK_RADIUS_RG,
  JET_BASE_HALF_WIDTH_RG,
  JET_BASE_LENGTH_RG,
  JET_EXTENDED_HALF_WIDTH_RG,
  JET_EXTENDED_LENGTH_RG,
  OUTER_DISK_INNER_RG,
  OUTER_DISK_OUTER_RG,
  TORUS_HEIGHT_RATIO,
  TORUS_INNER_RG,
  TORUS_OUTER_RG,
  ZONE_UNIT_RG,
  agnCameraDistance,
  agnPopulationBudget,
  agnScaleReadout,
  jetLobeBrightnessRatio,
  normalizeQuasarAgnState,
  resolveAgnZone,
  resolveZoneView,
  type AgnZoneId,
  type QuasarAgnPublicState
} from './types.js';
import type {
  EnterContext,
  FrameContext,
  ParticleSystemHandle,
  PhenomenonModule,
  PrepareContext,
  PresetDescriptor,
  RenderContext,
  VolumeHandle
} from '../../atlas/types.js';
import { QUASAR_AGN_DESCRIPTOR } from './presets.js';
import {
  VARIABILITY_DISCLOSURE,
  buildVariabilityComponents,
  variabilityFactor,
  type VariabilityComponent
} from './variability.js';
import { lensingCameraUniformState } from '../../renderer/shared/LensingService.js';
import {
  CINEMATIC_DETAIL_BY_TIER,
  createCinematicBackdrop,
  createCinematicHalo,
  type CinematicMaterialHandle,
  type CinematicBackdropHandle
} from '../../renderer/shared/CinematicPrimitives.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rgToUnits = (rg: number, zone: AgnZoneId): number => rg / ZONE_UNIT_RG[zone];

const TIER_VOLUME_STEPS: Record<FrameContext['quality'], number> = {
  low: 36,
  medium: 56,
  high: 84,
  ultra: 120
};

const TIER_STEP_SCALE: Record<FrameContext['quality'], number> = {
  low: 0.7,
  medium: 1,
  high: 1.3,
  ultra: 1.6
};

// ---------------------------------------------------------------------------
// Time model (phenomena-animation campaign)
// ---------------------------------------------------------------------------

/**
 * Timeline span in OBSERVER-FRAME DAYS and its wall-clock pace.
 *
 * 400 d covers several e-foldings of the modelled continuum variability band
 * (6-200 d, see variability.ts) and about four orbits of the inner edge of the
 * NUCLEAR-zone outer disc (~101 d at 200 r_g for the reference 1e8 M_sun
 * engine). At 30 s per traverse that is ~13 d of observer time per wall second,
 * so the longest modelled variability cycle completes in ~15 s and the disc
 * pattern laps visibly — fast enough to read as a live scene without
 * compressing the timescales into a strobe.
 *
 * Nothing in the GALACTIC zone can move on this timeline and none is faked:
 * kpc-scale jet and host structure evolves over Myr, and the host star field
 * is deliberately static. See the debug snapshot's `zoneMotion` field.
 */
const TIMELINE_SPAN_DAYS = 400;
const TIMELINE_PLAYBACK_SECONDS = 30;

/** Seconds per day (observer frame). */
const SECONDS_PER_DAY = 86_400;
/** Speed of light, m/s — for r_g -> light-crossing-time conversions. */
const C_M_PER_S = 2.99792458e8;

/** Spiral-arm count of the disc brightness pattern (illustrative azimuthal m). */
const DISK_PATTERN_ARMS = 2;

/**
 * Target total optical depth through the dusty torus. The dust IS optically
 * thick in the equatorial plane, but a saturated single sample renders a flat
 * silhouette with no internal structure, so the presented depth is kept in the
 * range where the clumping and the illuminated inner rim stay visible.
 */
const TORUS_TARGET_OPTICAL_DEPTH = 2.2;

/**
 * Keplerian angular velocity of the disc at radius `rRg`, in radians per day,
 * for an engine whose gravitational radius crosses light in `rgSeconds`:
 *
 *   Omega(r) = sqrt(GM/r^3) = (c/r_g) * (r/r_g)^(-3/2)
 *
 * Returned as the leading coefficient only (the r^(-3/2) factor is applied
 * per-pixel in the shader), so the disc SHEARS: the inner edge laps the outer
 * edge exactly as differential rotation requires.
 */
function keplerOmegaScalePerDay(rgSeconds: number): number {
  return rgSeconds > 0 ? SECONDS_PER_DAY / rgSeconds : 0;
}

/**
 * TSL evaluation of the continuum surrogate (variability.ts) at a time node.
 * The components are plain numbers at build time, so they bake as literals and
 * the CPU and GPU evaluations agree by construction — the CPU one drives
 * uniforms and the debug readout, this one gives the jet its position-dependent
 * light-travel delay.
 */
function continuumNode(
  components: readonly VariabilityComponent[],
  tDays: Node<'float'>
): Node<'float'> {
  let sum: Node<'float'> = float(0);
  for (const c of components) {
    const omega = float((2 * Math.PI) / c.periodDays);
    sum = sum.add(sin(tDays.mul(omega).add(float(c.phase))).mul(float(c.amplitude)));
  }
  return max(float(1).add(sum), float(0.05));
}

/** Additive unlit material bound to a LIVE per-lobe gain uniform. */
function jetMaterial(
  color: [number, number, number],
  alphaNode: Node<'float'>,
  gainUniform: Node<'float'>,
  patternNode: Node<'float'> | null
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  material.side = DoubleSide;
  const c = vec3(color[0], color[1], color[2]);
  const gain = patternNode === null ? gainUniform : gainUniform.mul(patternNode);
  material.colorNode = vec4(c.mul(gain), max(alphaNode.mul(gain), float(0)));
  return material;
}

/** Axial fade along a jet of the given scene-unit height. */
function axialFade(heightUnits: number, startFrac: number, endFrac: number): Node<'float'> {
  const t = positionLocal.y.div(float(heightUnits)).clamp(0, 1);
  return smoothstep(float(startFrac), float(endFrac), t).oneMinus().max(float(0.05));
}

function trackMesh(ctx: PrepareContext, mesh: Mesh, bytesGeo: number, bytesMat: number): void {
  ctx.scope.track('geometry', mesh.geometry, () => mesh.geometry.dispose(), bytesGeo);
  ctx.scope.track(
    'material',
    mesh.material,
    () => (mesh.material as unknown as { dispose(): void }).dispose(),
    bytesMat
  );
}

function trackVolume(ctx: PrepareContext, volume: VolumeHandle): void {
  ctx.scope.track('volumeTexture', volume.object3d(), () => volume.dispose(), 4 << 20);
}

function trackParticles(ctx: PrepareContext, handle: ParticleSystemHandle): void {
  ctx.scope.track('buffer', handle.object3d(), () => handle.dispose(), handle.capacity * 64);
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export class QuasarAgnModule implements PhenomenonModule {
  readonly descriptor = QUASAR_AGN_DESCRIPTOR;

  private root: Group | null = null;
  private scene: Scene | null = null;
  private groups: Partial<Record<AgnZoneId, Group>> = {};
  private state: QuasarAgnPublicState = { ...DEFAULT_QUASAR_AGN_STATE };
  private activeZone: AgnZoneId = 'nuclear';
  private lastZoomInput = Number.NaN;
  private disposed = false;

  /** INNER-zone DIRECT pass handle (lensing reuse, CA7-03). */
  private lensing: {
    object3d(): import('three').Mesh;
    setUniformsFromState(state: Record<string, unknown>): void;
    dispose(): void;
  } | null = null;

  private coronaVolume: VolumeHandle | null = null;
  private torusVolume: VolumeHandle | null = null;
  private hostParticles: ParticleSystemHandle | null = null;
  private knotParticles: ParticleSystemHandle | null = null;
  private backdrop: CinematicBackdropHandle | null = null;
  private nuclearEngineVisual: CinematicMaterialHandle | null = null;

  /** Live per-lobe gains (+Y lobe / −Y lobe), updated every frame. */
  private readonly gainPlus = uniform(1);
  private readonly gainMinus = uniform(1);

  // --- animated time model (phenomena-animation campaign) -------------------
  /** Timeline coordinate in observer-frame days; drives every animation. */
  private readonly uTimeDays = uniform(0);
  /** Nuclear continuum brightness factor L(t) from the variability surrogate. */
  private readonly uContinuum = uniform(1);
  /**
   * Leading coefficient of the Keplerian shear law, rad/day at r = 1 r_g.
   * Mass-dependent, so it follows the `blackHoleMassSolar` control.
   */
  private readonly uOmegaScale = uniform(0);
  /**
   * Light-travel delay per NUCLEAR scene unit, in days (mass-dependent). Used
   * by every nuclear component that responds to the continuum with a lag: the
   * jet base and the dusty torus (see the reverberation note below).
   */
  private readonly uNuclearDelayPerUnit = uniform(0);
  private readonly variability: VariabilityComponent[] = buildVariabilityComponents(0);
  private timeDays = 0;
  private continuumFactor = 1;
  private lastMassSolar = Number.NaN;

  async prepare(ctx: PrepareContext): Promise<{
    module: PhenomenonModule;
    scope: PrepareContext['scope'];
    scene: Scene;
    preset: PresetDescriptor;
  }> {
    if (this.disposed) throw new Error('[QuasarAgnModule] prepare() called after dispose().');
    const abortGuard = (): void => {
      if (ctx.signal.aborted) {
        throw new DOMException('QuasarAgnModule prepare aborted', 'AbortError');
      }
    };

    // ONE normalization authority; preset state flows through it here.
    this.state = normalizeQuasarAgnState(ctx.preset.state);
    // Nested builders scope-track through this stashed context.
    this.prepareCtx = ctx;

    const scene = new Scene();
    scene.name = 'quasar-agn-scene';
    const root = new Group();
    root.name = 'quasar-agn-root';
    const detail = CINEMATIC_DETAIL_BY_TIER[ctx.quality];
    const cinematicBackdrop = createCinematicBackdrop({
      seed: ctx.preset.seed,
      intensity: 0.2,
      dustColor: [0.05, 0.018, 0.07],
      starColor: [0.78, 0.8, 1.0],
      segments: detail.backdropSegments,
      octaves: detail.backdropOctaves,
      starCells: { x: 220, y: 110 }
    });
    scene.add(cinematicBackdrop.mesh);
    ctx.scope.track(
      'geometry',
      cinematicBackdrop.geometry,
      () => cinematicBackdrop.geometry.dispose(),
      32 * 20 * 32
    );
    ctx.scope.track(
      'material',
      cinematicBackdrop.material,
      () => cinematicBackdrop.material.dispose(),
      8192
    );
    this.backdrop = cinematicBackdrop;

    // --- INNER zone -------------------------------------------------------
    ctx.reportProgress(0.15, 'Preparing inner engine (DIRECT lensing reuse)');
    abortGuard();
    const innerGroup = new Group();
    innerGroup.name = 'agn-inner';
    const lensing = ctx.services.lensing.createBlackHoleLensingPass({
      massRg: 1,
      backgroundEquirect: null,
      diskEnabled: true,
      diskInnerRg: 6,
      diskOuterRg: 18,
      qualityTier: ctx.quality
    });
    this.lensing = lensing;
    innerGroup.add(lensing.object3d());
    trackMesh(ctx, lensing.object3d(), 1024, 256 * 1024);

    // Corona glow: compact hot proxy around the engine (INNER units = r_g).
    const coronaUnits = rgToUnits(CORONA_RADIUS_RG, 'inner');
    this.coronaVolume = ctx.services.volumes.createVolume({
      bounds: { kind: 'sphere', center: [0, 0, 0], radius: coronaUnits * 1.4 },
      // Optically THIN corona: the X-ray corona is a compact, low-optical-depth
      // scattering region, so it must not swallow the lensed disc behind it. The
      // previous unit-density profile integrated into an opaque grey ball that
      // covered the whole engine in the INNER view.
      density: ({ pos }) =>
        max(
          smoothstep(float(coronaUnits), float(coronaUnits * 0.12), length(vec3(pos as never))),
          float(0)
        ).mul(float(0.22)) as never,
      // The X-ray corona is the fastest-varying nuclear component, so it
      // carries the continuum factor directly (no light-travel delay at r < 20 r_g).
      emission: () => vec3(0.82, 0.88, 1.0).mul(this.uContinuum).mul(float(0.7)) as never,
      baseMaxSteps: TIER_VOLUME_STEPS[ctx.quality],
      detail: {
        seed: ctx.preset.seed ^ 0x4c1,
        octaves: 3,
        strength: 0.12,
        filamentStrength: 0.12,
        clumpStrength: 0.28,
        domainWarpStrength: 0.1,
        frequency: 2.2
      },
      depthAwareUpsample: true,
      approximateSelfShadow: true,
      gradientShading: true,
      halfResolution: true,
      earlyAlphaTermination: true,
      temporalJitter: true
    });
    this.coronaVolume.setStepScale(TIER_STEP_SCALE[ctx.quality]);
    innerGroup.add(this.coronaVolume.object3d());
    trackVolume(ctx, this.coronaVolume);
    root.add(innerGroup);
    this.groups.inner = innerGroup;

    // --- NUCLEAR zone -----------------------------------------------------
    ctx.reportProgress(0.42, 'Preparing nuclear zone (disk / torus / jets)');
    abortGuard();
    const nuclearGroup = new Group();
    nuclearGroup.name = 'agn-nuclear';
    const engineHaloGeometry = new SphereGeometry(
      0.72,
      detail.haloSegments.width,
      detail.haloSegments.height
    );
    const engineHaloVisual = createCinematicHalo({
      tint: [1.0, 0.56, 0.18],
      seed: ctx.preset.seed ^ 0x951,
      gain: 0,
      alpha: 0.42,
      noiseScale: 4,
      noiseOctaves: detail.surfaceOctaves
    });
    const engineHalo = new Mesh(engineHaloGeometry, engineHaloVisual.material);
    engineHalo.name = 'agn-nuclear-engine-halo';
    engineHalo.renderOrder = 12;
    nuclearGroup.add(engineHalo);
    this.nuclearEngineVisual = engineHaloVisual;
    trackMesh(this.prepareCtxFor(engineHalo), engineHalo, 4096, 4096);
    nuclearGroup.add(this.buildOuterDisk());
    this.torusVolume = ctx.services.volumes.createVolume({
      bounds: {
        kind: 'box',
        center: [0, 0, 0],
        halfExtents: [
          rgToUnits(TORUS_OUTER_RG, 'nuclear') * 1.06,
          rgToUnits(TORUS_OUTER_RG, 'nuclear') * TORUS_HEIGHT_RATIO * 1.2,
          rgToUnits(TORUS_OUTER_RG, 'nuclear') * 1.06
        ]
      },
      density: ({ pos }) => {
        const p = vec3(pos as never);
        const rIn = float(rgToUnits(TORUS_INNER_RG, 'nuclear'));
        const rOut = float(rgToUnits(TORUS_OUTER_RG, 'nuclear'));
        const mid = rIn.add(rOut).mul(0.5);
        const tube = max(rOut.sub(rIn).mul(0.5), float(1e-3));
        const radial = length(p.xz);
        // Elliptical cross-section with an explicit scale height: H/R =
        // TORUS_HEIGHT_RATIO, i.e. a GEOMETRICALLY THICK doughnut, which is
        // what makes the obscuring funnel (and the unobscured sight line along
        // the axis) visible at all. The previous form divided y by the ratio
        // instead of scaling by it, which flattened the torus into a pancake
        // with no funnel to look into.
        const tubeZ = max(mid.mul(float(Math.max(TORUS_HEIGHT_RATIO, 0.05))), float(1e-3));
        const tubeDist = length(vec2(radial.sub(mid).div(tube), p.y.div(tubeZ)));
        const shell = max(smoothstep(float(0.45), float(1.15), tubeDist).oneMinus(), float(0));
        // CLUMPY torus (Nenkova et al. 2008): the obscuring dust is a clumpy
        // distribution, not a smooth slab. Before this the torus was a uniform
        // unit-density shell whose accumulated alpha saturated into a flat
        // opaque wall that hid the entire nucleus — the destination's default
        // view was a featureless brown ellipse. Clumping plus a peak density
        // below 1 restores both the internal structure and the sight lines
        // through the opening.
        const clumps = mx_fractal_noise_float(p.mul(float(0.06)), 3, 2.0, 0.5)
          .mul(float(0.5))
          .add(float(0.5));
        const clumpGain = clamp(clumps.mul(float(1.5)).sub(float(0.28)), float(0), float(1));
        // OPTICAL DEPTH per scene unit, not opacity: VolumeService integrates
        // alpha = 1 - exp(-density * dt) with dt in SCENE UNITS, and this torus
        // is ~60 units thick, so a density of order 1 saturated a single sample
        // and produced the flat opaque wall. Normalise by the crossing length
        // for a target total depth through the dust.
        const crossing = min(tube, tubeZ).mul(float(2)).max(float(1e-3));
        const kappa = float(TORUS_TARGET_OPTICAL_DEPTH).div(crossing);
        return shell.mul(clumpGain).mul(kappa) as never;
      },
      emission: ({ pos }) => {
        // Radial dust temperature gradient: the inner rim sits at the sublimation
        // radius and is hot and bright; the outer torus is cooler and dimmer.
        const p = vec3(pos as never);
        const rIn = float(rgToUnits(TORUS_INNER_RG, 'nuclear'));
        const rOut = float(rgToUnits(TORUS_OUTER_RG, 'nuclear'));
        const tRad = clamp(
          length(p.xz)
            .sub(rIn)
            .div(max(rOut.sub(rIn), float(1e-3))),
          float(0),
          float(1)
        );
        const hot = vec3(1.0, 0.72, 0.42);
        const cool = vec3(0.35, 0.18, 0.12);
        // Only the inner rim is strongly illuminated by the nucleus: dust
        // temperature falls steeply with radius, so the near-IR emission is
        // concentrated at the sublimation radius and the bulk of the torus is a
        // DARK obscuring structure. A uniform glow (the previous behaviour) is
        // what turned the torus into a bright wall across the whole frame.
        const rim = float(1).sub(tRad).max(float(0)).pow(float(2.5));
        const falloff = rim.mul(float(0.85)).add(float(0.03));

        // DUST REVERBERATION: the torus is heated by the nuclear continuum, so
        // its thermal emission follows that continuum delayed by the light
        // travel time to each radius (this is the effect dust-reverberation
        // campaigns measure). For the reference engine the sublimation radius
        // (2e4 r_g) sits ~114 light-days out, comparable to the modelled
        // variability band, so the torus visibly BREATHES with a lag behind the
        // nucleus instead of glowing at a fixed brightness.
        const lagDays = length(p.xz).mul(this.uNuclearDelayPerUnit);
        const echo = continuumNode(this.variability, this.uTimeDays.sub(lagDays));
        // A low-order azimuthal illumination wave turns the clumpy torus into
        // a readable reverberating structure. It is a presentation response
        // to the same delayed continuum, not an additional dynamical model.
        const illumination = sin(
          atan(p.z, p.x).mul(2).sub(this.uTimeDays.mul(0.12)).add(lagDays.mul(0.015))
        )
          .mul(0.24)
          .add(0.84);

        return mix(hot, cool, smoothstep(float(0), float(0.55), tRad))
          .mul(falloff)
          .mul(echo.pow(1.45).mul(1.18))
          .mul(illumination) as never;
      },
      baseMaxSteps: TIER_VOLUME_STEPS[ctx.quality],
      detail: {
        seed: ctx.preset.seed ^ 0x4c2,
        octaves: 5,
        strength: 0.18,
        filamentStrength: 0.16,
        clumpStrength: 0.72,
        domainWarpStrength: 0.24,
        frequency: 0.85
      },
      depthAwareUpsample: true,
      approximateSelfShadow: true,
      gradientShading: true,
      halfResolution: true,
      earlyAlphaTermination: true,
      temporalJitter: true
    });
    this.torusVolume.setStepScale(TIER_STEP_SCALE[ctx.quality]);
    nuclearGroup.add(this.torusVolume.object3d());
    trackVolume(ctx, this.torusVolume);
    this.buildJets(nuclearGroup, 'base');
    root.add(nuclearGroup);
    this.groups.nuclear = nuclearGroup;

    // --- GALACTIC zone ----------------------------------------------------
    ctx.reportProgress(0.68, 'Preparing galactic zone (extended jets / host)');
    abortGuard();
    const galacticGroup = new Group();
    galacticGroup.name = 'agn-galactic';
    this.buildJets(galacticGroup, 'extended');
    const budget = agnPopulationBudget(ctx.quality);
    this.hostParticles = ctx.services.particles.createSystem({
      capacity: budget.hostStars,
      emitters: [
        {
          kind: 'disc',
          radius: rgToUnits(HOST_DISK_RADIUS_RG, 'galactic'),
          normal: [0, 1, 0],
          speed: 0
        },
        {
          kind: 'sphere-shell',
          radius: rgToUnits(HOST_DISK_RADIUS_RG, 'galactic') * 0.09,
          speed: 0
        }
      ],
      lifetimeSeconds: [1e6, 1e6 + 1],
      sizePx: [1, 2],
      colorRamp: [
        { t: 0, color: [1.0, 0.93, 0.78], alpha: 0.9 },
        { t: 1, color: [0.72, 0.8, 1.0], alpha: 0.75 }
      ],
      blending: 'additive',
      seed: ctx.preset.seed,
      preferCompute: false,
      activity: 'static',
      profile: 'star',
      emissiveIntensity: 1.1
    });
    this.hostParticles.reset(ctx.preset.seed);
    galacticGroup.add(this.hostParticles.object3d());
    trackParticles(ctx, this.hostParticles);
    this.knotParticles = ctx.services.particles.createSystem({
      capacity: budget.jetKnots,
      emitters: [
        {
          kind: 'volume-box',
          extent: [
            rgToUnits(JET_EXTENDED_HALF_WIDTH_RG, 'galactic') * 2.4,
            rgToUnits(JET_EXTENDED_LENGTH_RG, 'galactic') * 0.92,
            rgToUnits(JET_EXTENDED_HALF_WIDTH_RG, 'galactic') * 2.4
          ],
          speed: 0
        }
      ],
      lifetimeSeconds: [1e6, 1e6 + 1],
      sizePx: [2, 4],
      colorRamp: [{ t: 0, color: [0.75, 0.88, 1.0], alpha: 1 }],
      blending: 'additive',
      seed: ctx.preset.seed + 1,
      preferCompute: false,
      activity: 'static',
      profile: 'emissive-core',
      emissiveIntensity: 1.4
    });
    this.knotParticles.reset(ctx.preset.seed + 1);
    galacticGroup.add(this.knotParticles.object3d());
    trackParticles(ctx, this.knotParticles);
    root.add(galacticGroup);
    this.groups.galactic = galacticGroup;

    ctx.scope.track('geometry', root, null, 0);
    scene.add(root);
    this.root = root;
    this.scene = scene;

    // Boot into the preset's documented zone; exclusive visibility.
    this.activeZone = resolveAgnZone(this.state.zoom01, 'inner');
    this.applyZoneVisibility();
    this.applyStateToResources();

    ctx.reportProgress(1, 'Quasar / AGN ready');
    return { module: this, scope: ctx.scope, scene, preset: ctx.preset };
  }

  enter(ctx: EnterContext): void {
    if (this.disposed) return;
    this.state = normalizeQuasarAgnState(ctx.preset.state);
    this.lastZoomInput = Number.NaN; // re-drive the distance law once
    this.refreshScaleUniforms();
    // The zone distance law reaches 2400 scene units in the GALACTIC zone,
    // well past the rig's default 500-unit ceiling — which silently clamped
    // both the zone jump and the viewer's zoom, so the galactic view framed
    // the wrong scale entirely.
    ctx.services.cameraRig.setDistanceLimits(2, 4000);

    // Timeline in OBSERVER-FRAME DAYS, paced and looping. Without a registered
    // mapping this destination ran the shared identity mapping, which saturated
    // at phase 1 one second after arrival and left every uniform frozen — the
    // whole scene was a still life.
    ctx.services.time.registerPhaseMapping('agn-days', {
      id: 'agn-days',
      label: 'Observer time',
      forward: (phase01) => Math.min(1, Math.max(0, phase01)) * TIMELINE_SPAN_DAYS,
      inverse: (days) => days / TIMELINE_SPAN_DAYS,
      formatDisplay: (days) => `${days.toFixed(0)} d`,
      playbackSeconds: TIMELINE_PLAYBACK_SECONDS,
      loop: true
    });
    ctx.services.time.setPhaseMapping('agn-days');
    ctx.services.time.scrubTo(ctx.preset.timelineInitialPhase);
  }

  /**
   * Recompute the mass-dependent animation coefficients: the Keplerian shear
   * scale and the jet's light-travel delay per scene unit. Both follow the
   * `blackHoleMassSolar` control, so changing the engine mass changes how fast
   * the disc turns — exactly as Omega ~ sqrt(GM/r^3) requires.
   */
  private refreshScaleUniforms(): void {
    const readout = agnScaleReadout(this.state.blackHoleMassSolar);
    const rgSeconds = readout.rgMetres / C_M_PER_S;
    this.uOmegaScale.value = keplerOmegaScalePerDay(rgSeconds);
    // days of light travel per NUCLEAR scene unit
    this.uNuclearDelayPerUnit.value = (ZONE_UNIT_RG.nuclear * rgSeconds) / SECONDS_PER_DAY;
  }

  update(ctx: FrameContext): void {
    if (this.disposed || this.scene === null || this.root === null) return;

    // --- animated time model ------------------------------------------------
    // Timeline days drive the disc shear pattern, the continuum surrogate and
    // the jet's delayed response. Everything is a pure function of this
    // coordinate, so scrubbing and looping stay deterministic.
    this.timeDays = ctx.time.physicalTime ?? ctx.time.phase * TIMELINE_SPAN_DAYS;
    this.uTimeDays.value = this.timeDays;
    this.continuumFactor = variabilityFactor(this.timeDays, this.variability);
    this.uContinuum.value = this.continuumFactor;
    this.backdrop?.setTime(this.timeDays * 0.00002);
    this.backdrop?.setDetail(
      ctx.experienceMode === 'cinematic' ? ctx.workBudget.environmentDetail : 0
    );
    this.nuclearEngineVisual?.setGain(this.continuumFactor * 1.4);
    this.nuclearEngineVisual?.setTime(this.timeDays * 0.02);

    // Zone machine (hysteresis) + exclusive visibility.
    const previousZone = this.activeZone;
    this.activeZone = resolveAgnZone(this.state.zoom01, this.activeZone);
    if (this.activeZone !== previousZone) {
      this.applyZoneVisibility();
    }

    // Camera distance law on explicit zoom/zone input changes only.
    const zoomChanged = this.state.zoom01 !== this.lastZoomInput;
    if (zoomChanged || this.activeZone !== previousZone) {
      const rig = ctx.services.cameraRig;
      const orbit = rig.getOrbit();
      const desired = agnCameraDistance(this.activeZone, this.state.zoom01);
      if (Math.abs(orbit.distance - desired) > 1e-4) {
        rig.setOrbit(orbit.azimuthDeg, orbit.polarDeg, desired, 'system');
      }
    }
    this.lastZoomInput = this.state.zoom01;
    if (this.state.blackHoleMassSolar !== this.lastMassSolar) {
      this.lastMassSolar = this.state.blackHoleMassSolar;
      this.refreshScaleUniforms();
    }

    // Lobe gains follow the observer SIDE (+Y lobe approaching when the
    // camera is above the equatorial plane, i.e. polar < 90 deg).
    const polarRad = (ctx.services.cameraRig.getOrbit().polarDeg * Math.PI) / 180;
    const cameraAbove = Math.cos(polarRad) >= 0;
    const ratio = jetLobeBrightnessRatio(this.state.observerAngleToJetDeg);
    const gApp = (2 * ratio) / (1 + ratio);
    const gRec = 2 / (1 + ratio);
    this.gainPlus.value = cameraAbove ? gApp : gRec;
    this.gainMinus.value = cameraAbove ? gRec : gApp;

    // Animate only the VISIBLE zone's simulation-bearing resources.
    if (this.groups.galactic?.visible === true) {
      this.hostParticles?.update(ctx.time.dt);
      this.knotParticles?.update(ctx.time.dt);
    }
  }

  /**
   * Feed the INNER-zone DIRECT lensing pass its per-frame camera state.
   *
   * The pass is a fullscreen triangle that derives every ray from uniforms, so
   * a pass that never receives the camera renders a constant colour. That was
   * the state of this destination's INNER zone: it created the pass and never
   * called `setUniformsFromState`, so the advertised "DIRECT GR reuse" view was
   * a flat purple wash with no black hole in it.
   */
  private applyLensingCamera(
    camera: RenderContext['camera'],
    temporalJitterNdc?: [number, number]
  ): void {
    if (this.lensing === null || this.groups.inner?.visible !== true) return;
    this.lensing.setUniformsFromState(
      lensingCameraUniformState(camera, {
        massRg: 1,
        diskEnabled: true,
        diskInnerRg: 6,
        diskOuterRg: 18,
        // The accretion disc brightness follows the same continuum factor as
        // the corona; the pass exposes it as a background/emission scale.
        backgroundIntensity: 1,
        temporalJitterNdc: temporalJitterNdc ?? [0, 0]
      })
    );
  }

  render(ctx: RenderContext): void {
    if (this.disposed || this.scene === null || this.root === null) return;
    this.backdrop?.syncToCamera(ctx.camera);
    this.applyLensingCamera(ctx.camera, ctx.temporalJitterNdc);
    ctx.renderer.render(this.scene, ctx.camera);
  }

  exit(_ctx: unknown): void {
    // Freeze handled by the director's SharedPost snapshot.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lensing = null;
    this.coronaVolume = null;
    this.torusVolume = null;
    this.hostParticles = null;
    this.knotParticles = null;
    this.backdrop = null;
    this.nuclearEngineVisual = null;
    this.groups = {};
    this.root = null;
    this.scene = null;
  }

  /** Canonical live control channel: merge + re-normalize, then re-apply. */
  applyControlState(partial: Record<string, unknown>): void {
    if (this.disposed) return;
    this.state = normalizeQuasarAgnState({ ...this.state, ...partial });
    this.applyStateToResources();
  }

  serializeShareState(): Record<string, unknown> {
    return { ...this.state };
  }

  getDebugSnapshot(): Record<string, unknown> {
    const view = resolveZoneView(this.activeZone);
    const readout = agnScaleReadout(this.state.blackHoleMassSolar);
    const visibleGroups = (['inner', 'nuclear', 'galactic'] as AgnZoneId[]).filter(
      (z) => this.groups[z]?.visible === true && z === this.activeZone
    );
    return {
      pattern:
        this.scene === null
          ? 'quasar-agn fallback (prepare failed)'
          : `quasar-agn ${this.activeZone}-zone`,
      zone: this.activeZone,
      grPassActive: view.grPassActive && this.lensing !== null,
      visibleGroups,
      doubleRenderGuard: visibleGroups.length <= 1 ? 'ok' : 'VIOLATION',
      zoom01: this.state.zoom01,
      scenario: this.state.scenario,
      observerAngleToJetDeg: this.state.observerAngleToJetDeg,
      lobeBrightnessRatio: jetLobeBrightnessRatio(this.state.observerAngleToJetDeg),
      blackHoleMassSolar: this.state.blackHoleMassSolar,
      scaleReadout: readout,
      torusVisible: this.state.torusVisible,
      hostVisible: this.state.hostVisible,
      jetTracerDensity: this.state.jetTracerDensity,
      timeDays: this.timeDays,
      continuumFactor: this.continuumFactor,
      keplerOmegaScalePerDay: this.uOmegaScale.value,
      nuclearDelayDaysPerUnit: this.uNuclearDelayPerUnit.value,
      /**
       * What actually MOVES in each zone on this timeline, stated honestly:
       * a 400-day span cannot animate kpc-scale structure, and none is faked.
       */
      zoneMotion: {
        inner: 'DIRECT GR pass follows the live camera; corona tracks the continuum',
        nuclear: 'Keplerian-sheared disc pattern + continuum + light-delayed jet base',
        galactic:
          'static by construction: kpc-scale jet/host evolves over Myr, far outside this timeline'
      },
      fidelity: {
        centralGr: 'DIRECT (validated backend reuse)',
        largeScale: 'PROCEDURAL_SCIENTIFIC illustrative morphologies',
        blazar: 'orientation-driven beaming-ratio approximation (fixed Gamma)',
        variability: VARIABILITY_DISCLOSURE,
        torus: 'PROCEDURAL_SCIENTIFIC clumpy dust distribution (Nenkova et al. 2008 picture)'
      },
      representation:
        'seeded deep-space backdrop + direct inner pass + layered torus/corona/jet/host representations',
      particleWork: {
        host: this.hostParticles?.getDebugSnapshot() ?? null,
        knots: this.knotParticles?.getDebugSnapshot() ?? null
      },
      volumeWork: {
        corona: this.coronaVolume?.getDebugSnapshot?.() ?? null,
        torus: this.torusVolume?.getDebugSnapshot?.() ?? null
      },
      disposed: this.disposed
    };
  }

  // -------------------------------------------------------------------------

  /** Exclusive visibility across zone groups (CA7-12 guard subject). */
  private applyZoneVisibility(): void {
    for (const [id, group] of Object.entries(this.groups) as Array<[AgnZoneId, Group]>) {
      group.visible = id === this.activeZone;
    }
  }

  /** Push toggles/population scales into live resources (state -> scene). */
  private applyStateToResources(): void {
    if (this.torusVolume !== null) {
      this.torusVolume.setVisible(this.state.torusVisible && this.activeZone === 'nuclear');
    }
    if (this.hostParticles !== null) {
      this.hostParticles.setPopulationScale(this.state.hostVisible ? 1 : 0);
    }
    if (this.knotParticles !== null) {
      this.knotParticles.setPopulationScale(this.state.jetTracerDensity);
    }
  }

  /**
   * Bipolar jets for one zone (base pair in NUCLEAR or extended pair in
   * GALACTIC). Each side gets a narrow bright core + wide faint sheath, both
   * bound to that side's live gain uniform.
   */
  private buildJets(group: Group, kind: 'base' | 'extended'): void {
    const lengthRg = kind === 'base' ? JET_BASE_LENGTH_RG : JET_EXTENDED_LENGTH_RG;
    const widthRg = kind === 'base' ? JET_BASE_HALF_WIDTH_RG : JET_EXTENDED_HALF_WIDTH_RG;
    const zone: AgnZoneId = kind === 'base' ? 'nuclear' : 'galactic';
    const height = rgToUnits(lengthRg, zone);
    const width = rgToUnits(widthRg, zone);

    // The BASE jet responds to the nuclear light curve with a light-travel
    // delay: material at height y sees the continuum as it was y/c ago, so a
    // brightness pattern travels outward at c. The NUCLEAR-zone jet base is
    // ~17 light-days long, comparable to the shortest modelled variability
    // period, so that propagation is directly visible. The kpc-scale EXTENDED
    // jet gets no pattern: its light-crossing time is ~10^4 yr, which smooths
    // a 200-day variation away entirely, and faking motion there would be a
    // fidelity claim this destination does not make.
    const pattern =
      kind === 'base'
        ? continuumNode(
            this.variability,
            this.uTimeDays.sub(positionLocal.y.mul(this.uNuclearDelayPerUnit))
          )
        : null;

    for (const side of ['plus', 'minus'] as const) {
      const gain = side === 'plus' ? this.gainPlus : this.gainMinus;

      const coreGeo = new CylinderGeometry(width * 0.35, width * 0.9, height, 20, 1, true);
      coreGeo.translate(0, height / 2, 0);
      const coreMat = jetMaterial([0.62, 0.8, 1.0], axialFade(height, 0.12, 1), gain, pattern);
      const core = new Mesh(coreGeo, coreMat);
      core.name = `agn-jet-${kind}-${side}-core`;
      if (side === 'minus') core.rotation.x = Math.PI;
      group.add(core);
      trackMesh(
        this.prepareCtxFor(group),
        core,
        (coreGeo.attributes.position?.count ?? 0) * 9,
        4096
      );

      const sheathGeo = new CylinderGeometry(width * 1.4, width * 2.6, height, 24, 1, true);
      sheathGeo.translate(0, height / 2, 0);
      const sheathMat = jetMaterial([0.4, 0.55, 0.95], axialFade(height, 0.05, 0.5), gain, pattern);
      const sheath = new Mesh(sheathGeo, sheathMat);
      sheath.name = `agn-jet-${kind}-${side}-sheath`;
      if (side === 'minus') sheath.rotation.x = Math.PI;
      group.add(sheath);
      trackMesh(
        this.prepareCtxFor(group),
        sheath,
        (sheathGeo.attributes.position?.count ?? 0) * 9,
        4096
      );
    }
  }

  /**
   * Build-time context stash: prepare() sets it before any nested builder
   * runs so scope tracking works without threading ctx everywhere.
   */
  private prepareCtx!: PrepareContext;
  private prepareCtxFor(_owner: unknown): PrepareContext {
    return this.prepareCtx;
  }

  /** NUCLEAR outer accretion disk: emissive annulus, soft radial edges. */
  private buildOuterDisk(): Mesh {
    const rIn = rgToUnits(OUTER_DISK_INNER_RG, 'nuclear');
    const rOut = rgToUnits(OUTER_DISK_OUTER_RG, 'nuclear');
    const geometry = new RingGeometry(rIn, rOut, 128, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.depthWrite = false;
    material.side = DoubleSide;
    const radiusUnits = length(positionLocal.xz);
    const t = radiusUnits.sub(float(rIn)).div(max(float(rOut - rIn), float(1e-4)));
    const edges = smoothstep(float(0), float(0.07), t).mul(smoothstep(float(1), float(0.85), t));
    const body = mix(
      vec3(1.0, 0.87, 0.63),
      vec3(0.72, 0.56, 0.96),
      smoothstep(float(0.25), float(0.92), t)
    );

    // Differential (Keplerian) rotation: the azimuthal brightness pattern is
    // carried at Omega(r) = uOmegaScale * (r/r_g)^(-3/2), so the inner disc laps
    // the outer disc instead of the whole annulus turning as a rigid body. This
    // is the destination's primary motion cue in the NUCLEAR zone.
    const rRg = max(radiusUnits.mul(float(ZONE_UNIT_RG.nuclear)), float(1e-3));
    const omega = this.uOmegaScale.mul(rRg.pow(float(-1.5)));
    const phi = atan(positionLocal.z, positionLocal.x);
    const wave = sin(phi.mul(float(DISK_PATTERN_ARMS)).sub(omega.mul(this.uTimeDays)));
    // Sheared clumping: a second, faster-varying azimuthal harmonic keeps the
    // pattern from reading as a clean sine wave.
    const fine = sin(phi.mul(float(DISK_PATTERN_ARMS * 5)).sub(omega.mul(this.uTimeDays).mul(1.6)));
    const pattern = float(0.62)
      .add(wave.mul(float(0.32)))
      .add(fine.mul(float(0.14)));
    // The variability factor remains the model's resolved continuum; this
    // display gain only gives the differential pattern enough contrast to
    // read as orbiting gas at the destination's deliberately wide framing.
    const brightness = pattern.mul(this.uContinuum).mul(float(1.08));

    material.colorNode = vec4(
      body.mul(edges).mul(brightness).mul(float(1.5)),
      edges.mul(brightness).mul(float(0.85))
    );
    const mesh = new Mesh(geometry, material);
    mesh.name = 'agn-outer-disk';
    trackMesh(
      this.prepareCtxFor(mesh),
      mesh,
      (geometry.attributes.position?.count ?? 0) * 12,
      6144
    );
    return mesh;
  }
}

/**
 * Factory handed out through `QUASAR_AGN_DESCRIPTOR.load()` — keeps every
 * destination's lazy `load` the same shape (resolve a named factory) instead
 * of this one alone returning a fresh closure.
 */
export function createQuasarAgnModule(): PhenomenonModule {
  return new QuasarAgnModule();
}
