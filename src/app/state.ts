/**
 * Canonical application state, schema version 1.
 *
 * Spec: docs/STATE_SCHEMA.md. This module is the single validation boundary:
 * UI events, presets, and (later) URL state are all funneled through
 * `normalizeAppState` before anything may consume them. The renderer never
 * receives raw DOM values.
 *
 * This module is intentionally free of Three.js/DOM imports so it can be
 * unit-tested without a GPU or browser.
 */

export const SCHEMA_VERSION = 1;

export type Vec3 = [number, number, number];

export type Metric = 'schwarzschild' | 'kerr';
export type DistanceMode = 'normalized' | 'physical';
export type ObserverMode = 'free' | 'static' | 'circular' | 'flyby' | 'freefall';
export type DiskModel = 'thin';
export type TemperatureModel = 'power-law' | 'thin-disk-approx';
export type VisualMode = 'scientific' | 'cinematic' | 'debug';
export type ToneMappingMode = 'neutral' | 'aces' | 'agx';
export type QualityMode = 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type BackendPreference = 'auto' | 'numerical' | 'lut';
export type TargetFps = 30 | 60 | 90 | 120;
export type DebugRenderView =
  | 'final'
  | 'classification'
  | 'steps'
  | 'min-radius'
  | 'winding'
  | 'disk-hit'
  | 'redshift'
  | 'escape-direction'
  | 'error'
  | 'history-age';

export interface BlackHoleState {
  metric: Metric;
  massSolar: number;
  distanceMode: DistanceMode;
  spin: number;
  spinAxis: Vec3;
}

export interface PhysicalDistance {
  value: number;
  unit: 'km' | 'au' | 'pc';
}

export interface ObserverState {
  mode: ObserverMode;
  positionRg: Vec3;
  targetRg: Vec3;
  up: Vec3;
  fovYDeg: number;
  physicalDistance?: PhysicalDistance;
  simulationTime: number;
  timeScale: number;
  paused: boolean;
}

export interface DiskState {
  enabled: boolean;
  model: DiskModel;
  innerRadiusRg: number;
  outerRadiusRg: number;
  normal: Vec3;
  emissivityIndex: number;
  temperatureModel: TemperatureModel;
  temperatureScale: number;
  densityScale: number;
  turbulence: number;
  seed: number;
  rotationEnabled: boolean;
}

export interface RelativityState {
  lensing: boolean;
  gravitationalRedshift: boolean;
  dopplerShift: boolean;
  relativisticBeaming: boolean;
  higherOrderImages: boolean;
}

export interface VisualState {
  mode: VisualMode;
  exposureEv: number;
  toneMapping: ToneMappingMode;
  bloomEnabled: boolean;
  bloomThreshold: number;
  bloomStrength: number;
  backgroundIntensity: number;
  cinematicDiskTint: number;
  starIntensity: number;
}

export interface RenderingState {
  qualityMode: QualityMode;
  backendPreference: BackendPreference;
  renderScale: number;
  maxEffectiveDpr: number;
  maxSteps: number;
  minStep: number;
  maxStep: number;
  integrationQuality: number;
  temporalEnabled: boolean;
  temporalTargetSamples: number;
  targetFps: TargetFps;
  dynamicResolution: boolean;
}

export interface DebugState {
  overlay: boolean;
  renderView: DebugRenderView;
  selectedPixel?: [number, number];
  freezeTime: boolean;
  deterministicSeedOverride?: number;
  showTelemetry: boolean;
}

export interface AppState {
  schemaVersion: number;
  blackHole: BlackHoleState;
  observer: ObserverState;
  disk: DiskState;
  relativity: RelativityState;
  visual: VisualState;
  rendering: RenderingState;
  debug: DebugState;
}

/**
 * Documented validation ranges. Values outside a range are clamped unless the
 * field is explicitly listed as rejected in docs/STATE_SCHEMA.md.
 */
export const STATE_RANGES = {
  /** UI-supported astrophysical mass range in solar masses (stellar to hypermassive). */
  massSolar: { min: 1, max: 1e11 },
  fovYDeg: { min: 15, max: 110 },
  /** Kerr presets stay non-extremal per docs/STATE_SCHEMA.md section 2. */
  absSpin: 0.998,
  diskRadiusRg: { min: 2, max: 1e4 },
  /** Deterministic repair gap enforced between disk inner/outer radii, in r_g. */
  minDiskRadialExtent: 0.5,
  emissivityIndex: { min: -10, max: 10 },
  temperatureScale: { min: 0.01, max: 100 },
  densityScale: { min: 0, max: 100 },
  turbulence: { min: 0, max: 1 },
  exposureEv: { min: -5, max: 5 },
  bloomThreshold: { min: 0, max: 10 },
  bloomStrength: { min: 0, max: 5 },
  intensity: { min: 0, max: 10 },
  cinematicDiskTint: { min: 0, max: 1 },
  renderScale: { min: 0.25, max: 2 },
  maxEffectiveDpr: { min: 0.5, max: 4 },
  maxSteps: { min: 16, max: 4096 },
  stepSize: { min: 1e-4, max: 1 },
  integrationQuality: { min: 0, max: 1 },
  temporalTargetSamples: { min: 1, max: 4096 },
  timeScale: { min: -1000, max: 1000 }
} as const;

/** Canonical defaults. Must always produce a renderable, valid state. */
export const DEFAULT_STATE: AppState = {
  schemaVersion: SCHEMA_VERSION,
  blackHole: {
    metric: 'schwarzschild',
    massSolar: 4.297e6, // Sgr A*, informational metadata in normalized mode
    distanceMode: 'normalized',
    spin: 0,
    spinAxis: [0, 1, 0]
  },
  observer: {
    mode: 'free',
    positionRg: [0, 10, 30],
    targetRg: [0, 0, 0],
    up: [0, 1, 0],
    fovYDeg: 60,
    simulationTime: 0,
    timeScale: 1,
    paused: false
  },
  disk: {
    enabled: true,
    model: 'thin',
    innerRadiusRg: 6, // Schwarzschild ISCO; see docs/PHYSICS.md conventions
    outerRadiusRg: 24,
    normal: [0, 1, 0],
    emissivityIndex: 1.5, // meaning is fixed at M4 implementation; inert data in M0
    temperatureModel: 'thin-disk-approx',
    temperatureScale: 1,
    densityScale: 1,
    turbulence: 0,
    seed: 1337,
    rotationEnabled: true
  },
  relativity: {
    lensing: true,
    gravitationalRedshift: true,
    dopplerShift: true,
    relativisticBeaming: true,
    higherOrderImages: true // informational/quality-linked until M3 tracing proves them
  },
  visual: {
    mode: 'scientific',
    exposureEv: 0,
    toneMapping: 'neutral', // only persist tone mappers actually implemented
    bloomEnabled: false,
    bloomThreshold: 1,
    bloomStrength: 0.5,
    backgroundIntensity: 1,
    cinematicDiskTint: 0,
    starIntensity: 1
  },
  rendering: {
    qualityMode: 'auto',
    backendPreference: 'auto',
    renderScale: 1,
    maxEffectiveDpr: 2,
    maxSteps: 512,
    minStep: 0.005,
    maxStep: 0.25,
    integrationQuality: 0.5,
    temporalEnabled: false,
    temporalTargetSamples: 64,
    targetFps: 60,
    dynamicResolution: true
  },
  debug: {
    overlay: false,
    renderView: 'final',
    freezeTime: false,
    showTelemetry: false
  }
};

export type StateErrorCode = 'STATE_INVALID' | 'SCHEMA_VERSION_UNSUPPORTED';

export interface NormalizationSuccess {
  ok: true;
  state: AppState;
}

export interface NormalizationFailure {
  ok: false;
  code: StateErrorCode;
  reason: string;
}

export type NormalizationResult = NormalizationSuccess | NormalizationFailure;

/** Result of normalizing a single field or subtree. */
export type FieldResult<T> = { ok: true; value: T } | NormalizationFailure;

function fail(code: StateErrorCode, reason: string): NormalizationFailure {
  return { ok: false, code, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface NumberRule {
  field: string;
  /** Reject instead of clamping when at/below this floor (used for massSolar). */
  rejectAtOrBelow?: number;
}

function normalizeNumber(
  value: unknown,
  rule: NumberRule,
  min: number,
  max: number
): FieldResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('STATE_INVALID', `${rule.field}: expected a finite number`);
  }
  if (rule.rejectAtOrBelow !== undefined && value <= rule.rejectAtOrBelow) {
    return fail(
      'STATE_INVALID',
      `${rule.field}: value ${value} at or below hard minimum ${rule.rejectAtOrBelow}`
    );
  }
  return { ok: true, value: Math.min(max, Math.max(min, value)) };
}

function normalizeEnum<T extends string | number>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): FieldResult<T> {
  const matches =
    (typeof value === 'string' || typeof value === 'number') &&
    (allowed as readonly (string | number)[]).includes(value);
  if (!matches) {
    return fail('STATE_INVALID', `${field}: expected one of ${allowed.map(String).join(' | ')}`);
  }
  return { ok: true, value: value as T };
}

function normalizeBool(value: unknown, field: string): FieldResult<boolean> {
  if (typeof value !== 'boolean') {
    return fail('STATE_INVALID', `${field}: expected a boolean`);
  }
  return { ok: true, value };
}

/** Normalizes a direction vector: finite components, non-zero length, unit output. */
export function normalizeDirection(value: unknown, field: string): FieldResult<Vec3> {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((c) => typeof c !== 'number' || !Number.isFinite(c))
  ) {
    return fail('STATE_INVALID', `${field}: expected [number, number, number] of finite numbers`);
  }
  const [x, y, z] = value as [number, number, number];
  const len = Math.hypot(x, y, z);
  if (len < 1e-12) {
    return fail('STATE_INVALID', `${field}: zero-length vector cannot be normalized`);
  }
  return { ok: true, value: [x / len, y / len, z / len] };
}

function normalizePosition(value: unknown, field: string): FieldResult<Vec3> {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((c) => typeof c !== 'number' || !Number.isFinite(c))
  ) {
    return fail('STATE_INVALID', `${field}: expected [number, number, number] of finite numbers`);
  }
  return { ok: true, value: [...value] as Vec3 };
}

function pick(record: Record<string, unknown>, key: string, fallback: unknown): unknown {
  const v = record[key];
  return v === undefined ? fallback : v;
}

function normalizeBlackHole(input: Record<string, unknown>): FieldResult<BlackHoleState> {
  const d = DEFAULT_STATE.blackHole;
  const metric = normalizeEnum(pick(input, 'metric', d.metric), 'blackHole.metric', [
    'schwarzschild',
    'kerr'
  ] as const);
  if (!metric.ok) return metric;
  const mass = normalizeNumber(
    pick(input, 'massSolar', d.massSolar),
    { field: 'blackHole.massSolar', rejectAtOrBelow: 0 },
    STATE_RANGES.massSolar.min,
    STATE_RANGES.massSolar.max
  );
  if (!mass.ok) return mass;
  const distanceMode = normalizeEnum(
    pick(input, 'distanceMode', d.distanceMode),
    'blackHole.distanceMode',
    ['normalized', 'physical'] as const
  );
  if (!distanceMode.ok) return distanceMode;
  const spin = normalizeNumber(
    pick(input, 'spin', d.spin),
    { field: 'blackHole.spin' },
    -STATE_RANGES.absSpin,
    STATE_RANGES.absSpin
  );
  if (!spin.ok) return spin;
  const spinAxis = normalizeDirection(pick(input, 'spinAxis', d.spinAxis), 'blackHole.spinAxis');
  if (!spinAxis.ok) return spinAxis;
  // Schwarzschild forces effective spin to 0 (docs/STATE_SCHEMA.md section 2).
  const effectiveSpin = metric.value === 'schwarzschild' ? 0 : (spin.value ?? 0);
  return {
    ok: true,
    value: {
      metric: metric.value,
      massSolar: mass.value ?? d.massSolar,
      distanceMode: distanceMode.value,
      spin: effectiveSpin,
      spinAxis: spinAxis.value ?? d.spinAxis
    }
  };
}

function normalizeObserver(input: Record<string, unknown>): FieldResult<ObserverState> {
  const d = DEFAULT_STATE.observer;
  const mode = normalizeEnum(pick(input, 'mode', d.mode), 'observer.mode', [
    'free',
    'static',
    'circular',
    'flyby',
    'freefall'
  ] as const);
  if (!mode.ok) return mode;
  const positionRg = normalizePosition(
    pick(input, 'positionRg', d.positionRg),
    'observer.positionRg'
  );
  if (!positionRg.ok) return positionRg;
  const targetRg = normalizePosition(pick(input, 'targetRg', d.targetRg), 'observer.targetRg');
  if (!targetRg.ok) return targetRg;
  const up = normalizeDirection(pick(input, 'up', d.up), 'observer.up');
  if (!up.ok) return up;
  const fovYDeg = normalizeNumber(
    pick(input, 'fovYDeg', d.fovYDeg),
    { field: 'observer.fovYDeg' },
    STATE_RANGES.fovYDeg.min,
    STATE_RANGES.fovYDeg.max
  );
  if (!fovYDeg.ok) return fovYDeg;
  const simulationTime = normalizeNumber(
    pick(input, 'simulationTime', d.simulationTime),
    { field: 'observer.simulationTime' },
    -Number.MAX_VALUE,
    Number.MAX_VALUE
  );
  if (!simulationTime.ok) return simulationTime;
  const timeScale = normalizeNumber(
    pick(input, 'timeScale', d.timeScale),
    { field: 'observer.timeScale' },
    STATE_RANGES.timeScale.min,
    STATE_RANGES.timeScale.max
  );
  if (!timeScale.ok) return timeScale;
  const paused = normalizeBool(pick(input, 'paused', d.paused), 'observer.paused');
  if (!paused.ok) return paused;

  const pos = positionRg.value ?? d.positionRg;
  const tgt = targetRg.value ?? d.targetRg;
  const fwd: Vec3 = [tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]];
  const fwdLen = Math.hypot(...fwd);
  if (fwdLen < 1e-9) {
    return fail('STATE_INVALID', 'observer: position and target coincide; forward vector is zero');
  }
  const upV = up.value ?? d.up;
  const cosAngle = (fwd[0] * upV[0] + fwd[1] * upV[1] + fwd[2] * upV[2]) / fwdLen;
  if (Math.abs(cosAngle) > 0.999) {
    return fail('STATE_INVALID', 'observer.up is parallel to the view direction');
  }

  let physicalDistance: PhysicalDistance | undefined;
  const pdRaw = input['physicalDistance'];
  if (pdRaw !== undefined) {
    if (!isRecord(pdRaw)) {
      return fail('STATE_INVALID', 'observer.physicalDistance: expected an object');
    }
    const value = normalizeNumber(
      pdRaw['value'],
      { field: 'observer.physicalDistance.value' },
      0,
      Number.MAX_VALUE
    );
    if (!value.ok) return value;
    const unit = normalizeEnum(pdRaw['unit'], 'observer.physicalDistance.unit', [
      'km',
      'au',
      'pc'
    ] as const);
    if (!unit.ok) return unit;
    physicalDistance = { value: value.value ?? 0, unit: unit.value };
  }

  const result: ObserverState = {
    mode: mode.value,
    positionRg: pos,
    targetRg: tgt,
    up: upV,
    fovYDeg: fovYDeg.value ?? d.fovYDeg,
    simulationTime: simulationTime.value ?? 0,
    timeScale: timeScale.value ?? 1,
    paused: paused.value ?? false
  };
  if (physicalDistance !== undefined) {
    result.physicalDistance = physicalDistance;
  }
  return { ok: true, value: result };
}

function normalizeDisk(input: Record<string, unknown>): FieldResult<DiskState> {
  const d = DEFAULT_STATE.disk;
  const enabled = normalizeBool(pick(input, 'enabled', d.enabled), 'disk.enabled');
  if (!enabled.ok) return enabled;
  const model = normalizeEnum(pick(input, 'model', d.model), 'disk.model', ['thin'] as const);
  if (!model.ok) return model;
  const innerRadiusRg = normalizeNumber(
    pick(input, 'innerRadiusRg', d.innerRadiusRg),
    { field: 'disk.innerRadiusRg' },
    STATE_RANGES.diskRadiusRg.min,
    STATE_RANGES.diskRadiusRg.max
  );
  if (!innerRadiusRg.ok) return innerRadiusRg;
  const outerRadiusRg = normalizeNumber(
    pick(input, 'outerRadiusRg', d.outerRadiusRg),
    { field: 'disk.outerRadiusRg' },
    STATE_RANGES.diskRadiusRg.min,
    STATE_RANGES.diskRadiusRg.max
  );
  if (!outerRadiusRg.ok) return outerRadiusRg;
  const normal = normalizeDirection(pick(input, 'normal', d.normal), 'disk.normal');
  if (!normal.ok) return normal;
  const emissivityIndex = normalizeNumber(
    pick(input, 'emissivityIndex', d.emissivityIndex),
    { field: 'disk.emissivityIndex' },
    STATE_RANGES.emissivityIndex.min,
    STATE_RANGES.emissivityIndex.max
  );
  if (!emissivityIndex.ok) return emissivityIndex;
  const temperatureModel = normalizeEnum(
    pick(input, 'temperatureModel', d.temperatureModel),
    'disk.temperatureModel',
    ['power-law', 'thin-disk-approx'] as const
  );
  if (!temperatureModel.ok) return temperatureModel;
  const temperatureScale = normalizeNumber(
    pick(input, 'temperatureScale', d.temperatureScale),
    { field: 'disk.temperatureScale' },
    STATE_RANGES.temperatureScale.min,
    STATE_RANGES.temperatureScale.max
  );
  if (!temperatureScale.ok) return temperatureScale;
  const densityScale = normalizeNumber(
    pick(input, 'densityScale', d.densityScale),
    { field: 'disk.densityScale' },
    STATE_RANGES.densityScale.min,
    STATE_RANGES.densityScale.max
  );
  if (!densityScale.ok) return densityScale;
  const turbulence = normalizeNumber(
    pick(input, 'turbulence', d.turbulence),
    { field: 'disk.turbulence' },
    STATE_RANGES.turbulence.min,
    STATE_RANGES.turbulence.max
  );
  if (!turbulence.ok) return turbulence;
  const seedRaw = normalizeNumber(
    pick(input, 'seed', d.seed),
    { field: 'disk.seed' },
    -Number.MAX_VALUE,
    Number.MAX_VALUE
  );
  if (!seedRaw.ok) return seedRaw;
  const rotationEnabled = normalizeBool(
    pick(input, 'rotationEnabled', d.rotationEnabled),
    'disk.rotationEnabled'
  );
  if (!rotationEnabled.ok) return rotationEnabled;

  const inner = innerRadiusRg.value ?? d.innerRadiusRg;
  // Deterministic repair of inverted radii (docs/STATE_SCHEMA.md section 16).
  const outer = Math.max(
    outerRadiusRg.value ?? d.outerRadiusRg,
    inner + STATE_RANGES.minDiskRadialExtent
  );

  return {
    ok: true,
    value: {
      enabled: enabled.value ?? true,
      model: model.value,
      innerRadiusRg: inner,
      outerRadiusRg: outer,
      normal: normal.value ?? d.normal,
      emissivityIndex: emissivityIndex.value ?? d.emissivityIndex,
      temperatureModel: temperatureModel.value,
      temperatureScale: temperatureScale.value ?? d.temperatureScale,
      densityScale: densityScale.value ?? d.densityScale,
      turbulence: turbulence.value ?? d.turbulence,
      seed: Math.trunc(seedRaw.value ?? d.seed),
      rotationEnabled: rotationEnabled.value ?? true
    }
  };
}

function normalizeRelativity(input: Record<string, unknown>): FieldResult<RelativityState> {
  const d = DEFAULT_STATE.relativity;
  const lensing = normalizeBool(pick(input, 'lensing', d.lensing), 'relativity.lensing');
  if (!lensing.ok) return lensing;
  const gravitationalRedshift = normalizeBool(
    pick(input, 'gravitationalRedshift', d.gravitationalRedshift),
    'relativity.gravitationalRedshift'
  );
  if (!gravitationalRedshift.ok) return gravitationalRedshift;
  const dopplerShift = normalizeBool(
    pick(input, 'dopplerShift', d.dopplerShift),
    'relativity.dopplerShift'
  );
  if (!dopplerShift.ok) return dopplerShift;
  const relativisticBeaming = normalizeBool(
    pick(input, 'relativisticBeaming', d.relativisticBeaming),
    'relativity.relativisticBeaming'
  );
  if (!relativisticBeaming.ok) return relativisticBeaming;
  const higherOrderImages = normalizeBool(
    pick(input, 'higherOrderImages', d.higherOrderImages),
    'relativity.higherOrderImages'
  );
  if (!higherOrderImages.ok) return higherOrderImages;
  return {
    ok: true,
    value: {
      lensing: lensing.value ?? true,
      gravitationalRedshift: gravitationalRedshift.value ?? true,
      dopplerShift: dopplerShift.value ?? true,
      relativisticBeaming: relativisticBeaming.value ?? true,
      higherOrderImages: higherOrderImages.value ?? true
    }
  };
}

function normalizeVisual(input: Record<string, unknown>): FieldResult<VisualState> {
  const d = DEFAULT_STATE.visual;
  const mode = normalizeEnum(pick(input, 'mode', d.mode), 'visual.mode', [
    'scientific',
    'cinematic',
    'debug'
  ] as const);
  if (!mode.ok) return mode;
  const exposureEv = normalizeNumber(
    pick(input, 'exposureEv', d.exposureEv),
    { field: 'visual.exposureEv' },
    STATE_RANGES.exposureEv.min,
    STATE_RANGES.exposureEv.max
  );
  if (!exposureEv.ok) return exposureEv;
  const toneMapping = normalizeEnum(
    pick(input, 'toneMapping', d.toneMapping),
    'visual.toneMapping',
    ['neutral', 'aces', 'agx'] as const
  );
  if (!toneMapping.ok) return toneMapping;
  const bloomEnabled = normalizeBool(
    pick(input, 'bloomEnabled', d.bloomEnabled),
    'visual.bloomEnabled'
  );
  if (!bloomEnabled.ok) return bloomEnabled;
  const bloomThreshold = normalizeNumber(
    pick(input, 'bloomThreshold', d.bloomThreshold),
    { field: 'visual.bloomThreshold' },
    STATE_RANGES.bloomThreshold.min,
    STATE_RANGES.bloomThreshold.max
  );
  if (!bloomThreshold.ok) return bloomThreshold;
  const bloomStrength = normalizeNumber(
    pick(input, 'bloomStrength', d.bloomStrength),
    { field: 'visual.bloomStrength' },
    STATE_RANGES.bloomStrength.min,
    STATE_RANGES.bloomStrength.max
  );
  if (!bloomStrength.ok) return bloomStrength;
  const backgroundIntensity = normalizeNumber(
    pick(input, 'backgroundIntensity', d.backgroundIntensity),
    { field: 'visual.backgroundIntensity' },
    STATE_RANGES.intensity.min,
    STATE_RANGES.intensity.max
  );
  if (!backgroundIntensity.ok) return backgroundIntensity;
  const cinematicDiskTint = normalizeNumber(
    pick(input, 'cinematicDiskTint', d.cinematicDiskTint),
    { field: 'visual.cinematicDiskTint' },
    STATE_RANGES.cinematicDiskTint.min,
    STATE_RANGES.cinematicDiskTint.max
  );
  if (!cinematicDiskTint.ok) return cinematicDiskTint;
  const starIntensity = normalizeNumber(
    pick(input, 'starIntensity', d.starIntensity),
    { field: 'visual.starIntensity' },
    STATE_RANGES.intensity.min,
    STATE_RANGES.intensity.max
  );
  if (!starIntensity.ok) return starIntensity;
  return {
    ok: true,
    value: {
      mode: mode.value,
      exposureEv: exposureEv.value ?? 0,
      toneMapping: toneMapping.value,
      bloomEnabled: bloomEnabled.value ?? false,
      bloomThreshold: bloomThreshold.value ?? 1,
      bloomStrength: bloomStrength.value ?? 0.5,
      backgroundIntensity: backgroundIntensity.value ?? 1,
      cinematicDiskTint: cinematicDiskTint.value ?? 0,
      starIntensity: starIntensity.value ?? 1
    }
  };
}

function normalizeRendering(input: Record<string, unknown>): FieldResult<RenderingState> {
  const d = DEFAULT_STATE.rendering;
  const qualityMode = normalizeEnum(
    pick(input, 'qualityMode', d.qualityMode),
    'rendering.qualityMode',
    ['auto', 'low', 'medium', 'high', 'ultra', 'custom'] as const
  );
  if (!qualityMode.ok) return qualityMode;
  const backendPreference = normalizeEnum(
    pick(input, 'backendPreference', d.backendPreference),
    'rendering.backendPreference',
    ['auto', 'numerical', 'lut'] as const
  );
  if (!backendPreference.ok) return backendPreference;
  const renderScale = normalizeNumber(
    pick(input, 'renderScale', d.renderScale),
    { field: 'rendering.renderScale' },
    STATE_RANGES.renderScale.min,
    STATE_RANGES.renderScale.max
  );
  if (!renderScale.ok) return renderScale;
  const maxEffectiveDpr = normalizeNumber(
    pick(input, 'maxEffectiveDpr', d.maxEffectiveDpr),
    { field: 'rendering.maxEffectiveDpr' },
    STATE_RANGES.maxEffectiveDpr.min,
    STATE_RANGES.maxEffectiveDpr.max
  );
  if (!maxEffectiveDpr.ok) return maxEffectiveDpr;
  const maxSteps = normalizeNumber(
    pick(input, 'maxSteps', d.maxSteps),
    { field: 'rendering.maxSteps' },
    STATE_RANGES.maxSteps.min,
    STATE_RANGES.maxSteps.max
  );
  if (!maxSteps.ok) return maxSteps;
  const minStep = normalizeNumber(
    pick(input, 'minStep', d.minStep),
    { field: 'rendering.minStep' },
    STATE_RANGES.stepSize.min,
    STATE_RANGES.stepSize.max
  );
  if (!minStep.ok) return minStep;
  const maxStep = normalizeNumber(
    pick(input, 'maxStep', d.maxStep),
    { field: 'rendering.maxStep' },
    STATE_RANGES.stepSize.min,
    STATE_RANGES.stepSize.max
  );
  if (!maxStep.ok) return maxStep;
  const integrationQuality = normalizeNumber(
    pick(input, 'integrationQuality', d.integrationQuality),
    { field: 'rendering.integrationQuality' },
    STATE_RANGES.integrationQuality.min,
    STATE_RANGES.integrationQuality.max
  );
  if (!integrationQuality.ok) return integrationQuality;
  const temporalEnabled = normalizeBool(
    pick(input, 'temporalEnabled', d.temporalEnabled),
    'rendering.temporalEnabled'
  );
  if (!temporalEnabled.ok) return temporalEnabled;
  const temporalTargetSamples = normalizeNumber(
    pick(input, 'temporalTargetSamples', d.temporalTargetSamples),
    { field: 'rendering.temporalTargetSamples' },
    STATE_RANGES.temporalTargetSamples.min,
    STATE_RANGES.temporalTargetSamples.max
  );
  if (!temporalTargetSamples.ok) return temporalTargetSamples;
  const targetFps = normalizeEnum(pick(input, 'targetFps', d.targetFps), 'rendering.targetFps', [
    30, 60, 90, 120
  ] as unknown as readonly TargetFps[]);
  if (!targetFps.ok) return targetFps;
  const dynamicResolution = normalizeBool(
    pick(input, 'dynamicResolution', d.dynamicResolution),
    'rendering.dynamicResolution'
  );
  if (!dynamicResolution.ok) return dynamicResolution;

  const maxStepV = maxStep.value ?? d.maxStep;
  let minStepV = minStep.value ?? d.minStep;
  // Deterministic repair when the order is inverted.
  if (!(minStepV < maxStepV)) {
    minStepV = maxStepV * 0.1;
  }

  return {
    ok: true,
    value: {
      qualityMode: qualityMode.value,
      backendPreference: backendPreference.value,
      renderScale: renderScale.value ?? 1,
      maxEffectiveDpr: maxEffectiveDpr.value ?? 2,
      maxSteps: Math.trunc(maxSteps.value ?? d.maxSteps),
      minStep: minStepV,
      maxStep: maxStepV,
      integrationQuality: integrationQuality.value ?? 0.5,
      temporalEnabled: temporalEnabled.value ?? false,
      temporalTargetSamples: Math.trunc(temporalTargetSamples.value ?? 64),
      targetFps: targetFps.value,
      dynamicResolution: dynamicResolution.value ?? true
    }
  };
}

function normalizeDebug(input: Record<string, unknown>): FieldResult<DebugState> {
  const d = DEFAULT_STATE.debug;
  const overlay = normalizeBool(pick(input, 'overlay', d.overlay), 'debug.overlay');
  if (!overlay.ok) return overlay;
  const renderView = normalizeEnum(pick(input, 'renderView', d.renderView), 'debug.renderView', [
    'final',
    'classification',
    'steps',
    'min-radius',
    'winding',
    'disk-hit',
    'redshift',
    'escape-direction',
    'error',
    'history-age'
  ] as const);
  if (!renderView.ok) return renderView;
  const freezeTime = normalizeBool(pick(input, 'freezeTime', d.freezeTime), 'debug.freezeTime');
  if (!freezeTime.ok) return freezeTime;
  const showTelemetry = normalizeBool(
    pick(input, 'showTelemetry', d.showTelemetry),
    'debug.showTelemetry'
  );
  if (!showTelemetry.ok) return showTelemetry;

  const result: DebugState = {
    overlay: overlay.value ?? false,
    renderView: renderView.value,
    freezeTime: freezeTime.value ?? false,
    showTelemetry: showTelemetry.value ?? false
  };
  const spRaw = input['selectedPixel'];
  if (spRaw !== undefined) {
    if (
      !Array.isArray(spRaw) ||
      spRaw.length !== 2 ||
      spRaw.some((c) => typeof c !== 'number' || !Number.isFinite(c))
    ) {
      return fail('STATE_INVALID', 'debug.selectedPixel: expected [number, number]');
    }
    result.selectedPixel = [Math.trunc(spRaw[0] as number), Math.trunc(spRaw[1] as number)];
  }
  const seedOverride = input['deterministicSeedOverride'];
  if (seedOverride !== undefined) {
    const seed = normalizeNumber(
      seedOverride,
      { field: 'debug.deterministicSeedOverride' },
      -Number.MAX_VALUE,
      Number.MAX_VALUE
    );
    if (!seed.ok) return seed;
    result.deterministicSeedOverride = Math.trunc(seed.value ?? 0);
  }
  return { ok: true, value: result };
}

/**
 * The single validation boundary (docs/STATE_SCHEMA.md section 10).
 *
 * Non-finite numbers, wrong types, unknown enum values, zero-length direction
 * vectors, and degenerate camera geometry reject the whole payload
 * (`ok: false`); callers must fall back to a known-safe preset rather than
 * partially applying invalid values (docs/FAILURE_RECOVERY.md section 11).
 * Finite out-of-range values are clamped to documented ranges.
 */
export function normalizeAppState(input: unknown): NormalizationResult {
  if (!isRecord(input)) {
    return fail('STATE_INVALID', 'state: expected an object');
  }
  const schemaVersion = input['schemaVersion'];
  if (schemaVersion !== SCHEMA_VERSION) {
    // Fail closed on unknown/future versions; no migration exists yet.
    return fail(
      'SCHEMA_VERSION_UNSUPPORTED',
      `schemaVersion: unsupported value ${String(schemaVersion)}`
    );
  }

  const subtrees = [
    ['blackHole', normalizeBlackHole],
    ['observer', normalizeObserver],
    ['disk', normalizeDisk],
    ['relativity', normalizeRelativity],
    ['visual', normalizeVisual],
    ['rendering', normalizeRendering],
    ['debug', normalizeDebug]
  ] as const;

  const normalized: Record<string, unknown> = {};
  for (const [key, fn] of subtrees) {
    const raw = input[key];
    if (raw !== undefined && !isRecord(raw)) {
      return fail('STATE_INVALID', `${key}: expected an object`);
    }
    const result = fn(raw ?? {});
    if (!result.ok) return result;
    normalized[key] = result.value;
  }

  const state: AppState = {
    schemaVersion: SCHEMA_VERSION,
    blackHole: normalized['blackHole'] as BlackHoleState,
    observer: normalized['observer'] as ObserverState,
    disk: normalized['disk'] as DiskState,
    relativity: normalized['relativity'] as RelativityState,
    visual: normalized['visual'] as VisualState,
    rendering: normalized['rendering'] as RenderingState,
    debug: normalized['debug'] as DebugState
  };
  return { ok: true, state };
}

/**
 * Invalidation classification skeleton (docs/STATE_SCHEMA.md section 11).
 * Bit meanings are stable; debug tooling and temporal policy depend on them.
 */
export enum Invalidation {
  None = 0,
  Post = 1 << 0,
  Radiance = 1 << 1,
  Geometry = 1 << 2,
  Camera = 1 << 3,
  Backend = 1 << 4
}

type SubtreeKey = Exclude<keyof AppState, 'schemaVersion'>;

/** Per-field invalidation masks for every control family. */
const INVALIDATION_MAP: Record<SubtreeKey, Record<string, Invalidation>> = {
  blackHole: {
    metric: Invalidation.Geometry | Invalidation.Radiance,
    // In normalized mode all distances live in r_g, so mass is display metadata only.
    massSolar: Invalidation.None,
    distanceMode: Invalidation.Geometry | Invalidation.Radiance,
    spin: Invalidation.Geometry | Invalidation.Radiance,
    spinAxis: Invalidation.Geometry | Invalidation.Radiance
  },
  observer: {
    mode: Invalidation.Camera | Invalidation.Geometry,
    positionRg: Invalidation.Camera | Invalidation.Geometry,
    targetRg: Invalidation.Camera | Invalidation.Geometry,
    up: Invalidation.Camera | Invalidation.Geometry,
    fovYDeg: Invalidation.Camera | Invalidation.Geometry,
    physicalDistance: Invalidation.Geometry | Invalidation.Radiance,
    simulationTime: Invalidation.Radiance,
    timeScale: Invalidation.Radiance,
    paused: Invalidation.Radiance
  },
  disk: {
    enabled: Invalidation.Geometry | Invalidation.Radiance,
    model: Invalidation.Geometry | Invalidation.Radiance,
    innerRadiusRg: Invalidation.Geometry | Invalidation.Radiance,
    outerRadiusRg: Invalidation.Geometry | Invalidation.Radiance,
    normal: Invalidation.Geometry | Invalidation.Radiance,
    emissivityIndex: Invalidation.Radiance,
    temperatureModel: Invalidation.Radiance,
    temperatureScale: Invalidation.Radiance,
    densityScale: Invalidation.Radiance,
    turbulence: Invalidation.Radiance,
    seed: Invalidation.Radiance,
    rotationEnabled: Invalidation.Radiance
  },
  relativity: {
    lensing: Invalidation.Geometry | Invalidation.Radiance,
    gravitationalRedshift: Invalidation.Radiance,
    dopplerShift: Invalidation.Radiance,
    relativisticBeaming: Invalidation.Radiance,
    higherOrderImages: Invalidation.Radiance
  },
  visual: {
    mode: Invalidation.Post,
    exposureEv: Invalidation.Post,
    toneMapping: Invalidation.Post,
    bloomEnabled: Invalidation.Post,
    bloomThreshold: Invalidation.Post,
    bloomStrength: Invalidation.Post,
    backgroundIntensity: Invalidation.Radiance,
    cinematicDiskTint: Invalidation.Post,
    starIntensity: Invalidation.Radiance
  },
  rendering: {
    // qualityMode itself only selects a profile; concrete fields carry invalidation.
    qualityMode: Invalidation.None,
    backendPreference: Invalidation.Backend | Invalidation.Geometry,
    // Resolution-only knobs do not invalidate accumulated content.
    renderScale: Invalidation.None,
    maxEffectiveDpr: Invalidation.None,
    maxSteps: Invalidation.Geometry,
    minStep: Invalidation.Geometry,
    maxStep: Invalidation.Geometry,
    integrationQuality: Invalidation.Geometry,
    temporalEnabled: Invalidation.None,
    temporalTargetSamples: Invalidation.None,
    targetFps: Invalidation.None,
    dynamicResolution: Invalidation.None
  },
  debug: {
    overlay: Invalidation.None,
    renderView: Invalidation.None,
    selectedPixel: Invalidation.None,
    freezeTime: Invalidation.None,
    deterministicSeedOverride: Invalidation.Radiance,
    showTelemetry: Invalidation.None
  }
};

function leafChanged(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length !== b.length || a.some((v, i) => v !== b[i]);
  }
  return a !== b;
}

/**
 * Classifies the change between two normalized states as an Invalidation mask.
 * Both inputs must already be normalized outputs of `normalizeAppState`.
 */
export function classifyStateChange(previous: AppState, next: AppState): Invalidation {
  let mask = Invalidation.None;
  const keys = Object.keys(INVALIDATION_MAP) as SubtreeKey[];
  for (const subtree of keys) {
    const prevSub = previous[subtree] as unknown as Record<string, unknown>;
    const nextSub = next[subtree] as unknown as Record<string, unknown>;
    const fieldMap = INVALIDATION_MAP[subtree];
    for (const field of Object.keys(fieldMap)) {
      if (leafChanged(prevSub[field], nextSub[field])) {
        mask |= fieldMap[field] ?? Invalidation.None;
      }
    }
  }
  return mask;
}
