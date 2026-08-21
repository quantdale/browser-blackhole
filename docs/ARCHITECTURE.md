# Architecture

## 1. High-level design

```text
DOM controls / application state
             |
      Camera + observer
             |
       Render coordinator
             |
   +---------+----------+
   |                    |
Three.js WebGPU     fallback path
renderer / TSL       where viable
   |
full-screen ray pass
   |
HDR intermediate radiance
   |
temporal / bloom / tone mapping
   |
canvas
```

The black hole is not primarily a Three.js mesh. Primary image generation is one GPU invocation per pixel from a full-screen primitive. The shader reconstructs the camera ray and traces it backward through the selected spacetime until it is captured, intersects emitting matter, or escapes to the environment.

## 2. Proposed repository layout

Create directories only as their milestone needs them; this is the target, not a mandate to create empty files.

```text
src/
  app/
    App.ts
    state.ts
    presets.ts
    capability.ts
  camera/
    CameraController.ts
    observer.ts
  physics/
    units.ts
    schwarzschild.ts
    disk.ts
    redshift.ts
    reference/
  renderer/
    BlackHoleRenderer.ts
    RenderCoordinator.ts
    quality.ts
    telemetry.ts
    temporal.ts
    postprocessing.ts
  shaders/
    camera.ts
    geodesic.ts
    schwarzschild.ts
    disk.ts
    spectrum.ts
    stars.ts
    debug.ts
  ui/
    controls.ts
    panels.ts
    help.ts
  workers/
    # only if profiling justifies them
public/
  assets/
  luts/
tests/
  unit/
  physics/
  browser/
  visual/
  performance/
tools/
  generate-luts/
```

## 3. State model

Create one canonical immutable-ish application state object with explicit subtrees:

- `blackHole`
- `observer`
- `disk`
- `relativity`
- `visual`
- `rendering`
- `debug`

Normalize/clamp state at one boundary. UI widgets must not write arbitrary uniforms directly. The render coordinator maps validated state to shader uniforms/nodes. This prevents UI-specific units and shader units from drifting.

Presets are versioned state snapshots. Include a schema version before adding shareable URLs/storage.

## 3a. Canonical world frame

World handedness, axes, black-hole center placement, default disk normal,
and sky orientation are fixed in `docs/WORLD_FRAME.md` (implemented in
`src/physics/worldFrame.ts`); no module may independently reinterpret axes.

## 4. Unit system

Use geometric units for core formulas where useful. Recommended internal spatial unit is `r_g = GM/c^2` for the selected black hole. Keep user-facing conversions in `physics/units.ts`.

No UI module may independently define `G`, `c`, solar mass, horizon radius, photon sphere, or ISCO formulas.

## 5. Renderer lifecycle

`BlackHoleRenderer` owns:

- WebGPU/WebGL renderer creation;
- canvas sizing/internal render size;
- render targets;
- node/shader construction;
- post-processing;
- device-loss/error propagation;
- disposal.

`RenderCoordinator` owns:

- frame loop;
- interaction/motion detection;
- quality controller;
- temporal-history resets;
- camera/observer updates;
- telemetry sampling.

Keep application state independent of Three.js object lifetimes so tests can exercise it without a GPU.

## 6. Physics architecture

Use two implementations where useful:

1. **GPU production implementation** — f32-oriented, optimized for many rays.
2. **Reference implementation** — CPU TypeScript first; optionally Rust/WASM later for higher precision/speed.

The reference solver exists to validate selected rays, generate trusted fixtures/LUT data, and debug changes. It must not become a second real-time renderer.

## 7. Rendering backends

### Primary correctness backend

Numerical Schwarzschild null-geodesic integration in the full-screen GPU path.

### Optimized Schwarzschild backend

Precomputed ray/beam mapping textures inspired by Bruneton's real-time method. Add only after the numerical renderer is validated so lookup results can be compared against a known implementation.

### Kerr backend

Later numerical Kerr/Kerr-Schild ray integration. Treat this as a distinct backend sharing camera, environment, disk emission interfaces, post-processing, telemetry, and tests.

Do not force Schwarzschild and Kerr into one giant function full of branches if separate shader graphs/functions produce clearer optimized code.

## 8. Browser concurrency

Main thread initially owns DOM and rendering. Move work to Web Workers only when profiling demonstrates a CPU/main-thread bottleneck or when expensive reference/LUT generation would block interaction.

Potential worker workloads:

- CPU reference trajectory batches;
- LUT generation/preprocessing;
- procedural asset generation;
- optional OffscreenCanvas renderer experimentation.

WebGPU compute is a GPU execution model, not a replacement for Web Workers. Keep these concepts separate.

## 9. Error handling

Surface:

- WebGPU unavailable;
- adapter/device acquisition failure;
- required feature unavailable;
- shader/pipeline construction failure;
- device loss;
- asset/LUT validation failure;
- invalid preset/state.

A black/blank canvas with only a console error is never an acceptable failure mode.
