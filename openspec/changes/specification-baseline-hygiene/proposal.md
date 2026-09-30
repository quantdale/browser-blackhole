## Why

This repository's planning substrate cannot be trusted, and every future change inherits that.

Four confirmed defects, all verified by running the tool:

1. **`openspec doctor` reports the root unhealthy** because `openspec/config.yaml` is missing. The
   project has an installed, configured OpenSpec toolchain (1.9.0, `spec-driven` schema) and no
   configuration file.

2. **Four of seven changes fail `openspec validate --changes --strict`.** The failures are
   mechanical: requirement bodies that do not carry a normative verb on the line after the
   requirement header, and requirements with no `#### Scenario:` block.
   `cinematic-visual-fidelity-overhaul` has 24 such errors, `whole-atlas-performance-optimization` 18,
   `m12-neutron-star-surface-lensing` 1, and `spatial-atlas-continuous-navigation` has no `specs/`
   directory at all. The delta specs are therefore not machine-checkable contracts — they are prose
   that happens to sit in a directory.

3. **Five changes are marked complete and none has been archived.** There is no `openspec/specs/`
   directory, so the repository has **no baseline capability specifications**. The consequence is
   structural, not cosmetic: a new change cannot declare a `MODIFIED` requirement against a
   capability, because no capability exists to modify. Every future change is forced into `ADDED`,
   which silently loses the ability to express "this changes existing behaviour".

4. **Two implemented changes still declare the opposite status in their own headers.**
   `whole-atlas-performance-optimization/proposal.md:4` and its `MASTER_PLAN.md:4` both read
   `Status: PLAN ONLY — NO PERFORMANCE IMPLEMENTATION IN THIS CHANGE`, while `tasks.md:1019` reads
   `COMPLETE at 179eb56` and `docs/PERFORMANCE_CERTIFICATION.md` records it as certified. The same
   contradiction exists in `cinematic-visual-fidelity-overhaul`. An agent reading the folder top-down
   is told twice that nothing was implemented, and discovers the opposite only in `tasks.md`.

5. **`openspec/AGENTS.md` describes a repository that no longer exists.** It states "This repository
   currently has three planned changes" and orders `m12-neutron-star-surface-lensing`,
   `m12-repository-integrity` and `ca9-galaxy-collision` as required execution order. All three are
   complete. The tree holds seven changes and `openspec/project.md` names a fourth campaign as
   active. `openspec/project.md` itself then names two different "sources of truth" audit documents
   (lines 34 and 79).

This violates the repository's own rule, stated in `openspec/project.md`: "When historical text
conflicts with an active OpenSpec change, do not silently choose one. Determine whether the
historical statement is stale, update it as part of the appropriate truthfulness task."

## What Changes

- **Add `openspec/config.yaml`** so the toolchain is configured and `openspec doctor` reports
  healthy.
- **Repair the four changes that fail strict validation** so the delta specs are real contracts.
- **Give `spatial-atlas-continuous-navigation` real deltas**, or an explicit marker that it carries
  no spec-level change, so it validates honestly rather than being a special case.
- **Correct the contradictory status headers** on the two implemented changes, and annotate the 58
  deferred task boxes so the completion count is interpretable.
- **Rewrite `openspec/AGENTS.md`** to describe the real change set, the real ordering constraints, and
  the archive policy.
- **Resolve the two-sources-of-truth conflict in `openspec/project.md`.**
- **Adopt and document the archive policy** so completed changes produce baseline capability
  specifications and future changes can express modified requirements.

Non-goals, explicitly out of scope:

- **Do not implement `spatial-atlas-continuous-navigation`.** It is a deliberate 0/123 product
  design gated behind prerequisites. This change makes its artifacts valid; it does not start it.
- No product-code change whatsoever. This is a planning-artifact change.
- No rewriting of the *content* of any specification delta. Only the structural defects are fixed;
  where a requirement genuinely has no scenario, the honest options are to add a scenario or to
  record that the requirement is documentation rather than a behavioural contract.
- No re-measurement or re-certification.

## Capabilities

### New Capabilities
- `specification-hygiene`: the contract that the repository's specification artifacts are
  machine-validatable, that a change's declared status matches its recorded state, that the
  execution instructions describe the repository as it actually is, and that completed work produces
  a baseline capability specification.

### Modified Capabilities
- None. This change creates the baseline; there is nothing to modify yet.

## Impact

**Affected artifacts**

- `openspec/config.yaml` (new).
- `openspec/changes/{cinematic-visual-fidelity-overhaul,whole-atlas-performance-optimization,
  m12-neutron-star-surface-lensing,spatial-atlas-continuous-navigation}/`.
- `openspec/AGENTS.md`, `openspec/project.md`.
- `openspec/specs/` (created by archiving, at the end).

**Affected tests**

- None. This change is verified by `openspec validate`, `openspec doctor` and `openspec list`.

**Affected documents**

- `openspec/project.md`'s "Planning/execution sources of truth" section.

**Dependencies**

- **None. This is Phase 0 and gates every other change.** It must complete first because the later
  changes' completion is judged against a trustworthy planning substrate.

**Compatibility risk**

- Low, with one caveat: correcting a status header from "PLAN ONLY" to "COMPLETE" is a
  documentation change that a diff reviewer must not mistake for a claim of new implementation. The
  header will state the implementing commit and date so the claim is verifiable rather than asserted.
