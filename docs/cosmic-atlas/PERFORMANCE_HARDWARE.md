# Performance and hardware strategy

## 1. Performance objective

Cosmic Atlas must feel interactive on a broad range of modern hardware without assuming a discrete desktop GPU.

Performance policy is **adaptive fidelity**, not one fixed quality level.

Primary targets:

- 60 Hz target where sustainable: ~16.67 ms total frame budget;
- 30 Hz fallback target on constrained devices: ~33.33 ms;
- no long main-thread stalls during ordinary navigation;
- quality reduction before catastrophic frame collapse;
- no unbounded GPU-memory overlap during destination transitions.

## 2. Hardware tiers

Do not infer tier solely from user agent or device name. Start conservatively, inspect capabilities, and run a short representative benchmark.

Conceptual tiers:

### Tier 0 — unsupported/minimal

- no usable WebGPU/WebGL2 path for required destination;
- show capability explanation or reduced static/educational fallback.

### Tier 1 — constrained/mobile/integrated

- target 30–60 FPS depending scene;
- 0.5–0.8 internal render scale typical;
- low particle count;
- low volume steps;
- simplified post;
- reduced overlapping GPU resources during transitions.

### Tier 2 — mainstream integrated/discrete

- target 60 FPS interactive;
- 0.75–1.0 render scale;
- medium/high particle population;
- normal HDR/post;
- stationary quality refinement.

### Tier 3 — high-end discrete

- 1.0+ internal scale where useful;
- high volume steps/particles;
- more temporal refinement;
- optional advanced effects.

These are runtime policies, not marketing labels tied to exact GPU models.

## 3. Global quality state machine

Use one global state:

```text
INTERACTING
    ↓ user stops
SETTLING
    ↓ stable headroom
STABLE

TRANSITION is an orthogonal temporary mode.
```

### INTERACTING

- lower render scale;
- reduced volumetric samples;
- reduced ray quality where safe;
- lower tracer density if destination supports runtime LOD;
- temporal accumulation limited/reset;
- expensive stationary-only passes disabled.

### SETTLING

- gradually raise quality;
- rebuild temporal history;
- avoid sudden allocations.

### STABLE

- target quality tier;
- temporal refinement;
- higher ray/volume steps if frame budget allows.

### TRANSITION

- outgoing heavy simulation throttled/frozen;
- transition effect prioritized;
- target starts at minimum-ready quality;
- high-quality target assets deferred until arrival if needed.

## 4. Dynamic resolution controller

Track GPU time when timestamp queries are available; otherwise use robust total-frame metrics with CPU-awareness.

Recommended behavior:

- fast decrease after sustained over-budget frames;
- slow increase after sustained headroom;
- hysteresis to avoid oscillation;
- scale clamped by destination and device tier;
- resize only after threshold crossing, not every frame.

Example conceptual controller:

```text
if p90Gpu > budget * 1.08 for N frames:
  scale *= 0.90

if p90Gpu < budget * 0.72 for M>N frames:
  scale *= 1.04
```

Tune empirically; do not hard-code these exact values without benchmark evidence.

## 5. Device pixel ratio

Never blindly render at native `devicePixelRatio` on high-density screens.

Suggested effective DPR caps before runtime tuning:

- Low: 0.75–1.0;
- Medium: 1.0;
- High: 1.0–1.25;
- Ultra: 1.25–1.5.

The final internal resolution is a product of viewport, capped DPR, and dynamic render scale.

## 6. CPU/GPU division

### CPU/main thread

- UI;
- route/state transitions;
- destination orchestration;
- small analytic calculations;
- asset manifest management;
- command submission;
- validation/debug selected-ray probes.

### GPU raster/fragment

- black-hole/neutron-star per-pixel ray tracing;
- lensing lab image mapping;
- volume ray marching;
- bloom/tone mapping;
- hyperspace transition;
- full-screen compositing.

### GPU compute

Use when there is persistent parallel state:

- supernova ejecta particles;
- merger ejecta;
- galaxy tracer interpolation/update;
- jets;
- CME particles;
- field sampling;
- optional culling/compaction.

### Web Workers

Use for CPU work that would otherwise block UI:

- binary decoding/transforms;
- KTX2 transcoding as supported;
- scientific data preprocessing at runtime if unavoidable;
- CPU reference batches;
- optional procedural asset generation.

Do not move work into a Worker merely because it exists.

### WASM

Reserve for:

- high-precision reference calculations;
- heavy binary transforms with demonstrated benefit;
- algorithms well-suited to compiled CPU execution.

Do not use WASM as the main per-pixel renderer.

## 7. Particle architecture

Large systems use GPU buffers.

Avoid:

- one `Object3D` per star/ejecta particle;
- JavaScript loops updating 100k+ positions every frame;
- per-particle materials.

Preferred:

- `StorageBufferAttribute`/WebGPU storage where possible;
- instanced geometry;
- points/billboards;
- packed attributes;
- compute update;
- quality-dependent population;
- stable capacity buffers to avoid per-frame reallocations.

## 8. Volumetric architecture

Dense 3D textures get expensive rapidly.

Reference memory:

- `256^3 * RGBA32F` ≈ 256 MiB;
- `256^3 * RGBA16F` ≈ 128 MiB.

Therefore initial supernova/kilonova/corona/CME effects should favor procedural density or compact scalar textures.

Preferred volume pass:

```text
bounding-box intersection
→ half/quarter-resolution march
→ jittered/adaptive samples
→ early alpha termination
→ HDR volume target
→ depth-aware upscale/composite
```

Destination quality knobs:

- sample count;
- render resolution;
- shadow/self-absorption approximation;
- noise octaves;
- maximum distance;
- particle-volume balance.

## 9. LOD strategy by destination

### Black Hole / Neutron Star

- dynamic resolution;
- ray integration/LUT quality;
- optional simplified lensing when object occupies tiny screen area.

### Stellar Explosion

- particle population;
- volume steps;
- volume resolution;
- noise complexity.

### Compact Merger

- activate only phase-relevant systems;
- lower ejecta population outside merger/kilonova phases;
- disable jet pass when hidden/off-phase.

### Black-Hole Merger

- orbit/waveform interpolation is cheap;
- expensive lensing must have quality modes;
- data buffers should remain compact.

### TDE

- phase-dependent stream/particle count;
- distance-dependent black-hole quality;
- streamline/ribbon subdivision LOD.

### Quasar

Scale-zone LOD is mandatory:

- close: high inner GR, hide distant host detail;
- nuclear: reduced inner GR, torus/jet priority;
- galactic: central proxy, host/jet tracer priority.

### Galaxy Collision

- tracer count by quality;
- keyframe interpolation GPU-side;
- cull/fade tiny particles;
- separate gas/dust/star populations by importance.

## 10. Transition memory budget

During destination swap, peak memory includes some A + some B + shared + transition.

Budget policy:

```text
peak <= deviceTierBudget
```

Before B allocation:

1. estimate B minimum-ready bytes;
2. know A releasable bytes;
3. release nonessential A caches early if needed;
4. allocate B progressively;
5. postpone B high-quality assets until after A disposal.

Suggested soft planning budgets to validate empirically:

- constrained: <= ~256 MiB scene-local estimated GPU resources;
- mainstream: <= ~512 MiB;
- high: <= ~1 GiB.

These are app-owned estimates, not claims about physical VRAM availability.

## 11. Shader/pipeline warm-up

Avoid first-use hitches during arrival.

During `prepare()`:

- construct required materials/node graphs;
- compile/warm minimum-ready variants when APIs permit;
- decode/upload essential textures;
- create stable buffers;
- leave optional variants for later.

Keep shader variant explosion under control.

Define bounded combinations rather than compiling every numerical slider combination as a preprocessor variant.

## 12. Asset streaming

Priority classes:

1. destination metadata/UI;
2. essential scene assets;
3. minimum-ready scientific data;
4. arrival-quality assets;
5. optional Ultra assets.

Prefetch likely adjacent/hovered destination module code and compressed CPU/network assets, but do not fully allocate every destination on GPU.

## 13. Texture compression

Use KTX2/Basis for appropriate visual textures after quality validation.

Scientific scalar textures require error analysis before lossy compression/quantization.

## 14. Thermal/battery behavior

On sustained constrained/mobile operation:

- allow 30 FPS target;
- lower render scale;
- cap particle/volume quality;
- reduce stable-state overrendering;
- pause/minimize work when tab is hidden;
- avoid continuous background prefetch/decode;
- optionally expose Battery Saver quality preset.

## 15. Hidden-tab behavior

When `document.visibilityState` is hidden:

- stop animation loop or reduce to minimal housekeeping;
- pause expensive compute;
- suspend data-driven playback;
- cancel optional asset work if appropriate;
- reset frame-time controller on return.

## 16. Performance evidence

Every optimization PR after benchmark infrastructure exists must record:

- destination/preset;
- quality tier;
- viewport;
- internal resolution;
- backend;
- browser/version;
- GPU info when exposed;
- sample/warmup count;
- median/p95 frame time;
- GPU time if available;
- particle/volume/ray settings;
- memory estimate;
- before/after comparison.

No "faster" claim without matched evidence.