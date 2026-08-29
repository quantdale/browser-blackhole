/**
 * Black-Hole Merger destination module (CA8-11..15).
 *
 * Spec sources:
 * - docs/cosmic-atlas/DATA_SOURCES_BBH_MERGER.md (pinned SXS source,
 *   gauge-dependence boundary, waveform representation);
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md §5;
 * - docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md §9 + CA-ADR-017/021;
 * - docs/cosmic-atlas/DATA_PIPELINE.md §10 (loader contract).
 *
 * ARCHITECTURE / FIDELITY MAP (mixed, disclosed):
 * - INSPIRAL/MERGER: two horizon-scaled dark-core markers follow the
 *   REDUCED NR COORDINATE PATHS (`bhAxyz`/`bhBxyz` — gauge-dependent,
 *   labeled as such); additive photon-ring accents are ILLUSTRATIVE
 *   (toggleable, never touching model state); orbit trails re-sample the
 *   reduced data behind the markers.
 * - MERGER anchor: flash envelope is CINEMATIC presentation over the
 *   DATA_DRIVEN timing (t=0 is the h22 amplitude peak).
 * - RINGDOWN/REMNANT: exclusive swap to the validated KERR numerical pass
 *   (DIRECT reuse; CA-ADR-013 respected — no black-hole physics changed)
 *   parameterized by the SOURCE-DERIVED remnant mass/spin. No accretion
 *   disk is implied (diskEnabled false).
 *
 * EXCLUSIVE VISIBILITY (CA7-12 analog): at most one render system
 * (inspiral | remnant) is visible per frame; the guard is exposed as
 * snapshot.doubleRenderGuard and asserted by tests/benchmarks.
 *
 * Determinism: no wall-clock reads anywhere; every visual quantity is a pure
 * function of the TimeController internal coordinate (NR M time relative to
 * the h22 peak). Scrub/reset reproduce identical frames (unit-tested).
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, length, positionLocal, smoothstep, vec3, vec4 } from 'three/tsl';
import { uniform } from 'three/tsl';

import type {
  EnterContext,
  ExitContext,
  FrameContext,
  PhenomenonModule,
  PrepareContext,
  PreparedPhenomenon,
  QualityTier,
  RenderContext,
  RibbonHandle
} from '../../atlas/types.js';
import type { BbmDataset } from './dataset.js';
import { loadBbmDataset } from './loader.js';
import { BLACK_HOLE_MERGER_DESCRIPTOR, BBM_DISCLOSURE } from './presets.js';
import {
  CINEMATIC_DETAIL_BY_TIER,
  createCinematicBackdrop,
  createCinematicHalo,
  createCinematicSurfaceMaterial,
  type CinematicMaterialHandle,
  type CinematicBackdropHandle
} from '../../renderer/shared/CinematicPrimitives.js';
import {
  formatBbmTime,
  makeBbmPhaseMapping,
  phaseAt,
  REMNANT_TAIL_M,
  sampleBbmAt,
  strainAmplitudeAt,
  type BbmSampleOut
} from './timeline.js';
import {
  normalizeBlackHoleMergerState,
  TIER_KERR_STEPS,
  TIER_TRAIL_SAMPLES,
  type BlackHoleMergerPublicState,
  type BbmPhase
} from './types.js';

// ---------------------------------------------------------------------------
// Presentation constants (disclosed)
// ---------------------------------------------------------------------------

/** Horizon radius of one component in scene units (= M): r_s = 2(m/M) = 1. */
const MARKER_RADIUS_UNITS = 1;
/** Illustrative photon-ring accent radii (presentation; photon sphere 3m). */
const RING_INNER_UNITS = 1.32;
const RING_OUTER_UNITS = 1.62;
/** Illustrative soft-glow accent annulus around each component. */
const GLOW_INNER_UNITS = 1.05;
const GLOW_OUTER_UNITS = 3.1;
/** Merger flash envelope peak gain (bloom carries it further). */
const FLASH_PEAK_GAIN = 5;
/** Trail ribbon arc behind the current position, NR M units. */
const TRAIL_SPAN_M = 260;

/** Reference-event -> runtime asset ids (must match the manifest `id`). */
const ASSET_ID_BY_EVENT: Record<string, string> = {
  'SXS-BBH-0001': 'sxs-bbh-0001-lev5'
};

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createBlackHoleMergerModule(): PhenomenonModule {
  let disposed = false;
  let scene: THREE.Scene | null = null;

  let stateValue: BlackHoleMergerPublicState | null = null;
  let dataset: BbmDataset | null = null;
  let lastTier: QualityTier = 'medium';
  let lastPhase: BbmPhase = 'inspiral';
  /** Last internal coordinate seen by update(); drives toggle re-evaluation. */
  let lastTimeM = 0;

  const debug: Record<string, unknown> = {};

  // Uniform bundles (created once, mutated per frame).
  const uMarkerGain = uniform(1);

  // Handles owned indirectly (disposal flows through the prepare scope).
  let inspiralGroup: THREE.Group | null = null;
  let remnantGroup: THREE.Group | null = null;
  let markerA: THREE.Mesh | null = null;
  let markerB: THREE.Mesh | null = null;
  let ringA: THREE.Mesh | null = null;
  let ringB: THREE.Mesh | null = null;
  let glowA: THREE.Mesh | null = null;
  let glowB: THREE.Mesh | null = null;
  let markerHaloA: THREE.Mesh | null = null;
  let markerHaloB: THREE.Mesh | null = null;
  let markerHaloVisual: CinematicMaterialHandle | null = null;
  let flashVisual: CinematicMaterialHandle | null = null;
  let backdrop: CinematicBackdropHandle | null = null;
  let flash: THREE.Mesh | null = null;
  let trailA: RibbonHandle | null = null;
  let trailB: RibbonHandle | null = null;
  /** Remnant Kerr pass handle (uniform-state pushes; disposal via scope). */
  let kerrPass: {
    object3d(): THREE.Mesh;
    setUniformsFromState(state: Record<string, unknown>): void;
    dispose(): void;
  } | null = null;

  // Scratch basis vectors for the Kerr uniform-state record (no allocation).
  const basisRight = new THREE.Vector3();
  const basisUp = new THREE.Vector3();
  const basisForward = new THREE.Vector3();

  // Scratch objects (zero per-frame allocation).
  const sample: BbmSampleOut = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, hRe: 0, hIm: 0 };
  const trailScratch: BbmSampleOut = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, hRe: 0, hIm: 0 };
  const trailPointsA: THREE.Vector3[] = [];
  const trailPointsB: THREE.Vector3[] = [];
  let lastTrailTime = Number.NaN;
  let lastTrailCount = 0;

  function requireDataset(): BbmDataset {
    if (disposed || dataset === null) {
      throw new Error('black-hole-merger: module accessed before prepare() or after dispose()');
    }
    return dataset;
  }

  /** EXCLUSIVE visibility between the two render systems. */
  function applySystemVisibility(phase: BbmPhase): void {
    const inspiralActive = phase === 'inspiral' || phase === 'merger';
    const markersVisible = inspiralActive;
    const accentsWanted = markersVisible && (stateValue?.illustrativeLensing ?? true);
    const trailsWanted = phase === 'inspiral' && (stateValue?.showOrbitTrails ?? true);

    if (inspiralGroup !== null) inspiralGroup.visible = inspiralActive;
    if (markerA !== null) markerA.visible = markersVisible;
    if (markerB !== null) markerB.visible = markersVisible;
    if (ringA !== null) ringA.visible = accentsWanted;
    if (ringB !== null) ringB.visible = accentsWanted;
    if (glowA !== null) glowA.visible = accentsWanted;
    if (glowB !== null) glowB.visible = accentsWanted;
    if (markerHaloA !== null) markerHaloA.visible = accentsWanted;
    if (markerHaloB !== null) markerHaloB.visible = accentsWanted;
    if (flash !== null) flash.visible = flash.visible && inspiralActive;
    if (trailA !== null) trailA.setVisible(trailsWanted);
    if (trailB !== null) trailB.setVisible(trailsWanted);
    if (remnantGroup !== null) {
      remnantGroup.visible = phase === 'ringdown' || phase === 'remnant';
    }
  }

  async function prepare(ctx: PrepareContext): Promise<PreparedPhenomenon> {
    if (disposed) throw new Error('black-hole-merger: prepare() called after dispose()');
    stateValue = normalizeBlackHoleMergerState(ctx.preset.state);

    const abortGuard = (stage: string): void => {
      if (ctx.signal.aborted) {
        throw new DOMException(`black-hole-merger: prepare aborted (${stage})`, 'AbortError');
      }
    };

    // --- CA8-10: validated lazy load (manifest -> checksummed binary) ------
    ctx.reportProgress(0.05, 'Fetching NR reference dataset');
    const assetId = ASSET_ID_BY_EVENT[stateValue.referenceEvent] ?? 'sxs-bbh-0001-lev5';
    dataset = await loadBbmDataset(assetId, { signal: ctx.signal }).catch((error) => {
      if (ctx.signal.aborted) {
        throw new DOMException('black-hole-merger: prepare aborted (asset fetch)', 'AbortError');
      }
      throw error;
    });
    ctx.reportProgress(0.55, 'Validating NR reference dataset');
    abortGuard('dataset');
    const ds = requireDataset();

    const destinationScene = new THREE.Scene();
    destinationScene.name = 'black-hole-merger';
    const detail = CINEMATIC_DETAIL_BY_TIER[ctx.quality];
    const cinematicBackdrop = createCinematicBackdrop({
      seed: ctx.preset.seed,
      intensity: 0.22,
      dustColor: [0.018, 0.02, 0.055],
      starColor: [0.78, 0.84, 1.0],
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

    // --- INSPIRAL system -----------------------------------------------------
    ctx.reportProgress(0.6, 'Building binary presentation');
    inspiralGroup = new THREE.Group();
    inspiralGroup.name = 'bbm-inspiral';

    const coreGeometry = new THREE.SphereGeometry(MARKER_RADIUS_UNITS, 40, 28);
    const ringGeometry = new THREE.RingGeometry(RING_INNER_UNITS, RING_OUTER_UNITS, 72, 1);
    ringGeometry.rotateX(-Math.PI / 2);
    const glowGeometry = new THREE.RingGeometry(GLOW_INNER_UNITS, GLOW_OUTER_UNITS, 72, 1);
    glowGeometry.rotateX(-Math.PI / 2);

    const coreMaterialA = new MeshBasicNodeMaterial();
    coreMaterialA.name = 'bbm-core-a';
    coreMaterialA.colorNode = vec4(vec3(0.01, 0.01, 0.02).mul(float(1)), 1);
    const coreMaterialB = new MeshBasicNodeMaterial();
    coreMaterialB.name = 'bbm-core-b';
    coreMaterialB.colorNode = vec4(vec3(0.01, 0.01, 0.02).mul(float(1)), 1);
    markerA = new THREE.Mesh(coreGeometry, coreMaterialA);
    markerA.name = 'bbm-marker-a';
    markerB = new THREE.Mesh(coreGeometry, coreMaterialB);
    markerB.name = 'bbm-marker-b';
    inspiralGroup.add(markerA, markerB);

    const ringMaterialA = new MeshBasicNodeMaterial();
    ringMaterialA.name = 'bbm-ring-a';
    ringMaterialA.colorNode = vec4(vec3(0.85, 0.9, 1.0).mul(uMarkerGain), 1);
    ringMaterialA.transparent = true;
    ringMaterialA.opacity = 0.85;
    ringMaterialA.blending = THREE.AdditiveBlending;
    ringMaterialA.depthWrite = false;
    ringMaterialA.side = THREE.DoubleSide;
    const ringMaterialB = ringMaterialA.clone();
    ringMaterialB.name = 'bbm-ring-b';

    // Soft illustrative glow annulus (radial fade, presentation-only).
    const glowMaterial = new MeshBasicNodeMaterial();
    glowMaterial.name = 'bbm-glow';
    const glowT = length(positionLocal.xz)
      .sub(float(GLOW_INNER_UNITS))
      .div(float(GLOW_OUTER_UNITS - GLOW_INNER_UNITS));
    const glowFade = smoothstep(float(0), float(0.25), glowT).mul(
      smoothstep(float(1), float(0.45), glowT)
    );
    glowMaterial.colorNode = vec4(vec3(0.62, 0.72, 1.0).mul(uMarkerGain), glowFade.mul(0.22));
    glowMaterial.transparent = true;
    glowMaterial.blending = THREE.AdditiveBlending;
    glowMaterial.depthWrite = false;
    glowMaterial.side = THREE.DoubleSide;
    ringA = new THREE.Mesh(ringGeometry, ringMaterialA);
    ringA.name = 'bbm-ring-a';
    ringB = new THREE.Mesh(ringGeometry, ringMaterialB);
    ringB.name = 'bbm-ring-b';
    inspiralGroup.add(ringA, ringB);
    glowA = new THREE.Mesh(glowGeometry, glowMaterial);
    glowA.name = 'bbm-glow-a';
    glowB = new THREE.Mesh(glowGeometry, glowMaterial);
    glowB.name = 'bbm-glow-b';
    inspiralGroup.add(glowA, glowB);

    const bytesGeo =
      (coreGeometry.attributes.position?.count ?? 0) * 12 +
      (ringGeometry.attributes.position?.count ?? 0) * 12;
    ctx.scope.track('geometry', coreGeometry, () => coreGeometry.dispose(), bytesGeo * 0.4);
    ctx.scope.track('geometry', ringGeometry, () => ringGeometry.dispose(), bytesGeo * 0.3);
    ctx.scope.track('geometry', glowGeometry, () => glowGeometry.dispose(), bytesGeo * 0.3);
    for (const material of [
      coreMaterialA,
      coreMaterialB,
      ringMaterialA,
      ringMaterialB,
      glowMaterial
    ]) {
      ctx.scope.track('material', material, () => material.dispose(), 4096);
    }

    // Merger flash envelope (CINEMATIC presentation over DATA_DRIVEN timing).
    const flashGeometry = new THREE.SphereGeometry(1, 24, 18);
    const flashSurface = createCinematicSurfaceMaterial({
      tint: [1.0, 0.7, 0.42],
      secondaryTint: [1.0, 0.18, 0.04],
      seed: ctx.preset.seed ^ 0x8a1,
      radiance: 2.2,
      noiseScale: 5,
      noiseStrength: 0.2,
      rimStrength: 2.1,
      noiseOctaves: detail.surfaceOctaves
    });
    const flashMaterial = flashSurface.material;
    flashMaterial.name = 'bbm-flash';
    flashVisual = flashSurface;
    flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.name = 'bbm-flash';
    flash.visible = false;
    inspiralGroup.add(flash);
    ctx.scope.track('geometry', flashGeometry, () => flashGeometry.dispose(), 8192);
    ctx.scope.track('material', flashMaterial, () => flashMaterial.dispose(), 4096);

    const markerHaloGeometry = new THREE.SphereGeometry(
      1.55,
      detail.haloSegments.width,
      detail.haloSegments.height
    );
    const markerHaloSurface = createCinematicHalo({
      tint: [0.36, 0.58, 1.0],
      seed: ctx.preset.seed ^ 0x8b2,
      gain: 0,
      alpha: 0.2,
      noiseScale: 3.2,
      noiseOctaves: detail.surfaceOctaves
    });
    markerHaloA = new THREE.Mesh(markerHaloGeometry, markerHaloSurface.material);
    markerHaloB = new THREE.Mesh(markerHaloGeometry, markerHaloSurface.material);
    markerHaloA.name = 'bbm-marker-halo-a';
    markerHaloB.name = 'bbm-marker-halo-b';
    markerHaloA.visible = false;
    markerHaloB.visible = false;
    inspiralGroup.add(markerHaloA, markerHaloB);
    markerHaloVisual = markerHaloSurface;
    ctx.scope.track(
      'geometry',
      markerHaloGeometry,
      () => markerHaloGeometry.dispose(),
      detail.haloSegments.width * detail.haloSegments.height * 32
    );
    ctx.scope.track(
      'material',
      markerHaloSurface.material,
      () => markerHaloSurface.material.dispose(),
      4096
    );

    trailA = ctx.services.ribbons.createRibbon({
      segments: TIER_TRAIL_SAMPLES[ctx.quality],
      // Wider and brighter than the original 0.055/0.012 hairline: the orbital
      // trails are the only thing that makes the inspiral READ as an orbit
      // rather than two dots, and at a 30 M standoff the old width was under a
      // pixel.
      widthStart: 0.26,
      widthEnd: 0.05,
      colorStart: [1.15, 1.25, 1.6],
      colorEnd: [0.24, 0.3, 0.62],
      additive: true,
      taper: 'linear'
    });
    trailB = ctx.services.ribbons.createRibbon({
      segments: TIER_TRAIL_SAMPLES[ctx.quality],
      widthStart: 0.26,
      widthEnd: 0.05,
      colorStart: [1.6, 1.28, 1.0],
      colorEnd: [0.62, 0.33, 0.2],
      additive: true,
      taper: 'linear'
    });
    trailA.setVisible(true);
    trailB.setVisible(true);
    inspiralGroup.add(trailA.object3d(), trailB.object3d());
    ctx.scope.track('geometry', trailA.object3d(), () => trailA?.dispose(), 8192);
    ctx.scope.track('geometry', trailB.object3d(), () => trailB?.dispose(), 8192);

    destinationScene.add(inspiralGroup);
    abortGuard('inspiral');

    // --- REMNANT system (validated Kerr reuse; CA8-14) -----------------------
    ctx.reportProgress(0.8, 'Preparing remnant Kerr backend');
    const kerr = ctx.services.lensing.createKerrLensingPass({
      massRg: ds.remnantMassOverM,
      spinDimensionless: ds.remnantChiZ,
      backgroundEquirect: null,
      // Illustrative remnant presentation: a faint hot inner-glow proxy on
      // the validated Kerr backend (labeled ILLUSTRATIVE — no post-merger
      // accretion-disk physics is claimed).
      diskEnabled: true,
      diskInnerRg: 4,
      diskOuterRg: 14,
      qualityTier: ctx.quality
    });
    remnantGroup = new THREE.Group();
    remnantGroup.name = 'bbm-remnant';
    remnantGroup.add(kerr.object3d());
    remnantGroup.visible = false;
    destinationScene.add(remnantGroup);
    kerrPass = kerr;
    ctx.scope.track('renderTarget', kerr.object3d(), () => kerr.dispose(), 12 << 20);

    scene = destinationScene;
    lastTier = ctx.quality;

    // Boot into the preset's documented phase.
    applySystemVisibility(phaseAt(ctx.preset.timelineInitialPhase, ds));

    ctx.reportProgress(1, 'Black-Hole Merger ready');
    return { module: moduleObject, scope: ctx.scope, scene: destinationScene, preset: ctx.preset };
  }

  function enter(ctx: EnterContext): void {
    const ds = requireDataset();
    ctx.services.time.registerPhaseMapping('bbm-timeline', makeBbmPhaseMapping(ds));
    ctx.services.time.setPhaseMapping('bbm-timeline');
    ctx.services.time.scrubTo(ctx.preset.timelineInitialPhase);
    // Arrive PLAYING unless something explicitly paused the clock (viewer or
    // golden harness). Arriving paused unconditionally meant the merger never
    // happened on screen.
    ctx.services.time.resumeUnlessExplicitlyPaused();
  }

  function updateTrails(t: number, ds: BbmDataset): void {
    if (trailA === null || trailB === null) return;
    const count = TIER_TRAIL_SAMPLES[lastTier];
    if (t === lastTrailTime && count === lastTrailCount) return;
    lastTrailTime = t;
    lastTrailCount = count;
    while (trailPointsA.length < count) trailPointsA.push(new THREE.Vector3());
    while (trailPointsB.length < count) trailPointsB.push(new THREE.Vector3());
    trailPointsA.length = count;
    trailPointsB.length = count;
    const tStart = Math.max(ds.tStartM, t - TRAIL_SPAN_M);
    for (let i = 0; i < count; i += 1) {
      const f = i / (count - 1);
      const ts = tStart + (t - tStart) * f;
      sampleBbmAt(ds, ts, trailScratch);
      const pointA = trailPointsA[i];
      const pointB = trailPointsB[i];
      if (pointA === undefined || pointB === undefined) continue;
      pointA.set(trailScratch.ax, trailScratch.ay, trailScratch.az);
      pointB.set(trailScratch.bx, trailScratch.by, trailScratch.bz);
    }
    trailA.setSpine(trailPointsA);
    trailB.setSpine(trailPointsB);
  }

  function update(ctx: FrameContext): void {
    const ds = requireDataset();
    lastTier = ctx.quality;
    const timeSnapshot = ctx.services.time.snapshot();
    const t = Number.isFinite(timeSnapshot.physicalTime ?? NaN)
      ? (timeSnapshot.physicalTime as number)
      : 0;
    const clampedT = Math.min(Math.max(t, ds.tStartM), ds.ringdownEndM + REMNANT_TAIL_M);
    lastTimeM = clampedT;
    backdrop?.setTime(clampedT * 0.01);
    backdrop?.setDetail(ctx.experienceMode === 'cinematic' ? ctx.workBudget.environmentDetail : 0);
    const phase = phaseAt(clampedT, ds);
    lastPhase = phase;
    applySystemVisibility(phase);

    // Markers converge along the reduced coordinate paths; positions hold at
    // the merger anchor afterwards (no extrapolation beyond data support).
    const markersActive = phase === 'inspiral' || phase === 'merger';
    if (markersActive) {
      sampleBbmAt(ds, Math.min(clampedT, 0), sample);
      if (markerA !== null && markerB !== null) {
        markerA.position.set(sample.ax, sample.ay, sample.az);
        markerB.position.set(sample.bx, sample.by, sample.bz);
        if (ringA !== null) ringA.position.copy(markerA.position);
        if (ringB !== null) ringB.position.copy(markerB.position);
        if (glowA !== null) glowA.position.copy(markerA.position);
        if (glowB !== null) glowB.position.copy(markerB.position);
        if (markerHaloA !== null) markerHaloA.position.copy(markerA.position);
        if (markerHaloB !== null) markerHaloB.position.copy(markerB.position);
      }
    }
    uMarkerGain.value = markersActive ? 1 : 0;
    markerHaloVisual?.setGain(markersActive ? 0.65 : 0);
    markerHaloVisual?.setTime(clampedT * 0.01);

    // Merger flash: exponential-decay envelope anchored at t=0 (the peak).
    const flashTau = clampedT <= 0 ? 0 : clampedT / Math.max(ds.mergerEndM, 1e-6);
    const flashGain = clampedT >= 0 && flashTau < 1 ? FLASH_PEAK_GAIN * Math.exp(-3 * flashTau) : 0;
    flashVisual?.setGain(flashGain);
    flashVisual?.setTime(clampedT * 0.02);
    if (flash !== null) {
      flash.visible = flashGain > 0.001 && markersActive;
      flash.scale.setScalar(1.6 + flashTau * 2.4);
    }

    if (phase === 'inspiral' && (stateValue?.showOrbitTrails ?? true)) {
      updateTrails(clampedT, ds);
    }

    const visibleSystems = [
      ...(inspiralGroup !== null && inspiralGroup.visible ? ['inspiral'] : []),
      ...(remnantGroup !== null && remnantGroup.visible ? ['remnant'] : [])
    ];
    debug['phase'] = phase;
    debug['previousPhase'] = lastPhase;
    debug['timeM'] = clampedT;
    debug['timeDisplay'] = formatBbmTime(clampedT);
    debug['amplitudeNormalized'] = strainAmplitudeAt(ds, clampedT) / ds.h22PeakAmplitude;
    debug['separationM'] = Math.hypot(
      sample.ax - sample.bx,
      sample.ay - sample.by,
      sample.az - sample.bz
    );
    debug['flashGain'] = flashGain;
    debug['visibleSystems'] = visibleSystems;
    debug['doubleRenderGuard'] = visibleSystems.length <= 1 ? 'ok' : 'VIOLATION';
    debug['kerrSpinDimensionless'] = ds.remnantChiZ;
    debug['kerrMassRg'] = ds.remnantMassOverM;
    debug['datasetId'] = ds.assetId;
    debug['tier'] = lastTier;
  }

  /**
   * Canonical Kerr uniform-state record for the CURRENT camera (same field
   * contract as the black-hole destination's lensing state; scene units are
   * total-mass M and the remnant parameters are SOURCE-DERIVED).
   */
  function pushKerrUniforms(camera: THREE.PerspectiveCamera): void {
    if (kerrPass === null || dataset === null) return;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    basisRight.set(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0).normalize();
    basisUp.set(e[4] ?? 0, e[5] ?? 0, e[6] ?? 0).normalize();
    basisForward.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 0)).normalize();
    const aspect = camera.aspect;
    kerrPass.setUniformsFromState({
      cameraPositionRg: [camera.position.x, camera.position.y, camera.position.z],
      cameraRight: [basisRight.x, basisRight.y, basisRight.z],
      cameraUp: [basisUp.x, basisUp.y, basisUp.z],
      cameraForward: [basisForward.x, basisForward.y, basisForward.z],
      tanHalfFovY: Math.tan((camera.fov * Math.PI) / 360),
      aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1,
      massRg: dataset.remnantMassOverM,
      spinDimensionless: dataset.remnantChiZ,
      centerRg: [0, 0, 0],
      diskEnabled: true,
      diskInnerRg: 4,
      diskOuterRg: 14,
      maxSteps: TIER_KERR_STEPS[lastTier],
      // 32 M is the escape radius the black-hole destination and both Kerr
      // parity corpora use. At 60 M rays spend the step budget climbing to a
      // background they reach identically at 32 M, which pushed a large
      // fraction of the frame into the max-steps failure class.
      escapeRadiusRg: 32,
      backgroundIntensity: 1
    });
  }

  function render(ctx: RenderContext): void {
    if (ctx.scene !== null && ctx.camera !== null) {
      backdrop?.syncToCamera(ctx.camera);
      if (remnantGroup !== null && remnantGroup.visible) {
        pushKerrUniforms(ctx.camera);
      }
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
    inspiralGroup = null;
    remnantGroup = null;
    markerA = null;
    markerB = null;
    ringA = null;
    ringB = null;
    glowA = null;
    glowB = null;
    markerHaloA = null;
    markerHaloB = null;
    markerHaloVisual = null;
    flashVisual = null;
    backdrop = null;
    flash = null;
    trailA = null;
    trailB = null;
    kerrPass = null;
    dataset = null;
    stateValue = null;
    trailPointsA.length = 0;
    trailPointsB.length = 0;
    lastTrailTime = Number.NaN;
    lastTrailCount = 0;
  }

  /** Canonical live control channel (host forwards UI events here). */
  function applyControlState(partial: Record<string, unknown>): void {
    if (disposed || stateValue === null || dataset === null) return;
    stateValue = normalizeBlackHoleMergerState({ ...stateValue, ...partial });
    applySystemVisibility(phaseAt(lastTimeM, dataset));
  }

  function serializeShareState(): Record<string, unknown> {
    if (stateValue === null) return {};
    return { ...stateValue };
  }

  function getDebugSnapshot(): Record<string, unknown> {
    return {
      ...debug,
      disposed,
      fidelity: BLACK_HOLE_MERGER_DESCRIPTOR.fidelity,
      disclosure: BBM_DISCLOSURE,
      fidelityBreakdown: {
        dynamics: 'DATA_DRIVEN (reduced NR trajectories + waveform)',
        illustrativeVisuals:
          'PROCEDURAL_SCIENTIFIC (markers/rings/trails/glow + remnant glow presentation)',
        remnantGr: 'DIRECT (validated Kerr backend, source-derived spin/mass)',
        flash: 'CINEMATIC presentation envelope over data-derived timing'
      }
    };
  }

  const moduleObject: PhenomenonModule = {
    descriptor: BLACK_HOLE_MERGER_DESCRIPTOR,
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
