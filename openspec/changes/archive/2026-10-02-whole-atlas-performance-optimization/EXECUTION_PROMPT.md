# EXECUTION PROMPT — Whole-Atlas Performance Optimization

Campaign: `whole-atlas-performance-optimization`
Target: current `main`
Mode: autonomous implementation + hardening + certification
Primary contract: `MASTER_PLAN.md`, `design.md`, `proposal.md`, `specs/whole-atlas-performance/spec.md`, `tasks.md`

## Mission

Execute the existing whole-atlas performance OpenSpec to completion. The repository has already completed its feature-completion and final-production-readiness campaign; this campaign is therefore a focused **performance hardening campaign**, not a license to redesign the product or invent new features.

The objective is to substantially reduce unnecessary CPU/GPU work, idle rendering, startup cost, transition cost, memory/resource pressure, and expensive strong-field rendering cost across all eight production Cosmic Atlas destinations while preserving accepted visual output, scientific fidelity, deterministic behavior, compatibility, and production usability.

Do not optimize only the black hole. Treat the entire runtime, shared renderer, services, transitions, UI, resource lifecycle, WebGPU path, WebGL2 fallback, and every production phenomenon as in scope according to the master plan.

## First actions — mandatory baseline

Before changing runtime behavior:

1. Read every artifact in this OpenSpec change.
2. Read `docs/RELEASE_CERTIFICATION.md`, `.agent/START_HERE.md`, `.agent/STATE.md`, `docs/PERFORMANCE.md`, `docs/PERFORMANCE_BUDGETS.md`, `docs/cosmic-atlas/PERFORMANCE_HARDWARE.md`, and relevant renderer/physics docs.
3. Record `git status --short`, `git rev-parse HEAD`, Node/npm versions, browser/backend/hardware information.
4. Run `npm ci` and `npm run check`.
5. Establish the benchmark/evidence baseline required by `tasks.md` section 0 before claiming any optimization win.
6. Preserve baseline artifacts under `benchmarks/results/` with exact SHA and environment metadata.

A pre-existing failure must be classified before implementation. Do not silently inherit a failing gate and later call it a regression.

## Execution order

Use `tasks.md` as the authoritative checklist and `MASTER_PLAN.md` as the detailed engineering rationale. Default dependency order:

1. measurement/telemetry foundation;
2. frame invalidation and visibility lifecycle;
3. transition occlusion and warmup;
4. startup/code splitting;
5. black-hole active-pass lifecycle;
6. shared VolumeService, ParticleService, ribbon/buffer, SharedPost and WorkBudget improvements;
7. Schwarzschild LUT/numerical optimization;
8. Kerr optimization;
9. destination-specific optimization for Neutron Star, Stellar Explosion, Compact Merger, Tidal Disruption, Quasar/AGN, Black-Hole Merger, Galaxy Collision;
10. WebGL2/constrained-hardware verification;
11. resource/memory certification;
12. final performance certification.

Parallelize only independent work with non-overlapping ownership and an explicit integration plan. Do not allow parallel work to produce competing scheduler/governor/resource authorities.

## Non-negotiable invariants

- Preserve accepted deterministic visual goldens by default. Never regenerate goldens merely to hide an optimization-induced difference.
- Preserve Schwarzschild, Kerr, moving-observer and neutron-star reference/parity contracts.
- Preserve DATA_DRIVEN semantics for Black-Hole Merger and Galaxy Collision.
- Preserve documented PROCEDURAL_SCIENTIFIC models for the procedural destinations.
- Never reduce numerical tolerance, hide failed rays, enlarge shadows, alter hit classification, or weaken tests simply to report better timing.
- Keep WebGPU preferred and WebGL2 fallback functional.
- Keep one renderer ownership authority, ResourceScope lifecycle discipline, and one global quality governor/work-budget authority.
- Do not reintroduce runtime scientific-data network dependencies.
- Distinguish CPU frame time from true GPU timestamp measurements.
- Every performance claim must state backend, viewport/internal resolution, quality tier/render scale, scene/preset, adapter/browser, warm/cold state, and starting/final SHA.

## Optimization discipline

Optimize by eliminating work before reducing fidelity. Prefer, in order: avoid invisible/unchanged work; avoid allocation/upload churn; lazy-create expensive resources; make quality knobs reduce real work; optimize full-screen passes; improve integrator efficiency at equal or tighter error; then investigate spatial/temporal reuse only with rigorous parity evidence.

For every material change:

1. identify the measured bottleneck or waste;
2. record pre-change evidence;
3. implement the smallest coherent architectural fix;
4. add/adjust regression tests that prove the intended work elimination and correctness;
5. run subsystem tests and relevant browser/golden/parity gates;
6. benchmark before/after on matched conditions;
7. reject the change if the gain is noise, fidelity regresses, resource lifecycle worsens, or complexity is not justified;
8. document rejected experiments rather than leaving dead experimental code.

## Autonomous-session behavior

Continue productively through the checklist without stopping after the first successful optimization. Repair regressions immediately. If a proposed optimization fails evidence gates, revert or contain it, record why, and continue to the next justified workstream.

Do not artificially consume time. Continue until the highest-value unblocked tasks are complete and final certification has been attempted. If implementation completes early, spend remaining productive effort on regression hunting, resource leaks, WebGL2 parity, constrained-hardware behavior, benchmark repeatability, startup/idle verification, documentation synchronization, and final certification.

Do not mark a checkbox complete without evidence. Blocked tasks remain unchecked with a precise blocker note.

## Validation gates

At meaningful milestones run the narrowest relevant tests first, then broader gates. Before closing a shared-service or physics workstream, run every affected destination's relevant unit/browser/golden/parity coverage. Before campaign closure, satisfy the complete final certification section of `tasks.md`, including full unit tests, capable-hardware browser suite, twice-stable goldens, Firefox gate, forced-WebGL2 gate, benchmark reruns, resource plateau checks, startup/transition/idle evidence, Kerr equal-fidelity evidence, and updated performance documentation.

Hosted GitHub Actions intentionally runs only deterministic quality plus cheap browser smoke. Do not claim the hardware-GPU local gate as hosted CI evidence. Use the repository's documented capable-runner workflow for the full browser/golden/Firefox evidence.

## Commit and push protocol

Commit coherent workstreams with evidence-oriented messages. At minimum record starting SHA, bottleneck/problem, implementation, important tradeoffs, validation commands/results, benchmark conditions/results, regressions or rejected alternatives, and remaining work.

Push completed work when authorized. Never force-push over unrelated work. Keep the working tree clean at phase boundaries where practical.

## Stop/block conditions

Stop the dependent optimization and record evidence rather than guessing if:

- visual/scientific parity cannot be reconciled;
- a numerical speedup increases failure/MAX_STEPS or weakens accuracy;
- a WebGPU optimization breaks required WebGL2 behavior without a valid fallback;
- a resource/lifecycle optimization produces unbounded program/texture/target/storage growth;
- benchmark variance is too high to establish a real improvement;
- required capable hardware/backend is unavailable for a blocking certification gate;
- the only way to make a change pass is to weaken an invariant or test.

Environment-unavailable gates are `DEFERRED_ENVIRONMENT`, never PASS.

## Definition of completion

The campaign is complete only when all justified, unblocked high-value work in `tasks.md` is implemented or explicitly rejected with evidence; all material regressions are fixed; all eight production destinations have matched before/after evidence; idle unchanged scenes approach zero destination draws between invalidations where semantically valid; startup/transition/resource improvements are evidenced; strong-field speedups preserve reference/parity/failure behavior; WebGPU and WebGL2 contracts remain sound; documentation matches reality; `docs/PERFORMANCE_CERTIFICATION.md` exists; final gates pass on the appropriate environments; and the OpenSpec task state truthfully reflects the evidence.

Do not declare completion merely because the application builds or a benchmark got faster.