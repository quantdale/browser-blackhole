# Cinematic visual fidelity specification

## ADDED Requirements

### Requirement: Scientific state SHALL remain authoritative

Presentation changes SHALL consume existing validated scientific/data state rather than silently replacing it with prettier surrogate state.

#### Scenario: TDE stream renderer upgrade

- GIVEN the tidal-disruption model produces an authoritative stream centerline
- WHEN the high-quality renderer adds cross-section, clumping or emissive structure
- THEN the added representation SHALL remain anchored to that centerline
- AND the added structure SHALL be deterministic
- AND the model trajectory SHALL not be altered solely for appearance.

### Requirement: Added visual detail SHALL declare its fidelity class

Any structure not directly present in the validated model SHALL be documented as procedural-scientific, cinematic or illustrative presentation.

#### Scenario: galaxy-collision secondary stars

- GIVEN the DATA_DRIVEN tracer set is used as a dynamical backbone
- WHEN additional unresolved stellar emitters are generated for visual density
- THEN their generation SHALL be deterministic
- AND their relationship to the backbone SHALL be documented
- AND the UI/docs SHALL not claim that those individual stars came from the source dataset.

### Requirement: HDR-producing stages SHALL preserve required dynamic range

A rendering stage that is expected to carry radiance above display white SHALL NOT use an intermediate representation that clamps those values unless equivalence is proven.

#### Scenario: half-resolution emissive volume

- GIVEN a supernova or kilonova volume produces HDR emission above 1.0
- WHEN it is rendered to a lower-resolution intermediate
- THEN the intermediate SHALL preserve the required HDR range
- OR the implementation SHALL prove that clamping cannot alter the accepted result
- AND downstream bloom/glare SHALL receive the intended radiance.

### Requirement: Cinematic mode SHALL use an explicit image-formation pipeline

Cinematic mode SHALL be more than a static exposure/bloom preset.

The pipeline SHALL explicitly define:

- HDR source;
- temporal reconstruction policy;
- emissive highlight extraction or mask policy;
- bloom/glare policy;
- transition composition ordering;
- exposure;
- tone mapping;
- optional deterministic grade;
- final output conversion.

Scientific mode MAY use a simpler subset.

### Requirement: Selective highlight effects SHALL not contaminate unrelated geometry

#### Scenario: bright photosphere near non-emissive UI-like geometry

- GIVEN an emissive star and a non-emissive diagnostic/geometry element share a frame
- WHEN cinematic bloom is enabled
- THEN bloom SHOULD be driven by emissive/highlight contribution rather than indiscriminately applying a broad glow to all bright surfaces
- AND Scientific mode SHALL remain valid with bloom disabled.

### Requirement: Temporal reconstruction SHALL be deterministic and reject stale history

#### Scenario: camera cut

- GIVEN temporal history exists
- WHEN a preset performs a camera cut or a sufficiently large camera discontinuity
- THEN stale history SHALL be invalidated or strongly rejected
- AND no persistent ghost image SHALL remain.

#### Scenario: timeline scrub

- GIVEN a destination is temporally accumulated
- WHEN the user scrubs to a discontinuous phase
- THEN old history SHALL not blend a previous physical state into the new state.

#### Scenario: stable camera convergence

- GIVEN the camera and scientific state are stable
- WHEN multiple frames are accumulated
- THEN image noise/flicker SHOULD decrease or detail SHOULD converge
- AND the converged result SHALL remain deterministic for a fixed seed and capture protocol.

### Requirement: Volumetric jitter SHALL NOT ship as visible animated grain

#### Scenario: paused supernova

- GIVEN the supernova timeline and camera are paused
- WHEN volumetric sample jitter is enabled
- THEN temporal reconstruction SHALL stabilize the presented image
- AND consecutive settled frames SHALL remain within the temporal stability threshold.

### Requirement: Volumetrics V2 SHALL support bounded quality scaling

Volume sampling/detail SHALL be driven by the global quality/work budget.

Quality controls MAY include:

- active march steps;
- internal resolution;
- detail octave count;
- lighting tap count;
- temporal accumulation parameters.

No quality tier may request unbounded shader loops or unbounded resource growth.

### Requirement: Volumetric composition SHALL account for scene depth where required

#### Scenario: foreground star crossing a half-resolution volume edge

- GIVEN an opaque/bright object lies in front of a half-resolution volume
- WHEN the volume is composited
- THEN the high-quality path SHALL avoid obvious linear-upsample halos across the depth discontinuity
- OR that destination/tier SHALL use a fallback representation that avoids the artifact.

### Requirement: Particle presentation SHALL support non-generic profiles

ParticleService or a successor SHALL support at least one representation beyond a single generic soft sprite when a destination needs it.

Examples MAY include:

- compact star profile;
- velocity-stretched ejecta;
- dust blob;
- motion-aligned debris;
- high-dynamic-range emissive core.

### Requirement: Unresolved emitter size semantics SHALL remain explicit

- Screen-space size SHALL be used for unresolved emitters where appropriate.
- World-space size SHALL be used only when the rendered item represents resolved physical extent.
- No destination SHALL rely on accidental perspective attenuation to create apparent size.

### Requirement: TDE high-quality streams SHALL not be limited to flat ribbons

#### Scenario: Ultra TDE debris phase

- GIVEN the scientific model supplies a stream spine and stage state
- WHEN High/Ultra rendering is active
- THEN the renderer SHALL have access to a non-flat strand/tube/volumetric representation
- AND that representation SHALL preserve the scientific spine
- AND RibbonService MAY remain as a lower-tier or illustrative fallback.

### Requirement: Celestial environment SHALL provide sufficient structured light for lensing

The shared environment SHALL include deterministic angular structure at multiple scales so strong-field lensing has meaningful content to distort.

#### Scenario: black-hole critical curve

- GIVEN the camera views a strong-field black hole
- WHEN escaped rays sample the environment
- THEN the environment SHALL contain enough high-frequency structure to make repeated/magnified lensing features perceptible
- AND environment generation SHALL be deterministic for a fixed seed/orientation.

### Requirement: Galaxy Collision SHALL preserve its data-driven backbone

#### Scenario: cinematic density reconstruction

- GIVEN the source-locked tracer dataset is loaded
- WHEN cinematic rendering adds diffuse stellar light, secondary emitters, dust or gas presentation
- THEN tracer positions and timeline interpolation SHALL remain authoritative
- AND added layers SHALL not be represented as source-derived particle data unless they actually are.

### Requirement: Vacuum black-hole scenes SHALL not gain fake luminous matter

#### Scenario: BBH inspiral without an accretion environment

- GIVEN the modeled scene is a vacuum binary-black-hole event
- WHEN cinematic presentation is upgraded
- THEN the primary visual enhancement SHALL come from lensing/environment/spacetime presentation or explicitly illustrative overlays
- AND the renderer SHALL NOT add fire, glowing gas, an accretion disk or an explosion and present it as physical matter.

### Requirement: Black-Hole Merger high-quality inspiral SHALL move beyond marker-first representation

High/Ultra BBH rendering SHALL not rely on dark spheres plus additive rings and ribbons as the sole or primary representation.

The replacement MAY use strong-field lensing, a validated reduced lensing approximation, or another documented representation tied to the data-derived component trajectories.

### Requirement: Strong-field supersampling SHALL target unstable image regions

#### Scenario: black-hole critical region

- GIVEN neighboring rays near a critical curve diverge strongly in image mapping
- WHEN high-quality reconstruction allocates additional samples
- THEN the additional sampling SHOULD be concentrated where image variation or lens-map difficulty warrants it
- AND the scientific ray classification/result SHALL remain validated against the trusted backend.

### Requirement: Experience modes SHALL preserve a clear scientific/cinematic boundary

#### Scenario: switching from Cinematic to Scientific

- GIVEN the same destination, preset, phase and observer
- WHEN the user switches experience mode
- THEN physical/data state SHALL remain unchanged
- AND display-only effects MAY change
- AND Scientific mode SHALL remain readable without depending on bloom, glare, film effects or aggressive grade.

### Requirement: Global governor SHALL remain the single adaptive authority

Destinations SHALL NOT create independent quality governors.

A shared visual work budget SHALL drive expensive visual features.

### Requirement: Interaction SHALL be allowed to trade temporary quality for responsiveness

#### Scenario: camera orbit on Ultra

- GIVEN expensive temporal/volumetric features are enabled
- WHEN the camera is actively manipulated
- THEN the global governor MAY lower sample count, internal scale, detail or history quality
- AND after settling it MAY progressively restore quality
- AND the transition SHALL avoid visible oscillation/popping.

### Requirement: Scientific and Cinematic visual gates SHALL be separate

#### Scientific gate

Existing deterministic scientific goldens SHALL remain preserved unless a separately reviewed scientific/representation change requires an update.

#### Cinematic gate

A new cinematic visual suite SHALL:

- fix destination/preset/phase/camera;
- fix experience mode and quality tier;
- include intended tone mapping and bloom;
- define temporal settle/convergence;
- record backend/adapter/browser metadata;
- compare against reviewed cinematic baselines.

A scientific golden pass SHALL NOT be treated as evidence that Cinematic mode looks correct.

### Requirement: Temporal stability SHALL be a blocking visual metric

At least one automated temporal metric SHALL gate high-quality scenes that use temporal reconstruction or animated stochastic detail.

The metric SHALL detect settled-state flicker in representative:

- bright point emitters;
- volume edges;
- TDE strands;
- strong-field critical regions.

### Requirement: Human visual review SHALL be mandatory for major milestones

Automated visual metrics SHALL NOT be the sole acceptance criterion.

Each destination migration SHALL include reviewed representative captures.

### Requirement: Visual changes SHALL carry performance evidence

For every shared renderer or destination visual overhaul, evidence SHALL record:

- backend;
- browser;
- adapter;
- viewport;
- internal dimensions;
- tier;
- render scale;
- GPU timing where available;
- CPU frame timing;
- resource counts/memory estimates.

A visual feature that materially increases cost SHALL be assigned to an appropriate tier or redesigned.

### Requirement: New temporal and auxiliary resources SHALL remain bounded

#### Scenario: repeated resize and destination switching

- WHEN the user repeatedly resizes, switches destinations and toggles quality
- THEN history/MRT/volume/environment resources SHALL plateau
- AND stale targets SHALL be disposed
- AND ResourceScope and renderer memory counts SHALL not grow without bound.

### Requirement: WebGL2 fallback SHALL remain explicit

Every new visual capability SHALL be categorized as:

- equivalent on WebGPU/WebGL2;
- simplified but accepted on WebGL2;
- optional WebGPU-only cinematic enhancement with a defined fallback.

Scientific correctness SHALL NOT become WebGPU-only merely because the cinematic implementation is easier there.

### Requirement: Visual regression thresholds SHALL match scene content

Sparse-on-black scenes SHALL use thresholds appropriate to the fraction of meaningful content.

No threshold may be widened or baseline regenerated merely to silence a visually obvious regression.

### Requirement: Showcase quality SHALL have a finite definition of done

The project SHALL NOT use the term AAA or cinematic as an untestable perpetual objective.

Final visual certification SHALL include:

- accepted showcase captures;
- accepted scientific captures;
- accepted temporal metrics;
- accepted performance/memory results;
- explicit known limitations;
- no unresolved P0/P1 visual defects;
- documented deferred P2/P3 polish.

