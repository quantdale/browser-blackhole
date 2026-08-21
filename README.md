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

Do not start by building a black sphere with ordinary meshes and calling the surrounding distortion "lensing." The central visual problem is photon propagation through curved spacetime; Three.js is the application/rendering framework around that GPU calculation.

## Autonomous agent quick start

A fresh coding agent can begin immediately with:

**[`.agent/START_HERE.md`](.agent/START_HERE.md)**

That file contains the executable handoff prompt and points to the current milestone in `.agent/STATE.md`. No originating chat context is required.

## Required reading

1. [`AGENTS.md`](AGENTS.md) — repository operating contract.
2. [`.agent/STATE.md`](.agent/STATE.md) — durable current state and next milestone.
3. [`.agent/QUALITY_GATES.md`](.agent/QUALITY_GATES.md) — cumulative completion gates.
4. [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — product scope and user-visible requirements.
5. [`docs/DECISIONS.md`](docs/DECISIONS.md) — locked architecture/product decisions.
6. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — target software/rendering architecture.
7. [`docs/PHYSICS.md`](docs/PHYSICS.md) — scientific conventions and correctness rules.
8. [`docs/RENDERING_PIPELINE.md`](docs/RENDERING_PIPELINE.md) — GPU rendering design.
9. [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — optimization strategy and profiling requirements.
10. [`docs/UI_UX.md`](docs/UI_UX.md) — controls, modes, presets, interaction, accessibility.
11. [`docs/TESTING.md`](docs/TESTING.md) — correctness, visual, browser, and performance gates.
12. [`docs/ROADMAP.md`](docs/ROADMAP.md) — M0–M11 milestone sequence and exit criteria.
13. [`docs/BACKLOG.md`](docs/BACKLOG.md) — concrete `BH-*` implementation work packets.
14. [`docs/PARALLEL_WORK.md`](docs/PARALLEL_WORK.md) — safe sub-agent/parallel boundaries.
15. [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) — dependency/version/tooling policy.
16. [`docs/DEPLOYMENT_COMPATIBILITY.md`](docs/DEPLOYMENT_COMPATIBILITY.md) — browser/deployment policy.
17. [`docs/RESEARCH_REFERENCES.md`](docs/RESEARCH_REFERENCES.md) — primary references and prior art.

## Proposed stack

- TypeScript
- Vite
- Three.js
- `WebGPURenderer`
- Three.js Shading Language (TSL), using WGSL/WebGPU and a WebGL2-capable fallback where practical
- Vitest for deterministic unit/physics tests
- Playwright for browser/E2E/visual checks
- Optional Rust/WASM reference solver later; never use CPU/WASM as the primary per-pixel renderer

Dependency versions are deliberately not pinned in the planning-only bootstrap. Milestone M0 must check the current stable versions, pin exact compatible versions, create the lockfile, and record the choices.

## Non-negotiable engineering rules

- GPU-first per-pixel rendering; no JavaScript pixel loops.
- Correctness before optimization; optimization must be measured.
- Scientific controls and cinematic controls remain visibly separate.
- Mass is represented consistently; normalized and physical-distance modes must not imply false scale dependence.
- Schwarzschild must be validated before Kerr.
- WebGPU-only accelerators must degrade gracefully rather than making the whole app unusable on WebGL2-capable fallback paths.
- Every milestone ends with a buildable, runnable, documented checkpoint.
- Any copied/adapted external implementation must receive an explicit license/provenance review first.

## Current status

Planning/bootstrap only. No application code has been implemented yet. The next executable milestone is **M0 — Repository and rendering foundation** in [`docs/ROADMAP.md`](docs/ROADMAP.md).
