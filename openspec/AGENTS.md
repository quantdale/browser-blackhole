# OpenSpec execution rules for autonomous agents

## Current status

Updated 2026-10-22. Quote inventory claims with the command, population, and lifecycle stage.

- Active changes: 1. `openspec list` reports `spatial-atlas-continuous-navigation` at 0/123. Its header says implementation status NOT STARTED. Do not implement it unless an explicit user instruction or an `ACTIVE` planner prompt assigns it.
- Archived changes: 25. `openspec validate --archived --strict` passed 25/25.
- Baseline specs plus the active change: `openspec validate --all --strict` passed 20/20 (19 specs + 1 change).
- The hardening plan in `docs/MASTER_PLAN.md` (Phases 0–6) is complete. It is not an open queue. Do not restart it, and do not restart M0–M12, CA9, `final-production-readiness`, `cinematic-visual-fidelity-overhaul`, or `whole-atlas-performance-optimization`.
- `docs/SPECIFICATION_BASELINE_CORRECTIONS.md` remains the erratum for the Phase 0 review (cinematic certified checkpoint `17c4644`, not `2fc1b5d`). Its 2026-10-03 population counts are historical.
- Completed renderer work must still preserve `TransitionPublicState.slowLoad`, the outside-panel device-loss card, and that card's reload-only action set. Those invariants live in the archived `shared-renderer-service-lifecycle` and `destination-control-truthfulness` changes, not in an active writer.

## Archive policy

When a change completes, archive it: its delta requirements move into a baseline capability specification under `openspec/specs/<capability>/spec.md`, and the change folder moves to the archive location. Never archive a change with unchecked tasks unless those boxes are annotated DEFERRED/REJECTED with reasons, and never archive `specification-baseline-hygiene` until it is itself complete. Archived changes are no longer edited; corrections land in a new change. Before archiving a completed change, update its `proposal.md`/`tasks.md` status headers to the final state (e.g. "COMPLETE — archived"); an archived change must not perpetuate a stale "PROPOSED"/"in progress" header.

## Before editing

- Read `.agent/START_HERE.md` and `.agent/STATE.md`'s newest section before `docs/MASTER_PLAN.md`. The master plan is the completed hardening record; use §7 only if that plan is reopened.
- Read an active change folder only when that change is the assigned work. The sole active change is planning-only and is not an assignment by itself.
- Inspect the current implementation and tests named by the change; do not rely only on the planning text.
- Run and record the required baseline. A pre-existing failure must be classified before implementation.

## During implementation

- Work requirement-by-requirement and task-by-task.
- Keep changes narrow enough that regressions can be attributed.
- Prefer extending existing abstractions over introducing parallel frameworks, but do not contaminate validated black-hole contracts merely to maximize reuse.
- Add tests with the behavior change, not after the entire implementation.
- A visual golden may change only after the physical/behavioral change is independently validated.
- Do not commit downloaded primary-source PDFs/raw datasets unless redistribution rights are explicitly established.
- Never convert exercise/example scientific parameters into production defaults without a source lock.
- Do not weaken assertions, widen tolerances, lower integration budgets, disable tests, or relabel fidelity solely to make a gate pass.

## Blockers

When a task is blocked by scientific provenance, licensing, unavailable hardware, or a reproducible upstream/tool defect:

1. record the exact blocker and evidence;
2. stop dependent tasks;
3. continue only independent work that cannot invalidate the blocked decision;
4. leave the blocked checkbox unchanged (or annotate it DEFERRED with the blocker).

Do not substitute a plausible number/model for a missing source fact.

## Completion

For each change:

- all mandatory tasks have evidence;
- required quality gates pass;
- documentation/fidelity labels match runtime behavior;
- temporary probes/downloads are removed;
- commit with a detailed campaign summary;
- push the resulting commit(s) to the repository when the environment is authorized to do so.

At the end of all unblocked changes, update durable project state/backlog and summarize deferred/environment-blocked work without calling it complete.
