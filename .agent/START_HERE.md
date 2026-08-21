# Start here — autonomous implementation prompt

Use this file as the first instruction for a fresh coding agent.

## Mission

Implement `browser-blackhole` from the planning blueprint into a production-quality interactive browser black-hole renderer. Work autonomously, preserve scientific correctness, keep the repository buildable, and update durable project state after each coherent checkpoint.

## Before writing code

1. Read `AGENTS.md` completely.
2. Read `.agent/STATE.md` and `.agent/QUALITY_GATES.md`.
3. Read `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/PHYSICS.md`, `docs/RENDERING_PIPELINE.md`, `docs/PERFORMANCE.md`, `docs/TESTING.md`, `docs/ROADMAP.md`, and `docs/BACKLOG.md`.
4. Inspect the current Git branch, status, recent commits, and existing files/tests.
5. Treat `docs/RESEARCH_REFERENCES.md` as research input, not as permission to copy third-party code without a license review.

## Execute now

Begin at the exact milestone named in `.agent/STATE.md`. At initial bootstrap that is `M0 — Repository and rendering foundation`.

Do not ask the user to break M0 into smaller tasks. Break it down internally and execute it. Use sub-agents/workers only for independent bounded work as described in `docs/PARALLEL_WORK.md`; the main agent remains responsible for integration and final validation.

For M0, the expected sequence is:

1. verify the current stable compatible versions of Node tooling, Vite, TypeScript, Three.js, Vitest, Playwright, lint/format tooling, and any minimal UI helper actually needed;
2. initialize the project and commit an exact lockfile;
3. create the minimal target source/test structure, avoiding empty speculative modules;
4. implement Three.js `WebGPURenderer` startup and explicit capability/error handling;
5. render a deterministic full-screen TSL diagnostic shader;
6. add PerspectiveCamera + OrbitControls behind a small camera abstraction;
7. implement resize/internal-render-size handling and a conservative DPR policy hook;
8. create the canonical application-state/preset skeleton;
9. add deterministic unit tests and a Playwright browser smoke test that fails on page/console errors;
10. add `format`, `lint`, `typecheck`, `test`, `build`, and browser-test scripts;
11. add CI for gates that the environment can genuinely run;
12. run all M0 exit gates, fix failures, and update `.agent/STATE.md` with exact evidence.

## Hard constraints

- Do not implement the black hole as an ordinary black sphere plus screen distortion and declare the scientific renderer complete.
- Do not ray trace pixels on the CPU.
- Do not begin Kerr before the Schwarzschild roadmap gates pass.
- Do not use a Web Worker or compute shader merely because it sounds faster; profile and use the architecture in `docs/PERFORMANCE.md`.
- Do not hide shader/numerical failure as a black pixel.
- Do not silently change unit conventions.
- Do not let UI controls write raw shader uniforms outside the validated state/render mapping.
- Do not disable tests to obtain a green checkpoint.

## Checkpoint/report format

At the end of every coherent checkpoint, report and persist:

- milestone and completed backlog IDs;
- files changed and key design decisions;
- commands/tests run and exact pass/fail status;
- browser/backend/GPU environment actually tested;
- screenshots/benchmark evidence when relevant;
- known limitations/deferred debt;
- next highest-priority work items;
- resulting commit SHA.

Then update `.agent/STATE.md` so another fresh agent can continue without this prompt or previous chat context.
