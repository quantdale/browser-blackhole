# Failure, recovery, and diagnostic behavior

A GPU-heavy scientific renderer will encounter unsupported browsers, device loss, shader failures, invalid states, numerical failures, and asset errors. Every failure mode must terminate into a known state instead of a blank canvas.

## 1. Failure taxonomy

### Environment

- insecure context blocks WebGPU;
- WebGPU API absent;
- adapter unavailable;
- device request failure;
- WebGL2 fallback unavailable;
- required texture/limit unsupported.

### GPU lifecycle

- pipeline/shader creation error;
- device lost;
- context configuration failure;
- render target allocation failure;
- out-of-memory-like behavior;
- backend recreation failure.

### Physics/numerics

- invalid initial observer state;
- non-finite ray state;
- max steps;
- integration constraint blow-up;
- disk crossing refinement failure;
- unsupported inside-horizon observer.

### Data/assets

- environment texture missing/corrupt;
- LUT missing;
- LUT checksum/schema mismatch;
- preset decode/version failure.

### Application

- uncaught exception/rejection;
- duplicate render loop;
- stale temporal history after incompatible state change;
- invalid persisted state.

## 2. Runtime status machine

Use an explicit lifecycle:

```text
BOOT
 -> CAPABILITY_CHECK
 -> INITIALIZING
 -> READY

INITIALIZING -> FALLBACK_INITIALIZING -> READY
INITIALIZING -> FAILED
READY -> DEVICE_LOST -> RECOVERING -> READY
RECOVERING -> FAILED
READY -> DEGRADED (optional feature disabled)
```

Expose status to UI and tests.

## 3. User-facing error principles

Messages state:

- what failed;
- whether the app can continue;
- active fallback/degraded mode;
- one useful remediation where appropriate.

Do not dump WGSL/stack traces into ordinary UI. Provide expandable technical details in debug/development mode.

## 4. WebGPU unavailable

Attempt documented fallback only if the implemented renderer feature is compatible with the Three.js WebGL2 backend. If not:

- show unsupported/degraded message;
- explain that WebGPU is required for the selected feature;
- allow switching to a compatible backend/preset where possible.

Never silently disable physics and show an artistic fake while labeling it Scientific.

## 5. Device-loss recovery

On device loss:

1. stop submitting frames from the old generation;
2. mark runtime `DEVICE_LOST`;
3. cancel/ignore pending async work tied to old generation;
4. dispose/release application-owned Three.js/GPU resources as appropriate;
5. reset temporal history;
6. reacquire adapter/device/renderer with bounded retries or one explicit retry sequence;
7. rebuild resources from canonical AppState, not stale GPU objects;
8. resume a single frame loop;
9. surface terminal error if recovery fails.

Use a monotonically increasing renderer generation ID so late async callbacks from an older generation cannot mutate current state.

## 6. Shader/pipeline errors

Development mode should collect generated shader diagnostics where APIs allow. Production behavior:

- fail renderer initialization/variant switch visibly;
- preserve last known good frame only if clearly marked stale/degraded;
- offer compatible backend/profile switch if possible;
- never spin in a per-frame compilation failure loop.

## 7. Numerical failure rendering

Scientific/debug pipeline preserves explicit classifications. Production final image may choose a diagnostic color/pattern or controlled neutral representation, but telemetry/debug UI must expose count/location when failures occur.

A numerical failure is not the black-hole shadow.

## 8. Failure-rate threshold

Once aggregate diagnostics exist, define quality acceptance by a maximum numerical-failure fraction outside intentionally excluded near-critical stress presets. Any sudden increase is a regression even if most pixels still look good.

## 9. LUT failure

Validate manifest before binding:

- schema version;
- dimensions/format;
- physics convention;
- checksum;
- supported renderer version/domain.

If invalid:

- reject LUT;
- fall back to numerical Schwarzschild if available;
- report degraded reason;
- never sample partially loaded/corrupt tables.

## 10. Asset failure

Background/environment failure should degrade to deterministic procedural fallback, not break physics rendering. Disk textures/noise should also have procedural/default fallback where practical.

External runtime dependencies should be minimized; production assets should normally ship with the app.

## 11. Preset/state recovery

If persisted/shared state cannot validate:

- preserve original payload only for debug reporting if safe;
- load known-safe default preset;
- display non-fatal notice;
- do not partially apply invalid values.

Unknown future schema versions should fail closed rather than guessing migration.

## 12. Duplicate-loop defense

Renderer lifecycle must guarantee one animation loop per active generation. Tests should initialize/dispose/reinitialize and verify frame callbacks do not multiply.

## 13. Visibility/background behavior

On hidden tab:

- pause or reduce expensive rendering;
- avoid building large temporal histories;
- preserve canonical simulation state.

On return:

- reset timing estimator;
- evaluate whether simulation time requires history invalidation;
- resume one active loop.

## 14. Context/resize edge cases

Handle zero-size/hidden canvas containers without allocating zero/invalid textures. Defer resize until positive dimensions exist.

Clamp internal dimensions to renderer/device limits and surface if requested size is reduced.

## 15. Memory pressure strategy

If resource allocation fails or device reports loss around heavy settings:

- release optional debug MRTs/history;
- lower render scale/quality;
- retry in a bounded degraded configuration;
- avoid repeated high-quality reallocation loops.

## 16. Diagnostic bundle

Development `Export diagnostics` may eventually generate a non-sensitive JSON bundle containing:

- app version/commit;
- browser/backend;
- exposed adapter info/features/limits;
- canonical state minus unnecessary user data;
- runtime status;
- recent error codes/messages;
- telemetry summary;
- active preset/quality;
- renderer generation.

Do not include browsing history, arbitrary URLs, or fingerprinting data beyond what is required for debugging.

## 17. Error codes

Use stable machine-readable codes, for example:

- `ENV_WEBGPU_UNAVAILABLE`
- `ENV_WEBGL2_UNAVAILABLE`
- `GPU_ADAPTER_FAILED`
- `GPU_DEVICE_FAILED`
- `GPU_DEVICE_LOST`
- `GPU_PIPELINE_FAILED`
- `ASSET_LUT_INVALID`
- `ASSET_ENVIRONMENT_FAILED`
- `STATE_INVALID`
- `PHYSICS_NUMERICAL_FAILURE`
- `PHYSICS_UNSUPPORTED_OBSERVER`

UI text can evolve while codes remain testable.

## 18. Recovery tests

Automated scenarios:

- synthetic WebGPU absence;
- fallback selection;
- synthetic device loss and successful recovery;
- repeated recovery failure;
- invalid preset;
- invalid LUT;
- zero-sized container then resize;
- page hidden/resumed;
- renderer dispose/recreate;
- intentionally tiny max-steps producing visible numerical failures.

## 19. No-background-work assumption

All app behavior occurs in active browser execution. Do not design correctness around a server or hidden background process unless later product requirements explicitly add one.

## 20. Incident rule

If an optimization causes intermittent blank/NaN frames that cannot be deterministically explained, disable/revert the optimization before continuing feature work. Rendering correctness failures are blocking debt.