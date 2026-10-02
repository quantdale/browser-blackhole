# Design: Whole-Atlas performance optimization

## 1. Design thesis

The project has two distinct optimization problems:

1. avoidable orchestration/setup/state work that can be removed with near-zero visual risk;
2. inherently expensive per-pixel relativistic integration that requires scientifically validated algorithmic improvement.

Mixing them is dangerous. The implementation must land the first category before touching the second so benchmark changes are attributable.

## 2. Frame scheduling design

Introduce host-owned invalidation.

The host remains the single authority that decides when destination update/render/post work occurs. Destinations expose only enough metadata to state whether continuous visual evolution is required.

A frame is required when any visual dependency revision advances:

- atlas time;
- camera;
- destination controls;
- async asset readiness;
- quality/work budget;
- transition envelope;
- post configuration;
- viewport;
- forced capture/debug.

When none changed and the current destination is visually static, the existing canvas is the correct presentation and no GPU frame is required.

This design preserves one rAF source. It does not create one rAF per destination.

## 3. Transition occlusion design

TransitionDirector owns the mathematical opacity state. SharedRendererKernel must not infer occlusion from arbitrary alpha comparisons.

Expose a field such as destinationVisibility = visible | partially-occluded | fully-occluded.

When fully occluded:

- destination state update may continue if required;
- destination draw is skipped;
- overlay draw/present continues;
- incoming compileAsync may execute asynchronously.

When partially occluded, normal destination draw resumes.

## 4. Active-pass design for black hole

Replace the eager pass tuple with a manager keyed by semantic pass identity:

- schwarzschild-numerical;
- schwarzschild-lut;
- kerr-numerical.

The manager owns:

- current handle;
- pending handle;
- optional one-entry recent handle;
- creation promise with cancellation generation;
- pass-specific ResourceScope child;
- compile/warm state;
- fallback reason.

Switch algorithm:

1. normalize control state;
2. resolve semantic target pass;
3. if current matches, update uniforms only;
4. otherwise build pending in a child scope;
5. compile pending while current remains visible when possible;
6. atomically swap;
7. release prior handle immediately or after short bounded cache policy;
8. emit debug/lifecycle telemetry.

The LUT asset family is data, not a rendered pass. It may stay in a bounded cache independently.

## 5. WorkBudget design

The governor resolves one WorkBudget object per effective tier/activity state. Suggested fields:

- renderScale;
- dprCap;
- strongFieldMaxSteps;
- volumeActiveSteps;
- volumeInternalScale;
- particlePopulationScale;
- particleUpdateDivisor;
- bloomResolutionScale;
- transitionResolutionScale;
- ribbonSampleScale.

Not every destination must consume every field. A field that changes scientific meaning must have explicit acceptance bounds.

The governor responds to measured overload but destinations never instantiate private controllers.

## 6. Volume design

Current baseMaxSteps is a shader loop literal. Runtime stepScale cannot guarantee less loop work.

Preferred redesign:

- compile a bounded MAX loop appropriate to the volume class;
- provide uActiveSteps;
- inside loop, break when loop index reaches active steps;
- compute dt from span / activeSteps, adjusted by any separately named accuracy scale;
- preserve early-alpha break;
- keep a deterministic jitter policy;
- skip entire nested render if invisible or effective emission/opacity is zero;
- reuse scratch size vector;
- optionally set conservative bounds.

If TSL/WebGL2 compilers produce worse code for the dynamic active-step break, fall back to a small tier-material cache. That choice must be benchmarked on both WebGPU and WebGL2.

## 7. Particle design

Extend ParticleSystemHandle with explicit activity semantics rather than relying solely on instanceCount.

Possible modes:

- dynamic;
- static;
- paused.

Static system:
- seeded/init once;
- no per-frame compute/CPU integration;
- no buffer upload unless reset/state changes.

Dynamic zero-population:
- no compute/update dispatch;
- deterministic state policy documented for later population increase.

CPU fallback should avoid O(capacity) work when only a smaller deterministic active population is required, but state-revival correctness takes priority.

## 8. Revision-based CPU updates

For expensive CPU-generated buffers, track input revision.

Examples:

- galaxy phase/modelTime revision;
- TDE stream revision;
- compact-merger trail time revision;
- BHM trail time revision;
- camera-basis revision;
- UI text revision.

If inputs are identical, do not recalculate and do not mark BufferAttribute.needsUpdate.

## 9. Startup loading design

Registry metadata must not require importing heavyweight implementations.

Each destination exports descriptor/preset metadata from a lightweight module. descriptor.load performs the heavy dynamic import.

Initial boot loads:

- atlas shell;
- registry metadata;
- only the routed destination implementation;
- only assets required by that implementation.

Optional idle prefetch occurs after first-interactive and never blocks it.

## 10. Post-processing design

SharedPost remains centralized.

Add:

- invalidation integration so present is skipped if frame unchanged;
- telemetry around bloom;
- optional BloomNode resolution scale driven by WorkBudget.

Because standard physics goldens disable bloom, create a separate bloom-enabled visual gate before shipping a bloom-resolution change.

## 11. Strong-field optimization design

Strong-field work uses a strict ladder:

A. instrument;
B. remove redundant CPU/uniform work;
C. safe shader termination;
D. adaptive integration;
E. alternative validated formulation;
F. spatial/tile classification;
G. temporal/progressive reuse.

Every step gets a reference comparison. No step may be combined with a tolerance change in the same commit.

## 12. Kerr formulation prototypes

Alternative Kerr formulations must live behind a development selection until validated.

Required comparison dimensions:

- captured/escaped/disk/failure classification;
- final escape direction;
- disk hit radius;
- redshift;
- spin-zero convergence;
- high-spin near-critical cases;
- moving-observer cases;
- p50/p95/p99 step counts;
- GPU timing.

The current implementation remains fallback until replacement superiority is demonstrated.

## 13. Spatial classification design

A classifier may be fragment/tile/compute based.

Rules:

- conservative classification;
- guard bands around critical boundaries;
- no visible seams;
- difficult/uncertain pixels always escalate to the trusted path;
- classification overhead must be smaller than saved integration work.

Do not assume a compute pass is faster than the existing fullscreen fragment route.

## 14. Resource-lifecycle design

All new lazy resources get explicit ResourceScope children.

A lazy resource state machine must support:

- not-created;
- creating;
- ready;
- active;
- dormant;
- disposed;
- creation-aborted.

Stale async work must dispose its scope and never become visible.

ResourceManager remains bounded. renderer.info supplements scope estimates with renderer-observed memory/program counts.

## 15. WebGL2 design constraints

Every new dynamic-loop, compileAsync, lazy material and WorkBudget feature must be exercised on WebGL2.

Where WebGL2 compiler behavior diverges:

- prefer a small specialized material set over a giant dynamic shader;
- keep shared scientific equations;
- expose backend-specific implementation only where necessary;
- do not silently skip an effect.

## 16. Worker design

Workers are approved for CPU-only workloads after measurement.

Whole-renderer worker migration is a separate experiment because:

- the project is GPU-bound on its worst scene;
- worker command submission cannot reduce shader ALU;
- GPUCanvasContext availability is not universal;
- DOM/UI integration complexity and fallback risk are high.

## 17. Observability design

Add a debug performance panel/snapshot, not telemetry upload.

No analytics service is required.

The local snapshot should be serializable into benchmark JSON so the UI, automated harness and human investigation use one schema.

## 18. Compatibility with current tests

Existing tests are preserved.

New behavior must not make goldens depend on arbitrary sleep. Golden harness continues using deterministic pause/scrub/camera-settle controls.

On-demand rendering must expose a test-only forceFrame/invalidate hook so deterministic capture can request exactly one final frame without reintroducing continuous rendering.

## 19. Decision policy

For each optimization record:

- hypothesis;
- changed files;
- expected reduced work;
- correctness risk;
- benchmark scenario;
- before;
- after;
- visual result;
- scientific result;
- WebGL2 result;
- keep/revert decision.

This prevents a future agent from accumulating unverified "optimizations."
