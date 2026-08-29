/**
 * Compact Merger destination module (CA5 rendering integration).
 *
 * Composes the shared Atlas services around the CPU-validated physics core
 * in this package (types/timeline/inspiral/ejecta/emission/jet/remnant).
 * Spec sources:
 *
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 4 (minimum viable
 *   visualization; performance: expensive stages dormant outside their
 *   active phase);
 * - docs/cosmic-atlas/RENDERING_SERVICES.md sections 3/4/9 (ParticleService,
 *   VolumeService, SharedPost responsibilities);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 7 (invariants);
 * - mission sections 10-16 (inspiral invariants, contact transition, ejecta,
 *   jet viewing response, kilonova evolution, remnant scenarios, phase-aware
 *   resources, single global governor).
 *
 * FIDELITY CLASS: PROCEDURAL_SCIENTIFIC (inspiral trajectory DIRECT reduced
 * model). Every number shown here derives from the disclosed reduced models
 * in ./inspiral|ejecta|emission|jet|remnant; nothing in this module invents
 * physics. PRESENTATION choices (flash bloom, presentation-compressed
 * ejecta expansion, jet-front cap) are disclosed at their definition sites.
 *
 * CONTACT TRANSITION (mission section 12): NOT an instantaneous hide/show —
 * the stars converge to the contact separation, their gains cross-fade into
 * a disclosed merger-flash envelope, and the remnant/ejecta state initializes
 * from the model at contact. The flash is presentation; the state switch is
 * the model's.
 *
 * PHASE-AWARE RESOURCES (mission section 16, CA5-13): the ejecta volume and
 * particle population are INVISIBLE/dormant before contact; jet geometry is
 * active only while the scenario and phase require it; inspiral surfaces and
 * trails are removed once the kilonova dominates. One volume, one particle
 * system, two trail ribbons, bounded geometry for the whole lifecycle.
 *
 * Determinism: no wall-clock reads. The simulation clock IS the shared
 * TimeController internal coordinate; scrub/reset reproduces identical
 * state (validated by tests/unit/compactMergerPhysics.test.ts).
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  float,
  length,
  max,
  mix,
  normalize,
  smoothstep,
  uniform,
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
  RibbonHandle
} from '../../atlas/types.js';
import {
  normalizeCompactMergerState,
  resolveCompactMergerScenario,
  TIER_PARTICLE_CAPACITY,
  TIER_STAR_SEGMENTS,
  TIER_STEP_SCALE,
  TIER_VOLUME_STEPS,
  type CompactMergerPublicState,
  type MergerPhase,
  type ResolvedMergerScenario
} from './types.js';
import { inspiralStateAt } from './inspiral.js';
import { buildEjectaParticlePlan, ejectaAgeSeconds, ejectaRadiusUnits } from './ejecta.js';
import { kelvinToLinearRgb, kilonovaSampleAt } from './emission.js';
import { jetFrontRadiusUnits, jetViewingResponse, JET_FRONT_EJECTA_CAP } from './jet.js';
import { remnantSampleAt, remnantVisibleAt } from './remnant.js';
import { makeMergerPhaseMapping, phaseAt, secondsToUiPhase } from './timeline.js';
import { COMPACT_MERGER_DESCRIPTOR } from './presets.js';
import {
  CINEMATIC_DETAIL_BY_TIER,
  createCinematicBackdrop,
  createCinematicHalo,
  createCinematicSurfaceMaterial,
  type CinematicBackdropHandle,
  type CinematicMaterialHandle
} from '../../renderer/shared/CinematicPrimitives.js';

// ---------------------------------------------------------------------------
// Presentation constants (disclosed)
// ---------------------------------------------------------------------------

/** Contact/merger flash envelope duration after contact, seconds. */
const FLASH_DURATION_S = 0.02;
/** Flash peak emissive gain (presentation; bloom carries it further). */
const FLASH_PEAK_GAIN = 6;
/** Star surface tint (hot NS photosphere proxy), linear RGB. */
const STAR_TINT = kelvinToLinearRgb(6e5);
/** Trail ribbon length (samples of closed-form model history). */
const TRAIL_SAMPLES = 96;
/** Trail arc span behind the current phase, fraction of the last orbit. */
const TRAIL_ORBITS = 1.25;
/** Ejecta volume bounds safety margin over the capped shell radius. */
const BOUNDS_MARGIN = 1.15;

/** Compile-time detail ceilings; live work budget may reduce these branches. */
const TIER_DETAIL_OCTAVES: Record<QualityTier, number> = {
  low: 1,
  medium: 2,
  high: 3,
  ultra: 4
};

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createCompactMergerModule(): PhenomenonModule {
  let disposed = false;
  let scene: THREE.Scene | null = null;

  let resolved: ResolvedMergerScenario | null = null;
  let stateValue: CompactMergerPublicState | null = null;
  let lastTier: QualityTier = 'medium';
  let lastPhase: MergerPhase = 'inspiral';
  const debug: Record<string, unknown> = {};

  // Uniform bundles (created once in prepare, mutated per frame).
  const uGlowGain = uniform(0);
  const uVolumeTint = uniform(new THREE.Vector3(1, 0.5, 0.3));
  const uVolumeGain = uniform(0);
  const uVolumeRadius = uniform(1);
  const uVolumeWidth = uniform(0.4);
  const uVolumePolar = uniform(0.5);
  const uJetGain = uniform(0);
  const uJetFront = uniform(0);
  const uJetRadius = uniform(0.4);

  // Handles owned indirectly (dispose flows through the prepare scope).
  let star1: THREE.Mesh | null = null;
  let star2: THREE.Mesh | null = null;
  let flash: THREE.Mesh | null = null;
  let remnant: THREE.Mesh | null = null;
  let starVisual1: CinematicMaterialHandle | null = null;
  let starVisual2: CinematicMaterialHandle | null = null;
  let flashVisual: CinematicMaterialHandle | null = null;
  let remnantVisual: CinematicMaterialHandle | null = null;
  let remnantHaloVisual: CinematicMaterialHandle | null = null;
  let remnantHalo: THREE.Mesh | null = null;
  let backdrop: CinematicBackdropHandle | null = null;
  let jetGroup: THREE.Group | null = null;
  let volumeHandle: VolumeHandle | null = null;
  let particleHandle: ParticleSystemHandle | null = null;
  let trail1: RibbonHandle | null = null;
  let trail2: RibbonHandle | null = null;
  const trailPoints1: THREE.Vector3[] = [];
  const trailPoints2: THREE.Vector3[] = [];
  let lastTrailTime = Number.NaN;
  let lastTrailCount = 0;

  function assertReady(): { resolved: ResolvedMergerScenario; state: CompactMergerPublicState } {
    if (disposed || resolved === null || stateValue === null) {
      throw new Error('compact-merger: module accessed before prepare() or after dispose()');
    }
    return { resolved, state: stateValue };
  }

  /** Re-derive the resolved scenario after a canonical control merge. */
  function applyState(next: CompactMergerPublicState): void {
    stateValue = next;
    resolved = resolveCompactMergerScenario(next);
  }

  async function prepare(ctx: PrepareContext): Promise<PreparedPhenomenon> {
    if (disposed) throw new Error('compact-merger: prepare() called after dispose()');

    ctx.reportProgress(0.05, 'Validating merger state');
    applyState(normalizeCompactMergerState(ctx.preset.state));
    const ready = assertReady();
    const res = ready.resolved;

    const abortGuard = (stage: string): void => {
      if (ctx.signal.aborted) throw new Error(`compact-merger: prepare aborted (${stage})`);
    };

    const destinationScene = new THREE.Scene();
    destinationScene.name = 'compact-merger';
    const detail = CINEMATIC_DETAIL_BY_TIER[ctx.quality];
    const cinematicBackdrop = createCinematicBackdrop({
      seed: ctx.preset.seed,
      intensity: 0.32,
      dustColor: [0.012, 0.028, 0.085],
      starColor: [0.68, 0.82, 1.0],
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

    // --- compact stars (destination-local bounded presentation) -------------
    // Reuse decision (mission section 11): the neutron-star destination owns
    // a full strong-field surface ray tracer; importing it here would couple
    // CA3 physics to CA5 presentation. The binary components are presented
    // as bounded emissive spheres — the inspiral MODEL carries the physics.
    ctx.reportProgress(0.15, 'Building compact stars');
    const segments = TIER_STAR_SEGMENTS[ctx.quality];
    const starGeometry = new THREE.SphereGeometry(1, segments.width, segments.height);
    const surface1 = createCinematicSurfaceMaterial({
      tint: STAR_TINT,
      secondaryTint: [0.55, 0.72, 1.0],
      seed: ctx.preset.seed ^ 0x101,
      radiance: STAR_RADIANCE,
      noiseScale: 5,
      noiseStrength: 0.12,
      rimStrength: 1.8,
      noiseOctaves: detail.surfaceOctaves
    });
    const starMaterial1 = surface1.material;
    starMaterial1.name = 'compact-merger-star1';
    const surface2 = createCinematicSurfaceMaterial({
      tint: [0.7, 0.82, 1.0],
      secondaryTint: [0.5, 0.6, 1.0],
      seed: ctx.preset.seed ^ 0x202,
      radiance: STAR_RADIANCE,
      noiseScale: 4.3,
      noiseStrength: 0.12,
      rimStrength: 1.8,
      noiseOctaves: detail.surfaceOctaves
    });
    const starMaterial2 = surface2.material;
    starMaterial2.name = 'compact-merger-star2';
    starVisual1 = surface1;
    starVisual2 = surface2;
    star1 = new THREE.Mesh(starGeometry, starMaterial1);
    star1.name = 'compact-merger-star1';
    star2 = new THREE.Mesh(starGeometry, starMaterial2);
    star2.name = 'compact-merger-star2';
    destinationScene.add(star1, star2);
    const starBytes =
      (segments.width + 1) * (segments.height + 1) * 32 + segments.width * segments.height * 6 * 4;
    ctx.scope.track('geometry', starGeometry, () => starGeometry.dispose(), starBytes);
    ctx.scope.track('material', starMaterial1, () => starMaterial1.dispose(), 4096);
    ctx.scope.track('material', starMaterial2, () => starMaterial2.dispose(), 4096);
    abortGuard('stars');

    // --- merger flash (presentation envelope; bloom carries the peak) -------
    ctx.reportProgress(0.3, 'Preparing merger flash');
    const flashGeometry = new THREE.SphereGeometry(1, 24, 18);
    const flashSurface = createCinematicSurfaceMaterial({
      tint: [1.0, 0.65, 0.35],
      secondaryTint: [1.0, 0.2, 0.05],
      seed: ctx.preset.seed ^ 0x303,
      radiance: 2.4,
      noiseScale: 4,
      noiseStrength: 0.2,
      rimStrength: 2.4,
      noiseOctaves: detail.surfaceOctaves
    });
    const flashMaterial = flashSurface.material;
    flashMaterial.name = 'compact-merger-flash';
    flashVisual = flashSurface;
    flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.name = 'compact-merger-flash';
    flash.visible = false;
    destinationScene.add(flash);
    ctx.scope.track('geometry', flashGeometry, () => flashGeometry.dispose(), 8192);
    ctx.scope.track('material', flashMaterial, () => flashMaterial.dispose(), 4096);
    abortGuard('flash');

    // --- remnant -------------------------------------------------------------
    ctx.reportProgress(0.4, 'Preparing remnant presentation');
    const remnantGeometry = new THREE.SphereGeometry(1, 32, 24);
    const remnantSurface = createCinematicSurfaceMaterial({
      tint: [1.0, 0.58, 0.34],
      secondaryTint: [0.95, 0.18, 0.05],
      seed: ctx.preset.seed ^ 0x404,
      radiance: REMNANT_RADIANCE,
      noiseScale: 5.5,
      noiseStrength: 0.16,
      rimStrength: 2.2,
      noiseOctaves: detail.surfaceOctaves
    });
    const remnantMaterial = remnantSurface.material;
    remnantMaterial.name = 'compact-merger-remnant';
    remnantVisual = remnantSurface;
    remnant = new THREE.Mesh(remnantGeometry, remnantMaterial);
    remnant.name = 'compact-merger-remnant';
    remnant.visible = false;
    destinationScene.add(remnant);
    ctx.scope.track('geometry', remnantGeometry, () => remnantGeometry.dispose(), 12288);
    ctx.scope.track('material', remnantMaterial, () => remnantMaterial.dispose(), 4096);

    const remnantHaloGeometry = new THREE.SphereGeometry(
      1.35,
      detail.haloSegments.width,
      detail.haloSegments.height
    );
    const remnantHaloSurface = createCinematicHalo({
      tint: [1.0, 0.35, 0.08],
      seed: ctx.preset.seed ^ 0x505,
      gain: 0,
      alpha: 0.28,
      noiseScale: 3.8,
      noiseOctaves: detail.surfaceOctaves
    });
    remnantHalo = new THREE.Mesh(remnantHaloGeometry, remnantHaloSurface.material);
    remnantHalo.name = 'compact-merger-remnant-atmosphere';
    remnantHalo.visible = false;
    remnantHalo.renderOrder = 15;
    remnant.add(remnantHalo);
    remnantHaloVisual = remnantHaloSurface;
    ctx.scope.track(
      'geometry',
      remnantHaloGeometry,
      () => remnantHaloGeometry.dispose(),
      detail.haloSegments.width * detail.haloSegments.height * 32
    );
    ctx.scope.track(
      'material',
      remnantHaloSurface.material,
      () => remnantHaloSurface.material.dispose(),
      4096
    );

    // Faint accretion glow (prompt/delayed BH presentation): thin emissive
    // shell slightly above the remnant radius, gain-driven.
    const glowGeometry = new THREE.SphereGeometry(1.35, 32, 24);
    const glowMaterial = new MeshBasicNodeMaterial();
    glowMaterial.name = 'compact-merger-glow';
    glowMaterial.colorNode = vec4(vec3(1.2, 0.8, 0.5).mul(uGlowGain), 1);
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.name = 'compact-merger-glow';
    glow.visible = false;
    remnant.add(glow);
    ctx.scope.track('geometry', glowGeometry, () => glowGeometry.dispose(), 12288);
    ctx.scope.track('material', glowMaterial, () => glowMaterial.dispose(), 4096);
    abortGuard('remnant');

    // --- jet (bounded emissive geometry; mission section 14 allows this) ----
    // RibbonService was evaluated and NOT used: its handle exposes no
    // per-frame gain control, and the viewing-response modulation needs one
    // every frame. Two tapered emissive cones (bipolar, +Y/-Y) keep the
    // representation bounded and deterministic.
    // READABILITY (CA6-campaign stretch B, presentation-only): the lobes use
    // ADDITIVE blending and a cooler, brighter tint so they read against the
    // warm merger-core/kilonova glow; lobes are slightly narrower. No model
    // semantic changes (front cap, viewing response, gains untouched).
    ctx.reportProgress(0.5, 'Preparing jet presentation');
    const jetGeometry = new THREE.CylinderGeometry(0.12, 1, 1, 20, 1, true);
    jetGeometry.translate(0, 0.5, 0); // base at origin, extends +Y
    const jetMaterialTop = new MeshBasicNodeMaterial();
    jetMaterialTop.name = 'compact-merger-jet-top';
    jetMaterialTop.colorNode = vec4(vec3(2.4, 2.8, 4.0).mul(uJetGain), 1);
    jetMaterialTop.side = THREE.DoubleSide;
    jetMaterialTop.transparent = true;
    jetMaterialTop.opacity = 0.9;
    jetMaterialTop.blending = THREE.AdditiveBlending;
    jetMaterialTop.depthWrite = false;
    const jetMaterialBottom = jetMaterialTop.clone();
    jetMaterialBottom.name = 'compact-merger-jet-bottom';
    const jetTop = new THREE.Mesh(jetGeometry, jetMaterialTop);
    const jetBottom = new THREE.Mesh(jetGeometry, jetMaterialBottom);
    jetBottom.scale.y = -1; // mirror lobe
    jetTop.name = 'compact-merger-jet-top';
    jetBottom.name = 'compact-merger-jet-bottom';
    jetGroup = new THREE.Group();
    jetGroup.name = 'compact-merger-jet';
    jetGroup.add(jetTop, jetBottom);
    jetGroup.visible = false;
    // Render AFTER the volume proxy (renderOrder 10): the bipolar lobes live
    // inside the ejecta shell and would otherwise be occluded by its
    // normal-blended composite.
    jetGroup.renderOrder = 20;
    destinationScene.add(jetGroup);
    ctx.scope.track('geometry', jetGeometry, () => jetGeometry.dispose(), 16384);
    ctx.scope.track('material', jetMaterialTop, () => jetMaterialTop.dispose(), 4096);
    ctx.scope.track('material', jetMaterialBottom, () => jetMaterialBottom.dispose(), 4096);
    abortGuard('jet');

    // --- kilonova/ejecta volume (shared VolumeService, half-resolution) -----
    ctx.reportProgress(0.6, 'Preparing ejecta volume field');
    const maxShell = ejectaRadiusUnits(Number.POSITIVE_INFINITY);
    const boundsRadius = maxShell * BOUNDS_MARGIN;
    const volume = ctx.services.volumes.createVolume({
      bounds: { kind: 'sphere', center: [0, 0, 0], radius: boundsRadius },
      // TSL density: shell(r; R, width) x angular two-component weight — the
      // shader twin of ejectaDirectionWeight/ejectaAnisotropyFactor (pure
      // function of the SAMPLE DIRECTION; observer-independent by contract).
      // All smoothsteps use STRICTLY RISING edges: reversed-argument
      // smoothstep is undefined in WGSL and lit the entire bounds sphere.
      density: ({ pos }) => {
        const p = vec3(pos as never);
        const r = length(p);
        const dirN = normalize(p.max(vec3(1e-9)));
        const polar = abs(dirN.y);
        const equatorial = float(1).sub(polar);
        // Scenario weight folded through uVolumePolar (preset-driven).
        const weight = mix(equatorial, polar, uVolumePolar);
        const w = uVolumeWidth.max(0.05);
        const R = uVolumeRadius.max(0.1);
        const rise = smoothstep(R.sub(w.mul(2.0)), R.sub(w.mul(0.2)), r);
        const fall = smoothstep(R.add(w.mul(0.2)), R.add(w.mul(2.2)), r).oneMinus();
        const outer = smoothstep(R.mul(1.05), R.mul(1.3), r).oneMinus();
        return max(
          rise
            .mul(fall)
            .mul(outer)
            .mul(float(0.35).add(weight.mul(0.65))),
          float(0)
        );
      },
      emission: () => vec3(uVolumeTint).mul(uVolumeGain),
      baseMaxSteps: TIER_VOLUME_STEPS[ctx.quality],
      detail: {
        seed: res.seed ^ 0x3a7,
        octaves: TIER_DETAIL_OCTAVES[ctx.quality],
        strength: 0.14,
        filamentStrength: 0.08,
        clumpStrength: 0.34,
        domainWarpStrength: 0.16,
        frequency: 1.35
      },
      depthAwareUpsample: true,
      approximateSelfShadow: true,
      gradientShading: true,
      halfResolution: true,
      earlyAlphaTermination: true,
      temporalJitter: true
    });
    volume.setStepScale(TIER_STEP_SCALE[ctx.quality]);
    volume.setVisible(false); // phase-gated: off until contact
    volume.object3d().name = 'compact-merger-ejecta-volume';
    destinationScene.add(volume.object3d());
    const volumeBytes = Math.round(2.5 * 1024 * 1024);
    ctx.scope.track('renderTarget', volume, () => volume.dispose(), volumeBytes);
    volumeHandle = volume;
    abortGuard('volume');

    // --- GPU ejecta particles (shared ParticleService) ------------------------
    ctx.reportProgress(0.75, 'Seeding ejecta particles');
    const plan = buildEjectaParticlePlan(res, TIER_PARTICLE_CAPACITY[ctx.quality]);
    if (plan.capacity > 0) {
      const system = ctx.services.particles.createSystem({
        capacity: plan.capacity,
        emitters: [
          {
            kind: 'sphere-shell',
            origin: [0, 0, 0],
            radius: plan.shellRadiusUnits,
            speed: plan.speedUnitsS,
            directionBias: [0, plan.polarBias * 2 - 1, 0]
          }
        ],
        lifetimeSeconds: [plan.lifetimeSeconds[0], plan.lifetimeSeconds[1]],
        sizePx: [plan.sizePx[0], plan.sizePx[1]],
        colorRamp: plan.colorRamp.map((stop) => ({
          t: stop.t,
          color: [...stop.color] as [number, number, number],
          alpha: stop.alpha
        })),
        blending: 'additive',
        seed: plan.seed,
        preferCompute: true,
        profile: 'ejecta-streak',
        emissiveIntensity: 1.2
      });
      system.setPopulationScale(0); // phase-gated
      system.object3d().name = 'compact-merger-ejecta-particles';
      destinationScene.add(system.object3d());
      // ParticleService contract: update() must run once before the first
      // render so the shared GPU buffers are created — scrubbing to a paused
      // post-merger phase would otherwise present uninitialized buffers.
      // The fixed dt keeps that initialization deterministic.
      system.update(1 / 60);
      ctx.scope.track('storageBuffer', system, () => system?.dispose(), plan.capacity * 48);
      particleHandle = system;
    }
    abortGuard('particles');

    // --- orbit trail ribbons (shared RibbonService; closed-form model) -------
    ctx.reportProgress(0.85, 'Preparing inspiral trails');
    trail1 = ctx.services.ribbons.createRibbon({
      segments: TRAIL_SAMPLES,
      widthStart: 0.05,
      widthEnd: 0.01,
      colorStart: [0.7, 0.75, 1.0],
      colorEnd: [0.2, 0.25, 0.5],
      additive: true,
      taper: 'linear'
    });
    trail2 = ctx.services.ribbons.createRibbon({
      segments: TRAIL_SAMPLES,
      widthStart: 0.05,
      widthEnd: 0.01,
      colorStart: [1.0, 0.75, 0.6],
      colorEnd: [0.5, 0.25, 0.2],
      additive: true,
      taper: 'linear'
    });
    trail1.setVisible(true);
    trail2.setVisible(true);
    destinationScene.add(trail1.object3d(), trail2.object3d());
    ctx.scope.track('geometry', trail1.object3d(), () => trail1?.dispose(), 8192);
    ctx.scope.track('geometry', trail2.object3d(), () => trail2?.dispose(), 8192);

    lastTier = ctx.quality;
    scene = destinationScene;
    ctx.reportProgress(1, 'Compact merger ready');
    return { module: moduleObject, scope: ctx.scope, scene: destinationScene, preset: ctx.preset };
  }

  /**
   * Density graph helper retained for documentation: the actual TSL graph is
   * built inline in prepare() (it closes over the volume uniforms). The
   * angular weight mirrors ejectaDirectionWeight as a shader graph (pure
   * function of the SAMPLE DIRECTION — the observer never mutates intrinsic
   * state, mission section 13).
   */

  function enter(ctx: EnterContext): void {
    const ready = assertReady();
    ctx.services.time.registerPhaseMapping(
      'merger-timeline',
      makeMergerPhaseMapping(ready.resolved)
    );
    ctx.services.time.setPhaseMapping('merger-timeline');
    const initialUiPhase = secondsToUiPhase(ready.state.timeSeconds, ready.resolved);
    ctx.services.time.scrubTo(
      initialUiPhase === 0 ? ctx.preset.timelineInitialPhase : initialUiPhase
    );
    // Arrive PLAYING unless something explicitly paused the clock (viewer or
    // golden harness): paused arrival left the inspiral frozen.
    ctx.services.time.resumeUnlessExplicitlyPaused();
  }

  /** Linear-HDR radiance multipliers for the photospheres (presentation). */
  const REMNANT_RADIANCE = 3.2;
  const STAR_RADIANCE = 4.0;

  /** Phase-gated particle population fraction (CA5-13). */
  function populationFractionFor(phase: MergerPhase): number {
    switch (phase) {
      case 'contact':
        return 0.2;
      case 'merger':
        return 0.35;
      case 'jet':
        return 0.15;
      case 'kilonova':
        return 0.3;
      case 'afterglow':
        return 0.15;
      default:
        return 0; // inspiral keeps expensive systems OFF
    }
  }

  /** Update the trail ribbons from the CLOSED-FORM model (no history). */
  function updateTrails(ctx: FrameContext): void {
    const ready = assertReady();
    const snapshot = ctx.services.time.snapshot();
    const t = Number.isFinite(snapshot.physicalTime ?? NaN) ? (snapshot.physicalTime as number) : 0;
    if (t >= ready.resolved.contactSeconds || trail1 === null || trail2 === null) return;
    const count = TRAIL_SAMPLES;
    if (t === lastTrailTime && lastTrailCount === count) return;
    lastTrailTime = t;
    lastTrailCount = count;
    while (trailPoints1.length < count) trailPoints1.push(new THREE.Vector3());
    while (trailPoints2.length < count) trailPoints2.push(new THREE.Vector3());
    trailPoints1.length = count;
    trailPoints2.length = count;
    const orbitSeconds =
      (2 * Math.PI) / Math.max(inspiralStateAt(ready.resolved, t).orbitalFrequency, 1e-6);
    const span = orbitSeconds * TRAIL_ORBITS;
    for (let i = 0; i < count; i += 1) {
      const f = i / (count - 1);
      const sample = inspiralStateAt(ready.resolved, Math.max(0, t - span * (1 - f)));
      trailPoints1[i]!.set(sample.position.x1, 0, sample.position.z1);
      trailPoints2[i]!.set(sample.position.x2, 0, sample.position.z2);
    }
    trail1.setSpine(trailPoints1);
    trail2.setSpine(trailPoints2);
  }

  function update(ctx: FrameContext): void {
    const ready = assertReady();
    lastTier = ctx.quality;
    backdrop?.setDetail(ctx.experienceMode === 'cinematic' ? ctx.workBudget.environmentDetail : 0);
    backdrop?.setIntensity(ctx.experienceMode === 'cinematic' ? 0.5 : 0.22);
    const snapshot = ctx.services.time.snapshot();
    const t = Number.isFinite(snapshot.physicalTime ?? NaN) ? (snapshot.physicalTime as number) : 0;
    const res = ready.resolved;
    const phase = phaseAt(t, res);
    lastPhase = phase;
    const inspiral = inspiralStateAt(res, t);
    const tau = ejectaAgeSeconds(t, res.contactSeconds);

    // --- stars: visible pre-contact, converge + fade through contact --------
    const contactBlend = inspiral.atContact
      ? 1
      : Math.max(0, 1 - inspiral.secondsToContact / Math.max(res.contactSeconds * 0.25, 1e-6));
    const starGain = inspiral.atContact ? 0 : 1 - contactBlend * 0.85;
    starVisual1?.setGain(starGain);
    starVisual2?.setGain(starGain);
    starVisual1?.setTime(t * 0.08);
    starVisual2?.setTime(t * 0.08 + 1.7);
    if (star1 !== null && star2 !== null) {
      const sep = Math.max(inspiral.separation, res.contactSeparationUnits * 0.4);
      const f1 = res.m2Kg / res.totalKg;
      const f2 = res.m1Kg / res.totalKg;
      const rScale1 = res.r1Units;
      const rScale2 = res.r2Units;
      star1.position.set(inspiral.position.x1, 0, inspiral.position.z1);
      star2.position.set(inspiral.position.x2, 0, inspiral.position.z2);
      star1.scale.setScalar(
        rScale1 * (1 - contactBlend * 0.25) * Math.min(1, sep / (res.r1Units * 2))
      );
      star2.scale.setScalar(
        rScale2 * (1 - contactBlend * 0.25) * Math.min(1, sep / (res.r2Units * 2))
      );
      star1.visible = star2.visible = starGain > 0.001;
      void f1;
      void f2;
    }

    // --- merger flash (presentation envelope) --------------------------------
    const flashTau = tau / FLASH_DURATION_S;
    const flashGain = tau > 0 && flashTau < 1 ? FLASH_PEAK_GAIN * (1 - flashTau) : 0;
    flashVisual?.setGain(flashGain);
    flashVisual?.setTime(t * 0.2);
    if (flash !== null) {
      flash.visible = flashGain > 0.001;
      flash.scale.setScalar(res.contactSeparationUnits * (0.6 + flashTau * 0.9));
    }

    // --- remnant -------------------------------------------------------------
    const remnantSample = remnantSampleAt(t, res, res.r1Units);
    remnantVisual?.setGain(remnantSample.gain);
    remnantVisual?.setTint(remnantSample.tint);
    remnantVisual?.setSecondaryTint([
      remnantSample.tint[0],
      remnantSample.tint[1] * 0.42,
      Math.max(0.02, remnantSample.tint[2] * 0.2)
    ]);
    remnantVisual?.setTime(t * 0.06);
    uGlowGain.value = remnantSample.glowGain * 0.5;
    if (remnant !== null) {
      remnant.visible = remnantVisibleAt(t, res);
      remnant.scale.setScalar(remnantSample.radiusUnits);
    }
    if (remnantHalo !== null && remnantHaloVisual !== null) {
      remnantHalo.visible = remnant !== null && remnant.visible;
      remnantHaloVisual.setGain(remnant?.visible ? remnantSample.glowGain * 0.65 : 0);
      remnantHaloVisual.setTime(t * 0.08);
    }

    // --- ejecta volume + kilonova emission -----------------------------------
    const shell = ejectaRadiusUnits(tau);
    const kilonova = kilonovaSampleAt(t, res);
    uVolumeRadius.value = Math.max(shell, res.contactSeparationUnits * 0.6);
    uVolumeWidth.value = Math.max(0.35, shell * 0.22);
    uVolumeGain.value = kilonova.luminosity;
    uVolumeTint.value.set(kilonova.tint[0], kilonova.tint[1], kilonova.tint[2]);
    uVolumePolar.value =
      res.ejectaScenario === 'polar-enhanced'
        ? 0.85
        : res.ejectaScenario === 'equatorial-tidal'
          ? 0.15
          : 0.5;
    const volumeVisible = tau > 0;
    volumeHandle?.setVisible(volumeVisible);
    volumeHandle?.setStepScale(ctx.workBudget.volumeActiveSteps);

    // --- jet (scenario + phase gated; viewing response = presentation gain) --
    // Active during the jet phase; fades through kilonova; gone by afterglow.
    const front = jetFrontRadiusUnits(t, res);
    const response = jetViewingResponse(ready.state.viewingAngleDeg, res);
    const jetPhaseGain = phase === 'jet' ? 1 : phase === 'kilonova' ? 0.35 : 0;
    const jetVisible = front > 0 && jetPhaseGain > 0;
    // Gain folds the viewing response; the front/ejecta cap bounds geometry.
    uJetGain.value = jetVisible ? response * 1.4 * jetPhaseGain : 0;
    uJetFront.value = front;
    uJetRadius.value = Math.max(front * 0.16, res.r1Units * 0.5);
    if (jetGroup !== null) {
      jetGroup.visible = jetVisible;
      const capped = Math.min(front, JET_FRONT_EJECTA_CAP * Math.max(shell, 1e-6));
      // Narrower lobes (0.28 vs 0.35): readability presentation, CA6 stretch B.
      jetGroup.scale.set(capped * 0.28, Math.max(capped, 1e-4), capped * 0.28);
    }

    // --- particles (phase-gated population) -----------------------------------
    // COHERENCE NOTE: particles stay at their spawned shell (the emitter is
    // fixed at creation by the shared service contract) and act as NEAR-
    // REMNANT glow accents; the ejecta SHELL morphology is carried by the
    // volume field, whose radius is a pure function of t. Scaling the
    // particle object3d was evaluated and REJECTED: sprite sizing is world-
    // space, so object scaling blows the sprites up with the shell.
    if (particleHandle !== null) {
      const pop = populationFractionFor(phase) * ctx.workBudget.particlePopulationScale;
      particleHandle.setPopulationScale(pop);
      if (volumeVisible && !snapshot.paused) {
        particleHandle.update(ctx.time.dt);
      }
    }

    // --- trails: inspiral-only resource (CA5-13) ------------------------------
    const trailsVisible = phase === 'inspiral';
    trail1?.setVisible(trailsVisible);
    trail2?.setVisible(trailsVisible);
    if (trailsVisible) updateTrails(ctx);

    debug['phase'] = phase;
    debug['previousPhase'] = lastPhase;
    debug['timeSeconds'] = t;
    debug['starGain'] = starGain;
    debug['flashGain'] = flashGain;
    debug['remnantGain'] = remnantSample.gain;
    debug['remnantVisible'] = remnant !== null ? remnant.visible : false;
    debug['jetVisible'] = jetGroup !== null ? jetGroup.visible : false;
    debug['volumeGain'] = uVolumeGain.value;
    debug['volumeRadius'] = uVolumeRadius.value;
    debug['volumeWidth'] = uVolumeWidth.value;
    debug['separationUnits'] = inspiral.separation;
    debug['orbitalFrequencyRadS'] = inspiral.orbitalFrequency;
    debug['contactSeconds'] = res.contactSeconds;
    debug['ejectaRadiusUnits'] = shell;
    debug['kilonovaLuminosity'] = kilonova.luminosity;
    debug['kilonovaTemperatureK'] = kilonova.temperatureK;
    debug['jetFrontUnits'] = front;
    debug['jetViewingResponse'] = response;
    debug['remnantScenario'] = res.remnantScenario;
    debug['populationScale'] = populationFractionFor(phase);
    debug['volumeVisible'] = volumeVisible;
    debug['tier'] = lastTier;
    debug['viewingAngleDeg'] = ready.state.viewingAngleDeg;
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
    star1 = null;
    star2 = null;
    flash = null;
    remnant = null;
    starVisual1 = null;
    starVisual2 = null;
    flashVisual = null;
    remnantVisual = null;
    remnantHaloVisual = null;
    remnantHalo = null;
    backdrop = null;
    jetGroup = null;
    volumeHandle = null;
    particleHandle = null;
    trail1 = null;
    trail2 = null;
    trailPoints1.length = 0;
    trailPoints2.length = 0;
    lastTrailTime = Number.NaN;
    lastTrailCount = 0;
    resolved = null;
    stateValue = null;
  }

  function serializeShareState(): Record<string, unknown> {
    if (stateValue === null) return {};
    return { ...stateValue };
  }

  /** Canonical live control channel (CA5 controls; host forwards UI events). */
  function applyControlState(partial: Record<string, unknown>): void {
    if (disposed || stateValue === null) return;
    const merged = normalizeCompactMergerState({ ...stateValue, ...partial });
    applyState(merged);
  }

  function getDebugSnapshot(): Record<string, unknown> {
    return {
      ...debug,
      disposed,
      fidelity: COMPACT_MERGER_DESCRIPTOR.fidelity,
      disclosure:
        'PROCEDURAL_SCIENTIFIC: closed-form quadrupole inspiral (DIRECT reduced) + disclosed reduced ' +
        'post-merger models with presentation-compressed expansion. Not NR, not hydrodynamics.'
    };
  }

  const moduleObject: PhenomenonModule = {
    descriptor: COMPACT_MERGER_DESCRIPTOR,
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
