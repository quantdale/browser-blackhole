# Cosmic Atlas — multi-phenomenon expansion plan

## 1. Product intent

Cosmic Atlas evolves `browser-blackhole` from a single astrophysical renderer into a curated, interactive browser atlas of extreme cosmic phenomena.

The product should feel like one continuous universe, not a collection of unrelated demos. A persistent destination selector lets the user move between phenomena. Selecting another destination begins a polished hyperspace/interstellar travel transition while the next module is prepared, then arrives in a fully interactive scene.

The implementation must preserve the original black-hole project's strongest properties:

- GPU-first rendering;
- explicit scientific conventions;
- measured performance work;
- graceful capability degradation;
- deterministic testing;
- visible separation between physical parameters and cinematic controls;
- durable agent state and implementation checkpoints.

## 2. Curated destination set

### Launch destinations

1. **Black Hole** — existing renderer; Schwarzschild/Kerr, accretion disk, relativistic lensing.
2. **Neutron Star** — compact surface, strong lensing, hot spots, pulsar/magnetar presets.
3. **Stellar Explosion** — core-collapse supernova family, hypernova, long-GRB/collapsar mode.
4. **Compact Merger** — neutron-star merger, short GRB, kilonova, remnant phases.
5. **Black-Hole Merger** — data-driven inspiral/merger/ringdown with waveform visualization.
6. **Tidal Disruption** — star torn apart by a black hole, debris stream, shocks, nascent disk.
7. **Quasar / AGN** — supermassive black hole, luminous disk, torus, corona, jets, host context.
8. **Galaxy Collision** — large-scale interacting galaxies, tidal tails, starburst regions, final merger.

### Expansion destinations

9. **Stellar Merger** — contact/collision, common envelope-like presentation, luminous-red-nova outcome.
10. **Solar Activity** — photosphere/corona, magnetic loops, flare, CME.

### Shared lab

11. **Gravitational Lensing Lab** — source/lens/observer alignment, Einstein rings, arcs, multiple images.

## 3. Why not every named phenomenon is top-level

The navigation should represent scientifically and visually distinct experiences, not a glossary.

Several requested terms are better modeled as states, variants, or outcomes of a broader system:

- pulsar and magnetar are neutron-star subclasses;
- magnetar flare is an event of a magnetar;
- hypernova is an energetic stellar-explosion mode;
- long GRBs are tied to some massive-star collapse/jet scenarios;
- kilonova and short GRB are outcomes/phases of compact mergers;
- luminous red nova belongs with stellar mergers;
- Einstein ring is one lensing geometry;
- blazar is an AGN/quasar viewed near the jet axis.

This taxonomy reduces duplicated rendering infrastructure and produces better educational continuity.

## 4. Core UX

Persistent top navigation concept:

```text
[ Black Hole ] [ Neutron Star ] [ Stellar Explosion ] [ Compact Merger ] ...
```

Selecting a destination:

```text
current scene
   ↓
prepare target in background
   ↓
hyperspace depart
   ↓
occlusion / resource handoff
   ↓
arrive at target on conservative quality
   ↓
quality settles upward
```

Routes should remain addressable:

```text
/atlas/black-hole
/atlas/neutron-star?preset=pulsar
/atlas/stellar-explosion?preset=hypernova
/atlas/compact-merger?preset=kilonova
/atlas/quasar?mode=blazar
/atlas/lensing?case=einstein-ring
```

## 5. Shared platform philosophy

One renderer and one application host.

Do not instantiate/destroy an entire Three.js application on every transition. Each destination is a module using shared rendering services and owning only scene-local resources.

Reusable subsystems should include:

- renderer/canvas/device lifecycle;
- camera and observer rig;
- HDR and post-processing;
- dynamic resolution and quality control;
- GPU timing/telemetry;
- particles;
- volumetric ray marching;
- ribbons/trails;
- trajectories/orbits;
- magnetic/field lines;
- lensing;
- asset streaming and manifests;
- destination-local resource scopes;
- URL/preset state;
- deterministic clocks/seeds.

## 6. Fidelity policy

Every feature must declare one of four modes:

- `DIRECT` — reduced equations solved live and validated;
- `DATA_DRIVEN` — browser visualizes validated precomputed simulation products;
- `PROCEDURAL_SCIENTIFIC` — physically informed procedural model with explicit limitations;
- `CINEMATIC` — artistic effect for presentation/navigation, not a scientific simulation.

Examples:

- black-hole ray tracing: `DIRECT`;
- black-hole merger dynamics: `DATA_DRIVEN`;
- initial supernova ejecta: `PROCEDURAL_SCIENTIFIC`;
- hyperspace transition: `CINEMATIC`.

## 7. First implementation sequence

```text
existing black-hole foundation
        ↓
CA0 destination host/lifecycle
        ↓
CA1 hyperspace transition + streaming
        ↓
CA2 shared GPU visual primitives
        ↓
CA3 neutron star
        ↓
CA4 stellar explosion
        ↓
CA5 compact merger
        ↓
CA6 tidal disruption
        ↓
CA7 quasar / AGN
        ↓
CA8 black-hole merger
        ↓
CA9 galaxy collision
        ↓
CA10 stellar merger + solar activity + lensing lab
        ↓
CA11 cross-destination performance/accessibility hardening
        ↓
CA12 release integration
```

## 8. Required documents

- `SELECTION_AND_TAXONOMY.md` — why destinations were selected/merged/deferred.
- `DECISIONS.md` — locked architecture/product decisions.
- `ARCHITECTURE.md` — shared runtime/module/resource contracts.
- `PRODUCT_UX_AND_TRANSITIONS.md` — selector, routing, loading, hyperspace and reduced motion.
- `SCIENTIFIC_FIDELITY.md` — simulation honesty and approximation rules.
- `PHENOMENA_IMPLEMENTATION.md` — per-destination renderer and controls.
- `PERFORMANCE_HARDWARE.md` — GPU/CPU/memory/quality strategy.
- `DATA_PIPELINE.md` — offline scientific-data preprocessing.
- `VALIDATION_TESTING.md` — physics, visual, lifecycle and browser validation.
- `BENCHMARK_MATRIX.md` — reproducible performance scenes.
- `ROADMAP.md` — integration milestones.
- `WORK_PACKETS.md` — autonomous task decomposition.
- `RESEARCH_REFERENCES.md` — primary/official sources.
- `BRANCH_PLAN.md` — integration strategy.

## 9. Product principle

The atlas should maximize **distinct experience per engineering dollar**.

A phenomenon deserves a new top-level destination only when it contributes a substantially different combination of:

- physics;
- scale;
- renderer technique;
- interaction model;
- educational value;
- visual identity;
- reusable architecture validation.

If it is mostly a parameter variation of an existing destination, make it a preset.