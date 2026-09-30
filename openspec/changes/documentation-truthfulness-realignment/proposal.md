## Why

The repository's own instruction file requires an agent to read a specific list of documents before
working. Four of those documents describe a product that no longer exists, and the release
certification — the document the README nominates as the evidence for "certified production-ready" —
contradicts itself and makes a claim that is now false.

`AGENTS.md:5-15` requires reading, among others:

- **`docs/PRODUCT_SPEC.md`** — describes a browser black-hole visualiser with Kerr as a *future*
  item ("later Kerr", §3). The shipped product is Cosmic Atlas with eight destinations and Kerr
  shipping.
- **`docs/ROADMAP.md`** — the M0–M11 sequence ending at "M11 Production hardening and release". All of
  M0–M12 is complete.
- **`docs/BACKLOG.md`** — a list of work packets in `BH-*` form covering work that is done. It reads
  as a live to-do list and is not marked as historical.
- **`docs/MILESTONE_WORK_PACKETS.md`** — the same, at greater length.

A fourth, subtler failure: `docs/cosmic-atlas/ROADMAP.md` says "Cosmic Atlas milestones are
additional to the existing black-hole M0-M11 roadmap. Do not use this document to skip unfinished
black-hole correctness work." That instruction is now false — there is no unfinished black-hole
correctness work in that milestone set — and it tells the reader the black-hole roadmap is still
authoritative.

And the certification document:

- **`docs/RELEASE_CERTIFICATION.md` self-contradicts on its headline gate.** Line 39 reports
  `631/631 across 46 files`; line 151 reports, for the same gate, `515/515 across 35 files`. There
  is no date qualifier distinguishing them. A reviewer citing this document cannot tell which run
  certifies the release.
- **Its `npm audit` claim is now false.** Lines 43, 132, 156 and 227 all state "0 vulnerabilities".
  `npm audit` today reports one high-severity advisory (`brace-expansion` 5.0.9, dev-only, via
  eslint → minimatch, with a fix available). The advisory post-dates the certification, so the claim
  was true when written and is false now — which is exactly why a certification document needs a
  date and a re-check, not a frozen number.
- **`docs/CI_CD.md:156` documents `npm run physics:fixtures -- --case <id>`.** No such script exists
  in `package.json`, and the string appears nowhere else in the repository. The document also
  describes a "review old/new diff before changing fixtures" control with no executable path.
- **`docs/cosmic-atlas/ARCHITECTURE.md` §2** presents a "Proposed repository layout" including
  `public/cosmic-data/`, `public/cosmic-assets/`, `src/data/manifests/`, `src/data/binary/`, six
  subdirectories under `tools/cosmic-data/`, and `src/phenomena/quasar/`. The shipped tree has
  `public/data/` and `public/luts/`, no `src/data/`, three scripts in `tools/cosmic-data/`, and
  `quasar-agn/`. `README.md:120` links this file as the Atlas architecture entry point, and
  `src/phenomena/quasar/` is a path an agent would try to import and fail on.
- **`docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md` §9–§11** describe Stellar Merger, Solar Activity
  and Gravitational Lensing Lab — three expansion destinations that do not exist in the registry.
  `README.md:124` presents the file as covering implemented destinations.
- **`docs/KERR_RESEARCH_PLAN.md:3`** still frames Kerr as "intentionally deferred until Schwarzschild
  is validated". M9 Kerr is complete, and `AGENTS.md`'s reading list routes agents to this pre-M9
  plan.
- **Two galaxy-collision data-source documents disagree on the source itself.**
  `DATA_SOURCES_GALAXY_COLLISION.md:13-16` cites DOI `10.1086/151825`, NTRS `19720056411`,
  GISS `to01000a.html`; `DATA_SOURCES_GALAXY_COLLISION_SOURCE_LOCK.md:15-18` cites DOI
  `10.1086/151823`, NTRS `19730032576`, GISS `to03000u.html`. The first also says parameters are
  "transcribed from the published tables/figures" while the second records that the transcription was
  impossible and the shipped scenario is repository-derived. Only the second is linked from the
  README. This is a provenance contradiction in the one domain where the project is most careful.
- **Two competing control inventories** — `docs/UI_CONTROL_CATALOG.md` claims to be "the
  authoritative inventory of user-facing controls" and is structured around a Black Hole panel only,
  while `docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md` covers the atlas. Neither
  cross-references the other, so an agent cannot tell which governs.

Every one of these was found by comparing documents against the code. None is a matter of taste.

## What Changes

- **Mark superseded documents explicitly**, with a header naming what replaced them, rather than
  leaving them in the tree looking current.
- **Realign `AGENTS.md`'s required-reading list** with the documents an agent actually needs today.
- **Give `docs/RELEASE_CERTIFICATION.md` exactly one authoritative gate table**, with a commit and a
  date, and move superseded runs to a clearly dated appendix.
- **State the current dependency-audit result honestly**, including its dev-only scope.
- **Remove or implement the `physics:fixtures` reference**, and add an automated check that every
  command named in any document exists in the project's command surface.
- **Correct `docs/cosmic-atlas/ARCHITECTURE.md` §2** to the shipped tree, moving the aspirational
  layout to a labelled appendix.
- **Resolve the galaxy-collision data-source contradiction** in favour of the source-locked record,
  and correct the parameter-provenance claim.
- **Reconcile the two control inventories** so one governs and the other defers to it.
- **Correct the `PHENOMENA_IMPLEMENTATION.md` expansion-destination sections** and the superseded
  deployment-compatibility document's tense.

Non-goals, explicitly out of scope:

- **Do not delete the historical documents.** The M0–M11 roadmap and backlog are the record of how
  the renderer was built and are worth keeping. They are marked, not removed.
- Do not rewrite physics or architecture prose that is accurate.
- Do not re-run the certification. This change corrects what the document *claims*; a fresh
  certification is Phase 6.
- No product-code change beyond optionally adding the documented fixture script.

## Capabilities

### New Capabilities
- None. This change modifies no externally observable behaviour, so it declares no specification
  deltas. See `.openspec.yaml` (`skip_specs: true`). Inventing requirements to satisfy validation
  would be worse than an explicit opt-out.

### Modified Capabilities
- None.

## Impact

**Affected documents** (all documentation)

`AGENTS.md`, `docs/PRODUCT_SPEC.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md`,
`docs/MILESTONE_WORK_PACKETS.md`, `docs/RELEASE_CERTIFICATION.md`, `docs/CI_CD.md`,
`docs/KERR_RESEARCH_PLAN.md`, `docs/cosmic-atlas/ROADMAP.md`, `docs/cosmic-atlas/ARCHITECTURE.md`,
`docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md`, `docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION.md`,
`docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION_SOURCE_LOCK.md`,
`docs/UI_CONTROL_CATALOG.md`, `docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md`,
`docs/DEPLOYMENT_COMPATIBILITY.md`, `openspec/project.md`.

**Affected code**

- `package.json` only, if the documented `physics:fixtures` script is implemented rather than the
  documentation corrected.
- A new documentation-consistency check (script plus a CI step) verifying every `npm run <name>`
  named in any document exists in the command surface.

**Affected tests**

- The new documentation-consistency check. It is a CI check, not a unit test.

**Dependencies**

- **Runs after `operations-and-deployment-readiness`**, which settles the dependency-audit position
  that the certification document must then state, and the Python toolchain position that the
  data-pipeline documentation must then state.

**Compatibility risk**

- None for the repository. Documentation-only, plus one additive CI check. The only functional risk
  is the new documentation check producing false positives on commands that are intentionally
  manual; that is handled by an explicit, reviewed allowlist rather than by weakening the check.
