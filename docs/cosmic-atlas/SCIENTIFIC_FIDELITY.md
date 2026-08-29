# Scientific fidelity and approximation policy

## 1. Purpose

Cosmic Atlas is an interactive scientific visualization product, not a claim that a consumer browser is reproducing full astrophysical simulation codes.

This document prevents visually impressive approximations from being described as exact physics.

## 2. Fidelity classes

### DIRECT

The browser solves a reduced physical model live.

Requirements:

- governing equations documented;
- units/conventions documented;
- deterministic reference cases;
- validation against analytic or independent numerical references;
- numerical failures surfaced.

Examples:

- Schwarzschild ray tracing;
- simplified neutron-star exterior ray tracing;
- analytic point-mass gravitational lensing lab.

### DATA_DRIVEN

The browser visualizes precomputed scientific simulation products.

Requirements:

- source dataset identified;
- license/provenance recorded;
- offline extraction/reduction documented;
- units/coordinates/channel meanings preserved;
- runtime interpolation tested against source samples;
- visual additions distinguished from source data.

Examples:

- binary black-hole trajectories/waveforms;
- galaxy-collision trajectory/flow products.

### PROCEDURAL_SCIENTIFIC

The browser uses procedural/analytic fields informed by physical morphology but is not a predictive solver.

Requirements:

- what is physically constrained documented;
- what is artistic/procedural documented;
- controls avoid fake precision;
- morphology/ordering invariants tested;
- UI uses wording such as "illustrative model" where appropriate.

Examples:

- initial supernova expanding ejecta;
- illustrative TDE debris stream;
- AGN corona/torus volumetrics;
- magnetosphere field-line visualization.

### CINEMATIC

Purpose is presentation/navigation, not science.

Requirements:

- never labeled physical simulation;
- must not alter scientific state silently;
- accessibility controls required when visually intense.

Example:

- hyperspace transition.

## 3. Mixed destinations

A destination may contain multiple fidelity classes.

Example: Quasar / AGN

- central black-hole lensing: `DIRECT` when using validated black-hole backend;
- torus/corona appearance: `PROCEDURAL_SCIENTIFIC`;
- host galaxy visual: procedural or data-driven;
- decorative transition: `CINEMATIC`.

UI documentation should explain this without overwhelming users.

## 4. No fake precision

Avoid controls such as:

```text
Explosion turbulence = 0.732615
```

if the value has no physically validated meaning.

Use semantic controls:

- smooth / clumpy;
- low / medium / high asymmetry;
- narrow / wide jet;
- illustrative ejecta mass preset;
- validated reference-event preset.

Physical numeric controls require units and model documentation.

## 5. Time compression

Cosmic events span extreme time scales.

Visual playback may compress time heavily, but UI must distinguish:

- physical event time;
- normalized timeline position;
- current playback compression.

Do not imply that galaxy collisions occur over seconds simply because the animation does.

## 6. Neutron-star policy

Initial exterior model may use Schwarzschild outside a spherical star with configurable mass/radius if rotation is visually modeled separately.

**M12-NS status (2026-08-26): DIRECT** exterior Schwarzschild backwards ray tracing to the material surface is now implemented and validated (surface hit/escape with refined crossing, starfield background, redshift `g = sqrt(1-2r_g/R)`). Hot-spot emission is evaluated at the geodesic hit coordinate. Still deliberately omitted and disclosed: Doppler/aberration from rotating surface elements, Hartle-Thorne frame dragging, atmosphere/radiative transfer, oblate figure, interior metric/time-of-flight.

If rapid-rotation spacetime effects are not included, say so.

Pulsar beam and magnetic field-line visuals are illustrative magnetosphere representations unless a specific validated model is implemented.

Magnetar flare visuals are event models, not full relativistic MHD.

## 7. Stellar Explosion policy

Initial browser model is not hydrodynamic core-collapse simulation.

Use:

- physically ordered expansion;
- temperature/emissivity evolution;
- shock shell;
- anisotropy/clumping;
- optional bipolar/jet components;
- documented preset differences.

Do not call a preset Type Ia unless a thermonuclear white-dwarf model is specifically implemented and researched.

## 8. Compact Merger policy

Inspiral timing/orbit can be analytic/reduced or data-driven depending phase.

Post-merger ejecta/kilonova may be procedural/data-driven.

GRB visualization must show collimated jets and viewing-angle dependence rather than spherical explosion shorthand.

Kilonova is an aftermath/electromagnetic counterpart, not a separate unrelated explosion.

## 9. Binary black-hole policy

Full binary spacetime belongs to numerical relativity.

Initial browser product should use validated public trajectory/waveform products and clearly identify any illustrative visual lensing approximation.

Exact language example:

> Orbital motion and waveform are derived from numerical-relativity data. The live lensing visualization is illustrative and does not ray trace the full dynamical spacetime.

## 10. Tidal Disruption policy

Initial TDE uses a reduced/procedural star-debris model guided by known event morphology:

- tidal elongation;
- debris stream;
- bound/unbound split approximation;
- stream self-intersection/shock region;
- forming accretion flow.

Do not describe it as live SPH/GRMHD.

## 11. Galaxy Collision policy

Galaxy Collision is data-driven first.

Scientific orbit/flow reduction may drive many GPU visual tracers, but visual tracers themselves do not all need to be gravitational N-body particles.

Document difference between simulation samples and rendered interpolation.

## 12. AGN policy

Central GR can be direct. Large-scale jet, corona, torus and host structure are initially illustrative/data-driven depending asset source.

Blazar mode changes observer orientation toward the jet; it is not a separate physical object class.

## 13. Source uncertainty

For phenomena with active scientific uncertainty, documentation must separate:

- established observation;
- common model;
- implementation assumption.

Avoid presenting one debated mechanism as settled fact.

## 14. Validation labels

Each destination's About panel should include:

```text
Physics fidelity
DIRECT / DATA-DRIVEN / PROCEDURAL

What is calculated live
...

What is precomputed
...

What is illustrative
...

Reference sources
...
```

## 15. Scientific review gate

Before a destination exits beta:

1. all physical quantities have units/conventions;
2. approximation boundaries are documented;
3. deterministic reference scenes exist;
4. misleading claims have been audited;
5. sources/provenance are linked;
6. visual regression cannot silently replace a physical invariant test.

## 16. Representation-layer disclosure (2026-08-29)

The cinematic visual-fidelity overhaul changes how resolved outputs are
presented, not the authoritative model or data. Seeded backdrops, structured
stellar surfaces, optically thin halos, discs, jets, marker glows, and ribbon
halos are display representations. They are not claims of full radiative
transfer, relativistic magnetohydrodynamics, or a live dynamical spacetime.

The direct black-hole and neutron-star ray paths, compact-merger and stellar
explosion model equations, AGN zone semantics, numerical-relativity data, and
Galaxy Collision coordinates/interpolation remain the source of scientific
state. Cinematic grade, vignette, and grain are opt-in display operations and
are excluded from Scientific/Debug diagnostic graphs. Physics-focused golden
captures continue to force a linear, bloom-off display chain, while the
separate cinematic browser gate verifies presentation changes do not mutate
active model/debug state.
