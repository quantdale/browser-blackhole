# Proposal — Specification baseline review corrections

Status: **PROPOSED — not applied.**
Reviewed checkpoint: `5bbd2cc97e57f9a0ef4a4cfba0a92a3fe59068fa` against `4aa442a`.
Scope: planning, specifications and documentation only.

## Why

The Phase 0 apply passes OpenSpec validation but still contains four source-reviewed defects: a wrong cinematic completion revision, a vacuous neutron-star fidelity scenario, evidence citations broken by archiving, and stale inventory/validation counts. Correct these before treating the planning baseline as semantically signed off; this is not a new physics or rendering campaign.

## What Changes

- Publish a linked correction record naming `17c4644` as the restored cinematic campaign's final certified checkpoint, not the earlier `2fc1b5d` checkpoint. Explicitly supersede the wrong archived proposal/master-plan headers and the corresponding Phase 0 state claim without rewriting immutable archives or deleting historical state.
- Replace the neutron-star fidelity requirement's vacuous scenario through a `MODIFIED` delta. Independently cover an absent/unvalidated surface path, incomplete reference validation, and failing/missing production parity; retain the existing permission to claim direct rendering when all prerequisites hold. Do not change the physical model or its tolerances.
- Redirect current evidence/provenance citations for all six archived campaigns to their actual archive locations. Preserve historical quotations with an explicit historical-revision or correction-map reference rather than treating missing working-tree paths as live evidence.
- Derive active, archived, complete and unfinished change counts from the current tree/task lists, including this change. Label validation results by command and lifecycle stage: change-only, spec-only and aggregate results are different populations.
- Add this bounded follow-up to the current execution inventory and record its evidence. Restore the existing `docs/MASTER_PLAN.md` §7 order after it closes; do not restart Phase 0 or launch Phase 1 from the correction session.

There are no runtime breaking changes. Applying this proposal changes repository documentation contracts, not application behavior.

## Capabilities

### New Capabilities

- None. Reuse the existing baseline capabilities rather than inventing a second hygiene capability.

### Modified Capabilities

- `repository-integrity`: strengthen the existing executor/status contracts with tree-derived inventories, resolvable current evidence citations, explicit corrections to immutable historical claims, and command/stage-qualified validation counts.
- `neutron-star-surface-lensing`: clarify acceptance scenarios for the existing **Neutron Star production fidelity claim** requirement, with independent mandatory negative outcomes and a supported positive case.

## Impact

**Implementation artifacts (in the later apply session):**

- `docs/SPECIFICATION_BASELINE_CORRECTIONS.md` (new, authoritative for these four corrections and their evidence).
- `openspec/AGENTS.md`, `openspec/project.md`, `docs/MASTER_PLAN.md` and `.agent/STATE.md`: narrowly update the correction route, references, inventory and superseding evidence.
- Current evidence citations in `docs/VISUAL_FIDELITY_CERTIFICATION.md`, `docs/RELEASE_CERTIFICATION.md`, `docs/PERFORMANCE_CERTIFICATION.md`, `docs/OBSERVABILITY_DIAGNOSTICS.md`, `docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION_SOURCE_LOCK.md` and the active spatial-atlas master plan; inspect the actual tree for other current citations affected by the same six archive moves.
- The two existing baseline capability specs, updated by the normal OpenSpec spec-merge/archive operation after application, not by duplicating their requirements under new capability names.

**Boundaries:** no changes to `src/`, `tests/`, `scripts/`, `tools/`, `public/`, dependencies, CI/build configuration, scientific parameters, thresholds, goldens or benchmark data. Existing `openspec/changes/archive/**` files remain unchanged. No new browser/GPU certification, no unrelated documentation realignment, and no remote push.

**Dependencies:** the structural Phase 0 checkpoint already landed at `5bbd2cc`; this is its narrow review follow-up, not a re-application of `specification-baseline-hygiene`. Use one documentation/specification writer. The application prompt is `APPLY_PROMPT.md` in this change folder.
