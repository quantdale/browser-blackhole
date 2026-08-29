/**
 * Tidal Disruption destination module (CA6 rendering integration).
 *
 * Composes the shared Atlas services around the CPU-validated physics core
 * in this package (types/trajectory/deformation/disruption/debris/stream/
 * timeline/shock). Spec sources:
 *
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 6 (minimum viable
 *   sequence; renderer reuse: RibbonService debris, ParticleService gas,
 *   VolumeService shock; phase-dependent activation);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 9 (invariants);
 * - docs/cosmic-atlas/RENDERING_SERVICES.md sections 3/4/5 (services);
 * - mission CA6-05..CA6-12 (debris spawn, stream, bound/unbound proxy,
 *   winding, shock volume, nascent disk, distance/phase LOD, deterministic
 *   scrub/reset).
 *
 * FIDELITY CLASS: PROCEDURAL_SCIENTIFIC driven by validated orbital/tidal
 * parameters. Every number shown derives from the disclosed reduced models
 * in this package; nothing here invents physics. Presentation choices (BH
 * marker ring, accent particles, handoff fades) are disclosed at their
 * definition sites.
 *
 * PHASE-AWARE RESOURCES (CA6-11): approach/deformation pay ZERO debris cost
 * (ribbons hidden with an empty draw range, particles populationScale=0,
 * volume hidden); the shock volume activates only during the shock stage;
 * the nascent-disk stage retires the stream ribbons. An angular-size gate
 * suppresses accent systems when the debris region subtends a negligible
 * screen fraction. Everything stays subordinate to the single global
 * governor (tier arrives via FrameContext; no destination-local resolution
 * controller exists here).
 *
 * Determinism: no wall-clock reads. The simulation clock IS the shared
 * TimeController internal coordinate (seconds relative to periapsis);
 * scrub/reset reproduces identical state.
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import { AutoFramer } from '../../renderer/shared/AutoFramer.js';
import {
  CINEMATIC_DETAIL_BY_TIER,
  createCinematicBackdrop,
  createCinematicDiscMaterial,
  createCinematicHalo,
  createCinematicSurfaceMaterial,
  type CinematicBackdropHandle,
  type CinematicMaterialHandle
} from '../../renderer/shared/CinematicPrimitives.js';
import {
  atan,
  clamp,
  dot,
  float,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4
} from 'three/tsl';

import type {
  EnterContext,
  ExitContext,
  FrameContext,
  PhenomenonModule,
  PrepareContext,
  PreparedPhenomenon,
  QualityTier,
  RenderContext,
  VolumeHandle,
  ParticleSystemHandle,
  RibbonHandle,
  StrandHandle
} from '../../atlas/types.js';
import {
  METRES_PER_SCENE_UNIT,
  normalizeTidalDisruptionState,
  resolveTidalDisruptionEncounter,
  TIER_PARTICLE_CAPACITY,
  TIER_STAR_SEGMENTS,
  TIER_STEP_SCALE,
  TIER_STREAM_SAMPLES,
  TIER_VOLUME_STEPS,
  visualStarRadius,
  type ResolvedTdeEncounter,
  type TdePhase,
  type TidalDisruptionPublicState
} from './types.js';
import { barkerSeconds, encounterStateAt, inverseBarker } from './trajectory.js';
import { deformationAt } from './deformation.js';
import { disruptionVerdict } from './disruption.js';
import { buildDebrisPlan, classificationFractions, REFERENCE_PLAN_COUNT } from './debris.js';
import { buildStreamSpine, createSpineScratch } from './stream.js';
import { makeTdePhaseMapping, secondsToUiPhase, tdePhaseAt } from './timeline.js';
import {
  nascentDiskGainAt,
  nascentDiskGeometry,
  shockBoundsRadiusUnits,
  shockGainAt,
  shockRadiusUnits
} from './shock.js';
import { TIDAL_DISRUPTION_DESCRIPTOR } from './presets.js';

// ---------------------------------------------------------------------------
// Presentation constants (disclosed)
// ---------------------------------------------------------------------------

/**
 * Total optical depth aimed for along a sight line crossing the shock torus.
 * ~1.5 reads as a bright but see-through glowing region; >5 saturates into a
 * solid shape (see the density comment in the volume config).
 */
const SHOCK_TARGET_OPTICAL_DEPTH = 1.5;

/** Compile-time detail ceilings; live work budget may reduce these branches. */
const TIER_DETAIL_OCTAVES: Record<QualityTier, number> = {
  low: 1,
  medium: 2,
  high: 3,
  ultra: 4
};

/** Star photosphere tint proxy (linear RGB), presentation-level. */
const STAR_TINT_LINEAR = [1.0, 0.86, 0.72] as const;
/** Linear-HDR radiance multiplier for the photosphere (presentation). */
const STAR_RADIANCE = 4.5;
/**
 * Debris handoff fade half-window around periapsis (seconds): the star's
 * presented gain ramps 1 -> 0 across +/- this window when the encounter
 * fully disrupts. Purely presentational timing on top of the model clock.
 */
const HANDOFF_FADE_SECONDS = 0.35;
/**
 * Angular-size gate for accent systems (particles + volume), CA6-11: below
 * ACCENT_ANGULAR_GATE_START vertical subtense the accents are suppressed,
 * reaching full strength at ACCENT_ANGULAR_GATE_FULL. Chosen once,
 * centrally; exposed through the debug snapshot.
 */
const ACCENT_ANGULAR_GATE_START = 0.015;
const ACCENT_ANGULAR_GATE_FULL = 0.06;
/** BH marker ring gain (cinematic site marker, NOT a lensing render). */
const BH_MARKER_GAIN = 0.5;
/**
 * On-screen size floor for the site marker, as a fraction of the framing
 * distance. The ring is authored at the horizon/photon-sphere scale, which is
 * ~1e-3 of the frame once the view pulls back to follow the debris — i.e. the
 * black hole's position became invisible exactly when the viewer most needed
 * it. The marker is already a DISCLOSED cinematic affordance and never a
 * lensing render, so it is allowed to keep a minimum angular size; the debug
 * snapshot reports the physical radii separately so nothing is misread as the
 * horizon.
 */
const BH_MARKER_MIN_FRACTION_OF_DISTANCE = 0.035;
/**
 * DISCLOSED presentation crop for stream ribbons: only the family's near-BH
 * portion is rendered; the distant stream continues far beyond any presented
 * frame by construction.
 *
 * The cap is `max(STREAM_RADIAL_CAP x periapsis, STREAM_VIEW_CAP_FACTOR x the
 * current framing distance)`, i.e. it follows what is actually ON SCREEN. With
 * the old fixed 12 x periapsis cap the ribbons emptied completely a few hours
 * after disruption — every bound element is out near apoapsis until it returns
 * at the fallback time, so the destination drew NOTHING at all across the
 * debris and winding stages, which is most of its timeline.
 */
const STREAM_RADIAL_CAP = 12;
const STREAM_VIEW_CAP_FACTOR = 3;

/**
 * Auto-framing (DISCLOSED presentation behaviour) via the shared
 * {@link AutoFramer}: the scene's meaningful extent grows by orders of
 * magnitude across the timeline — from a star a few hundred scene units out to
 * debris arcs thousands out — so a fixed camera distance shows an empty frame
 * for most of the encounter. Only the orbit distance is driven, and the viewer
 * takes it back permanently on any manual change.
 */
/**
 * Distance = margin x extent. The pre-disruption stages have exactly one
 * subject — the star on its way in — and it is physically small next to its own
 * orbital radius, so those stages frame tighter; the post-disruption stages have
 * to hold a whole stream and use the looser margin.
 */
const AUTO_FRAME_MARGIN = 2.2;
const AUTO_FRAME_MARGIN_STAR_ONLY = 1.05;
const AUTO_FRAME_MIN_UNITS = 140;
/**
 * Framing ceiling. The debris family arcs out to ~1e5 scene units, but at that
 * zoom the orbits are so eccentric that the stream is just a straight streak
 * and the black hole is a single pixel — following it all the way out shows
 * LESS, not more. The frame therefore stops at the near-BH region where the
 * winding return, the self-intersection shock and the nascent disc actually
 * happen, and the excursion is allowed to leave the frame (the stage weights
 * keep that stretch short).
 */
const AUTO_FRAME_MAX_UNITS = 3500;
/**
 * Ribbon width is baked in world units, so it is scaled with the framing
 * distance to keep a roughly constant on-screen thickness (the widths in
 * `createRibbon` are authored for AUTO_FRAME_REFERENCE_UNITS).
 */
const AUTO_FRAME_REFERENCE_UNITS = 350;

/** Phases during which the stream ribbons carry the morphology. */
const STREAM_PHASES: ReadonlySet<string> = new Set(['disruption', 'debris', 'winding', 'shock']);

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createTidalDisruptionModule(): PhenomenonModule {
  let disposed = false;
  let scene: THREE.Scene | null = null;

  let resolved: ResolvedTdeEncounter | null = null;
  let stateValue: TidalDisruptionPublicState | null = null;
  let verdictValue: ReturnType<typeof disruptionVerdict> | null = null;
  /** Deterministic reference debris classification counts (prepare-time). */
  let referenceCounts = { boundCount: 0, unboundCount: 0 };
  let lastTier: QualityTier = 'medium';
  const debug: Record<string, unknown> = {};

  // Uniform bundles (created once in prepare, mutated per frame).
  const uStarAxis = uniform(new THREE.Vector3(1, 0, 0));
  const uStarStretch = uniform(1);
  const uStarTransverse = uniform(1);
  const uShockGain = uniform(0);
  const uShockRadius = uniform(1);
  /**
   * Accumulated ORBITAL phase (radians) of gas circularizing at the shock
   * radius, integrated from the local Keplerian rate. Drives the azimuthal
   * brightness pattern of the shock region and the nascent disc so both
   * visibly ROTATE instead of sitting as static shapes — the returning debris
   * is on orbits, and that is the motion the late stages are about.
   */
  const uOrbitPhase = uniform(0);

  // Scratch spine buffers (allocated once per ribbon capacity).
  let boundScratch: ReturnType<typeof createSpineScratch> | null = null;
  let unboundScratch: ReturnType<typeof createSpineScratch> | null = null;
  const spinePoints: THREE.Vector3[] = [];

  // Handles owned indirectly (dispose flows through the prepare scope).
  let star: THREE.Mesh | null = null;
  let starVisual: CinematicMaterialHandle | null = null;
  let starHalo: THREE.Mesh | null = null;
  let starHaloVisual: CinematicMaterialHandle | null = null;
  let backdrop: CinematicBackdropHandle | null = null;
  let bhMarker: THREE.Mesh | null = null;
  let diskMesh: THREE.Mesh | null = null;
  let diskVisual: CinematicMaterialHandle | null = null;
  let volumeHandle: VolumeHandle | null = null;
  let particleHandle: ParticleSystemHandle | null = null;
  let boundRibbon: RibbonHandle | null = null;
  let unboundRibbon: RibbonHandle | null = null;
  let boundStrand: StrandHandle | null = null;
  let unboundStrand: StrandHandle | null = null;

  function assertReady(): {
    resolved: ResolvedTdeEncounter;
    state: TidalDisruptionPublicState;
    verdict: ReturnType<typeof disruptionVerdict>;
  } {
    if (disposed || resolved === null || stateValue === null || verdictValue === null) {
      throw new Error('tidal-disruption: module accessed before prepare() or after dispose()');
    }
    return { resolved, state: stateValue, verdict: verdictValue };
  }

  /** Re-derive the resolved encounter after a canonical control merge. */
  function applyState(next: TidalDisruptionPublicState): void {
    stateValue = next;
    resolved = resolveTidalDisruptionEncounter(next);
    verdictValue = disruptionVerdict(resolved);
  }

  async function prepare(ctx: PrepareContext): Promise<PreparedPhenomenon> {
    if (disposed) throw new Error('tidal-disruption: prepare() called after dispose()');

    ctx.reportProgress(0.05, 'Validating encounter state');
    applyState(normalizeTidalDisruptionState(ctx.preset.state));
    const ready = assertReady();
    const res = ready.resolved;

    const abortGuard = (stage: string): void => {
      if (ctx.signal.aborted) throw new Error(`tidal-disruption: prepare aborted (${stage})`);
    };

    const destinationScene = new THREE.Scene();
    destinationScene.name = 'tidal-disruption';
    const detail = CINEMATIC_DETAIL_BY_TIER[ctx.quality];
    const cinematicBackdrop = createCinematicBackdrop({
      seed: ctx.preset.seed,
      intensity: 0.24,
      dustColor: [0.055, 0.018, 0.012],
      starColor: [1.0, 0.76, 0.58],
      segments: detail.backdropSegments,
      octaves: detail.backdropOctaves,
      starCells: { x: 220, y: 110 }
    });
    destinationScene.add(cinematicBackdrop.mesh);
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
    backdrop = cinematicBackdrop;

    // --- star (bounded emissive sphere deformed by the tidal model) --------
    ctx.reportProgress(0.15, 'Building disrupted star');
    const segments = TIER_STAR_SEGMENTS[ctx.quality];
    const starGeometry = new THREE.SphereGeometry(1, segments.width, segments.height);
    const starSurface = createCinematicSurfaceMaterial({
      tint: STAR_TINT_LINEAR,
      secondaryTint: [1.0, 0.35, 0.08],
      seed: ctx.preset.seed ^ 0x71d,
      radiance: STAR_RADIANCE,
      noiseScale: 4.6,
      noiseStrength: 0.16,
      rimStrength: 1.7,
      noiseOctaves: detail.surfaceOctaves
    });
    const starMaterial = starSurface.material;
    starMaterial.name = 'tde-star';
    // Ellipsoid deformation in LOCAL space: compress every vertex along the
    // transverse plane and stretch along the star->BH axis. The axis is a
    // WORLD-space unit vector and the mesh never rotates, so local ==
    // world orientation; mesh.scale applies rStarUnits afterwards.
    const pLocal = normalize(positionLocal);
    const along = dot(pLocal, uStarAxis);
    const deformed = pLocal
      .mul(uStarTransverse)
      .add(uStarAxis.mul(along.mul(uStarStretch.sub(uStarTransverse))));
    starMaterial.positionNode = deformed;
    starVisual = starSurface;
    star = new THREE.Mesh(starGeometry, starMaterial);
    star.name = 'tde-star';
    // DISCLOSED display exaggeration (see types.visualStarRadius): the
    // rendered disc, not the model radius.
    star.scale.setScalar(visualStarRadius(res));
    destinationScene.add(star);
    const starBytes =
      (segments.width + 1) * (segments.height + 1) * 32 + segments.width * segments.height * 6 * 4;
    ctx.scope.track('geometry', starGeometry, () => starGeometry.dispose(), starBytes);
    ctx.scope.track('material', starMaterial, () => starMaterial.dispose(), 4096);
    abortGuard('star');

    const starHaloGeometry = new THREE.SphereGeometry(
      1.18,
      detail.haloSegments.width,
      detail.haloSegments.height
    );
    const starHaloSurface = createCinematicHalo({
      tint: [1.0, 0.45, 0.18],
      seed: ctx.preset.seed ^ 0x72e,
      gain: 0,
      alpha: 0.22,
      noiseScale: 3.6,
      noiseOctaves: detail.surfaceOctaves
    });
    starHalo = new THREE.Mesh(starHaloGeometry, starHaloSurface.material);
    starHalo.name = 'tde-star-atmosphere';
    starHalo.visible = false;
    starHalo.renderOrder = 15;
    destinationScene.add(starHalo);
    starHaloVisual = starHaloSurface;
    ctx.scope.track('geometry', starHaloGeometry, () => starHaloGeometry.dispose(), 16 * 12 * 32);
    ctx.scope.track(
      'material',
      starHaloSurface.material,
      () => starHaloSurface.material.dispose(),
      4096
    );

    // --- black-hole marker (cinematic site marker; NOT a lensing render) ---
    ctx.reportProgress(0.25, 'Preparing black-hole marker');
    const markerGeometry = new THREE.RingGeometry(
      res.horizonUnits * 1.6,
      res.photonSphereUnits * 1.35,
      64,
      1
    );
    markerGeometry.rotateX(-Math.PI / 2); // lie flat in the orbital (XZ) plane
    const markerMaterial = new MeshBasicNodeMaterial();
    markerMaterial.name = 'tde-bh-marker';
    markerMaterial.colorNode = vec4(vec3(0.9, 0.75, 0.55).mul(BH_MARKER_GAIN * 2.2), 1);
    bhMarker = new THREE.Mesh(markerGeometry, markerMaterial);
    bhMarker.name = 'tde-bh-marker';
    destinationScene.add(bhMarker);
    ctx.scope.track('geometry', markerGeometry, () => markerGeometry.dispose(), 12288);
    ctx.scope.track('material', markerMaterial, () => markerMaterial.dispose(), 4096);
    abortGuard('marker');

    // --- shock emissivity volume (shared VolumeService, half-resolution) ---
    ctx.reportProgress(0.45, 'Preparing shock volume field');
    const boundsRadius = shockBoundsRadiusUnits(res);
    const volume = ctx.services.volumes.createVolume({
      bounds: { kind: 'sphere', center: [0, 0, 0], radius: boundsRadius },
      // Equatorial TORUS (disclosed presentation of the circularizing
      // stream): tube around the circle of radius uShockRadius in the
      // orbital plane. Edge-on sight-lines read the classic ring; polar
      // sight-lines pass through emptiness. WGSL CONTRACT: smoothstep edges
      // must be CONSTANT and RISING (low < high) — reversed edges are
      // undefined and light the entire bounds sphere (see CM volume note).
      density: ({ pos }) => {
        const p = vec3(pos as never);
        const radial = length(p.xz);
        const tubeDist = length(vec2(radial.sub(uShockRadius), p.y));
        const minor = uShockRadius.mul(0.18).max(0.5);
        const profile = smoothstep(minor.mul(0.45), minor.mul(1.6), tubeDist).oneMinus();
        // Orbiting clumpy structure. A uniform unit-density torus integrated to
        // saturation and read as a flat opaque pill; the returning stream is
        // neither smooth nor stationary, so the density carries azimuthal
        // clumping that ROTATES at the local Keplerian rate (uOrbitPhase).
        const azimuth = atan(p.z, p.x);
        const swirl = sin(azimuth.mul(float(3)).sub(uOrbitPhase))
          .mul(float(0.25))
          .add(float(0.75));
        const clumps = mx_fractal_noise_float(
          vec3(
            azimuth.mul(float(2.2)).sub(uOrbitPhase.mul(float(0.5))),
            p.y.div(minor),
            radial.div(uShockRadius)
          ),
          3,
          2.0,
          0.5
        )
          .mul(float(0.5))
          .add(float(0.5));
        const texture = clamp(
          swirl.mul(clumps.mul(float(1.4)).add(float(0.25))),
          float(0),
          float(1)
        );
        // OPTICAL DEPTH, not "opacity". VolumeService integrates
        // alpha = 1 - exp(-density * ABSORPTION_SCALE * dt) with dt in SCENE
        // UNITS, so a density near 1 saturates a single sample whenever the
        // volume is tens of units across — which is why this torus rendered as
        // a flat opaque pill. Normalising by the tube crossing length gives a
        // total optical depth of about SHOCK_TARGET_OPTICAL_DEPTH through the
        // tube regardless of the encounter's physical scale.
        const crossing = minor.mul(float(2)).max(float(1e-3));
        const kappa = float(SHOCK_TARGET_OPTICAL_DEPTH).div(crossing);
        return max(profile.mul(texture).mul(kappa), float(0));
      },
      emission: ({ pos }) => {
        // Shock heating rises toward the intersection radius; the inner edge is
        // hotter and whiter than the outer skirt.
        const p = vec3(pos as never);
        const radial = length(p.xz);
        const inner = clamp(
          float(1).sub(radial.div(uShockRadius.max(float(1e-3)))),
          float(0),
          float(1)
        );
        const color = mix(vec3(1.0, 0.62, 0.38), vec3(1.0, 0.88, 0.72), inner);
        return color.mul(uShockGain.mul(1.1));
      },
      baseMaxSteps: TIER_VOLUME_STEPS[ctx.quality],
      detail: {
        seed: res.seed ^ 0x77a,
        octaves: TIER_DETAIL_OCTAVES[ctx.quality],
        strength: 0.16,
        filamentStrength: 0.28,
        clumpStrength: 0.7,
        domainWarpStrength: 0.12,
        frequency: 1.7
      },
      depthAwareUpsample: true,
      approximateSelfShadow: true,
      gradientShading: true,
      halfResolution: true,
      earlyAlphaTermination: true,
      temporalJitter: true
    });
    volume.setStepScale(TIER_STEP_SCALE[ctx.quality]);
    volume.setVisible(false); // phase-gated: off until the shock stage
    volume.object3d().name = 'tde-shock-volume';
    destinationScene.add(volume.object3d());
    const volumeBytes = Math.round(2.5 * 1024 * 1024);
    ctx.scope.track('renderTarget', volume, () => volume.dispose(), volumeBytes);
    volumeHandle = volume;
    abortGuard('volume');

    // --- debris accent particles (shared ParticleService) -------------------
    ctx.reportProgress(0.65, 'Seeding debris accents');
    const capacity = TIER_PARTICLE_CAPACITY[ctx.quality];
    if (capacity > 0) {
      // Accent plan derived from the model: shell at the disruption site
      // moving along the outbound direction (-Z at periapsis). Accents only;
      // stream MORPHOLOGY is carried analytically by the ribbons above.
      const lifespanProxy = Math.max(barkerSeconds(res, Math.sqrt(5)), 60);
      const system = ctx.services.particles.createSystem({
        capacity,
        emitters: [
          {
            kind: 'sphere-shell',
            origin: [res.rpUnits, 0, 0],
            radius: visualStarRadius(res),
            speed: encounterSpeedAtPeriapsis(res),
            directionBias: [0, 0, -1]
          }
        ],
        lifetimeSeconds: [lifespanProxy * 0.4, lifespanProxy],
        sizePx: [1.5, 4],
        colorRamp: [
          { t: 0, color: [1.0, 0.9, 0.7], alpha: 0.9 },
          { t: 0.5, color: [0.95, 0.6, 0.35], alpha: 0.55 },
          { t: 1, color: [0.5, 0.3, 0.25], alpha: 0 }
        ],
        blending: 'additive',
        seed: res.seed,
        preferCompute: true,
        profile: 'debris-streak',
        emissiveIntensity: 1.15
      });
      system.setPopulationScale(0); // phase-gated
      system.object3d().name = 'tde-debris-particles';
      destinationScene.add(system.object3d());
      // ParticleService contract: one deterministic initialization update so
      // paused scrubs never present uninitialized buffers.
      system.update(1 / 60);
      ctx.scope.track('storageBuffer', system, () => system?.dispose(), capacity * 48);
      particleHandle = system;
    }
    abortGuard('particles');

    // --- debris stream ribbons (shared RibbonService; analytic spines) ------
    ctx.reportProgress(0.8, 'Preparing debris streams');
    const samples = TIER_STREAM_SAMPLES[ctx.quality];
    boundScratch = createSpineScratch(samples + 2);
    unboundScratch = createSpineScratch(samples + 2);
    boundRibbon = ctx.services.ribbons.createRibbon({
      segments: samples,
      // Authored for AUTO_FRAME_REFERENCE_UNITS and scaled per frame with the
      // framing distance (setWidthScale); the previous widths were a 1-2 px
      // thread as soon as the view pulled back at all.
      widthStart: Math.max(visualStarRadius(res) * 0.9, 2.5),
      widthEnd: Math.max(visualStarRadius(res) * 0.22, 0.7),
      colorStart: [1.0, 0.78, 0.52],
      colorEnd: [0.85, 0.42, 0.28],
      additive: true,
      taper: 'linear'
    });
    unboundRibbon = ctx.services.ribbons.createRibbon({
      segments: samples,
      widthStart: Math.max(visualStarRadius(res) * 0.7, 2.0),
      widthEnd: Math.max(visualStarRadius(res) * 0.14, 0.5),
      colorStart: [0.75, 0.82, 1.0],
      colorEnd: [0.35, 0.42, 0.7],
      additive: true,
      taper: 'exponential'
    });
    boundStrand = ctx.services.strands.createStrand({
      segments: samples,
      radialSegments: 12,
      widthStart: Math.max(visualStarRadius(res) * 1.15, 3.2),
      widthEnd: Math.max(visualStarRadius(res) * 0.28, 0.9),
      aspectStart: 0.72,
      aspectEnd: 0.42,
      opacityStart: 0.78,
      opacityEnd: 0.08,
      colorStart: [1.0, 0.82, 0.58],
      colorEnd: [0.78, 0.3, 0.18],
      temperatureVariation: 0.36,
      clumpStrength: 0.42,
      clumpSeed: res.seed ^ 0x891,
      additive: true
    });
    unboundStrand = ctx.services.strands.createStrand({
      segments: samples,
      radialSegments: 10,
      widthStart: Math.max(visualStarRadius(res) * 0.9, 2.6),
      widthEnd: Math.max(visualStarRadius(res) * 0.18, 0.65),
      aspectStart: 0.58,
      aspectEnd: 0.3,
      opacityStart: 0.62,
      opacityEnd: 0.04,
      colorStart: [0.76, 0.86, 1.0],
      colorEnd: [0.25, 0.38, 0.75],
      temperatureVariation: 0.28,
      clumpStrength: 0.3,
      clumpSeed: res.seed ^ 0x892,
      additive: true
    });
    boundRibbon.setVisible(false);
    unboundRibbon.setVisible(false);
    boundStrand.setVisible(false);
    unboundStrand.setVisible(false);
    destinationScene.add(
      boundRibbon.object3d(),
      unboundRibbon.object3d(),
      boundStrand.object3d(),
      unboundStrand.object3d()
    );
    ctx.scope.track('geometry', boundRibbon.object3d(), () => boundRibbon?.dispose(), 16384);
    ctx.scope.track('geometry', unboundRibbon.object3d(), () => unboundRibbon?.dispose(), 16384);
    ctx.scope.track(
      'geometry',
      boundStrand.object3d(),
      () => boundStrand?.dispose(),
      samples * 13 * 64
    );
    ctx.scope.track(
      'geometry',
      unboundStrand.object3d(),
      () => unboundStrand?.dispose(),
      samples * 11 * 64
    );
    abortGuard('streams');

    // --- nascent-disk annulus (procedural presentation, disclosed) ----------
    ctx.reportProgress(0.9, 'Preparing nascent-disk annulus');
    const diskGeo = nascentDiskGeometry(res);
    const diskGeometry = new THREE.RingGeometry(
      diskGeo.innerRadiusUnits,
      diskGeo.outerRadiusUnits,
      96,
      1
    );
    diskGeometry.rotateX(-Math.PI / 2);
    const diskSurface = createCinematicDiscMaterial({
      innerRadius: diskGeo.innerRadiusUnits,
      outerRadius: diskGeo.outerRadiusUnits,
      innerTint: [1.0, 0.9, 0.72],
      outerTint: [1.0, 0.38, 0.12],
      seed: ctx.preset.seed ^ 0x7a1,
      gain: 0,
      arms: 2,
      noiseOctaves: detail.surfaceOctaves
    });
    const diskMaterial = diskSurface.material;
    diskMaterial.name = 'tde-nascent-disk';
    diskVisual = diskSurface;
    diskMesh = new THREE.Mesh(diskGeometry, diskMaterial);
    diskMesh.name = 'tde-nascent-disk';
    diskMesh.visible = false;
    destinationScene.add(diskMesh);
    ctx.scope.track('geometry', diskGeometry, () => diskGeometry.dispose(), 96 * 2 * 32);
    ctx.scope.track('material', diskMaterial, () => diskMaterial.dispose(), 4096);

    // --- deterministic reference debris classification (CA6-07 diagnostics) --
    if (
      ready.verdict.outcome === 'full-disruption' ||
      ready.verdict.outcome === 'partial-stripping'
    ) {
      const plan = buildDebrisPlan(
        res,
        REFERENCE_PLAN_COUNT,
        encounterSpeedAtPeriapsis(res),
        0,
        -1, // star->BH axis at periapsis: (-1, 0, 0)
        0
      );
      referenceCounts = { boundCount: plan.boundCount, unboundCount: plan.unboundCount };
    } else {
      referenceCounts = { boundCount: 0, unboundCount: 0 };
    }

    lastTier = ctx.quality;
    scene = destinationScene;
    ctx.reportProgress(1, 'Tidal disruption ready');
    return { module: moduleObject, scope: ctx.scope, scene: destinationScene, preset: ctx.preset };
  }

  function enter(ctx: EnterContext): void {
    const ready = assertReady();
    ctx.services.time.registerPhaseMapping(
      'tidal-disruption-timeline',
      makeTdePhaseMapping(ready.resolved)
    );
    ctx.services.time.setPhaseMapping('tidal-disruption-timeline');
    const deepLinkPhase =
      ready.state.timeSeconds !== 0 ? secondsToUiPhase(ready.state.timeSeconds, ready.resolved) : 0;
    ctx.services.time.scrubTo(
      deepLinkPhase !== 0 ? deepLinkPhase : ctx.preset.timelineInitialPhase
    );
    // Arrive PLAYING unless something explicitly paused the clock (a viewer
    // who paused before navigating, or the golden harness). Arriving paused
    // unconditionally — the previous behaviour — meant the encounter never
    // advanced unless the viewer found the transport.
    ctx.services.time.resumeUnlessExplicitlyPaused();
    autoFramer.reset();
    uOrbitPhase.value = 0;
    // The rig's default ceiling is 500 scene units, which silently clamped
    // both the auto-framing and the viewer's own zoom while the debris arcs
    // reach thousands. Declare the range this destination actually spans.
    ctx.services.cameraRig.setDistanceLimits(20, AUTO_FRAME_MAX_UNITS * 6);
  }

  /**
   * Scene extent worth framing at the current instant, in scene units. Uses
   * whatever is actually being drawn in this stage rather than a single global
   * scale (which cannot describe a scene spanning three orders of magnitude).
   */
  function frameExtentUnits(
    res: ResolvedTdeEncounter,
    phase: TdePhase,
    starDistanceUnits: number,
    starVisible: boolean,
    streamExtent: number,
    shockVisible: boolean
  ): number {
    let extent = Math.max(res.rtUnits * 1.6, res.rpUnits * 2);
    if (starVisible) extent = Math.max(extent, starDistanceUnits * 1.05);
    // Follow the MODELLED stream extent, not the cropped one: the debris family
    // arcs out to ~1e5 scene units before the most-bound elements return at the
    // fallback time, and following it is what makes the excursion and the
    // winding return visible instead of an empty frame.
    if (streamExtent > 0) extent = Math.max(extent, streamExtent);
    if (shockVisible) extent = Math.max(extent, shockRadiusUnits(res) * 1.05);
    if (phase === 'nascent-disk') extent = Math.max(res.rtUnits * 3, res.rpUnits * 4);
    return extent;
  }

  /**
   * Population fraction per phase (CA6-11): expensive systems stay OFF
   * before they are scientifically meaningful.
   */
  function populationFractionFor(phase: TdePhase): number {
    switch (phase) {
      // The accent cloud is emitted from a FIXED sphere-shell at periapsis, so
      // it only tells the truth while the star is actually there being shredded.
      // Leaving it on afterwards (0.55/0.45/0.3 previously) parked a permanent
      // bright ball at periapsis long after the gas had left on its orbits —
      // which, with the ribbons cropped out of existence, was the ONLY thing on
      // screen for most of the timeline and made the scene look frozen. The
      // debris morphology after periapsis is carried by the stream ribbons, the
      // shock volume and the nascent disk, all of which are time-dependent.
      case 'disruption':
        return 0.55;
      default:
        return 0;
    }
  }

  /** Angular-size gate for accent systems (documented CA6-11 policy). */
  function accentGate(cameraDistanceUnits: number): number {
    const ready = assertReady();
    const extent = Math.max(shockRadiusUnits(ready.resolved), ready.resolved.rtUnits);
    const angle = 2 * Math.atan(extent / Math.max(cameraDistanceUnits, 1e-6));
    const raw =
      (angle - ACCENT_ANGULAR_GATE_START) / (ACCENT_ANGULAR_GATE_FULL - ACCENT_ANGULAR_GATE_START);
    return Math.min(1, Math.max(0, raw));
  }

  /** Rebuild both stream spines from the pure model (no history). */
  let spineCount = 0;
  let unboundCount = 0;
  /** Largest radius (scene units) actually drawn on either spine this frame. */
  let streamExtentUnits = 0;
  /** Largest MODELLED spine radius this frame, before the presentation crop. */
  let streamRawExtentUnits = 0;
  /**
   * Smallest MODELLED spine radius this frame. This is the number that says
   * whether ANY debris has returned to the black hole yet, which is what the
   * near-BH stages (shock, nascent disk) depend on.
   */
  let streamMinRadiusUnits = 0;
  let lastStreamTime = Number.NaN;
  let lastStreamViewDistance = Number.NaN;
  let lastStreamTier: QualityTier | null = null;
  let lastStrandQuality = 0;
  /** Auto-framing (see AUTO_FRAME_* constants and AutoFramer). */
  const autoFramer = new AutoFramer({
    margin: AUTO_FRAME_MARGIN,
    minUnits: AUTO_FRAME_MIN_UNITS,
    maxUnits: AUTO_FRAME_MAX_UNITS
  });
  function updateStreams(tSinceDisruption: number, viewDistanceUnits: number): void {
    const ready = assertReady();
    if (
      boundScratch === null ||
      unboundScratch === null ||
      boundRibbon === null ||
      unboundRibbon === null
    ) {
      return;
    }
    if (!(ready.resolved.energySpreadJPerKg > 0)) return;
    if (
      tSinceDisruption === lastStreamTime &&
      viewDistanceUnits === lastStreamViewDistance &&
      lastStreamTier === lastTier
    ) {
      return;
    }
    lastStreamTime = tSinceDisruption;
    lastStreamViewDistance = viewDistanceUnits;
    lastStreamTier = lastTier;

    const nBound = buildStreamSpine(
      ready.resolved,
      tSinceDisruption,
      TIER_STREAM_SAMPLES[lastTier],
      true,
      boundScratch
    );
    // DISCLOSED presentation crop: ribbons render the family's near-BH
    // portion (r <= STREAM_RADIAL_CAP x periapsis); the distant stream
    // continues far beyond any presented frame by construction.
    const rCap = Math.max(
      STREAM_RADIAL_CAP * ready.resolved.rpUnits,
      STREAM_VIEW_CAP_FACTOR * viewDistanceUnits
    );
    let extent = 0;
    let rawExtent = 0;
    let rawMin = Number.POSITIVE_INFINITY;
    let spineWriteIndex = 0;
    for (let i = nBound - 1; i >= 0; i -= 1) {
      const r = boundScratch.rs[i]!;
      if (r > rawExtent) rawExtent = r;
      if (r < rawMin) rawMin = r;
      if (r > rCap) continue;
      if (r > extent) extent = r;
      // Most-bound first so ribbon taper runs head -> tail along the arc.
      if (spinePoints[spineWriteIndex] === undefined) spinePoints.push(new THREE.Vector3());
      spinePoints[spineWriteIndex]!.set(boundScratch.xs[i]!, 0, boundScratch.zs[i]!);
      spineWriteIndex += 1;
    }
    spinePoints.length = spineWriteIndex;
    if (spinePoints.length >= 2) {
      boundRibbon.setSpine(spinePoints);
      boundStrand?.setSpine(spinePoints);
    }
    spineCount = spinePoints.length;

    const nUnbound = buildStreamSpine(
      ready.resolved,
      tSinceDisruption,
      TIER_STREAM_SAMPLES[lastTier],
      false,
      unboundScratch
    );
    spineWriteIndex = 0;
    for (let i = 0; i < nUnbound; i += 1) {
      const r = unboundScratch.rs[i]!;
      if (r > rawExtent) rawExtent = r;
      if (r < rawMin) rawMin = r;
      if (r > rCap) continue;
      if (r > extent) extent = r;
      if (spinePoints[spineWriteIndex] === undefined) spinePoints.push(new THREE.Vector3());
      spinePoints[spineWriteIndex]!.set(unboundScratch.xs[i]!, 0, unboundScratch.zs[i]!);
      spineWriteIndex += 1;
    }
    spinePoints.length = spineWriteIndex;
    if (spinePoints.length >= 2) {
      unboundRibbon.setSpine(spinePoints);
      unboundStrand?.setSpine(spinePoints);
    }
    unboundCount = spinePoints.length;
    streamExtentUnits = extent;
    streamRawExtentUnits = rawExtent;
    streamMinRadiusUnits = Number.isFinite(rawMin) ? rawMin : 0;
  }

  function update(ctx: FrameContext): void {
    const ready = assertReady();
    lastTier = ctx.quality;
    const snapshot = ctx.services.time.snapshot();
    const t = Number.isFinite(snapshot.physicalTime ?? NaN) ? (snapshot.physicalTime as number) : 0;
    const res = ready.resolved;
    backdrop?.setIntensity(ctx.experienceMode === 'cinematic' ? 0.52 : 0.24);
    lastStrandQuality = ctx.workBudget.strandQuality;
    const phase = tdePhaseAt(t, res);
    const disrupts = res.disrupts;
    const tau = Math.max(0, t);

    // --- encounter geometry ---------------------------------------------------
    const enc = encounterStateAt(res, t);
    const def = deformationAt(res, enc.x, enc.y, enc.z);
    if (star !== null) {
      star.position.set(enc.x, enc.y, enc.z);
      star.scale.setScalar(visualStarRadius(res));
    }
    uStarAxis.value.set(def.axisX, def.axisY, def.axisZ);
    uStarStretch.value = def.stretch;
    uStarTransverse.value = def.transverse;

    // --- star gain: full pre-disruption, handoff fade into debris -------------
    // Full disruption: fade out symmetrically across the periapsis window.
    // Partial/fly-by: the star survives the whole encounter (gain stays 1).
    let starGain: number;
    if (!disrupts) {
      starGain = 1;
    } else {
      const edge = Math.abs(t) / HANDOFF_FADE_SECONDS;
      starGain = edge >= 1 ? (t > 0 ? 0 : 1) : 1 - edge;
    }
    starVisual?.setGain(starGain);
    starVisual?.setTime(t * 0.0002);
    if (star !== null) star.visible = starGain > 0.001;
    if (starHalo !== null && starHaloVisual !== null) {
      starHalo.position.set(enc.x, enc.y, enc.z);
      starHalo.scale.setScalar(visualStarRadius(res) * 1.18);
      starHalo.visible = starGain > 0.001;
      starHaloVisual.setGain(starGain * 0.72);
      starHaloVisual.setTime(t * 0.00024);
    }

    // --- streams: active through the disruption->shock stages -----------------
    const orbit = ctx.services.cameraRig.getOrbit();
    // Ribbon thickness is authored for AUTO_FRAME_REFERENCE_UNITS and scaled
    // with the live framing distance so the stream keeps a usable on-screen
    // width as the view pulls back (it is a world-space mesh, not a sprite).
    const widthScale = Math.max(0.35, orbit.distance / AUTO_FRAME_REFERENCE_UNITS);
    boundRibbon?.setWidthScale(widthScale);
    unboundRibbon?.setWidthScale(widthScale);

    const streamVisible =
      disrupts &&
      res.energySpreadJPerKg > 0 &&
      STREAM_PHASES.has(phase) &&
      t > -HANDOFF_FADE_SECONDS;
    if (streamVisible) updateStreams(tau, orbit.distance);
    else {
      streamExtentUnits = 0;
      streamRawExtentUnits = 0;
      streamMinRadiusUnits = 0;
    }
    const strandActive = streamVisible && lastStrandQuality >= 0.5;
    boundRibbon?.setVisible(!strandActive && streamVisible && spineCount + unboundCount >= 2);
    unboundRibbon?.setVisible(!strandActive && streamVisible && unboundCount >= 2);
    boundStrand?.setVisible(strandActive && spineCount + unboundCount >= 2);
    unboundStrand?.setVisible(strandActive && unboundCount >= 2);

    // --- particles (phase x disruption x angular gate) -------------------------
    const gate = accentGate(orbit.distance);
    const popFraction = populationFractionFor(phase);
    if (particleHandle !== null) {
      const pop = popFraction * gate * (disrupts ? 1 : 0) * ctx.workBudget.particlePopulationScale;
      particleHandle.setPopulationScale(pop);
      if (pop > 0 && !snapshot.paused) {
        particleHandle.update(ctx.time.dt);
      }
    }

    // --- black-hole site marker: keep a minimum angular size ------------------
    if (bhMarker !== null) {
      const authored = Math.max(res.photonSphereUnits * 1.35, 1e-6);
      const floor = orbit.distance * BH_MARKER_MIN_FRACTION_OF_DISTANCE;
      const markerScale = Math.max(1, floor / authored);
      bhMarker.scale.setScalar(markerScale);
    }

    // --- orbital phase of the circularizing gas -------------------------------
    // Integrated from the LOCAL Keplerian rate at the shock radius:
    //   Omega = sqrt(mu / r^3),  r in metres, mu in SI.
    // Integrating (rather than evaluating a closed form in t) keeps the pattern
    // continuous across the log-compressed stages, where dt in physical seconds
    // jumps by orders of magnitude between frames. The visual rate is therefore
    // the physical rate; only the timeline coordinate is nonlinear.
    const shockRadiusMetres = shockRadiusUnits(res) * METRES_PER_SCENE_UNIT;
    const orbitOmega =
      shockRadiusMetres > 0
        ? Math.sqrt(res.muSiM3S2 / (shockRadiusMetres * shockRadiusMetres * shockRadiusMetres))
        : 0;
    // PURE FUNCTION of the timeline coordinate, deliberately not an integrator:
    // accumulating `omega * dt` made the pattern depend on the scrub HISTORY, so
    // two visits to the same coordinate rendered differently (it broke the
    // deterministic-replay contract and the TDE_SHOCK golden was unreproducible
    // between runs). Using the CURRENT rate times elapsed time since disruption
    // is a disclosed presentation choice: the instantaneous angular rate is the
    // physical one, the accumulated angle is not path-integrated.
    const twoPi = Math.PI * 2;
    const orbitPhaseRaw = Number.isFinite(orbitOmega) ? orbitOmega * tau : 0;
    uOrbitPhase.value = Number.isFinite(orbitPhaseRaw)
      ? ((orbitPhaseRaw % twoPi) + twoPi) % twoPi
      : 0;

    // --- shock volume (phase-gated; gain separated from geometric state) -------
    const volumeVisible = disrupts && phase === 'shock';
    const shockGain = shockGainAt(res, tau, disrupts);
    volumeHandle?.setVisible(volumeVisible);
    volumeHandle?.setStepScale(ctx.workBudget.volumeActiveSteps);
    uShockGain.value = volumeVisible ? shockGain : 0;
    uShockRadius.value = shockRadiusUnits(res);

    // --- nascent disk (late-phase procedural transition) ------------------------
    const diskGain = nascentDiskGainAt(res, tau, disrupts);
    diskVisual?.setGain(diskGain);
    diskVisual?.setTime(uOrbitPhase.value);
    if (diskMesh !== null) {
      diskMesh.visible = diskGain > 0.001;
    }

    backdrop?.setTime(t * 0.00002);
    backdrop?.setDetail(ctx.experienceMode === 'cinematic' ? ctx.workBudget.environmentDetail : 0);

    // --- auto-framing (disclosed presentation behaviour) -----------------------
    const starOnly =
      starGain > 0.001 && streamRawExtentUnits <= 0 && !volumeVisible && diskGain <= 0.001;
    autoFramer.update(
      ctx.services.cameraRig,
      frameExtentUnits(
        res,
        phase,
        enc.radiusUnits,
        starGain > 0.001,
        streamRawExtentUnits,
        volumeVisible
      ),
      ctx.time.dt,
      starOnly ? AUTO_FRAME_MARGIN_STAR_ONLY : AUTO_FRAME_MARGIN,
      snapshot.paused === true
    );

    // --- diagnostics snapshot ----------------------------------------------------
    const fractions = classificationFractions(referenceCounts.boundCount, REFERENCE_PLAN_COUNT);
    debug['phase'] = phase;
    debug['spineBoundPoints'] = spineCount;
    debug['spineUnboundPoints'] = unboundCount;
    debug['timeSeconds'] = t;
    debug['beta'] = res.beta;
    debug['rtUnits'] = res.rtUnits;
    debug['rpUnits'] = res.rpUnits;
    debug['horizonUnits'] = res.horizonUnits;
    debug['outcome'] = ready.verdict.outcome;
    debug['disrupts'] = disrupts;
    debug['fallbackDays'] = Number((res.fallbackSeconds / 86400).toFixed(3));
    debug['starGain'] = starGain;
    debug['starStretch'] = def.stretch;
    debug['starDistanceUnits'] = enc.radiusUnits;
    debug['streamBoundVisible'] = streamVisible;
    debug['volumeVisible'] = volumeVisible;
    debug['shockGain'] = uShockGain.value;
    debug['volumeRadiusUnits'] = shockRadiusUnits(res);
    debug['populationScale'] = particleHandle !== null ? popFraction : 0;
    debug['accentAngularGate'] = Number(gate.toFixed(3));
    debug['streamExtentUnits'] = Number(streamExtentUnits.toFixed(2));
    debug['streamRawExtentUnits'] = Number(streamRawExtentUnits.toFixed(2));
    debug['streamMinRadiusUnits'] = Number(streamMinRadiusUnits.toFixed(2));
    debug['autoFrameEnabled'] = autoFramer.enabled;
    debug['autoFrameDistanceUnits'] =
      autoFramer.requestedDistance === null
        ? null
        : Number(autoFramer.requestedDistance.toFixed(2));
    debug['ribbonWidthScale'] = Number(widthScale.toFixed(3));
    debug['strandRepresentation'] = strandActive ? 'tube' : 'ribbon-fallback';
    debug['strandQuality'] = lastStrandQuality;
    debug['bhMarkerScale'] = bhMarker !== null ? Number(bhMarker.scale.x.toFixed(3)) : null;
    debug['photonSphereUnits'] = res.photonSphereUnits;
    debug['orbitPhaseRad'] = Number(uOrbitPhase.value.toFixed(4));
    debug['orbitOmegaRadPerSecond'] = orbitOmega;
    debug['diskVisible'] = diskMesh !== null ? diskMesh.visible : false;
    debug['diskGain'] = diskGain;
    debug['boundFraction'] = fractions.boundFraction;
    debug['unboundFraction'] = fractions.unboundFraction;
    debug['tier'] = lastTier;
    debug['observerInclinationDeg'] = res.observerInclinationDeg;
    debug['verdictReason'] = ready.verdict.reason;
    debug['volumeWork'] = volumeHandle?.getDebugSnapshot?.() ?? null;
    debug['particleWork'] = particleHandle?.getDebugSnapshot() ?? null;
    debug['strandWork'] = {
      bound: boundStrand?.getDebugSnapshot?.() ?? null,
      unbound: unboundStrand?.getDebugSnapshot?.() ?? null
    };
  }

  function render(ctx: RenderContext): void {
    if (ctx.scene !== null && ctx.camera !== null) {
      backdrop?.syncToCamera(ctx.camera);
      ctx.renderer.render(ctx.scene, ctx.camera);
    }
  }

  function exit(_ctx: ExitContext): void {
    scene?.clear();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scene?.clear();
    scene = null;
    star = null;
    starVisual = null;
    starHalo = null;
    starHaloVisual = null;
    backdrop = null;
    bhMarker = null;
    diskMesh = null;
    diskVisual = null;
    volumeHandle = null;
    particleHandle = null;
    boundRibbon = null;
    unboundRibbon = null;
    boundStrand = null;
    unboundStrand = null;
    boundScratch = null;
    unboundScratch = null;
    lastStreamTime = Number.NaN;
    lastStreamViewDistance = Number.NaN;
    lastStreamTier = null;
    resolved = null;
    stateValue = null;
    verdictValue = null;
  }

  function serializeShareState(): Record<string, unknown> {
    if (stateValue === null) return {};
    return { ...stateValue };
  }

  /** Canonical live control channel; normalizes through the ONE normalizer. */
  function applyControlState(partial: Record<string, unknown>): void {
    if (disposed || stateValue === null) return;
    applyState(normalizeTidalDisruptionState({ ...stateValue, ...partial }));
  }

  function getDebugSnapshot(): Record<string, unknown> {
    return {
      ...debug,
      disposed,
      fidelity: TIDAL_DISRUPTION_DESCRIPTOR.fidelity,
      disclosure:
        'PROCEDURAL_SCIENTIFIC: closed-form parabolic Kepler encounter (DIRECT reduced) + ' +
        'disclosed reduced deformation/disruption/debris/stream/shock models. Not SPH, ' +
        'not GRMHD, not numerical relativity; no GR apsidal precession.'
    };
  }

  const moduleObject: PhenomenonModule = {
    descriptor: TIDAL_DISRUPTION_DESCRIPTOR,
    prepare,
    enter,
    update,
    render,
    exit,
    dispose,
    serializeShareState,
    applyControlState,
    getDebugSnapshot
  };
  return moduleObject;
}

// ---------------------------------------------------------------------------
// Local numeric helpers (pure)
// ---------------------------------------------------------------------------

/** Periapsis speed sqrt(2 mu / q), scene units/s. */
function encounterSpeedAtPeriapsis(res: ResolvedTdeEncounter): number {
  const muUnits = res.muSiM3S2 / Math.pow(METRES_PER_SCENE_UNIT, 3);
  return Math.sqrt((2 * muUnits) / res.rpUnits);
}

// Reserved for upcoming phases of this campaign (kept referenced to stay lint-clean).
void inverseBarker;
