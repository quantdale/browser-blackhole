# Spatial Cosmic Atlas V2 — Research Basis

**Research date:** 2026-08-28  
**Purpose:** record the technical evidence and external design patterns used to derive the Spatial Atlas master plan.

---

# 1. Linked Stellamap implementation notes

The linked Three.js Reddit post, published 2026-08-28, describes the live Stellamap architecture in unusually useful detail.

Key findings:

- The author reports approximately nine orders of magnitude inside the solar-system scene.
- The selected/focused object is pinned to the origin.
- Position subtraction is performed in JavaScript double precision before values reach float32 rendering.
- A logarithmic depth buffer is used on desktop.
- Near and far clip planes are recalculated dynamically.
- Distant objects receive locator reticles with approximately stable angular size.
- The marker fades when the real body becomes large enough on screen.
- Close child objects can fold into the parent marker instead of stacking markers.
- Planets use real radii/orbits; spacecraft must be visually exaggerated because they are otherwise invisible.
- Planet positions are based on JPL approximate positions; deep-space spacecraft use Horizons data.
- Camera focus is encoded in the URL.
- Mobile uses a reduced visual profile.
- Asset work reduced the initial load through image compression and code splitting.

Conclusions for Browser Blackhole:

1. Focus-relative rendering is proven practical for large Three.js scenes.
2. Locator markers are not optional polish; they are core navigation infrastructure.
3. Visual exaggeration should be an explicit display layer, not corruption of physical metadata.
4. URL-addressable focus belongs in the product model.
5. Mobile must have a deliberate quality profile.
6. The exact depth-buffer technique should not be copied blindly because Browser Blackhole has a different renderer/back-end contract.

---

# 2. WGSL / WebGPU numeric precision

Current WGSL defines concrete runtime `f32` and optionally `f16` floating types. `f32` is IEEE-754 binary32 with a 23-bit trailing significand.

Architectural consequence:

- GPU code cannot be treated as a general binary64 astronomical coordinate calculator.
- Absolute megaparsec-scale coordinates plus kilometer-scale local offsets will eventually lose useful local precision in f32.
- CPU-side binary64 reference transforms and relative coordinate upload are the appropriate default.
- High/low split encoding is a viable second-line technique if a specific band still fails precision tests.

---

# 3. Cesium large-world precision

Cesium documents an `EncodedCartesian3` approach that splits a 64-bit Cartesian coordinate into high and low float32 triples to reduce jitter in GPU vertex attributes.

Architectural consequence:

- Browser Blackhole should retain high/low encoding as a tested option for future dense/large catalogs.
- It is not necessary to pay this cost for every object if CPU-relative subtraction already keeps current values bounded.

---

# 4. Cesium screen-space LOD

Cesium 3D Tiles drives refinement using screen-space error, approximately the pixel size of geometric error.

It also supports:

- dynamic distance-related error;
- progressive loading;
- foveated prioritization near the center of view.

Architectural consequence:

- use projected pixel significance, not only raw distance;
- prioritize selected/centered targets;
- defer off-axis detail;
- use hysteresis to prevent representation thrashing.

---

# 5. Three.js depth options

Current Three.js renderer APIs expose:

- `logarithmicDepthBuffer`;
- `reversedDepthBuffer`.

Classic WebGLRenderer documentation states:

- logarithmic depth may be needed for huge scale ranges but may reduce early-fragment-test efficiency because of fragment-depth writes;
- reverse depth is faster/more accurate where the required extension is available.

Architectural consequence:

- do not make log depth a cargo-cult requirement;
- do not change the shared renderer depth policy in the first Spatial Atlas milestone;
- first solve precision through relative coordinates, scale bands and dynamic clip planes;
- evaluate global depth-mode changes separately because one shared renderer serves every validated destination.

---

# 6. Three.js shader precompilation

Current Three.js `Renderer.compileAsync()` explicitly exists to reduce first-use shader compilation stutter.

Architectural consequence:

- target selection/approach is an ideal precompile window;
- existing TransitionDirector preparation can absorb prewarm work;
- compile only the material graph needed for likely arrival, not every alternative preset/backend.

---

# 7. Three.js instancing and batching

Three.js `InstancedMesh` is intended for many objects sharing geometry/material and explicitly reduces draw calls.

`BatchedMesh` supports batching different geometries that share a material.

Architectural consequence:

- reticles and common proxies should not be one mesh each;
- large star/marker populations should be point/instanced/batched data;
- selected/focused special rendering can be a small separate path.

---

# 8. Three.js LOD

Three.js LOD supports distance thresholds and hysteresis.

Architectural consequence:

- the hysteresis concept is useful;
- the distance-only metric is insufficient for the Atlas, so build a screen-space controller above/basic alongside this idea.

---

# 9. KTX2/Basis textures

Current Three.js KTX2Loader supports GPU-oriented KTX2/Basis textures, capability detection and bounded transcoding workers.

Architectural consequence:

- new texture-heavy atlas assets should evaluate KTX2;
- use it only after quality, transcoder bundle and browser behavior are measured;
- do not retroactively convert scientific assets merely for fashion.

---

# 10. Three.js resource lifecycle

Three.js documentation emphasizes that geometries, materials, textures and render targets are not automatically released when removed from a scene.

Architectural consequence:

- the repository’s existing `ResourceScope` design is correct and must remain authoritative;
- Spatial Explorer must own and dispose its resources explicitly;
- resource torture must inspect both repo inventory and renderer-side memory/program counts.

---

# 11. On-demand rendering

Three.js guidance notes that continuously rendering a static scene wastes device power and that rendering on change is appropriate for static content.

Architectural consequence:

- the active whole-atlas performance campaign’s render invalidation work is directly useful for Explorer;
- stationary spatial maps should sleep instead of running a perpetual GPU loop.

---

# 12. JPL Horizons and reference frames

Current JPL Horizons documentation:

- supports vector ephemerides;
- uses ICRF as a primary reference system;
- exposes explicit reference system, unit and aberration/correction choices;
- documents the distinction between frames and output corrections.

Architectural consequence:

- offline queries must pin frame, center, units, correction mode and epoch;
- source manifests must record these parameters;
- runtime should consume reduced data, not perform anonymous unversioned live API calls.

---

# 13. NAIF SPICE reference frames

NAIF documentation treats the SPICE `J2000` frame as the ICRF realization for practical SPICE work and carefully distinguishes inertial and body-fixed frames.

Architectural consequence:

- Atlas documentation must not casually call every coordinate “J2000”;
- catalog-level inertial frame should be explicit;
- body-fixed object rendering remains a local destination concern.

---

# 14. Gaia

The Gaia archive provides astrometric positions, parallaxes, proper motions, radial velocities and photometry for extremely large stellar datasets.

Architectural consequence:

- Gaia is a suitable candidate for a later real-star background;
- it is far too large to ingest naively at launch;
- begin with a curated/magnitude-limited subset and build a separate binary/LOD pipeline.

---

# 15. Map label collision design

MapLibre’s symbol placement model exposes:

- label/icon overlap policy;
- placement priority/sort key;
- hiding lower-priority symbols on collision.

Architectural consequence:

- a spatial astronomy UI needs an explicit label placement engine;
- selected/focused objects must override ordinary collision rules;
- parent/system aggregation should reduce marker clutter before adding more UI.

---

# 16. Browser frame-budget guidance

Modern browser rendering guidance treats roughly 16.7 ms as the full 60 Hz frame interval, with application work needing to fit below that after browser overhead.

Architectural consequence:

- Explorer must be deliberately cheap;
- no large synchronous catalog parse/layout is acceptable during interaction;
- performance evidence must include tails, not only averages.

---

# 17. Vite dynamic imports

Vite lazy-loads dynamic imports into separate chunks and optimizes async chunk dependency preloading.

Architectural consequence:

- the current destination lazy-loader architecture should be retained;
- Explorer metadata should remain lightweight;
- target modules should load on demand/prewarm.

---

# 18. HTTP caching

Modern HTTP caching guidance recommends content-hashed immutable static assets for long-lived caching.

Architectural consequence:

- versioned binary catalogs and atlas textures should be content-addressed/hashed;
- `index.html` remains revalidated while immutable subresources can be cached long-term;
- deployment docs should state this explicitly.

---

# 19. Other contemporary Three.js astronomy projects

Recent community projects demonstrate:

- real Horizons trajectory baking;
- magnitude-limited real star catalogs;
- lazy spacecraft model loading;
- adaptive resolution;
- marker/detail swaps;
- historical supernova event placement;
- large real galaxy point clouds.

These are useful precedent, but they are not treated as authoritative scientific sources. Their main value is confirming browser feasibility and identifying recurring implementation problems.

---

# 20. Repository-specific evidence

The current Browser Blackhole repository already includes:

- eight production destination modules;
- a one-renderer host;
- destination lifecycle contracts;
- target preparation and transition state machine;
- generation-safe cancellation;
- resource scopes;
- dynamic imports;
- global performance governance;
- idle/invalidation performance work in the active performance campaign;
- true GPU timing support in some paths;
- strong scientific parity and visual golden tests.

Therefore the research conclusion is not “replace the architecture.”

It is:

> Add a spatial explorer as a new lightweight coordination layer and reuse the existing host/destination boundary as the semantic-zoom handoff boundary.

---

# 21. Research decisions deliberately rejected

## Reject: one gigantic literal-scale Three.js scene

Reason: precision, performance, local-renderer incompatibility.

## Reject: make the existing local CameraRig astronomical

Reason: conflates local scientific camera semantics with atlas travel.

## Reject: copy Stellamap’s log-depth configuration globally

Reason: shared renderer compatibility and validated existing destinations.

## Reject: load a million-star catalog first

Reason: would make data/LOD/performance complexity block the core UX.

## Reject: fake spatial positions for generic phenomena

Reason: violates existing scientific fidelity philosophy.

## Reject: live scientific API dependencies

Reason: breaks reproducibility/static hosting/provenance.

## Reject: WebGPU-only Explorer compute architecture

Reason: unnecessary and would weaken WebGL2 fallback.

---

# 22. Primary source checklist for the implementation agent

Before changing any architecture-relevant behavior, consult current versions of:

- Three.js WebGPURenderer/Renderer documentation;
- Three.js InstancedMesh/BatchedMesh/LOD/KTX2Loader documentation;
- current WGSL specification;
- JPL Horizons API/manual;
- NAIF SPICE frames documentation;
- Gaia archive documentation if star ingestion is implemented;
- Browser Blackhole’s own scientific/fidelity/performance documentation.

Do not rely on this research memo as a substitute for rechecking current API signatures at implementation time.