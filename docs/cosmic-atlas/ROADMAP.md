# Cosmic Atlas implementation roadmap

Cosmic Atlas milestones are additional to the existing black-hole M0-M11 roadmap. Do not use this document to skip unfinished black-hole correctness work.

## Entry condition

Begin CA0 only when the current black-hole application has a stable enough renderer/application boundary to be wrapped without speculative duplication.

Research and planning may proceed earlier; integration should respect black-hole gates.

---

## CA0 — Destination host and lifecycle

### Objective

Prove multi-destination architecture before adding another expensive scientific scene.

### Deliver

- `CosmicAtlasHost`;
- `DestinationRegistry`;
- route model;
- lazy dynamic destination imports;
- `PhenomenonModule` lifecycle;
- resource scopes;
- global quality/time interfaces;
- Black Hole wrapped as first real module;
- lightweight diagnostic destination as second module;
- repeated switch/dispose test;
- destination debug inventory.

### Exit gate

20 switches Black Hole ↔ Diagnostic complete without blank frames, stale activation, uncaught errors, or monotonic unbounded scene-local resources.

---

## CA1 — Hyperspace transition and streaming

### Deliver

- transition state machine;
- full-screen procedural hyperspace effect;
- target preparation before departure;
- minimum-ready contract;
- target cancellation/generation safety;
- outgoing TRANSITION quality;
- occlusion resource-swap point;
- arrival quality ramp;
- reduced-motion crossfade;
- browser history/deep-link behavior;
- loading status for slow targets.

### Exit gate

Preloaded transition is smooth and leak-free; slow target preparation keeps current scene responsive and never stalls midway through an irreversible transition.

---

## CA2 — Shared GPU visual primitives

### Deliver

- `ParticleService`;
- `VolumeService`;
- `RibbonService`;
- `TrajectoryService`;
- `FieldLineService`;
- shared asset/data loader;
- quality knobs for each service;
- deterministic seed/time integration;
- benchmark scenes for particles and volume.

### Exit gate

Synthetic scenes prove services can be independently created/disposed and quality-scaled without destination-specific hacks.

---

## CA3 — Neutron Star

### Deliver

- scientific convention spec;
- spherical compact surface renderer;
- strong-field surface ray tracing;
- gravitational redshift;
- hot spots;
- rotation/time;
- pulse geometry;
- pulsar preset;
- dipole/field-line visual;
- magnetar preset;
- magnetar flare state machine;
- deterministic pulse/reference tests;
- quality tiers;
- Atlas transition integration.

### Exit gate

Surface rays match reference tolerance; pulse geometry tests pass; repeated travel in/out is leak-free; Medium quality meets target on representative mainstream hardware.

---

## CA4 — Stellar Explosion

### Deliver

- physically scoped procedural model;
- progenitor/flash;
- expanding shock shell;
- volume ejecta;
- GPU clump particles;
- emissivity/temperature evolution;
- asymmetry controls;
- hypernova preset;
- long-GRB bipolar jet mode;
- off-axis/on-axis observer presets;
- deterministic timeline;
- performance tuning.

### Exit gate

Model invariants pass, volume/particle frame budget is controlled by global quality governor, and hypernova/GRB are more than post-process scale changes.

---

## CA5 — Compact Merger

### Deliver

- phase-aware timeline;
- inspiral model/reference;
- compact surfaces;
- contact/merger transition;
- ejecta particles/volume;
- short-GRB jet;
- kilonova phase;
- remnant state;
- viewing-angle controls;
- timeline scrub/reset;
- scientific fidelity explanation.

### Exit gate

Inspiral and phase-order tests pass; jet/kilonova behavior is deterministic; no systems remain expensive outside relevant phase; leak/performance gates pass.

---

## CA6 — Tidal Disruption

### Deliver

- encounter trajectory;
- stellar deformation;
- disruption trigger/model;
- bound/unbound stream proxy;
- ribbon/particle debris;
- stream winding/intersection;
- shock region;
- nascent disk presentation;
- phase-aware black-hole quality;
- validation/reference presets.

### Exit gate

Encounter and stream invariants pass; combined lensing+debris cost remains adaptive; time scrub/replay deterministic.

---

## CA7 — Quasar / AGN

### Deliver

- scale-zone architecture;
- close-range black-hole reuse;
- corona;
- torus;
- relativistic jet;
- host galaxy;
- scale-zone LOD/hysteresis;
- blazar observer preset;
- parsec/kpc/r_g unit presentation;
- camera travel across scales.

### Exit gate

Close/nuclear/galactic zones transition without pops/double rendering, and far-scale views do not pay full inner-GR cost.

---

## CA8 — Black-Hole Merger

### Deliver

- source dataset selection/provenance;
- offline extractor;
- runtime binary format;
- trajectory/waveform loader;
- inspiral/merger/ringdown timeline;
- waveform visualization;
- remnant metadata;
- illustrative lensing with fidelity label;
- source-vs-runtime validation;
- data version/checksum handling.

### Exit gate

Runtime samples/waveform match reduced source; destination clearly distinguishes data-derived dynamics from illustrative rendering; target performance passes.

---

## CA9 — Galaxy Collision

### Deliver

- source simulation/data selection;
- reduction pipeline;
- runtime keyframe/flow binary;
- GPU tracer interpolation;
- disk/bulge/gas populations;
- tidal tails;
- starburst region proxy;
- nonlinear timeline;
- quality-dependent tracer population;
- morphology/reference goldens.

### Exit gate

Macro morphology matches chosen reduced source at reference phases; no large CPU per-particle update; tracer/memory budgets remain bounded.

---

## CA10 — Expansion destinations and lab

### Stellar Merger

- collision/contact/merger timeline;
- ejecta;
- luminous-red-nova-like phase;
- explicit fidelity limits.

### Solar Activity

- procedural surface/corona;
- field lines;
- flare;
- CME;
- explicit non-MHD label.

### Lensing Lab

- analytic thin-lens mapping;
- Einstein ring/arcs/multiple images;
- alignment controls;
- educational overlays.

### Exit gate

Each feature meets standard destination completion gate or remains clearly marked experimental.

---

## CA11 — Atlas-wide hardening

### Deliver

- full navigation leak tour;
- device-loss recovery across destinations;
- browser/fallback matrix;
- mobile/touch layout;
- reduced-motion audit;
- quality controller tuning across all render classes;
- asset cache/eviction policy;
- bounded shader variants;
- preload policy;
- long-run thermal tests;
- provenance/license audit.

### Exit gate

No Critical/High lifecycle, correctness, accessibility, or data-provenance defect remains open.

---

## CA12 — Release integration

### Deliver

- final destination navigation;
- About/Fidelity pages;
- reference/source links;
- production benchmark report;
- deployment/cache headers for large static assets;
- graceful unsupported-browser experience;
- release smoke suite;
- durable handoff/state update.

### Exit gate

All launch destinations either pass release gates or are explicitly hidden/marked beta. No unfinished destination is exposed as production-ready.

## Integration principle

Do not implement CA3–CA9 in parallel before CA0–CA2 are proven. Shared lifecycle and GPU services exist specifically to prevent each feature team/agent from inventing incompatible infrastructure.