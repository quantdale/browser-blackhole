# Implementation playbook

This is the operational manual for turning the design documents into code. It is intentionally more prescriptive than `ROADMAP.md`. When there is tension between experimentation and a milestone exit gate, preserve the exit gate and record the experiment separately.

## 1. Core development loop

For every backlog item:

1. identify the owning milestone and acceptance criteria;
2. inspect the existing implementation and tests before editing;
3. state the invariant being added or changed;
4. implement the smallest coherent vertical slice;
5. add deterministic tests before or with the implementation;
6. run the narrow test first, then the milestone gate, then cumulative gates affected by the change;
7. capture browser/GPU evidence when the change touches rendering;
8. update durable state and backlog status;
9. commit a buildable checkpoint.

Do not accumulate a large unvalidated shader rewrite. GPU numerical code must be brought up through debug outputs and reference comparisons in small increments.

## 2. Bootstrap sequence (M0)

### 2.1 Toolchain discovery

Before generating files, resolve current compatible stable versions from primary package/documentation sources. Record exact versions in the first M0 checkpoint. Minimum candidates:

- Node.js active LTS;
- npm or pnpm: choose one package manager and lock it;
- Vite;
- TypeScript;
- Three.js;
- Vitest;
- Playwright;
- ESLint and Prettier, or an equivalently minimal lint/format stack.

Do not add React solely to create a control panel. The renderer does not require a UI framework. If a framework is introduced, document the concrete complexity it removes.

### 2.2 Required scripts

The initial `package.json` must expose stable commands that later agents may rely on:

- `dev`
- `build`
- `preview`
- `typecheck`
- `lint`
- `format`
- `format:check`
- `test`
- `test:watch`
- `test:browser`
- `test:visual` once visual baselines exist
- `bench` once performance harness exists
- `check` as the deterministic aggregate non-browser gate

Never redefine an established script to perform a substantially different operation without updating agent docs and CI in the same commit.

### 2.3 First render proof

The first frame is not a black hole. It is a deterministic diagnostic frame proving:

- renderer initialization;
- full-screen primitive coverage;
- camera uniform plumbing;
- normalized pixel coordinates;
- aspect ratio handling;
- resize handling;
- backend identification;
- frame loop stability.

Suggested diagnostic colors are derived from ray direction or normalized screen coordinates so a screenshot can reveal flipped axes, bad aspect ratio, or stale camera matrices.

### 2.4 Capability object

Create a serializable capability snapshot rather than scattering browser checks:

```ts
interface RuntimeCapabilities {
  backend: 'webgpu' | 'webgl2' | 'unsupported';
  webgpuAvailable: boolean;
  webgl2Available: boolean;
  adapterInfo?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  features: string[];
  limits: Record<string, number>;
  timestampQuery: boolean;
  offscreenCanvas: boolean;
  crossOriginIsolated: boolean;
}
```

Treat this as telemetry/debug data. Product behavior should use named capability predicates rather than vendor strings.

## 3. Renderer bring-up discipline

### 3.1 Build one full-screen pass first

Use a full-screen triangle or equivalent primitive. Avoid a two-triangle quad seam. The vertex stage should synthesize clip-space positions; the fragment/TSL graph reconstructs the camera ray.

### 3.2 Camera-ray verification before gravity

Verify:

- center pixel points along camera forward;
- image-right pixel has positive camera-right component;
- image-up pixel has positive camera-up component;
- FOV changes ray angular spread monotonically;
- aspect changes horizontal spread only as expected;
- orientation remains correct after resize and orbit interaction.

Do not add geodesics until these are deterministic.

### 3.3 Introduce physics as debug data first

Recommended progression:

1. Euclidean ray direction;
2. black-hole-centric initial state;
3. first integration step visualized;
4. step-count heatmap;
5. minimum-radius heatmap;
6. termination classification;
7. escaped sky sampling;
8. disk crossing;
9. radiometric shading.

A pretty output should be the consequence of validated intermediate quantities.

## 4. State-to-GPU flow

All control changes follow this path:

```text
DOM/control event
 -> parse
 -> normalize units
 -> validate/clamp
 -> canonical AppState update
 -> diff/revision classification
 -> renderer mapping
 -> uniforms/resources
 -> temporal-history policy
```

No DOM handler imports shader nodes merely to set a uniform.

Every state change must receive one of these invalidation classes:

- `NONE`: UI-only change;
- `POSTPROCESS`: physics radiance remains valid;
- `RADIANCE`: retrace/re-shade required;
- `GEOMETRY`: ray paths change;
- `CAMERA`: ray origins/directions change;
- `BACKEND`: render resources/pipeline rebuild required.

This classification becomes the basis for temporal accumulation invalidation and efficient updates.

## 5. Physics implementation order

### 5.1 Reference before optimization

For each physical feature:

1. define convention in `PHYSICS.md`/`NUMERICAL_METHODS.md`;
2. implement CPU reference calculation with readable variable names;
3. add fixtures/reference vectors;
4. implement GPU equivalent;
5. compare outputs;
6. only then optimize the GPU version.

Do not optimize a formula whose convention is still ambiguous.

### 5.2 Schwarzschild phases

Implement in this order:

- static observer tetrad and local camera photon direction;
- constants of motion / geodesic-plane basis;
- fixed-step integrator;
- capture and conservative escape;
- curved sky lensing;
- disk crossing;
- emitter four-velocity;
- frequency shift `g`;
- intensity transformation;
- adaptive integration;
- optimized LUT backend.

### 5.3 Kerr boundary

Kerr is a new physics backend, not `if (spin !== 0)` sprinkled through Schwarzschild code. Shared interfaces are allowed; equations and state evolution stay backend-specific.

## 6. Rendering quality modes

Quality presets must map to explicit numerical/render parameters, not vague labels. At minimum:

```ts
interface QualityProfile {
  renderScale: number;
  maxSteps: number;
  integrationTolerance: number;
  minStep: number;
  maxStep: number;
  temporalSamples: number;
  bloomEnabled: boolean;
  backendPreference: 'auto' | 'numerical' | 'lut';
}
```

Exact values are benchmarked and versioned later. `Auto` selects a profile and continuously controls render scale around a target frame budget.

## 7. Shader change checklist

For every material shader/geodesic change:

- compile under WebGPU primary backend;
- compile under required fallback path if the feature claims fallback support;
- run reference ray tests affected by the formula;
- inspect numerical-failure/debug classification;
- run at least one deterministic screenshot preset;
- check NaN/Inf instrumentation if available;
- compare frame-time before/after if loop count, texture sampling, or branches changed.

## 8. Resource lifecycle

Every GPU/Three.js resource has an owner. The owner is responsible for disposal during backend switch, renderer recreation, and teardown. Track at least:

- render targets;
- textures;
- materials/node materials;
- geometries;
- post-processing nodes/passes;
- buffers/storage resources;
- controls/event listeners.

A backend/device-loss recovery path must not leak the previous generation of resources.

## 9. Performance workflow

Optimization follows this order:

1. reproduce a measurable bottleneck;
2. capture baseline median and tail frame times;
3. classify CPU, GPU, transfer, compilation, memory, or synchronization cost;
4. make one architectural or micro-optimization;
5. re-run the same benchmark preset;
6. verify physics/visual regressions;
7. keep the optimization only with evidence.

Never report an optimization based only on source-code intuition.

## 10. Browser validation

At milestone boundaries test at least:

- Chromium/WebGPU primary path;
- forced WebGL2 fallback where supported by the implemented feature set;
- one high-DPR viewport;
- one mobile-sized viewport;
- resize/orientation change behavior;
- hidden/visible tab transition;
- device/backend failure UI through injected test hooks where real device loss is impractical.

Later release gates extend the matrix.

## 11. Determinism controls

Tests and golden images require deterministic inputs:

- fixed star/procedural noise seeds;
- fixed simulation time or explicit time override;
- fixed viewport and render scale;
- fixed camera pose/FOV;
- fixed quality profile;
- temporal history reset and exact sample count;
- cinematic randomness disabled.

Expose deterministic test hooks only through a documented development/test interface; do not let test state silently affect production defaults.

## 12. Milestone completion definition

A milestone is complete only when:

- all required deliverables exist;
- acceptance tests pass;
- cumulative quality gates pass or a documented environment-only gate is explicitly deferred;
- relevant screenshots/benchmarks are stored or referenced;
- no Critical/High known defect remains in the milestone scope;
- `.agent/STATE.md` names the next milestone and exact next work packets;
- repository is clean after commit.

A visually impressive demo with failed reference physics is not a completed physics milestone.