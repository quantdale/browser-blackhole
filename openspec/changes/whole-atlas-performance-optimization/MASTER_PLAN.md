# Whole-Atlas Performance Optimization — Implementation Master Plan

Change ID: whole-atlas-performance-optimization
Status: PLAN ONLY — NO PERFORMANCE IMPLEMENTATION IN THIS CHANGE
Priority: HIGH
Planned-From: main@e2fadde55a39834e2438d56a568f18788b7c7ced
Planned-At: 2026-08-27
Target-Branch: main
Product surface: all eight production Cosmic Atlas destinations plus shared renderer, transition, UI, resource, startup, WebGPU and WebGL2 fallback paths

## 0. Mission

Optimize the entire Cosmic Atlas for substantially lower GPU/CPU cost, faster first-use latency, lower idle power, lower transition overhead and better constrained-hardware behavior while preserving the intended visual result and the declared scientific model.

This is not a visual downgrade campaign. It is a work-elimination and algorithmic-efficiency campaign.

The central rule is:

> If two executions produce the same accepted visual/scientific result, prefer the one that performs less work. If an optimization changes the accepted result, it is not automatically acceptable merely because it is faster.

Every optimization must be supported by measured evidence. No task may be marked complete because it "should be faster."

## 1. Audit basis and scope

This plan was produced from a repository-wide runtime audit at main@e2fadde55a39834e2438d56a568f18788b7c7ced.

The audit inventoried all 124 shipped files under src, approximately 1.58 MB of runtime TypeScript/CSS, including:

- app bootstrap, state, status and test hooks;
- atlas host, time, navigation, routes, registry, transition director, governor and resource manager;
- renderer kernel, renderer compatibility path, resize path and shared rendering services;
- all full-screen TSL/geodesic shader implementations;
- black-hole Schwarzschild numerical, Schwarzschild LUT, Kerr and moving-observer paths;
- neutron-star surface lensing and field-line presentation;
- stellar explosion;
- compact merger;
- tidal disruption;
- quasar/AGN;
- black-hole merger;
- galaxy collision;
- shared particles, volumes, ribbons, trajectories, lensing, camera rig, post processing and resource scope;
- atlas UI and waveform/status surfaces.

The audit also reviewed current benchmark artifacts, performance-budget documentation, Kerr research documentation, release certification, visual-golden policy and the existing production-readiness OpenSpec.

The plan MUST continue to treat tests, benchmark scripts, data generators and docs as first-class evidence surfaces even though the runtime hot-path audit is centered on src.

## 2. Current evidence: the problem is real but concentrated

The repository already proves that the project can be extremely expensive on the wrong path.

Current documented same-era GPU timing on the campaign machine at internal 972x727, pinned medium, hardware WebGPU:

| Workload | Approximate observed GPU render-pass cost |
| --- | ---: |
| Schwarzschild LUT | about 10.2 ms |
| Schwarzschild numerical | about 40.7 ms |
| Kerr static | about 129 ms |
| non-black-hole CA destinations | about 0.5–0.8 ms |

The historical M9 Kerr characterization also recorded roughly 180.8 ms median CPU-side frame delta at ultra 1600x1007 with a high-spin prograde Kerr scene, and M11 moving-observer Kerr recorded a large premium when the moving-observer step budget was tripled.

Hosted GitHub runners have already demonstrated the extreme fallback case: heavy TSL lensing/Kerr and hyperspace paths can collapse to seconds-per-frame under software WebGL2. The full GPU suite was therefore moved to a capable local-runner gate.

Interpretation:

1. The renderer is not uniformly slow.
2. The dominant costs are specific strong-field full-screen paths and some full-screen/post effects.
3. Several other destinations are already near the machine's vsync floor and should receive low-risk work-elimination changes rather than aggressive approximation.
4. There is still meaningful CPU/setup/idle waste outside the dominant GPU path.
5. Optimization must be workload-aware, not a blanket quality reduction.

## 3. Hard invariants

No optimization may violate these invariants.

### 3.1 Visual parity

- Existing deterministic goldens remain the default acceptance baseline.
- Do not regenerate a golden merely because an optimization changed the image.
- If a deliberately equivalent implementation produces tiny backend-level numeric drift, investigate first. Only a separately reviewed baseline update may follow evidence that the new image is scientifically and perceptually equivalent.
- Preserve tone mapping, exposure, color space, black level, disk/ring morphology, star field, flare/jet morphology, particle/ribbon behavior and transition identity unless a separate visual-design change explicitly authorizes change.

### 3.2 Scientific parity

- Schwarzschild and Kerr parity/reference corpora remain blocking.
- Neutron-star surface-ray reference behavior remains blocking.
- Moving-observer tetrad/photon initialization semantics remain blocking.
- DATA_DRIVEN datasets for black-hole merger and galaxy collision may not be replaced with cinematic approximations.
- PROCEDURAL_SCIENTIFIC destinations may optimize implementation but must preserve their documented model and disclosure.
- Never lower numerical tolerances or classify failed rays as successful merely to improve timing.
- Never enlarge a black-hole shadow or alter disk hit behavior to hide MAX_STEPS/numerical failure.

### 3.3 Architecture

- Keep one renderer ownership authority.
- Keep explicit ResourceScope ownership and deterministic disposal.
- Keep the single global governor as the quality authority; destination-specific quality knobs must be driven through a shared policy, not private competing governors.
- Maintain WebGPU preferred plus WebGL2 fallback.
- Preserve deterministic seeded behavior required by goldens/tests.

### 3.4 Measurement honesty

- CPU rAF frame deltas are not GPU time.
- GPU timestamp values are not CPU time.
- All reports state viewport, internal pixel dimensions, backend, tier, render scale, adapter, browser and scene/preset.
- Warmup and shader compilation frames are separated from steady-state measurements.
- Same-commit before/after comparisons use interleaved A/B runs when the machine is known to show bimodal state.
- A faster run with fewer pixels is valid only if the pixel-count change is explicitly part of the optimization and visual parity is tested at that operating state.

## 4. Primary optimization strategy

Apply work in this order unless profiling disproves it:

1. remove work that produces no visible pixel or state change;
2. remove avoidable CPU allocation/upload churn;
3. avoid creating/compiling heavy GPU resources before they are needed;
4. make runtime quality knobs actually reduce underlying work;
5. reduce full-screen/post-processing cost without changing the accepted image;
6. improve ray-integrator efficiency with equal or tighter error;
7. introduce spatial workload classification for expensive strong-field passes;
8. use temporal reuse only after deterministic single-frame equivalence is proven;
9. move CPU-only work off the main thread where measured;
10. treat whole-renderer worker/OffscreenCanvas migration as experimental, not a default rewrite.

## 5. Workstream WS0 — measurement foundation before optimization

### 5.1 Extend per-frame telemetry

Add a stable local/debug performance snapshot including:

- CPU frame delta;
- last resolved GPU render-pass duration when available;
- internal width/height and effective pixel count;
- renderer backend;
- quality tier and render scale;
- activity mode;
- destination and preset;
- transition phase and overlay opacity;
- render reason bitmask;
- whether destination update ran;
- whether destination draw ran;
- whether post-present ran;
- renderer.info render frameCalls/drawCalls/triangles/points/lines;
- renderer.info compute frameCalls;
- renderer.info memory total plus programs/textures/renderTargets/storage attributes;
- active ResourceScope estimated bytes;
- volume march configuration;
- particle active/drawn population;
- active lensing pass kind and max-step budget;
- selected integrator debug counters when available.

Three.js Renderer.info exposes per-frame draw-call and memory information and should be used alongside the repository's explicit ResourceScope estimates rather than replacing them.

### 5.2 Per-pass timing attribution

Where the renderer/backend safely permits it, distinguish:

- destination main pass;
- nested volume pass(es);
- particle compute;
- post/bloom;
- hyperspace;
- final present.

Do not block the CPU on timestamp readback. Resolve asynchronously on a bounded cadence.

### 5.3 New benchmark matrix

Every production destination gets at least:

- cold navigation timing;
- warm navigation timing;
- stationary scene;
- active timeline/animation;
- camera interaction;
- settling;
- transition into and out of destination;
- low/medium/high/ultra where meaningful;
- WebGPU;
- forced WebGL2 capable hardware.

Heavy strong-field destinations additionally get controlled internal resolutions and numerical diagnostics.

### 5.4 Baseline artifact

Before changing runtime behavior, write a new benchmark baseline set under benchmarks/results with:

- exact starting SHA;
- hardware/browser metadata;
- median/p90/p95/p99;
- GPU time where available;
- renderer.info;
- estimated GPU memory;
- cold/warm compile latency;
- screen captures/golden references where applicable.

Acceptance: no implementation workstream can claim a percentage improvement without this baseline.

## 6. Workstream WS1 — render invalidation and on-demand steady-state frames

This is the highest-value cross-project optimization because an unchanged image does not need to be redrawn.

### 6.1 Current issue

atlasApp drives one rAF loop and host.frame performs the canonical update/render pipeline every visible frame. The architecture is correct for active animation but it means stationary, paused scenes can continue consuming GPU even when the visual state is unchanged.

### 6.2 Introduce an explicit render-reason model

Add a host-owned invalidation/reason bitset such as:

- TIME_ADVANCED;
- CAMERA_CHANGED;
- CAMERA_SETTLING;
- CONTROL_CHANGED;
- DESTINATION_CHANGED;
- ASSET_READY;
- RESIZE;
- QUALITY_CHANGED;
- TRANSITION_CHANGED;
- POST_CHANGED;
- DEBUG_CHANGED;
- FORCED_CAPTURE.

A destination may declare whether it has continuous animation independent of the shared atlas clock. Most current production modules do not need hidden wall-clock animation; their visible evolution is already frame/time driven.

### 6.3 Scheduler behavior

- If the document is visible and a reason requires a frame, update/render normally.
- If the scene is paused, camera settled, transition idle, no control/asset/post/quality change occurred and the destination declares no continuous animation, skip destination update, destination draw and post-present.
- Wake immediately on user input, timeline play, scrub, controls, route change, resize, quality change or async asset completion.
- Maintain a tiny UI/status cadence only where the DOM genuinely needs it.
- Do not turn the main rAF scheduler into arbitrary fixed-FPS throttling for active animation.

### 6.4 Page visibility

Use Page Visibility as an explicit policy layer:

- hidden: stop expensive atlas frames and nonessential polling;
- visible resume: reset delta/timing history so background throttling is not interpreted as slow hardware;
- invalidate one frame on resume;
- preserve simulation semantics according to TimeController policy.

Browsers already pause most background rAF callbacks, but explicit visibility handling is still required for timers, governor correctness and predictable resume.

### 6.5 Acceptance

- A paused, settled deterministic destination should approach zero destination GPU frames between invalidations.
- First input after idle must respond without perceptible delay.
- All goldens stay within existing tolerances.
- No transition, scrub, flare, waveform or moving-observer state may freeze incorrectly.

## 7. Workstream WS2 — transition occlusion: never render pixels guaranteed to be hidden

### 7.1 Current opportunity

TransitionDirector snapshots the outgoing frame and uses a full-screen hyperspace overlay. After the occlusion handoff, the incoming destination can become active while the transition overlay is still fully opaque. In that interval, the incoming scene may perform update/render work whose pixels cannot contribute to the presented image.

### 7.2 Occlusion contract

TransitionDirector should expose an explicit visual-occlusion state to the kernel.

When the overlay is guaranteed opaque:

- do not render a destination solely to generate pixels hidden by the overlay;
- continue only state updates that are required for timeline correctness;
- allow async prepare and shader precompile;
- render the hyperspace overlay and necessary final composite only;
- resume destination draw before opacity falls enough for the destination to contribute.

Do not use a magic opacity threshold that causes popping. Use a mathematically safe opaque state from the transition envelope.

### 7.3 Precompile during occlusion

Use Three.js Renderer.compileAsync for the incoming visible subgraph during the opaque window where practical. Its explicit purpose is avoiding first-use shader compilation stutter.

Rules:

- compile only resources expected to be visible on arrival;
- do not compile every alternate backend/phase resource just because it exists;
- compile failures must fall back safely;
- measure whether precompile overlaps useful transition time or merely shifts work.

### 7.4 Hyperspace resolution research

The full-screen hyperspace effect is motion-heavy and currently has its own render target. Research a tier/activity resolution scale for the overlay.

This is NOT pre-approved. It may ship only if:

- transition goldens/perceptual captures remain accepted;
- no visible edge breakup or chromatic aliasing appears on target displays;
- measured GPU savings are meaningful.

## 8. Workstream WS3 — startup and module-loading architecture

### 8.1 Current asymmetry

Galaxy Collision already demonstrates the desired pattern: a lightweight descriptor/preset module whose descriptor.load dynamically imports the heavy implementation.

The atlas bootstrap still imports the full black-hole destination module and full neutron-star module during registry setup to obtain metadata. This can pull substantial shader/physics code into startup even before those implementation paths are required.

### 8.2 Normalize lightweight descriptors

Split each heavy destination into:

- lightweight descriptor/preset/catalog module;
- heavyweight implementation module loaded by descriptor.load.

Apply particularly to:

- black-hole;
- neutron-star.

Verify all other destinations retain the lightweight pattern.

### 8.3 Startup measurement

Measure:

- main JS requested/transferred bytes;
- parse/evaluation duration;
- renderer init;
- registry init;
- initial destination module fetch;
- LUT fetch/decode;
- first useful frame;
- first interactive frame.

Do not add a bundler plugin to production solely for measurement if Vite/Rollup output and existing tooling can provide equivalent data.

### 8.4 Prefetch policy

Optional route-aware prefetch:

- after first interactive frame and only during idle;
- prefetch one likely next lightweight chunk;
- never preconstruct GPU passes during idle unless benchmarked beneficial;
- obey connection/data-saving constraints if browser signals are used.

## 9. Workstream WS4 — black-hole backend lifecycle: stop creating three heavy passes at once

### 9.1 Proven current behavior

BlackHoleModule.prepare currently:

1. loads the Schwarzschild LUT family best-effort;
2. creates numerical Schwarzschild pass;
3. creates LUT Schwarzschild pass when assets support it;
4. creates numerical Kerr pass;
5. adds all passes to the scene;
6. render selects exactly one and hides the others.

Draw-time visibility is correct, but setup/residency/compiler work is broader than the displayed result.

### 9.2 Replace eager pass set with active-pass lifecycle

Implement an ActiveLensingPassManager scoped to the destination.

Responsibilities:

- determine requested metric/backend before construction;
- instantiate only the selected pass for first arrival;
- retain LUT data separately from pass GPU material/geometry;
- lazy-create an alternate pass only on an actual backend/metric change;
- optionally retain the most recently used alternate under a small bounded cache to avoid toggle thrash;
- dispose dormant pass resources after an evidence-based idle/memory policy;
- preserve setUniformsFromState contract;
- preserve failure/fallback reason reporting.

### 9.3 Pipeline warmup

When the user initiates a control switch:

- create/compile the requested alternate pass before committing visual handoff where feasible;
- keep currently visible pass until replacement is ready;
- avoid presenting an intermediate wrong metric;
- do not compile Kerr just because a Schwarzschild preset is loaded.

### 9.4 Acceptance

- selected backend visual output unchanged;
- backend-switch tests remain deterministic;
- no extra black frame;
- lower first-arrival program/resource count;
- lower memory/program count for default Schwarzschild;
- measured cold-arrival improvement or memory reduction.

## 10. Workstream WS5 — volume service: make quality reductions reduce actual march work

### 10.1 Proven current behavior

VolumeService builds a TSL loop with a compile-time literal derived from config.baseMaxSteps at volume creation.

setStepScale changes sample spacing at runtime, but it does not change the loop's compile-time trip bound. Therefore a governor tier drop does not necessarily reduce ALU work in proportion to the intended quality change.

The service also allocates a new THREE.Vector2 inside renderHalfRes each marched frame and forces proxy frustum culling off.

### 10.2 Runtime active-step budget

Research and implement one of two validated designs:

Preferred A — one compiled upper-bound loop with a uniform active-step count and an early Break/guard.

Alternative B — a small tier-specialized set of precompiled volume materials/passes.

Requirements:

- active step count must actually reduce executed density/emission evaluations;
- sample span remains correctly normalized to the analytic ray-volume interval;
- quality changes do not accidentally sample beyond bounds;
- early-alpha termination remains;
- deterministic paused frames remain stable;
- no temporal jitter is introduced unless separately validated.

### 10.3 Projected-bounds work reduction

Volumes are bounded analytically. Add conservative screen-space/proxy culling:

- allow ordinary frustum culling when safe bounds can be supplied;
- skip march when effective gain/opacity is zero;
- research scissor/viewport restriction to projected volume bounds;
- ensure camera-inside-volume and very large bounds cases remain correct.

### 10.4 Allocation cleanup

- reuse a scratch Vector2 for renderer size;
- avoid per-frame object allocation in service hot path;
- avoid redundant setSize or uniform writes when unchanged.

### 10.5 Affected destinations

- stellar explosion ejecta;
- compact merger ejecta;
- tidal disruption shock;
- quasar/AGN corona;
- quasar/AGN torus.

## 11. Workstream WS6 — particles, ribbons and dynamic-buffer updates

### 11.1 Particle service

Current CPU fallback can iterate/upload broad particle state on update. Population scale controls draw count but is not itself a service-level simulation stop.

Add explicit simulation/activity semantics:

- if active drawn population is zero, do no simulation;
- static particle systems can declare STATIC and never run per-frame simulation/upload after initialization;
- CPU fallback should update only the population whose deterministic state is required;
- population growth must preserve deterministic state through reset/fast-forward rules;
- WebGPU compute stays authoritative where selected;
- do not dispatch compute when no particle state can change.

### 11.2 Proven AGN waste

Quasar/AGN host-star and jet-knot particle systems use zero emitter speed and effectively static million-second lifetimes, preferCompute false, yet are updated every frame while the GALACTIC zone is visible.

Convert these to static GPU point populations: initialize/reset once and do not simulate/upload each frame.

Also remove the duplicate hostParticles.setPopulationScale call in applyStateToResources.

### 11.3 Ribbon service

RibbonService rewrites position/color buffers whenever setSpine is called and disables frustum culling.

Actions:

- callers must not call setSpine if model time/control inputs have not changed;
- cache last spine revision/time at module level;
- add conservative bounding sphere/box updates at a lower cadence or after actual spine change so culling can be enabled;
- profile resamplePolyline allocations when over-capacity;
- do not micro-optimize ribbon math where destination GPU cost is already sub-millisecond unless CPU profiles justify it.

## 12. Workstream WS7 — post-processing and full-screen presentation

### 12.1 SharedPost facts

SharedPost already does several things correctly:

- one central HDR target;
- bloom is removed from graph when disabled;
- graph rebuild is cached by inputs;
- tone mapping is centralized.

Preserve those properties.

### 12.2 Skip unchanged present

WS1 invalidation should prevent full-screen present when nothing changed.

### 12.3 Bloom resolution scale

Three.js BloomNode exposes setResolutionScale and bloom renders once per frame. Add a controlled research track:

- profile bloom separately;
- test lower bloom resolution during interaction and possibly all steady-state tiers;
- preserve exact bloom strength/radius/threshold semantics;
- validate against destination goldens with bloom enabled in dedicated captures, because the existing deterministic golden harness disables bloom for physics-focused images.

Do not claim "same visuals" based only on physics goldens that disable bloom.

### 12.4 Render-target formats

Do not downgrade HDR format merely for speed without a separate visual/dynamic-range study. RGBA16F is part of the current display contract.

## 13. Workstream WS8 — governor becomes workload-aware, not merely resolution-aware

### 13.1 Current strength

The governor already uses hysteresis, activity state and destination work multipliers. Keep one central controller.

### 13.2 Add knob bundle

A tier/action should resolve to a centralized WorkBudget:

- render scale;
- effective DPR cap;
- strong-field max steps;
- volume active steps;
- volume internal scale;
- particle population/cadence where visually allowed;
- bloom resolution scale;
- transition overlay resolution scale;
- optional ribbon sample budget;
- optional field-line detail only if approved by visual parity.

Each destination consumes the same WorkBudget API, not custom independent policies.

### 13.3 CPU vs GPU diagnosis

Use available telemetry to classify overload:

- GPU-bound: first reduce pixel/fragment-heavy work;
- CPU-bound: first reduce simulation/upload/DOM/allocation work;
- compilation/loading spike: do not permanently demote quality;
- background/resume spike: reset measurement window;
- thermal sustained slowdown: allow normal hysteresis to adapt.

### 13.4 Settled fidelity recovery

Quality can drop aggressively during active interaction but should recover gradually after settling if performance headroom exists.

The final stationary result must reach the same declared quality target as before on hardware that can sustain it.

## 14. Workstream WS9 — Schwarzschild full-screen ray paths

Schwarzschild has two production paths: numerical and LUT.

### 14.1 LUT

The LUT is the normal optimized path and currently near the target frame budget on the measured machine.

Optimize conservatively:

- eliminate redundant per-frame CPU state assembly when camera/controls unchanged;
- ensure only active pass exists;
- prebind/cached static uniforms where possible;
- profile texture/filtering cost before changing format;
- preserve LUT validation/checksum/domain behavior.

### 14.2 Numerical Schwarzschild

Current documented GPU time around 40 ms at the reference internal size means it remains expensive.

Research:

- earlier safe escape/capture termination;
- runtime step-count census and MAX_STEPS heatmaps;
- screen/tile difficulty classification;
- far-field analytic/LUT-assisted shortcut only where error is proven;
- adaptive stepping with fixed reference comparison;
- critical-region specialization.

Never make numerical Schwarzschild secretly use the LUT when the user/test explicitly requests the numerical backend unless the contract is intentionally redesigned and parity/debug truth remains explicit.

## 15. Workstream WS10 — Kerr: primary GPU optimization program

Kerr is the dominant performance problem and deserves a dedicated scientific-performance campaign.

### 15.1 Preserve correctness-first baseline

Keep existing reference tests, convergence requirements, classification and moving-observer behavior.

### 15.2 Required telemetry

Add/aggregate:

- steps per pixel distribution;
- capture/escape/disk-hit/failure/MAX_STEPS fractions;
- radial/angular turning counts where practical;
- high-spin tail distribution;
- moving-observer step distribution;
- optional tile-level difficulty summary.

### 15.3 Optimization ladder

Execute in this order and benchmark each independently.

#### K1. Redundant math and uniform-state caching

- cache camera basis/state records when unchanged;
- avoid duplicate matrix normalization/array construction;
- hoist loop-invariant shader terms;
- continue common-subexpression elimination only with operation-order/parity review.

#### K2. Safe termination

- improve escape proof;
- horizon/capture termination;
- disk-hit finalization;
- numerical failure early exit.

Each must be validated against a higher-cost reference.

#### K3. Adaptive integration

Research error-driven/adaptive stepping that performs fewer Hamiltonian/RK evaluations for equal error. Preserve clamps around horizon, turning points and disk crossings.

#### K4. Constants-of-motion / separated-equation formulation

The existing Kerr research plan already identifies constants-of-motion/separated equations as a candidate. Prototype against the current integrator, not as a blind replacement.

Acceptance requires:

- classification convergence;
- disk hit/radius agreement;
- escape direction agreement;
- redshift agreement;
- spin-zero convergence;
- moving-observer compatibility;
- failure rate no worse;
- measured GPU reduction.

#### K5. Tile/difficulty classification

Use a cheap coarse pass to classify screen regions:

- easy far-field;
- likely captured;
- disk-intersection dominant;
- critical/high-winding.

Only expensive regions receive the full high-cost path. Avoid seams by conservative overlap/guard bands.

#### K6. Progressive stationary refinement

Only after single-frame correctness is stable, research rendering lower-cost interaction frames followed by stationary refinement. This must not create ghosting around the photon ring/disk or misrepresent a moving observer.

### 15.4 Explicit non-solution

Do not solve Kerr performance by simply reducing the validated step budget until the image looks acceptable. That hides difficult rays and violates the scientific contract.

## 16. Workstream WS11 — neutron star

Current structure is already efficient relative to Kerr: one surface-ray pass, static field-line geometry rotated cheaply, scratch vectors reused.

Optimize targeted areas:

- cache camera basis/uniform payload when camera and relevant physical state are unchanged;
- skip update/render entirely under WS1 stationary pause;
- add conservative screen-space early ray rejection outside the projected star plus lensing margin;
- improve surface-ray early hit/escape termination;
- investigate active-step/difficulty classification using the same methodology as Schwarzschild;
- keep field lines static and rotate object transform rather than rebuilding geometry;
- compile only the neutron-star surface pass when destination is actually requested.

Acceptance: NS_SURFACE, NS_PULSAR, NS_MAGNETAR goldens and surface-ray reference tests unchanged.

## 17. Workstream WS12 — stellar explosion

Observed hardware cost is already low relative to strong-field scenes. Prioritize zero-risk shared wins:

- WS1 stationary invalidation;
- WS5 actual volume active-step scaling;
- skip volume completely before it is visible;
- skip particle simulation when hidden/paused;
- avoid repeated visibility/step writes when state unchanged;
- optional lazy phase-resource creation only if cold-start/memory profiling shows material benefit.

Preserve temporal jitter OFF for deterministic paused presentation unless a separate accumulation design proves parity.

## 18. Workstream WS13 — compact merger

Existing phase gating is good. Preserve it.

Actions:

- shared volume active-step fix;
- particle update only when active and time advances;
- trail/spine rebuild only when time or relevant state changes;
- no repeated setVisible/setStepScale if value unchanged;
- consider lazy late-phase resource creation only if memory/startup data justifies complexity.

Do not trade the already-vsync-floor scene for unnecessary architecture complexity.

## 19. Workstream WS14 — tidal disruption

Existing phase gating is also good.

Actions:

- update bound/unbound stream ribbons only when timeline/model time changes;
- reuse cached orbit/gate results where camera unchanged;
- shared volume active-step and projected-bounds culling;
- particle updates only with nonzero population and active time;
- retire late/early phase resources when a long-lived destination session makes this profitable, but avoid transition thrash.

Current ultra 1080p shock characterization was already near the vsync floor on the campaign hardware, so treat this as low-risk work elimination rather than a fidelity-reduction target.

## 20. Workstream WS15 — Quasar/AGN

### 20.1 What is already correct

Only the active zone is visible and only GALACTIC simulation-bearing particles are updated. Existing benchmark data shows the zone architecture successfully avoids paying inner-GR cost at large scales.

### 20.2 Improvements

- convert static host/jet-knot particles to initialize-once static systems;
- remove duplicate population-scale call;
- lazy-build only the initial zone;
- prewarm an adjacent zone when zoom approaches hysteresis boundary and the main thread/GPU are idle;
- dispose distant zones under memory pressure/cooldown;
- do not create INNER lensing and both volumes just because the user arrives directly in GALACTIC;
- ensure zone switches have no visible build hitch using compileAsync/prewarm.

Acceptance: AGN_INNER_ENGINE, AGN_NUCLEAR, AGN_RADIO_GALAXY, AGN_BLAZAR_VIEW unchanged and doubleRenderGuard stays OK.

## 21. Workstream WS16 — black-hole merger

### 21.1 Proven current issue

prepare constructs the remnant Kerr lensing pass even when the destination begins in inspiral and remnantGroup is invisible.

### 21.2 Phase-lazy remnant

- build inspiral resources for inspiral entry;
- create/precompile Kerr remnant before the timeline reaches ringdown/remnant;
- when user deep-links directly to ringdown/remnant, build Kerr immediately;
- use idle/pretransition time for prewarm where possible;
- release inspiral-only resources after a sufficiently irreversible phase progression only if back-scrub semantics are handled; otherwise keep cheap inspiral resources.

### 21.3 Trail CPU work

Only rebuild trails when model time changes. Paused ringdown/remnant should not perform inspiral trail work.

### 21.4 Kerr sharing

All Kerr integrator algorithm improvements from WS10 must automatically benefit the remnant pass without creating a second divergent Kerr implementation.

Acceptance: all five BHM goldens and dataset/timeline parity remain green.

## 22. Workstream WS17 — galaxy collision

### 22.1 Proven current waste

galaxyCollisionModule.update always calls applyPhase.

applyPhase:

- interpolates the entire tracer position buffer on CPU;
- marks the whole position attribute needsUpdate;
- allocates two new Float32Array(3) center buffers;
- constructs a fresh probe array;
- performs this even when the timeline phase has not changed.

### 22.2 Immediate exact optimizations

- cache last applied phase/model time/revision;
- when unchanged, do nothing;
- preallocate center scratch arrays;
- preallocate/reuse probe storage;
- upload tracer/nucleus buffers only after a real phase change;
- preserve exactly the same interpolation equation and dataset.

### 22.3 Optional GPU interpolation prototype

After the exact cleanup is measured, prototype a GPU path storing adjacent keyframes and interpolating position in the vertex/compute path using scalar s.

This is optional because it trades CPU bandwidth for GPU memory/bind complexity.

Acceptance requires:

- coordinate parity within documented float tolerance;
- no data-driven semantic change;
- lower CPU/upload time at realistic tracer counts;
- no harmful memory increase.

### 22.4 Worker preprocessing

Checksum/decode/data preparation may move to a worker if navigation profiles show main-thread stalls. Use transfer semantics carefully; do not duplicate multi-megabyte buffers unnecessarily.

## 23. Workstream WS18 — CPU allocation and state-write hygiene across the repository

The source sweep found a generally good scratch-object discipline, but remaining hot-path allocations/writes should be removed where they occur every frame.

Mandatory examples:

- VolumeService per-frame Vector2;
- Galaxy Collision per-frame center arrays and probe array;
- repeated creation of plain state arrays/records in strong-field render methods where revision caching can safely reuse values;
- redundant DOM writes at the 4 Hz atlas UI cadence when text value is unchanged;
- timers/polling must not keep expensive work alive when document hidden.

Do not turn one-time prepare-time allocations into obscure object pools. Optimize sustained hot paths only.

## 24. Workstream WS19 — culling and region-of-interest rendering

Three.js ordinary object frustum culling cannot help a full-screen lensing pass, but it can help bounded secondary systems.

Audit every object currently forced frustumCulled=false.

Classify:

1. full-screen triangle: keep uncullable;
2. world-space particles: compute conservative bounds or keep uncullable only with evidence;
3. ribbons: update bounds on spine revision;
4. volumes: conservative proxy/projected bounds;
5. hyperspace fullscreen: keep uncullable while active.

For full-screen geodesic shaders, "culling" means early per-pixel/tile classification, not Object3D frustum culling.

## 25. Workstream WS20 — WebGL2 fallback-specific optimization

Do not tune only WebGPU.

Measure each optimization on forced WebGL2 because:

- TSL compilation behavior differs;
- compute path may become CPU fallback;
- software implementations can amplify shader loop cost dramatically;
- WebGL2 driver/compiler limits may make giant dynamic loops worse.

Policy:

- no new WebGPU-only baseline requirement;
- use alternate implementation only when fallback semantics remain equivalent;
- keep explicit unsupported/fallback messaging;
- prioritize avoiding construction/compilation of unused heavy shaders because this helps both APIs.

## 26. Workstream WS21 — workers and OffscreenCanvas: research gate, not default architecture

OffscreenCanvas can run rendering in a worker and WebGPU contexts are available in worker-capable implementations, but GPUCanvasContext support remains uneven across widely used browsers.

Therefore:

Phase 1 acceptable worker targets:
- dataset checksum/decode;
- CPU reference calculations;
- expensive offline-ish preparation;
- data transforms with transferable buffers.

Phase 2 experiment only:
- whole renderer worker/OffscreenCanvas.

Do not migrate renderer ownership to a worker unless profiling proves the main thread is the blocking resource after the lower-risk workstreams. Moving command submission does not make a GPU-bound Kerr shader faster.

## 27. Quality-preservation validation matrix

Every accepted optimization maps to at least one gate.

### Gate A — static visual parity

Run the existing 43-image golden suite on capable WebGPU hardware, twice-stable.

### Gate B — WebGL2 behavioral parity

Run forced-WebGL2 behavioral/parity coverage. Add targeted captures only where backend visual parity must be evaluated.

### Gate C — scientific numerical parity

Run:

- Schwarzschild integrator/reference;
- LUT equivalence;
- Kerr reference/convergence/characteristics;
- moving-observer photon/tetrad/worldline;
- neutron-star surface ray;
- black-hole merger dataset;
- galaxy collision interpolation;
- all physics unit suites.

### Gate D — performance

For the exact benchmark scenario:

- before/after same pixel count unless resolution itself is the tested optimization;
- median and p95 must not regress outside noise;
- expected work counter must fall for "strictly less work" optimizations;
- cold/warm distinction reported;
- GPU timestamps used where available.

### Gate E — lifecycle

Repeated navigation, preset switching, backend switching and transition torture:

- ResourceScope returns to expected counts;
- renderer.info programs/textures/renderTargets/storage buffers stay bounded;
- no increasing memory staircase;
- no stale async prepare;
- no device-loss regressions.

### Gate F — interaction

- camera input latency;
- rapid route changes;
- rapid scrubbing;
- pause/play;
- visibility hide/resume;
- reduced-motion transition;
- resize/high-DPR;
- quality-tier churn.

## 28. Performance targets

Targets are product goals, not permission to falsify fidelity.

### 28.1 General destinations

On capable modern discrete/integrated hardware:

- aim for <=16.7 ms total frame at normal interactive quality;
- <=33.3 ms usable fallback on constrained devices;
- stationary paused scenes should render only on invalidation;
- no ordinary route transition should create a long main-thread stall.

### 28.2 Strong-field

Kerr may not reach 60 Hz at the highest scientific quality on all hardware.

The goal is:

- large reduction in median/p95 cost at equal accepted error;
- stable interaction through governed temporary work reduction;
- progressive return to intended settled fidelity;
- no hidden numerical-failure increase.

### 28.3 Startup

Set numeric startup targets only after WS0 baseline. Do not invent a threshold without the current bundle/network measurements.

## 29. Required new tests

At minimum add tests for:

- no-render-on-unchanged stationary frame;
- render wakes on each invalidation reason;
- hidden/resume resets governor timing;
- opaque transition suppresses hidden destination draw;
- incoming shader precompile does not change visible handoff;
- black-hole first load creates only active lensing pass;
- backend switch lazily creates exactly required pass;
- volume runtime active-step count actually changes density/emission evaluation count in a testable harness;
- zero-population/static particle systems perform no simulation dispatch/update;
- AGN static particles remain visually identical;
- paused TDE/CM/BHM ribbons do not rewrite buffers;
- galaxy collision unchanged phase performs no interpolation/upload/allocation;
- lazy AGN/BHM resources deep-link correctly to late zones/phases;
- renderer.info/resource counts return to bounded baseline after torture navigation.

## 30. Implementation sequence

Execute in this order.

### Campaign A — evidence and zero-visual-risk work

A1. WS0 telemetry/bench baseline.
A2. Hot allocation cleanup.
A3. Galaxy Collision unchanged-phase gate + scratch buffers.
A4. AGN static particles + duplicate call fix.
A5. Caller-side pause/time-revision gates for ribbons/particles.
A6. Page visibility timing hygiene.

Expected result: lower CPU/idle work with essentially no shader/scientific risk.

### Campaign B — frame and transition work elimination

B1. host invalidation model.
B2. stationary on-demand rendering.
B3. opaque transition destination-draw suppression.
B4. compileAsync incoming visible path.
B5. post-present skip on unchanged frame.

Expected result: major idle/power savings and reduced transition overlap.

### Campaign C — lifecycle/startup

C1. lightweight black-hole descriptor split.
C2. lightweight neutron-star descriptor split.
C3. lazy black-hole active pass.
C4. phase/zone-lazy AGN and BHM.
C5. bounded prewarm/cache policy.

Expected result: faster startup/cold navigation, lower program/memory residency.

### Campaign D — shared GPU services

D1. VolumeService active-step redesign.
D2. volume projected bounds / zero-gain skip.
D3. particle activity/static mode.
D4. ribbon conservative bounds.
D5. bloom resolution research.

Expected result: cross-destination fragment/compute savings.

### Campaign E — strong-field algorithmic optimization

E1. numerical telemetry/step census.
E2. Schwarzschild safe exits.
E3. Kerr safe exits.
E4. Kerr adaptive stepping.
E5. Kerr formulation prototype.
E6. tile/difficulty classifier.
E7. stationary refinement research.

Each substep is independently benchmarked and revertible.

### Campaign F — fallback, thermal and final certification

F1. forced WebGL2 regression/performance passes.
F2. prolonged 15–30 minute thermal/adaptive runs.
F3. mobile/high-DPR checks on available devices.
F4. full golden/numeric/lifecycle suites.
F5. release performance report and updated budgets.

## 31. Priority ledger

### P0 — do first

- measurement baseline;
- stationary invalidation/on-demand rendering;
- opaque-transition hidden-draw suppression;
- lazy black-hole active pass;
- volume active-step correctness/performance;
- Kerr optimization telemetry and algorithmic work.

### P1 — high value

- startup descriptor split;
- AGN static particles;
- BHM phase-lazy Kerr;
- galaxy collision unchanged-phase/upload cleanup;
- renderer.info telemetry;
- compileAsync prewarm;
- per-destination knob bundle.

### P2 — evidence dependent

- bloom lower-resolution pass;
- projected/scissored volume rendering;
- GPU galaxy interpolation;
- tile/difficulty strong-field classifier;
- temporal stationary refinement.

### P3 — research only unless profiles justify

- full renderer OffscreenCanvas worker;
- extensive object pooling;
- broad architecture rewrite;
- new compression/texture formats solely for speed.

## 32. File-impact map for the executor

Likely central files:

- src/app/atlasApp.ts — scheduler, visibility, UI polling;
- src/atlas/host.ts — frame invalidation, lifecycle, registry loading;
- src/atlas/TransitionDirector.ts — occlusion contract and prewarm windows;
- src/atlas/governor.ts — WorkBudget;
- src/atlas/types.ts — invalidation/work-budget/service contracts;
- src/renderer/SharedRendererKernel.ts — skip logic, telemetry, pass attribution;
- src/renderer/shared/SharedPost.ts — present/bloom scaling;
- src/renderer/shared/VolumeService.ts — active steps and ROI;
- src/renderer/shared/ParticleService.ts — static/zero-population activity;
- src/renderer/shared/RibbonService.ts — culling/buffer revisions;
- src/renderer/shared/LensingService.ts — pass lifecycle/telemetry support;
- src/atlas/destinations/blackHoleDestination.ts — active pass manager;
- src/phenomena/black-hole/kerr/kerrIntegrator.ts — Kerr hot loop;
- src/phenomena/black-hole/lut/lensingGpu.ts — LUT/numerical supporting path;
- src/phenomena/black-hole/schwarzschildIntegrator.ts — numerical path;
- src/phenomena/neutron-star/surfaceLensingGpu.ts and neutronStarModule.ts;
- every phenomenon module listed in sections 17–22;
- tests/unit and tests/browser — new invariants/gates;
- scripts/bench-*.mjs — benchmark schema;
- docs/PERFORMANCE.md, PERFORMANCE_BUDGETS.md and cosmic-atlas performance docs — final evidence.

Do not assume this list means untouched runtime files are out of scope. The executor must re-run a repository-wide search after each architectural change for duplicated loops/contracts/call sites.

## 33. Rollback rules

Revert or redesign an optimization if any of these occur:

- unexplained golden drift;
- higher numerical failure/MAX_STEPS fraction;
- scientific parity regression;
- new transition black frame/pop;
- resource count grows after repeated navigation;
- WebGL2 fallback breaks;
- performance win exists only in one unrepeatable run;
- CPU time improves but GPU time or interaction latency regresses enough to erase user benefit;
- complexity rises materially for a sub-1% gain with no power/memory benefit.

## 34. Stop rules

Stop optimizing a destination when:

- its measured cost is already below the target on representative hardware;
- it is no longer a meaningful share of the frame;
- further improvement requires fidelity risk disproportionate to benefit.

Continue optimizing shared/strong-field paths while they dominate real user-visible latency.

## 35. Definition of done

This OpenSpec is complete only when all of the following are true:

1. all eight production destinations have current before/after benchmark evidence;
2. stationary paused rendering performs no unnecessary continuous destination draw;
3. fully occluded transition intervals do not draw hidden destinations;
4. default black-hole does not eagerly construct unused numerical/LUT/Kerr passes;
5. runtime volume quality reduction measurably reduces march work;
6. static/zero-population particle systems do not simulate unnecessarily;
7. galaxy collision does not interpolate/upload unchanged frames;
8. startup loads heavy destination implementations on demand;
9. Kerr shows a meaningful reproducible equal-fidelity improvement or every attempted algorithmic optimization is documented with evidence explaining why it was rejected;
10. existing visual goldens remain accepted without opportunistic tolerance widening;
11. numerical/scientific parity remains green;
12. WebGPU and forced-WebGL2 behavioral gates are green on capable environments;
13. resource counts remain bounded through navigation torture;
14. a final performance certification records the exact SHA, hardware, browser, per-destination numbers, memory/program counts, remaining bottlenecks and explicit limitations.

## 36. External research references

Use current primary documentation during implementation:

- Three.js Renderer, including compileAsync and renderer capabilities:
  https://threejs.org/docs/pages/Renderer.html
- Three.js Info, including per-frame draw/compute and memory metrics:
  https://threejs.org/docs/pages/Info.html
- Three.js BloomNode, including setResolutionScale:
  https://threejs.org/docs/pages/BloomNode.html
- Three.js cleanup/resource lifecycle:
  https://threejs.org/manual/en/cleanup.html
- Three.js object/draw-call optimization guidance:
  https://threejs.org/manual/en/optimize-lots-of-objects.html
- MDN Page Visibility API:
  https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- MDN requestAnimationFrame:
  https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- Chrome WebGPU timestamp-query guidance:
  https://developer.chrome.com/blog/new-in-webgpu-121
- MDN OffscreenCanvas:
  https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- MDN GPUCanvasContext:
  https://developer.mozilla.org/en-US/docs/Web/API/GPUCanvasContext

Repository sources remain authoritative for project-specific scientific contracts:
docs/PERFORMANCE.md, docs/PERFORMANCE_BUDGETS.md, docs/KERR_RESEARCH_PLAN.md, docs/RENDERING_PIPELINE.md, docs/cosmic-atlas/PERFORMANCE_HARDWARE.md, docs/cosmic-atlas/GOLDEN_IMAGES.md and the physics/reference tests.

## 37. Executor directive

Treat this document, proposal.md, design.md, tasks.md and specs/whole-atlas-performance/spec.md as one change set.

Do NOT jump directly to Kerr shader surgery.

Start by proving where time goes. Land small, measurable, revertible steps. After every optimization:

1. run the narrow correctness tests;
2. run the matched benchmark;
3. compare work counters and frame timing;
4. run the relevant visual/scientific gate;
5. commit evidence;
6. only then continue.

The objective is not "some faster frames." The objective is a Cosmic Atlas that wastes as little compute as practical while retaining the visual and scientific experience that made the project worth building.
