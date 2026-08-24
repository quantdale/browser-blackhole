# browser-blackhole

An interactive browser-based **Cosmic Atlas**: one shared Three.js/WebGPU runtime hosting a curated set of astrophysical destinations connected by a cinematic hyperspace transition system. The flagship destination is a full general-relativity Schwarzschild black-hole renderer (backwards ray tracing through curved spacetime on the GPU).

## What is implemented

The application is **implemented and running** — this is no longer a planning repository. Current production destinations, reachable from the top-bar navigation and deep-linkable at `/atlas/<route>`:

| Destination | Route | Scientific state |
| --- | --- | --- |
| Black Hole | `/atlas/black-hole` | Full numerical Schwarzschild backwards ray tracer (GPU f32 integrator, CPU binary64 oracle) with thin accretion disk, HDR pipeline, production presets. An optimized **LUT trajectory backend** (validated precomputed family, `docs/LUT_BACKEND_ADR.md`) is now the measured **auto default**; numerical remains explicitly selectable and every fallback is truthful. |
| Neutron Star | `/atlas/neutron-star` | Compact-surface ray tracing, gravitational redshift, hot spots, pulsar/magnetar presets, dipole field lines. |
| Stellar Explosion | `/atlas/stellar-explosion` | PROCEDURAL_SCIENTIFIC reduced core-collapse/hypernova/long-GRB models on shared GPU volume/particle services. |
| Compact Merger | `/atlas/compact-merger` | NS–NS binary inspiral (closed-form quadrupole GW decay law — DIRECT reduced model), contact/merger transition, two-component kilonova, short-GRB bipolar jet with beaming-inspired viewing response, scenario-based remnants. PROCEDURAL_SCIENTIFIC post-merger; not NR/hydrodynamics. |
| Tidal Disruption | `/atlas/tidal-disruption` | Star–black-hole encounter: closed-form parabolic Kepler orbit (Barker timing — DIRECT reduced model), tidal-tensor deformation proxy, energy-spread debris family on Newtonian Kepler orbits (bound/unbound split, differential winding), circularization shock ring, procedural nascent-disk transition. PROCEDURAL_SCIENTIFIC; not SPH/GRMHD/NR, no GR apsidal precession; stellar disc rendered at a disclosed exaggerated radius. |

A developer `Diagnostic` destination (Debug mode) exercises the host lifecycle.

## Testing

```bash
npm ci                 # exact lockfile install
npm run check          # format + lint + typecheck + unit tests + build
npm run e2e            # Playwright browser suite (incl. visual goldens)
npm run lut:validate -- public/luts/schwarzschild-v1-415dea94
npm run bench:black-hole        # numerical-vs-LUT frame-time harness
npm run bench:compact-merger    # phase-aware merger harness (--phase=...)
npm run bench:tidal-disruption  # phase-aware TDE harness (--phase=...)
```

Unit/reference tests: Vitest (`npm run test`). Browser/E2E/goldens: Playwright (`npm run e2e`). Visual goldens live in `tests/browser/goldens/` and are NEVER regenerated merely to go green (`docs/cosmic-atlas/GOLDEN_IMAGES.md`).

## Current development continuation point

The durable milestone state, evidence, and next actions live in **[`.agent/STATE.md`](.agent/STATE.md)** — currently: M8 (Schwarzschild LUT backend) **CLOSED** with a measured auto-default policy; CA5 (Compact Merger) and CA6 (Tidal Disruption) **implemented end-to-end**; next milestone per `docs/cosmic-atlas/ROADMAP.md`.

## Autonomous agent quick start

A fresh coding agent starts with **[`.agent/START_HERE.md`](.agent/START_HERE.md)**. Long-running sessions follow **[`.agent/EXECUTION_PROTOCOL.md`](.agent/EXECUTION_PROTOCOL.md)** and report checkpoints with **[`.agent/CHECKPOINT_TEMPLATE.md`](.agent/CHECKPOINT_TEMPLATE.md)**.

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
- [`docs/LUT_BACKEND_ADR.md`](docs/LUT_BACKEND_ADR.md) — LUT backend design, decision criterion, measured outcome.

### Cosmic Atlas

- [`docs/cosmic-atlas/README.md`](docs/cosmic-atlas/README.md) — Atlas entry point.
- [`docs/cosmic-atlas/ROADMAP.md`](docs/cosmic-atlas/ROADMAP.md) — CA0–CA12 integration sequence.
- [`docs/cosmic-atlas/WORK_PACKETS.md`](docs/cosmic-atlas/WORK_PACKETS.md) — executable packets per CA milestone.
- [`docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md`](docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md) — per-destination models and fidelity.
- [`docs/cosmic-atlas/GOLDEN_IMAGES.md`](docs/cosmic-atlas/GOLDEN_IMAGES.md) — visual regression baselines.
- [`docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md`](docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md) — control vocabulary per destination.

### Performance and diagnostics

- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — optimization strategy.
- [`docs/BENCHMARK_MATRIX.md`](docs/BENCHMARK_MATRIX.md) — reproducible benchmark presets/metadata/reporting.
- [`docs/OBSERVABILITY_DIAGNOSTICS.md`](docs/OBSERVABILITY_DIAGNOSTICS.md) — runtime telemetry, probes, debug events.
- [`docs/FAILURE_RECOVERY.md`](docs/FAILURE_RECOVERY.md) — device loss, unsupported paths, numerical/data failures.

### Testing, CI, deployment, provenance

- [`docs/TESTING.md`](docs/TESTING.md) — overall testing strategy.
- [`docs/CI_CD.md`](docs/CI_CD.md) — CI jobs, browser/golden automation, release pipeline.
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

## Stack

- TypeScript
- Vite
- Three.js (`WebGPURenderer` + TSL; WebGL2 fallback where features allow)
- Vitest for deterministic unit/reference physics tests
- Playwright for browser/E2E/visual goldens

Dependency versions are pinned exactly in `package.json` + lockfile.

## Non-negotiable engineering rules

- GPU-first per-pixel rendering; no JavaScript pixel loops.
- Physics equations/conventions have independent reference tests.
- Scientific controls and cinematic controls remain visibly separate.
- Mass/scale handling must preserve normalized GR scale invariance.
- Numerical failure is explicit and never painted as the black-hole shadow.
- WebGPU-only accelerators degrade explicitly; fallback claims must be tested truthfully.
- Compute shaders and Workers are introduced only for a measured algorithmic/runtime reason.
- Every milestone ends with a buildable, evidence-backed checkpoint.
- External code/assets/data require provenance/license review.
- Performance claims include backend, internal resolution, quality settings, hardware/browser, and frame-time statistics.
- Reduced/procedural phenomenon models are labeled with their fidelity class; no live NR/MHD claims.

## Current status

**Implemented.** Cosmic Atlas host + five production destinations; M8 closed with a measured LUT auto-default policy; CA5 Compact Merger and CA6 Tidal Disruption complete. See `.agent/STATE.md` for exact evidence and the next milestone.
