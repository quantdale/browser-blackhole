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
  Scene
} from 'three/webgpu';
import { CylinderGeometry, RingGeometry } from 'three/webgpu';
import {
  float,
  length,
  max,
  mix,
  positionLocal,
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

/** Additive unlit material bound to a LIVE per-lobe gain uniform. */
function jetMaterial(
  color: [number, number, number],
  alphaNode: Node<'float'>,
  gainUniform: Node<'float'>
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  material.side = DoubleSide;
  const c = vec3(color[0], color[1], color[2]);
  material.colorNode = vec4(c.mul(gainUniform), max(alphaNode.mul(gainUniform), float(0)));
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

  /** Live per-lobe gains (+Y lobe / −Y lobe), updated every frame. */
  private readonly gainPlus = uniform(1);
  private readonly gainMinus = uniform(1);

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
      density: ({ pos }) =>
        max(
          smoothstep(float(coronaUnits), float(coronaUnits * 0.12), length(vec3(pos as never))),
          float(0)
        ) as never,
      emission: () => vec3(0.82, 0.88, 1.0).mul(float(0.5)) as never,
      baseMaxSteps: TIER_VOLUME_STEPS[ctx.quality],
      halfResolution: true,
      earlyAlphaTermination: true,
      temporalJitter: false
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
        const squash = float(Math.max(TORUS_HEIGHT_RATIO, 0.05));
        const radial = length(p.xz);
        const tubeDist = length(vec2(radial.sub(mid), p.y.div(squash)));
        return max(
          smoothstep(tube.mul(0.45), tube.mul(1.2), tubeDist).oneMinus(),
          float(0)
        ) as never;
      },
      emission: () => vec3(0.66, 0.47, 0.3).mul(float(0.5)) as never,
      baseMaxSteps: TIER_VOLUME_STEPS[ctx.quality],
      halfResolution: true,
      earlyAlphaTermination: true,
      temporalJitter: false
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
      preferCompute: false
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
      preferCompute: false
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
  }

  update(ctx: FrameContext): void {
    if (this.disposed || this.scene === null || this.root === null) return;

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
        rig.setOrbit(orbit.azimuthDeg, orbit.polarDeg, desired);
      }
    }
    this.lastZoomInput = this.state.zoom01;

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

  render(ctx: RenderContext): void {
    if (this.disposed || this.scene === null || this.root === null) return;
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
      fidelity: {
        centralGr: 'DIRECT (validated backend reuse)',
        largeScale: 'PROCEDURAL_SCIENTIFIC illustrative morphologies',
        blazar: 'orientation-driven beaming-ratio approximation (fixed Gamma)'
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

    for (const side of ['plus', 'minus'] as const) {
      const gain = side === 'plus' ? this.gainPlus : this.gainMinus;

      const coreGeo = new CylinderGeometry(width * 0.35, width * 0.9, height, 20, 1, true);
      coreGeo.translate(0, height / 2, 0);
      const coreMat = jetMaterial([0.62, 0.8, 1.0], axialFade(height, 0.12, 1), gain);
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
      const sheathMat = jetMaterial([0.4, 0.55, 0.95], axialFade(height, 0.05, 0.5), gain);
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
    const t = length(positionLocal.xz)
      .sub(float(rIn))
      .div(max(float(rOut - rIn), float(1e-4)));
    const edges = smoothstep(float(0), float(0.07), t).mul(smoothstep(float(1), float(0.85), t));
    const body = mix(
      vec3(1.0, 0.87, 0.63),
      vec3(0.72, 0.56, 0.96),
      smoothstep(float(0.25), float(0.92), t)
    );
    material.colorNode = vec4(body.mul(edges).mul(float(0.8)), edges.mul(float(0.85)));
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
