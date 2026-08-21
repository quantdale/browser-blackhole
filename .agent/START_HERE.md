# Start here — autonomous implementation prompt

Use this file as the first instruction for a fresh coding agent.

## Mission

Implement `browser-blackhole` from the repository blueprint into a production-quality interactive browser black-hole renderer. Work autonomously, preserve scientific correctness, keep each checkpoint buildable, use evidence rather than appearance to prove correctness/performance, and maintain durable project state so another fresh agent can continue without chat history.

## Authority order

When instructions conflict, use this order:

1. actual repository/code/test evidence;
2. `AGENTS.md` and explicit user instructions;
3. `.agent/STATE.md` current phase;
4. locked `docs/DECISIONS.md` / physics conventions;
5. milestone/quality-gate documents;
6. lower-level planning notes.

If actual state contradicts docs, investigate and repair docs rather than blindly following stale text.

## Required first read

Read completely before editing:

1. `AGENTS.md`;
2. `.agent/STATE.md`;
3. `.agent/EXECUTION_PROTOCOL.md`;
4. `.agent/QUALITY_GATES.md`;
5. current milestone section of `docs/ROADMAP.md`;
6. matching milestone section of `docs/MILESTONE_WORK_PACKETS.md`;
7. `docs/DEFINITION_OF_DONE.md`.

Then read domain specs required by the packet. For initial M0 also read:

- `docs/IMPLEMENTATION_PLAYBOOK.md`;
- `docs/ARCHITECTURE.md`;
- `docs/STATE_SCHEMA.md`;
- `docs/SHADER_CONTRACTS.md`;
- `docs/DEPENDENCIES.md`;
- `docs/CI_CD.md`;
- `docs/FAILURE_RECOVERY.md`;
- `docs/DEPLOYMENT_COMPATIBILITY.md`.

Before M2 physics work, additionally read `PHYSICS.md`, `NUMERICAL_METHODS.md`, and `VALIDATION_VECTORS.md` completely. Before M6 read the performance/benchmark docs. Before M8 read `LUT_BACKEND_SPEC.md`. Before M9 read `KERR_RESEARCH_PLAN.md` and perform the required ADR/research rather than coding Kerr from memory.

## Repository inspection

Before writing code:

- inspect branch and `git status`;
- inspect recent commits;
- inspect current source/tests/configuration;
- verify `.agent/STATE.md` matches reality;
- identify current packet IDs and acceptance evidence.

Do not ask the user to repeat information already encoded in the repository.

## Execute now

Begin at the exact milestone named in `.agent/STATE.md`. Initially this is **M0 — Repository and rendering foundation**.

Execute M0 packets in `docs/MILESTONE_WORK_PACKETS.md`, normally in dependency order:

`M0-01 -> M0-02 -> M0-03 -> M0-04 -> M0-05 -> M0-06 -> M0-07 -> M0-08 -> M0-09 -> M0-10`.

Parallelize only independent bounded work under `docs/PARALLEL_WORK.md`; the main agent integrates and validates.

## M0 concrete outcome

A clean checkout must be able to:

1. install exact dependencies from lockfile;
2. format/lint/typecheck/test/build successfully;
3. launch over the supported local dev origin;
4. initialize Three.js `WebGPURenderer` with explicit backend/capability status;
5. render a deterministic full-screen TSL diagnostic frame;
6. reconstruct/transport camera basis through a small abstraction with OrbitControls;
7. resize safely with bounded effective DPR/internal resolution;
8. load normalized schema-v1 AppState/default preset;
9. show useful unsupported/failure UX instead of blank canvas;
10. pass Playwright smoke without uncaught page/console failures;
11. report the backend actually used;
12. leave `.agent/STATE.md` with exact evidence and M1 next packets.

Do not implement speculative black-hole physics during M0 merely to make the demo exciting.

## Hard constraints

- Do not implement the scientific renderer as a black sphere plus arbitrary UV distortion.
- Do not ray trace production pixels on the CPU.
- Do not begin Kerr before Schwarzschild gates pass.
- Do not use Worker/compute merely because it sounds faster.
- Do not hide `MAX_STEPS`, NaN, or invalid state as captured/shadow pixels.
- Do not silently change units, metric signature, momentum orientation, radiometric convention, or spin convention.
- Do not let controls write shader uniforms outside canonical validated state mapping.
- Do not loosen tolerances/update goldens solely to obtain green tests.
- Do not claim fallback/browser/GPU validation that did not actually execute.
- Do not copy reference code/assets without provenance/license review.

## Checkpoint requirement

At each coherent checkpoint use `.agent/CHECKPOINT_TEMPLATE.md`. Persist the continuation-critical subset in `.agent/STATE.md`.

Record exact commands, result counts/status, browser/backend actually tested, screenshots/fixtures/benchmarks when relevant, known debt, deferred-environment gates, commit SHA, and next packet IDs.

## Completion behavior

Continue autonomously through the current coherent packet/checkpoint. If a genuinely environment-only gate cannot run, complete all executable work, mark it `DEFERRED_ENVIRONMENT` with exact reason/required environment, and continue only where doing so does not invalidate correctness. Never convert an unrun gate into `PASS`.