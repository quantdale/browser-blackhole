# Tasks — Documentation truthfulness realignment

**Runs after `operations-and-deployment-readiness`**, which settles the dependency-audit and Python
toolchain positions that these documents must then state.
**Documentation only.** The single permitted code change is the optional fixture script and the new
consistency check.

## 0. Baseline

- [x] 0.1 Record `git rev-parse HEAD` and clean `git status --short`.
- [x] 0.2 Run `npm run check` and record the result (proves the documentation edits do not break the build).
- [x] 0.3 Run `npm audit` and record the current output verbatim, including the dev-only scope.
- [x] 0.4 Re-derive each corrected claim from the code before editing the document, so the correction is evidence-based.

## 1. Supersession headers

- [x] 1.1 Add a supersession header to `docs/PRODUCT_SPEC.md` naming the Cosmic Atlas documents that replaced it.
- [x] 1.2 Add one to `docs/ROADMAP.md`.
- [x] 1.3 Add one to `docs/BACKLOG.md`.
- [x] 1.4 Add one to `docs/MILESTONE_WORK_PACKETS.md`.
- [x] 1.5 Add one to `docs/KERR_RESEARCH_PLAN.md`, noting M9 is complete.
- [x] 1.6 Add one to `docs/DEPLOYMENT_COMPATIBILITY.md`, or retire it and fold its live content into `docs/DEPLOYMENT.md`.
- [x] 1.7 Do NOT delete any of these documents. Each header names what replaced it and when.
- [x] 1.8 Correct the false instruction in `docs/cosmic-atlas/ROADMAP.md` that tells the reader not to skip unfinished black-hole correctness work.

## 2. Required-reading list

- [x] 2.1 Complete the realignment of `AGENTS.md`. An interim banner may already warn that the numbered list is not the live queue. Replace that banner and list with current documents: `docs/MASTER_PLAN.md`, the atlas architecture, the physics and numerics documents, and the current certification. Do not restore the old list as required live reading.
- [x] 2.2 Move `PRODUCT_SPEC.md`, `ROADMAP.md`, `BACKLOG.md` and `MILESTONE_WORK_PACKETS.md` into an explicitly labelled historical section. Keep their physics and history value; remove their authority as the work queue.
- [x] 2.3 Verify by fresh-agent reading: following the list leads to current work, not to a finished campaign.

## 3. Release certification

- [x] 3.1 Consolidate `docs/RELEASE_CERTIFICATION.md` to ONE authoritative gate table carrying a commit and a date.
- [x] 3.2 Move the older run to a clearly dated "superseded evidence" appendix.
- [x] 3.3 Replace the frozen "0 vulnerabilities" claim with the current result, its date, its dev-only scope and the fact that a fix is available.
- [x] 3.4 Do NOT re-run any gate as part of this change. It corrects claims; it does not re-certify.
- [x] 3.5 Add an explicit note that the audit result must be re-checked at each certification, not carried forward.

## 4. Command-surface check

- [x] 4.1 Decide the `physics:fixtures` question: implement the script, or remove the reference and document the manual procedure. Do not leave the reference either way.
- [x] 4.2 Write a script that extracts every `npm run <name>` from every document, README and agent-instruction file and fails if any is absent from the command surface.
- [x] 4.3 Add a reviewed allowlist for commands that are intentionally manual, with a reason per entry.
- [x] 4.4 Wire the check into CI.
- [x] 4.5 Confirm the check passes.

## 5. Architecture and phenomena documents

- [x] 5.1 Replace `docs/cosmic-atlas/ARCHITECTURE.md` section 2 with the actual shipped tree.
- [x] 5.2 Move the aspirational layout to an appendix explicitly headed as a target topology.
- [x] 5.3 Verify every path listed in the corrected section exists.
- [x] 5.4 Mark the Stellar Merger, Solar Activity and Gravitational Lensing Lab sections of `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md` as unimplemented expansions.

## 6. Provenance and control catalogues

- [x] 6.1 Resolve the galaxy-collision data-source contradiction in favour of `DATA_SOURCES_GALAXY_COLLISION_SOURCE_LOCK.md`.
- [x] 6.2 Correct the identifiers in `DATA_SOURCES_GALAXY_COLLISION.md` to match the source-lock record.
- [x] 6.3 Correct its parameter-provenance claim: the scenario is repository-derived; the source establishes the method, not the parameter values. Make the correction explicit and note that it strengthens rather than weakens the claim.
- [x] 6.4 Cross-reference the two control catalogues; make the atlas one govern and drop the "authoritative" claim from the root one, while keeping its implementation-level contracts.
- [x] 6.5 Cross-check every remaining identifier in both data-source documents against the runtime manifest.

## 7. Validation and evidence

- [x] 7.1 `npm run format:check` and `npm run lint` clean.
- [x] 7.2 `npm run typecheck` and `npm test` still pass.
- [x] 7.3 The new documentation-consistency check passes.
- [x] 7.4 Fresh-agent review of `AGENTS.md` and `openspec/AGENTS.md` confirms both lead to current work.
- [x] 7.5 Claim audit: re-derive each corrected claim from the code and confirm it matches.
- [x] 7.6 Confirm no product code changed: `git diff --stat -- src tests public` is empty; only `package.json` and the new check script differ.
- [x] 7.7 `openspec validate documentation-truthfulness-realignment --type change --strict` passes.

## 8. Close-out

- [x] 8.1 Strike findings D-06 through D-12, D-14 and D-15 from `docs/MASTER_PLAN.md` with their resolution commit.
- [x] 8.2 Append evidence to `.agent/STATE.md`.
- [x] 8.3 Commit this change as one coherent checkpoint.


---

## Evidence summary (2026-10-17 completion pass)

- **D-06 (§2):** AGENTS.md's required-reading list rebuilt around the CURRENT
  documents (`.agent/STATE.md` -> `docs/MASTER_PLAN.md` -> the shipped
  architecture -> physics/numerics -> rendering -> testing/performance ->
  the current certification); the completed M0-M12 planning documents moved
  to an explicitly labelled "Historical planning documents (NOT the work
  queue)" section with their SUPERSEDED headers. The interim banner is gone.
- **D-07/D-08 (§3):** RELEASE_CERTIFICATION now names ONE authoritative
  gate table (the §0 re-certification, commit `bbd71ef`, dated 2026-09-12);
  the 2026-08-27 run's table is a dated "Superseded evidence" appendix; every
  `npm audit` claim carries its date and the 3.5 re-check rule, and the
  authoritative claim records the 2026-10-17 drift (2 high, dev-only, fixes
  available) and its remediation — no gate was re-run (3.4).
- **D-09 (§4):** the phantom `npm run physics:fixtures` reference is REMOVED
  and CI_CD §8 documents the manual procedure (the offline Python pipeline;
  it cannot be a portable npm script — pinned interpreter + pinned records).
  `scripts/check-command-surface.mjs` + a REVIEWED allowlist (one entry, with
  reason) extract every `npm run <name>` from docs/README/agent files and
  fail on any missing script — wired into the hosted quality job (187 files,
  39 scripts, ok).
- **D-10 (§5.1-5.3):** cosmic-atlas/ARCHITECTURE.md §2 replaced with the
  ACTUAL shipped tree (every listed path verified to exist); the aspirational
  layout moved to an appendix explicitly headed as a target topology.
- **D-11 (§5.4):** PHENOMENA_IMPLEMENTATION §9-§11 (Stellar Merger, Solar
  Activity, Gravitational Lensing Lab) marked UNIMPLEMENTED EXPANSIONS —
  design sketches, not shipped code.
- **D-12 (§1.5):** KERR_RESEARCH_PLAN.md carries a SUPERSEDED header noting
  M9 is complete (the "intentionally deferred" sentence is historical).
- **D-14 (§6.1-6.3/6.5):** the galaxy-collision identifier contradiction
  resolved IN FAVOUR OF the source-lock record (DOI 10.1086/151823, GISS
  to03000u, NTRS 19730032576 now match it exactly); the parameter-provenance
  claim corrected (the source establishes the METHOD; the numeric scenario is
  a repository-derived default within the source-locked framework — the
  correction strengthens the claim); every remaining identifier cross-checked
  against the runtime manifest (doi/decisionAdr/parametersStatus all match).
- **D-15 (§6.4):** the atlas DESTINATION_CONTROL_CATALOG is the governing
  inventory; the root UI_CONTROL_CATALOG keeps its implementation contracts
  but drops its "authoritative" claim and cross-references the atlas one (and
  vice versa).
- **§1.1-1.4/1.6-1.8:** SUPERSEDED headers on PRODUCT_SPEC, ROADMAP, BACKLOG,
  MILESTONE_WORK_PACKETS, DEPLOYMENT_COMPATIBILITY (each naming its
  replacement and date; none deleted); the false "do not skip unfinished
  black-hole correctness work" instruction in cosmic-atlas/ROADMAP.md
  corrected.

Gates: `npm run check` **66 files / 756 unit** green (7.1/7.2);
`check-command-surface` ok (7.3); `git diff --stat -- src tests public`
EMPTY (7.6 — documentation-only, plus the permitted check script and its
package.json script entry); `openspec validate --strict` valid (7.7).
