# EXECUTION PROMPT — M10 Relativistic Observer Frames

Status: ACTIVE
Planned-From: 0139e65f44b9969453c508f0bc48d7054e29db10
Planned-At: 2026-08-25T08:53:00+08:00
Target-Branch: main
Campaign-Type: IMPLEMENTATION
Expected-Scale: substantial autonomous campaign, roughly 8–12 hours when the work and validation justify it; this is a sizing target, not permission to invent work or weaken gates

## Mission

Implement **M10 — Relativistic Observer Modes** end-to-end as the next authoritative integration milestone for `browser-blackhole`.

The result must turn the currently scaffolded observer state into a physically meaningful relativistic observer system. Separate ordinary view orientation from the physical observer worldline and four-velocity, then implement and validate static, circular-orbit, flyby, and free-fall/plunge observers; relativistic aberration and observer-frequency effects; deterministic time/pause behavior; truthful near-horizon handling; production UI/state/preset integration; CPU/GPU reference validation; browser/E2E coverage; visual regression coverage; performance characterization; documentation; and durable checkpoint state.

The central acceptance principle is the roadmap's own M10 exit gate:

> Observer motion must alter the apparent scene through documented relativistic transformations and physical worldlines, **not merely by animating the Three.js camera**.

This campaign is intentionally broad. It should complete the coherent M10 milestone rather than stop after one helper or one observer mode. However, do not manufacture unrelated tasks merely to fill time. When M10's actual exit gate and cumulative quality gates are satisfied, close the campaign and stop. Do **not** roll directly into CA9 Galaxy Collision or M11 release hardening in the same execution campaign.

---

## Why this is the correct next campaign

Repository evidence at planning time:

- `main` is at `0139e65f44b9969453c508f0bc48d7054e29db10` (`docs: close CA8 with cumulative validation evidence`).
- `.agent/STATE.md` records CA8 Black-Hole Merger as complete end-to-end and reports zero known Critical/High defects.
- M9 Kerr spacetime is already complete and validated.
- `docs/ROADMAP.md` defines M10 Relativistic Observer Modes immediately after M9 and says milestone integration order is authoritative.
- `docs/MILESTONE_WORK_PACKETS.md` still has the entire M10 packet family to implement: `M10-01..M10-09`.
- `docs/BACKLOG.md` maps the same work to `BH-220..BH-224`, beginning with the architectural prerequisite: separate camera pose from physical observer four-velocity.
- Canonical application state already contains `observer.mode = free | static | circular | flyby | freefall`, position/target/up/FOV, simulation time, time scale, and pause state, but those modes are not yet a complete physical rendering system.
- `src/camera/CameraController.ts` currently exports a Euclidean camera basis that drives renderer uniforms. That remains useful for view orientation but is not sufficient to represent a relativistic observer.
- `src/phenomena/black-hole/controlState.ts` currently has an `orbit` boolean explicitly described as a **cinematic slow-orbit presentation flag, not physics**.
- `src/atlas/destinations/blackHoleDestination.ts` implements that cinematic orbit by incrementing the camera rig azimuth. Preserve it only as clearly labeled presentation behavior; never reinterpret it as the new physical circular observer.
- `docs/KERR_BACKEND_ADR.md` explicitly designates ingoing Kerr-Schild as the migration path if M10 plunge observers require horizon-crossing integration. M10 must make and document that decision with concrete acceptance requirements rather than avoiding it or guessing formulas.
- The repository already has strong validation infrastructure: camera unit tests, Schwarzschild reference tests, Kerr characteristics/reference/convergence tests, CPU↔GPU parity browser suites, Kerr integration browser tests, deterministic visual goldens, benchmark harnesses, lifecycle/torture coverage, and cumulative quality gates.
- There are no open repository issues or PRs that supersede this milestone at planning time.

Therefore: **M10 is higher priority than CA9** and should be treated as one large GR/renderer/product integration campaign.

---

## Mandatory startup and repository safety

Before editing implementation files:

1. Read completely and obey, in authority order where applicable:
   - `AGENTS.md`
   - `.agent/STATE.md`
   - `.agent/START_HERE.md`
   - `.agent/EXECUTION_PROTOCOL.md`
   - `.agent/QUALITY_GATES.md`
   - `.agent/PLANNER_HANDOFF.md`
   - this `.agent/EXECUTION_PROMPT.md`
   - M10 in `docs/ROADMAP.md`
   - M10 in `docs/MILESTONE_WORK_PACKETS.md`
   - observer items in `docs/BACKLOG.md`
   - `docs/PHYSICS.md`
   - `docs/NUMERICAL_METHODS.md`
   - `docs/VALIDATION_VECTORS.md`
   - `docs/KERR_BACKEND_ADR.md`
   - `docs/KERR_RESEARCH_PLAN.md` where it still constrains M10 decisions
   - `docs/STATE_SCHEMA.md`
   - `docs/UI_CONTROL_CATALOG.md`
   - `docs/TESTING.md`
   - `docs/PERFORMANCE.md` and `docs/PERFORMANCE_BUDGETS.md`
   - relevant Cosmic Atlas architecture/state/route docs before changing destination integration.
2. Inspect `git status`, current branch, `git log -10`, and `origin/main`.
3. The implementation session must operate from `main`. At campaign start, synchronize carefully with remote `main` without destroying unknown local work.
4. Reconcile `Planned-From` with reality. If newer valid work has landed since this planning commit, inspect it and adapt the campaign rather than resetting or redoing completed work.
5. Never use destructive cleanup to make the workspace convenient: no `git reset --hard`, `git clean`, force-push, history rewrite, or deletion of unknown work.
6. Do not begin implementation from an unrelated feature branch and leave the final result there. The completion state is local `main == origin/main` with all campaign work pushed.
7. Run narrow checks while developing, then all cumulative gates required below before closure.

The planning commit itself is not an implementation baseline claim. Validate the actual checkout before changing scientific code.

---

## Behavior that must be preserved

Unless this campaign intentionally and scientifically changes a behavior with documented rationale and updated tests, preserve all of the following:

- all CA0–CA8 Cosmic Atlas destinations, routing, transitions, cancellation/disposal, share/preset behavior, and launch catalog behavior;
- all M0–M9 black-hole renderer behavior and conventions;
- Schwarzschild numerical and LUT routing semantics;
- Kerr numerical routing semantics and signed-spin convention;
- the canonical +Y Kerr spin-axis limitation unless M10 requires a separately justified expansion;
- existing static camera images and scientific presets within documented tolerances;
- existing ray classifications and explicit numerical-failure handling;
- existing disk geometry/emission/redshift conventions;
- Scientific/Cinematic/Debug separation;
- dynamic-resolution, temporal, resource-lifecycle, and benchmark honesty rules;
- no silent fallback from real physics to presentation animation;
- no unknown-provenance asset or new network dependency for core operation.

**Static observer equivalence is a first-class regression gate.** If the new observer abstraction cannot reproduce today's validated static observer ray initialization and output, the architecture is not ready to replace the old path.

---

## Explicit non-goals

Do not expand this campaign into unrelated work:

- no CA9 Galaxy Collision implementation;
- no broad M11 production-release campaign;
- no arbitrary UI redesign;
- no unrelated refactor of every Cosmic Atlas module;
- no new visual effect presented as relativity;
- no speculative GRMHD/radiative-transfer system;
- no generic N-body simulator;
- no multiplayer/server/telemetry work;
- no tilted Kerr spin axis unless it is genuinely required by the selected M10 formulation and can be validated without destabilizing the milestone;
- no replacement of validated Schwarzschild/Kerr backends solely for aesthetic code cleanup;
- no horizon-crossing claim unless the coordinates/integrator actually support it and tests demonstrate it.

---

# Workstream 0 — Audit, scientific decision record, and M10 support contract

Before implementing observer modes, perform a targeted architecture/physics audit of the current black-hole destination, camera basis path, Schwarzschild reference/production integrators, Kerr reference/production integrators, LensingService interfaces, state/control normalization, presets, test hooks, TimeController, debug snapshots, and relevant UI.

Produce an explicit M10 observer design record, either a dedicated `docs/OBSERVER_MODES_ADR.md` or a rigorously scoped update to the existing scientific ADRs. The document must lock the following before dependent code is treated as authoritative:

1. Metric signature, units, world-frame mapping, and photon-momentum sign convention inherited from existing docs.
2. Definition of an observer state in spacetime:
   - coordinate/world position;
   - timelike four-velocity `u^mu`;
   - orthonormal spatial tetrad/triad used to turn local screen directions into photon four-momentum;
   - orientation policy separating where the camera looks from how the observer moves;
   - time parameter(s): simulation/coordinate/proper time where relevant;
   - explicit validity domain and failure/degraded reasons.
3. What `free`, `static`, `circular`, `flyby`, and `freefall` mean physically.
4. Supported observer parameterization for Schwarzschild and Kerr.
5. Whether each mode is supported by both metrics, only one metric, or requires a truthful disabled/degraded state.
6. Exact frequency-shift convention for a moving observer and how it composes with emitter motion so observer Doppler is not double-applied.
7. Aberration construction: pixel direction is a direction in the observer's local orthonormal frame and is mapped to spacetime momentum through the observer tetrad/four-velocity.
8. Near-horizon policy for static and moving observers.
9. The **Kerr-Schild decision**:
   - define the actual product acceptance scenario for `freefall/plunge` first;
   - if M10 promises worldlines/rays through the Kerr horizon or requires stable horizon-penetrating coordinates, implement the designated ingoing Kerr-Schild migration with independently derived conversion/reference tests;
   - if M10 intentionally terminates before crossing the horizon, document the exact physically meaningful stopping boundary and user-visible limitation;
   - do not keep Boyer-Lindquist through a mathematically invalid/coordinate-singular regime and call it a plunge implementation;
   - do not migrate to Kerr-Schild merely because it sounds more advanced if the acceptance scenario does not exercise its advantage.
10. Numerical tolerances and reference cases that will falsify the implementation.

Use primary/authoritative GR references and the repository's existing locked conventions. Do not implement tetrads/worldlines from memory. Any scientific convention change triggers `.agent/EXECUTION_PROTOCOL.md` §6 in full.

### Deliverable gate for Workstream 0

- design/ADR is committed or staged with the implementation it governs;
- formulas and supported domains are explicit;
- Kerr-Schild decision is explicit and evidence-backed;
- no implementation mode is allowed to remain vaguely defined as a camera animation.

---

# Workstream 1 — Observer four-velocity and local-frame architecture (`M10-01`, `BH-220`)

Create a single scientific observer abstraction owned by the black-hole physics domain rather than scattering velocity patches through camera, UI, and shaders.

Prefer a small cohesive module boundary such as `src/phenomena/black-hole/observer/` if it fits current architecture after inspection. The exact filenames are not mandated; the invariants are.

The abstraction should expose a normalized/read-only **observer frame snapshot** suitable for CPU reference code, GPU uniform mapping, tests, debug UI, and state integration. It should contain only values with defined semantics, for example:

- physical mode;
- metric/spin context needed to interpret it;
- position in canonical units/coordinates;
- physical four-velocity `u^mu`;
- orthonormal local frame/tetrad;
- display/view basis orientation;
- coordinate and/or proper time as actually used;
- locally measured beta/gamma where meaningful;
- validity state and explicit reason when invalid;
- deterministic derived values needed by the renderer.

Do not copy metric/tetrad formulas into UI or destination-adapter code. Centralize them in the scientific layer and keep CPU reference and GPU implementation tied to the same documented convention without hiding independent-validation opportunities.

### Camera separation

`CameraController` / Atlas camera rig remains responsible for **view orientation and user input**. It must no longer implicitly mean "physical observer is static in the coordinates" for every mode.

Establish an explicit mapping:

`view/screen direction -> observer local orthonormal frame -> photon four-momentum -> geodesic integration`

For a static observer, this mapping must collapse to the currently validated Schwarzschild/Kerr static initialization within strict tolerance.

OrbitControls behavior must be mode-aware:

- free/presentation camera mode may retain ordinary orbit interaction;
- physical worldline modes must not let OrbitControls silently teleport the physical observer or modify its four-velocity without going through canonical state/normalization;
- if user look-direction is allowed while physically moving, looking and moving remain independent concepts;
- disabled/limited interactions must be visible and accessible, not silently ignored.

### Required unit gates

At minimum:

- `u_mu u^mu = -1` across supported reference states;
- tetrad orthonormality `e_(a) · e_(b) = eta_ab`;
- spatial legs orthogonal to `u`;
- local photon direction maps to null spacetime momentum;
- static Schwarzschild mapping matches the existing reference initialization;
- static Kerr mapping matches the locked M9 tetrad initialization;
- invalid regions fail explicitly rather than producing NaN/black pixels.

---

# Workstream 2 — Static observer as the compatibility anchor (`M10-02`)

Implement/route an explicit physical `static` observer through the new architecture for both validated Schwarzschild and Kerr domains.

The existing renderer effectively assumes a static observer during ray initialization; M10 must make that assumption explicit and move it behind the new observer interface without changing the scientific result.

Requirements:

- Schwarzschild static observer outside the horizon uses the validated static tetrad.
- Kerr static observer remains valid only where the timelike static worldline exists; current Kerr ADR excludes at/below the ergosphere. Preserve that truth.
- UI must prevent or clearly reject an invalid static configuration.
- The current default black-hole and Kerr validation presets must remain regression anchors.
- Existing M9 CPU/GPU selected-ray parity should continue to pass with the new observer path.
- Existing visual goldens for static scenes should remain unchanged unless a genuine pre-existing bug is proven. Do not update goldens just to make the suite green.

This workstream is the proof that M10 architecture preserves M9 correctness before moving observer modes are added.

---

# Workstream 3 — Circular-orbit observer (`M10-03`, `BH-221`)

Implement a true timelike circular observer worldline, not the existing `orbit` camera animation.

The ADR must define the supported orbital family and domain. Prefer the simplest scientifically coherent formulation that works across the intended metrics and can be independently tested.

Requirements include:

- physical circular four-velocity derived from the active metric and orbit convention;
- valid-radius checks with explicit rejection/limitation for non-timelike/unstable/unsupported circular trajectories;
- deterministic evolution of position/orientation from simulation time;
- correct local tetrad for the moving observer;
- aberration of the sky/disk due to observer motion;
- observer contribution to frequency shift from invariant `-k·u_observer`;
- no double-counting of orbital motion in camera animation plus observer Lorentz/frame transformation;
- metric/spin-dependent behavior if Kerr circular observers are supported;
- clear UI distinction between **Physical circular observer** and the legacy/cinematic camera orbit.

Reference gates should include:

- four-velocity normalization;
- analytic or independently derived circular angular velocity/reference cases;
- far-field/Newtonian limit where appropriate;
- spin-zero Kerr -> Schwarzschild convergence for equivalent observer cases;
- prograde/retrograde behavior where relevant;
- special-relativistic local aberration/Doppler limit at large radius;
- deterministic full-period or symmetry checks when applicable.

Add at least one scientifically purposeful circular-observer preset and browser scenario only after the physical path is validated.

---

# Workstream 4 — Flyby observer (`M10-04`, `BH-222`)

Implement a physically defined flyby worldline. Do not label an arbitrary Three.js spline or constant camera translation as a relativistic flyby.

Before coding, lock the model in the ADR. The acceptable implementation may be a timelike geodesic with a defined set of conserved quantities/initial local velocity, or another rigorously documented approximation if the product scope explicitly says so and the limitation is visible. Prefer a model that reuses validated metric/reference machinery and has conserved quantities that make it falsifiable.

Requirements:

- deterministic initial condition parameterization;
- bounded/safe user control ranges;
- physically valid `u^mu` at every supported sample;
- deterministic evolution from canonical simulation time;
- explicit handling of scattering/turning points if present;
- stable camera look orientation separate from translational worldline motion;
- physical aberration/frequency effects from the moving frame;
- pause/resume/scrub/reset determinism;
- no hidden random or wall-clock dependence.

Validation should include:

- conserved energy/angular momentum (and Kerr Carter quantity if the chosen formulation uses it) within documented tolerance;
- time-step/refinement convergence where a numerical timelike geodesic is integrated;
- far-field inertial/SR behavior;
- reversible or symmetry cases where physically applicable;
- deterministic repeated playback.

---

# Workstream 5 — Free-fall / plunge observer and near-horizon truth (`M10-05`, `M10-08`, `BH-223`)

Implement a physically defined free-fall/plunge worldline with an explicit reference scenario (for example, release from a documented radius/rest state or a documented conserved-energy plunge). Do not expose a vague "fall speed" slider that has no equation.

This is the workstream that must consume the Workstream 0 Kerr-Schild decision.

### Minimum requirements

- timelike normalization and reference initial conditions;
- deterministic integration/evolution;
- explicit physical time semantics;
- worldline remains continuous and finite across every advertised supported region;
- local observer tetrad remains usable across the supported region;
- photon initialization remains null and finite;
- approaching-horizon behavior is tested, not merely watched visually;
- unsupported coordinate regions terminate or degrade truthfully;
- no screen freeze, teleport, enormous NaN velocities, or silent numerical-failure-as-shadow behavior;
- if horizon crossing is advertised, the coordinate/integrator path must actually support it.

### If Kerr-Schild migration is required

Treat it as a scientific backend extension, not a local camera patch:

- derive and document coordinate mapping/conventions from authoritative references;
- preserve existing world-frame/spin/sign conventions;
- implement an independent CPU reference first or in lockstep;
- add coordinate-transform round-trip/reference tests;
- test null/timelike invariants;
- prove agreement with existing Boyer-Lindquist results in their common valid exterior domain;
- only route plunge/horizon-penetrating workloads to the new path until broader equivalence is demonstrated;
- keep existing M9 static/circular image behavior stable unless migration is deliberately generalized after equivalence is proven;
- expose backend/coordinate truth in debug snapshots.

Do not broaden a KS migration across unrelated destinations or backends simply for architectural uniformity during this campaign.

### Near-horizon validation

Add explicit scenarios around the relevant horizon/ergosphere boundaries for Schwarzschild and Kerr. The suite must distinguish:

- physically invalid static observer;
- valid moving/falling observer;
- coordinate limitation;
- geodesic numerical failure;
- intentional terminal condition.

Those states must not collapse into one generic "failed" or black frame.

---

# Workstream 6 — Aberration, observer Doppler, and radiometric correctness (`M10-06`, `BH-224`)

Make the observer's motion physically visible through local-frame ray construction and invariant frequency transformation.

The repository already defines

`g = nu_observed / nu_emitted = (-k·u_observer) / (-k·u_emitter)`

under its locked sign convention. M10 must ensure the moving observer genuinely supplies the numerator rather than assuming a static observer, while preserving the emitter side of the existing disk model.

Requirements:

- centralize observer contraction/frequency semantics;
- do not add arbitrary brightness multipliers and call them Doppler;
- preserve the repository's distinction between specific and bolometric radiance transforms;
- sky/background direction must aberrate physically from the observer frame;
- disk apparent direction and frequency shift must respond to observer motion consistently;
- static `beta -> 0` limit reproduces the prior renderer;
- changing only camera look direction must not change the physical observer frequency term;
- changing observer velocity while holding look direction fixed must change observables according to the documented transformation.

### Mandatory analytic/reference tests

Add CPU-level tests for at least:

- 1D SR longitudinal Doppler limit;
- transverse behavior where useful;
- analytic aberration angle relation in flat/far-field limit;
- `beta -> 0` continuity;
- normalization under high but supported local beta;
- sign/orientation cases proving approaching/receding semantics;
- emitter-static/observer-moving and observer-static/emitter-moving decomposition;
- combined observer+emitter case to catch double counting;
- Schwarzschild static redshift regression;
- Kerr static/reference regression.

Then add CPU↔GPU selected-ray probes for representative observer modes so the production shader cannot drift from the reference while still making plausible images.

---

# Workstream 7 — Deterministic simulation time, pause, reset, and worldline playback (`M10-07`)

Wire physical observer evolution through the repository's existing deterministic time infrastructure rather than independent `performance.now()` animation.

Audit and reuse `src/atlas/TimeController.ts` where its semantics fit. Do not create a competing time system without a documented reason.

Requirements:

- canonical simulation time drives physical worldlines;
- `paused=true` freezes physical evolution exactly while rendering/UI may remain responsive;
- `timeScale` is normalized/clamped through the canonical state boundary;
- reset and preset load return the observer to a deterministic epoch;
- scrub/seek behavior, if exposed, is deterministic;
- repeated playback from identical state yields identical observer snapshots and visual/reference probes;
- background-tab throttling or frame-rate variation must not change the physical path;
- large `dt`/resume events are bounded or handled through deterministic stepping policy rather than integrating a giant unstable step;
- reduced-motion settings affect presentation UX but do not silently alter scientific worldline equations.

Add unit and browser tests for pause, resume, reset, deterministic replay, and mode switching under an active timeline.

---

# Workstream 8 — Canonical state, controls, presets, persistence, and UI

Integrate M10 through the existing state architecture; no UI-to-uniform shortcuts.

### Canonical state

Audit whether the existing `ObserverState` fields are sufficient. If mode-specific parameters require typed substate, extend the schema deliberately and follow `.agent/EXECUTION_PROTOCOL.md` §8:

- types/schema;
- defaults;
- normalizer/validation;
- cross-field invariants;
- invalidation classification;
- serialization/persistence/share handling;
- preset migration/versioning if compatibility changes;
- unit tests;
- UI mapping.

Do not bump schema version merely for internal refactoring. Do bump/migrate if persisted public state meaningfully changes and compatibility requires it.

### Destination control integration

The black-hole destination has its own canonical control record. Reconcile that architecture with app-level observer state rather than introducing two conflicting observer authorities. There must be one clear normalization path for user-facing physical observer controls.

The existing `orbit` control remains a cinematic/presentation concept unless intentionally renamed/deprecated. Do not silently change old URLs/presets so `orbit: true` suddenly means a physical circular geodesic.

### UI

Implement or enable observer controls only for physics that actually exists:

- observer mode: Static / Circular / Flyby / Free fall-plunge, plus the existing free camera semantics as appropriate;
- mode-specific parameters with units and scientifically meaningful names;
- distance/radius where supported;
- initial velocity/trajectory parameters only if defined by the ADR;
- simulation time/time scale/pause/reset;
- useful derived readouts such as local speed/beta/gamma, radius, mode validity, and active coordinate/backend in Debug mode;
- explicit invalid-region messaging;
- keyboard and touch accessibility for new controls.

Scientific labels must match equations. Cinematic orbit/presentation controls remain visually and semantically separate.

### Presets

Add a small high-value observer preset family after validation, likely including:

- Static reference;
- Circular observer;
- Flyby reference;
- Freefall/Plunge reference;
- optional Kerr-specific observer reference if it proves important behavior.

Each preset must state its physical purpose and supported metric/domain. Do not flood the selector with redundant variants.

### Persistence and share-state

Exercise preset load, reset, `dc=`/share state where applicable, deep reload, and hostile/invalid values. Invalid observer state must fall back or fail according to the repository's established safe-normalization contract, never crash the renderer.

---

# Workstream 9 — Debugging, diagnostics, and observability

M10 changes the initial conditions of every traced photon in moving modes, so debugging must expose enough information to distinguish camera, observer, and geodesic errors.

Extend debug/test snapshots with bounded, serializable observer diagnostics such as:

- active observer mode;
- physical position/radius;
- four-velocity or a compact validated representation;
- local beta/gamma where meaningful;
- coordinate/proper simulation time values actually used;
- observer-frame validity;
- active metric and coordinate formulation;
- selected-ray observer frequency numerator `-k·u_obs` where practical;
- explicit unsupported/invalid reason;
- whether the physical observer and camera/view pose are coupled or independent for the active mode.

Do not expose huge per-frame arrays or create telemetry allocations that materially affect performance.

Ensure numerical-failure/debug classifications remain explicit. A moving-observer initialization failure cannot be disguised as `CAPTURED`.

---

# Workstream 10 — Unit/reference validation (`M10-09`)

Extend the current unit/reference suite rather than replacing it.

At minimum, cover:

1. Observer state normalization and cross-field invariants.
2. Four-velocity normalization for every supported mode/reference scenario.
3. Tetrad orthonormality and local photon null initialization.
4. Static Schwarzschild equivalence to existing reference behavior.
5. Static Kerr equivalence to M9 reference behavior.
6. Circular observer analytic/reference quantities.
7. Flyby conserved quantities/convergence according to chosen formulation.
8. Freefall/plunge conserved quantities and near-horizon behavior.
9. SR Doppler/aberration limits.
10. Combined observer/emitter frequency-shift cases.
11. `beta -> 0` and Kerr `spin -> 0` convergence where applicable.
12. Pause/time-scale/reset/replay determinism.
13. Invalid static Kerr observer in/at ergosphere rejected truthfully.
14. Invalid horizon/domain state does not produce non-finite uniforms.
15. Coordinate-transform/parity tests if Kerr-Schild is introduced.
16. Existing Schwarzschild/Kerr characteristic, reference, convergence, LUT, disk, and state tests remain green.

Tolerance changes require physical/numerical justification. Never loosen a tolerance solely because the new implementation misses it.

---

# Workstream 11 — Browser/E2E, selected-ray parity, visual goldens, and lifecycle torture

Build a dedicated M10 browser suite (for example `tests/browser/observer-modes.spec.ts`) and extend existing parity suites where that gives stronger evidence.

### Browser behavior gates

Cover at least:

- all supported observer modes can be selected through production UI/state paths;
- unsupported mode/metric/region combinations present useful visible feedback;
- static mode reproduces current behavior;
- circular/flyby/freefall modes actually alter physical debug/probe quantities, not only camera coordinates;
- pause freezes worldline state exactly;
- resume and reset are deterministic;
- mode switches do not leave stale velocity/tetrad uniforms;
- deep reload/preset/share state restores the same observer state where supported;
- no uncaught page exception, unhandled rejection, or unexpected console error;
- rapid observer-mode switching and destination A -> black-hole -> C churn leaves no duplicate loops/listeners/resources;
- black-hole destination revisit after churn still has valid observer state;
- device/backend fallback behavior remains truthful.

### CPU↔GPU parity

Extend selected-pixel probes so representative rays in static and moving observer frames can be compared with the binary64/reference implementation. Classification alone is insufficient; compare relevant terminal direction/frequency observables with quantity-specific tolerances.

### Visual goldens

Add a minimal, scientifically useful M10 golden set after numeric validation, such as:

- static observer regression anchor;
- circular observer aberration/Doppler scene;
- flyby reference epoch;
- freefall/plunge reference epoch;
- optional Kerr moving-observer scene if it uniquely exercises frame dragging + observer motion.

All previously accepted goldens should remain unchanged unless a proven bug fix intentionally changes them. Any changed old golden requires an evidence note explaining the physical cause.

New/changed goldens must be generated and then re-run **twice-stable** under the existing deterministic environment before closure.

---

# Workstream 12 — Performance and resource characterization

Moving observer support should change ray initialization and a small amount of time/state work, not accidentally rebuild pipelines or allocate resources per pixel/frame.

Requirements:

- inspect for per-frame heap churn in observer snapshot generation and UI/debug updates;
- avoid recreating GPU materials/pipelines on every worldline step;
- keep uniform/state updates bounded;
- preserve dynamic-resolution and temporal invalidation semantics;
- when the observer physically moves, invalidate temporal history correctly; do not accumulate samples across different spacetime/view states;
- characterize static baseline vs representative circular/flyby/freefall scenarios with the existing benchmark infrastructure or a focused M10 extension;
- record internal resolution, quality tier, backend, browser/hardware, CPU frame deltas, and genuine GPU timing only when timestamps are actually supported;
- compare Kerr cases if M10 changes Kerr initialization materially;
- if Kerr-Schild adds a materially different computational path, benchmark it in matched exterior and plunge scenarios and document memory/instruction implications honestly.

Do not claim a performance regression/improvement from hidden-tab timings or unmatched settings.

The carried `failure-count telemetry into bench records` debt may be fixed **only if it naturally belongs to the M10 benchmark/debug work and can be done without distracting from observer correctness**. If not, leave it tracked.

---

# Workstream 13 — Documentation and durable state

Update documentation to describe what actually shipped, including as applicable:

- `docs/PHYSICS.md`
- `docs/NUMERICAL_METHODS.md`
- `docs/STATE_SCHEMA.md`
- `docs/UI_CONTROL_CATALOG.md`
- `docs/TESTING.md`
- `docs/PERFORMANCE.md` / budgets if affected
- `docs/RENDERING_PIPELINE.md` if observer-frame ray initialization changes the pipeline contract
- `docs/KERR_BACKEND_ADR.md` if Kerr coordinate/tetrad/backend decisions change
- the new observer ADR/design record
- `docs/ROADMAP.md` / packet status only where the repository convention records completion there
- `README.md` user-facing feature/status summary where appropriate
- `.agent/STATE.md` as the authoritative continuation point.

`.agent/STATE.md` closure must record:

- M10 status;
- exact completed packet IDs `M10-01..M10-09` and mapped backlog IDs;
- architectural/physics decisions;
- Kerr-Schild decision and what is actually supported;
- exact test counts and commands;
- visual golden count/stability;
- browser/backend/hardware actually exercised;
- benchmark paths/results;
- known limitations/debt;
- Critical/High defect count;
- exact final commit SHA after available;
- next legitimate campaign candidates, without beginning them.

Repair stale docs discovered during the campaign when they materially affect M10 truth. Do not rewrite unrelated historical documentation for style.

---

## Required validation ladder

Use the repository's existing narrow-to-broad discipline.

### During implementation

Run targeted checks after each scientific slice, for example:

- observer/tetrad/reference unit files;
- Kerr/Schwarzschild convergence files touched by observer initialization;
- state/control tests;
- targeted Playwright observer/parity specs.

### Before each material checkpoint

Run the impacted cumulative scientific and browser tests. If a shared renderer/tetrad/state interface changes, assume the blast radius is broad and validate accordingly.

### Final mandatory deterministic gate

Run:

```bash
npm run check
```

This must include format check, lint, TypeScript, full Vitest, and production build using the repository scripts.

Then run the **full Playwright suite**, not only new M10 tests:

```bash
npm run e2e
```

Also run all required visual-golden stability commands used by the repository and relevant benchmark commands for materially changed strong-field paths.

If an environment-only gate genuinely cannot execute, mark it `DEFERRED_ENVIRONMENT` with the exact reason and required environment. Never convert an unrun GPU/browser gate into `PASS`.

### Regression requirements

- zero known Critical/High defects at closure;
- all prior static Schwarzschild/Kerr reference tests remain green;
- all prior Cosmic Atlas destination suites remain green;
- all existing visual goldens remain accepted unless a documented, physically justified correction intentionally changes them;
- no unexpected browser console errors;
- no stale observer state after destination/mode churn;
- no hidden numerical failures.

---

## Acceptance criteria

The campaign is complete only when **all** of the following are true:

1. `M10-01..M10-09` are implemented or an individual item is explicitly proven inapplicable by the authoritative design with equivalent exit-gate coverage. Do not mark missing feature work DONE merely because a schema enum exists.
2. `BH-220..BH-224` intent is satisfied.
3. Camera/view orientation is architecturally separated from physical observer four-velocity/worldline.
4. Static observer flows through the new observer abstraction and reproduces existing validated output.
5. Circular observer is a genuine physical timelike observer, not camera orbit animation.
6. Flyby is physically defined, deterministic, validated, and not a presentation spline mislabeled as relativity.
7. Freefall/plunge is physically defined and has truthful near-horizon semantics.
8. The Kerr-Schild migration decision is documented and correctly implemented if required by the supported plunge contract.
9. Aberration derives from the moving local observer frame.
10. Observer Doppler/frequency shift derives from invariant `-k·u_obs` and composes correctly with emitter motion.
11. Time, pause, reset, and replay are deterministic across frame-rate variation.
12. Production UI/state/presets expose only implemented, validated semantics and preserve compatibility with existing cinematic orbit behavior.
13. CPU reference tests and CPU↔GPU parity cover representative observer modes.
14. Browser/E2E coverage proves physical state changes, lifecycle correctness, persistence/reset behavior, and no console/runtime errors.
15. New observer visual goldens are twice-stable and prior unrelated goldens remain valid.
16. Performance/resource behavior is measured honestly and has no unexplained severe regression.
17. `npm run check` passes.
18. Full `npm run e2e` passes, or any genuinely unexecutable environment gate is explicitly and narrowly marked `DEFERRED_ENVIRONMENT` without hiding executable failures.
19. `.agent/STATE.md` contains exact final evidence and no stale CA8-as-current-phase wording.
20. Known Critical/High defects = 0.
21. The working tree is clean at closure.
22. Local `main` and `origin/main` point to the same final campaign commit after push and verification.

Do not call M10 complete after an attractive plunge screenshot. Numeric/reference evidence is mandatory.

---

## Commit and push discipline

Work directly with the repository's existing safe Git policy and preserve unknown work.

- Use coherent commits at meaningful vertical checkpoints; do not accumulate the entire milestone into one impossible-to-audit diff if multiple validated checkpoints naturally exist.
- Push validated checkpoints to `main` so the remote remains a durable handoff point.
- Never force-push or rewrite shared history.
- Do not leave completed campaign work only in a local branch.
- At the end of the session, **everything belonging to this campaign must be committed and pushed to `main`**.
- Verify after the final push that local `main` and `origin/main` resolve to the same SHA.

### Final whole-session closure commit requirement

The final closure/state commit message must be a detailed multiline summary of the entire implementation session, not merely `update state` or `finish M10`. It should summarize the substantial observer architecture, physical modes, Kerr-Schild decision/migration if any, aberration/frequency integration, UI/state changes, validation counts/goldens/benchmarks, and remaining documented limitations.

If the implementation is naturally delivered through several commits, the final detailed closure commit should still provide the whole-session narrative so a reviewer can understand the campaign from the Git log and `.agent/STATE.md` without chat history.

Push that final commit and verify the remote SHA. An unpushed implementation is incomplete.

---

## Final executor report

When finished, report concisely but with exact evidence under these headings:

1. **Baseline reconciled** — starting SHA, any newer commits found, branch/worktree state.
2. **Observer architecture** — separation of camera/view pose and physical observer frame/four-velocity.
3. **Physical modes** — static, circular, flyby, freefall/plunge and their supported domains.
4. **Kerr-Schild decision** — retained Boyer-Lindquist boundary or implemented KS path, with rationale.
5. **Aberration/frequency physics** — how moving observer effects are computed and validated.
6. **State/UI/presets** — schema/control changes, compatibility behavior, new observer presets.
7. **Validation** — exact unit, build, Playwright, parity, golden, and benchmark results.
8. **Defects/debt** — Critical/High count and remaining Medium/Low/known scientific limitations.
9. **Git closure** — commit chain, final local SHA, final `origin/main` SHA, clean-worktree confirmation.
10. **Next legitimate campaign** — planning pointer only; do not begin it in this run.

---

## Stop condition

Stop only when M10 reaches a coherent validated checkpoint satisfying the acceptance criteria above, or when a **genuine blocker** makes further correct progress impossible. If blocked, record the blocker durably with exact evidence and complete every independent executable M10 task that does not compromise correctness.

If M10 completes before the expected time window, do not pad the run with unrelated features. Perform only meaningful M10-integrated hardening that directly strengthens its correctness, lifecycle, tests, docs, or performance evidence, then close and push the campaign.

Do **not** automatically start CA9 or M11. A fresh planner pass should select the next campaign from the repository state after M10 lands.