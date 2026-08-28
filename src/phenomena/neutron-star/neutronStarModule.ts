/**
 * Neutron Star destination module (CA3-01/03/04/05/06/07/09/10/11/12 code core;
 * M12-NS direct surface-ray rendering).
 *
 * Spec sources implemented here:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 2 "Neutron Star"
 *   (fidelity classes, minimum viable visualization, main controls).
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md section 8 "Neutron Star"
 *   (destination state keys) and section 6 (all public values pass one
 *   normalizer — see {@link normalizeNeutronStarState}).
 * - docs/cosmic-atlas/ARCHITECTURE.md sections 4/5/8 (lifecycle ordering
 *   prepare -> enter -> (update -> render)* -> exit -> dispose, resource
 *   scopes, deterministic time model).
 * - openspec/changes/m12-neutron-star-surface-lensing/ (design/tasks/spec):
 *   the rendered star is now the DIRECT Schwarzschild surface-ray image.
 *
 * FIDELITY (honest disclosure, mirrored in every preset fidelityNote):
 * - DIRECT: exterior Schwarzschild backwards ray tracing to the material
 *   surface at R > 2 r_g or escape to the celestial background
 *   (./surfaceLensingGpu.ts, validated against ./surfaceRayReference.ts);
 *   surface redshift g = sqrt(1 - 2 r_g/R); analytic spin-frame beacon/pulse
 *   geometry (see ./physics.ts).
 * - PROCEDURAL_SCIENTIFIC: dipole field-line visualization (shared
 *   FieldLineService traces the idealized vacuum dipole r = L sin^2theta)
 *   and the flare state machine.
 * - STILL DELIBERATELY OMITTED (not claimed): Doppler/aberration from
 *   rotating surface elements, frame dragging (Hartle-Thorne exterior),
 *   atmosphere/radiative transfer, oblate figure, interior solution.
 *
 * RAY MODEL: every camera pixel launches a backwards geodesic in the star's
 * r_g-native frame (star centered at the origin). A ray terminating on the
 * refined material-surface crossing shades base graybody emission plus up to
 * two hot-spot cones AT THE GEODESIC HIT COORDINATE (normal = normalized hit
 * point); escaped rays sample the pinned procedural celestial environment
 * along the terminal tetrad-projected direction; numerical failures render
 * explicit failure magenta, never black. The retired straight-line sphere
 * mesh was removed with the physics change (reviewed golden regeneration).
 *
 * SCENE SCALE: 1 scene unit = 1 km for this destination. The single km -> r_g
 * conversion happens per frame in render() via gravitationalRadiusKm(mass).
 *
 * EMISSION MODEL DISCLOSURE (unchanged): temperature -> RGB uses a hand-picked
 * ramp (crude approximation, explicitly NOT Planck integration); spot
 * intensities are not Stefan-Boltzmann scaled; the redshift factor multiplies
 * emission as a scalar. Full radiometry remains deferred.
 *
 * Determinism: no wall-clock reads anywhere. Rotation advances from the
 * FrameTimeInfo delta supplied by the kernel, gated by the TimeController
 * pause state; all randomness lives behind the preset seed consumed by the
 * FieldLineService.
 */

import * as THREE from 'three';
import {
  DEFAULT_MASS_SOLAR,
  DEFAULT_RADIUS_KM,
  FLARE_QUIESCENT_LEVEL,
  RG_KM_PER_SOLAR_MASS,
  flareEnvelope,
  gravitationalRadiusKm,
  lightCylinderRadiusRg,
  magneticAxisVector,
  nextFlareState,
  polarCapColatitude,
  pulseVisibility,
  spinPhase,
  surfaceRedshift,
  type FlareMode,
  type FlareState,
  type Vec3
} from './physics.js';
import {
  NS_RAY_ESCAPED,
  NS_RAY_INVALID_INITIAL_STATE,
  NS_RAY_NUMERICAL_FAILURE,
  NS_RAY_SURFACE_HIT,
  createNeutronStarSurfaceMaterial,
  nsQualityTierStepBudget,
  type NeutronStarSurfaceMaterial
} from './surfaceLensingGpu.js';
import { NEUTRON_STAR_DESCRIPTOR } from './descriptor.js';
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

// ---------------------------------------------------------------------------
// Tunables and scene-scale constants
// ---------------------------------------------------------------------------

/**
 * Single conversion point for this destination: multiply kilometres by this
 * to get scene units (currently identity, stated explicitly so a future
 * rescale touches exactly one place).
 */
const KM_TO_SCENE_UNITS = 1;

/** Camera arrival ease duration; reduced motion overrides to instant. */
const ARRIVAL_ANIMATE_SECONDS = 1.2;

/**
 * Full timeline sweep corresponds to this many spin revolutions in the
 * registered 'rotation' phase mapping (UI scrub coordinate). The visual
 * spin rate itself follows activeSeconds * spinHz, independent of this UI
 * span.
 */
const TIMELINE_ROTATIONS = 50;

/**
 * Floor on the spin rate used to PACE the timeline coordinate. A non-rotating
 * star would otherwise ask for an infinite traverse time.
 */
const MIN_TIMELINE_SPIN_HZ = 0.02;

/** Energy-input rate fed to the flare machine per simulated second. */
const FLARE_ENERGY_INPUT_PER_SECOND = 1;

/** Base emissive gain per hot spot before the folded redshift factor. */
const SPOT_BASE_GAIN = 1.0;

/**
 * Neutral visible-band stand-in tint for the base surface (linear RGB).
 * Neutron-star photospheres peak in X-ray; this graybody look is an
 * illustrative choice, disclosed rather than disguised.
 */
const BASE_SURFACE_TINT: readonly [number, number, number] = [0.55, 0.58, 0.62];
const BASE_EMISSION_SCALE = 1.2;

/** Conservative byte estimate for the compiled node material. */
const MATERIAL_BYTE_ESTIMATE = 4096;
/** Fullscreen triangle: 3 vertices x 3 float32 positions. */
const FULLSCREEN_TRIANGLE_BYTES = 36;

// Dipole field-line visualization parameters (PROCEDURAL_SCIENTIFIC).
const FIELD_LINE_STRENGTH = 1;
const FIELD_LINE_MAX_RADIUS_FACTOR = 6;
const FIELD_LINE_COUNT = 48;
const FIELD_LINE_POINTS_PER_LINE = 64;
const FIELD_LINE_COLOR: [number, number, number] = [0.45, 0.75, 1.0];
const FIELD_LINE_OPACITY = 0.35;

// Sanitizer bounds (docs/UI_UX.md parameter-safety policy: clamp, never
// silently reject; cross-field horizon guard applied after clamping).
const MAX_HOT_SPOTS = 2;
const MASS_MIN_SOLAR = 0.5;
const MASS_MAX_SOLAR = 3;
const RADIUS_MIN_KM = 8;
const RADIUS_MAX_KM = 20;
const RADIUS_HORIZON_MARGIN = 1e-3;
const SPIN_MAX_HZ = 60;
const DEFAULT_TILT_DEG = 30;
const MIN_ANGULAR_RADIUS_DEG = 0.5;
const MAX_ANGULAR_RADIUS_DEG = 60;
const AXIS_EPSILON = 1e-9;

/**
 * Dev/test-only debug view (?nssurfacedebug=1): the surface pass swaps
 * radiance for its documented parity encoding (hit normal / escape direction,
 * linear space). Same gated-URL-override precedent as the black-hole
 * destination's ?trajectory override; never part of the public state schema.
 */
function readSurfaceDebugUrlOverride(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = new URLSearchParams(window.location.search).get('nssurfacedebug');
  return raw === '1' || raw === 'true';
}

// ---------------------------------------------------------------------------
// Public state schema (STATE_AND_ROUTES section 8, Neutron Star)
// ---------------------------------------------------------------------------

export interface NeutronStarHotSpotSpec {
  /** Degrees from the +Y spin-axis pole. */
  colatitudeDeg: number;
  /** Degrees around the spin axis, measured from the magnetic-axis meridian. */
  azimuthDeg: number;
  /** Angular radius of the emitting cone/cap, degrees. */
  angularRadiusDeg: number;
  /** Emitting temperature in kelvin (drives the disclosed color ramp). */
  temperatureK: number;
}

/** Validated, unit-explicit public state for this destination. */
export interface NeutronStarPublicState {
  preset: string;
  /** Solar masses. */
  mass: number;
  /** Kilometres; sanitizer enforces R > 2 r_g. */
  radius: number;
  /** Spin frequency in hertz. */
  spinHz: number;
  /** World-frame spin axis (normalized by the sanitizer). */
  spinAxis: Vec3;
  magneticTiltDeg: number;
  /** Angle between observer direction and spin axis, degrees. */
  observerInclinationDeg: number;
  hotSpots: NeutronStarHotSpotSpec[];
  beamOpeningAngleDeg: number;
  flareState: FlareMode;
  flarePhase: number;
  /** Deterministic accumulated clock offset, seconds. */
  time: number;
}

function sanitizeNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
  return Math.min(max, Math.max(min, n));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function sanitizeSpinAxis(raw: unknown): Vec3 {
  if (Array.isArray(raw) && raw.length >= 3) {
    const x = raw[0];
    const y = raw[1];
    const z = raw[2];
    const numeric =
      typeof x === 'number' &&
      Number.isFinite(x) &&
      typeof y === 'number' &&
      Number.isFinite(y) &&
      typeof z === 'number' &&
      Number.isFinite(z);
    if (numeric) {
      const len = Math.hypot(x, y, z);
      if (len > AXIS_EPSILON) return [x / len, y / len, z / len];
    }
  }
  return [0, 1, 0];
}

function sanitizeHotSpots(raw: unknown): NeutronStarHotSpotSpec[] {
  const spots: NeutronStarHotSpotSpec[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (spots.length >= MAX_HOT_SPOTS) break;
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      spots.push({
        colatitudeDeg: sanitizeNumber(record['colatitudeDeg'], 0, 180, DEFAULT_TILT_DEG),
        azimuthDeg: sanitizeNumber(record['azimuthDeg'], -360, 360, 0),
        angularRadiusDeg: sanitizeNumber(
          record['angularRadiusDeg'],
          MIN_ANGULAR_RADIUS_DEG,
          MAX_ANGULAR_RADIUS_DEG,
          8
        ),
        temperatureK: sanitizeNumber(record['temperatureK'], 1e3, 1e8, 2.0e6)
      });
    }
  }
  return spots;
}

/**
 * The one normalizer every public value flows through
 * (STATE_AND_ROUTES section 6): finite checks, documented clamps, enum
 * validation, and the cross-field guardrail R > 2 r_g (radius is raised to
 * the horizon limit with margin rather than rejected, per the clamp-don't-
 * reject policy).
 */
export function normalizeNeutronStarState(raw: Record<string, unknown>): NeutronStarPublicState {
  const mass = sanitizeNumber(raw['mass'], MASS_MIN_SOLAR, MASS_MAX_SOLAR, DEFAULT_MASS_SOLAR);
  const minRadiusKm = 2 * RG_KM_PER_SOLAR_MASS * mass * (1 + RADIUS_HORIZON_MARGIN);
  const radius = Math.max(
    minRadiusKm,
    sanitizeNumber(raw['radius'], RADIUS_MIN_KM, RADIUS_MAX_KM, DEFAULT_RADIUS_KM)
  );
  const magneticTiltDeg = sanitizeNumber(raw['magneticTiltDeg'], 0, 180, DEFAULT_TILT_DEG);
  let hotSpots = sanitizeHotSpots(raw['hotSpots']);
  if (hotSpots.length === 0) {
    // Default: one cap riding the magnetic pole for the current tilt.
    hotSpots = [
      {
        colatitudeDeg: magneticTiltDeg,
        azimuthDeg: 0,
        angularRadiusDeg: 8,
        temperatureK: 2.0e6
      }
    ];
  }
  return {
    preset: typeof raw['preset'] === 'string' ? raw['preset'] : 'surface',
    mass,
    radius,
    spinHz: sanitizeNumber(raw['spinHz'], 0, SPIN_MAX_HZ, 0.5),
    spinAxis: sanitizeSpinAxis(raw['spinAxis']),
    magneticTiltDeg,
    observerInclinationDeg: sanitizeNumber(raw['observerInclinationDeg'], 1, 179, 80),
    hotSpots,
    beamOpeningAngleDeg: sanitizeNumber(raw['beamOpeningAngleDeg'], 1, 89, 25),
    flareState: raw['flareState'] === 'active' ? 'active' : 'quiescent',
    flarePhase: sanitizeNumber(raw['flarePhase'], 0, 0.999, 0),
    time: sanitizeNumber(raw['time'], 0, Number.MAX_SAFE_INTEGER, 0)
  };
}

// ---------------------------------------------------------------------------
// Temperature -> linear RGB ramp (disclosed approximation)
// ---------------------------------------------------------------------------

const TEMPERATURE_RAMP_ANCHORS: ReadonlyArray<{
  readonly logT: number;
  readonly rgb: readonly [number, number, number];
}> = [
  { logT: 3.48, rgb: [1.0, 0.36, 0.09] }, // ~3000 K, dull red
  { logT: 3.78, rgb: [1.0, 0.87, 0.72] }, // ~6000 K, warm white
  { logT: 4.0, rgb: [0.86, 0.91, 1.0] }, // 1e4 K, white-blue
  { logT: 4.3, rgb: [0.68, 0.79, 1.0] }, // 2e4 K, blue-white
  { logT: 6.5, rgb: [0.55, 0.68, 1.0] } // asymptote for 1e6+ K surfaces
];

/**
 * HONEST APPROXIMATION: piecewise-linear interpolation of a hand-picked
 * Planckian-locus-inspired palette over log10(T), returned in linear-light
 * RGB. This is NOT Planck-law integration and carries no radiometric claim;
 * full blackbody integration is deferred. accretionDisk.blackbodyRgb was
 * deliberately not reused because its table is calibrated only up to 4e4 K
 * while neutron-star surfaces live at 1e5..1e7 K.
 */
function temperatureKToLinearRgb(temperatureK: number): [number, number, number] {
  const logT = Math.log10(Math.min(1e8, Math.max(1e3, temperatureK)));
  const anchors = TEMPERATURE_RAMP_ANCHORS;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (first && logT <= first.logT) return [first.rgb[0], first.rgb[1], first.rgb[2]];
  if (last && logT >= last.logT) return [last.rgb[0], last.rgb[1], last.rgb[2]];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (a && b && logT >= a.logT && logT <= b.logT) {
      const t = (logT - a.logT) / (b.logT - a.logT);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t
      ];
    }
  }
  return [1, 1, 1]; // unreachable given the clamps above
}

// ---------------------------------------------------------------------------
// Spin-frame geometry (shared by prepare-time uniform seeding and enter)
// ---------------------------------------------------------------------------

/**
 * Compute the spin axis and phase-0 hot-spot directions in WORLD frame.
 *
 * Convention: spot azimuth is measured around the spin axis FROM THE
 * MAGNETIC-AXIS MERIDIAN, so a spot with colatitude == magneticTiltDeg and
 * azimuth 0 sits exactly on the magnetic pole (consistent with physics.ts
 * magneticAxisVector, which tilts about the same deterministic reference
 * direction).
 */
function computeSpinFrameBasis(state: NeutronStarPublicState): {
  spinAxis: THREE.Vector3;
  spotDirections: THREE.Vector3[];
} {
  const spinAxis = new THREE.Vector3(state.spinAxis[0], state.spinAxis[1], state.spinAxis[2]);
  if (spinAxis.lengthSq() < AXIS_EPSILON) spinAxis.set(0, 1, 0);
  spinAxis.normalize();

  const magAxisTuple = magneticAxisVector(THREE.MathUtils.degToRad(state.magneticTiltDeg), 0, [
    spinAxis.x,
    spinAxis.y,
    spinAxis.z
  ]);
  const magAxis = new THREE.Vector3(magAxisTuple[0], magAxisTuple[1], magAxisTuple[2]);

  // Reference meridian: projection of the magnetic axis perpendicular to
  // the spin axis; deterministic fallback when they are (near) parallel.
  const e1 = magAxis.clone().addScaledVector(spinAxis, -magAxis.dot(spinAxis));
  if (e1.lengthSq() < AXIS_EPSILON) {
    const absX = Math.abs(spinAxis.x);
    const absY = Math.abs(spinAxis.y);
    const absZ = Math.abs(spinAxis.z);
    const helper =
      absX <= absY && absX <= absZ
        ? new THREE.Vector3(1, 0, 0)
        : absY <= absZ
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(0, 0, 1);
    e1.crossVectors(spinAxis, helper);
  }
  e1.normalize();
  const e2 = new THREE.Vector3().crossVectors(spinAxis, e1);

  const spotDirections = state.hotSpots.map((spot) => {
    const theta = THREE.MathUtils.degToRad(spot.colatitudeDeg);
    const phi = THREE.MathUtils.degToRad(spot.azimuthDeg);
    const sinTheta = Math.sin(theta);
    // Unit by construction: cos(theta)*axis + sin(theta)*(cos(phi)*e1 + sin(phi)*e2).
    return spinAxis
      .clone()
      .multiplyScalar(Math.cos(theta))
      .addScaledVector(e1, sinTheta * Math.cos(phi))
      .addScaledVector(e2, sinTheta * Math.sin(phi));
  });
  return { spinAxis, spotDirections };
}

function toTuple(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

// ---------------------------------------------------------------------------
// Byte estimates (ResourceScope accounting; conservative approximations)
// ---------------------------------------------------------------------------

/** position (12 B) + color (12 B) per segment endpoint vertex. */
function estimateLineBytes(lineCount: number, pointsPerLine: number): number {
  return lineCount * (pointsPerLine - 1) * 2 * 24;
}

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

interface RuntimeSpot {
  spec: NeutronStarHotSpotSpec;
  /** Unit direction at spin phase 0, spin-frame coordinates. */
  staticDirection: Vec3;
}

interface NeutronStarRuntimeState {
  presetId: string;
  massSolar: number;
  radiusKm: number;
  spinHz: number;
  spinAxisWorld: Vec3;
  magneticTiltDeg: number;
  observerInclinationDeg: number;
  beamOpeningAngleDeg: number;
  hotSpots: RuntimeSpot[];
  flareMachine: FlareState;
  /** Deterministic accumulated clock, seconds (seeded from state.time). */
  activeSeconds: number;
  spinPhaseRad: number;
  revolutions: number;
  redshiftFactor: number;
  envelopeValue: number;
  pulseVisibilityValue: number;
}

/**
 * Build the neutron-star PhenomenonModule. One instance drives one
 * activation; lifecycle ordering is enforced by the host
 * (prepare -> enter -> (update -> render)* -> exit -> dispose).
 */
export function createNeutronStarModule(): PhenomenonModule {
  let disposed = false;
  let scene: THREE.Scene | null = null;
  let fieldLines: THREE.LineSegments | null = null;
  let surfacePass: NeutronStarSurfaceMaterial | null = null;
  let runtime: NeutronStarRuntimeState | null = null;
  let lastDebugSnapshot: Record<string, unknown> = {};
  let surfaceDebugOverride = false;
  /** Governor tier observed on the last update frame (RenderContext has none). */
  let lastQualityTier: QualityTier = 'medium';

  // Per-frame scratch objects: no allocation churn inside update()/render().
  const scratchQuaternion = new THREE.Quaternion();
  const scratchInverse = new THREE.Quaternion();
  const scratchAxis = new THREE.Vector3();
  const scratchSpot = new THREE.Vector3();
  const scratchObserver = new THREE.Vector3();
  const scratchSpherical = new THREE.Spherical();
  const scratchRight = new THREE.Vector3();
  const scratchUp = new THREE.Vector3();
  const scratchForward = new THREE.Vector3();

  function assertNotDisposed(): void {
    if (disposed) throw new Error('neutron-star: module has been disposed');
  }

  /**
   * Seed all emission uniforms from validated state (phase-0 configuration).
   * Hot-spot gains fold in the DIRECT redshift factor exactly as before the
   * ray-tracing change; the shading site merely moved to the geodesic hit.
   */
  function writeEmissionUniforms(state: NeutronStarPublicState): void {
    const pass = surfacePass;
    if (!pass) return;
    const u = pass.uniforms;
    const redshift = surfaceRedshift(state.mass, state.radius * 1000);
    u.redshiftFactor.value = redshift;
    u.surfaceTint.value.set(BASE_SURFACE_TINT[0], BASE_SURFACE_TINT[1], BASE_SURFACE_TINT[2]);
    u.emissionScale.value = BASE_EMISSION_SCALE;
    u.flareBoost.value =
      state.flareState === 'active' ? flareEnvelope(state.flarePhase) : FLARE_QUIESCENT_LEVEL;

    const basis = computeSpinFrameBasis(state);
    const fallbackDirection = new THREE.Vector3(0, 1, 0);
    state.hotSpots.forEach((spot, index) => {
      const slot = index === 0 ? u.slotA : u.slotB;
      const direction = basis.spotDirections[index] ?? fallbackDirection;
      slot.direction.value.copy(direction);
      slot.cosAngularRadius.value = Math.cos(THREE.MathUtils.degToRad(spot.angularRadiusDeg));
      const tint = temperatureKToLinearRgb(spot.temperatureK);
      slot.tint.value.set(tint[0], tint[1], tint[2]);
      // Every surface photon loses energy g regardless of hit position.
      // Relative intensities between spots are deliberately NOT
      // Stefan-Boltzmann scaled (disclosed deferral).
      slot.gain.value = SPOT_BASE_GAIN * redshift;
    });
    // Slots without a configured spot stay disabled via zero gain.
    for (let index = state.hotSpots.length; index < MAX_HOT_SPOTS; index++) {
      const slot = index === 0 ? u.slotA : u.slotB;
      slot.gain.value = 0;
    }
  }

  async function prepare(ctx: PrepareContext): Promise<PreparedPhenomenon> {
    assertNotDisposed();
    const abortGuard = (stage: string): void => {
      if (ctx.signal.aborted) throw new Error(`neutron-star: prepare aborted (${stage})`);
    };

    ctx.reportProgress(0.05, 'Validating preset state');
    const state = normalizeNeutronStarState(ctx.preset.state);
    abortGuard('state');

    ctx.reportProgress(0.25, 'Building Schwarzschild surface-ray pass');
    const rgKm = gravitationalRadiusKm(state.mass);
    const surfaceRadiusRg = (state.radius * KM_TO_SCENE_UNITS) / rgKm;
    const pass = createNeutronStarSurfaceMaterial({
      qualityTier: ctx.quality,
      massRg: 1, // r_g-native convention: lengths are multiples of GM/c^2
      surfaceRadiusRg
    });
    pass.uniforms.redshiftFactor.value = surfaceRedshift(state.mass, state.radius * 1000);
    surfaceDebugOverride = readSurfaceDebugUrlOverride();
    const passMesh = new THREE.Mesh(pass.geometry, pass.material);
    passMesh.name = 'neutron-star-surface-pass';
    passMesh.frustumCulled = false;
    // Draw order contract: the fullscreen pass paints star + sky FIRST;
    // overlays (dipole lines) composite afterwards without depth feedback
    // (the pass disables depth writes so line visibility never depends on
    // screen-space depth of bent rays).
    passMesh.renderOrder = -10;
    pass.material.depthTest = false;
    pass.material.depthWrite = false;

    const destinationScene = new THREE.Scene();
    destinationScene.name = 'neutron-star';
    destinationScene.add(passMesh);

    ctx.scope.track(
      'geometry',
      pass.geometry,
      () => pass.geometry.dispose(),
      FULLSCREEN_TRIANGLE_BYTES
    );
    ctx.scope.track('material', pass.material, () => pass.dispose(), MATERIAL_BYTE_ESTIMATE);
    abortGuard('surface-pass');

    ctx.reportProgress(0.55, 'Tracing dipole field lines');
    // Consumed from HostServices per contract: the shared FieldLineService
    // is HOST-owned and is never disposed by this module. Only the returned
    // LineSegments is tracked here; disposing its geometry/material is
    // idempotent even if the host later disposes the creating service.
    const momentAxis = magneticAxisVector(THREE.MathUtils.degToRad(state.magneticTiltDeg), 0, [
      ...state.spinAxis
    ]);
    const radiusUnits = state.radius * KM_TO_SCENE_UNITS;
    const lines = ctx.services.fieldLines.createDipoleLines({
      momentAxis,
      strength: FIELD_LINE_STRENGTH,
      rMin: radiusUnits,
      rMax: radiusUnits * FIELD_LINE_MAX_RADIUS_FACTOR,
      lineCount: FIELD_LINE_COUNT,
      pointsPerLine: FIELD_LINE_POINTS_PER_LINE,
      color: FIELD_LINE_COLOR,
      opacity: FIELD_LINE_OPACITY,
      seed: ctx.preset.seed
    });
    lines.name = 'neutron-star-dipole';
    destinationScene.add(lines);
    ctx.scope.track(
      'geometry',
      lines,
      () => {
        lines.geometry.dispose();
        const lineMaterial = lines.material;
        if (Array.isArray(lineMaterial)) lineMaterial.forEach((m) => m.dispose());
        else lineMaterial.dispose();
      },
      estimateLineBytes(FIELD_LINE_COUNT, FIELD_LINE_POINTS_PER_LINE)
    );
    abortGuard('field-lines');

    ctx.reportProgress(0.85, 'Configuring emission uniforms');
    surfacePass = pass;
    scene = destinationScene;
    fieldLines = lines;
    writeEmissionUniforms(state);

    ctx.reportProgress(1, 'Ready');
    return { module: moduleObject, scope: ctx.scope, scene: destinationScene, preset: ctx.preset };
  }

  function enter(ctx: EnterContext): void {
    assertNotDisposed();
    const state = normalizeNeutronStarState(ctx.preset.state);
    const basis = computeSpinFrameBasis(state);
    const fallbackDirection = new THREE.Vector3(0, 1, 0);
    runtime = {
      presetId: state.preset,
      massSolar: state.mass,
      radiusKm: state.radius,
      spinHz: state.spinHz,
      spinAxisWorld: toTuple(basis.spinAxis),
      magneticTiltDeg: state.magneticTiltDeg,
      observerInclinationDeg: state.observerInclinationDeg,
      beamOpeningAngleDeg: state.beamOpeningAngleDeg,
      hotSpots: state.hotSpots.map((spec, index) => ({
        spec,
        staticDirection: toTuple(basis.spotDirections[index] ?? fallbackDirection)
      })),
      flareMachine: { mode: state.flareState, phase01: state.flarePhase, storedEnergy: 0 },
      activeSeconds: state.time,
      spinPhaseRad: spinPhase(state.time, state.spinHz),
      revolutions: state.time * state.spinHz,
      redshiftFactor: surfaceRedshift(state.mass, state.radius * 1000),
      envelopeValue: FLARE_QUIESCENT_LEVEL,
      pulseVisibilityValue: 0
    };
    // Preset switches must also reseed emission uniforms (mass/radius/spots).
    writeEmissionUniforms(state);

    // Arrival framing: eased unless reduced motion demands an instant jump
    // (applyArrivalPreset treats non-positive durations as immediate).
    ctx.services.cameraRig.applyArrivalPreset(
      ctx.preset.camera,
      ctx.reducedMotion ? 0 : ARRIVAL_ANIMATE_SECONDS
    );

    // Timeline mapping: UI phase [0,1] <-> accumulated spin revolutions, so
    // scrubbing and the physical readout speak rotation counts. Registration
    // alone does not activate; activate immediately (ARCHITECTURE section 8).
    // Pace the scrub coordinate at the star's ACTUAL spin rate, so the readout
    // ("N rotations") advances in step with the star the viewer is watching, and
    // LOOP it: a rotating star has no end state, and without `loop` the mapping
    // saturated at 1.0 after TIMELINE_ROTATIONS and held there, which stops the
    // TIME_ADVANCED invalidation signal from ever firing again.
    const spinHz = Math.max(state.spinHz, MIN_TIMELINE_SPIN_HZ);
    ctx.services.time.registerPhaseMapping('rotation', {
      id: 'rotation',
      label: 'Spin rotation',
      forward: (phase01) => clamp01(phase01) * TIMELINE_ROTATIONS,
      inverse: (rotations) => clamp01(rotations / TIMELINE_ROTATIONS),
      formatDisplay: (rotations) => `${rotations.toFixed(1)} rotations`,
      playbackSeconds: TIMELINE_ROTATIONS / spinHz,
      loop: true
    });
    ctx.services.time.setPhaseMapping('rotation');
    ctx.services.time.resumeUnlessExplicitlyPaused();
  }

  function update(ctx: FrameContext): void {
    const rt = runtime;
    const pass = surfacePass;
    if (disposed || !rt || !pass) return;
    const u = pass.uniforms;
    lastQualityTier = ctx.quality;

    const snapshot = ctx.services.time.snapshot();
    const dt = Number.isFinite(ctx.time.dt) ? Math.max(0, ctx.time.dt) : 0;
    // Paused-aware deterministic advance: integrate the atlas-clock delta
    // only over active frames. Equivalent to elapsed*spinHz across playing
    // stretches while avoiding a jump when pause freezes playback but not
    // the shared clock. No wall-clock reads anywhere.
    if (!snapshot.paused && dt > 0) {
      rt.activeSeconds += dt;
      rt.flareMachine = nextFlareState(rt.flareMachine, dt * FLARE_ENERGY_INPUT_PER_SECOND);
    }

    rt.spinPhaseRad = spinPhase(rt.activeSeconds, rt.spinHz);
    rt.revolutions = rt.activeSeconds * rt.spinHz;

    scratchAxis.set(rt.spinAxisWorld[0], rt.spinAxisWorld[1], rt.spinAxisWorld[2]);
    scratchQuaternion.setFromAxisAngle(scratchAxis, rt.spinPhaseRad);
    scratchInverse.setFromAxisAngle(scratchAxis, -rt.spinPhaseRad);

    // Hot-spot world directions: carry the phase-0 spin-frame directions
    // around the spin axis by the current spin phase (lighthouse motion).
    rt.hotSpots.forEach((spot, index) => {
      const slot = index === 0 ? u.slotA : u.slotB;
      scratchSpot.set(spot.staticDirection[0], spot.staticDirection[1], spot.staticDirection[2]);
      scratchSpot.applyQuaternion(scratchQuaternion);
      slot.direction.value.copy(scratchSpot);
    });

    // Flare envelope multiplies total emission; quiescent baseline otherwise.
    const envelope =
      rt.flareMachine.mode === 'active'
        ? flareEnvelope(rt.flareMachine.phase01)
        : FLARE_QUIESCENT_LEVEL;
    u.flareBoost.value = envelope;
    rt.envelopeValue = envelope;

    // Cheap co-rotation of the magnetosphere: the LineSegments were traced
    // around the PHASE-0 magnetic axis, so rotating the whole object about
    // the spin axis keeps it aligned with magneticAxisVector(tilt, phase)
    // without rebuilding any vertex data.
    if (fieldLines) {
      fieldLines.quaternion.copy(scratchQuaternion);
      // Test-only debug view: hide the decorative overlay so probe pixels
      // carry pure ray-tracer encodings (blend corruption otherwise).
      fieldLines.visible = !surfaceDebugOverride;
    }

    // Analytic beacon readout for slot 0 (debug/graph value; the rendered
    // light curve emerges geometrically from the rotating spot itself).
    const firstSpot = rt.hotSpots[0];
    if (firstSpot) {
      const orbit = ctx.services.cameraRig.getOrbit();
      // Mirrors CameraRig.applyToCamera: position = target +
      // Spherical(radius, phi=polar, theta=azimuth); every neutron-star
      // preset targets the origin, so this is the observer direction.
      scratchSpherical.set(
        orbit.distance,
        THREE.MathUtils.degToRad(orbit.polarDeg),
        THREE.MathUtils.degToRad(orbit.azimuthDeg)
      );
      scratchObserver.setFromSpherical(scratchSpherical).normalize();
      // Observer re-expressed in the spin frame (inverse rotation).
      scratchObserver.applyQuaternion(scratchInverse);
      rt.pulseVisibilityValue = pulseVisibility(
        firstSpot.staticDirection,
        toTuple(scratchObserver),
        THREE.MathUtils.degToRad(rt.beamOpeningAngleDeg)
      );
    }

    refreshDebugSnapshot(rt);
  }

  function refreshDebugSnapshot(rt: NeutronStarRuntimeState): void {
    const rgKm = gravitationalRadiusKm(rt.massSolar);
    const lcRadiusRg = lightCylinderRadiusRg(rt.spinHz, rt.massSolar);
    let polarCapDeg: number | null = null;
    if (Number.isFinite(lcRadiusRg) && lcRadiusRg > rt.radiusKm / rgKm) {
      try {
        polarCapDeg = THREE.MathUtils.radToDeg(polarCapColatitude(rt.radiusKm / rgKm, lcRadiusRg));
      } catch {
        polarCapDeg = null; // out-of-domain geometry must never break a frame
      }
    }
    lastDebugSnapshot = {
      sceneUnitsPerKm: KM_TO_SCENE_UNITS,
      pattern: 'direct Schwarzschild surface rays -> material surface | celestial background',
      surfaceRayBackend: 'direct-schwarzschild-material-surface',
      surfaceLensingWired: surfacePass !== null,
      surfaceRadiusRg: rt.radiusKm / rgKm,
      rayClassificationPacking: {
        surfaceHit: NS_RAY_SURFACE_HIT,
        escaped: NS_RAY_ESCAPED,
        numericalFailure: NS_RAY_NUMERICAL_FAILURE,
        invalidInitialState: NS_RAY_INVALID_INITIAL_STATE
      },
      surfaceDebugViewActive: surfaceDebugOverride,
      massSolar: rt.massSolar,
      radiusKm: rt.radiusKm,
      radiusSceneUnits: rt.radiusKm * KM_TO_SCENE_UNITS,
      gravitationalRadiusKm: rgKm,
      compactnessRgOverR: rgKm / rt.radiusKm,
      surfaceRedshiftFactor: rt.redshiftFactor,
      spinHz: rt.spinHz,
      spinPhaseRad: rt.spinPhaseRad,
      revolutionsAccumulated: rt.revolutions,
      magneticTiltDeg: rt.magneticTiltDeg,
      observerInclinationDeg: rt.observerInclinationDeg,
      beamOpeningAngleDeg: rt.beamOpeningAngleDeg,
      hotSpotCount: rt.hotSpots.length,
      flareMode: rt.flareMachine.mode,
      flarePhase01: rt.flareMachine.phase01,
      flareEnvelopeValue: rt.envelopeValue,
      pulseVisibilitySlot0: rt.pulseVisibilityValue,
      lightCylinderRadiusRg: Number.isFinite(lcRadiusRg) ? lcRadiusRg : null,
      polarCapColatitudeDeg: polarCapDeg
    };
  }

  function render(ctx: RenderContext): void {
    // The destination owns its draw call, matching the diagnostic and
    // black-hole destination modules. Per frame the canonical camera state
    // flows through setUniformsFromState ONLY (controls never write shader
    // uniforms outside this mapping — AGENTS.md rule).
    const rt = runtime;
    const pass = surfacePass;
    if (disposed || !rt || !pass || !scene || !ctx.camera) return;

    // Single km -> r_g conversion point for the geodesic frame.
    const rgKm = gravitationalRadiusKm(rt.massSolar);
    ctx.camera.updateMatrixWorld();
    const e = ctx.camera.matrixWorld.elements;
    scratchRight.set(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0).normalize();
    scratchUp.set(e[4] ?? 0, e[5] ?? 0, e[6] ?? 0).normalize();
    scratchForward.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 0)).normalize();
    const aspect = ctx.camera.aspect;

    pass.setUniformsFromState({
      cameraPositionRg: [
        ctx.camera.position.x / rgKm,
        ctx.camera.position.y / rgKm,
        ctx.camera.position.z / rgKm
      ],
      cameraRight: [scratchRight.x, scratchRight.y, scratchRight.z],
      cameraUp: [scratchUp.x, scratchUp.y, scratchUp.z],
      cameraForward: [scratchForward.x, scratchForward.y, scratchForward.z],
      tanHalfFovY: Math.tan((ctx.camera.fov * Math.PI) / 360),
      aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1,
      massRg: 1,
      surfaceRadiusRg: rt.radiusKm / rgKm,
      maxSteps: nsQualityTierStepBudget(lastQualityTier),
      backgroundIntensity: 1,
      debugMode: surfaceDebugOverride ? 1 : 0
    });

    ctx.renderer.render(scene, ctx.camera);
  }

  function exit(_ctx: ExitContext): void {
    // Detach the scene graph only. GPU resources stay owned by the
    // prepare-time ResourceScope until the host calls disposeAll(); the
    // transition snapshot (freezeForTransition) is captured by the host
    // from the shared post chain, so the scene merely stops being traversed.
    if (scene) scene.clear();
    fieldLines = null;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (scene) scene.clear();
    scene = null;
    fieldLines = null;
    surfacePass = null;
    runtime = null;
    lastDebugSnapshot = {};
    // Pass/material/geometry GPU release is owned by the host ResourceScope
    // (tracked during prepare); this module holds no untracked GPU handles.
  }

  function serializeShareState(): Record<string, unknown> {
    const rt = runtime;
    if (!rt) return {};
    return {
      preset: rt.presetId,
      mass: rt.massSolar,
      radius: rt.radiusKm,
      spinHz: rt.spinHz,
      spinAxis: [...rt.spinAxisWorld],
      magneticTiltDeg: rt.magneticTiltDeg,
      observerInclinationDeg: rt.observerInclinationDeg,
      hotSpots: rt.hotSpots.map((spot) => ({ ...spot.spec })),
      beamOpeningAngleDeg: rt.beamOpeningAngleDeg,
      flareState: rt.flareMachine.mode,
      flarePhase: rt.flareMachine.phase01,
      time: rt.activeSeconds
    };
  }

  function getDebugSnapshot(): Record<string, unknown> {
    return { ...lastDebugSnapshot };
  }

  const moduleObject: PhenomenonModule = {
    descriptor: NEUTRON_STAR_DESCRIPTOR,
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
