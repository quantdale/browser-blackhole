/**
 * Stellar Explosion destination module (CA4 rendering integration).
 *
 * Composes the shared Atlas services around the CPU-validated physics core
 * in this package (types/physics/timeline/shockShell/density/emission/jet/
 * ejecta). Spec sources:
 *
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 3 (minimum viable
 *   visualization, density model contract, performance optimizations);
 * - docs/cosmic-atlas/RENDERING_SERVICES.md sections 3/4/9 (ParticleService,
 *   VolumeService, SharedPost responsibilities);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 6 (invariants over
 *   rendering-relevant quantities);
 * - mission sections 21-38 (timeline, shock, half-res volume, GPU particles,
 *   coherence, emissivity trend, asymmetry, hypernova, GRB, phase-aware
 *   resources, single global governor).
 *
 * FIDELITY CLASS: PROCEDURAL_SCIENTIFIC (inherited from the physics core).
 * Every number shown here derives from the disclosed reduced model in
 * ./physics.ts and siblings; nothing in this module invents physics. It only
 * maps model outputs onto shared GPU services.
 *
 * COHERENCE CONTRACT (mission section 27): volume field, particle emitters
 * and jet all consume the SAME resolved scenario, timeline clock and seed,
 * so bulk expansion rates agree by construction. One deliberate presentation
 * cap exists: the rendered GRB jet front never exceeds
 * {@link JET_FRONT_SHELL_CAP} x the ejecta shell radius (a beta*c outflow
 * would outrun any bounded volume within days; real jets decelerate against
 * the ejecta/core-envelope — the cap encodes that qualitatively and is
 * disclosed here rather than hidden in the shader).
 *
 * RESOURCE PHASE AWARENESS (mission section 36): the volumetric ejecta and
 * the large particle population are INVISIBLE before the flash, ramp in
 * through breakout/expansion, and the whole destination keeps only one
 * volume + one particle system alive for its entire lifecycle (created in
 * prepare(), disposed via the prepare ResourceScope).
 *
 * Determinism: no wall-clock reads. The simulation clock IS the shared
 * TimeController internal coordinate (physicalTime once the mapping below is
 * active), so pause/scrub/reset reproduce identical states — validated by
 * tests/unit/explosionPhysics.test.ts roundtrip invariants.
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  dot,
  float,
  length,
  mix,
  normalize,
  positionWorld,
  smoothstep,
  sub,
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
  RenderContext
} from '../../atlas/types.js';
import {
  buildTslDensityField,
  configureDensityUniforms,
  createExplosionDensityUniforms,
  MAX_DENSITY_FACTOR,
  type DensityUniformBundle
} from './density.js';
import {
  configureEmissionUniforms,
  createExplosionEmissionUniforms,
  emissionColorAndGain,
  kelvinToLinearRgb,
  type EmissionUniformBundle
} from './emission.js';
import { buildEjectaEmitterPlan } from './ejecta.js';
import {
  buildJetFactor,
  configureJetUniforms,
  createExplosionJetUniforms,
  jetFrontUnits,
  viewingResponse,
  type JetUniformBundle
} from './jet.js';
import {
  normalizeStellarExplosionState,
  SCENE_UNIT_KM,
  type ExplosionPhase,
  type ResolvedScenario,
  type StellarExplosionPublicState
} from './types.js';
import { resolveScenario } from './physics.js';
import { shockRadiusUnits } from './physics.js';
import { MIN_SHELL_WIDTH_UNITS, SHELL_SUPPORT, shellWidthUnits } from './shockShell.js';
import { AutoFramer } from '../../renderer/shared/AutoFramer.js';
import {
  engineIgnitionSeconds,
  phaseAt,
  secondsToUiPhase,
  segmentsFor,
  uiPhaseToSeconds
} from './timeline.js';
import { STELLAR_EXPLOSION_DESCRIPTOR } from './presets.js';

// ---------------------------------------------------------------------------
// Quality mapping (single global governor -> destination workload knobs)
// ---------------------------------------------------------------------------

/** Compile-time march budget per tier (VolumeService scales length live). */
const TIER_VOLUME_STEPS: Record<QualityTier, number> = {
  low: 48,
  medium: 80,
  high: 120,
  ultra: 168
};

/** Live step-length multiplier per tier (>1 = finer sampling). */
const TIER_STEP_SCALE: Record<QualityTier, number> = {
  low: 0.75,
  medium: 1,
  high: 1.35,
  ultra: 1.75
};

/** Progenitor sphere tessellation per tier (bounded, governor-aware). */
const PROGENITOR_SEGMENTS: Record<QualityTier, { width: number; height: number }> = {
  low: { width: 40, height: 28 },
  medium: { width: 56, height: 40 },
  high: { width: 72, height: 52 },
  ultra: { width: 96, height: 64 }
};

/**
 * Rendered jet-front cap relative to the contemporaneous shell radius.
 * Presentation-scale coherence choice — see module header disclosure.
 */
const JET_FRONT_SHELL_CAP = 3;

/** Bounds sampling resolution across the presented timeline. */
const BOUNDS_SAMPLES = 64;
/** Safety factor applied to the sampled maximum bound radius. */
const BOUNDS_MARGIN = 1.2;

/** Peak jet emissivity relative to the ejecta base density (disclosed). */
const JET_EMISSION_GAIN = 1.6;

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

/**
 * Wall-clock seconds for one full traverse at 1x, and the pacing/looping the
 * mapping declares. The internal coordinate is physical seconds spanning ~0 to
 * ~1.8e7 s (months), so advancing it uniformly needed ~208 real DAYS for one
 * traverse: the destination was frozen. The segment table weights the phase
 * axis by STAGE, so playback is paced in phase to honour that weighting.
 */
const TIMELINE_PLAYBACK_SECONDS = 50;

/**
 * Target optical depth along a sight line through the ejecta shell.
 *
 * VolumeService integrates `alpha = 1 - exp(-density * dt)` with dt in SCENE
 * UNITS, while `density.ts` returns a dimensionless extinction PROXY of order
 * 1 (a validated model with a CPU oracle). Multiplying the two directly gives
 * an optical depth of order (peak density) x (shell chord), which reaches ~28
 * once the shell is ~90 units across — the ejecta rendered as a featureless
 * blown-out white ball. The render path therefore scales the model output by
 * `TARGET / (peak x chord)`, leaving the validated density field itself
 * untouched (its CPU/GPU parity tests compare the MODEL, not the presented
 * alpha).
 */
const EJECTA_TARGET_OPTICAL_DEPTH = 2.8;

/**
 * Lower bound applied to the PRESENTED ejecta emission gain (disclosed). The
 * modelled peak-normalized luminosity declines as t^-1.1 and is reported
 * unchanged in the debug snapshot; this only keeps the late nebular phase from
 * fading to black on screen.
 */
const EJECTA_EMISSION_DISPLAY_FLOOR = 0.22;

/** Extra fraction of the shell radius included when framing (shell width). */
const SHELL_WIDTH_MARGIN = 0.35;

/** Auto-framing bounds for the growing shell (see AutoFramer). */
const AUTO_FRAME_MARGIN = 2.1;
const AUTO_FRAME_MIN_UNITS = 24;
const AUTO_FRAME_MAX_UNITS = 2400;

export function createStellarExplosionModule(): PhenomenonModule {
  let disposed = false;
  let scene: THREE.Scene | null = null;

  // Uniform bundles (created once in prepare, mutated per frame).
  let densityU: DensityUniformBundle | null = null;
  let emissionU: EmissionUniformBundle | null = null;
  let jetU: JetUniformBundle | null = null;
  /** Jet visibility/emission gain folded with viewing response per frame. */
  let uJetGain: UniformNode<'float', number> | null = null;
  /** Render-side optical-depth normalization (see EJECTA_TARGET_OPTICAL_DEPTH). */
  let uOpticalScale: UniformNode<'float', number> | null = null;
  /** Last MODELLED (unfloored) emission gain, for the debug readout. */
  let lastEmissionGainModel = 0;
  /** Characteristic radius of the once-seeded particle cloud (scene units). */
  let seedCloudRadiusUnits = 0;
  const autoFramer = new AutoFramer({
    margin: AUTO_FRAME_MARGIN,
    minUnits: AUTO_FRAME_MIN_UNITS,
    maxUnits: AUTO_FRAME_MAX_UNITS
  });
  // Progenitor surface presentation uniforms.
  const uProgTint = uniform(new THREE.Vector3(1, 0.6, 0.35));
  const uProgGain = uniform(0);
  const uProgRadius = uniform(1);

  // Handles owned indirectly (dispose flows through the prepare scope and
  // the shared services' own disposal).
  let volumeHandle: import('../../atlas/types.js').VolumeHandle | null = null;
  let particleHandle: import('../../atlas/types.js').ParticleSystemHandle | null = null;
  let progenitorMesh: THREE.Mesh | null = null;

  let resolved: ResolvedScenario | null = null;
  let stateValue: StellarExplosionPublicState | null = null;
  let lastPhase: ExplosionPhase = 'progenitor';
  let lastTier: QualityTier = 'medium';
  /** Cached per-frame scalars surfaced through getDebugSnapshot(). */
  const debug: Record<string, unknown> = {};

  function assertReady(): { resolved: ResolvedScenario; state: StellarExplosionPublicState } {
    if (disposed || resolved === null || stateValue === null) {
      throw new Error('stellar-explosion: module accessed before prepare() or after dispose()');
    }
    return { resolved, state: stateValue };
  }

  async function prepare(ctx: PrepareContext): Promise<PreparedPhenomenon> {
    if (disposed) throw new Error('stellar-explosion: prepare() called after dispose()');

    ctx.reportProgress(0.05, 'Validating explosion state');
    const state = normalizeStellarExplosionState(ctx.preset.state);
    const res = resolveScenario(state);
    stateValue = state;
    resolved = res;

    const abortGuard = (stage: string): void => {
      if (ctx.signal.aborted) throw new Error(`stellar-explosion: prepare aborted (${stage})`);
    };

    const destinationScene = new THREE.Scene();
    destinationScene.name = 'stellar-explosion';

    // --- progenitor star -----------------------------------------------------
    ctx.reportProgress(0.2, 'Building progenitor star');
    const segments = PROGENITOR_SEGMENTS[ctx.quality];
    const progenitorGeometry = new THREE.SphereGeometry(
      res.progenitorRadiusUnits,
      segments.width,
      segments.height
    );
    const progenitorMaterial = new MeshBasicNodeMaterial();
    progenitorMaterial.name = 'stellar-explosion-progenitor';
    // Restrained limb behaviour: slight center-limb brightening falloff via
    // view-angle smoothstep (illustrative photosphere proxy, disclosed).
    const viewDir = normalize(sub(cameraPosition, positionWorld));
    const facing = float(dot(normalize(positionWorld), viewDir));
    const limb = smoothstep(sub(0.15, 0.1), 0.25, facing);
    progenitorMaterial.colorNode = vec4(uProgTint.mul(uProgGain.mul(mix(0.55, 1, limb))), 1);
    progenitorMesh = new THREE.Mesh(progenitorGeometry, progenitorMaterial);
    progenitorMesh.name = 'stellar-explosion-progenitor';
    destinationScene.add(progenitorMesh);

    const progBytes =
      (segments.width + 1) * (segments.height + 1) * 32 + segments.width * segments.height * 6 * 4;
    ctx.scope.track('geometry', progenitorGeometry, () => progenitorGeometry.dispose(), progBytes);
    ctx.scope.track('material', progenitorMaterial, () => progenitorMaterial.dispose(), 4096);
    abortGuard('progenitor');

    // --- volumetric ejecta (shared VolumeService, HALF-RESOLUTION path) ------
    ctx.reportProgress(0.45, 'Preparing ejecta volume field');
    densityU = createExplosionDensityUniforms();
    configureDensityUniforms(densityU, res);
    emissionU = createExplosionEmissionUniforms();
    jetU = createExplosionJetUniforms();
    uJetGain = uniform(0);
    uOpticalScale = uniform(1);

    const densityField = buildTslDensityField(densityU);
    const jetFactor = buildJetFactor(jetU);
    const combinedDensity = (args: { pos: unknown; dir: unknown }): Node<'float'> =>
      // uOpticalScale converts the model's dimensionless extinction proxy into
      // an optical depth per SCENE UNIT for the current shell geometry; see
      // EJECTA_TARGET_OPTICAL_DEPTH.
      densityField(args).add(jetFactor(args).mul(uJetGain!)).mul(uOpticalScale!);

    const boundsRadius = computeBoundsRadius(res);
    const volume = ctx.services.volumes.createVolume({
      bounds: { kind: 'sphere', center: [0, 0, 0], radius: boundsRadius },
      density: combinedDensity,
      emission: ({ pos }) => {
        // Radial temperature gradient: the ejecta cools outward, so the inner
        // photosphere reads hot (the model's own tint) and the outer skirt
        // shifts red and dims. A single global tint made the whole shell one
        // flat colour, which — with a saturated optical depth — presented as a
        // featureless white ball.
        const p = vec3(pos as Node<'vec3'>);
        const rNorm = clamp(
          length(p).div(densityU!.shellRadius.max(float(1e-6)).mul(1.35)),
          float(0),
          float(1)
        );
        const hot = vec3(emissionU!.tint);
        const cool = hot.mul(vec3(1.0, 0.52, 0.26));
        const dim = mix(float(1), float(0.35), rNorm);
        return mix(hot, cool, smoothstep(float(0.35), float(1), rNorm))
          .mul(emissionU!.gain)
          .mul(dim);
      },
      baseMaxSteps: TIER_VOLUME_STEPS[ctx.quality],
      halfResolution: true,
      earlyAlphaTermination: true,
      // Jitter WITHOUT temporal accumulation reads as animated grain under a
      // paused camera (measured: sample luminance flickered 51<->137 between
      // consecutive frames). Off keeps presented frames stable and
      // deterministic; residual banding is absorbed by the step budget.
      temporalJitter: false
    });
    volume.setStepScale(TIER_STEP_SCALE[ctx.quality]);
    volume.setVisible(false); // phase-gated: off until the flash
    volume.object3d().name = 'stellar-explosion-ejecta-volume';
    destinationScene.add(volume.object3d());
    // Byte estimate: half-res RGBA8 target + composite material headroom.
    const volumeBytes = Math.round(boundsRadius * 0 + 2 * 1024 * 1024);
    ctx.scope.track('renderTarget', volume, () => volume.dispose(), volumeBytes);
    volumeHandle = volume;
    abortGuard('volume');

    // --- GPU ejecta particles (shared ParticleService) ------------------------
    ctx.reportProgress(0.65, 'Seeding ejecta particle population');
    // Created at FULL population for this tier with emitters referenced to the
    // early-expansion shell (coherence: same velocity scale as the volume);
    // phase gating happens per frame through setPopulationScale().
    const refAge = Math.max(res.crossoverSeconds, 1);
    // The particle emitters are seeded ONCE at this reference age, so the cloud
    // has a fixed characteristic radius while the volume's shell grows through
    // it. The framing floor below keeps the camera outside that cloud during the
    // early stages; otherwise the flash frames from INSIDE the particle field.
    seedCloudRadiusUnits = Math.max(shockRadiusUnits(refAge, res), res.progenitorRadiusUnits);
    const fullPlan = buildEjectaEmitterPlan(
      res.explosionTimeSeconds + refAge,
      'expanding-ejecta',
      ctx.quality,
      res
    );
    let particleSystem: import('../../atlas/types.js').ParticleSystemHandle | null = null;
    if (fullPlan.enabled && fullPlan.capacity > 0 && fullPlan.emitters.length > 0) {
      particleSystem = ctx.services.particles.createSystem({
        capacity: fullPlan.capacity,
        emitters: fullPlan.emitters.map((entry) => ({
          kind: entry.kind,
          origin: [...entry.origin] as [number, number, number],
          radius: entry.radiusUnits,
          speed: entry.speedUnitsS,
          ...(entry.directionBias === null
            ? {}
            : {
                directionBias: [...entry.directionBias] as [number, number, number]
              })
        })),
        lifetimeSeconds: [fullPlan.lifetimeSeconds[0], fullPlan.lifetimeSeconds[1]],
        sizePx: [fullPlan.sizePx[0], fullPlan.sizePx[1]],
        colorRamp: fullPlan.colorRamp.map((stop) => ({
          t: stop.t,
          color: [...stop.color] as [number, number, number],
          alpha: stop.alpha
        })),
        blending: fullPlan.blending,
        seed: fullPlan.seed,
        preferCompute: true
      });
      particleSystem.setPopulationScale(0); // phase-gated
      particleSystem.object3d().name = 'stellar-explosion-ejecta-particles';
      destinationScene.add(particleSystem.object3d());
      ctx.scope.track(
        'storageBuffer',
        particleSystem,
        () => particleSystem?.dispose(),
        fullPlan.capacity * 48
      );
      particleHandle = particleSystem;
    }
    abortGuard('particles');

    ctx.reportProgress(0.85, 'Wiring timeline mapping');
    lastTier = ctx.quality;
    scene = destinationScene;

    ctx.reportProgress(1, 'Stellar explosion ready');
    return { module: moduleObject, scope: ctx.scope, scene: destinationScene, preset: ctx.preset };
  }

  /**
   * Maximum world radius the volume must cover: sampled shell radius + shell
   * support width + capped jet front across the whole presented timeline.
   */
  function computeBoundsRadius(res: ResolvedScenario): number {
    const segments = segmentsFor(res.scenarioId);
    const lastSegment = segments[segments.length - 1];
    const endSeconds = lastSegment?.endSeconds ?? res.explosionTimeSeconds + 1;
    const ignition = engineIgnitionSeconds(res.scenarioId);
    let maxR = res.progenitorRadiusUnits * 1.5 + 1;
    for (let i = 1; i <= BOUNDS_SAMPLES; i++) {
      const seconds = (endSeconds * i) / BOUNDS_SAMPLES;
      const age = Math.max(0, seconds - res.explosionTimeSeconds);
      const r = shockRadiusUnits(age, res) + 2.5 * shellWidthUnits(age, res);
      const front = Math.min(
        jetFrontUnits(seconds, ignition, res),
        JET_FRONT_SHELL_CAP * Math.max(shockRadiusUnits(age, res), 1)
      );
      maxR = Math.max(maxR, r, front);
    }
    return maxR * BOUNDS_MARGIN;
  }

  function enter(ctx: EnterContext): void {
    const ready = assertReady();
    // Timeline: expose the nonlinear mapping and synchronize the shared clock
    // with the validated state's time so scrub/reset reproduce exactly.
    ctx.services.time.registerPhaseMapping('explosion-timeline', {
      id: 'explosion-timeline',
      label: 'Explosion timeline',
      forward: (phase01) => uiPhaseToSeconds(phase01, ready.resolved.scenarioId),
      inverse: (internal) => secondsToUiPhase(internal, ready.resolved.scenarioId),
      formatDisplay: (internal) => `${Math.round(internal)} s`,
      playbackSeconds: TIMELINE_PLAYBACK_SECONDS,
      pacing: 'phase',
      loop: true
    });
    ctx.services.time.setPhaseMapping('explosion-timeline');
    const initialUiPhase = secondsToUiPhase(ready.state.timeSeconds, ready.resolved.scenarioId);
    ctx.services.time.scrubTo(
      initialUiPhase === 0 ? ctx.preset.timelineInitialPhase : initialUiPhase
    );
    // Arrive PLAYING: paused arrival meant the star never exploded on screen.
    ctx.services.time.play();
    autoFramer.reset();
    // The shell grows past the rig's default 500-unit ceiling in the nebular
    // stage, which would clamp both the framing and the viewer's zoom.
    ctx.services.cameraRig.setDistanceLimits(6, AUTO_FRAME_MAX_UNITS * 3);
  }

  /** Phase-gated population fraction (mirrors ejecta.ts phase policy). */
  function populationFractionFor(phase: ExplosionPhase): number {
    switch (phase) {
      case 'flash':
        return 0.25;
      case 'shock-breakout':
      case 'engine-ignition':
        return 0.6;
      case 'expanding-ejecta':
      case 'nebular':
      case 'jet-breakout':
        return 1;
      default:
        return 0; // progenitor / collapse keep expensive systems OFF
    }
  }

  function phaseHasEjecta(phase: ExplosionPhase): boolean {
    return phase !== 'progenitor' && phase !== 'collapse';
  }

  function update(ctx: FrameContext): void {
    const ready = assertReady();
    lastTier = ctx.quality;
    const snapshot = ctx.services.time.snapshot();
    const seconds = Number.isFinite(snapshot.physicalTime ?? NaN)
      ? (snapshot.physicalTime as number)
      : 0;
    const phase = phaseAt(seconds, ready.resolved.scenarioId);
    lastPhase = phase;
    const age = Math.max(0, seconds - ready.resolved.explosionTimeSeconds);

    // --- volume field uniforms -------------------------------------------------
    if (densityU !== null) {
      densityU.shellRadius.value = shockRadiusUnits(age, ready.resolved);
      densityU.shellWidth.value = Math.max(
        shellWidthUnits(age, ready.resolved),
        MIN_SHELL_WIDTH_UNITS
      );
      densityU.timeSeconds.value = seconds;
    }

    // --- render-side optical depth ------------------------------------------
    // Chord through the shell support: 2 x SHELL_SUPPORT x width. Peak density
    // is the model's own bound (MAX_DENSITY_FACTOR x baseDensity).
    if (uOpticalScale !== null && densityU !== null) {
      const width = Math.max(densityU.shellWidth.value, MIN_SHELL_WIDTH_UNITS);
      const chord = 2 * SHELL_SUPPORT * width;
      const peak = Math.max(densityU.baseDensityValue.value * MAX_DENSITY_FACTOR, 1e-6);
      uOpticalScale.value = EJECTA_TARGET_OPTICAL_DEPTH / Math.max(peak * chord, 1e-6);
    }

    // --- auto-framing: follow the growing shell -----------------------------
    // The ejecta shell spans ~1 to ~500 scene units over the timeline, so a
    // fixed standoff shows a speck, then a full frame, then the INSIDE of the
    // shell (a white wash). Progenitor/collapse frame the star itself.
    {
      const shellR = densityU?.shellRadius.value ?? 0;
      const shellExtent =
        shellR > 0
          ? shellR * (1 + SHELL_WIDTH_MARGIN)
          : Math.max(ready.resolved.progenitorRadiusUnits * 3.5, AUTO_FRAME_MIN_UNITS);
      // Never frame from inside the seeded particle cloud (see the note at the
      // emitter plan): while the shell is smaller than the cloud, frame the
      // cloud instead.
      const extent =
        populationFractionFor(phase) > 0
          ? Math.max(shellExtent, seedCloudRadiusUnits * 1.15)
          : shellExtent;
      autoFramer.update(
        ctx.services.cameraRig,
        extent,
        ctx.time.dt,
        undefined,
        snapshot.paused === true
      );
    }

    // --- emission evolution (early hot/bright -> later cool/dim/red) -----------
    if (emissionU !== null) {
      const sample = emissionColorAndGain(seconds, ready.resolved);
      // DISPLAY FLOOR (disclosed): the modelled luminosity declines as t^-1.1
      // from the flash, reaching ~1% by the expanding-ejecta stage and less
      // later, which is physically right and visually black. The floor keeps the
      // late nebular structure legible; the modelled value is reported unchanged
      // in the debug readout as `emissionGainModel`.
      configureEmissionUniforms(emissionU, {
        ...sample,
        intensity: Math.max(sample.intensity, EJECTA_EMISSION_DISPLAY_FLOOR)
      });
      lastEmissionGainModel = sample.intensity;
    }

    // --- progenitor surface ------------------------------------------------------
    if (uProgGain !== null && progenitorMesh !== null) {
      const preExplosion = phase === 'progenitor';
      const collapsing = phase === 'collapse';
      const flashFade = phase === 'flash' ? 0.35 : 0;
      const gain = preExplosion ? 1 : collapsing ? 0.8 : flashFade;
      uProgGain.value = gain;
      if (preExplosion || collapsing || phase === 'flash') {
        const tint = kelvinToLinearRgb(ready.resolved.progenitorTemperatureK);
        uProgTint.value.set(tint[0], tint[1], tint[2]);
        progenitorMesh.visible = gain > 0;
      } else {
        progenitorMesh.visible = false;
      }
      uProgRadius.value = ready.resolved.progenitorRadiusUnits;
    }

    // --- jet -----------------------------------------------------------------
    if (jetU !== null && uJetGain !== null) {
      const ignition = engineIgnitionSeconds(ready.resolved.scenarioId);
      const rawFront = jetFrontUnits(seconds, ignition, ready.resolved);
      const shellR = shockRadiusUnits(age, ready.resolved);
      const front = Math.min(rawFront, JET_FRONT_SHELL_CAP * Math.max(shellR, 1));
      configureJetUniforms(jetU, ready.resolved, front);
      // Viewing-angle response folds the beaming-inspired contrast into the
      // jet emission gain (on-axis vs off-axis distinction, mission §33).
      const response = viewingResponse(ready.resolved.jet.viewingAngleDeg, ready.resolved);
      const normalizedResponse = response / (viewingResponse(90, ready.resolved) || 1);
      uJetGain.value =
        ready.resolved.jet.enabled && front > 0 ? JET_EMISSION_GAIN * normalizedResponse : 0;
    }

    // --- resource phase awareness ---------------------------------------------
    const volumeVisible = phaseHasEjecta(phase) && age > 0;
    volumeHandle?.setVisible(volumeVisible);
    if (particleHandle !== null) {
      particleHandle.setPopulationScale(populationFractionFor(phase));
      if (volumeVisible && !snapshot.paused) {
        particleHandle.update(ctx.time.dt);
      }
    }

    // --- quality response (single global governor drives everything) ----------
    volumeHandle?.setStepScale(TIER_STEP_SCALE[lastTier]);

    debug['phase'] = phase;
    debug['previousPhase'] = lastPhase;
    debug['timeSeconds'] = seconds;
    debug['shellRadiusUnits'] = densityU?.shellRadius.value ?? null;
    debug['opticalScale'] = uOpticalScale?.value ?? null;
    debug['emissionGainPresented'] = emissionU?.gain.value ?? null;
    debug['emissionGainModel'] = lastEmissionGainModel;
    debug['autoFrameEnabled'] = autoFramer.enabled;
    debug['autoFrameDistanceUnits'] =
      autoFramer.requestedDistance === null
        ? null
        : Number(autoFramer.requestedDistance.toFixed(2));
    debug['sceneUnitKm'] = SCENE_UNIT_KM;
    debug['tier'] = lastTier;
    debug['volumeVisible'] = volumeVisible;
    debug['populationScale'] = populationFractionFor(phase);
    debug['jetEnabled'] = ready.resolved.jet.enabled;
    debug['jetFrontUnits'] = jetU?.frontUnits.value ?? 0;
    debug['maxDensityFactor'] = MAX_DENSITY_FACTOR;
  }

  function render(ctx: RenderContext): void {
    if (ctx.scene !== null && ctx.camera !== null) {
      ctx.renderer.render(ctx.scene, ctx.camera);
    }
  }

  function exit(_ctx: ExitContext): void {
    // Scene graph detach only; GPU ownership stays with the prepare scope and
    // the shared services (mirrors neutronStarModule discipline).
    scene?.clear();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scene?.clear();
    scene = null;
    progenitorMesh = null;
    volumeHandle = null;
    particleHandle = null;
    densityU = null;
    emissionU = null;
    jetU = null;
    resolved = null;
    stateValue = null;
  }

  function serializeShareState(): Record<string, unknown> {
    if (stateValue === null) return {};
    return { ...stateValue };
  }

  function getDebugSnapshot(): Record<string, unknown> {
    return {
      ...debug,
      disposed,
      fidelity: STELLAR_EXPLOSION_DESCRIPTOR.fidelity,
      disclosure:
        'PROCEDURAL_SCIENTIFIC reduced visual model: analytic shell + seeded clumping noise; not hydrodynamics.'
    };
  }

  const moduleObject: PhenomenonModule = {
    descriptor: STELLAR_EXPLOSION_DESCRIPTOR,
    prepare,
    enter,
    update,
    render,
    exit,
    dispose,
    serializeShareState,
    getDebugSnapshot
  };
  return moduleObject;
}
