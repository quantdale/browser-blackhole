# Performance budgets and adaptive-quality specification

Performance is a product requirement, not a late optimization phase. These budgets define what must be measured and how the renderer should degrade under load without silently changing scientific meaning.

## 1. Primary performance metric

Use frame time, not FPS alone.

Nominal budgets:

- 60 Hz target: `16.67 ms/frame`;
- 30 Hz fallback: `33.33 ms/frame`;
- 90 Hz optional: `11.11 ms/frame`;
- 120 Hz optional: `8.33 ms/frame`.

The renderer should reserve CPU/UI headroom rather than consuming the entire interval with GPU work. Initial Auto target for 60 Hz should aim for a median GPU render cost below roughly 13–14 ms on supported timestamp-query hardware, leaving scheduling/composition margin. Tune empirically.

## 2. Required telemetry

Per frame or rolling window capture:

```ts
interface TelemetrySnapshot {
  frameCpuMs: number;
  frameGpuMs?: number;
  fps: number;
  renderScale: number;
  effectiveWidth: number;
  effectiveHeight: number;
  effectiveDpr: number;
  qualityProfile: string;
  backend: string;
  temporalSamples: number;
  frameIndex: number;
  interactionState: 'moving' | 'settling' | 'stationary';
}
```

Development/debug builds should additionally expose selected-pixel step count and optional aggregate diagnostics if obtaining them does not perturb production timings materially.

## 3. Measurement hygiene

Benchmark rules:

1. warm shader pipelines before measuring;
2. discard startup/compilation frames;
3. use a fixed preset, viewport, render scale, backend, and simulation time;
4. collect at least 120 steady-state frames for quick comparisons and more for release baselines;
5. report median, p90, p95, and p99 frame time;
6. record browser/version, OS, adapter info, power mode when known, and whether the tab was foreground;
7. separate CPU wall-frame time from GPU timestamp time when available;
8. never compare two runs with different internal pixel counts without stating that change.

## 4. Pixel-cost model

The ray pass scales approximately with

`cost ~ pixelCount * averageRayWork + postprocessCost`.

Pixel count is

`floor(cssWidth * effectiveDpr * renderScale) * floor(cssHeight * effectiveDpr * renderScale)`.

This is why uncontrolled native DPR is forbidden. A 3x DPR has nine times the pixels of 1x at the same CSS size.

## 5. Effective DPR policy

Initial policy bounds, subject to benchmarks:

- Low: max effective DPR ~0.75;
- Medium: ~1.0;
- High: ~1.25;
- Ultra: ~1.5;
- Auto: starts conservatively then adapts.

These are caps, not promises; actual device/CSS dimensions and renderer limits still apply.

Do not render a 3x mobile panel at native DPR merely because `window.devicePixelRatio` reports 3.

## 6. Dynamic-resolution controller

Use a bounded feedback controller with hysteresis.

Suggested state:

```ts
interface DynamicResolutionState {
  currentScale: number;
  targetFrameMs: number;
  minScale: number;
  maxScale: number;
  downThresholdMs: number;
  upThresholdMs: number;
  consecutiveSlowFrames: number;
  consecutiveFastFrames: number;
  cooldownFrames: number;
}
```

Behavior:

- react faster to overload than to spare capacity;
- require multiple slow frames before lowering scale;
- require many more fast frames before raising scale;
- change scale in small bounded increments;
- impose cooldown after a change;
- reset/reclassify temporal history when resolution changes;
- ignore known compilation/loading spikes.

The controller must not oscillate between two scales every few frames.

## 7. Interaction quality states

Define three rendering states:

### Moving

Camera/control input active or changed recently.

Priorities:

- low latency;
- reduced internal resolution;
- bounded ray work;
- minimal temporal accumulation;
- bloom may remain if cheap enough.

### Settling

Input stopped recently.

Priorities:

- raise quality gradually;
- rebuild temporal history;
- avoid one large frame-time spike.

### Stationary

Camera/state stable.

Priorities:

- progressively refine temporal samples;
- allow higher render scale if budget permits;
- maximize ring/disk detail while maintaining responsiveness to new input.

## 8. Ray-step budgets

Do not choose one universal `maxSteps` now. Establish ranges empirically from the numerical renderer. Quality profiles must expose explicit limits and failure rate.

For each benchmark record:

- configured max steps;
- representative selected-pixel steps;
- fraction of numerical failures/max-step pixels if instrumentation supports aggregate measurement;
- image/reference error.

A faster profile that converts difficult rays into `MAX_STEPS` is not acceptable unless those failures are bounded, visible in debug mode, and within a documented lower-quality behavior policy.

## 9. Adaptive-step goals

Optimization target is not merely fewer steps. It is fewer integration evaluations for equal observable error.

Measure against fixed-step reference on:

- weak-field rays;
- typical disk rays;
- turning-point rays;
- near-critical rays;
- disk-grazing rays.

Any heuristic step controller must include clamps preventing large leaps over the horizon or disk plane.

## 10. Early-escape budget

Choose `escapeRadius` from error evidence. Build a test sweeping escape radius and comparing escaped direction to a much larger-radius reference. Select the smallest radius satisfying angular tolerance for each quality tier.

This optimization can save substantial work for background pixels and must be treated as a physics approximation with measured error.

## 11. Branch divergence strategy

Divergence is expected because neighboring rays may capture, escape, hit disk, or orbit near the photon sphere.

Preferred mitigations, in order:

1. early termination with bounded loop;
2. adaptive quality by global render scale;
3. optimized LUT backend;
4. optional tile/difficulty classification if profiling proves useful;
5. specialized critical-region techniques only with validation.

Do not contort readable physics code into branchless arithmetic without profiling evidence.

## 12. Post-processing budget

Track ray pass and post-process costs separately where possible. Bloom/tone mapping must not obscure that the geodesic pass is the dominant physics workload.

Post-processing may use Three.js WebGPU node composition/MRT where supported. Favor fused/reduced passes if current Three.js APIs provide them and visual results remain equivalent.

## 13. Memory budget

Estimate all render targets before adding them.

Example RGBA16F approximate color storage is 8 bytes/pixel before padding/implementation details. At 1920x1080 this is ~16.6 MB for one surface. Multiple history/MRT targets multiply cost quickly.

Record approximate GPU target memory for:

- primary HDR radiance;
- bloom chain;
- temporal history buffers;
- diagnostics/MRT;
- LUT textures;
- environment textures.

Debug-only targets should not remain allocated in production mode without need.

## 14. Temporal budget

Temporal accumulation aims to trade time for quality, not to increase per-frame work uncontrollably.

Track:

- current history sample count;
- history validity key/revision;
- rejection/reset rate;
- convergence metric for deterministic presets;
- ghosting cases after camera/state changes.

Maximum stationary accumulation should be bounded and quality-profile driven.

## 15. Startup budget

Measure separately:

- JS bundle load/parse;
- renderer initialization;
- adapter/device acquisition;
- first pipeline compilation;
- asset/LUT fetch/decode;
- first visible frame;
- first interactive frame.

Show a useful initialization/error state instead of blank canvas. Avoid generating expensive LUTs at startup for normal users.

## 16. Quality profile acceptance

Each named profile eventually gets a table containing:

- render scale range;
- DPR cap;
- max steps;
- step policy;
- escape radius;
- temporal policy;
- post-process options;
- target class of device;
- reference-error summary;
- benchmark summary.

No profile is considered stable until both image/physics and performance data exist.

## 17. Auto-quality bootstrap

At startup:

1. inspect capabilities;
2. choose a conservative profile from limits/features, not vendor marketing names;
3. render representative frames;
4. allow dynamic controller to settle;
5. cache only non-sensitive local preference if persistence is later added, not assumed hardware capability forever.

Do not maintain a giant hardcoded GPU blacklist/whitelist unless actual compatibility bugs justify it.

## 18. Mobile/thermal behavior

Long-running GPU-heavy browser rendering can throttle. Auto mode should respond to sustained frame-time degradation rather than assuming initial benchmark remains valid.

On visibility changes:

- pause or heavily reduce rendering while hidden;
- reset timing histories on resume;
- do not interpret background-tab throttling as GPU weakness;
- rebuild temporal history if simulation time advanced materially.

## 19. Performance regression gate

A PR touching the renderer loop, geodesic integration, render target count, environment sampling, temporal pass, or postprocess must include benchmark evidence once the benchmark harness exists.

Flag a regression when median/p95 worsens beyond an agreed threshold under the same deterministic benchmark. Early in the project use a reporting gate; after baselines stabilize make major regressions blocking.

## 20. Optimization stop rule

Stop optimizing a component when:

- it meets its frame-time budget on target hardware;
- remaining error/quality work is more valuable;
- additional speed would substantially complicate correctness without user-visible benefit.

The project is a scientific visualizer, not a benchmark competition.