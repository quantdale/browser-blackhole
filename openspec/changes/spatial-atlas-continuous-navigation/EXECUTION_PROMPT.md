# EXECUTION PROMPT — Spatial Atlas Continuous Navigation

You are the implementation integrator for `quantdale/browser-blackhole`.

Your mission is to execute the `spatial-atlas-continuous-navigation` OpenSpec to completion without weakening the repository's scientific, performance, compatibility, resource-lifecycle or evidence standards.

## Mandatory prerequisite check

Before editing runtime behavior:

1. Read `.agent/START_HERE.md`.
2. Inspect whether `whole-atlas-performance-optimization` is still active.
3. If it is still active and modifying shared runtime, DO NOT begin overlapping Spatial runtime implementation. Limit work to planning/non-overlapping research or switch to the branch/sequence authorized by the repository state.
4. If it is complete, record the final performance-certified SHA and re-audit host/governor/transition/kernel APIs against `MASTER_PLAN.md`.

## Mandatory reading

Read:

1. `MASTER_PLAN.md`
2. `design.md`
3. `proposal.md`
4. `tasks.md`
5. `RESEARCH_BASIS.md`
6. repository `AGENTS.md`
7. `.agent/EXECUTION_PROTOCOL.md`
8. `.agent/QUALITY_GATES.md`
9. `.agent/STATE.md`
10. `docs/cosmic-atlas/ARCHITECTURE.md`
11. `docs/cosmic-atlas/DECISIONS.md`
12. `docs/cosmic-atlas/PRODUCT_UX_AND_TRANSITIONS.md`
13. `docs/cosmic-atlas/PERFORMANCE_HARDWARE.md`
14. `docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md`
15. final performance certification.

## Architectural non-negotiables

- Do not rewrite existing destination physics.
- Do not turn the local `CameraRig` into the astronomical navigator.
- Do not upload absolute astronomical coordinates naïvely as f32.
- Do not use one literal unit/scene from compact-object scale to Mpc.
- Keep one renderer.
- Keep one heavy destination active.
- Keep ResourceScope lifecycle.
- Keep global quality authority.
- Keep WebGL2 fallback.
- Keep existing routes.
- Never fake a real sky position for a reference/generic simulation.
- Real, historical, reference and conceptual entities must remain distinguishable.
- Scientific data is source-locked/offline-built.
- No old test/golden is weakened merely to land Spatial UX.
- Do not change global depth-buffer mode without a separate ADR and complete evidence.

## Execution discipline

Follow SA0 → SA12 dependency order.

For each packet:

1. identify invariant;
2. inspect current implementation;
3. add deterministic test/probe first where practical;
4. implement the smallest vertical slice;
5. run narrow tests;
6. run impacted cumulative gates;
7. record resource/performance evidence where relevant;
8. update docs/state;
9. commit coherent checkpoint.

## Parallelization

Parallel work is allowed only where write ownership does not overlap.

Safe:
- coordinate math;
- source/catalog tooling;
- isolated UI;
- test harness;
- standalone proxy rendering.

Single-owner:
- host;
- TransitionDirector;
- renderer kernel;
- global governor;
- route/state schema;
- production app shell.

## First production handoff

Use Black Hole as the first continuous Explorer→local handoff because it is the flagship and has the strongest validated renderer boundaries.

Second: Neutron Star.

Do not attempt all eight simultaneously before proving the contract.

## Data truthfulness

For every spatial entity answer:

- Is it a real object?
- A historical event?
- A reference simulation?
- A conceptual lab?
- What is the coordinate frame?
- What is the epoch?
- What is the source?
- Does the linked renderer represent the exact object, a representative model, or only a related concept?

If these cannot be answered, the entity does not get a production physical-space marker.

## Performance

Explorer must remain lightweight.

Benchmark:
- CPU transform/layout;
- GPU pass;
- draw calls;
- labels;
- catalog payload/parse;
- handoff latency;
- resource peak/plateau.

Use the final performance campaign's invalidation/on-demand scheduling.

Do not add OffscreenCanvas or compute unless a measured bottleneck justifies it.

## Stop conditions

Stop dependent work and record the blocker if:

- coordinate source cannot be validated;
- precision is unstable;
- continuous handoff requires changing scientific output;
- compatibility breaks without a valid fallback;
- resource counts grow unbounded;
- the only way to make a test pass is to weaken it;
- performance result is noise or negative;
- another active campaign owns the same central files.

## Completion

Complete only when:

- all eight current destinations are honestly represented in the new discovery model;
- direct routes still work;
- core spatial entry/exit is seamless;
- precision gates pass;
- source/provenance gates pass;
- full existing destination tests/parity/goldens pass;
- Explorer browser/golden/performance tests pass;
- WebGPU/WebGL2 contracts remain true;
- accessibility/mobile are certified;
- P0/P1 = 0;
- final Spatial performance/release report exists;
- `.agent/STATE.md` and `.agent/START_HERE.md` point to the correct next state.