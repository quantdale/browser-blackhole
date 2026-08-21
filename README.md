# browser-blackhole

An interactive browser-based black-hole renderer and general-relativity visualization built around Three.js, WebGPU, and GPU ray tracing.

## Project intent

The project should become both a visually compelling interactive black-hole experience and a technically credible relativistic renderer. It must remain usable in an ordinary modern browser, scale quality to available GPU capability, and clearly distinguish physically meaningful parameters from cinematic controls.

The renderer is intentionally staged:

1. establish a reliable Three.js/WebGPU application and full-screen GPU render path;
2. implement and validate a true Schwarzschild null-geodesic renderer;
3. add a physically motivated accretion disk, redshift, Doppler effects, HDR, and post-processing;
4. optimize the non-rotating renderer using adaptive integration, temporal techniques, dynamic resolution, and eventually precomputed ray/beam lookup tables;
5. add a Kerr renderer and observer motion only after Schwarzschild correctness and performance are proven.

Do not start by building a black sphere with ordinary meshes and calling the surrounding distortion “lensing.” The central visual problem is photon propagation through curved spacetime; Three.js is the application/rendering framework around that GPU calculation.

## Autonomous agent quick start

A fresh coding agent starts with **[`.agent/START_HERE.md`](.agent/START_HERE.md)**. Long-running sessions follow **[`.agent/EXECUTION_PROTOCOL.md`](.agent/EXECUTION_PROTOCOL.md)** and report checkpoints with **[`.agent/CHECKPOINT_TEMPLATE.md`](.agent/CHECKPOINT_TEMPLATE.md)**.

The durable current milestone and continuation point is **[`.agent/STATE.md`](.agent/STATE.md)**. No originating chat context is required.

## Documentation map

### Agent control plane

- [`AGENTS.md`](AGENTS.md) — repository-wide operating contract.
- [`.agent/START_HERE.md`](.agent/START_HERE.md) — executable fresh-agent handoff.
- [`.agent/EXECUTION_PROTOCOL.md`](.agent/EXECUTION_PROTOCOL.md) — long-session work selection, evidence, sub-agent, commit, and handoff rules.
- [`.agent/STATE.md`](.agent/STATE.md) — current milestone, evidence, blockers, and next actions.
- [`.agent/QUALITY_GATES.md`](.agent/QUALITY_GATES.md) — cumulative gates.
- [`.agent/CHECKPOINT_TEMPLATE.md`](.agent/CHECKPOINT_TEMPLATE.md) — required checkpoint evidence format.

### Product and architecture

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — product scope and outcomes.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — locked architecture/product decisions.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — target module/runtime architecture.
- [`docs/STATE_SCHEMA.md`](docs/STATE_SCHEMA.md) — canonical application state, validation, presets, invalidation.
- [`docs/SHADER_CONTRACTS.md`](docs/SHADER_CONTRACTS.md) — CPU/GPU/TSL interfaces and debug outputs.
- [`docs/RENDERING_PIPELINE.md`](docs/RENDERING_PIPELINE.md) — render passes and image formation.

### Physics and numerical correctness

- [`docs/PHYSICS.md`](docs/PHYSICS.md) — scientific model/conventions.
- [`docs/NUMERICAL_METHODS.md`](docs/NUMERICAL_METHODS.md) — tetrad mapping, Hamiltonian equations, integration, event detection, convergence.
- [`docs/VALIDATION_VECTORS.md`](docs/VALIDATION_VECTORS.md) — deterministic analytic/reference scenarios.
- [`docs/KERR_RESEARCH_PLAN.md`](docs/KERR_RESEARCH_PLAN.md) — deferred rotating-hole research/implementation constraints.
- [`docs/LUT_BACKEND_SPEC.md`](docs/LUT_BACKEND_SPEC.md) — optimized Schwarzschild precomputation/backend contract.

### UX and visual controls

- [`docs/UI_UX.md`](docs/UI_UX.md) — interaction/layout/accessibility principles.
- [`docs/UI_CONTROL_CATALOG.md`](docs/UI_CONTROL_CATALOG.md) — control-by-control semantics and safety.

### Performance and diagnostics

- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — optimization strategy.
- [`docs/PERFORMANCE_BUDGETS.md`](docs/PERFORMANCE_BUDGETS.md) — frame budgets, DPR, dynamic resolution, temporal/memory policy.
- [`docs/BENCHMARK_MATRIX.md`](docs/BENCHMARK_MATRIX.md) — reproducible benchmark presets/metadata/reporting.
- [`docs/OBSERVABILITY_DIAGNOSTICS.md`](docs/OBSERVABILITY_DIAGNOSTICS.md) — runtime telemetry, probes, debug events.
- [`docs/FAILURE_RECOVERY.md`](docs/FAILURE_RECOVERY.md) — device loss, unsupported paths, numerical/data failures.

### Testing, CI, deployment, provenance

- [`docs/TESTING.md`](docs/TESTING.md) — overall testing strategy.
- [`docs/CI_CD.md`](docs/CI_CD.md) — CI jobs, browser/golden automation, release pipeline.
- [`docs/DEPLOYMENT_COMPATIBILITY.md`](docs/DEPLOYMENT_COMPATIBILITY.md) — browser/deployment policy.
- [`docs/ASSET_PROVENANCE.md`](docs/ASSET_PROVENANCE.md) — licensing, external data/assets, security/privacy rules.
- [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) — dependency/version/tooling policy.
- [`docs/RESEARCH_REFERENCES.md`](docs/RESEARCH_REFERENCES.md) — primary references/prior art.

### Execution plan

- [`docs/IMPLEMENTATION_PLAYBOOK.md`](docs/IMPLEMENTATION_PLAYBOOK.md) — concrete implementation workflow.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — M0–M11 integration sequence.
- [`docs/MILESTONE_WORK_PACKETS.md`](docs/MILESTONE_WORK_PACKETS.md) — detailed executable packets for every milestone.
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — stable `BH-*` backlog units.
- [`docs/PARALLEL_WORK.md`](docs/PARALLEL_WORK.md) — safe sub-agent ownership boundaries.
- [`docs/DEFINITION_OF_DONE.md`](docs/DEFINITION_OF_DONE.md) — evidence required to call work complete.

## Proposed stack

- TypeScript
- Vite
- Three.js
- `WebGPURenderer`
- Three.js Shading Language (TSL), targeting WebGPU and WebGL2-compatible fallback where practical
- Vitest for deterministic unit/reference physics tests
- Playwright for browser/E2E/visual checks
- optional Rust/WASM reference/precomputation tooling later; never the primary per-pixel renderer

Dependency versions are deliberately not pinned in the planning-only bootstrap. M0 verifies current compatible releases, pins exact versions, commits the lockfile, and records the selection.

## Non-negotiable engineering rules

- GPU-first per-pixel rendering; no JavaScript pixel loops.
- Numerical Schwarzschild correctness before LUT optimization or Kerr.
- Physics equations/conventions have independent reference tests.
- Scientific controls and cinematic controls remain visibly separate.
- Mass/scale handling must preserve normalized GR scale invariance.
- Numerical failure is explicit and never painted as the black-hole shadow.
- WebGPU-only accelerators degrade explicitly; fallback claims must be tested truthfully.
- Compute shaders and Workers are introduced only for a measured algorithmic/runtime reason.
- Every milestone ends with a buildable, evidence-backed checkpoint.
- External code/assets/data require provenance/license review.
- Performance claims include backend, internal resolution, quality settings, hardware/browser, and frame-time statistics.

## Current status

**Planning/bootstrap complete; implementation has not started.** The durable state is `READY_FOR_IMPLEMENTATION` at **M0 — Repository and rendering foundation**. Start with `.agent/START_HERE.md`.