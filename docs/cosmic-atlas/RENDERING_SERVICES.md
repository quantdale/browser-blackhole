# Shared rendering services specification

## 1. Purpose

Shared renderer services are the architectural leverage that makes Cosmic Atlas feasible. Destination modules should compose these services rather than building independent particle, volume, trajectory, field and post-processing engines.

This document defines service boundaries strongly enough that different agents can implement destinations without duplicating core GPU infrastructure.

## 2. Frame graph concept

Not every destination uses every pass.

```text
optional compute updates
    ├─ particles
    ├─ tracers
    ├─ fields
    └─ culling
        ↓
destination opaque/surface pass
        ↓
optional lens/ray pass
        ↓
optional volume pass
        ↓
optional additive particles/ribbons/jets
        ↓
shared HDR target
        ↓
post-processing
        ↓
transition composite if active
        ↓
canvas
```

Passes declare dependencies and temporary resource needs.

## 3. ParticleService

### Use cases

- supernova ejecta;
- compact-merger ejecta;
- jet particles;
- galaxy stars/gas visual tracers;
- TDE debris accents;
- CME/solar particles.

### Required particle fields

Base packed representation should support a subset of:

- position;
- velocity;
- age/lifetime;
- seed/id;
- size;
- emissivity/intensity;
- class/channel;
- optional temperature/scalar.

Do not allocate unused channels for every destination if specialized layouts save significant memory.

### API concept

```ts
interface ParticleSystemHandle {
  capacity: number;
  activeCount: number;
  update(ctx: ComputeContext): void;
  render(ctx: RenderContext): void;
  setQuality(q: ParticleQuality): void;
  dispose(): void;
}
```

### GPU update

On WebGPU-capable path:

- persistent storage buffers;
- compute dispatch;
- stable capacity;
- avoid CPU readback;
- optional ping-pong only when needed.

Fallback may use transform-like CPU/vertex paths at reduced counts if practical.

### Rendering

Support:

- points;
- camera-facing billboards;
- instanced low-poly geometry;
- additive or alpha blend;
- depth-aware fading.

No one `Mesh` object per particle.

## 4. VolumeService

### Use cases

- supernova ejecta;
- kilonova volume;
- AGN corona;
- shock regions;
- stellar-merger ejecta;
- solar corona/CME.

### Density source contract

Volume density may come from:

- procedural function;
- analytic SDF/shell;
- 3D texture;
- sparse/brick field;
- combination.

The service should not force one representation.

### Render contract

Inputs:

- volume bounds;
- density/emission function/data;
- camera/depth;
- max samples;
- step policy;
- transfer function;
- extinction/opacity approximation;
- jitter seed;
- quality tier.

Outputs:

- HDR radiance/alpha;
- optional depth/moment metadata for composite.

### Optimization

- render at configurable fraction of internal resolution;
- early ray-box miss;
- empty-region skip where representable;
- early alpha termination;
- blue-noise/temporal jitter;
- depth-aware upsample;
- cap expensive shadow/self-absorption.

## 5. RibbonService

### Use cases

- TDE debris stream;
- jets;
- orbit trails;
- magnetic/coronal structures;
- CME flux-rope-inspired visuals.

### Representation

Prefer GPU-expanded strip/tube from control points or batched geometry.

Attributes:

- centerline points;
- width/radius;
- emissivity;
- age/phase;
- color/temperature scalar;
- optional twist/noise.

Quality controls:

- segment count;
- tube radial segments;
- screen-space width threshold;
- distance culling.

## 6. TrajectoryService

### Modes

1. analytic parametric trajectory;
2. sampled spline;
3. data-driven keyframe trajectory;
4. phase-aware piecewise mapping.

### Requirements

- deterministic evaluation at arbitrary timeline position;
- no dependence on prior frame for scrub correctness unless explicitly stateful;
- interpolation method recorded in metadata;
- derivative/velocity optionally available;
- unit/coordinate conversion centralized.

### Use cases

- compact inspiral;
- TDE encounter;
- binary black-hole data;
- galaxy center tracks;
- camera cinematic paths.

## 7. FieldLineService

### Use cases

- pulsar/magnetar dipole-like field visual;
- solar coronal magnetic visual;
- pedagogical vector fields.

### Rule

Field lines are visualization geometry. Unless the field is computed from a validated physical model, UI must not present them as measured exact magnetospheric structure.

### Modes

- analytic dipole;
- sampled vector field;
- imported data field;
- procedural twisted field for illustrative magnetar mode with explicit label.

## 8. LensingService

### Goals

Expose strong/weak lens rendering capabilities without erasing distinctions between models.

Potential interfaces:

- `BlackHoleLensingBackend` — existing Schwarzschild/Kerr renderer;
- `CompactSurfaceRayBackend` — neutron-star surface intersection;
- `ThinLensBackend` — Lensing Lab/large-scale educational lensing;
- `ApproximateMultiLensBackend` — only if explicitly labeled and validated for visual use.

Do not pretend one generic lens-distortion function is scientifically valid for all cases.

## 9. SharedPost

Centralize:

- HDR target format;
- exposure;
- tone mapping;
- bloom;
- optional glare;
- color conversion;
- final compositing.

Destinations supply physical radiance/emissive values under their model. Cinematic multipliers live in visual state, not hidden inside physics shaders.

## 10. GPU resource allocation

Each service allocation belongs to either:

- shared bounded cache;
- destination ResourceScope;
- transient frame resource pool.

No ownerless GPU object.

## 11. Shader organization

Prefer small domain functions with stable contracts:

```text
shared/shaders/
  noise/
  blackbody/
  camera/
  volume/
  particles/
  transfer-functions/
  post/
  transition/
```

Destination-specific shaders remain under `phenomena/<id>/shaders`.

Do not build one universal shader with dozens of destination branches.

## 12. Precision

Use f32 on GPU by default. Use f16 only after capability detection and error/visual testing for appropriate noncritical buffers/passes.

Physics-sensitive ray calculations should not be casually moved to f16.

## 13. Compute workgroup tuning

Do not assume one workgroup size is optimal everywhere.

For every significant compute system:

- inspect device limits;
- benchmark representative sizes;
- avoid excessive shared memory/register pressure;
- keep dispatch dimensions explicit in telemetry/debug.

## 14. Indirect draw/culling

Advanced optimization candidate for large tracer/particle scenes:

- compute visibility/active count;
- compact or prefix-sum where justified;
- indirect draw if Three.js/WebGPU path exposes a maintainable mechanism.

Do not add complexity before profiler evidence shows draw/vertex waste matters.

## 15. Temporal techniques

Temporal accumulation is service-specific:

- black-hole/ray renderer may accumulate/refine;
- volume ray marcher may jitter samples;
- post may use temporal stabilization;
- particle motion should not smear through stale history.

Global invalidation reasons include:

- camera move;
- destination state change;
- timeline change;
- quality change;
- target resize;
- backend/device generation change;
- route/preset switch.

## 16. Debug hooks

Every service exposes bounded debug metadata:

ParticleService:

- active/capacity;
- buffer bytes;
- compute time if available.

VolumeService:

- resolution;
- max/average samples where measurable;
- target bytes;
- GPU time.

TrajectoryService:

- source/data ID;
- current interval/keyframe;
- interpolation mode.

ResourceScope:

- current owned resources by type.

Debug instrumentation must not require readback of huge GPU buffers each frame.