# Design: Cinematic visual fidelity overhaul

## 1. Design thesis

Cosmic Atlas already has the correct high-level architecture for a serious visual overhaul: a shared renderer kernel, shared HDR post, a global governor, destination modules with explicit scientific fidelity classes, deterministic timelines, ResourceScope ownership, and a distinction between Scientific and Cinematic experience modes.

The problem is not that the renderer lacks architecture. The problem is that several presentation implementations stop at a technically valid but visually schematic representation.

The overhaul therefore follows one rule:

> Preserve scientific state and lifecycle architecture; replace or extend the presentation layer wherever the current representation caps visual quality.

The campaign is not a one-shot rewrite. It is a sequence of shared renderer upgrades followed by destination migrations.

## 2. Scientific state versus presentation state

Every visual decision must be classified before implementation.

### Scientific/data state

Examples:

- geodesic trajectory and termination class;
- black-hole spin and observer tetrad;
- neutron-star compactness and hot-spot coordinates;
- explosion shock radius;
- TDE stream centerline;
- compact-merger orbital state;
- BBH data-derived trajectories, waveform timing and remnant parameters;
- galaxy-collision tracer positions;
- AGN mass, orientation and timeline-derived continuum state.

These values remain authoritative.

### Presentation state

Examples:

- display-only radiance gain;
- micro-clumping;
- unresolved filament detail;
- sprite footprint;
- strand cross-section;
- bloom mask;
- temporal jitter sequence;
- glare kernel;
- color grade;
- depth-of-field;
- procedural secondary star populations;
- cinematic camera motion.

Presentation state may be richer than the scientific state, but it must not contradict it.

### Required disclosure

Every layer that materially adds structure not present in the validated model must be documented as one of:

- scientifically derived rendering;
- procedural scientific detail;
- cinematic presentation;
- illustrative diagnostic.

No layer may be described as simulated hydrodynamics, MHD or dynamical spacetime unless it actually is.

## 3. Shared image-formation architecture

Target pipeline:

scene scientific state
→ destination representation
→ linear HDR radiance and auxiliary buffers
→ temporal reconstruction
→ selective emissive effects
→ exposure/tone mapping
→ optional grade/lens response
→ display

The key architectural difference from the current pipeline is that the renderer should retain useful dynamic range and auxiliary information until late in image formation.

### 3.1 HDR continuity

SharedPost already uses RGBA16F for the main HDR target.

The overhaul audits every intermediate target that can carry emissive light. An intermediate that needs values above 1.0 must use a format that preserves them or must prove that clamping cannot affect its intended output.

The current VolumeService half-resolution target is the first known migration candidate because it uses RGBA8/UnsignedByte.

### 3.2 Auxiliary buffers

Research a small, intentional MRT set rather than a generic deferred renderer.

Candidate channels:

- main linear HDR radiance;
- emissive/highlight contribution;
- depth or linear eye distance;
- temporal motion/reprojection data where needed;
- optional classification/debug channel for strong-field passes.

MRT adoption is not automatic. Three.js r185 exposes RenderPipeline and MRT capabilities, and the official selective-bloom example demonstrates MRT-based bloom selection, but the repository must spike both WebGPU and forceWebGL behavior before committing to the architecture.

If one cross-backend MRT design is unstable, retain a simpler multi-pass fallback.

## 4. SharedPost V2

SharedPost remains the central presentation authority.

It should evolve into a composable pipeline with explicit stages:

1. resolve the scene/HDR source;
2. temporal resolve if enabled;
3. selective emissive bloom/glare;
4. transition compositing;
5. exposure;
6. tone mapping;
7. optional cinematic grade;
8. output color conversion.

### 4.1 Selective bloom

Bloom should be driven by emissive radiance or an explicit bloom mask, not only by a global luminance threshold over the entire frame.

Benefits:

- hot photospheres can glow without making UI-like geometry bloom;
- stars and jets can receive distinct treatment from dusty volumes;
- strong-field lensing backgrounds remain crisp;
- black-hole shadows are less likely to acquire broad halo contamination.

Scientific mode keeps bloom disabled by default.

### 4.2 Glare

Research a restrained stellar glare stage for extreme highlights:

- anisotropic/starburst component for point-like emitters only;
- intensity tied to HDR radiance;
- small kernel budget;
- no screen-wide fake lens flare by default;
- optional cinematic-only threshold.

This is presentation-only.

### 4.3 Tone mapping and grading

Keep ACES Filmic and AgX as supported tone-mapping choices.

Add a cinematic grade only if:

- it is represented as display state;
- it is deterministic;
- it does not alter scientific values;
- it is covered by cinematic goldens;
- it is disabled in Scientific mode unless the user explicitly opts in.

The grade should be modest: black-level shaping, highlight roll-off, saturation response and color balance. Avoid teal-orange global grading as a default aesthetic.

## 5. Temporal reconstruction

Temporal reconstruction is a shared capability, not a destination hack.

### 5.1 Motivation

The project already proved that temporal jitter without accumulation looks like animated grain. The solution is not to permanently disable jitter; the solution is to add history.

Temporal reconstruction should permit:

- subpixel camera jitter;
- raymarch start jitter;
- stochastic micro-detail;
- progressive quality while camera is settled;
- reduced per-frame sample count for equal perceived quality.

### 5.2 History inputs

Minimum history record:

- previous color/HDR;
- previous camera transform/projection;
- current camera transform/projection;
- timeline/destination revision;
- quality/render-scale revision;
- transition state.

Where exact motion vectors are unavailable, start with camera-only reprojection for stationary scene geometry and reject history aggressively for destination states that changed.

### 5.3 History invalidation

History must be discarded or sharply downweighted on:

- destination switch;
- preset switch;
- timeline discontinuity/scrub;
- large camera cut;
- quality/render-scale change;
- viewport resize;
- backend switch;
- transition handoff;
- material graph variant change;
- explicit debug-mode change that changes image output.

### 5.4 Stability policy

The temporal system should prefer rejection over ghosting.

Critical acceptance scenes:

- black-hole photon ring / critical curve;
- neutron-star limb;
- supernova shock edge;
- TDE thin stream;
- galaxy tidal tail;
- BBH strong lensing;
- bright point stars against black background.

## 6. Volumetrics V2

Volumetrics V2 is the largest shared visual upgrade.

### 6.1 Representation

Retain analytic/procedural density callbacks as the scientific macro-field.

Add optional detail callbacks or detail textures as presentation layers:

density = macro density × structured detail

Candidate detail components:

- low-frequency asymmetry;
- multi-octave value/simplex-like noise;
- ridged filament term;
- curl-like displacement or domain warp;
- clump mask;
- radial/axial bias;
- stage-dependent detail amplitude.

The detail system must be deterministic and seed-controlled.

### 6.2 Sampling

Requirements:

- half-float intermediate when HDR emission requires it;
- jittered sample origin;
- history reconstruction;
- sample count driven by global WorkBudget;
- early alpha termination;
- scene-depth clipping where available;
- conservative volume bounds;
- optional adaptive sample density near high gradients.

Do not introduce unbounded loops.

### 6.3 Depth-aware composition

Current half-resolution linear upsampling can halo at geometry boundaries.

Research:

- full-resolution scene depth;
- half-resolution volume depth/entry-exit metadata;
- bilateral or depth-aware upsampling;
- camera-inside-volume behavior;
- strong edge cases around small foreground emitters.

Fallback: full-resolution volume at high tier for scenes where depth-aware reconstruction is not reliable.

### 6.4 Lighting model

Do not pretend to perform full radiative transfer.

Add a documented approximate lighting model where useful:

- emission-absorption remains the base;
- optional one/few directional extinction taps for self-shadowing;
- local gradient-based shading for dense fronts;
- hot interior to cool exterior gradients;
- phase-function approximation only when a destination has a meaningful scatterer concept.

The service disclosure must continue to state what is and is not simulated.

## 7. Particle and unresolved-emitter rendering V2

ParticleService should support multiple presentation classes instead of one generic soft sprite.

Candidate modes:

- star: compact Gaussian/Moffat-like point-spread profile;
- ejecta: soft sprite with velocity stretch;
- spark/debris: elongated motion-aligned sprite;
- dust: low-frequency translucent blob;
- fireball/accretion accent: emissive soft core plus halo.

### 7.1 Velocity stretch

For high-speed ejecta, orient/elongate the sprite along projected velocity.

This provides motion structure without increasing population count dramatically.

### 7.2 Density clustering

Allow deterministic cluster membership/brightness modulation so populations do not look uniformly random.

### 7.3 Screen-space size discipline

Keep explicit pixel-space sizing where content represents unresolved sources.

World-space sizing may be used only where the particle represents a resolved physical clump.

## 8. Strand / stream rendering V2

RibbonService remains useful for low/medium tiers and diagnostic paths.

High/Ultra should add a new strand/tube representation.

### 8.1 TDE strand

Input:

- authoritative validated stream spine;
- tangent;
- local transported frame;
- stage/temperature/density parameters.

Output:

- elliptical or variable cross-section;
- volumetric or impostor-like optical profile;
- longitudinal clumps;
- radial opacity falloff;
- temperature gradient;
- optional shock brightening.

This must remain anchored to the scientific centerline.

### 8.2 Orbital trails

For trails that are intentionally illustrative, keep a stylized ribbon mode but improve:

- antialiasing;
- screen-space width;
- fade profile;
- luminance control;
- depth behavior.

Do not confuse illustrative trails with physical luminous matter.

## 9. Celestial environment V2

Strong-field lensing only looks as rich as the environment it distorts.

Build a shared deterministic environment with multiple frequency bands:

- large-scale galactic/Milky-Way-like diffuse background;
- resolved bright stars;
- dense unresolved star field;
- stellar color distribution;
- low-amplitude nebular/dust structure where licensed/procedural.

### 9.1 Requirements

- deterministic under fixed seed/orientation;
- linear HDR output;
- documented orientation;
- high enough angular frequency to reveal lensing;
- no dependency on frame order;
- WebGL2-compatible fallback;
- resource licensing/provenance tracked.

A procedural baseline is acceptable. A licensed HDR environment may be added later.

## 10. Quality-tier architecture

The global governor remains authoritative.

Visual quality must be expressed as a shared VisualWorkBudget.

Candidate fields:

- renderScale;
- temporalSamples/historyWeight;
- volumeActiveSteps;
- volumeInternalScale;
- volumeDetailOctaves;
- volumeLightingTaps;
- particlePopulationScale;
- particleProfileMode;
- strandMode;
- environmentResolution/detail;
- bloomResolutionScale;
- glareEnabled;
- lensingSupersampleMode.

Suggested semantics:

### Low

Correct, readable, minimal expensive cinematic features.

### Medium

Current production-quality scientific visualization with selected improvements.

### High

FP16 volumetrics, improved emitters, temporal reconstruction and richer environment.

### Ultra

Highest real-time visual quality: maximum validated volume/strand/environment detail and stronger stable reconstruction.

### Cinematic Ultra

An optional showcase tier or stable-camera convergence state. It may trade latency for quality, but it must remain interactive enough for intended use and never become an unbounded offline renderer.

## 11. Destination migration order

### 11.1 Stellar Explosion — first vertical slice

Why first:

- exercises volumetrics;
- exercises HDR;
- exercises particles;
- exercises extreme scale;
- has obvious before/after quality;
- shares technology with multiple later destinations.

Target visual layers:

- progenitor photosphere;
- breakout flash;
- structured ejecta shell;
- turbulent clumps/filaments;
- hot interior/cool outer material;
- shock edge;
- velocity-stretched ejecta;
- GRB jet structure.

No runtime hydrodynamics claim is added.

### 11.2 Tidal Disruption

Replace flat high-quality stream ribbons with Strand/Stream V2.

Add:

- cross-section evolution;
- optical-depth profile;
- density clumps;
- temperature/emission variation;
- stronger circularization shock structure;
- nascent-disc detail.

Preserve validated orbital centerlines and stage timing.

### 11.3 Compact Merger and Neutron Star

Shared star renderer should support:

- stable HDR photosphere;
- temperature-based emission;
- hot spots;
- strong limb stability;
- higher quality magnetic/beam visualization;
- kilonova volumetrics;
- structured post-merger ejecta.

Relativistic surface effects may only be added when physically implemented and validated.

### 11.4 Quasar / AGN

Improve scale separation:

- inner lensing remains direct;
- nuclear disc receives more radial/azimuthal detail;
- dusty torus receives layered clumpy extinction;
- jet receives spine/sheath structure;
- galactic host receives richer diffuse stellar structure.

Do not fake kpc-scale time evolution on the existing short timeline.

### 11.5 Galaxy Collision

Treat validated tracers as a dynamical backbone.

Add a procedural rendering reconstruction:

- diffuse stellar density around/among tracers;
- many secondary unresolved emitters sampled deterministically from the tracer/density field;
- optional dust/gas layer;
- optional star-forming knots only with explicit cinematic/procedural disclosure.

Scientific/data positions remain unchanged.

### 11.6 Black-Hole Merger

Inspiral presentation should no longer be primarily dark balls with glowing rings.

High/Ultra target:

- detailed shared environment;
- moving local lensing fields or other validated/illustrative strong-field representation tied to component trajectories;
- better horizon/critical-region visual language;
- data-driven motion remains authoritative;
- merger flash remains explicitly cinematic;
- remnant continues to use the validated Kerr pass.

Vacuum scenes must not grow fake flames/disks.

### 11.7 Flagship Black Hole — final polish

Do this after the shared pipeline is mature.

Targets:

- richer lensed environment;
- improved accretion-disc radiance/spectral treatment;
- targeted supersampling near critical features;
- stable photon-ring/critical-curve reconstruction;
- selective bloom/glare;
- improved observer-motion temporal stability.

The DNGR lesson is relevant here: rapidly varying, highly magnified lensing features require strong antialiasing/sampling stability. The browser implementation need not reproduce DNGR ray bundles, but should use the same principle: allocate extra sampling where the lens map is rapidly changing.

## 12. Camera and cinematic composition

AutoFramer solved basic visibility. The visual campaign may add a CinematicCameraPolicy layer.

Rules:

- never steal camera control after user takeover;
- never alter scientific observer state when only display camera motion is intended;
- distinguish physical observer motion from presentation camera motion;
- use eased focal framing only for presets/automatic showcases;
- reduced-motion preference must disable nonessential camera choreography;
- camera cuts must invalidate temporal history.

Potential features:

- destination-authored key framing at important phases;
- subtle target lead for expanding events;
- shot presets;
- optional auto-orbit only as a cinematic feature.

## 13. Validation architecture

Two independent visual gates are required.

### 13.1 Scientific Goldens

Keep existing philosophy:

- deterministic;
- low/controlled tier;
- bloom off;
- restrained tone mapping;
- geometry/physics readability.

Do not weaken this gate.

### 13.2 Cinematic Goldens

New gate:

- fixed high or ultra tier;
- fixed viewport, initially 1920×1080 if runner budget permits;
- cinematic tone mapping/exposure;
- bloom enabled when intended;
- temporal settle protocol;
- exact destination/preset/phase/camera;
- hardware/backend metadata recorded.

Goldens must test appearance, not only existence.

## 14. Temporal and perceptual metrics

Add metrics beyond raw pixel delta.

Candidate metrics:

- frame-to-frame temporal luma delta after settled-state convergence;
- edge flicker around high-contrast silhouettes;
- saturation percentage;
- black crush percentage;
- luminance histogram;
- highlight percentile;
- SSIM or another deterministic structural metric;
- spatial-frequency energy;
- optional LPIPS-like offline tool only if dependency weight and reproducibility are acceptable.

No metric replaces human review.

## 15. Human visual review gate

At the end of each major destination migration, capture:

- wide establishing shot;
- medium composition;
- close/detail shot;
- moving sequence or sampled timeline strip;
- Scientific versus Cinematic comparison.

A reviewer must inspect the images.

The campaign explicitly rejects the failure mode already found in current goldens: automated acceptance can pass an obviously wrong sparse-on-black image if thresholds are poorly matched to content.

## 16. Performance integration

Every new effect gets a cost ledger.

Record:

- GPU frame time;
- CPU frame delta;
- internal pixel count;
- render pass count;
- draw/compute counts;
- memory/render-target bytes;
- quality tier;
- backend;
- adapter/browser;
- static versus moving camera.

High/Ultra features may be more expensive, but they must be bounded.

Required behavior:

- interaction may temporarily lower expensive sample/detail budgets;
- settled scenes may progressively improve;
- no destination may allocate unbounded temporal or particle history;
- frame invalidation must remain active;
- hidden/occluded work elimination from the performance campaign must remain.

## 17. WebGL2 fallback

The primary visual target is WebGPU, but forceWebGL remains a supported path.

Feature classification:

- Tier A: identical algorithm on WebGPU/WebGL2;
- Tier B: simplified equivalent on WebGL2;
- Tier C: WebGPU-only cinematic enhancement with an explicit graceful fallback.

Scientific correctness features may not become Tier C solely for convenience.

Examples likely suitable for fallback simplification:

- lower volume detail octaves;
- lower history precision;
- no optional glare;
- simpler strand representation;
- reduced secondary galaxy population.

## 18. Resource ownership

Every new resource is owned by ResourceScope.

Includes:

- temporal history targets;
- auxiliary MRT targets;
- volume depth/history targets;
- environment textures;
- secondary galaxy buffers;
- strand materials/geometry;
- LUT/grade textures;
- glare kernels.

History resources must be released on destination/kernel disposal and resized without leaking old targets.

## 19. Migration safety

Each shared-service upgrade needs a compatibility mode until at least one destination certifies it.

Examples:

- VolumeService legacy versus V2 path;
- RibbonService legacy versus StrandService;
- SharedPost legacy versus RenderPipeline prototype;
- environment v1 versus v2;
- temporal off versus on.

Remove old paths only after:

- all consumers migrate;
- WebGPU and WebGL2 gates pass;
- memory plateaus;
- visual review accepts output;
- no scientific tests depend on the old behavior.

## 20. Decision record template

Every substantial visual prototype records:

- problem;
- hypothesis;
- representation change;
- scientific inputs preserved;
- presentation data added;
- fidelity/disclosure classification;
- expected quality gain;
- expected cost;
- before capture;
- after capture;
- temporal behavior;
- WebGPU result;
- WebGL2 result;
- performance numbers;
- memory numbers;
- keep/reject decision.

This is mandatory for shared renderer changes and destination rewrites.

## 21. External implementation references

Three.js:

- TSL and RenderPipeline: https://threejs.org/docs/TSL.html
- WebGPURenderer: https://threejs.org/docs/pages/WebGPURenderer.html
- selective bloom MRT example: https://threejs.org/examples/webgpu_postprocessing_bloom_selective.html

Volume rendering:

- GPU Gems 3 chapter 30: https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids
- GPU Gems chapter 39: https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-39-volume-rendering-techniques

Strong-field cinematic rendering:

- James et al., Gravitational lensing by spinning black holes and Interstellar: https://authors.library.caltech.edu/records/njdcq-95891

These references guide implementation technique. They do not supersede repository physics conventions, backend constraints or validation contracts.
