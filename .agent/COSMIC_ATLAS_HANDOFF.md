# Cosmic Atlas autonomous implementation handoff

This file is the entry point for a fresh implementation agent working on the multi-phenomenon expansion of `browser-blackhole`.

## Mission

Extend the existing black-hole renderer into **Cosmic Atlas**: one browser application containing a curated set of interactive astrophysical destinations connected by a cinematic hyperspace transition system.

Do not implement every named phenomenon as an independent application. Build one shared runtime, one renderer lifecycle, one quality governor, one transition system, and multiple phenomenon modules.

The existing black-hole M0-M11 plan remains authoritative for the black-hole renderer itself. Cosmic Atlas is an additional workstream with CA-series milestones.

## Read before coding

1. `AGENTS.md`
2. `.agent/STATE.md`
3. `.agent/EXECUTION_PROTOCOL.md`
4. `.agent/QUALITY_GATES.md`
5. `docs/cosmic-atlas/README.md`
6. `docs/cosmic-atlas/SELECTION_AND_TAXONOMY.md`
7. `docs/cosmic-atlas/DECISIONS.md`
8. `docs/cosmic-atlas/ARCHITECTURE.md`
9. `docs/cosmic-atlas/PRODUCT_UX_AND_TRANSITIONS.md`
10. `docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md`
11. `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md`
12. `docs/cosmic-atlas/PERFORMANCE_HARDWARE.md`
13. `docs/cosmic-atlas/DATA_PIPELINE.md`
14. `docs/cosmic-atlas/VALIDATION_TESTING.md`
15. `docs/cosmic-atlas/ROADMAP.md`
16. `docs/cosmic-atlas/WORK_PACKETS.md`

## Launch taxonomy

Top-level destinations:

- Black Hole
- Neutron Star
- Stellar Explosion
- Compact Merger
- Black-Hole Merger
- Tidal Disruption
- Quasar / AGN
- Galaxy Collision

Expansion destinations:

- Stellar Merger
- Solar Activity

Shared lab:

- Gravitational Lensing Lab

Do not promote these to separate top-level destinations without a product decision:

- Pulsar -> Neutron Star preset
- Magnetar -> Neutron Star preset
- Magnetar Flare -> Neutron Star event mode
- Hypernova -> Stellar Explosion preset
- Long GRB -> Stellar Explosion jet/collapsar scenario
- Kilonova -> Compact Merger aftermath phase
- Short GRB -> Compact Merger jet/viewing-angle phase
- Luminous Red Nova -> Stellar Merger outcome
- Einstein Ring -> Lensing Lab alignment case
- Blazar -> Quasar / AGN observer-orientation preset

## Core architecture rule

Never create one independent Three.js app per phenomenon.

The target topology is:

```text
CosmicAtlasHost
├─ DestinationRegistry
├─ NavigationController
├─ TransitionDirector
├─ ResourceManager
├─ PerformanceGovernor
├─ TimeController
├─ Telemetry
└─ SharedRendererKernel
   ├─ WebGPURenderer / fallback
   ├─ CameraRig
   ├─ HDR + tone mapping + bloom
   ├─ ParticleService
   ├─ VolumeService
   ├─ RibbonService
   ├─ TrajectoryService
   ├─ FieldLineService
   └─ LensingService
```

Only one heavy destination is fully active at a time.

## First Cosmic Atlas milestone

Begin with **CA0 — Destination host and lifecycle**, only after the black-hole application has enough stable renderer infrastructure to host a module cleanly.

CA0 must prove:

1. destination registry;
2. lazy module loading;
3. one shared renderer;
4. enter/update/render/exit/dispose lifecycle;
5. resource scoping;
6. URL-addressable destination state;
7. repeated destination switching without leaks;
8. black-hole destination wrapped without physics regression;
9. diagnostic second destination proving the architecture before adding a real new astrophysical simulation.

Then CA1 implements the hyperspace transition/loading boundary.

## Hard constraints

- Never claim full fluid/MHD/numerical-relativity simulation when the browser is rendering a reduced or procedural model.
- Every phenomenon declares a fidelity class: `DIRECT`, `DATA_DRIVEN`, `PROCEDURAL_SCIENTIFIC`, or `CINEMATIC`.
- Full numerical relativity, hydrodynamics, MHD, and large N-body simulations belong offline unless a reduced browser solver is explicitly validated.
- No O(N^2) all-pairs galaxy gravity in the production browser renderer.
- No CPU per-particle update loops at large scale when GPU storage/instancing is appropriate.
- No million-object Three.js scene graphs. Use GPU buffers, instancing, points, billboards, ribbons, or volumes.
- Hyperspace is a cinematic transition, not a scientific physical model; label it accordingly.
- `prefers-reduced-motion` must replace hyperspace motion with a short non-vestibular transition.
- A destination is not complete because it looks impressive. It must pass scientific scope, deterministic state, browser, disposal, performance, and validation gates.

## Agent checkpoint contract

For every Cosmic Atlas checkpoint record:

- CA milestone and packet IDs;
- destination(s) affected;
- fidelity class;
- scientific approximations used;
- renderer/services added or reused;
- asset/data provenance;
- exact tests/benchmarks run;
- browser/backend/GPU actually tested;
- transition/disposal evidence when relevant;
- known limitations;
- next packets;
- commit SHA.

Do not silently rewrite the existing black-hole scientific contracts to make another destination easier. Shared abstractions must preserve the strongest existing correctness guarantees.