# Shader and GPU contracts

This document defines the interfaces between application state, renderer code, TSL shader modules, and debug/validation tooling. These contracts should stay small and explicit even if Three.js node APIs evolve.

## 1. Design principles

- TSL/WGSL/GLSL implementation details must not leak into DOM code.
- Physics functions are pure where practical.
- Uniform names and units are centralized.
- Backend-specific optimizations sit behind feature/capability guards.
- Debug outputs are first-class and deterministic.
- Shader modules are organized by physical responsibility, not by arbitrary file size.

## 2. Canonical GPU parameter groups

### Camera block

```ts
interface CameraGpuParams {
  cameraPositionRg: Vec3;
  cameraRight: Vec3;
  cameraUp: Vec3;
  cameraForward: Vec3;
  tanHalfFovY: number;
  aspect: number;
  nearObserverEpsilon: number;
}
```

Use an orthonormal camera basis. Do not reconstruct from DOM angles inside the shader.

### Black-hole block

```ts
interface BlackHoleGpuParams {
  centerRg: Vec3;
  massGeometric: number; // normally 1 in normalized solver
  horizonRadiusRg: number;
  spinDimensionless: number;
  spinAxis: Vec3;
  backendId: number;
}
```

For Schwarzschild normalized mode, `massGeometric=1` and horizon radius is `2`. Physical mass remains CPU/UI metadata unless physical-distance mode changes normalized coordinates.

### Disk block

```ts
interface DiskGpuParams {
  normal: Vec3;
  innerRadiusRg: number;
  outerRadiusRg: number;
  emissivityIndex: number;
  temperatureScale: number;
  densityScale: number;
  seed: number;
  time: number;
}
```

### Integrator block

```ts
interface IntegratorGpuParams {
  maxSteps: number;
  baseStep: number;
  minStep: number;
  maxStep: number;
  escapeRadiusRg: number;
  captureEpsilon: number;
  diskCrossingTolerance: number;
  qualityParameter: number;
}
```

### Visual/post block

```ts
interface VisualGpuParams {
  exposure: number;
  bloomThreshold: number;
  bloomStrength: number;
  backgroundIntensity: number;
  cinematicMix: number;
}
```

Keep post-process controls out of geodesic equations.

## 3. Camera ray function

Conceptual contract:

```ts
makeCameraRay(pixelNdc, cameraParams) -> {
  originRg: vec3,
  localDirection: vec3,
  worldDirection: vec3
}
```

Requirements:

- returned directions normalized within f32 tolerance;
- center pixel aligns with `cameraForward`;
- NDC convention documented once;
- no dependence on render target history;
- deterministic for the same camera and pixel.

## 4. Schwarzschild initial-state function

```ts
initSchwarzschildRay(originRg, worldDirection, bhParams) -> SchwarzschildRayState
```

State should contain only quantities required by the selected integrator plus reconstruction basis:

```ts
interface SchwarzschildRayState {
  r: float;
  phi: float;
  pr: float;
  energy: float;
  angularMomentum: float;
  basisRadial0: vec3;
  basisTangent0: vec3;
  radialSpecialCase: bool;
}
```

If TSL struct support is used, keep an equivalent TypeScript definition/documentation for CPU comparison.

## 5. Integrator step contract

```text
stepSchwarzschild(state, h) -> newState
```

It must not shade, sample textures, or consult UI mode. One step evolves geometry only.

If adaptive stepping is added, separate:

- `estimateStep(state, quality)`;
- `integrateStep(state, h)`.

This makes the policy testable independently from equations.

## 6. Event/classification contract

Use stable integer codes suitable for debug render targets:

- `0 = ACTIVE`
- `1 = CAPTURED`
- `2 = ESCAPED`
- `3 = DISK_HIT`
- `4 = MAX_STEPS`
- `5 = NON_FINITE`
- `6 = INVALID_INITIAL_STATE`

Application-facing logic may combine 4–6 into `NUMERICAL_FAILURE`, but debug mode preserves the specific reason.

Do not renumber codes casually because screenshot/debug tooling may depend on them.

## 7. Ray trace function

Conceptual contract:

```ts
traceSchwarzschild(ray, bh, disk, integrator) -> TraceResult
```

`TraceResult` must provide enough information for shading without rerunning trajectory geometry:

- termination code;
- hit radius/position if disk hit;
- escaped direction if escaped;
- minimum radius;
- step count;
- winding estimate;
- optional redshift inputs/constants of motion.

## 8. Disk intersection contract

```ts
refineDiskCrossing(segmentStart, segmentEnd, disk) -> DiskHit | null
```

The refinement implementation must be bounded. It cannot contain an uncontrolled while loop in a fragment shader. Define maximum refinement iterations in the quality profile.

## 9. Environment sampling

```ts
sampleEnvironment(direction, environmentParams) -> linearRadianceRGB
```

Input is a normalized escaped direction in the canonical world frame. Output is linear HDR radiance before exposure/tone mapping.

Procedural stars must be deterministic under a fixed seed. If an HDR cubemap is later used, its color space and orientation must be documented and tested.

## 10. Disk emission contract

Split geometry and radiation:

```ts
sampleDiskEmission(hit, photonConstants, diskState) -> EmittedRadiance
applyFrequencyShift(emitted, g) -> ObservedRadiance
```

`sampleDiskEmission` computes local emitter-frame output. `applyFrequencyShift` implements the documented radiometric transformation. Cinematic tint is not part of either function.

## 11. Post-processing input/output

Primary ray pass output must be linear HDR. Suggested MRT/debug architecture later:

- `radiance`: RGBA16F or renderer-equivalent half-float;
- `classification`: compact integer/normalized channel if supported;
- `stepCount`: normalized/float diagnostic;
- `motion/history metadata`: only when temporal reprojection requires it.

Avoid writing every possible diagnostic MRT in production mode because bandwidth can dominate.

## 12. Debug render modes

Stable debug enum:

1. final radiance;
2. classification;
3. step count;
4. minimum radius;
5. winding count/angle;
6. disk hit order;
7. redshift factor `g`;
8. escape direction;
9. constraint/error proxy;
10. temporal history age;
11. dynamic render scale/tile quality where applicable.

Debug views must bypass bloom/tone styling that would obscure data unless the view explicitly tests post-processing.

## 13. Loop bounds

GPU loops require statically/bounded maximum work suitable for all supported backends. `maxSteps` may control early exit within a compile-time or generated upper bound if required by the backend/compiler.

Do not introduce a quality slider capable of requesting unbounded iterations.

## 14. Non-finite guards

At strategic boundaries detect impossible state. TSL/backend support may constrain direct `isfinite` usage; if so use bounded magnitude/NaN checks appropriate to generated shader code. Any invalid state maps to explicit numerical-failure code.

Guard especially:

- division by `f` near horizon;
- near-zero plane tangent normalization;
- square roots due to roundoff;
- Planck/exponential approximations;
- temporal normalization weights.

## 15. Uniform update frequency

Classify GPU parameters:

- per-frame: time, camera basis, temporal jitter;
- on interaction/state change: black-hole, disk, quality, visual values;
- static/resource creation: backend capability, LUT dimensions, texture bindings.

Avoid rebuilding node graphs/pipelines for ordinary slider changes. Prefer uniforms when the value is truly dynamic.

## 16. Shader variant strategy

Use a small number of intentional variants:

- Schwarzschild numerical;
- Schwarzschild LUT;
- Kerr numerical;
- fallback/simple artistic path if explicitly supported.

Feature flags that materially change loop structure or resource bindings may deserve variants. Minor scalar/toggle changes should remain data-driven where branch cost is acceptable.

## 17. TSL isolation layer

Because TSL APIs can evolve, keep direct TSL construction concentrated in `src/shaders/` and renderer assembly. Physics TypeScript modules should expose formulas/reference functions without importing Three.js nodes.

This allows upgrading Three.js without rewriting scientific test code.

## 18. Compute contracts

Compute is optional and must justify itself. Candidate compute kernels have explicit buffer contracts, e.g.:

```ts
interface TileClassification {
  difficulty: number;
  expectedSteps: number;
  criticality: number;
}
```

Any compute-created resource has a raster fallback or the feature is marked WebGPU-only. Do not accidentally promise WebGL2 parity for storage-buffer/compute-dependent features.

## 19. LUT resource contract

Every LUT asset requires metadata:

```ts
interface LutManifest {
  schemaVersion: number;
  generatorVersion: string;
  physicsConvention: string;
  dimensions: number[];
  format: string;
  domain: Record<string, [number, number]>;
  checksum: string;
  referenceCommit: string;
  errorSummary: Record<string, number>;
}
```

Renderer must reject incompatible schema/convention rather than sample a plausible but wrong table.

## 20. Selected-pixel probe

Implement a development/debug probe that traces a chosen pixel through the CPU reference solver and, where feasible, reads/derives comparable GPU diagnostics. This is one of the fastest ways to debug a visual discrepancy without inspecting millions of pixels.

A probe report should include camera ray, constants of motion, classification, min radius, winding, disk hit, escape direction, step count, and redshift inputs.