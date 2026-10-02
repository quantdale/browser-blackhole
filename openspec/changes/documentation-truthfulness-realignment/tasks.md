# Tasks — Documentation truthfulness realignment

**Runs after `operations-and-deployment-readiness`**, which settles the dependency-audit and Python
toolchain positions that these documents must then state.
**Documentation only.** The single permitted code change is the optional fixture script and the new
consistency check.

## 0. Baseline

- [ ] 0.1 Record `git rev-parse HEAD` and clean `git status --short`.
- [ ] 0.2 Run `npm run check` and record the result (proves the documentation edits do not break the build).
- [ ] 0.3 Run `npm audit` and record the current output verbatim, including the dev-only scope.
- [ ] 0.4 Re-derive each corrected claim from the code before editing the document, so the correction is evidence-based.

## 1. Supersession headers

- [ ] 1.1 Add a supersession header to `docs/PRODUCT_SPEC.md` naming the Cosmic Atlas documents that replaced it.
- [ ] 1.2 Add one to `docs/ROADMAP.md`.
- [ ] 1.3 Add one to `docs/BACKLOG.md`.
- [ ] 1.4 Add one to `docs/MILESTONE_WORK_PACKETS.md`.
- [ ] 1.5 Add one to `docs/KERR_RESEARCH_PLAN.md`, noting M9 is complete.
- [ ] 1.6 Add one to `docs/DEPLOYMENT_COMPATIBILITY.md`, or retire it and fold its live content into `docs/DEPLOYMENT.md`.
- [ ] 1.7 Do NOT delete any of these documents. Each header names what replaced it and when.
- [ ] 1.8 Correct the false instruction in `docs/cosmic-atlas/ROADMAP.md` that tells the reader not to skip unfinished black-hole correctness work.

## 2. Required-reading list

- [ ] 2.1 Complete the realignment of `AGENTS.md`. An interim banner may already warn that the numbered list is not the live queue. Replace that banner and list with current documents: `docs/MASTER_PLAN.md`, the atlas architecture, the physics and numerics documents, and the current certification. Do not restore the old list as required live reading.
- [ ] 2.2 Move `PRODUCT_SPEC.md`, `ROADMAP.md`, `BACKLOG.md` and `MILESTONE_WORK_PACKETS.md` into an explicitly labelled historical section. Keep their physics and history value; remove their authority as the work queue.
- [ ] 2.3 Verify by fresh-agent reading: following the list leads to current work, not to a finished campaign.

## 3. Release certification

- [ ] 3.1 Consolidate `docs/RELEASE_CERTIFICATION.md` to ONE authoritative gate table carrying a commit and a date.
- [ ] 3.2 Move the older run to a clearly dated "superseded evidence" appendix.
- [ ] 3.3 Replace the frozen "0 vulnerabilities" claim with the current result, its date, its dev-only scope and the fact that a fix is available.
- [ ] 3.4 Do NOT re-run any gate as part of this change. It corrects claims; it does not re-certify.
- [ ] 3.5 Add an explicit note that the audit result must be re-checked at each certification, not carried forward.

## 4. Command-surface check

- [ ] 4.1 Decide the `physics:fixtures` question: implement the script, or remove the reference and document the manual procedure. Do not leave the reference either way.
- [ ] 4.2 Write a script that extracts every `npm run <name>` from every document, README and agent-instruction file and fails if any is absent from the command surface.
- [ ] 4.3 Add a reviewed allowlist for commands that are intentionally manual, with a reason per entry.
- [ ] 4.4 Wire the check into CI.
- [ ] 4.5 Confirm the check passes.

## 5. Architecture and phenomena documents

- [ ] 5.1 Replace `docs/cosmic-atlas/ARCHITECTURE.md` section 2 with the actual shipped tree.
- [ ] 5.2 Move the aspirational layout to an appendix explicitly headed as a target topology.
- [ ] 5.3 Verify every path listed in the corrected section exists.
- [ ] 5.4 Mark the Stellar Merger, Solar Activity and Gravitational Lensing Lab sections of `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md` as unimplemented expansions.

## 6. Provenance and control catalogues

- [ ] 6.1 Resolve the galaxy-collision data-source contradiction in favour of `DATA_SOURCES_GALAXY_COLLISION_SOURCE_LOCK.md`.
- [ ] 6.2 Correct the identifiers in `DATA_SOURCES_GALAXY_COLLISION.md` to match the source-lock record.
- [ ] 6.3 Correct its parameter-provenance claim: the scenario is repository-derived; the source establishes the method, not the parameter values. Make the correction explicit and note that it strengthens rather than weakens the claim.
- [ ] 6.4 Cross-reference the two control catalogues; make the atlas one govern and drop the "authoritative" claim from the root one, while keeping its implementation-level contracts.
- [ ] 6.5 Cross-check every remaining identifier in both data-source documents against the runtime manifest.

## 7. Validation and evidence

- [ ] 7.1 `npm run format:check` and `npm run lint` clean.
- [ ] 7.2 `npm run typecheck` and `npm test` still pass.
- [ ] 7.3 The new documentation-consistency check passes.
- [ ] 7.4 Fresh-agent review of `AGENTS.md` and `openspec/AGENTS.md` confirms both lead to current work.
- [ ] 7.5 Claim audit: re-derive each corrected claim from the code and confirm it matches.
- [ ] 7.6 Confirm no product code changed: `git diff --stat -- src tests public` is empty; only `package.json` and the new check script differ.
- [ ] 7.7 `openspec validate documentation-truthfulness-realignment --type change --strict` passes.

## 8. Close-out

- [ ] 8.1 Strike findings D-06 through D-12, D-14 and D-15 from `docs/MASTER_PLAN.md` with their resolution commit.
- [ ] 8.2 Append evidence to `.agent/STATE.md`.
- [ ] 8.3 Commit this change as one coherent checkpoint.
