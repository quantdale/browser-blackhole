# Durable project state

Last planning update: 2026-08-21

## Current phase

**READY_FOR_IMPLEMENTATION — M0 Repository and rendering foundation**

The repository has an implementation blueprint but intentionally contains no application code yet. A coding agent can begin M0 immediately.

## Locked architectural direction

- Browser-first interactive relativistic black-hole renderer.
- TypeScript + Vite + Three.js.
- Three.js `WebGPURenderer` and TSL as primary rendering stack.
- Full-screen GPU ray rendering; Three.js is not used to fake lensing with geometry.
- Schwarzschild first, Kerr later.
- Numerical Schwarzschild integration is the first correctness renderer.
- Precomputed/LUT Schwarzschild rendering is a later optimization backend, not the starting point.
- Fragment/full-screen rendering is the primary ray path; compute is introduced only where it improves the algorithm.
- Optional CPU/Rust/WASM physics code is a reference/validation/precomputation tool, not the main image renderer.
- Scientific controls and cinematic/rendering controls remain separate.
- Auto quality, render-scale caps, GPU/CPU telemetry, and progressive refinement are planned first-class features.

## Immediate next actions

1. Execute `M0` from `docs/ROADMAP.md`.
2. Initialize the pinned TypeScript/Vite/Three.js project and lockfile.
3. Create the target directory structure from `docs/ARCHITECTURE.md` without adding speculative subsystems.
4. Establish formatting/lint/typecheck/unit/build scripts.
5. Boot `WebGPURenderer`, capability detection, device-loss handling, and a visible diagnostic full-screen TSL shader.
6. Add minimal camera + OrbitControls and a deterministic browser smoke test.
7. Record exact dependency versions and test evidence here.

## Current blockers

None known.

## Evidence available

- Repository began essentially empty, making this a greenfield architecture.
- Research references and prior art are catalogued in `docs/RESEARCH_REFERENCES.md`.

## Completion rule for M0

Do not advance STATE to M1 until a clean checkout can install dependencies, typecheck, test, build, launch, and render the deterministic diagnostic scene in the target Chromium browser without uncaught console errors.

## Handoff update format

After each milestone, replace this section with:

- current milestone/status;
- exact commit SHA;
- completed acceptance criteria;
- commands run and results;
- browser/GPU tested;
- known limitations;
- deferred debt;
- next three actions.
