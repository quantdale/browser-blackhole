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
import {
  abs,
  dot,
  float,
  length,
  max,
  normalize,
  positionLocal,
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

/** Star photosphere tint proxy (linear RGB), presentation-level. */
const STAR_TINT_LINEAR = [1.0, 0.86, 0.72] as const;
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
  const uStarGain = uniform(0);
  const uShockGain = uniform(0);
  const uShockRadius = uniform(1);

  // Scratch spine buffers (allocated once per ribbon capacity).
  let boundScratch: ReturnType<typeof createSpineScratch> | null = null;
  let unboundScratch: ReturnType<typeof createSpineScratch> | null = null;
  const spinePoints: THREE.Vector3[] = [];

  // Handles owned indirectly (dispose flows through the prepare scope).
  let star: THREE.Mesh | null = null;
  let bhMarker: THREE.Mesh | null = null;
  let diskMesh: THREE.Mesh | null = null;
  let volumeHandle: VolumeHandle | null = null;
  let particleHandle: ParticleSystemHandle | null = null;
  let boundRibbon: RibbonHandle | null = null;
  let unboundRibbon: RibbonHandle | null = null;

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

    // --- star (bounded emissive sphere deformed by the tidal model) --------
    ctx.reportProgress(0.15, 'Building disrupted star');
    const segments = TIER_STAR_SEGMENTS[ctx.quality];
    const starGeometry = new THREE.SphereGeometry(1, segments.width, segments.height);
    const starMaterial = new MeshBasicNodeMaterial();
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
    starMaterial.colorNode = vec4(vec3(...STAR_TINT_LINEAR).mul(uStarGain), 1);
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
    markerMaterial.colorNode = vec4(vec3(0.9, 0.75, 0.55).mul(BH_MARKER_GAIN), 1);
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
      // Equatorial shell: dense where |y| is small relative to radius — the
      // circularizing stream lives near the orbital plane. Pure function of
      // the SAMPLE POSITION (observer-independent by contract). All
      // smoothsteps use STRICTLY RISING edges (WGSL contract, see CA5).
      density: ({ pos }) => {
        const p = vec3(pos as never);
        const r = length(p);
        const dirN = normalize(p.max(vec3(1e-9)));
        const equatorialWeight = float(1).sub(abs(dirN.y));
        const rise = smoothstep(
          uShockRadius.mul(0.55),
          uShockRadius.sub(uShockRadius.mul(0.12)),
          r
        );
        const fall = smoothstep(
          uShockRadius.add(uShockRadius.mul(0.12)),
          uShockRadius.mul(1.35),
          r
        ).oneMinus();
        return max(rise.mul(fall).mul(float(0.25).add(equatorialWeight.mul(0.75))), float(0));
      },
      emission: () => vec3(1.0, 0.62, 0.38).mul(uShockGain),
      baseMaxSteps: TIER_VOLUME_STEPS[ctx.quality],
      halfResolution: true,
      earlyAlphaTermination: true,
      temporalJitter: false
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
        preferCompute: true
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
      widthStart: Math.max(visualStarRadius(res) * 0.35, 0.8),
      widthEnd: Math.max(visualStarRadius(res) * 0.08, 0.2),
      colorStart: [1.0, 0.78, 0.52],
      colorEnd: [0.85, 0.42, 0.28],
      additive: true,
      taper: 'linear'
    });
    unboundRibbon = ctx.services.ribbons.createRibbon({
      segments: samples,
      widthStart: Math.max(visualStarRadius(res) * 0.28, 0.6),
      widthEnd: Math.max(visualStarRadius(res) * 0.05, 0.15),
      colorStart: [0.75, 0.82, 1.0],
      colorEnd: [0.35, 0.42, 0.7],
      additive: true,
      taper: 'exponential'
    });
    boundRibbon.setVisible(false);
    unboundRibbon.setVisible(false);
    destinationScene.add(boundRibbon.object3d(), unboundRibbon.object3d());
    ctx.scope.track('geometry', boundRibbon.object3d(), () => boundRibbon?.dispose(), 16384);
    ctx.scope.track('geometry', unboundRibbon.object3d(), () => unboundRibbon?.dispose(), 16384);
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
    const diskMaterial = new MeshBasicNodeMaterial();
    diskMaterial.name = 'tde-nascent-disk';
    diskMaterial.transparent = true;
    diskMaterial.side = THREE.DoubleSide;
    diskMaterial.colorNode = vec4(vec3(1.0, 0.72, 0.45), 1);
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
    ctx.services.time.pause();
    ctx.services.time.scrubTo(
      deepLinkPhase !== 0 ? deepLinkPhase : ctx.preset.timelineInitialPhase
    );
  }

  /**
   * Population fraction per phase (CA6-11): expensive systems stay OFF
   * before they are scientifically meaningful.
   */
  function populationFractionFor(phase: TdePhase): number {
    switch (phase) {
      case 'disruption':
        return 0.25;
      case 'debris':
        return 0.55;
      case 'winding':
        return 0.45;
      case 'shock':
        return 0.3;
      case 'nascent-disk':
        return 0.15;
      default:
        return 0; // approach/deformation keep debris systems OFF
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
  function updateStreams(tSinceDisruption: number): void {
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

    const nBound = buildStreamSpine(
      ready.resolved,
      tSinceDisruption,
      TIER_STREAM_SAMPLES[lastTier],
      true,
      boundScratch
    );
    spinePoints.length = 0;
    for (let i = nBound - 1; i >= 0; i -= 1) {
      // Most-bound first so ribbon taper runs head -> tail along the arc.
      spinePoints.push(new THREE.Vector3(boundScratch.xs[i]!, 0, boundScratch.zs[i]!));
    }
    if (spinePoints.length >= 2) boundRibbon.setSpine(spinePoints);

    const nUnbound = buildStreamSpine(
      ready.resolved,
      tSinceDisruption,
      TIER_STREAM_SAMPLES[lastTier],
      false,
      unboundScratch
    );
    spinePoints.length = 0;
    for (let i = 0; i < nUnbound; i += 1) {
      spinePoints.push(new THREE.Vector3(unboundScratch.xs[i]!, 0, unboundScratch.zs[i]!));
    }
    if (spinePoints.length >= 2) unboundRibbon.setSpine(spinePoints);
  }

  function update(ctx: FrameContext): void {
    const ready = assertReady();
    lastTier = ctx.quality;
    const snapshot = ctx.services.time.snapshot();
    const t = Number.isFinite(snapshot.physicalTime ?? NaN) ? (snapshot.physicalTime as number) : 0;
    const res = ready.resolved;
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
    uStarGain.value = starGain;
    if (star !== null) star.visible = starGain > 0.001;

    // --- streams: active through the disruption->shock stages -----------------
    const streamVisible =
      disrupts &&
      res.energySpreadJPerKg > 0 &&
      STREAM_PHASES.has(phase) &&
      t > -HANDOFF_FADE_SECONDS;
    if (streamVisible) updateStreams(tau);
    boundRibbon?.setVisible(streamVisible);
    unboundRibbon?.setVisible(streamVisible);

    // --- particles (phase x disruption x angular gate) -------------------------
    const orbit = ctx.services.cameraRig.getOrbit();
    const gate = accentGate(orbit.distance);
    const popFraction = populationFractionFor(phase);
    if (particleHandle !== null) {
      const pop = popFraction * gate * (disrupts ? 1 : 0);
      particleHandle.setPopulationScale(pop);
      if (pop > 0 && !snapshot.paused) {
        particleHandle.update(ctx.time.dt);
      }
    }

    // --- shock volume (phase-gated; gain separated from geometric state) -------
    const volumeVisible = disrupts && phase === 'shock';
    const shockGain = shockGainAt(res, tau, disrupts);
    volumeHandle?.setVisible(volumeVisible);
    volumeHandle?.setStepScale(TIER_STEP_SCALE[lastTier]);
    uShockGain.value = volumeVisible ? shockGain : 0;
    uShockRadius.value = shockRadiusUnits(res);

    // --- nascent disk (late-phase procedural transition) ------------------------
    const diskGain = nascentDiskGainAt(res, tau, disrupts);
    if (diskMesh !== null) {
      diskMesh.visible = diskGain > 0.001;
      const mat = diskMesh.material as THREE.Material & { opacity: number };
      mat.opacity = 0.85 * diskGain;
    }

    // --- diagnostics snapshot ----------------------------------------------------
    const fractions = classificationFractions(referenceCounts.boundCount, REFERENCE_PLAN_COUNT);
    debug['phase'] = phase;
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
    debug['diskVisible'] = diskMesh !== null ? diskMesh.visible : false;
    debug['diskGain'] = diskGain;
    debug['boundFraction'] = fractions.boundFraction;
    debug['unboundFraction'] = fractions.unboundFraction;
    debug['tier'] = lastTier;
    debug['observerInclinationDeg'] = res.observerInclinationDeg;
    debug['verdictReason'] = ready.verdict.reason;
  }

  function render(ctx: RenderContext): void {
    if (ctx.scene !== null && ctx.camera !== null) {
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
    bhMarker = null;
    diskMesh = null;
    volumeHandle = null;
    particleHandle = null;
    boundRibbon = null;
    unboundRibbon = null;
    boundScratch = null;
    unboundScratch = null;
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
