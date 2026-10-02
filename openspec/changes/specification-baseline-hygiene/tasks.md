# Tasks — Specification baseline hygiene

**Phase 0. This change gates every other change. Complete it first.**
**No product code may be modified by this change.**

## 0. Baseline

- [x] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [x] 0.2 Record `openspec doctor` output (expected: unhealthy, missing `openspec/config.yaml`).
- [x] 0.3 Record `openspec validate --changes --strict` output. The audit-time result was 3 passed and 4 failed, before the ten hardening changes existed. The 2026-09-30 re-review was 13 passed and 4 failed. Record the actual output; do not treat a mismatch with 3/4 as a failed baseline.
- [x] 0.4 Record `openspec list` output.
- [x] 0.5 Record `openspec list --specs` output (expected: no specs found).
- [x] 0.6 Save all four baseline outputs. They are the before-evidence for this change.

## 1. Configure the toolchain

- [x] 1.1 Add `openspec/config.yaml` declaring the `spec-driven` schema, and nothing speculative.
- [x] 1.2 Run `openspec doctor` and confirm it reports healthy.
- [x] 1.3 Commit the config file so a fresh checkout needs no local setup.

## 2. Repair validation failures

**Two error classes. Handle them differently. Read `design.md` D2 before starting.**

- [x] 2.1 For each "requirement body must contain SHALL/MUST" error: move the normative sentence to the line immediately after the requirement header. No semantic change. Record the count per change.
- [x] 2.2 For each "must include at least one scenario" error: decide per requirement whether it is an incomplete requirement (add a real scenario describing an observable outcome) or a non-normative statement (remove it from the delta, or mark the change `skip_specs` with a comment).
- [x] 2.3 FORBIDDEN: do not delete a requirement solely to pass validation, and do not write a scenario that merely restates the requirement. A scenario that cannot fail is worse than none.
- [x] 2.4 Repair `cinematic-visual-fidelity-overhaul`: 24 errors at re-review, split evenly between missing normative body text and missing scenarios. Re-count before editing.
- [x] 2.5 Repair `whole-atlas-performance-optimization`: 17 errors at re-review, not 18. Eight lack normative body text, eight lack a scenario, and one requirement lacks body text. Re-count before editing.
- [x] 2.6 Repair `m12-neutron-star-surface-lensing` (1 missing scenario at re-review).
- [x] 2.7 Resolve `spatial-atlas-continuous-navigation`, which has no `specs/` directory at all. Per `design.md` D3: author real ADDED deltas transcribed from its locked design, OR set `skip_specs: true` with a comment stating the deltas are authored at implementation time. Record which was chosen and why.
- [x] 2.8 Run `openspec validate --changes --strict` and confirm every change in the tree passes. There were 17 at the 2026-09-30 review; count the tree rather than assuming seven.
- [x] 2.9 Run `openspec validate --specs --strict` if the assembled baseline reports errors.

## 3. Correct status headers

- [x] 3.1 Update `whole-atlas-performance-optimization/proposal.md` and its `MASTER_PLAN.md` status lines from "PLAN ONLY" to implemented, naming revision `179eb56` and its date.
- [x] 3.2 Update `cinematic-visual-fidelity-overhaul/proposal.md` and its `MASTER_PLAN.md` status lines likewise, naming the revision recorded in its task list.
- [x] 3.3 Annotate each of the 58 unchecked task boxes in `whole-atlas-performance-optimization` with `DEFERRED` or `REJECTED` and its reason, inline. Preserve the existing research notes.
- [x] 3.4 Do NOT check any deferred box, and do NOT delete any.
- [x] 3.5 Confirm every change's header status agrees with its own `tasks.md`.

## 4. Rewrite the execution instructions

- [x] 4.1 Replace the interim `openspec/AGENTS.md` correction with a complete inventory of every change present at implementation time. At the 2026-09-30 review: 5 complete and 12 in progress, including the ten hardening changes. Do not restore a seven-change description.
- [x] 4.2 State the real ordering constraint from `docs/MASTER_PLAN.md` §7. The performance campaign is complete-with-deferrals and is not the live queue. `spatial-atlas-continuous-navigation` is not started. The hardening changes are serialized by shared file, not parallel by phase.
- [x] 4.3 Document the archive policy: when a change completes, its requirements are archived into a baseline capability specification and the change is archived.
- [x] 4.4 Remove any instruction that would cause an agent to redo completed work. Verify by re-reading as a fresh agent.
- [x] 4.5 Resolve the two-sources-of-truth conflict in `openspec/project.md` (lines 34 and 79). Name `docs/MASTER_PLAN.md` plus one campaign audit as current; mark the others historical.
- [x] 4.6 Add `docs/MASTER_PLAN.md` to the planning sources of truth in `openspec/project.md`.

## 5. Archive closed changes

- [x] 5.1 Verify the archive destination retains design, tasks and evidence.
- [x] 5.2 Archive ONE change first. Verify the result. Then proceed with the rest.
- [x] 5.3 Archive the five genuinely closed changes.
- [x] 5.4 Archive `whole-atlas-performance-optimization` last, with its deferral annotations intact.
- [x] 5.5 Do NOT archive this change (`specification-baseline-hygiene`) until it is itself complete.
- [x] 5.6 Review the assembled baseline for contradictions between capabilities derived from changes written months apart. Resolve each; do not paper over a disagreement.

## 6. Validation and evidence

- [x] 6.1 `openspec doctor` reports healthy.
- [x] 6.2 `openspec validate --changes --strict` passes for every change.
- [x] 6.3 `openspec list --specs` shows the assembled baseline capabilities.
- [x] 6.4 `openspec list` shows statuses consistent with each change's `tasks.md`.
- [x] 6.5 Fresh-agent test: follow `openspec/AGENTS.md` from the top and confirm it leads to the correct active change without misleading the reader.
- [x] 6.6 Confirm no product code was modified: `git diff --stat main -- src tests scripts tools` must be empty.
- [x] 6.7 `openspec validate specification-baseline-hygiene --type change --strict` passes.

## 7. Close-out

- [x] 7.1 Strike findings D-01, D-02, D-03, D-04, D-05 and D-13 from `docs/MASTER_PLAN.md` with their resolution commit.
- [x] 7.2 Append the before/after tooling output to `.agent/STATE.md`.
- [x] 7.3 Commit this change as one coherent checkpoint.
- [x] 7.4 Confirm the next agent can begin Phase 1.
