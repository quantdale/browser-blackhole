# Design — Specification baseline review corrections

## Context

See `proposal.md` for the four review findings. At the reviewed `5bbd2cc` checkpoint:

- `openspec doctor` reports healthy.
- `openspec validate --changes --strict` validates 11 active changes, all passing.
- `openspec validate --specs --strict` validates six baseline capabilities, all passing.
- `openspec validate --all --strict` validates 17 items: 11 changes plus six specs, not 17 active changes.
- Six change folders are archived. Of the 11 active changes, `specification-baseline-hygiene` is checklist-complete and ten are unfinished.

These are review-time observations, not counts to copy into the apply-session end state. Creating this proposal adds one unfinished active change. Its later completion and archive change the populations again. Additional intervening work requires recounting.

The existing `openspec/AGENTS.md` policy states that archived changes are no longer edited and corrections land in a new change. The two baseline capabilities named in the proposal already exist; the original hygiene capability is still in an active change and is not a baseline capability to modify.

## Goals / Non-Goals

**Goals**

- Close exactly the four review findings with discoverable, revision-qualified evidence.
- Make each neutron-star negative scenario independently applicable and falsifiable.
- Preserve both the historical record and existing scientific/runtime contracts.
- Leave a bounded apply assignment that stops after this correction.

**Non-Goals**

- No runtime or production-test change, GPU run, benchmark, re-certification or new feature.
- No alteration of old archive files, historical certification measurements, scientific formulas or tolerances.
- No broad fix of the other documentation findings assigned to `documentation-truthfulness-realignment`.
- No archive/re-apply of `specification-baseline-hygiene` or another campaign as part of this session.

## Decisions

### D1 — Correct immutable headers through a linked erratum

Create `docs/SPECIFICATION_BASELINE_CORRECTIONS.md`. It must identify both wrong cinematic headers by actual archive path, quote their incorrect final-checkpoint claim, and replace that interpretation with the evidence-backed restored-scope final certified checkpoint `17c4644`. Name `2fc1b5d` only as the earlier 2026-08-29 checkpoint, not the final 2026-08-30 certification.

Evidence comes from the archived cinematic task list §§21–22, `docs/VISUAL_FIDELITY_CERTIFICATION.md`, and the commit ancestry/diff. Re-derive these at apply HEAD. Cite `git log`/`git diff` evidence for the renderer changes after `2fc1b5d`, not a new runtime certification.

Link the erratum from current OpenSpec context/execution guidance and the cinematic certification. Add a new `.agent/STATE.md` entry explicitly superseding the incorrect Phase 0 revision/count claims. Preserve old state entries as history.

**Alternative rejected:** directly patch both archived headers. Although the review suggested correcting them, doing so would violate the archive policy. An explicit, discoverable superseding record resolves the claim without silently rewriting history. This proposal does not grant an exception to that policy.

### D2 — Modify existing capabilities without duplicating them

The `repository-integrity` delta contains the complete updated **Active executor instructions are unambiguous** and **Public capability/status claims match evidence** blocks, preserving their original scenarios. The neutron-star delta replaces only **Neutron Star production fidelity claim**, preserving its normative body and all physics prerequisites.

Do not manually copy these requirements into a new capability. Apply the deltas through normal OpenSpec spec merging when this change is archived. Do not remove other requirements or scenarios in either baseline spec.

### D3 — Make fidelity scenarios independently falsifiable

The old scenario assumes all prerequisites hold, permits a label with `MAY`, and places its only mandatory negative outcome behind an unreachable condition. Correct that scenario in place as the supported-claim case, preserving its existing name (`fidelity documentation matches the shipped path`) for OpenSpec's scenario-preservation check, and add three independent negative cases. Do not retain the vacuous body merely to preserve the name.

Use the following documentation-review matrix without changing the renderer or falsifying a real validation result:

| Hypothetical documentation input | Required outcome | Example that must be rejected |
| --- | --- | --- |
| Surface path, reference and parity satisfied; direct claim published | Claim identifies the validated model/revision | Label describes a different unvalidated path |
| Required surface path absent or unvalidated | Actual model and surface-path limitation disclosed | Unqualified validated DIRECT claim |
| Surface path exists; reference incomplete | Actual model and missing reference validation disclosed | Unqualified validated DIRECT claim |
| Surface path/reference present; production parity missing or failing | Actual model and parity limitation disclosed | Unqualified validated DIRECT claim |

Each negative `GIVEN` is independent of the positive case. Test the logic with both compliant and noncompliant example copy and record the verdicts. These are spec/document acceptance checks, not claims that current production physics fails or that new GPU evidence was collected. Existing physical model, fidelity prerequisites and numerical tolerances do not change.

### D4 — Repair current citations, preserve qualified historical citations

Use the six actual archive destinations under `openspec/changes/archive/`, discovered from the current tree. Inspect current certification, observability and source-lock documents, the active spatial-atlas master plan, and current executor context for citations to the removed active paths.

Redirect live evidence references to retained files. Historical `.agent/STATE.md` entries, archived documents and superseded audit quotations may retain original paths, but current guidance must supply an explicit correction map or historical revision so those quotations are not mistaken for live paths. The new correction record must include the old-to-archive mapping for all six campaigns and name any deliberate historical-reference exceptions.

Validate file existence for every migrated citation. Do not rewrite scientific source identifiers, parameter tables, gate results or historical pass counts under the guise of link repair.

### D5 — Recount at each lifecycle stage

Derive active folders by excluding `openspec/changes/archive/`; count archive folders separately; derive checklist-complete/unfinished active changes from the actual task lists and corroborate with `openspec list --json`. A complete-with-deferrals archive remains labeled as such; do not treat its unchecked tasks as unfinished active work.

Record the command, revision/checkpoint identity and stage with tooling results. A truthful correction to the old Phase 0 row distinguishes the 17-change pre-archive result from the final 11-change/six-spec post-archive result. If the pre-archive result cannot be independently evidenced, label it as a historical recorded claim, not a newly reproduced measurement.

Refresh counts after this proposal exists, after its tasks complete, and after its eventual archive. Never hard-code the original 5/12, 11/6 or aggregate 17 as a permanent invariant. Include the correction in current instructions without altering §7's shared-file ordering for later runtime work.

### D6 — Bounded application and archive

One documentation/specification writer owns this follow-up. Application starts by pinning `APPLY_BASE` to the actual HEAD and reading the change plus repository instructions. Preserve unrelated work or stop if ownership is unclear. The allowed changes are the narrow documents listed in the proposal, this change's evidence/task record, and its two baseline specs as merged by archiving.

Close the implementation tasks with evidence, commit a focused checkpoint, then archive **only this change** with validation and normal spec merging enabled. After archive, recount and validate again, update current inventory/state, and commit the archive checkpoint. Previously existing archive folders remain byte-identical; adding this change's own archive is expected.

The apply session must stop there. Do not run the subsequent Kerr/host campaign and do not push. Browser/GPU gates are not applicable to this documentation-only change and must be reported as not run, not PASS. Check the scope with `git diff` against `APPLY_BASE`, never `git diff main` while already on `main`.

## Risks / Trade-offs

- **[Readers still encounter the wrong old header]** → Link the explicit erratum from current context/certification and identify both affected archive files, rather than publishing an orphan note.
- **[Strict validation hides another vacuous scenario]** → Record the four-case adversarial documentation matrix in addition to validator output.
- **[New proposal/archive makes counts stale again]** → Recount after each lifecycle transition and qualify every recorded total by stage.
- **[MODIFIED loses existing scenarios]** → Preserve the full original repository-integrity blocks, replace only the defective neutron-star scenario, and inspect the final merged specs.
- **[Correction grows into a production campaign]** → Keep explicit path exclusions and a mandatory stop after this one change.

## Migration Plan

1. Record actual HEAD, versions, tool health, populations and the four before-diagnostics.
2. Publish and link the erratum; repair only current evidence citations and executor inventory/context.
3. Review the proposed fidelity cases with compliant/noncompliant copy and preserve the existing requirement body.
4. Run narrow citation/count/scope checks and strict OpenSpec validation; record outcomes and close implementation tasks.
5. Commit the correction, archive only this change through normal spec merging, then recount, inspect merged requirements, revalidate and commit the archive checkpoint.

There is no deployment or runtime migration. If a correction proves wrong, land a focused follow-up; do not rewrite history, reset unknown work, weaken gates or edit previous archives.
