# Whole-Atlas performance specification

## ADDED Requirements

### Requirement: Unchanged visual state SHALL NOT require continuous rendering

When the active destination, camera, timeline, controls, quality, transition, viewport and post state are unchanged, and the destination has no independent continuous animation, the host SHALL be able to preserve the current canvas without issuing continuous destination draw calls.

#### Scenario: paused stationary black hole

- GIVEN the atlas timeline is paused
- AND the camera has settled
- AND no controls, transition, resize or post state changes
- WHEN multiple display refresh intervals pass
- THEN no destination render call is required
- AND the visible canvas remains unchanged
- AND the next user input invalidates and renders promptly.

### Requirement: Hidden document state SHALL NOT poison performance adaptation

Document visibility changes SHALL NOT be interpreted as weak GPU performance or degrade performance adaptation.

#### Scenario: tab hidden and resumed

- GIVEN the atlas is running
- WHEN the document becomes hidden
- THEN nonessential rendering/polling is suspended or heavily reduced
- WHEN it becomes visible again
- THEN governor/frame timing history is reset appropriately
- AND one valid frame is requested
- AND background throttling is not interpreted as weak GPU performance.

### Requirement: Guaranteed transition occlusion SHALL suppress hidden destination draws

While a transition envelope guarantees the destination contributes zero visible pixels, that destination's scene draws SHALL be suppressed until it can contribute.

#### Scenario: incoming destination behind opaque hyperspace

- GIVEN the transition envelope guarantees the destination contributes zero visible pixels
- WHEN the incoming destination is prepared/active
- THEN its state may advance if required
- BUT its scene draw SHALL be skipped until it can contribute
- AND the hyperspace presentation SHALL remain visually unchanged.

### Requirement: Destination shader compilation MAY be prewarmed without changing presentation

The host MAY precompile an incoming destination's visible subgraph during an opaque transition window, and such prewarming SHALL NOT change presentation or leak resources.

#### Scenario: incoming visible subgraph compiled during occlusion

- GIVEN a transition opaque window
- AND the incoming visible scene is prepared
- WHEN Renderer.compileAsync is supported
- THEN the host MAY precompile the incoming visible subgraph
- AND cancellation/stale prepare SHALL not activate or leak resources
- AND arrival pixels SHALL match the non-precompiled path.

### Requirement: Black-hole destination SHALL create only the required strong-field pass on first arrival

On first arrival the destination SHALL create only the strong-field pass required by the resolved backend.

#### Scenario: default Schwarzschild LUT route

- GIVEN LUT assets validate and auto resolves to LUT
- WHEN black-hole prepares
- THEN the LUT pass SHALL be created
- AND unused numerical Schwarzschild and Kerr GPU passes SHALL not be created solely for possible future switching.

#### Scenario: later switch to Kerr

- GIVEN Schwarzschild is currently visible
- WHEN controls request Kerr
- THEN Kerr SHALL be created lazily
- AND current presentation SHALL remain valid until the replacement is ready
- AND the swap SHALL not show an incorrect intermediate metric.

### Requirement: Runtime volume quality SHALL reduce actual marching work

A reduced effective volume work budget SHALL reduce executed volume sampling work, not merely a quality label.

#### Scenario: governor drops tier

- GIVEN a visible VolumeService instance
- WHEN effective volume work budget is reduced
- THEN the number of executed density/emission samples SHALL reduce accordingly
- AND integration remains normalized across the ray-volume span
- AND the accepted visual result remains within its validation threshold.

### Requirement: Invisible or zero-contribution volume SHALL perform no march

A volume that cannot contribute to the presented image SHALL be excluded from volume marching work.

#### Scenario: volume contributes nothing

- GIVEN a volume is invisible or its effective contribution is exactly zero
- WHEN a frame is rendered
- THEN no nested volume march render SHALL execute for that volume.

### Requirement: Static particle systems SHALL not simulate per frame

A particle population with no time-varying state SHALL NOT be re-integrated, re-dispatched or re-uploaded every frame.

#### Scenario: AGN host stars

- GIVEN a seeded particle population with zero velocity and no time-varying state
- WHEN the GALACTIC zone remains visible
- THEN the population SHALL remain visually stable
- AND no per-frame CPU integration, GPU compute dispatch or full buffer upload SHALL occur.

### Requirement: Zero active particle population SHALL not dispatch simulation

A population resolving to zero active particles SHALL NOT perform simulation work that cannot affect future deterministic state.

#### Scenario: population scale resolves to zero

- GIVEN population scale resolves to zero
- WHEN the module updates
- THEN ParticleService SHALL not perform simulation work that cannot affect future deterministic state, except where an explicitly documented resume policy requires it.

### Requirement: Dynamic buffer uploads SHALL be revision-driven

Buffer updates SHALL be driven by state revisions rather than by the render loop.

#### Scenario: galaxy collision paused

- GIVEN the galaxy-collision phase is unchanged
- WHEN update is called
- THEN tracer interpolation SHALL not rerun
- AND position BufferAttributes SHALL not be marked needsUpdate
- AND no new per-frame center/probe scratch allocation SHALL occur.

### Requirement: Heavy destination implementation modules SHALL be route-lazy

Heavy destination implementation code SHALL load on route demand rather than during registry initialization.

#### Scenario: atlas boots to another destination

- GIVEN the initial route does not require neutron-star
- WHEN the registry initializes
- THEN heavyweight neutron-star surface-lensing implementation code SHALL not be imported solely to obtain descriptor metadata.

### Requirement: One global WorkBudget SHALL govern adaptive work

- Quality-sensitive services SHALL receive work limits from the host/global governor.
- Destinations SHALL NOT create independent competing performance controllers.
- WorkBudget changes SHALL be observable in debug telemetry.

#### Scenario: services share one work budget

- GIVEN multiple quality-sensitive services are active
- WHEN the global WorkBudget changes
- THEN each service SHALL derive its work limit from that single budget
- AND no destination-side controller SHALL override it.

### Requirement: Kerr speedup SHALL preserve scientific outcomes

For any Kerr optimization claimed as accepted:

- captured/escaped/disk-hit/failure classification SHALL remain within the approved reference contract;
- spin-zero convergence SHALL remain green;
- high-spin critical reference cases SHALL remain green;
- moving-observer reference cases SHALL remain green;
- numerical failure/MAX_STEPS rate SHALL not increase merely to obtain speed;
- image goldens SHALL remain accepted;
- measured GPU time or work count SHALL improve reproducibly.

#### Scenario: Kerr optimization is accepted

- GIVEN a claimed Kerr speedup
- WHEN the reference parity rows and image goldens are evaluated
- THEN captured/escaped/disk-hit/failure classification and the spin-zero, high-spin and moving-observer references SHALL remain green
- AND the measured GPU time or work count improvement SHALL be reproducible.

### Requirement: Performance telemetry SHALL distinguish CPU and GPU time

- CPU rAF timing SHALL never be labeled GPU timing.
- GPU timestamp timing SHALL be labeled as GPU timing only when the backend reports it.
- Benchmark artifacts SHALL record pixel size, tier, render scale, backend, browser, adapter and destination.

#### Scenario: telemetry labels timing sources

- GIVEN CPU frame timing and GPU timestamp timing are both recorded
- WHEN a benchmark artifact is written
- THEN CPU rAF timing SHALL be labeled as CPU timing and never as GPU timing
- AND GPU timestamps SHALL be labeled GPU timing only when the backend reports them.

### Requirement: Resource residency SHALL remain bounded under lazy loading

Resource counts and residency SHALL plateau under repeated lazy loading and switching.

#### Scenario: repeated backend and destination switching

- WHEN the user repeatedly navigates all destinations and toggles black-hole backends
- THEN ResourceScope totals and renderer.info resource counts SHALL plateau
- AND stale async-created resources SHALL be disposed
- AND no monotonic program/texture/render-target growth SHALL remain.

### Requirement: WebGL2 fallback SHALL remain functional

Every shared optimization SHALL either:

- run equivalently on the WebGL2 backend; or
- provide an explicit equivalent fallback implementation.

No optimization in this change may silently convert WebGPU from preferred to mandatory.

#### Scenario: shared optimization runs on WebGL2

- GIVEN a shared optimization in this change runs on the WebGPU backend
- WHEN the same scene runs on the WebGL2 fallback backend
- THEN the optimization SHALL run equivalently or through its explicit fallback implementation
- AND WebGPU SHALL remain preferred rather than mandatory.

### Requirement: Visual preservation SHALL be a blocking gate

- Existing golden thresholds SHALL not be widened merely to accept an optimization.
- Golden regeneration SHALL require a separate reviewed reason.
- Bloom-resolution optimization SHALL use a bloom-enabled visual gate because the core physics goldens intentionally disable bloom.

#### Scenario: an optimization would change a golden

- GIVEN an optimization would change a golden image
- WHEN the golden gate is evaluated
- THEN the golden threshold SHALL NOT be widened to accept the change
- AND any golden regeneration SHALL carry a separately reviewed reason.

### Requirement: Performance claims SHALL be reproducible

An optimization SHALL NOT be called successful from one noisy run.

For significant renderer changes:

- warmup conditions SHALL match;
- before/after internal pixel count SHALL match unless pixel count is the changed variable;
- median and tail statistics SHALL be recorded;
- same-machine interleaved A/B SHALL be used where machine-state variance is known;
- the exact commit SHA SHALL be recorded.

#### Scenario: a performance win is claimed

- GIVEN a significant renderer change
- WHEN before/after evidence is captured
- THEN warmup conditions, internal pixel count (unless it is the changed variable) and the exact commit SHA SHALL match the recorded protocol
- AND median and tail statistics SHALL be recorded before the claim is made.
