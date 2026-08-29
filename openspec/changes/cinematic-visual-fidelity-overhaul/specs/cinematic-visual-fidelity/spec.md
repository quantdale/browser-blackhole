# Cinematic visual fidelity specification

## Requirement: shared representation must consume resolved model state

Every destination visual layer SHALL receive model/time/seed values from its
validated destination state and SHALL NOT alter authoritative physics, data,
timeline mappings, or termination classifications.

## Requirement: cinematic surfaces SHALL have spatial structure

Luminous spherical bodies SHALL use bounded view-angle response, seeded
granulation/temperature variation, and HDR radiance-aware shading rather than
a uniform flat color. The layer SHALL remain deterministic when paused.

## Requirement: environments SHALL provide coherent context

Destinations without an existing full-screen environment SHALL receive a
seeded, camera-safe deep-space backdrop with sparse stars and multiscale dust.
The backdrop SHALL be shared, bounded, and depth-safe.

## Requirement: Stellar Explosion is the first full-quality gate

Before propagation to another destination, Stellar Explosion SHALL show
resolved progenitor, shell, breakout/flash, ejecta, and GRB/jet presentation
states with deterministic paused captures and visible playing evolution.
Its existing physics, timeline, density/emission models, and resource gates
SHALL remain green on default and forced-WebGL2 paths.

## Requirement: secondary structures SHALL be legible at cinematic scale

Volumes, particles, ribbons, discs, halos, jets, field lines, and galactic
tracers SHALL use soft profiles and coherent hierarchy. The implementation
MUST not rely on bloom, saturation, or exposure alone to create morphology.

## Requirement: scientific and cinematic display domains SHALL remain distinct

Cinematic grading and illustrative accents SHALL be display/presentation
choices. Scientific and Debug modes SHALL retain restrained/diagnostic output
and the existing fidelity disclosures.

## Requirement: deterministic backend compatibility

All shipped representation graphs SHALL compile and render through the
existing WebGPU-preferred/WebGL2 fallback contract, use seeded inputs, and
avoid wall-clock-dependent shader noise. Unsupported optional layers SHALL
degrade explicitly without hiding errors.

## Requirement: quality and resources remain governed

New detail SHALL consume the existing global quality tier and invalidation
model. Every new GPU resource SHALL be scope-owned and disposed idempotently;
repeated destination navigation SHALL not produce unbounded residency.

## Requirement: visual certification is evidence based

The campaign SHALL retain physics/reference goldens, add cinematic captures or
probes for each destination, inspect browser console/device-loss output, run
default and forced-WebGL2 suites, and produce
`docs/VISUAL_FIDELITY_CERTIFICATION.md` with exact SHAs and truthful deferred
environment entries.
