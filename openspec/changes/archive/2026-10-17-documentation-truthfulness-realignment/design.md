# Design — Documentation truthfulness realignment

## Context

The repository has unusually strong documentation practice: source-provenance comments, ADR
rationale, honest "Scope limit" sections in benchmark summaries, explicit disclosure of reduced
models. This change is about the *top layer* of that practice — the documents an agent is told to
read first, and the document the README nominates as the release evidence.

The failure mode here is specific and different from the code-level defects in this plan. Code
defects were found by reading code. These documentation defects are found by **comparing documents
to code**, which nothing in the repository does automatically. An agent following `AGENTS.md` reads
a roadmap for a finished project, has no way to know it is finished, and may re-open shipped work.

The two most consequential items are not the stale roadmap; they are:

- **`docs/RELEASE_CERTIFICATION.md` reporting two different results for its own headline gate**
  (631/46 at line 39, 515/35 at line 151). A document whose purpose is to be evidence cannot
  contain two contradictory pieces of evidence without a date distinguishing them.
- **The galaxy-collision data-source contradiction.** Two documents, two sets of identifiers, and two
  incompatible claims about whether parameters were transcribed from published tables or are
  repository-derived. The project built a source-lock system specifically to prevent this class of
  problem, and then shipped two documents that disagree about the source.

## Goals / Non-Goals

**Goals**

- Every document an agent is directed to read is true of the current code.
- The certification document has exactly one authoritative gate table.
- Command references in documentation are machine-checked.
- Provenance documents agree with each other.

**Non-Goals**

- Not a documentation rewrite. The accurate 90% stays.
- Not a deletion exercise. Historical documents are the record of how the renderer was built.
- Not a re-certification.
- No product-code change.

## Decisions

### D1 — Mark, do not delete

**Decision.** Add a supersession header to each stale document naming what replaced it and when.

**Rationale.** The M0–M11 roadmap documents how the numerical renderer was designed and built, and
that is valuable history. Deleting them would destroy it and would also destroy the ability to
explain *why* a design choice was made. The defect is that they look current, and a header fixes
exactly that.

**Rejected alternative — moving them to an `archive/` directory.** Tempting, but it breaks every
existing link into them, and the audit found that `docs/KERR_RESEARCH_PLAN.md` in particular is still
referenced from a reading list. A header fixes the misleading part without breaking anything.

### D2 — One gate table, one date, one commit

**Decision.** `docs/RELEASE_CERTIFICATION.md` keeps a single gate table carrying commit and date.
Superseded runs move to a clearly dated appendix headed "superseded evidence".

**Rationale.** A certification document is read as a claim about a specific artifact at a specific
revision. Two tables without dates is not two claims; it is an unreadable document. The §0
re-certification structure is already correct — it is the *older* table further down that has no
qualifier.

**On the `npm audit` claim:** the honest fix is to record the current result with its date and its
dev-only scope, plus the fact that a fix is available and is being applied under
`operations-and-deployment-readiness`. It is not to delete the line, and not to leave a frozen "0"
that is now false.

### D3 — Machine-check the command surface

**Decision.** Add a script that extracts every `npm run <name>` from every document, README and
agent-instruction file, and fails if any is absent from the command surface — with an explicit,
reviewed allowlist for commands that are intentionally manual.

**Rationale.** `docs/CI_CD.md` documents a fixture-generation workflow with no executable path. A
human check would find this one instance; the automated check finds the next one. The allowlist is
itself reviewed, so it cannot be used to quietly suppress the check.

**Why not simply delete the `physics:fixtures` reference:** either resolution is acceptable. If the
fixture generator is genuinely wanted, implementing it is better; if it was a design proposal that
was never built, removing the reference and stating the manual procedure is better. The check makes
the choice explicit either way.

### D4 — Correct §2 of the Atlas architecture document against the shipped tree

**Decision.** Replace the "Proposed repository layout" with the actual tree; move the aspirational
layout to an appendix explicitly headed as a target topology, not current structure.

**Rationale.** §3–§4 of that file (the descriptor contract and the lifecycle) are accurate and
valuable. Only the layout is stale. The file already says "this is the target topology" at line 102,
below the stale section — the heading should say it, and the current tree should be what a reader
meets first. `src/phenomena/quasar/` is a concrete hazard: it is an import path that does not exist.

### D5 — Resolve the data-source contradiction in favour of the source lock

**Decision.** Treat `DATA_SOURCES_GALAXY_COLLISION_SOURCE_LOCK.md` as authoritative, because it is
the one linked from the README, it is the one the runtime manifest agrees with, and it records the
stronger (less favourable) claim. Correct the other document to match, and correct its
"transcribed from the published tables" claim, which the source-lock document explicitly contradicts.

**Rationale.** This is the one place in the audit where choosing the *less* convenient reading is
obviously correct: the source-lock document is more honest about what could and could not be
established from the published source. A documentation convenience must not win over a provenance
record. The corrected document should say plainly that the scenario is repository-derived and that
the source establishes the method, not the parameter values.

### D6 — One control inventory governs

**Decision.** `docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md` governs. `docs/UI_CONTROL_CATALOG.md`
gains a header pointing to it and drops the "authoritative" claim, while retaining its
implementation-level control contracts, which are the part that is not duplicated.

**Rationale.** The atlas document covers eight destinations; the root document covers one panel.
They are not competing versions of the same thing — they are different scopes that fail to
acknowledge each other. Both pieces of value are kept; the authority claim is resolved.

### D7 — Realign the required-reading list

**Decision.** `AGENTS.md`'s reading list points at `docs/MASTER_PLAN.md`, the atlas architecture
document, the physics/numerics documents and the current certification — not at
`PRODUCT_SPEC.md`/`ROADMAP.md`/`BACKLOG.md`/`MILESTONE_WORK_PACKETS.md`, which move to an explicitly
labelled "historical" section.

**Rationale.** The reading list is the highest-leverage document in the repository: it is what every
autonomous agent executes first. Its content determines whether the next agent restarts a finished
campaign.

## Risks / Trade-offs

- **[Provenance correction is sensitive]** Changing a data-source document could be misread as
  weakening a claim. → Mitigation: the change makes the claim *stricter*, not looser — it corrects an
  overstatement. The correction must be explicit about this in the document itself.
- **[Documentation check false positives]** Intentional manual commands would fail the check.
  → Mitigation: a reviewed allowlist with a reason per entry.
- **[Scope pressure]** "Fix the docs" is unbounded. → Mitigation: the task list is explicitly the
  enumerated set of confirmed contradictions. Anything new goes to a backlog entry, not into this
  change.
- **[Certification edit seen as re-certification]** → Mitigation: the change states in its own
  `tasks.md` that it corrects claims and does not re-run any gate.

## Testing strategy

- `npm run format:check` and `npm run lint` clean (documentation is prettier-checked).
- The new documentation-consistency check passes.
- A fresh-agent review: follow `AGENTS.md` and confirm it leads to current work.
- A claim audit: for each corrected document, re-derive the corrected claim from the code and confirm
  it matches.
- No product code changed: `git diff --stat -- src tests scripts tools public` empty except the
  optional `package.json` script and the new check script.

## Open Questions

None blocking. One judgement call: whether to implement `physics:fixtures` or remove the reference.
Recommendation — decide by asking whether the fixture generator is still wanted; if it is, implement
it; if not, remove the reference and document the manual procedure. Do not leave the reference
either way.
