# Proposal: Cinematic visual fidelity overhaul

Change ID: cinematic-visual-fidelity-overhaul
Status: PLAN ONLY — NO RUNTIME IMPLEMENTATION IN THIS CHANGE
Priority: HIGH
Planned-From: main@518bff7b8c14e4a22ada4c9376f166d8565c5263
Planned-At: 2026-08-29
Target-Branch: main
Planning-Branch: plan/cinematic-visual-fidelity-overhaul

## Why

Browser Black Hole / Cosmic Atlas is functionally and scientifically far stronger than its current presentation suggests. The latest phenomena-animation campaign fixed major runtime defects: destinations now play, large-scale scenes frame correctly, volumetric optical depth is normalized, WebGPU point rendering is visible, particle size units are consistent, Kerr remnant budgets are aligned, and the browser suites prove delivered-frame motion.

Those fixes primarily addressed correctness and liveness. They did not replace several prototype-grade representation techniques that still dominate the image:

- SharedPost provides a correct half-float HDR scene target, exposure, tone mapping and a single bloom stage, but Cinematic mode is still only a modest display preset rather than a complete cinematic image-formation pipeline.
- VolumeService raymarches real density/emission fields, but its half-resolution intermediate is RGBA8/UnsignedByte, it has no depth-aware upsampling, no temporal reconstruction and no advanced lighting/self-shadowing model.
- ParticleService renders unresolved content as camera-facing sprite quads. It is deterministic and scalable, but large populations can still read as game particles.
- RibbonService renders world-space flat triangle strips. This is useful infrastructure, but it is visibly schematic for tidal streams and orbital trails.
- Galaxy Collision uses a validated data-driven tracer backbone, but the final image contains only a tiny fraction of the unresolved stellar/dust/gas complexity that makes interacting galaxies read as galaxies.
- Black-Hole Merger uses scientifically anchored trajectories and a real Kerr remnant, but the inspiral presentation still relies on dark sphere markers, additive rings, glow annuli and ribbons.
- Current scientific goldens deliberately force exposure 1, bloom off, linear tone mapping and low tier. They are valuable geometry/correctness gates, but they do not certify Cinematic-mode appearance, HDR behavior or temporal stability.

The next major product step is therefore not another feature campaign. It is a rendering and visual-language campaign.

## Goal

Make Cosmic Atlas capable of producing frames that read as contemporary cinematic astrophysical visualization rather than a collection of prototype Three.js effects, while preserving the existing scientific architecture and truthfulness.

The target is not to imitate a specific game engine or to fake offline path tracing. The target is:

- physically coherent macro-structure;
- high dynamic range emission with controlled display response;
- stable, high-frequency detail;
- rich scale cues;
- convincing volumetric structure;
- strong but restrained cinematic post processing;
- temporal stability during motion;
- graceful quality scaling;
- clear separation between direct/data-driven science and presentation-only detail.

A viewer should be able to switch to Scientific mode and see a restrained, legible, defensible visualization, or switch to Cinematic mode and see the same underlying model rendered with substantially richer presentation.

## What changes

This OpenSpec defines a multi-stage visual-fidelity program covering:

- visual baseline capture and forensic image audit;
- HDR continuity through all light-producing intermediate buffers;
- modernization of the shared post pipeline;
- optional RenderPipeline/MRT adoption after an API/backend spike;
- selective emissive bloom and glare masks;
- temporal reconstruction for stable supersampling and raymarch jitter;
- Volumetrics V2 with FP16 intermediates, improved sampling, detail fields, depth-aware composition and approximate lighting;
- Particle/strand rendering V2;
- a richer deterministic celestial environment;
- destination-specific visual reconstruction for Stellar Explosion, Tidal Disruption, Compact Merger, Neutron Star, Quasar/AGN, Galaxy Collision, Black-Hole Merger and the flagship Black Hole;
- cinematic camera/composition rules where they improve readability without overriding user control;
- quality-tier and governor integration;
- separate Scientific and Cinematic visual regression gates;
- temporal flicker, luminance and perceptual image metrics;
- WebGPU/WebGL2 compatibility and bounded fallback behavior;
- performance and memory certification for the new renderer.

The authoritative sequencing, implementation details and acceptance criteria live in MASTER_PLAN.md.

## Core architectural rule

The campaign SHALL preserve this separation:

scientific/data layer
→ validated positions, densities, trajectories, temperatures, timings and spacetime state
→ presentation mapping
→ render representation
→ HDR radiance
→ temporal/post pipeline
→ display

Presentation code may enrich how validated state is shown. It may not silently rewrite validated state to make an image prettier.

Any deliberately non-physical or unresolved detail layer must remain:

- deterministic;
- destination-owned or shared-service-owned;
- documented;
- disabled or restrained in Scientific mode where appropriate;
- disclosed as PROCEDURAL_SCIENTIFIC or CINEMATIC presentation rather than presented as direct simulation output.

## Non-goals

- replacing the current scientific models with an offline hydrodynamics, MHD or numerical-relativity solver;
- claiming Unreal Engine, path-traced or film-renderer equivalence;
- adding fake fire, shockwaves or luminous matter to vacuum black-hole scenes without an explicit cinematic disclosure;
- weakening physics/parity tests to accommodate visual changes;
- treating bloom, chromatic aberration, film grain or lens dirt as a substitute for better rendering;
- making WebGPU mandatory without an explicit fallback policy;
- replacing all destination renderers in one monolithic rewrite;
- changing all visuals simultaneously without an accepted vertical slice;
- deleting the current scientific golden suite;
- shipping a visual change because automated thresholds pass without human review of representative frames.

## Delivery strategy

The campaign is intentionally staged.

1. Establish a measurable visual baseline.
2. Fix shared HDR continuity and post architecture.
3. Build temporal reconstruction and Volumetrics V2.
4. Use Stellar Explosion as the first AAA-quality vertical slice.
5. Generalize successful shared infrastructure.
6. Upgrade the remaining destinations one at a time.
7. Polish the flagship black-hole renderer last, after the shared image pipeline is stable.
8. Certify Cinematic mode separately from Scientific mode.

Stellar Explosion is the first vertical slice because it stresses HDR emission, volumetrics, particles, turbulent detail, extreme scale change and temporal stability. It is the highest-leverage proving ground for shared rendering technology.

## Interaction with the performance campaign

The existing whole-atlas-performance-optimization change is paused, not discarded.

This visual campaign SHALL:

- preserve WS1 render invalidation;
- preserve WS2 transition occlusion;
- reuse existing telemetry and global governor concepts;
- avoid undoing startup/lazy-loading work;
- record the cost of every new visual layer;
- make High/Ultra/Cinematic features explicitly budgeted;
- prefer temporal reuse and quality scaling over unconditional brute force.

Where the two campaigns conflict, correctness and explicit measurement win. A visual feature that makes the app materially slower must either have a justified high/ultra-only budget or be redesigned before merge.

## Success criteria

The change is successful only when all of the following are true:

- a Cinematic-mode renderer exists as a real pipeline, not merely higher exposure plus bloom;
- no intended HDR light-producing stage is accidentally clamped to 8-bit before final display;
- at least one accepted vertical slice demonstrates the new target bar before full rollout;
- volumes can use stable jitter/reconstruction without animated grain;
- TDE streams have a non-flat high-quality representation;
- galaxy collision reads as interacting galaxies rather than sparse luminous points while preserving the data-driven backbone;
- vacuum BBH inspiral no longer depends on sphere/ring game-like markers as its primary high-quality representation;
- a richer environment gives the strong-field lensing paths enough structure to distort;
- Cinematic goldens exist separately from Scientific goldens;
- temporal stability has an automated gate;
- human-reviewed showcase frames are required at major milestones;
- Scientific mode remains truthful and legible;
- all physics/reference/lifecycle tests remain blocking;
- memory/resource counts remain bounded;
- WebGL2 behavior is explicit and tested;
- the final certification records exact backend, tier, resolution, browser, adapter, frame timing and known limitations.

## References

Primary implementation references to consult during execution:

- Three.js TSL / RenderPipeline documentation: https://threejs.org/docs/TSL.html
- Three.js WebGPURenderer documentation: https://threejs.org/docs/pages/WebGPURenderer.html
- Three.js selective bloom MRT example: https://threejs.org/examples/webgpu_postprocessing_bloom_selective.html
- NVIDIA GPU Gems 3, real-time 3D fluid ray casting and off-screen volume rendering: https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids
- NVIDIA GPU Gems, volume rendering techniques: https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-39-volume-rendering-techniques
- James et al., DNGR / Interstellar black-hole lensing and ray-bundle antialiasing: https://authors.library.caltech.edu/records/njdcq-95891
