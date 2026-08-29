# Design — Cinematic Visual Fidelity Overhaul

## Design principles

1. The model remains the source of truth. A destination passes resolved model
   values into representation handles; representation code never changes the
   model or computes a competing timeline.
2. A small set of deep shared primitives is preferable to one-off per-scene
   shader forks. Each primitive owns its shader contract, seeded inputs,
   quality scaling, and disposal behavior.
3. Geometry gives structure; post-processing gives display response. Bloom is
   allowed to reveal HDR radiance but cannot be the source of morphology.
4. The same TSL graph must be valid on WebGPU and WebGL2. Visual degradation is
   explicit and quality-governed.

## Representation contracts

### Surface

`createCinematicSurfaceMaterial` consumes color, radiance, temperature/ramp,
seed, time, and optional deformation supplied by the destination. It applies
analytic view-angle limb response, bounded seeded granulation, and an HDR rim
term. It is still an emissive visualization surface, not a claim of full
stellar atmosphere or radiative transfer.

### Atmosphere / halo

`createCinematicHalo` is an optically thin additive shell. Its alpha is an
analytic radial/view-angle profile and its radius is tied to the source
representation. It does not occlude the background or alter physics.

### Backdrop

`createCinematicBackdrop` is a bounded inside-facing sphere using a seeded
directional star/dust field. It is rendered before destination objects with
depth testing disabled. The sphere radius tracks the camera distance so it
cannot clip at the current destination's far plane. It is omitted where a
full-screen validated lensing pass already supplies the environment.

### Disc / ring

Disc materials consume a model-resolved radius, temperature/gain, and phase.
Radial falloff, differential-rotation pattern, and emissive rim are
presentation structure. A disc is never substituted for a ray-traced disk in
the Black Hole, Quasar/AGN INNER, or Neutron Star direct paths.

## Determinism

The seed is folded into fixed shader hash inputs. Time is a destination/model
coordinate or the shared deterministic timeline value; it is never
`performance.now()` or shader global time. Paused frames have no visual noise
jitter. Every handle update is idempotent for equal inputs.

## Resource ownership

Every factory-created geometry/material is registered with the prepared
destination `ResourceScope`. A destination may drop the handle reference at
exit, but the scope owns disposal. Async preparation is generation/abort-safe
through the existing host transition contract.

## Quality/performance

The global quality tier controls backdrop octave count, halo tessellation,
volume active steps, sprite population, and ribbon detail through one shared
budget. No per-destination FPS controller is introduced. Full-screen passes
remain one triangle; secondary representations remain bounded.
