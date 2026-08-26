# Observability and diagnostics

Observability in this project means local engineering visibility into renderer state, numerical health, and performance. It does not imply remote analytics.

## 1. Objectives

An engineer should be able to answer:

- Which backend is active?
- What internal resolution is actually rendered?
- Is the camera moving or stationary?
- Why was temporal history reset?
- How expensive is the frame on CPU/GPU?
- Did a selected ray capture, escape, hit disk, or fail numerically?
- What were its key conserved/diagnostic quantities?
- Is device recovery happening?
- Which quality controller decision changed render scale?

## 2. Runtime status snapshot

```ts
interface RuntimeDiagnostics {
  appVersion: string;
  commit?: string;
  backend: string;
  rendererGeneration: number;
  status: string;
  internalSize: [number, number];
  cssSize: [number, number];
  effectiveDpr: number;
  renderScale: number;
  qualityProfile: string;
  frame: TelemetrySnapshot;
  temporal: {
    sampleCount: number;
    historyRevision: number;
    lastResetReason?: string;
  };
  lastError?: {
    code: string;
    message: string;
  };
}
```

## 3. Logging levels

- `debug`: state revisions, quality decisions, probe details;
- `info`: backend init/recovery, preset load, major mode changes;
- `warn`: fallback/degraded capability, recoverable asset issue, elevated numerical failures;
- `error`: renderer initialization failure, device-loss terminal failure, invalid critical resource.

Production console should not spam per-frame logs.

## 4. Structured events

Internal event names may include:

- `renderer:init:start/success/failure`;
- `renderer:device-lost`;
- `renderer:recover:start/success/failure`;
- `quality:scale-change`;
- `quality:profile-change`;
- `temporal:reset`;
- `state:normalized`;
- `preset:loaded`;
- `asset:lut-rejected`;
- `physics:probe`.

Events are local and may feed an in-memory debug ring buffer.

## 5. Ring buffer

Keep the last N significant diagnostic events (e.g. 100–500) in development/debug mode. On failure, include them in optional diagnostic export. Bound memory.

## 6. Frame telemetry smoothing

Display rolling median/EMA values for user readability, but benchmark harness stores raw samples. Do not use one smoothed display number as regression evidence.

## 7. GPU timing

If timestamp-query capability is exposed and supported through current Three.js/backend APIs, measure key passes without forcing synchronizing readback every frame. Sample at a lower rate if necessary.

Fallback when unavailable: CPU wall timing clearly labeled as such.

## 8. Numerical debug channels

At minimum preserve:

- classification;
- step count;
- min radius;
- winding;
- disk hit radius/order;
- redshift factor;
- numerical-failure reason.

Do not keep all channels as permanent full-resolution MRTs unless profiling shows acceptable cost. Generate on demand in Debug mode or selected-pixel probe.

### 8.1 Per-ray classification views (M11)

Two URL-gated full-frame classification views exist for debugging and the
device/numerical suites (both render the production shader, never a fake
path):

- `?lutdebug` — Schwarzschild LUT pass per-pixel terminal class: LUT-escaped
  cyan, LUT-captured black, numerical-resolved orange, failure magenta.
- `?kerrstatus` — Kerr pass per-pixel terminal class (M11): escaped cyan,
  captured black, max-steps orange, non-finite split by reason
  (theta-wrap red, pole-passage yellow, other magenta),
  invalid-initial-state dim magenta. The pole-passage class is the
  documented ADR §1.19 f32 honesty gate, not a defect.

## 9. Selected-pixel probe report

Example:

```text
Pixel: 640,360
Camera ray: ...
Observer r: ...
E/L/b: ...
CPU classification: ESCAPED
GPU classification: ESCAPED
CPU min r: ...
GPU min r: ...
Angular error: ...
Steps: ...
Winding: ...
Disk hit: none
Constraint residual: ...
```

This report should be copyable/exportable in development.

## 10. Quality-controller trace

When render scale changes, record:

- prior/new scale;
- rolling frame metric;
- target;
- slow/fast counters;
- interaction state;
- cooldown;
- timestamp.

This makes oscillation bugs diagnosable.

## 11. Temporal trace

Each reset has stable reason enum:

- `CAMERA_CHANGED`
- `GEOMETRY_CHANGED`
- `RADIANCE_CHANGED`
- `BACKEND_CHANGED`
- `RESOLUTION_CHANGED`
- `TIME_DISCONTINUITY`
- `DEVICE_RECOVERED`
- `MANUAL_DEBUG_RESET`

Avoid “history randomly reset” behavior.

## 12. Asset diagnostics

Expose loaded environment/LUT versions and checksum status. Debug UI should make it obvious when numerical fallback is active because LUT rejected.

## 13. Error overlay

Development fatal overlay includes:

- stable error code;
- stage;
- backend;
- technical message;
- relevant capability summary;
- recovery attempted?;
- link/instruction to copy diagnostics.

Production version is shorter but keeps code/details expandable.

## 14. Test integration

Playwright smoke can query runtime diagnostics to wait for `READY` rather than arbitrary sleeps. Visual tests wait for deterministic temporal sample count/stable frame.

## 15. No remote telemetry by default

Do not add Sentry/analytics/remote logs as an incidental dependency. If future product requirements add telemetry, create a separate privacy/design decision and opt-in/collection schema.