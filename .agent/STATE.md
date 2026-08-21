# Durable project state

Last planning update: 2026-08-21

## Current phase

**READY_FOR_IMPLEMENTATION — M0 Repository and rendering foundation**

No application code has been implemented yet. The repository now contains a detailed product, physics, numerical, renderer, performance, CI, UI, recovery, provenance, and agent-execution blueprint sufficient for a fresh autonomous coding agent to begin M0 without originating chat context.

## Locked architectural direction

- Browser-first interactive relativistic black-hole renderer.
- TypeScript + Vite + Three.js.
- Three.js `WebGPURenderer` and TSL as primary rendering stack.
- Full-screen GPU ray rendering; Three.js is not used to fake lensing with geometry.
- Schwarzschild first, Kerr later.
- Numerical Schwarzschild integration is the first correctness renderer.
- Precomputed/LUT Schwarzschild rendering is a later optimization backend, not the starting point.
- Fragment/full-screen rendering is the primary ray path; compute is introduced only where it improves the algorithm.
- CPU/reference solver is double-precision validation/precomputation, not main image rendering.
- Schwarzschild production/reference conventions are specified in `docs/NUMERICAL_METHODS.md`.
- Canonical state/invalidation and GPU contracts are specified before UI implementation.
- Scientific controls and cinematic/rendering controls remain separate.
- Auto quality, DPR caps, telemetry, dynamic resolution, and temporal refinement are first-class features.
- Numerical failures remain explicit and are never merged into the physical shadow.
- External code/assets/data require provenance/license review.

## Immediate next actions

Execute detailed M0 work packets in `docs/MILESTONE_WORK_PACKETS.md`:

1. `M0-01` — resolve/pin current compatible toolchain/dependency versions and create lockfile;
2. `M0-02` — initialize strict Vite/TypeScript source skeleton;
3. `M0-03` — implement capability snapshot and `WebGPURenderer` startup/fallback status;
4. `M0-04` — deterministic full-screen diagnostic TSL pass;
5. `M0-05` — camera abstraction + OrbitControls + canonical basis;
6. `M0-06` — resize/internal resolution/DPR policy hook;
7. `M0-07` — schema-v1 canonical state/default preset/invalidation skeleton;
8. `M0-08` — Vitest/Playwright/scripts/CI baseline;
9. `M0-09` — visible initialization/unsupported/error UX;
10. `M0-10` — run M0 exit gates and persist evidence.

## Required implementation references for M0

- `.agent/START_HERE.md`
- `.agent/EXECUTION_PROTOCOL.md`
- `.agent/QUALITY_GATES.md`
- `docs/IMPLEMENTATION_PLAYBOOK.md`
- `docs/ARCHITECTURE.md`
- `docs/STATE_SCHEMA.md`
- `docs/SHADER_CONTRACTS.md`
- `docs/DEPENDENCIES.md`
- `docs/CI_CD.md`
- `docs/FAILURE_RECOVERY.md`
- `docs/DEPLOYMENT_COMPATIBILITY.md`

## Current blockers

None known.

## Current gate status

- Gate A Repository health: NOT YET EXECUTED — no application/toolchain yet.
- Gate B Browser health: NOT YET EXECUTED.
- Gate C Physics correctness: NOT YET APPLICABLE until M2, except unit convention planning complete.
- Gate D Visual correctness: NOT YET APPLICABLE until M1+.
- Gate E Performance: NOT YET APPLICABLE until renderer exists; budgets defined.
- Gate F Compatibility: NOT YET EXECUTED.
- Gate G Release: NOT YET APPLICABLE.

## Planning evidence available

- Repository began essentially empty, allowing greenfield architecture.
- Primary research/prior art catalogued in `docs/RESEARCH_REFERENCES.md`.
- Numerical Schwarzschild equations/event policy specified in `docs/NUMERICAL_METHODS.md`.
- Validation corpus defined in `docs/VALIDATION_VECTORS.md`.
- Performance budgets/benchmark schema defined.
- LUT and Kerr future backends have explicit entry gates and research constraints.
- M0–M11 have detailed work packets and Definition of Done.

## Completion rule for M0

Do not advance STATE to M1 until a clean checkout can install exact dependencies, run deterministic quality commands, build, launch, render the deterministic diagnostic scene, operate camera/resize safely, expose actual backend status, and pass browser smoke in the available supported target environment without uncaught errors.

## Future state update format

After implementation starts, maintain:

- current milestone/status;
- exact commit SHA;
- completed packet/backlog IDs;
- quality-gate status;
- exact commands/tests and results;
- browser/backend/GPU environment actually tested;
- screenshot/fixture/benchmark artifact paths;
- known limitations/debt with severity;
- deferred environment gates;
- next 3–7 concrete actions.