# Specification baseline corrections

Status: **ACTIVE erratum for the Phase 0 (`5bbd2cc`) planning baseline.** Published: 2026-10-03.
Supersedes, without rewriting, two archived cinematic headers and the Phase 0 `.agent/STATE.md`
revision/count claims. Authoritative for the four review findings of
`openspec/changes/specification-baseline-review-corrections`.

## Finding 1 — Wrong cinematic final-revision claim (immutable archive headers)

Erroneous claims (preserved byte-identical in the immutable archive):

- `openspec/changes/archive/2026-10-03-cinematic-visual-fidelity-overhaul/proposal.md:4` —
  `Status: COMPLETE — certified 2026-08-30; final implementation checkpoint `2fc1b5d`.`
- `openspec/changes/archive/2026-10-03-cinematic-visual-fidelity-overhaul/MASTER_PLAN.md:4` —
  same wording.
- `.agent/STATE.md` Phase 0 entry (2026-10-03, "specification-baseline-hygiene landed"):
  `cinematic (`2fc1b5d`, certified 2026-08-30)` repeated the wrong checkpoint.

Evidence-backed replacement:

- The restored-scope final certified checkpoint is `17c4644` (main, 2026-08-30, commit date).
- `2fc1b5d` is an earlier implementation checkpoint (2026-08-29; camera-framing separating
  system framing from viewer takeover), not the final 2026-08-30 certification.
- Supporting evidence:
  - `docs/VISUAL_FIDELITY_CERTIFICATION.md:124` — evidence row "at `17c4644` (main, 2026-08-30)"
    listing `npm run check` 598/598, full browser 271/271, scientific 43/43 twice, cinematic 8/8
    twice, `benchmarks/results/2026-08-30-final-17c4644/matrix-high-webgpu.json`, and
    `artifacts/cinematic-visual-fidelity/final-17c4644/`.
  - Commit `bed06ab` "cert(hygiene): final certification at 17c4644 — headed nvidia lovelace,
    271/271, 43+8 twice, benchmarks and review artifacts".
  - Commit `17c4644` itself: "fix(docs): clean tasks.md duplicate evidence after restore …
    Status: COMPLETE, CERTIFIED 2026-08-30".
- Certification date (2026-08-30) is the date of recorded certification evidence; `17c4644` is
  the implementation checkpoint that certification attests. The earlier `2fc1b5d` commit is
  2026-08-29.

Correction map: wherever the archived headers or old state entries name `2fc1b5d` as the final
certified checkpoint, read `17c4644`. The archived files themselves are immutable and unchanged.

## Finding 2 — Vacuous neutron-star fidelity scenario

Baseline defect (at `openspec/specs/neutron-star-surface-lensing/spec.md:153-158`): the scenario
"fidelity documentation matches the shipped path" has `GIVEN` all prerequisites satisfied, then a
mandatory negative outcome ("if any of those requirements is unsatisfied, the note SHALL describe
the actual reduced model …") that is unreachable from the stated `GIVEN`. The only negative case
was vacuous.

Resolution via the change's `MODIFIED` delta
(`openspec/changes/specification-baseline-review-corrections/specs/neutron-star-surface-lensing/spec.md`):

- The original scenario name is retained; its normative body, the physical prerequisites and the
  tolerances are unchanged. The positive case now asserts the claim identifies the validated
  model/revision and does not present a different unvalidated implementation.
- Three independent negative scenarios were added: absent/unvalidated material-surface path,
  incomplete reference validation, and failing/missing production parity. Each independently
  requires the actual reduced model/limitation to be disclosed and forbids an unqualified
  validated `DIRECT` claim.
- The two `repository-integrity` MODIFIED blocks preserve every original scenario and add the
  correction/citation/validation-stage scenarios needed to prevent a recurrence.

Documentation-review matrix (from design D3; no runtime/GPU evidence manufactured — each verdict
is a spec/document acceptance check, not a claim that current production physics failed):

| Hypothetical documentation input | Required outcome | Example that must be rejected |
| --- | --- | --- |
| Surface path, reference and parity satisfied; direct claim published | Claim identifies the validated model/revision | Label describes a different unvalidated path |
| Required surface path absent or unvalidated | Actual model and surface-path limitation disclosed | Unqualified validated DIRECT claim |
| Surface path exists; reference incomplete | Actual model and missing reference validation disclosed | Unqualified validated DIRECT claim |
| Surface path/reference present; production parity missing or failing | Actual model and parity limitation disclosed | Unqualified validated DIRECT claim |

Compliant documentation (all prerequisites hold) permits the direct label without requiring it
unconditionally; noncompliant copy (claiming a validated DIRECT path while the surface path,
reference, or parity is missing/incomplete/failing) is independently rejected in all three
negative cases. The renderer, model and tolerances are unchanged.

Delta integration status: the delta is staged in this change and is integrated into the baseline
capability spec only through the normal `openspec archive` spec merge; it is not yet merged into
`openspec/specs/`.

## Finding 3 — Evidence citations broken by archiving

The six campaigns moved from `openspec/changes/<id>` to
`openspec/changes/archive/2026-10-03-<id>`. Old-to-current mapping:

| Original working-tree path | Current archive path |
| --- | --- |
| `openspec/changes/ca9-galaxy-collision` | `openspec/changes/archive/2026-10-03-ca9-galaxy-collision` |
| `openspec/changes/cinematic-visual-fidelity-overhaul` | `openspec/changes/archive/2026-10-03-cinematic-visual-fidelity-overhaul` |
| `openspec/changes/final-production-readiness` | `openspec/changes/archive/2026-10-03-final-production-readiness` |
| `openspec/changes/m12-neutron-star-surface-lensing` | `openspec/changes/archive/2026-10-03-m12-neutron-star-surface-lensing` |
| `openspec/changes/m12-repository-integrity` | `openspec/changes/archive/2026-10-03-m12-repository-integrity` |
| `openspec/changes/whole-atlas-performance-optimization` | `openspec/changes/archive/2026-10-03-whole-atlas-performance-optimization` |

Current citations repaired in this correction (each verified to resolve to a retained file):

- `docs/RELEASE_CERTIFICATION.md` (4 occurrences: header, §134 ledger, and two summary lines).
- `docs/PERFORMANCE_CERTIFICATION.md` (campaign header).
- `docs/VISUAL_FIDELITY_CERTIFICATION.md` (evidence-contract and at-`17c4644` rows).
- `docs/OBSERVABILITY_DIAGNOSTICS.md` (§51 telemetry row).
- `docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION_SOURCE_LOCK.md` (source-lock rule).
- `openspec/changes/spatial-atlas-continuous-navigation/MASTER_PLAN.md` (performance dependency).

Deliberately historical references left unchanged, to be read through this correction map:

- `.agent/STATE.md` older entries (pre-2026-10-03 session records; including the Phase 0 row's
  `2fc1b5d` revision and 17-change validation claim).
- `docs/NEXT_CAMPAIGN_AUDIT_2026-08-26.md` and `docs/NEXT_CAMPAIGN_AUDIT_2026-08-28.md`
  (historical input documents on the project.md denylist of active guidance).
- `openspec/changes/archive/**` files themselves (immutable), including their internal
  references to their own original paths.
- `benchmarks/results/**/SUMMARY.md` and other benchmark captures (benchmark assets; not edited).
- Inline comments in `src/` and `tests/` referencing the original campaign paths (runtime code
  is outside this correction's boundary).
- `.agent/EXECUTION_PROMPT.md` (retained as the completed-campaign record, explicitly marked
  COMPLETED AND SUPERSEDED).

File-existence diagnostic at apply time: original working-tree paths return False (e.g.
`openspec/changes/final-production-readiness`), and the archive targets return True (e.g.
`openspec/changes/archive/2026-10-03-final-production-readiness/ledger.md`). Preserved
scientific source data, measurements and historical gate results.

## Finding 4 — Stale inventory and validation counts

Derived from the actual tree and `openspec list --json` at `APPLY_BASE`
(`2a57d9fe71afcf694106f942fbf645b647a1fbca`, 2026-10-03), before this correction's application:

- Active change folders: **12** (11 pre-existing + this correction proposal). Of these,
  `specification-baseline-hygiene` is checklist-complete (46/46, complete-awaiting-archive);
  `specification-baseline-review-corrections` was proposed and unfinished (0/25); the remaining
  ten are in-progress/unfinished with 0 completed tasks.
- Archived change folders: **6**, all under `openspec/changes/archive/2026-10-03-*`;
  `whole-atlas-performance-optimization` is complete-with-deferrals.
- Baseline capability specs: **6** (`ci-release-readiness`, `cinematic-visual-fidelity`,
  `galaxy-collision`, `neutron-star-surface-lensing`, `repository-integrity`,
  `whole-atlas-performance`).

Command- and stage-qualified validation record (all runs at `APPLY_BASE`, Node v24.3.0 /
npm 11.4.2 / OpenSpec 1.9.0, toolchain `spec-driven`):

| Command | Population | Stage | Result |
| --- | --- | --- | --- |
| `openspec doctor` | root health | pre-correction | ok |
| `openspec validate --changes --strict` | 12 active changes | pre-correction | 12 passed / 0 failed |
| `openspec validate --specs --strict` | 6 baseline specs | pre-correction | 6 passed / 0 failed |
| `openspec validate --all --strict` | 12 changes + 6 specs | pre-correction | 18 passed / 0 failed |

The historical Phase 0 row's "17 passed / 0 failed" for `--changes --strict` was the
**pre-archive** change population (17 live change folders at that moment, since 6 were later
archived); it is recorded history, not the current population. It must not be read as 17 active
changes. Post-archive, the change population is the 12 (11 at that time) active folders, not 17.
A truthful current inventory names the command, the revision and the lifecycle stage.

## Boundaries

- No edits to `src/`, `tests/`, `scripts/`, `tools/`, `public/`, dependency manifests/lockfiles,
  CI/build configuration, goldens, benchmark assets, or scientific parameter/source data.
- No edits to previously existing `openspec/changes/archive/**` files.
- No duplicate capability specs; delta requirements merge through the normal archive operation.
- No new destination, renderer fix, re-certification, unrelated campaign archive, or push.
- Browser/GPU, product, and performance gates for this documentation-only correction are
  **not run**, never PASS.
