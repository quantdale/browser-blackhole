# Tasks — Specification baseline review corrections

Status: **PROPOSED — implementation has not started.**
Documentation/specification only. Keep every checkbox unchecked during proposal creation.
Read `design.md` before application, particularly the immutable-archive decision and population rules.

## 1. Pin the baseline and reproduce the review

- [ ] 1.1 Record clean/reconciled repository status, branch, actual HEAD as `APPLY_BASE`, Node/npm/OpenSpec versions and the existing archive folder list. Do not use `main` as the before-ref when already working on `main`.
- [ ] 1.2 Read the repository instructions, this whole change, the two baseline capability specs and the current evidence cited by the review. Re-derive all line numbers and reconcile intervening changes before editing.
- [ ] 1.3 Record actual `openspec doctor`, `openspec list --json`, `openspec list --specs`, and separate `--changes`, `--specs`, `--all` strict-validation results. Label this stage before correction; include this new proposal in the inventory.
- [ ] 1.4 Save the four before-diagnostics: wrong cinematic final-revision claims, the unreachable neutron-star negative branch, unresolved current evidence citations, and documented versus actual change/validation populations. Use documentation diagnostics only; do not alter production behavior to construct failures.

## 2. Publish the revision erratum without rewriting history

- [ ] 2.1 Verify `2fc1b5d` is an earlier checkpoint and `17c4644` is the final restored-scope certified checkpoint using the archived task list §§21–22, certification and commit history/diff. Distinguish certification date from commit date.
- [ ] 2.2 Create `docs/SPECIFICATION_BASELINE_CORRECTIONS.md`, naming both wrong archived cinematic headers, their superseded claims and the evidence-backed replacement. Preserve every previously existing archive file and old state entry.
- [ ] 2.3 Link that correction from current OpenSpec execution/project context and the cinematic certification. Make a fresh reader able to discover the corrected revision without hunting through old session history.
- [ ] 2.4 Include a correction mapping for the Phase 0 state entry's revision and validation-count claims. Do not claim a new scientific or browser certification.

## 3. Review the non-vacuous fidelity delta

- [ ] 3.1 Compare the neutron-star delta to the baseline: preserve the existing normative requirement body, physical prerequisites, numerical tolerances and original scenario name; correct its defective body and add the three independent negative scenarios.
- [ ] 3.2 Evaluate all four cases in `design.md` D3 with compliant and noncompliant example documentation. Record that each negative case independently rejects an unsupported validated DIRECT claim; this does not assert current production physics failed.
- [ ] 3.3 Confirm the positive case permits a supported direct claim without requiring that label unconditionally, and rejects a claim about a different unvalidated model/revision.
- [ ] 3.4 Confirm the two `repository-integrity` MODIFIED blocks preserve all original scenarios. Leave spec integration to the normal archive merge; do not create a duplicate capability or manually remove unrelated baseline requirements.

## 4. Restore current evidence paths

- [ ] 4.1 Discover the six original campaign archive destinations from the tree and add their old-to-current path mapping to the correction record.
- [ ] 4.2 Repair current evidence/provenance citations in cinematic/release/performance certifications, observability diagnostics, the Galaxy Collision source-lock document and the active spatial-atlas master plan. Inspect current executor context for the same moved-path defect.
- [ ] 4.3 Scan other current documents for citations affected by the same six moves; repair only those references. List explicitly historical exceptions, including old state/audit/archive text, without treating unqualified missing paths as current evidence.
- [ ] 4.4 Run a file-existence diagnostic for every migrated current citation; demonstrate the original missing paths and the corresponding retained targets. Preserve scientific source data, measurements and historical gate results.

## 5. Align execution inventory and tooling evidence

- [ ] 5.1 Derive active/archived folder totals and complete/unfinished active task states from the tree and `openspec list --json`; distinguish completed active work awaiting archive from unfinished work and complete-with-deferrals archives.
- [ ] 5.2 Update current OpenSpec instructions/project context and the master plan's narrow follow-up route to account for this change. Preserve §7 file serialization and do not enqueue completed campaigns for re-application.
- [ ] 5.3 Record command- and stage-qualified tooling results, distinguishing the historical 17-change pre-archive claim from the reproduced post-archive change/spec populations. Label any unreproduced historical result as recorded history, not new measurement.
- [ ] 5.4 Add a superseding `.agent/STATE.md` correction entry with exact evidence, remaining limitations and the bounded next action. Do not rewrite or erase earlier state entries.

## 6. Validate and close the apply checklist

- [ ] 6.1 Run the narrow revision, citation, inventory and four-case scenario checks again; record their results in the correction record. Confirm the documentation fixes and reviewed spec resolution are discoverable, explicitly noting that fidelity-delta integration remains pending until archive.
- [ ] 6.2 Run `openspec validate specification-baseline-review-corrections --type change --strict`, `openspec doctor`, and all three strict-validation populations. Inspect output as well as exit status.
- [ ] 6.3 Run `git diff --check` and verify the diff against saved `APPLY_BASE`: no runtime/test/tool/asset/dependency/CI/build/benchmark changes and no edits to the six pre-existing archive folders.
- [ ] 6.4 Perform the fresh-reader check: current guidance exposes the erratum, all current migrated citations resolve, counts match the stated stage, and the correction assignment stops without starting Phase 1.
- [ ] 6.5 Attach evidence to completed tasks and prepare a focused application checkpoint. Report browser/GPU and product gates as not run for this documentation-only change, never PASS.

## Post-apply archive protocol

This is the normal lifecycle after the implementation checklist is complete, not a task to pre-check before it happens. `all_done` means ready for archive review, not proof of final spec integration.

1. Commit the documentation/application checkpoint once the checklist has evidence.
2. Archive **only** `specification-baseline-review-corrections` with normal validation and spec merging enabled: `openspec archive specification-baseline-review-corrections --yes`. Do not use `--skip-specs` or `--no-validate`, and do not archive another change.
3. Inspect both merged baseline specs: original unrelated requirements/scenarios retained; the vacuous neutron-star scenario replaced by four independently applicable cases. Existing six archive folders remain unchanged; this change's new archive is expected.
4. Recount the active/archived/complete/unfinished populations and re-run doctor plus change/spec/aggregate strict validation after archive. Refresh current inventory and append the post-archive evidence with the correct stage. Do not reuse pre-archive counts.
5. Check scope/diff again, commit the archive/inventory checkpoint, report the actual commit(s) and residual limitations, and stop. No Phase 1 work and no push.
