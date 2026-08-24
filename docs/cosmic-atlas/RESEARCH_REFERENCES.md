# Research references

This is the initial research catalog for the Cosmic Atlas plan. Implementation agents must verify current pages, licenses and technical details before copying/adapting code or data.

## Three.js / WebGPU

### Three.js WebGPURenderer

- https://threejs.org/docs/pages/WebGPURenderer.html

Use for current renderer/back-end behavior and WebGPU/WebGL2 fallback details.

### Three.js StorageBufferAttribute

- https://threejs.org/docs/pages/StorageBufferAttribute.html

Relevant to GPU-resident particle/tracer state and compute-driven attributes.

### Three.js KTX2Loader

- https://threejs.org/docs/pages/KTX2Loader.html

Relevant to compressed texture delivery/transcoding and worker limits.

### WebGPU specification

- https://www.w3.org/TR/webgpu/

Use for capabilities, device limits, optional features and timestamp-query semantics.

## Neutron stars / pulsars / magnetars

### NASA Hubble — Pulsars

- https://science.nasa.gov/mission/hubble/science/science-behind-the-discoveries/hubble-pulsars/

Supports pulsar lighthouse/rotating neutron-star framing.

### NASA NICER — pulsar surface mapping

- https://www.nasa.gov/universe/nasas-nicer-delivers-best-ever-pulsar-measurements-1st-surface-map/

Relevant to compact-surface hot spots and light-bending educational context.

### NASA NICER — neutron-star compactness

- https://www.nasa.gov/universe/nasas-nicer-probes-the-squeezability-of-neutron-stars/

Relevant to mass/radius/compactness educational framing.

### NASA — Magnetar SGR 0418

- https://www.nasa.gov/universe/magnetar-sgr-0418/

### NASA NICER — magnetar hot spots

- https://www.nasa.gov/universe/nasas-nicer-telescope-sees-hot-spots-merge-on-a-magnetar/

Use for magnetar/hot-spot context; do not infer full magnetosphere physics from outreach visuals.

## Stellar explosions / GRBs

### NASA — Core-collapse supernova

- https://science.nasa.gov/resource/core-collapse-supernova/

### NASA Fermi — supernova / gamma-ray burst connection

- https://www.nasa.gov/universe/nasas-fermi-spots-a-supernovas-fizzled-gamma-ray-burst/

### ESO — GRB 030329 / hypernova association

- https://www.eso.org/public/news/eso0318/

Supports keeping hypernova/long-GRB as stellar-explosion scenarios while implementation still needs peer-reviewed model research.

## Neutron-star mergers / kilonovae

### NASA Hubble — neutron-star collision creates kilonova

- https://science.nasa.gov/asset/hubble/neutron-star-collision-creates-kilonova/

### NASA Webb — heavy element from star merger

- https://science.nasa.gov/missions/webb/nasas-webb-makes-first-detection-of-heavy-element-from-star-merger/

Use for merger → ejecta/kilonova relationship and observational context.

## Tidal disruption events

### NASA SVS TDE visualization

- https://svs.gsfc.nasa.gov/13237

### NASA SVS black-hole star disruption visualization

- https://svs.gsfc.nasa.gov/12499/

Use for morphology/context; implementation model must be separately documented.

## Quasars / AGN

### NASA Hubble — quasars

- https://science.nasa.gov/mission/hubble/science/science-behind-the-discoveries/hubble-quasars/

### NASA Webb — quasar illustration

- https://science.nasa.gov/asset/webb/quasar-illustration/

Use for active-galactic-core framing, accretion/jet/host context.

## Galaxy collision

### NASA Hubble — Galactic Smash Hit simulation

- https://science.nasa.gov/asset/hubble/a-galactic-smash-hit-galaxy-collision-simulation/

Useful example showing scientific collision visualization based on many-particle simulation over very long timescales; supports offline/data-driven production strategy.

## Gravitational lensing / Einstein ring

### NASA Hubble — gravitational lenses

- https://science.nasa.gov/mission/hubble/science/universe-uncovered/hubbles-gravitational-lenses/

### NASA image example — gravitational lenses

- https://science.nasa.gov/image-detail/hubble-sloan-gravlenses-stsci-01evvm6x84m2emb7adjgkdxn9y/

Use for educational lensing context. Mathematical implementation requires textbook/peer-reviewed thin-lens equations and explicit model choices.

## Binary black holes / numerical relativity

### Einstein Toolkit — binary black-hole gallery/example

- https://www.einsteintoolkit.org/gallery/bbh/index.html

Important evidence that research-grade binary-BH evolution belongs to HPC/offline simulation rather than a browser live solver.

### SXS Collaboration catalog

- https://www.black-holes.org/2025/05/19/catalog-update
- https://data.black-holes.org/

Candidate source for public numerical-relativity products. Verify dataset licenses/terms and exact extraction interfaces before implementation.

## Stellar merger / luminous red nova context

### NASA Hubble — V838 Monocerotis

- https://science.nasa.gov/asset/hubble/v838-monocerotis/

Use cautiously: outreach pages can describe observations/light echoes without settling the physical cause of every eruption. Event-specific merger claims require stronger literature.

## Required next-level scientific sources

Before implementing each phenomenon, add peer-reviewed/reference sources for governing models:

### Neutron Star

- Schwarzschild exterior surface ray tracing;
- rotating hot-spot pulse profiles;
- atmosphere/emission approximations;
- dipole/magnetosphere visualization limits.

### Stellar Explosion

- homologous expansion/ejecta profiles;
- shock/emission evolution;
- hypernova/collapsar jet morphology.

### Compact Merger

- inspiral approximation or reference data;
- ejecta/kilonova time/color models;
- GRB jet viewing-angle models.

### TDE

- tidal radius/penetration parameter;
- debris energy distribution;
- fallback/stream self-intersection model.

Implemented-model sources (CA6, conventions encoded in
`src/phenomena/tidal-disruption/`):

- parabolic encounter timing: Barker's equation (standard celestial-
  mechanics closed form for e = 1; e.g. Danby, "Fundamentals of Celestial
  Mechanics" — Cardano inversion used verbatim);
- tidal radius rt = R* (MBH/M*)^(1/3); penetration beta = rt/rp
  (standard TDE literature convention; Hills-limit margin documented in
  types.ts);
- debris energy spread: tidal-tensor order-of-magnitude estimate
  DEpsilon = G MBH R*/rp^2 evaluated at the actual periapsis (same
  scaling family as Lodato & Rossi 2011 / Stone et al. 2013 reviews;
  order-unity coefficient NOT claimed — the model uses coefficient 1 and
  labels the estimate as such);
- fallback time: first periapsis return of the most-bound element derived
  from the model's own orbit family (P(a_min) with a_min = mu/DEpsilon),
  not a fitted astrophysical formula;
- bound/unbound split: sign of the first-order energy offset across the
  stellar diameter (classical picture; explicitly NOT hydrodynamic).

NOT modeled (disclosed in code/presets/UI): GR apsidal precession,
self-gravity of the stream, hydrodynamics/SPH/GRMHD, radiative transfer,
relativistic capture dynamics (an explicit verdict flag only).

### Quasar/AGN

- accretion disk regions;
- torus/corona phenomenology;
- relativistic jet beaming model;
- scale conversions.

### Galaxy Collision

- source simulation documentation;
- units/time coordinate;
- reduction validity.

### Lensing Lab

- point-mass thin-lens equation;
- Einstein radius;
- extended lens model if added.

## Source discipline

Outreach/NASA/ESO pages are useful for taxonomy, visual context and public explanation. They are not automatically sufficient to define numerical algorithms.

For code/data implementation:

1. prefer primary papers/data documentation;
2. record exact equation/convention source;
3. verify licenses;
4. preserve provenance through preprocessing;
5. distinguish outreach imagery from scientific runtime data.