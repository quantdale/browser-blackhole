# Phenomena implementation specification

This document defines the first implementation architecture for each selected Cosmic Atlas destination.

## 1. Black Hole

### Role

Existing flagship destination and scientific renderer foundation.

### Fidelity

- primary lensing/geodesics: `DIRECT`;
- accretion emission according to existing black-hole spec;
- post effects: visual/cinematic but separated from physics.

### Cosmic Atlas work

Do not rewrite physics. Wrap current renderer behind `PhenomenonModule` lifecycle.

### Shared services exported/reused

- LensingService capabilities;
- CameraRig integration;
- HDR/post;
- star environment;
- performance telemetry;
- quality states.

### Validation

Existing M0-M11 black-hole gates remain authoritative.

---

## 2. Neutron Star

### Why top-level

It is the closest strong-gravity sibling to Black Hole yet introduces a physical emitting surface, rapid rotation, hot spots, pulsar beams and magnetic geometry.

### Fidelity

- exterior spherical lensing: `DIRECT`;
- surface emission/redshift: `DIRECT` under documented model;
- magnetosphere/field lines: `PROCEDURAL_SCIENTIFIC`;
- flare visuals: `PROCEDURAL_SCIENTIFIC`.

### Minimum viable visualization

- spherical compact surface at radius `R > 2 r_g`;
- configurable mass/radius presets;
- backward ray tracing to surface or background;
- gravitational redshift of surface emission;
- one/two hot spots;
- star rotation;
- observer inclination control;
- pulse brightness readout/graph;
- pulsar preset.

### Advanced version

- oblate rapidly rotating surface approximation;
- better atmosphere limb/emission model;
- time-of-flight/aberration refinements;
- magnetar preset;
- flare state machine;
- optional data-based real pulsar reference presets.

### Main controls

- mass;
- radius/compactness;
- rotation frequency;
- spin-axis orientation;
- magnetic-axis tilt;
- observer inclination;
- hot-spot latitude/radius/temperature;
- beam opening angle (illustrative unless modeled);
- time scale.

### Renderer

```text
camera ray
  ↓
strong-gravity path
  ├─ hits surface -> emitted radiance/redshift
  └─ escapes -> celestial environment
  ↓
optional beams/field overlays
  ↓
HDR/post
```

### Performance risks

- strong lensing near limb;
- high-quality surface ray tracing per pixel;
- additive beam/particle cost.

### Optimizations

- reuse Schwarzschild LUT/numerical backend where valid;
- dynamic resolution;
- surface-hit early termination;
- field lines rendered as batched ribbons/lines;
- particle counts scale by quality.

### Validation

- surface hit/miss rays;
- redshift ordering with compactness;
- apparent-radius/lensing trend;
- rotational symmetry cases;
- pulse geometry deterministic tests;
- GPU/reference ray comparisons.

---

## 3. Stellar Explosion

### Includes

- core-collapse supernova;
- stripped-envelope-like preset;
- hypernova;
- long-GRB/collapsar scenario.

### Fidelity

Initial: `PROCEDURAL_SCIENTIFIC`.

Later selected data sets may add `DATA_DRIVEN` morphology.

### Minimum viable visualization

- progenitor star;
- collapse/flash transition;
- expanding shock shell;
- procedural ejecta density volume;
- clumpy GPU particles;
- temperature/emissivity evolution;
- HDR bloom;
- timeline from seconds to later expansion.

### Density model

Use an analytic/procedural field rather than a giant dense simulation grid:

```text
rho(p,t) = shell(r,R(t),width)
         × angularAsymmetry(direction)
         × clumpingNoise(p,t)
         × radialFalloff(r,t)
```

Physical parameters govern expansion scale and temperature trend; noise only adds morphology.

### Hypernova preset

Must add more than a scalar brightness multiplier:

- higher expansion/kinetic-energy proxy;
- stronger anisotropy;
- optional central-engine/bipolar morphology;
- different ejecta velocity distribution;
- explicit label as illustrative unless data-driven.

### Long GRB mode

- bipolar narrow relativistic jet visualization;
- viewing angle control;
- on-axis/off-axis brightness behavior;
- jet is not a spherical flash.

### Performance

Main cost: volumetric march + ejecta particles.

Optimizations:

- half-resolution volume;
- depth-aware upscale;
- early alpha exit;
- procedural density instead of 3D RGBA32F grid;
- quality-dependent volume steps and particle population;
- freeze low-impact particle simulation during stable far-field phases.

### Validation

- radius monotonically expands;
- temperature/emission evolves in expected ordering;
- preset differences deterministic;
- no negative/non-finite densities;
- volume/particle bounds;
- visual regression of shell/jet morphology.

---

## 4. Compact Merger

### Includes

- neutron-star binary inspiral;
- merger/contact;
- short GRB;
- kilonova;
- remnant.

### Fidelity

Mixed:

- inspiral orbit: `DIRECT` reduced model or `DATA_DRIVEN`;
- merger/post-merger morphology: `DATA_DRIVEN` or `PROCEDURAL_SCIENTIFIC`;
- kilonova emission: reduced/procedural or data-driven;
- GRB jet: procedural with viewing-angle constraints.

### Timeline

Use phase-aware mapping:

```text
INSPIRAL → CONTACT → MERGER → JET → KILONOVA → AFTERGLOW
```

Physical durations differ by orders of magnitude. Use nonlinear time compression.

### Minimum viable visualization

- two compact stars;
- validated inspiral trajectory;
- tidal/contact transition;
- merger flash/ejecta;
- anisotropic expanding kilonova component;
- bipolar jet option;
- remnant state;
- phase timeline/scrubber.

### Controls

- mass-ratio preset;
- object masses;
- viewing angle;
- playback phase/rate;
- jet opening-angle scenario;
- ejecta/kilonova preset;
- remnant preset.

Avoid exposing unvalidated continuous parameters for complex post-merger outcomes.

### Performance

- GPU ejecta particles;
- procedural low-resolution volume;
- jet ribbons/particles;
- timeline interpolation.

Keep expensive stages dormant outside their active phase.

### Validation

- inspiral separation/frequency ordering;
- deterministic contact time;
- jet axis/view-angle behavior;
- kilonova radius/temperature trend;
- no phase discontinuities after timeline scrubbing;
- resource use stable across repeated rewind/play.

---

## 5. Black-Hole Merger

### Why separate

Scientific data and observables differ fundamentally from luminous compact mergers.

### Fidelity

Initial orbital/waveform dynamics: `DATA_DRIVEN`.

Initial lensing: potentially `PROCEDURAL_SCIENTIFIC`/illustrative unless full dynamical-spacetime ray data is used.

### Data source strategy

Use public numerical-relativity products such as SXS/Einstein Toolkit reference cases, subject to provenance/license review.

Offline pipeline extracts:

- component masses/spins;
- coordinate/trajectory representation appropriate for visualization;
- merger time;
- waveform strain modes or reduced strain;
- remnant mass/spin where available.

Runtime ships compact versioned binary assets, not raw multi-terabyte simulation output.

### Minimum viable visualization

- two black-hole markers/horizon representations;
- orbit from validated reduced data;
- waveform panel synchronized to phase;
- merger/ringdown transition;
- remnant state;
- clearly labeled illustrative spacetime/lensing visualization.

### Advanced version

- offline ray-traced dynamical-spacetime frames or reduced lens maps;
- spin/precession cases;
- multiple SXS presets;
- higher-order waveform modes.

### Performance

Data interpolation is cheap; lensing is expensive.

Do not simulate numerical relativity live.

### Validation

- binary data checksum/version;
- trajectory samples match source extraction;
- waveform samples/timing match source;
- merger/ringdown alignment;
- no claim that approximate visual lens equals exact GR.

---

## 6. Tidal Disruption Event

### Fidelity

Initial: `PROCEDURAL_SCIENTIFIC` driven by validated orbital/tidal parameters.

Later: selected SPH/GRMHD-derived reduced data possible.

### Implemented model (CA6, shipped)

- encounter: closed-form PARABOLIC Kepler orbit via Barker's equation
  (exact forward/inverse timing, no iteration — DIRECT reduced Newtonian
  model; NOT a relativistic stellar geodesic; no pericenter precession);
- deformation: tidal-tensor amplitude (rt/r)^3 driving a bounded
  volume-preserving ellipsoid proxy (presentation gain/cap disclosed);
- disruption criterion: beta = rt/rp with full/partial/fly-by bands and an
  explicit direct-capture verdict (Newtonian geometric statement, NOT a
  relativistic capture computation);
- debris: deterministic spherical-Fibonacci sampling with a tidal-tensor
  energy-spread estimate (G MBH R*/rp^2, partial stripping scaled down);
  bound/unbound = sign of the energy offset (reduced proxy);
- streams: the debris family propagated on Newtonian Kepler orbits
  (bisect+Newton elliptic solver, Newton hyperbolic); winding is
  DIFFERENTIAL KEPLER MOTION — GR apsidal precession is NOT modeled;
  ribbons render the near-BH portion (r <= 12 rp, disclosed crop);
- shock: VolumeService equatorial torus at the circularization proxy
  Rc = 2 rp, phase-gated to the shock stage;
- fallback/shock trigger: first periapsis return of the most-bound element
  (derived from the model's own orbit family, not a fitted formula);
- nascent disk: procedural annulus with radial falloff after several
  fallback times (NOT an accretion-disk simulation);
- display: the stellar disc is rendered at an exaggerated radius
  (max(R*, min(0.12 rt, 20 units))) — pure presentation, model quantities
  use the true radius.

### Minimum viable sequence

```text
star approach
→ tidal elongation
→ disruption
→ bound/unbound stream split
→ stream winding
→ self-intersection / shock
→ nascent accretion flow
```

### Renderer reuse

- existing Black Hole lensing;
- stellar surface/volume;
- RibbonService for debris;
- ParticleService for gas/ejecta;
- VolumeService for shocks;
- TrajectoryService for encounter orbit.

### Controls

Prefer validated scenario presets plus:

- black-hole mass;
- stellar type preset;
- periapsis/penetration scenario;
- observer orientation;
- time.

### Performance risks

Lensing + stream ribbons + particles + volume can stack.

Use phase-dependent activation:

- before disruption: no debris particle budget;
- debris phase: lower unnecessary black-hole post refinement;
- distant phase: simplify lensing if angular size is small.

### Validation

- encounter geometry;
- tidal deformation increases near periapsis;
- stream continuity;
- deterministic bound/unbound classification proxy;
- no stream teleporting under scrub.

---

## 7. Quasar / Active Galactic Nucleus

### Includes

- quasar;
- generic AGN;
- blazar viewing mode.

### Fidelity

Mixed:

- inner black-hole GR: `DIRECT` when reusing validated backend;
- disk/torus/corona/jet morphology: `PROCEDURAL_SCIENTIFIC` initially;
- host galaxy: procedural or data-driven.

### Key design: scale zones

```text
INNER
black hole + relativistic disk + corona

NUCLEAR
outer disk + torus + jet funnel

GALACTIC
host galaxy + extended jet
```

Transition between zones based on camera distance with hysteresis to prevent flicker.

### Minimum viable visualization

- SMBH central renderer;
- luminous accretion disk;
- corona glow/volume;
- dusty torus;
- relativistic bipolar jet;
- host-galaxy context;
- smooth zoom from compact to galactic scale.

### Blazar preset

Set observer near jet axis and adjust beaming visualization according to documented approximation.

### Performance

Never render inner GR at full pixel cost when it occupies a tiny screen region.

Use scale-dependent quality:

- high GR quality close;
- simplified proxy/billboard farther out;
- cull inner details on galactic scale;
- long jet via ribbons/particles with distance LOD.

### Validation

- zone-transition continuity;
- stable world/unit conversions across scale jumps;
- jet alignment;
- no double-counted brightness between inner proxy and full renderer;
- blazar preset is orientation-driven.

---

## 8. Galaxy Collision

### Fidelity

`DATA_DRIVEN` first.

### Why not live all-pairs gravity

A convincing galaxy merger needs many tracers and long dynamical history. Browser production should consume reduced scientific trajectories/flow/keyframes rather than attempt naive O(N^2) force evaluation.

### Data pipeline

Offline:

```text
source simulation
→ select/reduce trajectories/fields
→ normalize units/frames
→ resample keyframes
→ validate morphology/time
→ compact binary
```

Browser:

```text
binary keyframes/flow
→ GPU interpolation
→ visual star/gas/dust tracers
→ tidal tails/starburst overlays
```

### Minimum viable visualization

- two interacting spiral galaxy populations;
- bulge/disk components;
- tidal tail formation;
- collision timeline;
- gas/star-forming region proxy;
- final merger remnant;
- wide camera/orbit controls.

### Performance

Use:

- GPU storage buffers;
- instancing/points;
- quality-dependent tracer count;
- frustum/distance culling;
- no Three.js object per star;
- compact binary assets;
- interpolation rather than CPU per-particle dynamics.

### Validation

- keyframe/trajectory samples match reduced source;
- tracer interpolation stable;
- galaxy centers follow source tracks;
- no time-scrub explosion of allocations;
- morphology goldens at known phases.

---

## 9. Stellar Merger — expansion

### Includes

- stellar collision/contact;
- merger;
- luminous-red-nova-like transient.

### Fidelity

Initially `PROCEDURAL_SCIENTIFIC`, optionally data-driven later.

### Reuse

- stellar surface/volume;
- explosion ejecta volume;
- ribbon/particle services;
- timeline infrastructure.

### Key stages

```text
approach
→ deformation/contact
→ common merged envelope presentation
→ ejecta
→ cool luminous transient
→ dust/light-echo optional visualization
```

Do not assert one specific observed transient's cause without event-specific source review.

---

## 10. Solar Activity — expansion

### Includes

- solar flare;
- coronal loops;
- CME.

### Fidelity

`PROCEDURAL_SCIENTIFIC` initially.

### Renderer

- procedural photosphere/chromosphere surface;
- corona volume;
- field-line visualization;
- flare ribbon/bright region;
- CME shell/flux-rope-inspired structure;
- GPU particles.

Do not call it live MHD unless actual MHD data is used.

---

## 11. Gravitational Lensing Lab

### Fidelity

`DIRECT` for analytic/reduced lens equations.

### Main purpose

Teach why Einstein rings, arcs and multiple images are related configurations.

### Controls

- source position;
- lens mass/strength under selected model;
- lens/source/observer distances;
- alignment;
- extended source size;
- lens model preset.

### Render

Start with thin-lens mapping and a textured/source field.

Advanced:

- extended lens mass models;
- comparison against strong-field black-hole lensing;
- educational caustic overlays.

### Validation

- exact alignment produces ring under point-mass model;
- moving source breaks ring into images/arcs according to model;
- symmetry and scaling tests.