# Design — Specification baseline hygiene

## Context

`openspec/project.md` already states the governing rule:

> "When historical text conflicts with an active OpenSpec change, do not silently choose one.
> Determine whether the historical statement is stale, update it as part of the appropriate
> truthfulness task, and preserve scientific/runtime invariants."

The conflict is between planning artifacts and the code, and the planning artifacts are stale in
four ways. Two are structural (`config.yaml` absent, four changes failing strict validation) and two
are factual (status headers contradicting their own task lists, execution instructions describing a
three-change repository that holds seven).

The fourth finding — no `openspec/specs/` — is the one that matters most going forward, and it is
easy to underestimate. Without a baseline, a new change cannot write `## MODIFIED Requirements`
against an existing capability, because no existing capability exists. Every change is forced into
`## ADDED Requirements`, which loses the ability to express "this changes existing behaviour" and
makes it impossible for the tooling to detect two changes that contradict each other.

That is not a theoretical risk in this repository: it already has two changes touching
`cinematic-visual-fidelity` behaviour and one touching the neutron-star surface model.

## Goals / Non-Goals

**Goals**

- The tooling reports the repository as healthy and every change validates strictly.
- Every declared status matches its recorded state.
- The execution instructions describe reality.
- Completed work has produced a baseline, and a documented archive policy exists.

**Non-Goals**

- Not a product-code change. Nothing under `src/`, `tests/`, `scripts/` or `tools/` is touched.
- Not a content review of the specification deltas. The defects are structural; the requirements
  themselves are not being re-litigated.
- Not an implementation of `spatial-atlas-continuous-navigation`.

## Decisions

### D1 — Add a minimal `config.yaml`

**Decision.** Add `openspec/config.yaml` declaring the `spec-driven` schema, and nothing else.

**Rationale.** The absence of the file is the whole of `openspec doctor`'s complaint. A minimal
configuration that matches what the repository already uses is better than a speculative
configuration: adding settings the project has not chosen is a decision this audit should not make
on its behalf.

### D2 — Repair validation failures structurally, without rewriting content

**Decision.** For each validation error, apply the minimal structural fix the tool names:
move the normative sentence to the line immediately after the requirement header, or add the missing
scenario.

**Two distinct error classes, handled differently:**

- *"Requirement body must contain SHALL/MUST"* — mechanical. The requirement already says it; it
  says it in the heading. Move the sentence into the body. No semantic change.
- *"Requirement must include at least one scenario"* — **not** always mechanical. A requirement
  with no scenario is either an incomplete requirement or a documentation statement that was never a
  behavioural contract. The implementer must decide per requirement, and must not invent a scenario
  that asserts behaviour nobody verified.

**Explicitly forbidden:** deleting a requirement to make validation pass, or writing a scenario that
merely restates the requirement in GIVEN/WHEN/THEN form without describing an observable outcome. A
scenario that cannot fail is worse than no scenario, because it looks like coverage.

**Where a requirement is genuinely non-normative** (a design note, a rationale, a non-behavioural
constraint), the honest move is `skip_specs` for that change, or removal of the requirement from the
delta — not a fabricated scenario.

### D3 — `spatial-atlas-continuous-navigation` gets real deltas, or an honest marker

**Decision.** This change is a new product capability (an Explorer destination, a spatial camera, a
catalog), so `ADDED` deltas are the correct form and it should get them. If the implementer judges
that authoring those deltas is a design decision belonging with the eventual implementation, the
alternative is an explicit `skip_specs: true` in its `.openspec.yaml` with a comment saying the
deltas are authored at implementation time.

**Why this needs a decision rather than a rule.** The change carries a 3,672-line `MASTER_PLAN.md`
and a `design.md` that already locks the contract. Authoring `ADDED` deltas from that material is
mostly transcription; inventing requirements beyond it would be specification without evidence. The
implementer should transcribe what the locked design states and not go further.

### D4 — Status headers state the implementing revision

**Decision.** Correct the two contradictory headers to state implementation, and name the
implementing revision and date.

**Rationale.** "COMPLETE" alone is an unverifiable claim — the same class of problem this whole
audit is about. Naming the revision makes it checkable with `git log`. The performance campaign's
revision is `179eb56`; the cinematic campaign's is recorded in its own task list.

### D5 — Annotate deferred tasks rather than checking or deleting them

**Decision.** Each of the 58 unchecked boxes in `whole-atlas-performance-optimization` gets a
`DEFERRED` or `REJECTED` annotation with its reason, inline.

**Rationale.** The existing annotations are excellent — each deferred box already carries a real
reason, and several record genuine research ("same rejection as §12", "rejected on visual
evidence"). They are simply not machine-visible. The `openspec list` count of 188/246 currently
implies the campaign is 76% done; with annotations it will read as "complete with 58 documented
deferrals", which is the truth. The task tool's checkbox count does not read annotations, so the
`openspec list` number will not change — but the artifact will be interpretable, and that is the
goal.

### D6 — Rewrite `openspec/AGENTS.md` against the real tree

**Decision.** Rewrite it to describe all seven changes, mark the five closed, name the two open, and
state the real prerequisite (performance campaign first; spatial atlas explicitly not started).

**Rationale.** The file is the contract every autonomous agent is told to obey. It currently orders
three completed changes, which would cause an agent to redo shipped work. This is the highest
consequence-per-line fix in the audit.

### D7 — One sources-of-truth list

**Decision.** `openspec/project.md` names `docs/MASTER_PLAN.md` and one campaign audit document as
current, and marks the superseded ones historical.

**Rationale.** Lines 34 and 79 name different audit documents as authoritative. An agent cannot
follow both.

### D8 — Document the archive policy now; archive last

**Decision.** Write the policy into `openspec/AGENTS.md` as part of this change, and perform the
archiving only after this change is itself complete.

**Rationale.** Archiving `whole-atlas-performance-optimization` while it still has 58 deferred boxes
would move a change that is complete-with-deferrals into the archive as though it were fully done.
Archiving the five genuinely closed changes is safe immediately. The order matters: validate →
document policy → archive the closed ones → archive the deferred one last, with its annotations
intact.

## Risks / Trade-offs

- **[Risk of fabricated scenarios]** An implementer under time pressure may invent scenarios to clear
  validation errors. → Mitigation: the task list explicitly forbids it and requires each scenario to
  describe an observable outcome. This is the single most likely way for this change to do harm, and
  it is called out twice.
- **[Archiving loses working context]** Archiving moves changes out of the active tree. → Mitigation:
  verify the archive retains design, tasks and evidence before archiving anything, and archive one
  change first, verify, then proceed.
- **[Baseline specs may be inaccurate]** Archiving creates capability specs derived from changes
  written months apart, with possible contradictions between them. → Mitigation: review the
  assembled baseline for contradictions as an explicit task. Where two archived changes disagree,
  that disagreement is a finding to resolve, not to paper over.
- **[Scope creep]** "Fix the specs" can absorb an unbounded amount of work. → Mitigation: the task
  list is explicitly structural. Content review is a separate activity and is listed as such.

## Testing strategy

This change is verified by the tooling itself, plus a manual review pass:

- `openspec doctor` reports healthy.
- `openspec validate --changes --strict` reports every change passing.
- `openspec list` shows statuses consistent with `tasks.md`.
- A reader who has never seen the repository follows `openspec/AGENTS.md` and reaches the correct
  active change without being misled.
- Every `## ADDED` requirement in the assembled baseline has at least one scenario, and each
  scenario names an observable outcome.

## Open Questions

One, non-blocking: whether `spatial-atlas-continuous-navigation`'s deltas are authored now or
deferred to implementation (D3). Both are acceptable; the requirement is only that the decision be
explicit and recorded.
