# OpenSpec execution rules for autonomous agents

## Current status

Do not execute the historical M12/CA9 order below. `m12-neutron-star-surface-lensing`, `m12-repository-integrity`, and `ca9-galaxy-collision` are complete. Restarting them is a defect.

The live work is `docs/MASTER_PLAN.md` and its hardening changes. At the 2026-09-30 review the tree had 17 changes: 5 complete and 12 in progress. Shared files are serialized by `docs/MASTER_PLAN.md` §7; phases are not blanket permission to edit the same file in parallel.

`specification-baseline-hygiene` must replace this interim section with a complete inventory generated from the tree at implementation time. Until that lands, this section overrides every older sentence in this file about a three-change repository.

## Historical order — completed, do not re-execute

1. `m12-neutron-star-surface-lensing`
2. `m12-repository-integrity`
3. `ca9-galaxy-collision`

## Before editing

- Read `.agent/EXECUTION_PROMPT.md` completely.
- Read `docs/NEXT_CAMPAIGN_AUDIT_2026-08-26.md`.
- Read the entire active change folder.
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
4. leave the blocked checkbox unchecked.

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
