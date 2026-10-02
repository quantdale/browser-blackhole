# Tasks — Specification baseline hygiene

**Phase 0. This change gates every other change. Complete it first.**
**No product code may be modified by this change.**

## 0. Baseline

- [x] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [x] 0.2 Record `openspec doctor` output (expected: unhealthy, missing `openspec/config.yaml`).
- [x] 0.3 Record `openspec validate --changes --strict` output. The audit-time result was 3 passed and 4 failed, before the ten hardening changes existed. The 2026-09-30 re-review was 13 passed and 4 failed. Recorded actual output (13 passed, 4 failed at `c0ee5f5`; the mismatch with 3/4 is not a failed baseline).
- [x] 0.4 Record `openspec list` output.
- [x] 0.5 Record `openspec list --specs` output (expected: no specs found).
- [x] 0.6 Save all four baseline outputs. They are the before-evidence for this change. Saved: `artifacts/specification-baseline-hygiene/baseline.md` (local evidence file; `artifacts/*` is gitignored outside curated certification folders).

## 1. Configure the toolchain

- [x] 1.1 Add `openspec/config.yaml` declaring the `spec-driven` schema, and nothing speculative.
- [x] 1.2 Run `openspec doctor` and confirm it reports healthy.
- [x] 1.3 Commit the config file so a fresh checkout needs no local setup.

## 2. Repair validation failures

**Two error classes. Handle them differently. Read `design.md` D2 before starting.**

- [x] 2.1 For each "requirement body must contain SHALL/MUST" error: move the normative sentence to the line immediately after the requirement header. No semantic change. Record the count per change. Counts moved: cinematic 13, whole-atlas 8 (1 of the 17 errors was a missing body, not a misplaced verb).
- [x] 2.2 For each "must include at least one scenario" error: decide per requirement whether it is an incomplete requirement (add a real scenario describing an observable outcome) or a non-normative statement (remove it from the delta, or mark the change `skip_specs` with a comment). Every missing scenario was completed with a scenario grounded in delivered, evidenced behavior; none was fabricated to pass validation.
- [x] 2.3 FORBIDDEN: do not delete a requirement solely to pass validation, and do not write a scenario that merely restates the requirement. A scenario that cannot fail is worse than none. No requirement was deleted; no restatement-only scenario was written.
- [x] 2.4 Repair `cinematic-visual-fidelity-overhaul`: 24 errors at re-review, split evenly between missing normative body text and missing scenarios. Re-counted before editing: 24 (13 body, 11 scenario — the last two remaining errors after the first pass were 1 body + 1 scenario). All repaired.
- [x] 2.5 Repair `whole-atlas-performance-optimization`: 17 errors at re-review, not 18. Eight lack normative body text, eight lack a scenario, and one requirement lacks body text. Re-counted before editing: 17 exactly as corrected. All repaired; the empty-body requirement ("Destination shader compilation MAY be prewarmed...") received its missing normative body.
- [x] 2.6 Repair `m12-neutron-star-surface-lensing` (1 missing scenario at re-review). Scenario added to the MODIFIED fidelity-claim requirement, describing the documentation-vs-landed-model check.
- [x] 2.7 Resolve `spatial-atlas-continuous-navigation`, which has no `specs/` directory at all. Per `design.md` D3: author real ADDED deltas transcribed from its locked design, OR set `skip_specs: true` with a comment stating the deltas are authored at implementation time. Record which was chosen and why. CHOSEN: `skip_specs: true` in `.openspec.yaml` with the D3 rationale recorded there — the change is 0/123 and gated behind prerequisite closure, so its ADDED deltas belong with the implementation they describe; transcribing 2,845 lines of locked design ahead of implementation would be specification without implementation evidence.
- [x] 2.8 Run `openspec validate --changes --strict` and confirm every change in the tree passes. There were 17 at the 2026-09-30 review; count the tree rather than assuming seven. Actual: 17 changes, 17 pass.
- [x] 2.9 Run `openspec validate --specs --strict` if the assembled baseline reports errors. (Assembly happens in §5; the gate is re-run there.)

## 3. Correct status headers

- [x] 3.1 Update `whole-atlas-performance-optimization/proposal.md` and its `MASTER_PLAN.md` status lines from "PLAN ONLY" to implemented, naming revision `179eb56` and its date. Done: both read `Status: IMPLEMENTED — COMPLETE WITH DOCUMENTED DEFERRALS at \`179eb56\` (2026-09-10)`; the proposal had no Status line at all, one was added.
- [x] 3.2 Update `cinematic-visual-fidelity-overhaul/proposal.md` and its `MASTER_PLAN.md` status lines likewise, naming the revision recorded in its task list. Done: both name `17c4644`, certified 2026-08-30.
- [x] 3.3 Annotate each of the 58 unchecked task boxes in `whole-atlas-performance-optimization` with `DEFERRED` or `REJECTED` and its reason, inline. Preserve the existing research notes. Done: 58/58 annotated inline after reading each box's recorded reason; existing notes preserved.
- [x] 3.4 Do NOT check any deferred box, and do NOT delete any. Done: all 58 remain `- [ ]` after archiving (verified in the archive copy).
- [x] 3.5 Confirm every change's header status agrees with its own `tasks.md`. Done: cross-checked all 17; only the two corrected headers declared status, both now agree with their task lists (188+58=246 whole-atlas; 295/295 cinematic).

## 4. Rewrite the execution instructions

- [x] 4.1 Replace the interim `openspec/AGENTS.md` correction with a complete inventory of every change present at implementation time. Done: full inventory of 17 changes (6 closed/archived, whole-atlas complete-with-deferrals, spatial not started, 10 hardening open), generated from the tree.
- [x] 4.2 State the real ordering constraint from `docs/MASTER_PLAN.md` §7. Done: roadmap phases 0-6 with dependency notes, explicit shared-file serialization (host/TransitionDirector, shader physics, atlasApp single-owner), and the shell sequencing rule.
- [x] 4.3 Document the archive policy. Done: 5-step policy in `openspec/AGENTS.md` (annotate deferrals, strict-validate, archive, verify artifacts retained, review baseline for contradictions).
- [x] 4.4 Remove any instruction that would cause an agent to redo completed work. Verified by fresh-agent re-read: Phase 0 now marked COMPLETE 2026-10-02 - do not re-run; M12/CA9 marked closed; performance campaign explicitly not the live queue.
- [x] 4.5 Resolve the two-sources-of-truth conflict in `openspec/project.md`. Done: `docs/MASTER_PLAN.md` named current source of truth; both NEXT_CAMPAIGN_AUDIT docs marked historical/superseded; stale Active-campaign section rewritten.
- [x] 4.6 Add `docs/MASTER_PLAN.md` to the planning sources of truth in `openspec/project.md`. Done: it is item 1 in the current sources list.

## 5. Archive closed changes

- [x] 5.1 Verify the archive destination retains design, tasks and evidence. Done: all 6 archive folders retain design.md, tasks.md, proposal.md, specs/ (plus EXECUTION_PROMPT/MASTER_PLAN/ledger/implementation-notes where they existed).
- [x] 5.2 Archive ONE change first. Verify the result. Then proceed with the rest. Done: `final-production-readiness` archived first, verified (4 requirements in baseline, folder intact), then the rest.
- [x] 5.3 Archive the five genuinely closed changes. Done: final-production-readiness, m12-neutron-star-surface-lensing, m12-repository-integrity, ca9-galaxy-collision, cinematic-visual-fidelity-overhaul (all under `changes/archive/2026-10-02-*`).
- [x] 5.4 Archive `whole-atlas-performance-optimization` last, with its deferral annotations intact. Done: 58/58 DEFERRED/REJECTED annotations verified present in the archive copy.
- [x] 5.5 Do NOT archive this change (`specification-baseline-hygiene`) until it is itself complete. Done: this change remains active; archiving it belongs to Phase 6 per the policy.
- [x] 5.6 Review the assembled baseline for contradictions. Done: cross-capability scan of shared contracts (governor/WorkBudget single authority, WebGL2 fallback policy, data-driven backbone, visual-golden governance) - consistent. One defect found and fixed at the root: the m12 delta had two `## ADDED` sections after the MODIFIED->ADDED repair, so the first archive silently kept 1/11 requirements; sections merged and re-archived, baseline now 11/11.

## 6. Validation and evidence

- [x] 6.1 `openspec doctor` reports healthy. Done: `OpenSpec root: ok`.
- [x] 6.2 `openspec validate --changes --strict` passes for every change. Done: 11/11 active changes pass (baseline was 13 passed / 4 failed at c0ee5f5; the 6 archived changes passed strict before archiving).
- [x] 6.3 `openspec list --specs` shows the assembled baseline capabilities. Done: 6 capabilities, 79 requirements total (4+28+11+11+7+18); `openspec validate --specs --strict` 6/6 pass.
- [x] 6.4 `openspec list` shows statuses consistent with each change's `tasks.md`. Done: 18/46 this change (remaining boxes are close-out, checked off with evidence), 0/N for untouched changes, archived changes gone from the active list.
- [x] 6.5 Fresh-agent test. Done: re-read from the top - leads to the hardening roadmap with Phase 0 complete, names the real active queue, forbids redoing M12/CA9/performance, and the ordering rules match MASTER_PLAN §7. One misleading line found during the test (Phase 0 listed as open) was fixed before close-out.
- [x] 6.6 Confirm no product code was modified. Done: `git diff --stat main -- src tests scripts tools` is empty; the entire change is planning artifacts.
- [x] 6.7 `openspec validate specification-baseline-hygiene --type change --strict` passes. Done.

## 7. Close-out

- [x] 7.1 Strike findings D-01, D-02, D-03, D-04, D-05 and D-13 from `docs/MASTER_PLAN.md` with their resolution commit. Done: all six rows struck with RESOLVED 2026-10-02 notes; resolution commit is this change's checkpoint.
- [x] 7.2 Append the before/after tooling output to `.agent/STATE.md`. Done: 2026-10-02 session entry with before (13/4 fail, unhealthy, no specs) and after (11/11, healthy, 6 capabilities/79 requirements).
- [x] 7.3 Commit this change as one coherent checkpoint. Done: one commit containing only this change's planning artifacts.
- [x] 7.4 Confirm the next agent can begin Phase 1. Done: Phase 0 gate is green - strict validation passes for every change, doctor is healthy, statuses agree, baseline exists. Phase 1 changes (kerr-gpu-initializer-correctness, destination-control-truthfulness, quality-ladder-resolution-integrity) are unblocked.
