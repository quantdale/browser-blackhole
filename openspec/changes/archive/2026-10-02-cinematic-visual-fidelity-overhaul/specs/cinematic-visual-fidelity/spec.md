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

Cinematic mode SHALL form its final image through an explicitly defined pipeline rather than a static exposure/bloom preset.

#### Scenario: cinematic frame is composed

- GIVEN a destination rendered in Cinematic mode at High quality
- WHEN the frame's image is formed
- THEN the pipeline SHALL explicitly define HDR source, temporal reconstruction policy, emissive highlight/mask extraction, bloom/glare policy, transition composition ordering, exposure, tone mapping and final output conversion in a documented order
- AND Scientific mode MAY use a simpler subset of the same pipeline.

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

Highlight/bloom extraction SHALL be driven by emissive or highlight contribution and SHALL NOT spread glow onto unrelated non-emissive geometry.

#### Scenario: bright photosphere near non-emissive UI-like geometry

- GIVEN an emissive star and a non-emissive diagnostic/geometry element share a frame
- WHEN cinematic bloom is enabled
- THEN bloom SHOULD be driven by emissive/highlight contribution rather than indiscriminately applying a broad glow to all bright surfaces
- AND Scientific mode SHALL remain valid with bloom disabled.

### Requirement: Temporal reconstruction SHALL be deterministic and reject stale history

Temporal reconstruction SHALL be deterministic for a fixed seed and capture protocol and SHALL reject stale history after discontinuities.

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

Volumetric sample jitter SHALL be temporally stabilized so that a settled scene shows no visible animated grain.

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

#### Scenario: governor lowers volume quality

- GIVEN a volumetric destination is visible at High quality
- WHEN the global work budget lowers its tier
- THEN the active march steps, internal resolution, detail octaves or lighting taps SHALL reduce within their documented bounds
- AND no unbounded shader loop or resource growth SHALL be requested.

### Requirement: Volumetric composition SHALL account for scene depth where required

Where a destination requires it, volume compositing SHALL respect scene depth at composite boundaries.

#### Scenario: foreground star crossing a half-resolution volume edge

- GIVEN an opaque/bright object lies in front of a half-resolution volume
- WHEN the volume is composited
- THEN the high-quality path SHALL avoid obvious linear-upsample halos across the depth discontinuity
- OR that destination/tier SHALL use a fallback representation that avoids the artifact.

### Requirement: Particle presentation SHALL support non-generic profiles

Particle presentation SHALL be selectable per destination so that at least one representation beyond a single generic soft sprite is available where a destination needs it.

#### Scenario: destination selects a non-generic profile

- GIVEN a destination whose presentation needs velocity-stretched ejecta
- WHEN its particle population is configured
- THEN ParticleService SHALL provide that non-generic profile and apply it
- AND the selected profile SHALL be visible in the destination's particle debug output.

ParticleService or a successor SHALL support at least one representation beyond a single generic soft sprite when a destination needs it.

Examples MAY include:

- compact star profile;
- velocity-stretched ejecta;
- dust blob;
- motion-aligned debris;
- high-dynamic-range emissive core.

### Requirement: Unresolved emitter size semantics SHALL remain explicit

Emitter sizing SHALL use screen-space or world-space semantics explicitly rather than accidental perspective attenuation.

#### Scenario: unresolved emitter versus resolved clump

- GIVEN an unresolved emitter and a resolved physical clump in the same scene
- WHEN their apparent sizes are compared across camera distances
- THEN the unresolved emitter SHALL use screen-space sizing
- AND the resolved clump SHALL use world-space sizing
- AND neither SHALL rely on perspective attenuation to create apparent size.

- Screen-space size SHALL be used for unresolved emitters where appropriate.
- World-space size SHALL be used only when the rendered item represents resolved physical extent.
- No destination SHALL rely on accidental perspective attenuation to create apparent size.

### Requirement: TDE high-quality streams SHALL not be limited to flat ribbons

High/Ultra TDE stream rendering SHALL provide a non-flat strand/tube/volumetric representation tied to the scientific stream spine.

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

Cinematic presentation layers SHALL remain anchored to the data-driven tracer backbone rather than replacing it.

#### Scenario: cinematic density reconstruction

- GIVEN the source-locked tracer dataset is loaded
- WHEN cinematic rendering adds diffuse stellar light, secondary emitters, dust or gas presentation
- THEN tracer positions and timeline interpolation SHALL remain authoritative
- AND added layers SHALL not be represented as source-derived particle data unless they actually are.

### Requirement: Vacuum black-hole scenes SHALL not gain fake luminous matter

Cinematic enhancement of a vacuum scene SHALL NOT introduce fabricated luminous matter presented as physical.

#### Scenario: BBH inspiral without an accretion environment

- GIVEN the modeled scene is a vacuum binary-black-hole event
- WHEN cinematic presentation is upgraded
- THEN the primary visual enhancement SHALL come from lensing/environment/spacetime presentation or explicitly illustrative overlays
- AND the renderer SHALL NOT add fire, glowing gas, an accretion disk or an explosion and present it as physical matter.

### Requirement: Black-Hole Merger high-quality inspiral SHALL move beyond marker-first representation

High/Ultra BBH rendering SHALL not rely on dark spheres plus additive rings and ribbons as the sole or primary representation.

The replacement MAY use strong-field lensing, a validated reduced lensing approximation, or another documented representation tied to the data-derived component trajectories.

#### Scenario: High/Ultra BBH inspiral

- GIVEN a BBH inspiral at High or Ultra quality
- WHEN the inspiral is rendered
- THEN the component presentation SHALL NOT be limited to dark spheres with additive rings and ribbons
- AND the replacement representation SHALL remain tied to the data-derived component trajectories.

### Requirement: Strong-field supersampling SHALL target unstable image regions

Additional high-quality samples SHALL be concentrated in regions of strong image variation rather than uniformly.

#### Scenario: black-hole critical region

- GIVEN neighboring rays near a critical curve diverge strongly in image mapping
- WHEN high-quality reconstruction allocates additional samples
- THEN the additional sampling SHOULD be concentrated where image variation or lens-map difficulty warrants it
- AND the scientific ray classification/result SHALL remain validated against the trusted backend.

### Requirement: Experience modes SHALL preserve a clear scientific/cinematic boundary

Switching experience mode SHALL change presentation only and SHALL NOT alter physical or data state.

#### Scenario: switching from Cinematic to Scientific

- GIVEN the same destination, preset, phase and observer
- WHEN the user switches experience mode
- THEN physical/data state SHALL remain unchanged
- AND display-only effects MAY change
- AND Scientific mode SHALL remain readable without depending on bloom, glare, film effects or aggressive grade.

### Requirement: Global governor SHALL remain the single adaptive authority

The global governor SHALL be the only adaptive quality authority, and expensive visual features SHALL derive their work limits from the shared visual work budget.

#### Scenario: a destination enables an expensive feature

- GIVEN multiple destinations with expensive visual features are configured
- WHEN adaptive quality changes
- THEN the change SHALL come from the global governor's shared work budget
- AND no destination SHALL apply its own independent quality decisions.

Destinations SHALL NOT create independent quality governors.

A shared visual work budget SHALL drive expensive visual features.

### Requirement: Interaction SHALL be allowed to trade temporary quality for responsiveness

Active interaction MAY temporarily reduce quality to preserve responsiveness, and the governor SHALL restore quality after settling without visible oscillation.

#### Scenario: camera orbit on Ultra

- GIVEN expensive temporal/volumetric features are enabled
- WHEN the camera is actively manipulated
- THEN the global governor MAY lower sample count, internal scale, detail or history quality
- AND after settling it MAY progressively restore quality
- AND the transition SHALL avoid visible oscillation/popping.

### Requirement: Scientific and Cinematic visual gates SHALL be separate

Scientific goldens and cinematic visual gates SHALL remain distinct suites and neither SHALL substitute for the other.

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

#### Scenario: cinematic capture is accepted

- GIVEN a destination cinematic capture with fixed destination/preset/phase/camera, experience mode and quality tier
- WHEN the cinematic gate is evaluated
- THEN the capture SHALL be compared against reviewed cinematic baselines after the documented temporal settle/convergence
- AND a scientific golden pass SHALL NOT be accepted as a substitute.

### Requirement: Temporal stability SHALL be a blocking visual metric

At least one automated temporal metric SHALL gate high-quality scenes that use temporal reconstruction or animated stochastic detail.

The metric SHALL detect settled-state flicker in representative:

- bright point emitters;
- volume edges;
- TDE strands;
- strong-field critical regions.

#### Scenario: settled high-quality scene

- GIVEN a high-quality scene with temporal reconstruction or animated stochastic detail reaches its settled state
- WHEN consecutive settled frames are captured
- THEN the temporal metric SHALL compare them against its threshold
- AND a flicker above the threshold SHALL fail the gate.

### Requirement: Human visual review SHALL be mandatory for major milestones

Automated visual metrics SHALL NOT be the sole acceptance criterion.

Each destination migration SHALL include reviewed representative captures.

#### Scenario: destination migration reaches its milestone

- GIVEN a destination visual migration is proposed for acceptance
- WHEN its milestone evidence is assembled
- THEN reviewed representative captures for that destination SHALL be part of the acceptance evidence
- AND acceptance SHALL NOT rest on automated metrics alone.

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

#### Scenario: visual overhaul evidence is recorded

- GIVEN a shared renderer or destination visual overhaul is proposed
- WHEN its evidence is captured
- THEN the evidence SHALL record backend, browser, adapter, viewport, internal dimensions, tier, render scale, GPU timing where available, CPU frame timing and resource counts/memory estimates
- AND a material cost increase SHALL be assigned to an appropriate tier or redesigned.

### Requirement: New temporal and auxiliary resources SHALL remain bounded

History, MRT, volume and environment resources SHALL be disposed when stale and SHALL plateau under repeated use.

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

#### Scenario: capability inventory is published

- GIVEN a new visual capability is introduced
- WHEN the compatibility inventory is produced
- THEN the capability SHALL be categorized as equivalent on WebGPU/WebGL2, simplified but accepted on WebGL2, or optional WebGPU-only with a defined fallback
- AND scientific correctness SHALL NOT depend on WebGPU.

### Requirement: Visual regression thresholds SHALL match scene content

Sparse-on-black scenes SHALL use thresholds appropriate to the fraction of meaningful content.

No threshold may be widened or baseline regenerated merely to silence a visually obvious regression.

#### Scenario: sparse-on-black golden is compared

- GIVEN a sparse-on-black scene in the golden suite
- WHEN its regression comparison runs
- THEN the threshold used SHALL be matched to the fraction of meaningful content in that scene
- AND a visibly obvious regression SHALL NOT be silenced by widening its threshold or regenerating its baseline.

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

#### Scenario: final visual certification is assembled

- GIVEN the showcase milestones are declared done
- WHEN final visual certification is assembled
- THEN it SHALL include accepted showcase captures, accepted scientific captures, accepted temporal metrics, accepted performance/memory results, explicit known limitations, zero unresolved P0/P1 visual defects and documented deferred P2/P3 polish
- AND the term AAA or cinematic SHALL NOT be used as a perpetual untestable objective.

