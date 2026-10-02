# EXECUTION PROMPT — Cinematic Visual Fidelity Overhaul

Campaign: `cinematic-visual-fidelity-overhaul`
Mode: autonomous implementation + validation + visual hardening + certification
Primary contract:
- `MASTER_PLAN.md`
- `tasks.md`
- `design.md`
- `proposal.md`
- `specs/cinematic-visual-fidelity/spec.md`

This file is the direct instruction set for the implementation agent. Follow it as an execution contract, not as optional guidance.

## 0. Mission

Take the current Browser Black Hole / Cosmic Atlas renderer and materially raise its visual quality from a technically functional scientific prototype toward a contemporary, cinematic, high-end real-time astrophysical visualization.

Do not solve this by merely increasing bloom, particle counts, brightness, saturation, noise, or post-processing.

The actual objective is to improve the full image-formation stack:

- HDR continuity;
- post-processing architecture;
- temporal stability;
- volumetric rendering;
- particle representation;
- gaseous strands/streams;
- celestial environment richness;
- scale readability;
- material specificity;
- destination-specific visual representation;
- strong-field antialiasing/sampling;
- quality scaling;
- cinematic validation.

You are explicitly authorized to make large presentation-layer changes when justified. Do not be afraid to replace weak rendering implementations.

You are NOT authorized to falsify or casually rewrite the scientific/data layer.

The scientific/data layer is the source of truth. The presentation layer exists to render it better.

## 1. Read this before touching code

At the start of the campaign, read in this order:

1. `AGENTS.md`
2. `.agent/EXECUTION_PROTOCOL.md`
3. `.agent/STATE.md`
4. `openspec/changes/cinematic-visual-fidelity-overhaul/EXECUTION_PROMPT.md`
5. `openspec/changes/cinematic-visual-fidelity-overhaul/MASTER_PLAN.md`
6. `openspec/changes/cinematic-visual-fidelity-overhaul/tasks.md`
7. `openspec/changes/cinematic-visual-fidelity-overhaul/design.md`
8. `openspec/changes/cinematic-visual-fidelity-overhaul/specs/cinematic-visual-fidelity/spec.md`
9. `docs/RENDERING_PIPELINE.md`
10. `docs/SHADER_CONTRACTS.md`
11. `docs/PERFORMANCE.md`
12. `docs/cosmic-atlas/GOLDEN_IMAGES.md`
13. `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md`
14. relevant destination physics/data documentation before modifying that destination.

Then inspect the actual implementation. Do not rely on plan assumptions if the repository has changed since this plan was written.

At minimum inspect:

- `src/renderer/SharedRendererKernel.ts`
- `src/renderer/shared/SharedPost.ts`
- `src/renderer/shared/VolumeService.ts`
- `src/renderer/shared/ParticleService.ts`
- `src/renderer/shared/RibbonService.ts`
- `src/renderer/shared/LensingService.ts`
- `src/renderer/shared/CameraRig.ts`
- `src/atlas/host.ts`
- `src/atlas/governor.ts`
- `src/atlas/types.ts`
- all destination modules before changing shared interfaces they consume.

If the implementation has materially diverged from this plan, update the plan/ADR first rather than forcing obsolete instructions onto current code.

## 2. Mandatory repository start gate

Before changing runtime behavior:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git log --oneline -10
node --version
npm --version
npm ci
npm run check
```

Record:

- starting SHA;
- active branch;
- Node/npm;
- Three.js version;
- Chromium/browser version;
- renderer backend;
- GPU adapter;
- WebGPU capabilities;
- force-WebGL availability.

A pre-existing failure is not your regression. Classify it before implementation.

Do not begin visual implementation with an unexplained red baseline.

## 3. First job: establish the visual baseline

Do NOT begin by editing shaders.

Complete `tasks.md` sections 0 and 1 first.

Capture the existing renderer honestly.

For all eight production destinations:

- capture Scientific mode;
- capture Cinematic mode;
- capture representative presets;
- capture multiple meaningful phases;
- capture still frames;
- capture short motion sequences or frame strips;
- record performance and resource data.

Create a visual-defect ledger.

Classify defects such as:

- flat/schematic representation;
- saturated white regions;
- clipped HDR;
- weak black levels;
- generic sprite appearance;
- ribbon-like gas;
- sparse point-cloud appearance;
- weak scale;
- weak depth;
- aliasing;
- temporal shimmer;
- crawling volume noise;
- post-processing spill;
- poor environment;
- repetitive procedural detail;
- camera/framing weakness.

This baseline is immutable campaign evidence. Never overwrite the before-state with later captures.

## 4. Do not implement all destinations at once

The campaign has a dependency order.

Default order:

1. baseline and visual measurement;
2. HDR continuity;
3. SharedPost V2 architecture spike;
4. temporal reconstruction;
5. Volumetrics V2;
6. ParticleService V2;
7. StrandService / ribbon successor;
8. Celestial Environment V2;
9. Stellar Explosion vertical slice;
10. Tidal Disruption;
11. Compact Merger + Neutron Star;
12. Quasar / AGN;
13. Galaxy Collision;
14. Black-Hole Merger;
15. flagship Black Hole;
16. cinematic camera/composition polish;
17. final quality-budget tuning;
18. full visual certification.

Do not skip directly to Black Hole because it is visually interesting.

Do not spread an unproven renderer architecture across the whole atlas.

Stellar Explosion is the required first showcase vertical slice. Until it passes the full visual, temporal, performance, compatibility and human-review gates, the shared visual stack is not considered validated.

## 5. Exact implementation philosophy

For every visual subsystem, follow this sequence:

1. identify the current visible failure;
2. identify the scientific/data inputs that are authoritative;
3. identify which part of the failure is representation versus model;
4. design the smallest reusable rendering improvement that fixes the representation;
5. preserve the authoritative inputs;
6. add explicit presentation state only where necessary;
7. add deterministic tests/probes;
8. implement;
9. capture before/after at identical camera/state;
10. measure GPU/CPU/memory cost;
11. validate WebGPU;
12. validate forceWebGL or explicit fallback;
13. inspect motion, not just stills;
14. inspect the actual image manually;
15. keep or reject the implementation based on evidence.

A technically complicated shader that does not visibly improve the image is not progress.

## 6. Scientific versus presentation boundary

Before changing a destination, write down internally:

### Authoritative state

Examples:

- trajectory;
- spacetime;
- worldline;
- density macro-field;
- physical stage timing;
- shock radius;
- stream centerline;
- tracer locations;
- hot-spot coordinates;
- remnant spin/mass.

### Presentation-only state

Examples:

- micro-clumping;
- filament noise;
- unresolved secondary emitters;
- bloom mask;
- glare strength;
- strand cross-section;
- volume detail octave count;
- cinematic camera easing;
- color grade.

Never move authoritative state just because the result looks better.

If you add visible structure that does not exist in the scientific model, classify and document it as procedural scientific, cinematic, or illustrative.

Do not imply simulation fidelity that does not exist.

## 7. Phase 1 — HDR continuity

Audit every intermediate target capable of carrying emission.

Known first target:

`src/renderer/shared/VolumeService.ts`

The current half-resolution target uses an 8-bit format. If radiance above 1.0 is required, preserve that range before SharedPost.

Required work:

- classify each intermediate as LDR-safe or HDR-required;
- convert HDR-required targets to suitable half-float storage;
- preserve alpha/compositing semantics;
- test WebGPU;
- test forceWebGL;
- add a numeric probe for >1 radiance;
- measure memory/bandwidth cost.

Do not assume that because the final SharedPost target is FP16, every upstream pass is HDR-safe.

Do not proceed until the HDR path is proven.

## 8. Phase 2 — SharedPost V2

Do not blindly rewrite SharedPost.

First perform the architecture spike from `tasks.md`.

Evaluate the exact pinned Three.js r185 APIs for:

- RenderPipeline;
- MRT;
- selective bloom;
- post nodes;
- WebGPU behavior;
- forceWebGL behavior.

Prototype current-pixel-equivalent output first.

Then prototype selective emissive bloom.

Decision options are explicitly allowed:

- full RenderPipeline/MRT;
- hybrid;
- extended current custom fullscreen pipeline.

Pick the architecture with the best combination of:

- visual quality;
- backend correctness;
- resource ownership;
- temporal integration;
- transition compatibility;
- performance;
- maintainability.

Document the decision before broad implementation.

SharedPost V2 should expose named image stages rather than hidden incidental behavior.

Expected order unless testing proves otherwise:

```text
scene HDR
→ temporal resolve
→ selective bloom / optional glare
→ transition composite
→ exposure / tone map
→ optional cinematic grade
→ output
```

Scientific mode must remain valid with cinematic effects disabled.

## 9. Phase 3 — temporal reconstruction

Temporal quality is mandatory for this campaign.

Do not fake quality with motion blur.

Build deterministic temporal accumulation/reprojection.

Initial implementation should focus on:

- camera jitter;
- volume jitter stabilization;
- subpixel star stability;
- progressive settled-frame quality.

Required invalidation triggers:

- destination change;
- preset change;
- timeline scrub/reset discontinuity;
- camera cut;
- resize;
- render-scale change;
- quality change;
- backend/pass change;
- transition handoff;
- image-affecting material graph change.

Prefer rejecting history over producing ghosts.

Explicitly inspect:

- black-hole critical curve;
- neutron-star limb;
- bright stars;
- supernova shock edge;
- thin TDE strand;
- galaxy tail.

Temporal stability must become testable.

Do not declare temporal work complete because a stationary image looks smoother.

## 10. Phase 4 — Volumetrics V2

Do not create a supernova-only volume hack.

Create reusable volumetric infrastructure.

Preserve the existing macro density/emission inputs.

Add optional deterministic detail layers:

- low-frequency asymmetry;
- multi-octave structure;
- ridged/filament structure;
- clumps;
- radial gradients;
- bounded domain warp;
- destination-specific detail profiles.

Do not apply identical noise to every phenomenon.

Supernova, AGN dust, kilonova and TDE gas must look materially different.

Implement:

- HDR internal target;
- deterministic jitter;
- temporal resolve;
- quality-driven sample count;
- detail budget;
- depth clipping;
- depth-aware upsample prototype;
- optional approximate self-shadow/extinction;
- explicit disclosure.

Do not claim full radiative transfer.

Benchmark all tiers.

## 11. Phase 5 — ParticleService V2

The current generic soft-sprite model is not enough for every phenomenon.

Add reusable presentation profiles.

At minimum evaluate:

- compact stellar point-spread profile;
- velocity-stretched ejecta;
- motion-aligned debris;
- dust/clump profile;
- emissive core profile.

Preserve:

- deterministic seed behavior;
- CPU fallback;
- compute path;
- resource ownership;
- explicit screen-space/world-space size semantics.

Do not simply multiply particle count.

If a 5x population increase gives little visual improvement but doubles fragment cost, reject it.

## 12. Phase 6 — StrandService

RibbonService remains a valid fallback.

Do not delete it early.

Create a higher-quality strand/tube path for media that should not look like flat geometry.

Primary target: TDE debris stream.

Requirements:

- authoritative spine stays unchanged;
- parallel-transported local frame;
- variable cross-section;
- radial opacity profile;
- longitudinal temperature variation;
- deterministic clumping;
- quality budget;
- acceptable motion stability.

Prototype at least two representation approaches before committing if necessary.

Keep the simpler ribbon at lower tiers if it remains the correct performance tradeoff.

## 13. Phase 7 — Celestial Environment V2

Build a rich but deterministic celestial environment.

The environment is a rendering input to lensing; it is not decoration.

Target layers:

- large-scale diffuse galactic band;
- unresolved dense star field;
- sparse HDR bright stars;
- stellar color distribution;
- restrained optional dust/nebular structure.

Requirements:

- deterministic;
- canonical world orientation;
- linear HDR;
- filtered/mipped;
- high enough angular detail for lensing;
- no severe shimmer;
- documented provenance.

A procedural baseline is preferred over importing questionable assets.

## 14. Stellar Explosion — mandatory first acceptance target

This is the first destination that must reach the new quality bar.

Do not proceed to broad rollout until it is accepted.

Preserve existing physics and timeline.

Improve presentation so:

### Progenitor
- no matte toy sphere;
- stable limb;
- controlled HDR;
- readable surface.

### Flash
- extremely bright but not screen-filling white;
- correct highlight roll-off;
- controlled selective bloom.

### Expansion
- not a smooth glowing sphere;
- visible shell hierarchy;
- large-scale asymmetry;
- clumps;
- filament structure;
- hot interior;
- cooler outer ejecta;
- readable shock boundary.

### Hypernova
- structurally distinct;
- not merely brighter.

### GRB
- readable collimation;
- viewing response remains model-driven.

Must pass:

- current scientific tests;
- current browser tests;
- scientific goldens;
- new cinematic goldens;
- HDR probe;
- temporal-flicker gate;
- WebGPU benchmark;
- forceWebGL fallback;
- resource leak test;
- human image review.

If the result still looks like generic game VFX, do not roll it out to other destinations. Fix the shared renderer first.

## 15. Tidal Disruption

Once the vertical slice is accepted:

- migrate high-tier debris stream to StrandService;
- preserve centerline;
- add cross-section evolution;
- add optical-depth structure;
- add deterministic clumps;
- add temperature gradient;
- migrate shock to Volumetrics V2;
- improve nascent disc structure.

Keep lower-tier ribbon fallback.

Do not change orbit physics to make the stream prettier.

## 16. Compact Merger and Neutron Star

For Neutron Star:

- preserve direct Schwarzschild surface ray tracing;
- improve radiance, hot spots, beam clarity, field-line hierarchy, environment;
- do not add missing Doppler/frame-dragging/oblateness physics as a visual trick.

For Compact Merger:

- improve star surfaces;
- improve merger flash restraint;
- use Volumetrics V2 for kilonova;
- use a different detail profile from supernova;
- improve post-merger ejecta.

Run direct surface-ray parity after relevant changes.

## 17. Quasar / AGN

Keep the direct inner lensing path.

Improve scale hierarchy:

- inner engine;
- corona;
- nuclear disc;
- clumpy dust torus;
- jet spine/sheath;
- host galaxy.

Do not fake fast kpc-scale evolution.

The galactic zone may remain physically static while becoming visually richer.

## 18. Galaxy Collision

Do not change GC1 tracer data.

Treat it as the dynamical skeleton.

Build a deterministic visual reconstruction around it.

Possible layers:

- diffuse stellar light;
- secondary unresolved emitters;
- compact galactic nuclei;
- optional dust;
- optional gas;
- optional star-forming knots.

Every additional layer must be clearly labeled as rendering reconstruction/procedural presentation rather than source data.

The High/Ultra result should read as two interacting galaxies with tidal structures, not 1,600 glowing dots.

## 19. Black-Hole Merger

This is a sensitive rewrite.

The SXS scenario is vacuum.

Do NOT add:

- flames;
- explosion gas;
- glowing accretion disks;
- luminous shock matter.

High/Ultra should derive drama from:

- detailed environment;
- trajectory-tied lensing/distortion;
- changing strong-field structure;
- data-driven motion;
- waveform timing;
- final Kerr remnant.

Prototype a reduced dual-lens or another scientifically defensible/disclosed approach.

If a reduced lens model would mislead users, reject it and use an explicitly illustrative spacetime visualization instead.

Keep schematic markers in Scientific/Debug if they remain useful.

The Cinematic path should no longer be marker-first.

## 20. Flagship Black Hole

Polish last.

By then the shared renderer should already have:

- Environment V2;
- SharedPost V2;
- temporal reconstruction;
- quality budgeting;
- selective bloom;
- cinematic validation.

Then improve:

- lensed environment detail;
- accretion-disc radiance/spectral response;
- critical-region antialiasing;
- temporal stability;
- observer-mode image stability;
- restrained emissive response.

Prototype critical-region supersampling or a difficulty mask.

Potential difficulty signals:

- neighboring ray-class disagreement;
- high winding;
- near-critical minimum radius;
- large escape-direction gradient.

Extra samples should improve sampling, not change physics.

Re-run the trusted numerical/LUT/Kerr/observer suites.

## 21. Quality and governor behavior

The global governor remains the only adaptive authority.

Do not create per-destination independent quality controllers.

Low:
- correct;
- simple;
- cheap.

Medium:
- solid scientific visualization;
- upgraded fundamentals.

High:
- temporal;
- Volumetrics V2;
- richer particles;
- richer environment;
- strand renderer.

Ultra:
- highest bounded real-time quality;
- deeper temporal convergence;
- higher volume/detail budget;
- optional glare;
- critical-region supersampling.

During interaction, lower expensive work quickly enough to preserve responsiveness.

After settling, restore quality smoothly.

Do not oscillate quality every frame.

## 22. Validation rules for every major implementation

For every material visual change:

1. run narrow unit tests;
2. run relevant browser tests;
3. run relevant physics/parity tests;
4. run scientific goldens;
5. run cinematic captures/goldens;
6. run temporal-stability measurement;
7. inspect actual images;
8. run WebGPU;
9. run forceWebGL/fallback;
10. measure GPU time;
11. record CPU timing separately;
12. record internal dimensions;
13. record memory/resource counts;
14. compare before/after at identical camera/state.

Never call a destination complete from one attractive screenshot.

Never call it complete from a test-only green result if the actual image is visibly poor.

## 23. Human-review standard

At each destination milestone, produce:

- before/after wide view;
- before/after medium view;
- before/after detail crop;
- Scientific/Cinematic comparison;
- representative frame strip through time;
- performance delta.

Ask:

- Is the result actually more realistic?
- Is it merely more visually busy?
- Does the scale read better?
- Are media visually distinct?
- Are highlights controlled?
- Does motion remain stable?
- Is procedural noise obvious?
- Are we hiding weak representation with bloom?
- Did scientific readability get worse?
- Does it still look like generic game VFX?

If the improvement is not clear under these comparisons, continue the work or reject the approach.

## 24. Things you must not do

Do not solve the campaign by:

- global bloom increase;
- global saturation increase;
- adding film grain everywhere;
- adding chromatic aberration everywhere;
- lens dirt;
- huge particle sprites;
- brute-force particle count alone;
- identical fractal noise on every volume;
- fake fire around black holes;
- motion blur used to hide shimmer;
- lowering resolution and oversharpening;
- weakening physics tests;
- loosening visual thresholds;
- regenerating goldens until tests pass;
- turning WebGPU into an undeclared hard requirement;
- creating unbounded temporal history;
- creating render targets every frame;
- forking quality logic into destinations;
- letting presentation code directly mutate physical state.

## 25. Parallel-agent policy

Parallel work is allowed only after ownership boundaries are clear.

Good parallel tasks:

- cinematic capture harness;
- visual metrics;
- documentation/provenance;
- isolated environment prototype;
- isolated volume research spike;
- one destination migration after shared interfaces freeze.

Do not parallelize:

- two agents rewriting SharedPost;
- two agents rewriting VolumeService;
- two agents changing atlas types/governor;
- one agent changing temporal history while another changes the same post graph;
- multiple agents independently changing fidelity/disclosure policy.

The main agent owns integration.

Every sub-agent must report:

- changed files;
- tests run;
- visual evidence;
- performance evidence;
- assumptions;
- unresolved issues.

Integrate one material shared-renderer change at a time.

## 26. Commit protocol

Use coherent commits.

Recommended major checkpoints:

1. baseline + visual measurement;
2. HDR continuity;
3. SharedPost architecture decision;
4. SharedPost V2;
5. temporal reconstruction;
6. Volumetrics V2;
7. Particle V2;
8. StrandService;
9. Environment V2;
10. Stellar Explosion vertical slice;
11. TDE;
12. Compact/NS;
13. AGN;
14. Galaxy;
15. BBH;
16. Black Hole;
17. cinematic validation;
18. final certification.

Commit messages should explain:

- visual problem;
- root representation limitation;
- scientific state preserved;
- presentation change;
- visual evidence;
- performance cost;
- tests;
- backend behavior;
- known limitations.

Do not bury several unrelated destination rewrites in one commit.

## 27. State and handoff protocol

Update `.agent/STATE.md` after every meaningful checkpoint.

Record:

- active visual workstream;
- exact head SHA;
- task IDs completed;
- current before/after evidence paths;
- tests run;
- WebGPU/forceWebGL status;
- performance numbers;
- memory/resource observations;
- known visual defects;
- rejected prototypes;
- exact next actions.

A fresh agent should be able to resume without chat history.

## 28. Stop conditions

Stop a dependent approach and record the failure if:

- the visual improvement is not clearly visible;
- the feature produces unacceptable temporal shimmer/ghosting;
- scientific state must be falsified to make it work;
- the approach requires weakening physics tests;
- forceWebGL has no acceptable fallback for a required feature;
- resource counts grow without bound;
- performance cost is disproportionate to visible quality gain;
- the only way to pass a cinematic golden is widening thresholds;
- a shared renderer change breaks previously accepted destinations;
- a reduced BBH lensing model would be scientifically misleading.

A rejected prototype is a valid result if its evidence is recorded and its dead code is removed.

## 29. Campaign completion behavior

Do not stop after Stellar Explosion.

Stellar Explosion is the proof gate, not the end.

Once it is accepted, continue through the remaining destination migrations.

After all visual migrations:

- run final scientific gates;
- run final cinematic gates;
- run temporal stability suite;
- run forceWebGL matrix;
- run resource torture;
- run performance matrix;
- inspect representative images manually;
- fix remaining P0/P1 visual defects;
- document P2/P3 polish;
- update renderer/performance/golden/fidelity docs;
- produce `docs/VISUAL_FIDELITY_CERTIFICATION.md`.

Do not claim the campaign complete because the app builds.

Do not claim it complete because screenshots look better.

Do not claim it complete because Cinematic mode has more effects.

The campaign is complete only when the renderer is materially more visually convincing across the atlas, the science remains correct, motion remains stable, performance remains bounded, compatibility is explicit, resources remain bounded, and the final visual certification contains evidence for all of it.
