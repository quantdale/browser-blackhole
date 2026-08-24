# Canonical application state schema

The application uses one validated canonical state. UI controls, presets, shareable URLs, tests, and renderer mapping all operate through this schema rather than mutating Three.js/shader objects directly.

## 1. Top-level shape

Initial conceptual TypeScript shape:

```ts
interface AppState {
  schemaVersion: number;
  blackHole: BlackHoleState;
  observer: ObserverState;
  disk: DiskState;
  relativity: RelativityState;
  visual: VisualState;
  rendering: RenderingState;
  debug: DebugState;
}
```

The first implemented schema version is `1`. Increment only for persisted/shareable compatibility changes, not ordinary internal refactors.

## 2. BlackHoleState

```ts
interface BlackHoleState {
  metric: 'schwarzschild' | 'kerr';
  massSolar: number;
  distanceMode: 'normalized' | 'physical';
  spin: number;
  spinAxis: [number, number, number];
}
```

Validation:

- `massSolar > 0` and within a documented UI-supported astrophysical range;
- Schwarzschild forces effective spin to `0` without destroying a remembered Kerr value unless product UX intentionally does so;
- Kerr spin presets remain inside safe non-extremal range initially, e.g. `|a*| <= 0.998` unless the numerical backend later validates a broader range;
- spin axis normalized and non-zero.

M9 implementation status: `metric` and signed `spin` are LIVE for the Cosmic
Atlas black-hole destination through the per-module control record
(`normalizeBlackHoleControls`, clamp ±0.998; see
`src/phenomena/black-hole/controlState.ts`). `spinAxis` remains metadata:
M9 supports only the canonical +Y axis (docs/KERR_BACKEND_ADR.md §1.4); a
tilted axis is an explicitly unsupported/degraded configuration, not a
silently rotated approximation. Backend routing truth and the effective-spin
rule live in KERR_BACKEND_ADR §1.21.

## 3. ObserverState

```ts
interface ObserverState {
  mode: 'free' | 'static' | 'circular' | 'flyby' | 'freefall';
  positionRg: [number, number, number];
  targetRg: [number, number, number];
  up: [number, number, number];
  fovYDeg: number;
  physicalDistance?: {
    value: number;
    unit: 'km' | 'au' | 'pc';
  };
  simulationTime: number;
  timeScale: number;
  paused: boolean;
}
```

M0–M8 only require `free/static` geometry as roadmap permits. Later modes may add typed substate; do not fake them as camera animations.

Validation:

- observer must remain outside the horizon for ordinary static/free controls unless a plunge backend explicitly owns inside-horizon behavior;
- FOV clamped to a usable range such as 15–110 degrees initially;
- camera target cannot produce a zero forward vector;
- `up` cannot be parallel to forward after normalization.

## 4. DiskState

```ts
interface DiskState {
  enabled: boolean;
  model: 'thin';
  innerRadiusRg: number;
  outerRadiusRg: number;
  normal: [number, number, number];
  emissivityIndex: number;
  temperatureModel: 'power-law' | 'thin-disk-approx';
  temperatureScale: number;
  densityScale: number;
  turbulence: number;
  seed: number;
  rotationEnabled: boolean;
}
```

Validation:

- `outerRadiusRg > innerRadiusRg`;
- scientific Schwarzschild default inner radius is at least `6` unless plunging emission is explicitly enabled;
- normal normalized;
- seed represented deterministically as integer;
- cinematic turbulence cannot change geodesic geometry.

## 5. RelativityState

```ts
interface RelativityState {
  lensing: boolean;
  gravitationalRedshift: boolean;
  dopplerShift: boolean;
  relativisticBeaming: boolean;
  higherOrderImages: boolean;
}
```

Scientific mode defaults these on where implemented. Toggles exist for education/debug comparisons; disabling a phenomenon must have mathematically defined behavior rather than altering unrelated shading.

`higherOrderImages` may initially be informational/quality-linked because true higher-order images naturally emerge from tracing. Do not implement it as an artist-painted ring toggle.

## 6. VisualState

```ts
interface VisualState {
  mode: 'scientific' | 'cinematic' | 'debug';
  exposureEv: number;
  toneMapping: 'neutral' | 'aces' | 'agx';
  bloomEnabled: boolean;
  bloomThreshold: number;
  bloomStrength: number;
  backgroundIntensity: number;
  cinematicDiskTint: number;
  starIntensity: number;
}
```

Exact tone-mapping options depend on supported current Three.js APIs at implementation time. Do not persist an option until implemented.

## 7. RenderingState

```ts
interface RenderingState {
  qualityMode: 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'custom';
  backendPreference: 'auto' | 'numerical' | 'lut';
  renderScale: number;
  maxEffectiveDpr: number;
  maxSteps: number;
  minStep: number;
  maxStep: number;
  integrationQuality: number;
  temporalEnabled: boolean;
  temporalTargetSamples: number;
  targetFps: 30 | 60 | 90 | 120;
  dynamicResolution: boolean;
}
```

Preset quality values are owned by `quality.ts`, not duplicated in UI.

Custom mode may expose advanced values only behind an Advanced/Developer panel to prevent ordinary users from creating pathological workloads accidentally.

## 8. DebugState

```ts
interface DebugState {
  overlay: boolean;
  renderView:
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
  selectedPixel?: [number, number];
  freezeTime: boolean;
  deterministicSeedOverride?: number;
  showTelemetry: boolean;
}
```

Debug state must not be included in public presets unless deliberately requested.

## 9. Runtime-only state

Keep transient runtime data separate from serializable AppState:

```ts
interface RuntimeState {
  revision: number;
  capabilities: RuntimeCapabilities;
  backendStatus: 'initializing' | 'ready' | 'lost' | 'recovering' | 'failed';
  interaction: {
    cameraMoving: boolean;
    lastInputTimeMs: number;
  };
  temporal: {
    historyRevision: number;
    sampleCount: number;
  };
  telemetry: TelemetrySnapshot;
}
```

Do not serialize GPU adapter strings, instantaneous FPS, resource handles, DOM elements, or Three.js objects into AppState.

## 10. Validation boundary

Implement a single `normalizeAppState(input, previous?)` or equivalent boundary. Responsibilities:

- schema validation;
- defaults for missing optional data;
- finite-number checks;
- range clamps;
- vector normalization;
- cross-field invariants;
- migration of older persisted schema;
- rejection of unknown dangerous values where appropriate.

Renderer receives only normalized state.

## 11. Revision and invalidation

After state normalization, compute change categories. Suggested bitmask:

```ts
enum Invalidation {
  None = 0,
  Post = 1 << 0,
  Radiance = 1 << 1,
  Geometry = 1 << 2,
  Camera = 1 << 3,
  Backend = 1 << 4,
}
```

Examples:

- exposure -> `Post`;
- disk temperature -> `Radiance`;
- disk inner radius -> `Geometry | Radiance`;
- camera orbit/FOV -> `Camera | Geometry`;
- mass in normalized mode with all distances in `r_g` -> potentially UI-only for geometry;
- switching numerical/LUT -> `Backend | Geometry`;
- integration steps -> `Geometry`.

Temporal history resets whenever a change invalidates the quantity accumulated.

## 12. Presets

Preset format:

```ts
interface Preset {
  id: string;
  name: string;
  description: string;
  schemaVersion: number;
  state: Partial<AppState>;
  tags: string[];
  expectedBackend?: string;
}
```

Built-in target presets eventually include:

- Schwarzschild face-on disk;
- Schwarzschild high inclination;
- photon-ring/critical lensing;
- no-disk star-field lensing;
- Doppler comparison;
- cinematic hero view;
- performance benchmark low/medium/high complexity;
- Kerr prograde high spin;
- Kerr retrograde;
- plunge observer.

Presets used by tests are versioned and should not be casually restyled.

## 13. URL/share serialization

Do not expose URL sharing until schema migration and input validation exist. When implemented:

- serialize only whitelisted user-facing fields;
- include schema version;
- use compact encoding only after correctness;
- enforce decoded size limits;
- clamp all numeric values;
- never execute code or treat strings as shader source;
- preserve a known-safe fallback if decode fails.

## 14. Physical distance mode

Mass changes must obey scale invariance correctly.

Normalized mode stores observer/disk distances in `r_g`. Changing `massSolar` changes displayed physical conversions and characteristic time scales but not normalized lensing geometry.

Physical mode stores at least observer distance in physical units. On state normalization, derive normalized distance using

`r_g = G M / c^2`.

The state/debug UI should display both physical and normalized values so behavior is transparent.

## 15. Derived values

Centralize derived selectors:

- gravitational radius in km;
- Schwarzschild radius;
- photon sphere radius;
- ISCO radius for active metric/spin;
- gravitational time `t_g = GM/c^3`;
- normalized observer distance;
- disk angular/physical scales;
- effective quality profile;
- temporal invalidation key.

Do not store easily derived values redundantly in persisted state because they can drift.

## 16. Test requirements

State tests cover:

- defaults produce a renderable valid state;
- NaN/Infinity rejected;
- negative/zero mass rejected;
- inner/outer disk order repaired or rejected deterministically;
- vector normalization;
- schema migration;
- normalized mass scale invariance;
- physical-mode conversion;
- invalidation classification for every control family;
- deterministic preset load;
- unknown schema version failure behavior.