# OpenSpec execution rules for autonomous agents

Reconciled with the real tree on 2026-10-02 by `specification-baseline-hygiene`. If this
file and `openspec list` ever disagree, the tool output wins and this file is stale —
fix this file.

## The change set (2026-10-02)

The tree holds seventeen changes: eleven active under `openspec/changes/` and six
completed under `openspec/changes/archive/2026-10-02-*`. The tree held seven before the
2026-09-30 repository audit added the ten hardening changes of the roadmap below.
Do not execute the historical M12/CA9 order; those changes are complete and
restarting them is a defect.

### Closed — complete, certified and archived 2026-10-02. Do not redo.

- `m12-neutron-star-surface-lensing` (65/65) — direct Schwarzschild neutron-star surface
  ray tracing, certified.
- `m12-repository-integrity` (47/47) — M12 truthfulness closure.
- `ca9-galaxy-collision` (78/78) — DATA_DRIVEN restricted three-body Galaxy Collision,
  source-locked to Toomre & Toomre 1972.
- `cinematic-visual-fidelity-overhaul` (295/295) — certified 2026-08-30 at `17c4644`.
- `final-production-readiness` (33/33).

Each of these was folded into the baseline capability specifications under
`openspec/specs/<capability>/spec.md` when archived. A future change that alters their
behavior writes `## MODIFIED Requirements` against those capabilities.

### Complete with documented deferrals

- `whole-atlas-performance-optimization` (188/246) — certified at `179eb56`. The 58
  unchecked boxes carry inline `DEFERRED`/`REJECTED` annotations with reasons; they are
  recorded evidence, not work to resume. The performance campaign is complete-with-
  deferrals and is not the live queue.

### Deliberately not started

- `spatial-atlas-continuous-navigation` (0/123) — a product design gated behind its
  prerequisites (its README forbids overlapping central runtime work until the
  performance campaign is closed or explicitly coordinated, and the hardening roadmap
  below owns the central runtime modules meanwhile). Do not start it as side work.

### Open hardening roadmap — the required order (docs/MASTER_PLAN.md §6)

1. Phase 0 `specification-baseline-hygiene` — planning substrate. **COMPLETE
   2026-10-02 — do not re-run.** It stays in the active tree until Phase 6
   archives it; its own task list is 46/46 with evidence.
2. Phase 1 — `kerr-gpu-initializer-correctness`, `destination-control-truthfulness`
   (U-01..U-04), `quality-ladder-resolution-integrity` (A-01, A-02). Each lands with the
   regression test that would have caught its defect.
3. Phase 2 — `transition-error-user-visibility`, then the first part of
   `shared-renderer-service-lifecycle`.
4. Phase 3 — `verification-gate-integrity`. Must not start before Phases 1–2: a
   verification change written against defective code encodes the defect as expected
   behavior.
5. Phase 4 — `benchmark-harness-integrity`. Must not start before Phase 3.
6. Phase 5 — `operations-and-deployment-readiness`,
   `documentation-truthfulness-realignment`.
7. Phase 6 — final certification: full gate matrix on a quiet capable runner,
   re-certification, archiving the completed changes, release commit in
   `.agent/STATE.md`.

Phases are not blanket permission to edit the same file in parallel. Shared files are
serialized by the ownership boundaries of `docs/MASTER_PLAN.md` §7 — never let two
workers rewrite these concurrently: `src/atlas/host.ts` and
`src/atlas/TransitionDirector.ts` (quality/transition lane); shader physics
`kerrIntegrator.ts`, `lensingGpu.ts`, `schwarzschildIntegrator.ts` (physics lane);
`src/app/atlasApp.ts` (product/UI lane). Because both edit the shell,
`transition-error-user-visibility` lands before `destination-control-truthfulness`.

## Before editing

- Read `.agent/EXECUTION_PROMPT.md` when present, then the active change's `proposal.md`,
  `design.md`, `tasks.md` and `specs/`, and inspect the implementation the change names —
  do not rely on planning text alone.
- Run and record the required baseline. Classify any pre-existing failure before
  implementation.

## During implementation

- Work requirement-by-requirement and task-by-task; keep changes narrow enough that
  regressions can be attributed.
- Add the test with the behavior change, not after the whole implementation.
- A visual golden may change only after the physical/behavioral change is independently
  validated, and every golden change is justified in the owning change's `design.md`.
- Never weaken assertions, widen tolerances, lower integration budgets, disable tests or
  relabel fidelity to make a gate pass.
- Never convert exercise/example scientific parameters into production defaults without a
  source lock.
- Record evidence as you go (`Evidence:` lines in `tasks.md`). A checkbox count alone is
  not proof.

## Blockers

When a task is blocked by scientific provenance, licensing, unavailable hardware, or a
reproducible upstream/tool defect: record the exact blocker and evidence, stop dependent
tasks, continue only independent work that cannot invalidate the blocked decision, and
leave the blocked checkbox unchecked. Never substitute a plausible number or model for a
missing source fact.

## Completion and archive policy

A change is complete when every mandatory task has evidence, the required quality gates
pass, documentation/fidelity labels match runtime behavior, temporary probes/downloads
are removed, and a coherent commit records the campaign. Never hide unrelated changes in
the same commit.

When a change completes:

1. annotate any genuinely deferred boxes `DEFERRED`/`REJECTED` inline with the reason —
   never silently check or delete them;
2. run `openspec validate <change> --type change --strict`;
3. archive it with `openspec archive <change> -y`, which folds its spec deltas into the
   baseline capability specification under `openspec/specs/<capability>/spec.md` and moves
   the change folder out of the active tree;
4. verify the archived folder still holds its `design.md`, `tasks.md` and evidence, and
   that `openspec list --specs` shows the capability;
5. review the assembled baseline for contradictions between capabilities written at
   different times and resolve each — a disagreement is a finding to resolve, not to
   paper over.

Do not archive a change whose deltas fail strict validation, and do not archive a change
until it is itself complete.

`openspec/project.md` names the current planning sources of truth; `docs/MASTER_PLAN.md`
is the canonical plan.
