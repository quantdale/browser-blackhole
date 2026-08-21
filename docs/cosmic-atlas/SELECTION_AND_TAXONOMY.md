# Selection and taxonomy

## 1. Selection framework

Each candidate is evaluated on six dimensions, scored qualitatively from Low to High:

1. **Physical distinctness** — does it require meaningfully different physics?
2. **Visual distinctness** — will users immediately recognize a different experience?
3. **Interaction value** — are there meaningful controls/camera experiments?
4. **Implementation reuse** — can existing infrastructure be reused rather than duplicated?
5. **Scientific explainability** — can the browser model be honest and useful without pretending to be HPC research code?
6. **Cost/risk** — engineering complexity, GPU cost, data size, validation difficulty.

A top-level destination should usually be High in at least three of the first five dimensions and not be better represented as a state of another system.

## 2. Final launch taxonomy

### A. Black Hole — top-level

Why distinct:

- strongest gravitational-lensing experience;
- direct null-geodesic rendering;
- accretion-disk relativistic effects;
- foundational renderer already planned.

Variants:

- Schwarzschild;
- Kerr;
- different observer modes;
- quiescent vs accreting presets.

Related but separate:

- Tidal Disruption is kept separate because the interaction is a time-evolving star-destruction scenario.
- Quasar/AGN is separate because its scale hierarchy and host/jet structure dominate the experience.

### B. Neutron Star — top-level

Merge:

- neutron star;
- pulsar;
- magnetar;
- magnetar flare.

Why:

Pulsars and magnetars are neutron-star states/classes, not independent object families that justify duplicate scene infrastructure.

Distinct interactions:

- mass/radius compactness;
- hot-spot geometry;
- spin rate;
- magnetic-axis tilt;
- observer inclination;
- pulse visibility;
- magnetar flare event state.

Renderer reuse:

- strong-field ray tracing from black-hole work;
- physical surface intersection instead of event-horizon capture;
- HDR/post;
- star background;
- field-line service;
- particle service.

### C. Stellar Explosion — top-level

Merge:

- supernova;
- hypernova;
- long-GRB/collapsar visualization.

Why:

Hypernova should be an energetic/asymmetric variant of massive-star collapse, not a copy of the same explosion page. Long GRB belongs as a jetted central-engine scenario connected to some stellar collapses.

Presets:

- red-supergiant/core-collapse-like;
- stripped-envelope-like;
- asymmetric explosion;
- hypernova;
- long-GRB jet-on;
- long-GRB off-axis.

### D. Compact Merger — top-level

Merge:

- neutron-star merger;
- kilonova;
- short GRB;
- compact remnant.

Why:

These are naturally one event timeline.

Potential later subcase:

- neutron-star–black-hole merger.

Interaction:

- mass ratio;
- compactness presets;
- viewing angle;
- phase timeline;
- ejecta amount proxy;
- jet opening angle;
- remnant choice from validated scenario presets.

### E. Black-Hole Merger — top-level

Keep separate from Compact Merger.

Why:

- no luminous material is required;
- numerical-relativity data is the natural scientific source;
- gravitational waveform/ringdown is the key observable;
- visual lensing must be carefully labeled if approximate.

This destination should be data-driven first.

### F. Tidal Disruption — top-level

Why:

- combines black-hole gravity with star deformation and debris-stream dynamics;
- strong time evolution;
- visually unlike a stationary accreting black hole;
- high reuse of black-hole rendering plus ribbons/particles.

### G. Quasar / AGN — top-level

Merge:

- quasar;
- AGN;
- blazar viewing mode.

Why:

The important product distinction is multi-scale exploration of an active galactic nucleus: central black hole, accretion disk/corona, dusty torus, relativistic jets, and host galaxy.

Blazar is an orientation/viewing scenario, not a separate destination.

### H. Galaxy Collision — top-level

Why:

- scale is kiloparsec rather than compact-object;
- rendering is dominated by hundreds of thousands of visual tracers, tidal morphology and gas/star regions;
- best scientific implementation is data-driven reduced N-body/hydrodynamic products;
- requires a distinct time-navigation experience.

## 3. Expansion taxonomy

### Stellar Merger

Merge:

- stellar collision;
- contact/merger sequence;
- luminous red nova outcome.

Why deferred:

It is visually compelling but shares significant ejecta/volume technology with Stellar Explosion and is less foundational than neutron-star/merger/AGN destinations.

### Solar Activity

Merge:

- solar flare;
- coronal loops;
- CME.

Why deferred:

It validates magnetic-field and plasma-visualization systems, but it is physically much less extreme than the core Atlas theme and should follow shared field/particle infrastructure.

### Gravitational Lensing Lab

Contains:

- point-mass lens;
- extended lens approximation;
- Einstein ring;
- arcs;
- multiple images;
- source/lens/observer alignment.

Why a lab rather than a destination:

An Einstein ring is a geometric lensing configuration. The educational value comes from moving source/lens/observer and watching the mapping change.

## 4. Candidates intentionally not prioritized as launch destinations

### White dwarf / nova

Scientifically valuable, but not sufficiently differentiated from stellar-explosion and compact-star infrastructure for launch.

Potential later education module.

### Planetary nebula

Beautiful but mostly morphology/emission visualization; lower priority for an extreme-physics atlas.

### Protostar / star formation

Excellent topic, but demands gas/dust/star-formation visualization at a very different product scope. Better as a future "stellar life cycle" expansion.

### Cosmic web / large-scale structure

Highly distinct and visually strong, but introduces cosmological simulation data and another scale jump. Candidate for a later Atlas 2.0 expansion.

### Fast radio burst

Interesting observational phenomenon, but source physics remains an active research area. Better represented later as an observational overlay/event associated with magnetar scenarios, with strong uncertainty labeling.

### Type Ia supernova

Potential later Stellar Explosion preset, but it requires a white-dwarf binary/thermonuclear model distinct from the initial core-collapse implementation. Do not call a core-collapse shader "Type Ia" merely by recoloring it.

## 5. Navigation categories

Recommended grouping:

```text
COMPACT OBJECTS
├─ Black Hole
└─ Neutron Star

CATASTROPHES
├─ Stellar Explosion
├─ Compact Merger
├─ Black-Hole Merger
└─ Tidal Disruption

GALACTIC
├─ Quasar / AGN
└─ Galaxy Collision

EXPANSION
├─ Stellar Merger
└─ Solar Activity

LABS
└─ Gravitational Lensing
```

## 6. Top-navigation behavior

Desktop can expose the eight launch destinations directly if width permits, otherwise use grouped overflow.

Mobile should use a compact horizontally scrollable selector or grouped destination sheet.

Do not represent every preset in top navigation. Presets belong inside the destination panel.

## 7. Product review rule

Before adding a new top-level phenomenon, write a short ADR answering:

1. What physics is genuinely new?
2. What renderer/service is genuinely new?
3. Why is a preset insufficient?
4. What user interaction becomes possible?
5. What is the fidelity class?
6. What performance/data cost is introduced?
7. What existing destination would otherwise own the concept?

If these answers are weak, keep it as a preset or defer it.