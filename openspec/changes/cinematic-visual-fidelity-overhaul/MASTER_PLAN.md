# Cosmic Atlas Cinematic Visual Fidelity Overhaul — Implementation Master Plan

Change ID: cinematic-visual-fidelity-overhaul
Status: PLAN ONLY — NO RUNTIME IMPLEMENTATION IN THIS CHANGE
Priority: HIGH
Planned-From: main@518bff7b8c14e4a22ada4c9376f166d8565c5263
Planned-At: 2026-08-29
Target-Branch: main
Planning-Branch: plan/cinematic-visual-fidelity-overhaul
Scope: shared renderer plus all eight production destinations
Primary target: materially more realistic, contemporary, cinematic astrophysical rendering while preserving scientific truthfulness, determinism, performance governance and browser compatibility

## 0. Mission

The Cosmic Atlas is already beyond proof-of-concept in architecture and scientific implementation. It has:

- a shared WebGPU-first renderer with force-WebGL2 fallback;
- a half-float HDR scene target;
- direct Schwarzschild and Kerr strong-field renderers;
- direct neutron-star surface lensing;
- validated procedural and data-driven destination models;
- deterministic timelines and presets;
- ResourceScope ownership;
- a global performance governor;
- extensive physics, browser and visual regression tests.

The remaining weakness is the final image.

Several destinations still communicate their state using visual primitives that are technically valid but visibly schematic: soft point sprites, flat ribbons, simple emissive spheres, uniform or low-detail volumes, sparse point clouds and broad additive glows. The current Cinematic mode is mainly a display preset over the same representation layer. The result can look like an older game or a scientific prototype even when the underlying model is working correctly.

This campaign changes that.

The mission is:

> Preserve the scientific/data layer. Rebuild the image-formation and presentation layer until the project can produce stable, high-dynamic-range, visually rich frames that look intentionally cinematic rather than accidentally game-like.

The campaign is permitted to make large presentation-layer changes. It is not permitted to falsify the astrophysics.

## 1. Audit basis: what the repository actually does today

This plan is based on direct inspection of the current repository at main@518bff7.

### 1.1 Runtime stack

Current package baseline:

- TypeScript;
- Vite;
- Three.js 0.185.1;
- WebGPURenderer with WebGPU preferred;
- WebGPURenderer forceWebGL fallback;
- TSL/node materials;
- Vitest;
- Playwright.

No new rendering dependency is assumed by this plan. The first implementation attempt should use the pinned Three.js stack unless a specific missing capability is proven.

### 1.2 Shared renderer

Relevant files include:

- src/renderer/SharedRendererKernel.ts
- src/renderer/shared/SharedPost.ts
- src/renderer/shared/VolumeService.ts
- src/renderer/shared/ParticleService.ts
- src/renderer/shared/RibbonService.ts
- src/renderer/shared/LensingService.ts
- src/renderer/shared/CameraRig.ts
- src/atlas/host.ts
- src/atlas/governor.ts
- src/atlas/types.ts

SharedRendererKernel already centralizes:

- renderer ownership;
- backend selection;
- HDR target binding;
- frame orchestration;
- GPU timestamp tracking where available;
- renderer sizing;
- device-loss handling.

That architecture should remain.

### 1.3 SharedPost current state

SharedPost already does several things correctly:

- main HDR target uses HalfFloatType / RGBA16F-class storage;
- scene rendering into the HDR target remains linear;
- canvas presentation applies exposure/tone mapping;
- bloom is applied in HDR before display transform;
- transition overlays are composited in HDR;
- snapshot capture stays HDR;
- bloom can be disabled to eliminate its graph/cost.

Current limitation:

- there is one generalized bloom path based on the scene HDR texture;
- no separate emissive/highlight attachment;
- no temporal reconstruction;
- no cinematic grade stage;
- no dedicated glare/point-spread stage;
- no explicit auxiliary-buffer architecture.

Current Cinematic defaults in host.ts are approximately:

- exposure 1.1;
- ACES Filmic;
- bloom on;
- bloom strength 0.6.

That is a useful preset, not yet a cinematic rendering pipeline.

### 1.4 VolumeService current state

VolumeService is already a legitimate raymarched emission-absorption renderer.

Strengths:

- analytic bounds intersection;
- bounded raymarch loop;
- front-to-back accumulation;
- early alpha termination;
- deterministic jitter support;
- optional half-resolution rendering;
- explicit fidelity disclosure;
- shared service ownership.

Important quality limits:

- the half-resolution internal target uses RGBA8 / UnsignedByteType;
- linear filtering is used for upsampling;
- no scene-depth-aware upsampling;
- no temporal accumulation/reprojection;
- no multiple-scattering model;
- no advanced self-shadowing;
- no generic high-frequency detail framework;
- deterministic jitter is often disabled in destination use because without history it becomes visible grain.

This is the single highest-leverage shared visual service to upgrade.

### 1.5 ParticleService current state

ParticleService is robust engineering infrastructure:

- deterministic seed handling;
- CPU fallback;
- optional compute path;
- bounded population;
- GPU storage buffers;
- color-ramp lookup;
- fixed pixel-size semantics after the recent size fix;
- explicit soft radial sprite profile.

But visually it is still a generalized camera-facing sprite system.

That means supernova ejecta, galaxy tracers and other unresolved populations can still look like particles from a conventional game.

### 1.6 RibbonService current state

RibbonService uses a stable parallel-transported lateral frame and preallocated triangle-strip geometry.

It is useful and correct for:

- trails;
- diagnostics;
- low-cost streams.

It is not an adequate final High/Ultra representation for:

- TDE gaseous debris streams;
- any structure expected to read as a volumetric astrophysical strand.

A new high-quality representation is needed while RibbonService remains as fallback.

### 1.7 Destination-specific current constraints

Stellar Explosion:

- procedural scientific macro-model is strong enough to keep;
- volume + particles + progenitor sphere are the main visual layers;
- recent fixes stopped saturation and restored motion;
- ideal first vertical slice for Volumetrics V2.

Tidal Disruption:

- authoritative stream geometry/timing already exists;
- current stream presentation is ribbon-based;
- shock/nascent disc use shared volume/procedural layers;
- ideal second target after Volumetrics/Strand infrastructure.

Compact Merger:

- direct reduced inspiral plus procedural post-merger;
- photospheres and ejecta can benefit from star renderer + Volumetrics V2.

Neutron Star:

- direct surface-ray tracing is scientifically valuable;
- visual improvement should focus on photosphere, hot spots, beams, field lines and environment without inventing missing relativistic physics.

Quasar / AGN:

- recent work fixed flat/opaque presentation failures;
- still needs richer scale hierarchy, torus detail, jet structure and host-light structure.

Galaxy Collision:

- data-driven GC1 backbone contains 1,600 tracers;
- current view uses unresolved sprite clouds and nuclei;
- physically/data-wise useful, visually sparse;
- needs a rendering reconstruction around the authoritative tracer backbone.

Black-Hole Merger:

- SXS-backed motion/timing and waveform are strong;
- Kerr remnant is a real strong-field renderer;
- inspiral presentation remains sphere/ring/glow/trail-heavy;
- High/Ultra should move to a lensing/spacetime-first visual language.

Black Hole:

- currently the most mature visual destination;
- should be polished last so it benefits from the stabilized shared environment, temporal pipeline and selective HDR effects.

### 1.8 Current visual test limitation

The current scientific visual-golden harness deliberately forces:

- low quality;
- exposure 1;
- bloom off;
- linear tone mapping.

That is correct for many scientific regression purposes.

It is weak evidence for cinematic quality, because:

- HDR radiance above 1 can clamp to the same displayed white;
- bloom regressions are invisible;
- cinematic grade regressions are invisible;
- temporal reconstruction is not exercised;
- high-tier detail is not exercised.

Therefore this campaign must add a second cinematic gate instead of mutating the scientific one.

## 2. What AAA/cinematic means for this project

The term must be operational rather than aspirational.

A destination is not considered visually complete merely because it has more particles, more bloom or more shader code.

For this project, cinematic/AAA quality means all six properties below are simultaneously credible.

### 2.1 Structural richness

The image contains coherent detail at multiple spatial scales:

- macro morphology from the scientific model;
- meso-scale structure from model-compatible procedural detail;
- micro-scale unresolved detail where appropriate.

Flat single-frequency blobs fail this criterion.

### 2.2 Dynamic range

Bright astrophysical emitters can exceed diffuse white in the linear pipeline and are rolled into display range deliberately.

The renderer should show:

- bright cores;
- controlled highlight roll-off;
- non-crushed shadow structure;
- selective glow;
- no accidental 8-bit clipping in intermediate emissive passes.

### 2.3 Temporal stability

The scene must remain convincing while moving.

No:

- shimmering star fields;
- crawling volume noise;
- unstable photon rings;
- flickering subpixel strands;
- persistent TAA ghosts;
- popping detail tiers.

A beautiful still frame with bad motion does not pass.

### 2.4 Depth and scale

The image must communicate enormous astrophysical scale through:

- layering;
- density hierarchy;
- occlusion;
- parallax where relevant;
- angular-size discipline;
- camera composition;
- environment structure.

Simply moving the camera farther away is not sufficient.

### 2.5 Material/medium specificity

Different phenomena must not all look like the same glowing shader.

Examples:

- supernova ejecta should read differently from AGN dust;
- kilonova ejecta should read differently from TDE stream gas;
- unresolved stars should read differently from ejecta particles;
- vacuum black-hole lensing should read differently from emitting matter.

### 2.6 Scientific honesty

The visual must remain explicit about what is direct/data-driven versus procedural/cinematic.

Cinematic quality is not permission to fabricate physics.

## 3. Hard invariants

No implementation task may violate these.

### 3.1 Physics invariants

- Schwarzschild and Kerr parity/reference suites remain blocking.
- Neutron-star direct surface-ray reference behavior remains blocking.
- Moving-observer tetrad/worldline behavior remains blocking.
- SXS BBH timing/data remains authoritative.
- GC1 galaxy-collision dataset remains authoritative.
- TDE trajectory/debris model remains authoritative.
- Explosion macro evolution remains authoritative.
- Scientific model state cannot be moved just to improve composition.

### 3.2 Failure honesty

- Numerical failure remains explicit.
- Do not paint MAX_STEPS as shadow/background.
- Do not hide Kerr failure artifacts by silently reclassifying rays.
- Do not invent missing matter.

### 3.3 Architecture invariants

- one shared renderer owner;
- one global governor;
- ResourceScope ownership;
- deterministic seeded presentation;
- WebGPU preferred;
- forceWebGL fallback maintained;
- Scientific/Cinematic mode boundary maintained.

### 3.4 Test invariants

- do not weaken physics tolerances because presentation changed;
- do not widen visual tolerances merely to turn red green;
- do not regenerate baselines without reviewed reason;
- human inspection remains mandatory for major visual changes.

## 4. Target architecture

Target frame architecture:

    authoritative destination state
        ↓
    destination representation layer
        ↓
    linear HDR scene radiance + selected auxiliary data
        ↓
    temporal reconstruction / progressive resolve
        ↓
    selective emissive bloom and optional glare
        ↓
    transition composite
        ↓
    exposure + tone mapping
        ↓
    optional deterministic cinematic grade
        ↓
    output color conversion
        ↓
    canvas

Supporting services:

    EnvironmentService
    Volumetrics V2
    ParticleService V2
    StrandService
    LensingService
    CameraRig
    VisualWorkBudget

## 5. Proposed shared interfaces

Exact TypeScript naming may change during implementation, but responsibilities should remain stable.

### 5.1 VisualWorkBudget

Proposed host/global state:

    interface VisualWorkBudget {
      renderScale
      temporalEnabled
      temporalHistoryFrames
      temporalJitterScale
      volumeActiveSteps
      volumeInternalScale
      volumeDetailOctaves
      volumeLightingTaps
      particlePopulationScale
      particleProfileQuality
      strandQuality
      environmentDetail
      bloomResolutionScale
      glareEnabled
      lensingSupersampleQuality
    }

The governor resolves this object from:

- quality tier;
- activity mode;
- target FPS;
- backend capability;
- optional cinematic-stable state.

Destinations consume it. They do not create private quality controllers.

### 5.2 TemporalState

Proposed conceptual contract:

    current camera/projection revision
    previous camera/projection
    destination revision
    timeline revision
    render-size revision
    pass/material revision
    history age
    valid/invalid reason

The temporal service must expose explicit reset reasons for debugging.

### 5.3 VolumeConfig V2

Keep existing macro density/emission callbacks.

Add optional presentation fields such as:

    detail seed
    detail octaves
    detail strength
    filament strength
    clump strength
    domain warp strength
    depth aware compose flag
    lighting mode
    requested HDR intermediate

Do not force every volume to use every feature.

### 5.4 Particle render profile

Conceptual values:

    generic-soft
    star
    ejecta-streak
    debris-streak
    dust
    emissive-core

Profiles describe presentation, not physics.

### 5.5 StrandService

Input remains spine-first:

    spine points
    width/cross-section profile
    density/opacity profile
    temperature/color profile
    clump seed
    quality

The spine remains authoritative.

### 5.6 EnvironmentService

Responsibilities:

- deterministic world-space environment;
- bright stars;
- unresolved stars;
- diffuse galactic band;
- optional dust/nebular structure;
- linear HDR sampling;
- quality-tier detail;
- provenance.

## 6. Workstream VF0 — establish visual truth before changing code

No renderer work starts until the current output is captured honestly.

### 6.1 Capture matrix

For every destination capture:

- Scientific mode;
- Cinematic mode;
- default preset;
- one alternate representative preset;
- at least three meaningful phases where the destination evolves;
- wide shot;
- medium shot;
- detail shot.

For animated scenes capture a short sequence or evenly spaced frame strip.

### 6.2 Required baseline destinations

Black Hole:

- classic Schwarzschild;
- high-spin Kerr;
- one moving-observer preset.

Neutron Star:

- surface;
- pulsar;
- magnetar.

Stellar Explosion:

- progenitor;
- flash;
- expansion;
- hypernova;
- GRB.

Compact Merger:

- inspiral;
- contact/merger;
- kilonova;
- remnant.

Tidal Disruption:

- approach;
- deformation;
- debris;
- winding;
- shock;
- nascent disc.

Quasar/AGN:

- inner;
- nuclear;
- radio galaxy;
- blazar.

Black-Hole Merger:

- inspiral;
- near-merger;
- ringdown;
- remnant.

Galaxy Collision:

- encounter;
- bridge/tail;
- post-encounter.

### 6.3 Visual defect taxonomy

Every baseline frame is reviewed against:

- saturation/clipping;
- black crush;
- flatness;
- scale readability;
- particle look;
- ribbon look;
- insufficient detail;
- repetitive/noise pattern;
- poor depth;
- weak environment;
- aliasing;
- shimmer/flicker;
- temporal ghosting;
- bloom spill;
- color imbalance;
- camera/composition;
- UI obstruction;
- backend discrepancy.

### 6.4 Baseline performance

Same captures record:

- internal resolution;
- GPU time;
- CPU frame delta;
- draw calls;
- compute calls;
- triangles/points;
- render targets;
- ResourceScope bytes;
- adapter/browser/backend.

This prevents visual improvements from hiding severe cost regressions.

## 7. Workstream VF1 — HDR continuity

This is the first implementation work because every later cinematic effect depends on correct radiance.

### 7.1 Known issue to fix first

VolumeService half-resolution target currently uses UnsignedByteType.

For emissive volumes this can clamp radiance before SharedPost bloom/tone mapping.

Change design:

- use HalfFloatType where backend supports required renderability;
- preserve premultiplied alpha semantics;
- verify filtering behavior;
- retain explicit fallback when half-float render targets are unavailable.

### 7.2 Validation probe

Add a deterministic test volume emitting radiance values such as:

- 0.5;
- 1.0;
- 2.0;
- 4.0.

Read or infer the HDR target before tone mapping.

Acceptance:

- values above 1 remain distinguishable in the HDR path within expected precision;
- final tone-mapped values differ appropriately;
- bloom/highlight extraction sees higher radiance.

### 7.3 Audit all emissive intermediates

Review:

- volume half-res target;
- transition snapshot;
- any future temporal history;
- future MRT attachments;
- environment textures;
- grade/LUT textures;
- post intermediates.

Document the intended color space and numeric range.

### 7.4 Performance/memory rule

FP16 costs more bandwidth/memory than RGBA8.

Measure:

- GPU ms;
- target bytes;
- resize churn;
- mobile/weak-GPU behavior.

If all volumes use FP16 unnecessarily, allow per-volume HDR requirement flags so non-emissive/low-range effects can remain cheaper.

## 8. Workstream VF2 — SharedPost V2 and RenderPipeline/MRT spike

Do not blindly rewrite SharedPost because Three.js now has newer post abstractions.

Three.js r185 documents RenderPipeline and supports MRT. The official selective bloom example uses MRT to decide bloom participation.

That is promising, but the repository must validate the exact pinned behavior.

### 8.1 Spike A: pixel-equivalent RenderPipeline

Reproduce current SharedPost output using RenderPipeline:

- same HDR input;
- same bloom off path;
- same bloom on path;
- same tone mapping;
- same transition composite;
- same snapshot behavior.

Compare against current output.

### 8.2 Spike B: MRT selective emission

Prototype attachments:

- main radiance;
- emissive/highlight.

Test:

- WebGPU;
- forceWebGL;
- transparent volume materials;
- particle materials;
- lensing fullscreen materials;
- transition overlay.

Known Three.js/community history indicates MRT + volume/post combinations can have backend/material edge cases. Treat this as a compatibility spike, not an assumption.

### 8.3 Decision gate

Choose one:

A. Full RenderPipeline/MRT migration.
B. Hybrid: keep custom HDR target and add selective emissive pass.
C. Keep current SharedPost architecture, extend with explicit additional target(s).

Decision criteria:

- visual quality;
- WebGPU correctness;
- WebGL2 correctness;
- shader complexity;
- pass count;
- memory;
- resource lifecycle;
- capture/test support;
- ease of temporal integration.

### 8.4 SharedPost V2 stage order

Target order:

1. scene HDR;
2. temporal resolve;
3. bloom/glare;
4. transition composite;
5. renderer exposure/tone map;
6. optional grade/output.

If transition behavior requires a different temporal ordering, document it explicitly.

### 8.5 Selective bloom

Bloom should preferentially use:

- explicit emissive attachment;
- explicit bloom intensity;
- or a destination-authored emissive mask.

Examples:

- neutron-star photosphere: yes;
- hot supernova shock: yes;
- debug lines: no;
- black-hole shadow: no;
- galaxy nucleus: yes;
- ordinary diffuse dust: low/none depending on radiance.

### 8.6 Glare

Glare is optional and high-tier/cinematic only.

Prototype:

- small starburst kernel;
- bright-star/compact-emitter mask;
- threshold tied to HDR intensity;
- low tap count.

Reject if it causes:

- obvious game-lens artifacts;
- heavy cost;
- motion shimmer;
- contamination of scientific shapes.

### 8.7 Color grade

Do not ship a grade simply because it looks dramatic.

If kept:

- deterministic;
- modest;
- experience-mode state;
- validated with cinematic goldens;
- no UI contamination;
- no change to scientific state.

## 9. Workstream VF3 — temporal reconstruction

This is the enabling technology for higher visual complexity without brute-force samples.

### 9.1 Initial scope

Version 1 should solve:

- camera jitter antialiasing;
- volume jitter stabilization;
- stable subpixel emitters;
- progressive settled-frame improvement.

Do not start with a universal motion-vector renderer for every procedural phenomenon.

### 9.2 Jitter sequence

Use a deterministic low-discrepancy sequence such as:

- Halton;
- R2;
- fixed blue-noise sample set.

Requirements:

- fixed sequence under deterministic capture;
- no Math.random;
- no dependence on frame timing.

### 9.3 Reprojection phases

Stage 1:

- camera-only reprojection;
- only use history aggressively when destination state is unchanged.

Stage 2:

- selected destination motion vectors or world-position reconstruction if required.

Stage 3:

- specialized strong-field temporal logic where ordinary reprojection fails.

### 9.4 History rejection

Reject history when:

- color neighborhood disagrees strongly;
- depth disagrees;
- destination revision changed;
- timeline revision changed;
- camera cut occurred;
- render scale changed;
- strong-field classification changed;
- volume stage changed sharply.

### 9.5 Critical-region special case

Black-hole critical curves are dangerous for temporal accumulation because tiny camera changes can produce large image changes.

For those pixels:

- history confidence should be lower;
- neighborhood clamp tighter;
- or dedicated supersampling used instead.

### 9.6 Settled convergence

When:

- camera stable;
- timeline paused or deterministic static state;
- transition idle;

the renderer may increase history length or sample quality.

This is how Cinematic Ultra can look expensive without demanding that cost during interaction.

## 10. Workstream VF4 — Volumetrics V2

This workstream should produce a reusable medium renderer, not a one-off supernova shader.

### 10.1 Macro field remains authoritative

Examples:

Supernova:

- shell radius;
- shell width;
- anisotropy;
- stage;
- jet axis.

TDE:

- shock torus radius;
- stream geometry;
- nascent disc geometry.

AGN:

- torus scale;
- opening angle;
- temperature response.

Compact merger:

- ejecta geometry;
- kilonova stage.

Volumetrics V2 adds detail inside or around those constraints.

### 10.2 Detail basis

Implement a deterministic detail library.

Candidate terms:

Low-frequency warp:
- breaks perfect symmetry.

Fractal detail:
- multiple octaves of noise.

Ridged detail:
- filament/shell fronts.

Clump mask:
- sparse dense structures.

Radial gradient:
- hot/cool transition.

Angular modulation:
- anisotropic lobes.

Each term must have:

- seed;
- amplitude;
- frequency;
- tier cost;
- destination-specific meaning.

### 10.3 Avoid generic noise soup

A common failure would be to apply the same fractal noise to every phenomenon.

Instead define destination profiles.

Supernova profile:

- expanding shell;
- radial filaments;
- asymmetric plumes;
- shock edge;
- clumps.

AGN dust:

- toroidal clumps;
- dark obscuring bulk;
- hot inner wall;
- polar opening.

Kilonova:

- smoother quasi-spherical ejecta;
- angular composition variation;
- less violent filament structure than supernova.

TDE shock:

- toroidal/circularization structure;
- clumps along orbital flow.

### 10.4 Sampling

Quality policy:

Low:
- legacy/simple volume;
- low steps;
- minimal detail.

Medium:
- HDR target;
- modest detail;
- no expensive lighting.

High:
- temporal jitter;
- more active steps;
- multi-octave detail;
- depth-aware compose.

Ultra:
- highest bounded step/detail profile;
- optional self-shadow taps;
- full temporal convergence.

### 10.5 Scene depth

Use scene depth to:

- terminate march at opaque foreground;
- avoid wasting samples;
- prevent volume leaking through foreground geometry;
- guide bilateral upsampling.

This improves both realism and performance.

### 10.6 Depth-aware upsampling

Prototype an edge-aware upsample using:

- low-res volume color/alpha;
- low-res or reconstructed volume depth;
- full-res scene depth;
- neighboring samples.

Acceptance:

- no obvious halo around stellar surface;
- no edge tearing;
- no instability under camera motion.

If this fails on WebGL2, use:

- simpler upsample;
- higher internal scale;
- or destination-specific fallback.

### 10.7 Approximate lighting

Allowed techniques:

- one or few extinction samples toward a local emitter;
- local density gradient for front shading;
- emission falloff with density/temperature.

Not allowed:

- claiming full radiative transfer;
- claiming multiple scattering if not implemented.

## 11. Workstream VF5 — ParticleService V2

### 11.1 Star profile

Use a profile closer to a point-spread function than a generic soft disc.

Candidate:

- compact core;
- soft halo;
- intensity distribution;
- color temperature.

Make it stable at subpixel sizes.

### 11.2 Ejecta streak profile

Inputs:

- projected velocity;
- age;
- emissive ramp;
- local speed.

Output:

- elongated footprint;
- tapered head/tail;
- motion-aligned orientation;
- selective bloom intensity.

This provides perceived kinetic structure with fewer particles.

### 11.3 Cluster distribution

Add deterministic cluster ID or low-frequency modulation so particle fields are not perfectly uniform Poisson-looking clouds.

### 11.4 Bandwidth

Do not add many per-particle attributes casually.

Profile changes should reuse existing storage when possible.

Measure:

- buffer bytes;
- attribute uploads;
- compute cost;
- fragment overdraw.

## 12. Workstream VF6 — StrandService

### 12.1 Purpose

Represent astrophysical streams that should read as a continuous medium rather than a flat strip.

Primary consumer: TDE.

Potential secondary consumers:

- selected jet/sheath structures;
- dense merger trails only when physically justified.

### 12.2 Geometry approach options

Option A: camera-aware tube impostor.

Pros:
- modest geometry;
- good round cross-section.

Cons:
- shader complexity;
- edge cases.

Option B: actual low-sided tube mesh.

Pros:
- straightforward depth;
- robust fallback.

Cons:
- more vertices;
- updates for dynamic spine.

Option C: small volumetric tube.

Pros:
- best medium look.

Cons:
- expensive;
- overlap with VolumeService.

Prototype A and B first.

### 12.3 Cross-section

Cross-section may vary by:

- normalized stream distance;
- stage;
- density;
- temperature.

The centerline remains unchanged.

### 12.4 Detail

Add:

- longitudinal clumps;
- radial falloff;
- hot/cool zones;
- tapered debris ends.

Do not add arbitrary curls that move the authoritative spine.

## 13. Workstream VF7 — Celestial Environment V2

### 13.1 Why this matters

The black-hole renderer can be mathematically excellent yet visually underwhelming if escaped rays sample mostly black.

A rich environment gives the lens map something to transform.

### 13.2 Layers

Layer A: diffuse galactic background.

- large angular-scale band;
- low-frequency dust modulation.

Layer B: unresolved dense stars.

- very numerous;
- cheap procedural generation or precomputed texture;
- low intensity.

Layer C: bright stars.

- sparse;
- HDR;
- colored;
- stable.

Layer D: optional nebular structure.

- restrained;
- not every scene needs it.

### 13.3 World frame

Environment orientation must be fixed in the canonical world frame so:

- presets are reproducible;
- lensing comparisons are meaningful;
- screenshots are deterministic.

### 13.4 Sampling and aliasing

At high angular frequencies, environment aliasing can shimmer under lensing.

Use:

- mipmapping;
- filtered environment texture;
- procedural LOD;
- temporal reconstruction;
- possibly anisotropic filtering where supported.

### 13.5 Provenance

If external imagery is used:

- license;
- source;
- resolution;
- color space;
- transformations;
- redistribution permission.

A fully procedural environment avoids licensing risk and is preferred for baseline.

## 14. Workstream VF8 — Stellar Explosion vertical slice

This is the gatekeeper milestone.

Do not roll the new shared visual stack across the atlas until Stellar Explosion proves it.

### 14.1 Stage goals

Progenitor:

- no matte sphere;
- visible but restrained photosphere;
- stable limb;
- HDR without white clipping.

Flash:

- compact extreme highlight;
- shock onset;
- bloom/glare controlled;
- no full-frame washout.

Expansion:

- shell visibly structured;
- hot interior;
- cooler exterior;
- filament/clump hierarchy;
- depth;
- no smooth glowing ball.

Hypernova:

- structurally more energetic/aniso than normal core collapse;
- not merely brighter.

GRB:

- collimated jet with readable spine/sheath or core/falloff;
- viewing-angle difference remains model-driven.

### 14.2 Implementation mapping

Files likely affected:

- src/phenomena/stellar-explosion/stellarExplosionModule.ts
- src/phenomena/stellar-explosion/emission.ts
- src/phenomena/stellar-explosion/density.ts
- src/renderer/shared/VolumeService.ts or successor
- src/renderer/shared/ParticleService.ts
- src/renderer/shared/SharedPost.ts
- temporal service files
- browser tests/goldens

Physics files remain untouched unless a real correctness defect is discovered.

### 14.3 Vertical-slice acceptance

Must pass:

- all current explosion unit tests;
- all current browser tests;
- scientific goldens;
- new cinematic goldens;
- temporal flicker gate;
- HDR range probe;
- WebGPU benchmark;
- forceWebGL accepted fallback;
- resource leak test;
- human review.

Only then may Volumetrics V2 become default for later destinations.

## 15. Workstream VF9 — Tidal Disruption

### 15.1 Main visual deficiency

The authoritative stream exists, but the current ribbon representation reads as geometry rather than gas.

### 15.2 Migration

High/Ultra:

- StrandService;
- variable cross-section;
- optical depth;
- longitudinal clumps;
- temperature gradient;
- selective emissive regions;
- temporal stability.

Low/Medium:

- retain RibbonService or simplified strand.

### 15.3 Shock and disc

Circularization shock:

- Volumetrics V2 torus;
- clumpy rotating structure;
- stronger depth hierarchy.

Nascent disc:

- differential rotation;
- radial temperature structure;
- layered density;
- restrained bloom.

### 15.4 Camera

AutoFramer remains.

Only change camera policy if the high-quality stream still fails to read.

Viewer takeover remains permanent per visit.

## 16. Workstream VF10 — Compact Merger and Neutron Star

### 16.1 Shared stellar-surface visual layer

Consider a shared StarSurfaceService only if it reduces duplication without weakening destination-specific lensing.

It may provide:

- spectral temperature-to-linear-RGB mapping;
- photosphere response;
- highlight/bloom mask;
- surface noise at presentation-only amplitude.

It must not replace neutron-star direct surface-ray geometry.

### 16.2 Neutron Star

Improve:

- surface radiance;
- hot-spot definition;
- pulse readability;
- field-line antialiasing;
- magnetar flare hierarchy;
- environment.

Do not add:

- frame dragging;
- Doppler;
- oblateness;
- atmosphere spectrum;

unless separately implemented and validated.

### 16.3 Compact Merger

Improve:

- binary star appearance;
- trail readability;
- merger flash control;
- kilonova volume;
- ejecta profile;
- remnant hierarchy.

Kilonova should not simply reuse the exact supernova detail profile.

## 17. Workstream VF11 — Quasar / AGN

### 17.1 Inner zone

Preserve direct lensing.

Improve:

- corona response;
- environment;
- disc spectral hierarchy;
- selective bloom.

### 17.2 Nuclear zone

Improve:

- disc radial structure;
- differential brightness;
- clumpy dust;
- hot inner wall;
- dark obscuring regions.

### 17.3 Jet

Introduce visual hierarchy:

- bright core/spine;
- broader sheath;
- falloff;
- knots only if presentation/disclosure supports them.

### 17.4 Galactic zone

Improve static spatial structure only.

Do not animate kpc features on the 400-day timeline.

## 18. Workstream VF12 — Galaxy Collision

This is a representation reconstruction problem.

### 18.1 Preserve the data

The 1,600 GC1 tracers remain authoritative.

Do not perturb them.

### 18.2 Secondary visual population

Generate many secondary unresolved emitters deterministically from the data-driven backbone.

Possible method:

1. derive local density estimate from tracer neighborhoods or precomputed density field;
2. seed secondary points around tracer-supported regions;
3. assign brightness/color distributions;
4. weight by galaxy identity;
5. update secondary mapping only when phase changes.

Alternative:

- offline precompute a denser visualization artifact from the same interpolation backbone.

The implementation must document that these are rendering reconstruction samples, not source-locked particles.

### 18.3 Diffuse stellar light

Add a smooth low-frequency component to make arms/tails read continuously.

Possible approaches:

- splatted density;
- low-res screen-space density target;
- world-space Gaussian impostors;
- precomputed density texture/grid.

Choose based on temporal stability and performance.

### 18.4 Dust/gas

Optional Cinematic layer:

- dim obscuring bands;
- low-opacity cool-toned gas;
- limited star-forming knots.

Must be explicitly procedural/cinematic.

### 18.5 Nuclei

Replace oversized game-like points with compact core profiles integrated into the diffuse light.

## 19. Workstream VF13 — Black-Hole Merger

This is the most conceptually sensitive visual rewrite.

### 19.1 What not to do

Do not improve the scene by adding:

- fire;
- explosion gas;
- bright accretion discs;
- glowing shockwaves;

unless the selected scenario explicitly includes matter and a model.

The current SXS reference is a vacuum BBH.

### 19.2 Desired visual language

The event should derive drama from:

- environmental lensing;
- changing distortion;
- strong-field image multiplicity;
- data-driven orbital motion;
- merger timing;
- waveform UI;
- final Kerr remnant.

### 19.3 Representation prototypes

Prototype A: two reduced local lens fields centered on the data-driven component positions.

Requirements:

- clearly disclosed reduced approximation;
- no claim of dynamic binary spacetime ray tracing;
- bounded distortion;
- no catastrophic overlap artifact.

Prototype B: illustrative spacetime distortion field.

If A is scientifically too misleading or unstable, use an explicitly cinematic field visualization tied to trajectories.

Prototype C: retain simplified markers only in Scientific/Debug while Cinematic uses a richer lensing presentation.

### 19.4 Remnant

Keep current validated Kerr handoff.

Improve only:

- environment;
- temporal stability;
- selective HDR response;
- eventual Kerr pole artifact if a separate numerical campaign resolves it.

### 19.5 Merger flash

Current merger flash is already explicitly cinematic.

It may remain but should be:

- restrained;
- temporally shaped;
- not mistaken for electromagnetic emission.

The UI/fidelity note must make this clear.

## 20. Workstream VF14 — flagship Black Hole polish

Do not destabilize the flagship early.

Apply only after:

- Environment V2 accepted;
- SharedPost V2 accepted;
- temporal system accepted;
- cinematic validation harness accepted.

### 20.1 Environment

Immediately improves lensing readability.

### 20.2 Disc

Audit:

- radial emissivity;
- spectral color mapping;
- Doppler/gravitational frequency shift presentation;
- highlight roll-off;
- higher-order image visibility.

Do not add arbitrary turbulence unless clearly cinematic/procedural.

### 20.3 Critical-region supersampling

DNGR used ray bundles to achieve smooth rapidly changing black-hole images.

Browser implementation options:

- local supersampling mask;
- edge/difficulty mask;
- tile classification;
- temporal sample increase near critical region;
- analytic ray differentials if feasible later.

Start simple.

Possible heuristic inputs:

- large escape-direction derivative;
- near-critical minimum radius;
- high winding estimate;
- neighboring classification disagreement.

Escalate sampling in difficult pixels.

### 20.4 Validation

Any critical-region enhancement must compare to trusted numerical/LUT/Kerr results.

It may improve antialiasing, not redefine the physical outcome.

## 21. Workstream VF15 — cinematic camera/composition

Cinematic presentation includes framing, but camera automation is dangerous because this app also models physical observers.

### 21.1 Separate camera concepts

Physical observer:

- affects photons;
- affects aberration;
- affects Doppler;
- part of scientific state.

Presentation camera:

- framing/orbit around non-relativistic scene;
- should not alter scientific observer model unless explicitly linked.

Never conflate the two.

### 21.2 Automatic framing

Allowed:

- expand camera distance with explosion shell;
- frame TDE debris;
- frame galaxy collision tails.

Already partly implemented by AutoFramer.

### 21.3 Cinematic shot presets

Optional:

- wide;
- detail;
- edge-on;
- event-focused.

User takeover disables automation.

### 21.4 Reduced motion

Respect prefers-reduced-motion:

- no auto-orbit;
- minimal transition movement;
- no unnecessary camera choreography.

## 22. Workstream VF16 — global visual quality budget

### 22.1 Low

Goal: correctness and broad compatibility.

- simple volume;
- low sample count;
- no glare;
- limited environment detail;
- ribbon fallback;
- minimal temporal.

### 22.2 Medium

Goal: current production scientific quality with some upgraded fundamentals.

- HDR-safe volume path;
- modest detail;
- selective bloom when Cinematic;
- stable star profile.

### 22.3 High

Goal: visually rich real-time mode.

- temporal reconstruction;
- Volumetrics V2;
- richer particles;
- StrandService;
- Environment V2;
- selective bloom;
- optional shallow approximate lighting.

### 22.4 Ultra

Goal: maximum interactive visual quality.

- highest bounded volume detail;
- full strand quality;
- richer environment;
- longer settled history;
- critical-region supersampling;
- optional glare.

### 22.5 Cinematic Ultra / settled convergence

This may be an experience behavior rather than a fifth formal tier.

When stable:

- longer temporal accumulation;
- increased internal sample quality;
- stronger detail.

During interaction:

- fall back toward High.

Never allow a scene to become unresponsive just to chase one perfect frame.

## 23. Workstream VF17 — cinematic validation system

### 23.1 Scientific goldens remain

Do not replace.

### 23.2 Cinematic goldens

Create separate files/harness, for example:

- tests/browser/cinematic-goldens.spec.ts
- tests/browser/support/cinematicGoldenHarness.ts
- tests/browser/cinematic-goldens/

Naming is illustrative; use repository conventions.

### 23.3 Capture state

Pin:

- route;
- preset;
- phase;
- camera;
- viewport;
- quality;
- render scale;
- experience mode;
- exposure;
- tone mapping;
- bloom;
- glare;
- grade;
- temporal settle.

### 23.4 Temporal settle

Do not use arbitrary sleep.

Use a postcondition such as:

- history age reaches N;
- camera settled;
- destination state synchronized;
- no transition;
- no pending pipeline compile.

### 23.5 Metrics

At minimum:

- perceptual pixel delta;
- temporal luma flicker;
- saturation percent;
- black-crush percent;
- luminance percentile summary.

Optional:

- SSIM;
- edge stability;
- spatial-frequency comparison.

### 23.6 Sparse scenes

Use masks/thresholds appropriate to subject coverage.

The campaign already discovered false passes when a tiny subject occupied less area than the global tolerance.

Build that lesson into the new harness from day one.

## 24. Performance policy

Visual fidelity is allowed to cost more at High/Ultra, but the cost must be explicit.

### 24.1 Required benchmark states

For each destination:

- stationary;
- active timeline;
- camera motion;
- transition;
- low;
- medium;
- high;
- ultra;
- WebGPU;
- forceWebGL.

### 24.2 Relative goals

Do not promise universal 60 FPS.

Instead:

- Low/Medium should remain broadly usable;
- High should target smooth interaction on representative discrete/integrated modern GPUs where feasible;
- Ultra may target 30–60 FPS depending on destination;
- strong-field Kerr remains a special expensive class;
- settled cinematic convergence may spend more than moving interaction.

### 24.3 Work elimination compatibility

Preserve:

- paused-frame invalidation;
- transition occlusion;
- hidden-tab behavior;
- lazy resource lifecycle.

Visual features must not accidentally force continuous frames while paused unless temporal convergence is actively running, and convergence must stop after a finite bound.

## 25. Resource and memory policy

New likely resources:

- temporal color history;
- optional depth history;
- emissive MRT;
- volume half-float target;
- volume depth target;
- environment texture(s);
- secondary galaxy buffers;
- strand buffers;
- optional grade LUT.

Requirements:

- ResourceScope ownership;
- deterministic disposal;
- reuse across frames;
- resize without leak;
- bounded history count;
- no per-frame render-target creation.

### 25.1 Torture test

Loop:

1. black hole;
2. neutron star;
3. explosion;
4. TDE;
5. AGN;
6. BBH;
7. galaxy;
8. compact merger;
9. change quality;
10. resize;
11. repeat.

Resource counts must plateau.

## 26. WebGL2 strategy

Three classes:

### A. Equivalent

Same algorithm, different backend.

Examples likely:

- HDR target where supported;
- basic temporal;
- star profiles;
- basic environment.

### B. Simplified

Same intent, lower cost/feature set.

Examples:

- fewer volume detail octaves;
- no self-shadow taps;
- ribbon instead of strand;
- fewer galaxy secondary emitters;
- reduced temporal history.

### C. Optional WebGPU-only cinematic feature

Allowed only if nonessential.

Examples might include:

- a future compute-generated density field;
- advanced temporal classification;
- expensive glare.

Scientific correctness cannot depend on C.

## 27. Destination-by-destination definition of done

### 27.1 Stellar Explosion

Done when:

- expansion is not a smooth ball;
- HDR flash is controlled;
- detail hierarchy visible;
- no temporal grain;
- all presets visually distinct for the right reasons;
- scientific tests green;
- cinematic capture accepted.

### 27.2 TDE

Done when:

- High/Ultra debris reads as a gaseous stream;
- centerline remains model-authored;
- shock/disc have volumetric structure;
- no ribbon-flatness as primary high-tier look;
- accepted temporal stability.

### 27.3 Compact Merger

Done when:

- photospheres read as compact stars;
- merger/kilonova has material specificity;
- ejecta no longer looks like generic sprites;
- post-merger stages remain coherent.

### 27.4 Neutron Star

Done when:

- direct-lensed surface remains precise;
- hot spots/beams are visually sharp and stable;
- magnetic presentation is layered;
- no fake unimplemented relativistic claims.

### 27.5 AGN

Done when:

- inner/nuclear/galactic scales feel materially different;
- torus is deep/clumpy rather than a simple shape;
- jets have hierarchy;
- host has believable diffuse structure.

### 27.6 Galaxy Collision

Done when:

- bridge/tails read as continuous stellar systems;
- nuclei look like galactic cores;
- data-driven morphology remains visible;
- added rendering layers are disclosed;
- no sparse point-cloud look at High/Ultra.

### 27.7 BBH Merger

Done when:

- inspiral no longer reads as two game objects with rings;
- vacuum nature remains honest;
- visual drama comes from lensing/spacetime/environment;
- SXS timing remains authoritative;
- remnant Kerr remains validated.

### 27.8 Black Hole

Done when:

- lensed environment is rich;
- critical features stable;
- disc/HDR response polished;
- observer modes remain physically correct;
- high-quality captures show no shimmer/aliasing obvious at target viewport.

## 28. Sequencing and dependency graph

Mandatory dependency order:

VF0 baseline
→ VF1 HDR continuity
→ VF2 SharedPost architecture decision
→ VF3 temporal foundation
→ VF4 Volumetrics V2
→ VF5 Particle V2
→ VF6 StrandService
→ VF7 Environment V2
→ VF8 Stellar Explosion acceptance

After VF8 acceptance:

VF9 TDE
VF10 Compact/NS
VF11 AGN
VF12 Galaxy
VF13 BBH

Then:

VF14 Black Hole
→ VF15 camera polish
→ VF16 final quality tuning
→ VF17 final validation/certification

Some destination work may run in parallel after shared interfaces freeze, but do not parallelize two agents rewriting the same shared renderer service.

## 29. Recommended branch/commit strategy during implementation

This planning branch contains no runtime code.

When implementation starts, prefer a new implementation branch from the then-current main.

Commit boundaries:

1. baseline/measurement only;
2. HDR continuity only;
3. post architecture spike/decision;
4. temporal foundation;
5. Volumetrics V2;
6. Stellar Explosion vertical slice;
7. each remaining destination separately;
8. final validation/docs.

Do not combine:

- physics changes;
- visual baseline regeneration;
- performance optimization;
- major renderer architecture;

in one opaque commit unless inseparable and documented.

## 30. Human review protocol

For every major visual milestone, reviewers see:

- before/after at same camera;
- Scientific/Cinematic pair;
- 100% crop of critical detail;
- short motion clip or frame strip;
- performance delta.

Review questions:

- Does it look more realistic, or merely busier?
- Does it still read as the correct phenomenon?
- Are highlights controlled?
- Is scale improved?
- Does motion remain stable?
- Is procedural detail repeated/obvious?
- Did post effects hide weak representation?
- Did any scientific cue become less legible?
- Does the result look like generic game VFX?
- Is the performance cost justified?

A milestone does not pass if the answer to the first question is no.

## 31. Risk register

### Risk: post-processing becomes a crutch

Mitigation:

- representation upgrades precede decorative lens effects;
- bloom/glare kept selective;
- human review compares bloom off/on.

### Risk: temporal ghosting

Mitigation:

- aggressive invalidation/rejection;
- high-contrast edge tests;
- critical-region special handling.

### Risk: noise detail becomes repetitive

Mitigation:

- destination-specific detail profiles;
- seed variation;
- multi-scale review;
- no one universal noise stack.

### Risk: WebGL2 diverges badly

Mitigation:

- spike shared features on forceWebGL early;
- classify optional features;
- keep fallback paths.

### Risk: memory explodes

Mitigation:

- explicit render-target budget;
- ResourceScope;
- reuse;
- torture tests.

### Risk: galaxy renderer implies fake data fidelity

Mitigation:

- authoritative backbone retained;
- procedural layers disclosed;
- debug mode can show source tracers separately.

### Risk: BBH gets fake Hollywood fire

Mitigation:

- vacuum-matter prohibition in spec;
- lensing-first design;
- explicit merger-flash disclosure.

### Risk: black-hole physics regresses during antialiasing work

Mitigation:

- trusted backend comparison;
- supersampling only changes sampling/reconstruction;
- classifications remain validated.

### Risk: cinematic mode hurts interactivity

Mitigation:

- global work budget;
- interaction quality drop;
- settled convergence;
- finite history.

## 32. Explicitly rejected shortcuts

Do not treat these as the solution:

- increase bloom strength globally;
- add film grain;
- add chromatic aberration everywhere;
- add lens dirt;
- make every emitter brighter;
- increase particle count by 10x without changing representation;
- add the same fractal noise to every volume;
- add fake smoke/fire around black holes;
- add motion blur to hide aliasing;
- lower render resolution and sharpen aggressively;
- use huge sprite sizes to make sparse fields visible;
- make Scientific mode visually inaccurate to match Cinematic.

These may occasionally be useful as minor components, but none resolves the core visual problem.

## 33. Research references and how they should be used

### Three.js RenderPipeline / TSL

https://threejs.org/docs/TSL.html

Use for:

- current pinned post architecture;
- composable passes;
- MRT exploration;
- compute/post integration.

Do not assume latest documentation perfectly matches pinned r185 without verifying source/API.

### Three.js WebGPURenderer

https://threejs.org/docs/pages/WebGPURenderer.html

Use for:

- backend behavior;
- forceWebGL expectations;
- renderer resource capabilities.

### Three.js selective bloom example

https://threejs.org/examples/webgpu_postprocessing_bloom_selective.html

Use as an implementation reference for MRT/selective bloom, not as a copy-paste contract.

### GPU Gems 3: real-time 3D fluids

https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids

Relevant principles:

- ray casting through volumes;
- front-to-back accumulation;
- early termination;
- scene-depth clipping;
- jittering;
- off-screen lower-resolution marching.

### GPU Gems: volume rendering techniques

https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-39-volume-rendering-techniques

Relevant principles:

- optical models;
- transfer functions;
- gradients/lighting;
- procedural detail;
- cost of unnecessary fragments.

### DNGR / Interstellar black-hole rendering

https://authors.library.caltech.edu/records/njdcq-95891

Relevant principle:

- highly distorted black-hole images require high-quality sampling/reconstruction to remain smooth and flicker-free.

Do not attempt to reproduce an offline film renderer directly. Translate the principle into bounded browser techniques.

## 34. Milestone gates

### Gate A — baseline complete

- current visuals captured;
- defect ledger complete;
- perf/memory baseline complete.

### Gate B — shared HDR/post accepted

- no HDR clamp bug;
- SharedPost V2 architecture decided;
- WebGPU/WebGL2 tested.

### Gate C — temporal accepted

- stable jitter;
- no major ghosting;
- resource history bounded.

### Gate D — Volumetrics V2 accepted

- HDR;
- structured detail;
- stable motion;
- depth composition acceptable;
- bounded cost.

### Gate E — Stellar Explosion showcase accepted

This is the go/no-go for full rollout.

### Gate F — remaining destination migrations accepted individually

No bulk baseline update without per-destination review.

### Gate G — flagship black-hole polish accepted

Strong-field tests remain green.

### Gate H — final visual certification

All scientific + cinematic + temporal + performance + resource gates green.

## 35. Final certification artifact

Create:

docs/VISUAL_FIDELITY_CERTIFICATION.md

It must include:

- final SHA;
- hardware/browser/backend;
- quality matrix;
- before/after visual summary;
- representative captures;
- all test results;
- scientific golden result;
- cinematic golden result;
- temporal metric result;
- performance matrix;
- memory/resource result;
- WebGL2 behavior;
- known limitations;
- rejected prototypes;
- deferred polish;
- explicit statement that cinematic presentation does not imply full physical simulation of unresolved details.

## 36. Definition of done

The campaign is complete only when all conditions below are satisfied.

### Shared renderer

- HDR continuity proven.
- Cinematic image pipeline explicit.
- Temporal reconstruction stable.
- Volumetrics V2 accepted.
- particle/strand/environment improvements accepted.
- global work budget integrated.
- ResourceScope remains bounded.

### Destination quality

- Stellar Explosion passes the target bar first.
- TDE high-tier stream no longer reads as a flat ribbon.
- Compact Merger/Neutron Star have materially improved star/ejecta presentation.
- AGN has richer disc/torus/jet/host hierarchy.
- Galaxy Collision reads as interacting galaxies rather than a sparse point set at High/Ultra.
- BBH inspiral no longer uses marker/ring presentation as its primary high-tier visual language.
- flagship Black Hole receives final environment/sampling/HDR polish.

### Validation

- npm run check passes.
- scientific browser suites pass.
- scientific goldens pass.
- cinematic goldens pass.
- temporal stability gates pass.
- forceWebGL behavior is accepted and documented.
- resource leak tests pass.
- final performance matrix is recorded.
- human visual review accepts every destination.
- no open P0/P1 visual defects remain.

### Truthfulness

- no destination makes stronger scientific claims than its model supports.
- procedural/cinematic layers are disclosed.
- vacuum BBH is not given fake luminous matter.
- unimplemented relativistic effects remain omitted or separately implemented.

### Product outcome

At High/Ultra Cinematic mode, representative frames should no longer be reasonably described as an old-game/prototype visual layer. They should read as intentionally authored, high-end real-time astrophysical visualization with browser-appropriate performance scaling.

That is the finish line.
