# Cosmic Atlas architecture

## 1. Runtime topology

```text
DOM / route / destination selector
              │
              ▼
       CosmicAtlasHost
              │
   ┌──────────┼───────────┐
   ▼          ▼           ▼
Registry   Transition   Global State
              │
              ▼
       Resource Manager
              │
              ▼
      Shared Renderer Kernel
              │
   ┌──────────┼───────────┐
   ▼          ▼           ▼
particles   volumes     lensing ...
              │
              ▼
       Active Destination
              │
              ▼
        HDR/post/canvas
```

## 2. Proposed repository layout

```text
src/
  atlas/
    CosmicAtlasHost.ts
    DestinationRegistry.ts
    NavigationController.ts
    TransitionDirector.ts
    ResourceManager.ts
    TimeController.ts
    atlasState.ts
    routes.ts

  renderer/
    # existing black-hole renderer code remains
    shared/
      CameraRig.ts
      PerformanceGovernor.ts
      ParticleService.ts
      VolumeService.ts
      RibbonService.ts
      TrajectoryService.ts
      FieldLineService.ts
      LensingService.ts
      SharedPost.ts
      ResourceScope.ts

  phenomena/
    black-hole/
    neutron-star/
    stellar-explosion/
    compact-merger/
    black-hole-merger/
    tidal-disruption/
    quasar/
    galaxy-collision/
    stellar-merger/
    solar-activity/
    lensing-lab/

  data/
    manifests/
    binary/

  ui/
    atlas/
      DestinationSelector.ts
      DestinationPanel.ts
      TimelineControl.ts
      FidelityBadge.ts
      LoadingStatus.ts

public/
  cosmic-data/
  cosmic-assets/

tools/
  cosmic-data/
    fetch/
    normalize/
    validate/
    reduce/
    compress/
    manifests/
```

Create only files needed by current milestone; this is the target topology.

## 3. Destination descriptor

Each destination is registered using a serializable descriptor conceptually equivalent to:

```ts
interface PhenomenonDescriptor {
  id: string;
  title: string;
  group: 'compact' | 'catastrophe' | 'galactic' | 'expansion' | 'lab';
  fidelity: FidelityClass;
  route: string;
  defaultPreset: string;
  requiredCapabilities: CapabilityRequirement[];
  estimatedGpuMemoryMB: Record<QualityTier, number>;
  load: () => Promise<PhenomenonModuleFactory>;
}
```

Metadata must be loadable without importing the heavy destination module.

## 4. Module lifecycle

Conceptual contract:

```ts
interface PhenomenonModule {
  readonly descriptor: PhenomenonDescriptor;

  prepare(ctx: PrepareContext): Promise<PreparedPhenomenon>;
  enter(ctx: EnterContext): Promise<void> | void;
  update(ctx: FrameContext): void;
  render(ctx: RenderContext): void;
  exit(ctx: ExitContext): Promise<void> | void;
  dispose(): void;

  serializeShareState?(): object;
  getDebugSnapshot?(): object;
}
```

### `prepare()`

Allowed:

- dynamic import resolution;
- manifest fetch;
- binary asset fetch;
- texture decode;
- worker preprocessing;
- shader/material graph construction;
- pipeline warm-up where possible;
- bounded GPU resource allocation.

Must be abortable when user changes destination again.

### `enter()`

- bind camera preset;
- activate timeline/state;
- attach destination panel;
- register active render passes;
- reset temporal/history resources.

### `update()`

- deterministic time update;
- compute dispatches/particle simulation as applicable;
- camera-relative LOD;
- quality-tier response.

### `render()`

- destination render passes into shared HDR target or defined compositor inputs.

### `exit()`

- stop simulation clocks;
- freeze or produce outgoing scene snapshot if transition needs it;
- detach controls/listeners;
- cancel optional background work.

### `dispose()`

- release all scene-local GPU/CPU resources;
- terminate workers;
- abort requests;
- remove event listeners;
- clear destination caches not designated shared.

## 5. Resource scopes

Every destination gets a `ResourceScope`.

It tracks ownership explicitly instead of relying on garbage collection.

Required counters:

- textures;
- cube/3D textures;
- buffers;
- storage buffers;
- geometries;
- render targets;
- materials/node graphs;
- workers;
- listeners;
- timers;
- pending fetches;
- estimated GPU bytes.

Debug mode should expose current shared and destination-local inventory.

Repeated navigation must not produce monotonic growth outside bounded caches.

## 6. Shared renderer kernel

### Renderer/device

Owns:

- Three.js renderer instance;
- WebGPU/WebGL2 backend selection. The WebGL2 fallback (and the dev/test
  `?backend=webgl2` override) boots `WebGPURenderer` pinned to its WebGL2
  backend (`forceWebGL`) — the classic `THREE.WebGLRenderer` cannot build TSL
  node materials in three r185, so every destination compiles through the same
  node system on both APIs;
- device-loss recovery integration;
- canvas sizing;
- shared frame graph/post-processing;
- common HDR color management.

### CameraRig

Supports:

- orbit/free camera;
- destination arrival framing;
- timeline-driven cinematics;
- physically defined observer states where a destination supports them;
- transition departure/arrival transforms;
- reduced-motion mode.

### PerformanceGovernor

Owns:

- frame-time target;
- render scale;
- interaction/settling/stable quality mode;
- quality downgrade/upgrade hysteresis (raise condition is refresh-aware:
  the raise bar is capped by the estimated compositor cadence minus a small
  margin so vsync-locked displays can still qualify; a wall-clock startup
  grace window suppresses tier changes across pipeline compilation);
- destination-provided work multipliers, resolved against the ACTIVE
  destination (`setActiveDestination` host lifecycle hook); before any
  activation signal the heaviest registered multiplier is used as fallback;
- GPU timestamp integration when available.

### ParticleService

Provides GPU-resident particle/tracer infrastructure:

- storage-buffer state on WebGPU;
- point/billboard/instanced rendering;
- spawn/age/lifetime fields;
- optional compute update;
- deterministic seeded initialization;
- quality-controlled population.

### VolumeService

Provides:

- bounding-volume intersection;
- procedural density callbacks;
- optional 3D texture sampling;
- adaptive/quality-controlled ray steps;
- half/quarter-resolution targets;
- early alpha termination;
- temporal jitter/accumulation hooks;
- depth-aware composite.

### RibbonService

For:

- tidal streams;
- jets;
- trails;
- CME structures;
- orbit paths;
- field visualization.

### TrajectoryService

Interpolates:

- analytic orbits;
- spline trajectories;
- precomputed binary data;
- phase-aware time mapping.

### FieldLineService

For magnetic/dipole/coronal visualizations. Field lines are visualization geometry, not a claim of full MHD.

### LensingService

Must be able to wrap the existing black-hole lensing renderer and later expose reduced lensing APIs to neutron-star/lensing-lab/AGN features without weakening black-hole correctness.

## 7. Frame lifecycle

Recommended:

```text
input/state changes
      ↓
route/destination coordinator
      ↓
transition state update
      ↓
global performance governor
      ↓
active destination update
      ↓
compute passes
      ↓
destination render passes
      ↓
shared HDR/post
      ↓
transition composite if active
      ↓
telemetry
```

During the director-owned opaque `hyperspace` phase, the frame plan carries a
`destinationDrawSuppressed` decision. The kernel still runs the active
`destination`'s `update()` and the shared post/transition presentation, but
skips only `destination.render()`. This preserves required simulation and
transition state advancement without spending draw work on pixels guaranteed
to be hidden. The suppression decision is derived from the runtime transition
phase; persisted/public state cannot independently force occlusion.

## 8. Time model

Astrophysical destinations span milliseconds to billions of years.

Use a destination time controller separating:

- `displayTime` — what UI shows;
- `simulationPhase` — normalized or piecewise time coordinate;
- `physicalTime` — seconds/days/years where meaningful;
- `playbackRate` — user-selected visual speed.

Compact Merger and Galaxy Collision require nonlinear phase mappings.

Do not pretend one uniform seconds-per-frame scale works for every phase.

## 9. State separation

Global Atlas state:

- current destination;
- target destination;
- transition phase;
- route/preset;
- shared visual settings;
- global quality;
- accessibility preferences.

Destination state remains namespaced and schema-versioned.

URL serialization should include only stable public state, not internal buffers or telemetry.

## 10. Capability policy

Destinations declare hard and soft capabilities.

Examples:

- WebGPU compute: soft for most destinations, hard only if no fallback exists;
- float render target: may be required for high-quality HDR;
- timestamp query: optional telemetry;
- compressed texture formats: optional optimization;
- storage buffers: WebGPU optimization with alternate paths where practical.

Capability downgrade must be visible in debug/quality UI.

## 11. Memory lifecycle during travel

Preferred sequence:

```text
A active
↓
B metadata/import/assets prefetch
↓
transition starts
↓
A expensive simulation throttled
↓
B minimum-ready GPU allocation
↓
occlusion point
↓
A scene-local heavy resources released
↓
B activated at conservative quality
↓
arrival
↓
optional B high-quality resources stream in
```

Do not keep every destination's full GPU state resident for instant travel.

## 12. Cache policy

Keep bounded shared caches for:

- common noise textures;
- common star field;
- KTX2 transcoders;
- shader/node graphs proven reusable;
- small immutable binary assets;
- recently used destination CPU-side compressed data if memory budget allows.

Cache size must be observable and evictable.
