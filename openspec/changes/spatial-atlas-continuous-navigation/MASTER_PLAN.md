# Browser Blackhole — Spatial Cosmic Atlas V2
## Implementation Master Plan

**Change ID:** `spatial-atlas-continuous-navigation`  
**Target repository:** `quantdale/browser-blackhole`  
**Status:** implementation-ready design / do not begin runtime implementation until the active whole-atlas performance campaign is closed or intentionally suspended with evidence  
**Primary goal:** evolve the existing menu-centric Cosmic Atlas into a spatially explorable, Stellamap-class cosmic experience while preserving the existing scientific renderers, renderer ownership model, resource lifecycle, compatibility policy, and validated scientific behavior.

---

# 0. Mission

Browser Blackhole already contains a sophisticated Cosmic Atlas host and eight production destinations. The next product step is **not** to rebuild those simulations. It is to create a new spatial layer that lets the user inhabit and navigate a coherent universe around them.

The target experience is:

1. enter an explorable cosmic map rather than a list of demos;
2. see astrophysical objects and phenomena as discoverable spatial anchors;
3. click, search, or fly toward an object;
4. approach over multiple orders of magnitude without visible coordinate instability;
5. progressively replace distant markers/proxies with richer representations;
6. pre-load the destination renderer before it is needed;
7. cross a seamless handoff boundary into the existing scientifically validated local renderer;
8. explore the local phenomenon;
9. zoom back out into the atlas with continuity;
10. preserve route/deep-link semantics and scientific truthfulness throughout.

The key architectural principle is:

> **Continuous experience does not require one literal scene, one literal unit system, or one giant coordinate space. It requires continuous perception and rigorously controlled handoffs between scale domains.**

Trying to place everything from a neutron-star surface to an intergalactic merger into one ordinary Three.js coordinate system is the wrong architecture. The solution is a hierarchy of coordinate domains, semantic zoom, camera-relative rendering, representation handoffs, and one-heavy-destination-at-a-time lifecycle management.

---

# 1. Repository reality and migration posture

## 1.1 Existing strengths that must be preserved

The current repository already has:

- one `CosmicAtlasHost`;
- one shared renderer/device lifecycle;
- lazy destination loading;
- `ResourceScope` ownership and explicit disposal;
- one global performance governor;
- a `NavigationController` with generation-safe routing;
- a `TransitionDirector` with abortable preparation and latest-wins behavior;
- a cheap hyperspace transition that doubles as a loading boundary;
- shared particle, volume, ribbon, trajectory, field-line, lensing and post services;
- deterministic seeded simulation and timeline infrastructure;
- WebGPU primary rendering with WebGL2 fallback;
- eight production destinations;
- scientific fidelity classes;
- deep links;
- performance telemetry and benchmark harnesses;
- browser, unit, parity, compatibility, accessibility, resource-leak and visual-golden suites;
- production-readiness certification.

These are not temporary scaffolds. They are the foundation.

## 1.2 Current UX limitation

The current primary UX is still essentially:

```text
top-bar destination chips
      ↓
select destination
      ↓
hyperspace
      ↓
destination-local scene
```

The new target is:

```text
spatial explorer
      ↓
search / click / fly / zoom
      ↓
reticle → proxy → detailed proxy
      ↓
target preparation / precompile
      ↓
semantic handoff
      ↓
existing destination-local scientific renderer
      ↓
zoom out / return
      ↓
spatial explorer
```

## 1.3 Current campaign dependency

At the time this plan was authored, `.agent/START_HERE.md` points to:

`openspec/changes/whole-atlas-performance-optimization/`

That campaign changes the host scheduler, transition occlusion behavior, lazy construction policy, shared-service work budgets, and other runtime contracts that the Spatial Atlas will depend on.

Therefore:

### Hard sequencing rule

Do **not** begin central Spatial Atlas runtime implementation on `main` while the performance campaign is actively modifying the same runtime.

Allowed before performance closure:

- research;
- planning;
- static catalog data experiments;
- standalone coordinate math;
- isolated visual prototypes outside production boot;
- non-overlapping unit tests;
- docs/OpenSpec work.

Blocked before performance closure unless explicitly integrated by one owner:

- `host.ts`;
- `TransitionDirector.ts`;
- global quality governor;
- shared renderer kernel;
- shared post;
- resource manager;
- production application shell;
- production camera ownership.

After the performance campaign closes, Spatial Atlas SA0 must re-audit these APIs against the final performance-certified commit before implementation begins.

---

# 2. Research-derived architecture decisions

This plan is based on techniques used in large-world renderers, current Three.js capabilities, WebGPU/WGSL precision constraints, astronomical reference-frame systems, tiled LOD engines, and the linked Stellamap implementation notes.

## 2.1 Large-world precision: CPU double, GPU relative float

The linked Stellamap implementation reports a scene spanning approximately nine orders of magnitude. Its key precision technique is to pin the current focus near the origin and subtract positions in JavaScript double precision before values reach float32 shader arithmetic.

Browser Blackhole should use the same **class** of solution, but generalize it into a formal `ReferenceFrameService` + `OriginRebaser`.

Do not upload absolute astronomical positions directly to f32 GPU attributes.

### Rule

```text
authoritative astronomical position
        │  JS Number / binary64
        ▼
reference-frame transform
        │
focus/camera-relative subtraction in binary64
        ▼
scale-band normalization
        │
bounded relative values
        ▼
Float32Array / GPU
```

If precision tests later prove a scale band still requires more relative precision, add high/low split encoding for that band. Do not begin by paying this complexity everywhere.

## 2.2 Do not use one universal unit

The Atlas must support distinct unit domains:

| Domain | Canonical runtime unit |
|---|---|
| Solar-system ephemeris | AU or km, depending artifact |
| Stellar neighborhood | pc |
| Galactic | kpc |
| Extragalactic | Mpc |
| Black-hole / compact local renderer | existing `r_g`-native/local units |
| Other local phenomenon renderer | existing destination-native scene units |

Conversions are explicit at domain boundaries.

A user may perceive one continuous journey while the engine changes unit domain behind the scenes.

## 2.3 Semantic zoom over literal-scale persistence

The physically correct diameter of many objects is invisible at useful travel scales.

The renderer therefore distinguishes:

- **physical size** — scientific metadata;
- **geometric proxy size** — representation used for rendering;
- **marker angular size** — navigation affordance;
- **handoff size** — projected size at which a local destination becomes appropriate.

Never overwrite physical size merely to make an object clickable.

## 2.4 Screen-space LOD, not distance-only LOD

Three.js provides distance-based LOD with hysteresis, but astronomical content varies enormously in physical size and viewport significance. The Atlas should use projected pixel size / screen-space error as the primary representation metric.

Conceptually:

```text
pixelsPerWorldUnit =
    viewportHeight /
    (2 * tan(fov / 2) * distance)

projectedRadiusPx =
    physicalOrProxyRadius * pixelsPerWorldUnit
```

For a representation with geometric error `e`:

```text
screenSpaceErrorPx ≈
    e * viewportHeight /
    (2 * tan(fov / 2) * distance)
```

Thresholds must use hysteresis.

## 2.5 Only one heavy destination remains active

The existing `CA-ADR-002` remains correct.

The Spatial Explorer is deliberately cheap. It must not create every local phenomenon renderer. It renders proxies and metadata only.

Target destination preparation may overlap network/CPU work, and a short controlled snapshot-based handoff may overlap visuals, but two heavy simulations must never run indefinitely.

## 2.6 Real-space truth must be separate from conceptual phenomena

Not every current destination has a scientifically defensible single sky position.

Introduce:

```ts
type RealityClass =
  | 'REAL_OBJECT'
  | 'HISTORICAL_EVENT'
  | 'REFERENCE_SCENARIO'
  | 'CONCEPTUAL_LAB';
```

Rules:

- `REAL_OBJECT` may occupy an astronomical coordinate.
- `HISTORICAL_EVENT` may occupy a source coordinate and must carry an event epoch/time semantics.
- `REFERENCE_SCENARIO` may be associated with a real scientific dataset/model but must not be falsely placed at an observed system.
- `CONCEPTUAL_LAB` is accessible through discovery/search/taxonomy but does not pretend to be a physical object in the sky.

This prevents the atlas from lying merely to look spatial.

---

# 3. Product target

## 3.1 Default user journey

Future certified default:

```text
launch
  ↓
Spatial Explorer
  ↓
view current focus context
  ↓
pan/orbit/fly
  ↓
reticles and labels reveal nearby/important anchors
  ↓
select target
  ↓
camera focuses target
  ↓
progressive zoom
  ↓
target representation grows
  ↓
destination prefetch/warm-up
  ↓
continuous handoff
  ↓
scientific destination
```

Initial rollout must keep the existing direct routes intact.

## 3.2 Navigation methods

Support all:

- pointer orbit/free-look;
- wheel/trackpad semantic zoom;
- touch orbit + pinch;
- click/tap reticle;
- keyboard selection/focus;
- search;
- category browser;
- breadcrumb hierarchy;
- browser Back/Forward;
- deep link.

## 3.3 User-visible continuity requirements

A handoff is successful when the user perceives:

- same target centered before/after;
- no random camera flip;
- no blank frame;
- no sudden unrelated background;
- no scale jump without a visual cue;
- no frozen “loading tunnel” caused by preparation starting too late;
- no heavy frame collapse during approach;
- no false claim that warp/hyperspace is physically accurate.

---

# 4. Target runtime topology

```text
DOM / Search / Explorer UI / Routes
                │
                ▼
        SpatialNavigationController
                │
      ┌─────────┼───────────┐
      ▼         ▼           ▼
 Spatial     Focus      Browser
 Catalog     History     History
      │         │
      ▼         ▼
 ReferenceFrameService
      │
 OriginRebaser / ScaleBandController
      │
      ▼
 SpatialExplorerModule
      │
 ┌────┼───────────────┐
 ▼    ▼               ▼
Proxy Marker       Label/UI
Layer Layer        Placement
      │
      ▼
 ScreenSpaceLODController
      │
      ▼
 TravelCoordinator
      │
      ├── PrefetchScheduler
      ├── NavigationController
      └── TransitionDirector
                  │
                  ▼
         existing destination
                  │
                  ▼
         local scientific renderer
```

The `CosmicAtlasHost` remains the composition root.

---

# 5. New module layout

Recommended additions after SA0 re-audit:

```text
src/
  atlas/
    spatial/
      SpatialExplorerModule.ts
      SpatialCatalog.ts
      SpatialCatalogLoader.ts
      SpatialEntity.ts
      SpatialState.ts
      ReferenceFrameService.ts
      OriginRebaser.ts
      ScaleBandController.ts
      ScreenSpaceLODController.ts
      SpatialCameraController.ts
      SpatialNavigationController.ts
      TravelCoordinator.ts
      PrefetchScheduler.ts
      ProxyRenderer.ts
      MarkerLayer.ts
      LabelLayoutEngine.ts
      SpatialPicking.ts
      SpatialSearchIndex.ts
      SpatialTelemetry.ts
      SpatialDebugView.ts
      spatialRoutes.ts
      math/
        astroCoordinates.ts
        projections.ts
        highLowEncoding.ts
        logDistance.ts
        angularSize.ts

  ui/
    atlas/
      spatial/
        SpatialSearch.ts
        FocusCard.ts
        ScaleReadout.ts
        Breadcrumbs.ts
        CategoryFilters.ts
        SpatialStatus.ts
        AccessibleObjectList.ts

  data/
    spatial/
      curatedCatalog.ts
      sourceManifest.ts

public/
  data/
    spatial/
      catalog-v1.bin
      catalog-v1.manifest.json

tools/
  spatial-data/
    build-catalog.ts
    validate-catalog.ts
    horizons/
    gaia/
    sources/

tests/
  unit/
    spatial*.test.ts
  browser/
    spatial-explorer.spec.ts
    spatial-navigation.spec.ts
    spatial-handoff.spec.ts
    spatial-precision.spec.ts
    spatial-accessibility.spec.ts
    spatial-resource-leak.spec.ts

benchmarks/
  spatial/
```

Do not create all files empty. Create them when their packet begins.

---

# 6. Spatial entity contract

Use a separate entity catalog rather than stuffing spatial concerns into `PhenomenonDescriptor`.

Conceptual schema:

```ts
interface SpatialEntityDescriptor {
  id: string;
  title: string;
  aliases: string[];

  realityClass:
    | 'REAL_OBJECT'
    | 'HISTORICAL_EVENT'
    | 'REFERENCE_SCENARIO'
    | 'CONCEPTUAL_LAB';

  entityClass:
    | 'star'
    | 'black-hole'
    | 'neutron-star'
    | 'supernova-remnant'
    | 'transient'
    | 'quasar'
    | 'galaxy'
    | 'galaxy-system'
    | 'solar-system-body'
    | 'spacecraft'
    | 'lab';

  parentId?: string;

  position?: {
    frame: 'ICRF';
    representation:
      | { kind: 'cartesian'; x: number; y: number; z: number; unit: 'au'|'pc'|'kpc'|'mpc' }
      | { kind: 'radec-distance'; raDeg: number; decDeg: number; distance: number; unit: 'pc'|'kpc'|'mpc' };
    epoch?: {
      jdTdb?: number;
      isoUtc?: string;
    };
  };

  velocity?: {
    vx: number;
    vy: number;
    vz: number;
    unit: 'km/s' | 'au/day';
    frame: 'ICRF';
  };

  physical: {
    radius?: number;
    radiusUnit?: string;
    massSolar?: number;
    luminositySolar?: number;
    distanceUncertainty?: number;
  };

  visual: {
    proxyKind: 'point'|'sprite'|'sphere'|'disk'|'galaxy'|'event'|'none';
    importance: number;
    markerPolicy: string;
    labelPriority: number;
  };

  destination?: {
    destinationId: string;
    presetId?: string;
    relationship:
      | 'REPRESENTS_OBJECT'
      | 'REPRESENTATIVE_MODEL'
      | 'RELATED_CONCEPT';
  };

  temporal?: {
    kind: 'persistent'|'event'|'range';
    eventEpoch?: string;
    observedEpoch?: string;
  };

  sources: string[];
  fidelityNote: string;
}
```

## 6.1 Catalog rules

Every spatial entity must validate:

- unique id;
- valid reality class;
- finite coordinates;
- valid distance/unit;
- explicit coordinate frame;
- epoch when dynamic coordinates require it;
- source/provenance references;
- no destination relationship that overstates fidelity;
- no physical property silently reused as a display size.

---

# 7. Astronomical reference frames

## 7.1 Canonical inertial frame

Use ICRF as the catalog-level inertial reference frame.

For SPICE-compatible data, document J2000 naming equivalence where appropriate, but do not casually mix:

- ICRF;
- ECLIPJ2000;
- body-fixed IAU frames;
- true-of-date Earth frames.

## 7.2 Solar-system data

For moving solar-system bodies:

- source position/state vectors from JPL Horizons/SPICE during offline catalog generation;
- pin query parameters;
- pin center;
- pin reference frame;
- pin time scale;
- pin correction mode;
- pin units;
- record retrieval date/version;
- ship reduced static artifacts.

Runtime must not require JPL network access.

## 7.3 Stellar/extragalactic anchors

For early Spatial Atlas rollout, prefer a small curated source-locked catalog over an enormous automatic ingestion.

Each anchor should include:

- RA;
- Dec;
- distance;
- frame;
- epoch;
- source;
- uncertainty when material.

Later Gaia-based stars may add:

- parallax;
- proper motion;
- radial velocity;
- photometry;
- release id.

## 7.4 Event coordinates

Historical events require:

- source/host coordinate;
- event time semantics;
- whether time is source-frame, observation date, or approximate historical epoch;
- clear distinction between “this happened here” and “this local renderer is an exact reconstruction.”

---

# 8. Coordinate precision architecture

## 8.1 Absolute authority lives on CPU

JavaScript `number` supplies binary64 arithmetic.

Store authoritative catalog data there.

## 8.2 GPU receives bounded relative coordinates

Each frame or origin change:

```ts
relative64.x = objectAbs.x - originAbs.x;
relative64.y = objectAbs.y - originAbs.y;
relative64.z = objectAbs.z - originAbs.z;

gpu.x = Math.fround(relative64.x * bandScale);
...
```

The exact representation depends on the current scale band.

## 8.3 Origin policy

Use two related concepts:

- **reference origin** — selected focus / scale-band anchor;
- **camera offset** — local movement around that origin.

Avoid rebasing every object buffer every tiny pointer delta when unnecessary.

For the first curated catalog, CPU-relative updates are cheap.

For future 100k+ catalogs, evaluate:

- high/low encoded positions;
- chunk-local origins;
- hierarchical cell origins;
- GPU rebasing.

## 8.4 High/low encoding is conditional

Implement and unit-test `highLowEncoding.ts`, but do not require it in the first render path.

Activation gate:

- a deterministic jitter/precision test fails with ordinary relative float;
- the failure is user-visible or materially harms picking/LOD;
- high/low fixes it with acceptable cost.

## 8.5 Precision tests

Required scale tests:

1. solar-system: nearby moon/planet offsets at outer-solar-system origin;
2. stellar: AU-scale separation around a pc-scale origin;
3. galactic: pc-scale separation at kpc-scale coordinates;
4. extragalactic: kpc-scale separation at Mpc-scale coordinates;
5. focus rebase invariance;
6. round-trip RA/Dec/distance conversion;
7. no NaN/Infinity under maximum catalog distance;
8. projected pixel jitter below declared threshold during stationary camera.

Do not choose one arbitrary numeric epsilon for all domains. Use unit-aware and screen-space tolerances.

---

# 9. Scale-band architecture

Recommended initial bands:

```ts
type SpatialScaleBand =
  | 'SOLAR'
  | 'STELLAR'
  | 'GALACTIC'
  | 'EXTRAGALACTIC'
  | 'LOCAL_HANDOFF';
```

Optional later bands:

- planetary-system;
- galaxy-cluster;
- observable-universe overview.

## 9.1 Band state

Each band defines:

- unit scale;
- camera near/far policy;
- visible catalog classes;
- representation limits;
- label density;
- background representation;
- motion speed range;
- prefetch policy;
- handoff candidates.

## 9.2 Band transition

Do not hard switch on one threshold.

Use:

```text
band A active
  ↓
approach boundary
  ↓
precompute band B relative transforms
  ↓
overlap proxy representations
  ↓
crossfade weights
  ↓
band B authoritative
```

Use hysteresis to prevent oscillation.

## 9.3 Logarithmic zoom coordinate

Represent travel range in log space:

```ts
logRange = log10(rangeInBandUnits)
```

Wheel/pinch input changes `logRange`.

This makes zoom behavior predictable across orders of magnitude.

Do not multiply raw camera distance by an unconstrained factor forever.

---

# 10. Camera architecture

## 10.1 Keep `CameraRig` local

The existing `CameraRig` is well suited to destination-local orbiting and arrival presets.

Do not mutate it into a parsec-scale navigator.

Introduce `SpatialCameraController`.

## 10.2 Spatial camera state

```ts
interface SpatialCameraState {
  focusEntityId: string | null;
  band: SpatialScaleBand;
  logRange: number;
  orientation: Quaternion;
  orbitAzimuth: number;
  orbitElevation: number;
  travelState: 'idle'|'focusing'|'traveling'|'handoff';
}
```

## 10.3 Focus travel

A target focus animation should:

1. rotate target toward a predictable screen zone;
2. prevent target crossing behind camera;
3. change distance approximately exponentially/logarithmically;
4. limit angular velocity;
5. limit maximum perceived zoom acceleration;
6. leave enough time to prefetch/warm target;
7. cancel/retarget generation-safely.

A useful range interpolation:

```text
range(t) = exp(
  lerp(log(rangeStart), log(rangeEnd), ease(t))
)
```

Orientation should use quaternion slerp.

## 10.4 Manual navigation

Desktop:

- primary drag: orbit current focus;
- secondary/free mode optional;
- wheel/trackpad: log zoom;
- double click: focus;
- Escape: return one focus level;
- search shortcut;
- arrow/WASD only where not conflicting with controls.

Mobile:

- one-finger orbit;
- pinch semantic zoom;
- tap focus;
- two-finger gestures only if tested;
- no gesture should make page scrolling impossible outside the viewport.

## 10.5 Reduced motion

When reduced motion is enabled:

- no high-speed tunnel;
- no aggressive exponential acceleration;
- use short focus crossfade / direct reframe;
- maintain loading lifecycle;
- preserve deep links.

---

# 11. Depth policy

Do not blindly copy Stellamap’s logarithmic depth-buffer choice.

Current Three.js supports:

- logarithmic depth;
- reverse depth.

Classic WebGL documentation notes reverse depth can be faster/more accurate where the required extension exists, while logarithmic depth can reduce early-fragment-test efficiency.

However, Browser Blackhole has:

- one shared renderer;
- WebGPU and WebGL2 fallback;
- validated local scenes;
- full-screen renderers largely independent of ordinary mesh depth.

Therefore:

### Initial Spatial Atlas policy

1. preserve the certified renderer depth configuration;
2. use camera-relative coordinates;
3. dynamically set Explorer camera near/far planes;
4. keep each active scale band bounded;
5. only prototype global reverse-Z/log-depth changes in a dedicated ADR.

### Depth ADR gate

A renderer-depth change may ship only if:

- every local destination still passes;
- WebGPU passes;
- forced WebGL2 passes;
- post-processing depth use passes;
- visual goldens are intentionally reviewed;
- precision improvement is measured;
- no performance regression outweighs benefit.

---

# 12. Proxy rendering

## 12.1 Representation ladder

Every entity may move through:

```text
hidden
  ↓
locator marker
  ↓
symbolic proxy
  ↓
geometric proxy
  ↓
high-detail atlas proxy
  ↓
local destination handoff
```

Not every entity needs every rung.

## 12.2 Marker angular-size behavior

Use a constant screen-size marker at long range.

Compute physical projected radius.

Example policy, to be tuned:

```text
physical projected radius < 3 px:
  marker fully visible

3–8 px:
  marker fades down while physical proxy fades up

> 8 px:
  marker hidden
```

Use hysteresis.

Never treat these initial numbers as scientific constants.

## 12.3 Parent/child aggregation

When child markers are too close on screen:

- collapse into parent/system marker;
- expose child count;
- expand children as user approaches.

This is essential for:

- galaxy sub-objects;
- star systems;
- solar-system moons;
- dense category clusters.

## 12.4 Draw-call policy

For locator/proxy classes:

- use `InstancedMesh`, points, or one batched buffer;
- no one-mesh-per-star pattern for large catalogs;
- no one-material-per-object unless materially justified;
- maintain culling bounds.

Potential grouping:

- compact-object reticles;
- star points;
- galaxies;
- event markers;
- highlighted selected entity.

Selected entity may receive one separate draw if needed.

---

# 13. Screen-space LOD controller

`ScreenSpaceLODController` owns representation decisions.

Input:

- camera;
- viewport;
- entity physical/proxy size;
- distance;
- focus status;
- importance;
- quality tier;
- current representation.

Output:

- representation;
- fade weights;
- prefetch priority;
- label eligibility.

## 13.1 Hysteresis

Example:

```text
upgrade if SSE > highThreshold
downgrade if SSE < lowThreshold
```

with `lowThreshold < highThreshold`.

## 13.2 Quality integration

Global PerformanceGovernor remains authority.

Spatial LOD maps tier to:

- maximum visible marker population;
- label budget;
- proxy tessellation;
- distant galaxy quality;
- catalog chunk detail;
- background star count;
- prefetch radius.

Spatial Atlas must not create a second independent quality governor.

---

# 14. Labels and discoverability

A Stellamap-class experience fails if objects disappear into black space.

## 14.1 Label architecture

Use a lightweight DOM/SVG overlay for a bounded set of visible labels.

Do not create DOM nodes for the full catalog.

`LabelLayoutEngine` runs when:

- camera changes;
- focus changes;
- viewport changes;
- catalog visibility changes;
- dynamic ephemeris positions update.

## 14.2 Collision algorithm

Borrow map-labeling principles:

1. project eligible entities to screen;
2. assign priority;
3. sort high-priority first;
4. reserve bounding rectangles in a coarse occupancy grid;
5. reject/hide lower-priority labels on collision;
6. selected/focused label is always admitted;
7. parent system may suppress children;
8. apply temporal coherence so labels do not flicker frame-to-frame.

## 14.3 Label priority

Suggested contributors:

- focused;
- hovered;
- search match;
- user bookmark;
- destination-capable;
- real object;
- category importance;
- proximity to viewport center;
- projected size.

## 14.4 Accessibility

The DOM overlay alone is not sufficient.

Provide `AccessibleObjectList`:

- keyboard navigable;
- mirrors currently discoverable nearby/important objects;
- has names/types/distances;
- Enter focuses;
- focus state synchronized to canvas;
- selected object details exist as text outside bitmap.

---

# 15. Picking

## 15.1 First implementation

For a curated catalog, do CPU screen-space picking.

Why:

- markers already have fixed pixel radii;
- physical meshes may be sub-pixel;
- screen-space hit testing matches what user sees;
- no need for a GPU ID pass initially.

Procedure:

1. use cached projected screen point;
2. reject behind camera;
3. compute pointer distance;
4. use marker/proxy hit radius;
5. resolve ties by:
   - focused/selected;
   - smaller screen distance;
   - higher priority;
   - nearer depth.

## 15.2 Future large catalog

If projected candidate count becomes too large:

- screen-space grid;
- quadtree;
- BVH;
- GPU ID buffer.

Do not add these before profiling.

---

# 16. Search

`SpatialSearchIndex` indexes:

- canonical name;
- aliases;
- category;
- destination name;
- phenomenon aliases;
- source object ids where useful.

Search results distinguish:

- real object;
- historical event;
- representative model;
- conceptual lab.

Selecting a conceptual lab may navigate directly to the destination without pretending to fly to a coordinate.

---

# 17. Travel coordinator

`TravelCoordinator` bridges spatial focus and current discrete destination lifecycle.

## 17.1 Travel stages

```text
SELECTED
  ↓
FOCUSING
  ↓
APPROACH
  ↓
PREWARM
  ↓
HANDOFF_READY
  ↓
HANDOFF
  ↓
LOCAL
```

## 17.2 Prefetch threshold

Begin target preparation based on:

- selection confidence;
- approach trajectory;
- destination cost;
- expected handoff time;
- network/cache state.

Do not wait until the exact handoff frame.

## 17.3 Cancellation

Reuse generation semantics.

Rapid retarget:

```text
A selected
B selected
C selected
```

must result in:

- A work aborted/disposed if stale;
- B work aborted/disposed if stale;
- C wins;
- no stale route commit;
- no leaked GPU resources;
- no camera jump back to A/B.

---

# 18. TransitionDirector evolution

Do not replace the existing `TransitionDirector`.

Generalize it.

Add transition presentation mode:

```ts
type TransitionPresentation =
  | 'hyperspace'
  | 'crossfade'
  | 'continuous-handoff';
```

## 18.1 Hyperspace

Use for:

- large non-spatial jump;
- conceptual lab navigation;
- user-selected fast travel.

## 18.2 Crossfade

Use for:

- reduced motion;
- incompatible scale jump;
- fallback when visual alignment cannot be guaranteed.

## 18.3 Continuous handoff

Use for Explorer ↔ local destination.

Implementation principle:

- Explorer frame remains the outgoing visual;
- target prepares while Explorer remains responsive;
- at boundary capture Explorer snapshot;
- outgoing heavy work is not needed because Explorer is cheap;
- local target enters at conservative quality;
- local target first frame is aligned to target screen center and angular scale;
- short controlled dissolve hides unit-domain swap;
- outgoing Explorer resources can remain resident only if bounded and shared; otherwise dispose Explorer destination scope after snapshot;
- arrival completes with existing governor hysteresis.

Do not run two full renderers.

---

# 19. Matching the handoff

The visual handoff must preserve:

- target center;
- apparent target size;
- view orientation;
- up direction where meaningful;
- background exposure continuity;
- transition duration.

## 19.1 Handoff contract

Each destination gains optional metadata:

```ts
interface SpatialHandoffDescriptor {
  targetEntityClass: string;
  enterWhenProjectedRadiusPx: number;
  prewarmWhenProjectedRadiusPx: number;
  arrivalPresetId: string;
  supportsContinuousExit: boolean;
  proxyMatch: {
    localReferenceRadius: number;
    localReferenceUnit: string;
  };
}
```

Keep this outside core physics state.

## 19.2 Local arrival

Destination renderer remains authoritative once handoff completes.

Spatial camera no longer controls it.

Existing `CameraRig` takes over through a matched arrival preset.

---

# 20. Exit back to atlas

A spatial atlas is incomplete if entry is seamless but exit is a menu click.

Provide:

- explicit “Return to Atlas”;
- wheel/pinch zoom-out boundary where safe;
- Escape/back focus;
- browser Back.

Sequence:

```text
local destination
  ↓
exit requested
  ↓
freeze/capture local frame
  ↓
prepare Explorer focus at matching entity
  ↓
proxy sized to match local target
  ↓
cross-dissolve
  ↓
Explorer resumes
```

If target entity has no real spatial coordinate, exit to:

- relevant taxonomy context;
- conceptual lab hub;
- previous focus.

Do not invent a sky position.

---

# 21. Integration policy for the eight current destinations

## 21.1 Black Hole

### Spatial role

Best first true spatial handoff candidate.

Possible curated real anchors:

- Sagittarius A*;
- later M87* if parameter/source decisions are explicit.

### Rules

- keep existing Schwarzschild/Kerr implementation untouched;
- map real-object mass to user-facing metadata/preset only after validation;
- do not assign uncertain spin as fact;
- prewarm default LUT path before handoff;
- Kerr pass must not be eagerly created merely because black-hole target is selected if the active preset does not require it.

### Handoff

Use apparent black-hole/proxy angular size, not raw parsec distance.

## 21.2 Neutron Star

Candidate real anchors can be introduced only with documented source parameters.

Potential roles:

- pulsar exemplar;
- magnetar exemplar.

Current renderer omissions remain disclosed.

A real coordinate does not mean the renderer is an exact reconstruction.

Use destination relationship `REPRESENTATIVE_MODEL` unless all relevant model parameters are actually source-backed.

## 21.3 Stellar Explosion

Strong spatial use case for historical events.

Requirements:

- event epoch;
- source coordinate;
- historical/observed distinction;
- local timeline can show representative physical progression;
- marker must not imply the star is exploding “right now.”

## 21.4 Compact Merger

Initial policy:

- keep as conceptual/reference lab unless a scientifically defensible localization representation is added.

Many gravitational-wave sources have probabilistic sky/distance localization rather than a simple exact point.

Future enhancement:

- sky probability surface / distance posterior;
- event volume;
- source posterior visualization.

Do not create a fake precise marker.

## 21.5 Tidal Disruption

May later attach to source-locked historical TDE host positions.

Until a specific event/preset relationship is sourced, treat the local renderer as representative.

## 21.6 Quasar / AGN

Excellent semantic-zoom pilot because the current destination already has INNER / NUCLEAR / GALACTIC zones.

Use this destination to test:

- generic ScaleBandController concepts;
- handoff continuity;
- zone hysteresis;
- proxy/detail replacement.

Real quasar anchors can be curated, but procedural host morphology must be disclosed as representative.

## 21.7 Black-Hole Merger

Current production destination is based on SXS:BBH:0001, a numerical-relativity reference simulation, not an observed sky-localized event.

Reality class:

`REFERENCE_SCENARIO`.

Do not place it at a random observed merger location.

Access via:

- search;
- “Black-hole merger” taxonomy;
- conceptual lab portal;
- educational path from binary black holes.

## 21.8 Galaxy Collision

Current production destination reconstructs a Toomre & Toomre restricted-three-body reference model, not a specific observed galaxy pair.

Reality class:

`REFERENCE_SCENARIO`.

Do not label it “Antennae” or another real system unless a new data-driven model is actually added.

---

# 22. Spatial data pipeline

## 22.1 Philosophy

Runtime is static-host friendly.

External astronomical services are **offline build-time sources**, not required runtime dependencies.

Pipeline:

```text
authoritative source
      ↓
fetch tool
      ↓
raw machine-local cache (gitignored)
      ↓
normalize frame / units / epoch
      ↓
validate
      ↓
curated manifest
      ↓
compact runtime artifact
      ↓
checksum
      ↓
browser
```

## 22.2 Manifest

Every produced artifact records:

- schema version;
- generated timestamp;
- source versions/releases;
- source citations;
- frame;
- units;
- epoch/time scale;
- corrections used;
- transformations;
- record count;
- byte count;
- SHA-256;
- license/provenance note.

## 22.3 Early catalog scale

Do not begin with millions of stars.

Milestone targets:

### Phase 1

~20–100 curated objects/events/labs.

### Phase 2

hundreds to a few thousand anchors/background stars.

### Phase 3

optional 100k+ star catalog only after rendering, streaming, picking and label budgets are proven.

---

# 23. Background star architecture

## 23.1 Phase 1

Keep the current deterministic celestial environment for local scientific renderer stability.

Explorer may use:

- procedural background;
- curated bright-star anchors.

## 23.2 Phase 2

Add a source-backed ICRS star background.

Use:

- one GPU point buffer;
- magnitude-based visual size/intensity;
- optional color from source photometry;
- magnitude LOD;
- no per-star mesh.

## 23.3 Continuity

Eventually align Explorer sky orientation and local escaped-ray environment to one canonical celestial frame.

This is a separate visual/scientific campaign because it can intentionally change existing goldens.

Do not sneak it into the initial Spatial Atlas architecture.

---

# 24. Asset strategy

Use:

- Vite dynamic imports for heavy modules;
- binary scientific/catalog payloads;
- KTX2/Basis for texture-heavy new assets where quality and browser support are validated;
- content-hashed static asset filenames;
- immutable caching for hashed assets;
- no giant source images if lower-resolution mip/LOD is all that is visible.

## 24.1 Prefetch

Priority:

1. selected target metadata;
2. target module chunk;
3. minimum-ready scientific assets;
4. shader/pipeline warm-up;
5. high-quality optional textures;
6. unrelated nearby objects.

Bound concurrency.

Abort stale work.

## 24.2 Shader compilation

Use renderer `compileAsync()` where the scene/material graph allows it.

Compile during:

- approach;
- fully/mostly hidden transition interval;
- explicit preparation.

Do not compile every possible preset.

---

# 25. Foveated/progressive streaming

Adapt the idea of center-prioritized refinement:

A target near the viewport center and actively approached has higher streaming priority than an off-axis background entity.

Example score:

```text
priority =
  focusWeight +
  centerWeight +
  approachVelocityWeight +
  destinationImportance +
  cachedPenalty/bonus
```

Do not implement a complex generic scheduler before a simple bounded priority queue is measured.

---

# 26. Performance requirements

The existing performance campaign remains authoritative for global mechanisms.

Spatial Atlas adds its own gates.

## 26.1 Core rule

The Explorer must be dramatically cheaper than strong-field destinations.

It should never become the new bottleneck.

## 26.2 Provisional benchmark targets

These are engineering targets to validate/tune after SA0 baseline, not marketing guarantees:

### Explorer stationary

- compatible with on-demand frame skipping;
- after settling and with no time-varying content, destination draws approach zero between invalidations.

### Explorer moving, medium quality, campaign desktop

- GPU proxy/background pass goal: ≤ ~1.5–2 ms median;
- main-thread spatial orchestration goal: ≤ ~1 ms median;
- no repeated long task > 50 ms during ordinary focus changes;
- no per-frame heap growth;
- no monotonically increasing GPU resource counts.

### Initial catalog

- essential catalog payload target: ≤ ~500 KB compressed unless evidence justifies more;
- parse/validate must not produce a user-visible blocking stall.

### Transition

- target preparation begins early enough that a warm/cached destination normally does not stall at the handoff boundary;
- no indefinite overlap of heavy GPU resources.

All claims must record actual hardware/backend/resolution.

---

# 27. Renderer cost controls

## 27.1 Instancing

Use instancing for repeated proxies/reticles.

## 27.2 Frustum culling

Do not mark proxy layers `frustumCulled=false` without evidence.

## 27.3 Background detail

Distance/magnitude/quality based.

## 27.4 Labels

Only a bounded visible subset.

## 27.5 On-demand rendering

Leverage the performance campaign’s invalidation architecture.

Spatial camera motion generates invalidation.

When settled, static Explorer sleeps.

## 27.6 Worker policy

Do not move the renderer to OffscreenCanvas by default.

Use workers only if measured:

- catalog decode;
- checksum;
- index construction;
- large coordinate transform batch;
- future large star catalog parsing.

Current application’s known JS orchestration cost is small relative to strong-field GPU work, so a renderer-worker rewrite is not justified by default.

## 27.7 Compute policy

WebGPU compute is optional.

Do not make Explorer baseline depend on compute because WebGL2 fallback remains required.

---

# 28. UI redesign

The spatial experience should reduce permanent chrome.

## 28.1 Persistent UI

Recommended:

- top-left: Cosmic Atlas + Search;
- top-right: Experience mode / Settings / Controls;
- bottom-left: physical scale + focus hierarchy;
- bottom-center: timeline only when meaningful;
- right/left contextual card: selected object;
- subtle reticles/labels in viewport.

Top destination chips remain as fallback during beta, then move into:

- search;
- category menu;
- “Explore phenomena” panel.

## 28.2 Focus card

Show:

- name;
- type;
- reality class in user-friendly language;
- distance;
- physical size/mass if sourced;
- coordinate/time context;
- destination availability;
- fidelity summary;
- “Travel” / “Open simulation”;
- sources/about.

## 28.3 Scale readout

Always indicate current scale:

```text
2.4 AU
4.1 pc
8.3 kpc
15 Mpc
```

Do not display fake “speed of travel” as physics unless explicitly cinematic.

## 28.4 Breadcrumb

Examples:

```text
Milky Way > Galactic Center > Sagittarius A*
```

Conceptual:

```text
Phenomena Lab > Compact Merger > Kilonova
```

This clarifies when the user is in physical space versus a conceptual/scientific scenario.

---

# 29. URL and state design

Preserve all existing routes.

Add canonical Explorer route:

```text
/atlas/explore
```

Shareable state:

```text
/atlas/explore?focus=sagittarius-a-star
```

Optional stable parameters after design review:

- focus;
- band;
- orientation;
- log range;
- epoch;
- filters.

Do not serialize raw camera matrices or unstable implementation fields unless versioned.

## 29.1 Direct destination routes

Existing:

```text
/atlas/black-hole
/atlas/neutron-star
...
```

remain valid.

A direct local route may show:

- “Return to Atlas” when a spatial mapping exists;
- fallback conceptual return when it does not.

---

# 30. Scientific/cinematic separation

## Scientific mode

- physical distances/units;
- frame/epoch disclosures;
- restrained proxy exaggeration;
- visible note when an object has display exaggeration;
- sourced metadata;
- no fake current events.

## Cinematic mode

May change:

- marker glow;
- travel streaking;
- bloom;
- exposure;
- transition duration;
- proxy emphasis.

May not change:

- identity;
- real vs conceptual status;
- coordinate;
- source;
- event epoch;
- scientific model label.

## Debug mode

Add:

- reference frame;
- current origin;
- scale band;
- camera relative coordinate;
- projected size;
- current representation;
- SSE;
- label priority;
- entity count;
- culled count;
- draw calls;
- GPU bytes;
- prefetch queue;
- pending destination;
- handoff phase;
- coordinate precision warning.

---

# 31. Spatial telemetry

Add `SpatialTelemetrySnapshot`:

```ts
interface SpatialTelemetrySnapshot {
  band: SpatialScaleBand;
  focusEntityId: string | null;
  visibleEntities: number;
  culledEntities: number;
  markerCount: number;
  proxyCount: number;
  labelCandidates: number;
  labelsPlaced: number;
  drawCalls: number;
  catalogBytesResident: number;
  relativeCoordinateMaxMagnitude: number;
  precisionMode: 'relative-f32'|'high-low';
  travelPhase: string;
  prefetchQueueDepth: number;
  pendingDestinationId: string | null;
}
```

No automatic remote analytics are required.

---

# 32. Testing strategy

## 32.1 Unit tests — coordinate math

- RA/Dec unit vector;
- Cartesian ↔ spherical round trip;
- degree/radian handling;
- unit conversion;
- ICRF transform fixtures;
- origin subtraction;
- band normalization;
- log-distance interpolation;
- projected-radius math;
- SSE;
- hysteresis;
- high/low encoding round trip;
- finite-value guards.

## 32.2 Catalog tests

- schema;
- duplicate ids;
- broken parent;
- invalid frame;
- invalid unit;
- missing source;
- invalid reality/destination relationship;
- event missing epoch;
- checksum;
- deterministic build.

## 32.3 Camera tests

- focus target remains centered;
- no NaN at very large/small ranges;
- cancel/retarget;
- range monotonicity;
- orientation shortest path;
- reduced motion;
- zoom clamps;
- handoff threshold.

## 32.4 Label tests

- collision;
- priority;
- selected always visible;
- parent aggregation;
- stable placement under small camera movements;
- bounds at viewport edges.

## 32.5 Browser tests

- Explorer boots;
- focus via pointer;
- focus via keyboard/search;
- manual zoom;
- browser back;
- deep link;
- rapid retarget;
- Explorer → Black Hole;
- Black Hole → Explorer;
- Explorer → Neutron Star;
- conceptual lab direct navigation;
- slow target preparation;
- cancelled target;
- resize;
- high DPR;
- hidden/resume;
- WebGL2;
- unsupported path;
- device loss if host contract applies.

## 32.6 Precision browser probes

At each band:

- render deterministic marker pairs;
- record projected coordinates;
- move focus origin;
- assert projected relative geometry remains stable within screen tolerance.

## 32.7 Visual goldens

Create explicit Explorer goldens:

- stellar-scale;
- galactic-scale;
- selected black hole;
- dense-label case;
- system aggregation;
- pre-handoff;
- reduced motion;
- mobile portrait.

Do not modify old destination goldens merely because Explorer exists.

## 32.8 Resource leak

Run at least:

```text
Explorer
→ Black Hole
→ Explorer
→ Neutron Star
→ Explorer
→ Quasar
→ Explorer
```

repeated 20–50 cycles.

Assert plateau:

- live scopes;
- materials/programs;
- textures;
- render targets;
- buffers;
- workers;
- listeners;
- timers;
- pending fetches;
- estimated GPU bytes.

---

# 33. Performance benchmarks

Create:

```text
bench:spatial-explorer
bench:spatial-focus
bench:spatial-labels
bench:spatial-handoff
bench:spatial-catalog
```

## 33.1 Synthetic catalog cases

- 100 entities;
- 1,000 entities;
- 10,000 entities;
- optional 100,000 stress only after architecture can support it.

Measure:

- transform CPU;
- cull CPU;
- label layout CPU;
- draw calls;
- GPU pass;
- heap;
- GPU estimate;
- interaction p95/p99;
- long tasks.

## 33.2 Handoff

Measure:

- target prepare latency;
- module fetch;
- asset fetch/decode;
- compile;
- first target frame;
- total user-visible handoff;
- peak GPU bytes;
- peak program count.

---

# 34. Accessibility and mobile gates

Required:

- every selectable object reachable through non-canvas UI;
- search keyboard usable;
- focus state announced;
- object metadata text available;
- reduced motion;
- touch targets large enough;
- mobile gesture conflicts tested;
- portrait/landscape;
- high DPR does not force unbounded internal pixels;
- Explorer can reduce label density and proxy detail independently from scientific destination quality.

Do not make precise 3D pointer selection the only way to use the product.

---

# 35. Failure handling

New explicit failure classes:

- `SPATIAL_CATALOG_INVALID`;
- `SPATIAL_COORDINATE_INVALID`;
- `SPATIAL_SOURCE_UNAVAILABLE_BUILD_TIME`;
- `SPATIAL_TARGET_PREPARE_FAILED`;
- `SPATIAL_HANDOFF_FAILED`;
- `SPATIAL_PRECISION_DEGRADED`;
- `SPATIAL_ROUTE_INVALID`.

Runtime policy:

- invalid individual nonessential entity: omit + diagnostics;
- invalid essential catalog: fail Explorer with useful message;
- destination preparation failure: remain in Explorer;
- handoff failure before source disposal: restore Explorer;
- failure after local activation: existing destination failure path;
- precision warning in Debug, never silently corrupt coordinates.

---

# 36. Rollout strategy

## Stage 1 — hidden developer route

```text
/atlas/explore?spatialDebug=1
```

No change to default root.

## Stage 2 — beta

Expose “Spatial Explorer (Beta)” in launch UI.

Existing chips remain primary fallback.

## Stage 3 — production optional

Make Explorer a first-class destination.

Search/deep links complete.

## Stage 4 — default landing

Only after full certification:

```text
/  → /atlas/explore
```

instead of root → black-hole.

Existing destination direct links remain stable.

## Stage 5 — simplify old chip UI

Move destination chips into search/category navigation after usage and accessibility validation.

Never remove a working navigation fallback before spatial navigation is certified.

---

# 37. Milestone roadmap

# SA0 — Re-audit and lock contracts

## Objective

Rebase this plan onto the completed performance campaign.

## Packets

### SA0-01 — Fresh repository evidence

Run:

```bash
git status --short
git rev-parse HEAD
git log -10 --oneline
node --version
npm --version
npm ci
npm run check
```

### SA0-02 — Read final performance certification

Compare final APIs against this plan:

- host invalidation;
- governor;
- TransitionDirector;
- active-pass lazy lifecycle;
- SharedPost;
- renderer init;
- catalog lazy chunks.

### SA0-03 — Spatial architecture ADR set

Create ADRs for:

1. CPU f64 + GPU relative f32;
2. scale bands;
3. ICRF catalog frame;
4. Explorer as lightweight destination;
5. separate local/spatial camera;
6. screen-space LOD;
7. real vs conceptual placement policy;
8. transition presentation modes;
9. no global depth-mode change in first implementation;
10. static offline source artifacts.

### SA0-04 — Baseline browser/perf evidence

Capture existing default behavior and resource counts before spatial changes.

### Exit gate

- performance campaign state understood;
- no conflicting central API assumption;
- ADRs reviewed;
- `npm run check` green;
- no runtime behavior changed yet.

---

# SA1 — Coordinate and catalog foundation

## Objective

Create scientific spatial state without rendering it.

## Packets

### SA1-01 `astroCoordinates.ts`

Implement:

- deg/rad;
- RA/Dec → unit vector;
- unit vector → RA/Dec;
- distance multiplication;
- Cartesian conversion;
- unit conversions.

### SA1-02 `ReferenceFrameService`

ICRF-only first.

Future frames fail closed until implemented.

### SA1-03 `OriginRebaser`

Binary64 subtraction and band normalization.

### SA1-04 `highLowEncoding.ts`

Utility + tests only.

### SA1-05 `angularSize.ts`

Projected radius/SSE helpers.

### SA1-06 entity schema

Reality class, source manifest, destination relationships.

### SA1-07 curated catalog

Start with a minimal scientifically defensible set.

Do not add a large catalog yet.

### SA1-08 build/validation tool

Checksums, schema, deterministic output.

### SA1-09 unit suite

Precision across bands.

### Exit gate

- zero rendering;
- deterministic catalog;
- coordinate/reference tests green;
- no source ambiguity.

---

# SA2 — Explorer skeleton

## Objective

Prove a lightweight spatial destination inside the existing host.

## Packets

### SA2-01 register `/atlas/explore`

Descriptor + preset.

### SA2-02 `SpatialExplorerModule`

Lifecycle:

- prepare;
- enter;
- update;
- render;
- exit;
- dispose.

### SA2-03 static background

Cheap deterministic star/background pass.

### SA2-04 first proxies

Render 10–20 deterministic anchors.

### SA2-05 resource scope

All Explorer resources tracked.

### SA2-06 debug snapshot

Entity/render counts.

### SA2-07 browser boot test

### SA2-08 leak switch

Explorer ↔ Diagnostic or cheap destination 20 times.

### Exit gate

Explorer is a valid host destination with bounded resources and no new renderer.

---

# SA3 — Spatial camera

## Objective

Make Explorer genuinely navigable.

## Packets

### SA3-01 `SpatialCameraController`

### SA3-02 log-range zoom

### SA3-03 orbit

### SA3-04 focus animation

### SA3-05 target retarget/cancel

### SA3-06 dynamic near/far policy

Explorer only.

### SA3-07 touch/pinch

### SA3-08 reduced motion

### SA3-09 URL focus state

### SA3-10 precision browser probes

### Exit gate

User can navigate several orders of magnitude with no visible jitter or route break.

---

# SA4 — Markers, labels, picking and search

## Objective

Make black space discoverable.

## Packets

### SA4-01 instanced marker layer

### SA4-02 projected physical-size calculation

### SA4-03 marker ↔ proxy crossfade

### SA4-04 parent/child aggregation

### SA4-05 label overlay

### SA4-06 collision/priority engine

### SA4-07 temporal label stability

### SA4-08 CPU screen-space picking

### SA4-09 search index

### SA4-10 accessible object list

### SA4-11 selected object card

### SA4-12 label/picking/browser tests

### Exit gate

A user can reliably find/select/focus objects without top chips.

---

# SA5 — Semantic zoom and scale bands

## Objective

Transition between astronomical scale domains without visual instability.

## Packets

### SA5-01 ScaleBandController

### SA5-02 band visibility policies

### SA5-03 band-specific unit normalization

### SA5-04 cross-band proxy overlap

### SA5-05 hysteresis

### SA5-06 band-specific label density

### SA5-07 band-specific motion tuning

### SA5-08 screen-space LOD

### SA5-09 synthetic stress catalog

### SA5-10 WebGL2 validation

### Exit gate

Solar/stellar/galactic/extragalactic prototype travel is stable and bounded.

---

# SA6 — Destination prewarm and continuous handoff

## Objective

Enter real local renderers without returning to menu-centric navigation.

## Packets

### SA6-01 destination spatial link contract

### SA6-02 PrefetchScheduler

### SA6-03 target module prefetch

### SA6-04 minimum-ready preparation

### SA6-05 compileAsync integration

### SA6-06 TransitionDirector presentation modes

### SA6-07 continuous-handoff path

### SA6-08 angular-size matched arrival

### SA6-09 failure rollback

### SA6-10 rapid retarget race suite

### SA6-11 Black Hole first production handoff

### SA6-12 Neutron Star second handoff

### Exit gate

Explorer → Black Hole and Explorer → Neutron Star are repeatably seamless, leak-free, and scientifically unchanged.

---

# SA7 — Return-to-Atlas

## Objective

Make navigation bidirectional.

## Packets

### SA7-01 local destination return affordance

### SA7-02 Explorer matching-entry frame

### SA7-03 snapshot-based local exit

### SA7-04 wheel/pinch boundary research

### SA7-05 browser back semantics

### SA7-06 conceptual fallback context

### SA7-07 repeated bidirectional tour test

### Exit gate

A user can travel in and out without stale state, leaks, or fake positions.

---

# SA8 — Scientific spatial catalog

## Objective

Replace prototype positions with source-locked production anchors.

## Packets

### SA8-01 source policy

### SA8-02 ICRF catalog manifest

### SA8-03 JPL Horizons offline tool for solar objects where used

### SA8-04 curated compact-object anchors

### SA8-05 curated historical events

### SA8-06 quasar/AGN anchors

### SA8-07 reality-class/fidelity audit

### SA8-08 provenance UI

### SA8-09 temporal semantics

### SA8-10 source/reproduction tests

### Exit gate

Every production spatial marker can answer “what is this, where did this position come from, what epoch is it, and what exactly does the linked renderer claim?”

---

# SA9 — Destination integration expansion

## Objective

Map all current destinations honestly.

## Packets

- SA9-BH Black Hole
- SA9-NS Neutron Star
- SA9-SE Stellar Explosion
- SA9-CM Compact Merger conceptual path
- SA9-TDE Tidal Disruption
- SA9-QSO Quasar/AGN
- SA9-BBM Black-Hole Merger reference-scenario path
- SA9-GC Galaxy Collision reference-scenario path

Each packet requires:

- reality classification;
- source relationship;
- search/taxonomy;
- entry;
- exit;
- fidelity copy;
- test;
- resource proof.

### Exit gate

All eight are reachable through the new experience without scientific misrepresentation.

---

# SA10 — Advanced visual continuity

## Objective

Improve “one universe” perception after the architecture is proven.

Candidates, each separately evidence-gated:

- ICRF-aligned real star background;
- more detailed galaxy proxies;
- category-specific transition visuals;
- physically sourced object textures;
- improved light/exposure continuity;
- real proper motion/time-aware star field;
- historical event timeline overlays.

Do not let SA10 block SA6–SA9 functionality.

---

# SA11 — Performance and constrained-device hardening

## Objective

Certify the new layer is cheaper than what it orchestrates.

## Packets

### SA11-01 Explorer on-demand idle

### SA11-02 draw-call audit

### SA11-03 label CPU audit

### SA11-04 catalog transform audit

### SA11-05 KTX2/new asset audit

### SA11-06 prefetch bandwidth/concurrency

### SA11-07 memory plateau

### SA11-08 mobile profile

### SA11-09 WebGL2

### SA11-10 Firefox

### SA11-11 device-loss

### SA11-12 stress catalog

### SA11-13 long-run thermal/power proxy

### Exit gate

No Critical/High performance/resource defect and benchmark report complete.

---

# SA12 — Product integration and release

## Objective

Promote Spatial Explorer from beta to product shell.

## Packets

### SA12-01 UI polish

### SA12-02 full keyboard/touch accessibility

### SA12-03 final route policy

### SA12-04 root redirect decision

### SA12-05 legacy destination chips demotion, not premature deletion

### SA12-06 full browser tour

### SA12-07 full unit suite

### SA12-08 full existing destination suite

### SA12-09 visual goldens twice-stable

### SA12-10 performance certification

### SA12-11 provenance audit

### SA12-12 release documentation

### SA12-13 `.agent` control-plane update

### Exit gate

- P0 = 0;
- P1 = 0;
- existing scientific parity intact;
- Explorer release evidence complete;
- all direct routes still work;
- no false spatial claims;
- repository clean;
- OpenSpec closed truthfully.

---

# 38. Parallelization policy

Safe parallel lanes after SA0:

### Lane A — coordinate/reference math

Files under spatial/math + tests.

### Lane B — catalog tooling/provenance

`tools/spatial-data`, manifests.

### Lane C — UI/search prototype

Only after entity schema freezes.

### Lane D — visual proxy prototype

Only Explorer-owned files.

### Lane E — test harness

Browser support/test helpers.

Single-owner integration-sensitive files:

- `host.ts`;
- `TransitionDirector.ts`;
- `atlasApp.ts`;
- `types.ts` if core contracts are touched;
- renderer kernel;
- global governor;
- route/state schema.

The main agent is integrator.

---

# 39. Anti-patterns / explicit prohibitions

Do not:

1. widen `CameraRig` to enormous distances and call the problem solved;
2. use one f32 world coordinate system from meters to megaparsecs;
3. instantiate all destinations so zoom feels instant;
4. run multiple heavy scientific renderers simultaneously;
5. fake real sky positions for generic simulations;
6. label a representative procedural renderer as an exact observed object reconstruction;
7. make spacecraft/compact objects physically enormous without exposing display exaggeration semantics;
8. use one `Mesh` per star for large catalogs;
9. use distance-only LOD for objects whose sizes differ by orders of magnitude;
10. add log-depth globally solely because Stellamap uses it;
11. add reverse-Z globally without complete compatibility evidence;
12. change black-hole physics to fit spatial abstractions;
13. weaken old goldens/parity to land spatial UX;
14. fetch live scientific APIs on every user visit;
15. serialize unstable internal state into URLs;
16. make mouse-only canvas picking the only discovery mechanism;
17. block the app on high-detail assets before showing a usable Explorer;
18. precompile every destination/preset on boot;
19. introduce WebGPU compute as a hard Explorer requirement;
20. add OffscreenCanvas renderer migration without a measured main-thread bottleneck.

---

# 40. Definition of done

Spatial Atlas V2 is not complete because it looks impressive in one video.

It is complete when:

## Product

- Explorer is a first-class usable environment;
- user can discover, search, select and focus;
- user can travel across scale bands;
- at least the primary spatially defensible destinations hand off seamlessly;
- all existing destinations remain reachable;
- return-to-atlas works;
- deep links work;
- reduced motion works.

## Scientific

- ICRF/reference-frame policy explicit;
- every coordinate source documented;
- every event has time semantics;
- real vs representative vs conceptual is visible;
- no current scientific destination claims weakened or overstated;
- existing parity/reference tests pass.

## Precision

- no visible large-world jitter in certified scale cases;
- rebasing tests pass;
- no f32 absolute-coordinate misuse in production Explorer;
- all coordinate transforms finite and validated.

## Performance

- Explorer does not become a heavy continuous GPU load;
- on-demand idle works where semantically valid;
- marker/proxy draw calls are bounded;
- labels are bounded;
- catalog parsing does not cause unacceptable long tasks;
- target preparation does not create unbounded overlaps;
- resource counts plateau.

## Compatibility

- WebGPU;
- WebGL2 fallback;
- Chromium;
- documented Firefox matrix;
- mobile emulation plus real-device evidence where available;
- accessibility.

## Evidence

- unit tests;
- browser tests;
- precision probes;
- twice-stable goldens;
- benchmark report;
- resource torture;
- final documentation;
- `.agent/STATE.md` updated;
- P0/P1 zero.

---

# 41. Recommended implementation order in one line

```text
finish performance campaign
→ SA0 re-audit
→ coordinate/catalog
→ Explorer
→ spatial camera
→ markers/labels/search
→ scale bands/SSE
→ prewarm + handoff
→ return path
→ source-locked production catalog
→ all-destination mapping
→ visual continuity
→ performance/mobile/accessibility hardening
→ release
```

---

# 42. Core engineering thesis

The project should not become “Stellamap plus black holes.”

It should become a more ambitious architecture:

> **a spatially navigable scientific experience in which a lightweight real-space atlas is the connective tissue between specialized local renderers.**

The Atlas owns:

- where;
- what;
- discoverability;
- scale;
- context;
- travel;
- source/time metadata.

The destination owns:

- local physics;
- local simulation;
- local controls;
- local scientific fidelity.

The transition/handoff layer owns:

- continuity.

That separation is what makes the vision achievable without destroying the scientific and performance work already completed.