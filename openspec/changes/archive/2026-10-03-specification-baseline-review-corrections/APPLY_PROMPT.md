# Apply prompt — Specification baseline review corrections

Use this assignment in a **separate session**. Proposal creation did not apply any correction.

---

Apply only the OpenSpec change **`specification-baseline-review-corrections`** in:

`D:\Documents\tryPython\browser-blackhole`

This is a bounded documentation/specification correction to the Phase 0 apply at `5bbd2cc`, not a request to implement the hardening campaign. Goal mode is inactive; do not activate it or reuse any earlier goal contract. Work directly with one documentation/specification writer.

## Start

1. Inspect repository status, branch and recent commits. Record the actual HEAD as `APPLY_BASE` and retain that exact SHA for all before/after scope checks. If unknown work is present, preserve it and reconcile ownership before editing; never discard or reset it.
2. Read the root `AGENTS.md` required-reading list, `docs/MASTER_PLAN.md`, `.agent/START_HERE.md`, the newest `.agent/STATE.md` entries, `openspec/AGENTS.md`, and `openspec/project.md`.
3. Read this entire change folder: `proposal.md`, `design.md`, `tasks.md`, both delta specs and this prompt. Read the corresponding baseline capability specs and cited archived/current evidence. Re-derive references at HEAD rather than trusting review line numbers.
4. Obtain the native apply context:

```bash
openspec status --change specification-baseline-review-corrections --json
openspec instructions apply --change specification-baseline-review-corrections --json
```

These commands inspect the workflow; they do not apply changes by themselves. Execute only the task list for this named change. Do not follow the old state entry's instruction to begin Kerr/Phase 1.

## Required corrections

- **Cinematic revision:** establish `17c4644` as the final restored-scope certified checkpoint, with `2fc1b5d` explicitly identified as earlier. Because archives are immutable, publish and link `docs/SPECIFICATION_BASELINE_CORRECTIONS.md` to supersede the two erroneous archived headers; do not edit those archives. Add a superseding state entry rather than rewriting old history.
- **Fidelity acceptance:** use the MODIFIED neutron-star requirement to replace the vacuous case with one supported-claim case and three independent negative cases. Preserve its existing normative body, physics and tolerances. Record the compliant/noncompliant documentation matrix from design D3; do not manufacture a real physics failure or claim new GPU evidence.
- **Evidence citations:** repair live citations to the six moved campaigns using actual retained archive paths. Validate migrated files exist. Explicitly qualify preserved historical quotations with a revision or correction map.
- **Counts/status:** derive inventories from actual folders/task lists, including this change. Distinguish active from archived, completed-awaiting-archive from unfinished, and change-only from spec-only/aggregate validation. Qualify results by command and stage; recount after completion and archive.

The change's proposal/design/tasks govern the exact scope. Do not broaden it into the other documentation or runtime findings.

## Hard boundaries

No edits to `src/`, `tests/`, `scripts/`, `tools/`, `public/`, dependency manifests/lockfiles, CI/build configuration, goldens, benchmark assets or scientific parameter/source tables. No edits to previously existing `openspec/changes/archive/**` files. Do not manually duplicate or prune capability specs; integrate these deltas through normal OpenSpec archive merging. No new destination, renderer fix, re-certification, unrelated campaign archive or push.

Read source only if needed to resolve a documentation assertion. Browser/GPU/product gates are not required for this documentation-only scope; report them as **not run**, not PASS. Do not weaken assertions, thresholds or fidelity prerequisites.

## Validation and close-out

Run and record the revision/citation/inventory/scenario diagnostics, then:

```bash
openspec doctor
openspec validate specification-baseline-review-corrections --type change --strict
openspec validate --changes --strict
openspec validate --specs --strict
openspec validate --all --strict
openspec list --json
openspec list --specs
git diff --check
```

Inspect outputs and exit statuses. Validate scope with `git diff` against the saved `APPLY_BASE` SHA, **not `git diff main` when on main**. Check that the six original archive folders are unchanged.

Mark an implementation task complete only after its evidence exists. Preserve any blocker as unchecked and report it; do not fake an `all_done` state. Commit a focused application checkpoint after all implementation tasks pass.

Follow the task file's post-apply protocol: archive **only this change** with `openspec archive specification-baseline-review-corrections --yes`, without validation/spec-merge bypasses. Inspect the merged specs, re-run the population/validation/scope checks, refresh current inventory and append stage-qualified state evidence, then commit the archive checkpoint. Do not edit this change's newly archived files after moving them.

Stop after this one correction. Return the resolved four findings, changed paths, exact validation populations/results, commit(s), whether archive completed, and any remaining limitations. Do not begin Phase 1 or push.
