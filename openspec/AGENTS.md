# OpenSpec execution rules for autonomous agents

## Current status

The repository holds 18 change folders: 7 complete archived under `openspec/changes/archive/2026-10-03-*` and 11 active. Of the 11 active, `specification-baseline-hygiene` is checklist-complete awaiting archive, and the remaining ten are the unfinished hardening wave. Post-archive at this checkpoint: `--changes --strict` 11 passed / 0 failed, `--specs --strict` 6 passed / 0 failed, `--all --strict` 17 passed / 0 failed. The live campaign is `docs/MASTER_PLAN.md`, Phase 0 through Phase 6. Shared files are serialized by `docs/MASTER_PLAN.md` §7; phases are not blanket permission to edit the same file in parallel.

Baseline correction record: `docs/SPECIFICATION_BASELINE_CORRECTIONS.md` supersedes the two erroneous archived cinematic headers (`2fc1b5d` → final restored-scope certified checkpoint `17c4644`) and the Phase 0 state entry's revision/count claims. Active validation/inventory claims must be quoted with command, population and lifecycle stage.

- Phase 0 (complete, checklist-landed 2026-10-03): `specification-baseline-hygiene` (46/46, awaiting archive).
- Phase 0 review corrections (landed and archived 2026-10-03): `specification-baseline-review-corrections`; erratum at `docs/SPECIFICATION_BASELINE_CORRECTIONS.md`.
- Phase 1, one writer at a time: `kerr-gpu-initializer-correctness` (owns `src/phenomena/black-hole/{kerr,lut,observer}/**`), then `quality-ladder-resolution-integrity`, then `transition-error-user-visibility`, then `destination-control-truthfulness`.
- Phase 2: `shared-renderer-service-lifecycle` (only after quality-ladder and transition-error land).
- Phase 3: `verification-gate-integrity`.
- Phase 4: `benchmark-harness-integrity`.
- Phase 5: `operations-and-deployment-readiness`, then `documentation-truthfulness-realignment`.
- Archived, complete: `m12-neutron-star-surface-lensing`, `m12-repository-integrity`, `ca9-galaxy-collision`, `final-production-readiness`, `cinematic-visual-fidelity-overhaul`, `whole-atlas-performance-optimization` (complete-with-deferrals).
- Not started: `spatial-atlas-continuous-navigation` (0/123; do not implement in this campaign).

Restarting M0–M12, CA9, `final-production-readiness`, `cinematic-visual-fidelity-overhaul`, or `whole-atlas-performance-optimization` is a defect.

## Archive policy

When a change completes, archive it: its delta requirements move into a baseline capability specification under `openspec/specs/<capability>/spec.md`, and the change folder moves to the archive location. Never archive a change with unchecked tasks unless those boxes are annotated DEFERRED/REJECTED with reasons, and never archive `specification-baseline-hygiene` until it is itself complete. Archived changes are no longer edited; corrections land in a new change.

## Before editing

- Read `docs/MASTER_PLAN.md` (priority, sequencing, §7 serialization).
- Read `.agent/START_HERE.md` and `.agent/STATE.md`'s newest section.
- Read the entire active change folder (proposal, design, tasks, specs).
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
