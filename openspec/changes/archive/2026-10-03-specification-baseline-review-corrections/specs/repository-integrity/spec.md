## MODIFIED Requirements

### Requirement: Active executor instructions are unambiguous

The repository SHALL expose one current executor route that cannot be mistaken for a completed historical campaign. Current execution inventories SHALL derive active and archived populations and checklist completion from the repository at the stated revision or lifecycle stage, include newly proposed follow-up changes, and distinguish completed active changes awaiting archive from unfinished work. The executor route SHALL preserve the authoritative shared-file ordering unless an explicitly assigned, bounded correction takes precedence for that session.

#### Scenario: Fresh autonomous agent starts from repository root

- **GIVEN** an agent with no prior session context
- **WHEN** it reads the documented startup path
- **THEN** it SHALL be routed to the current OpenSpec campaign order
- **AND** it SHALL NOT be instructed to restart completed M0–M11 work.

#### Scenario: A follow-up proposal changes the inventory

- **GIVEN** a new follow-up change has been proposed and its implementation checklist remains unfinished
- **WHEN** the current execution inventory is refreshed
- **THEN** that change SHALL be counted and identified as unfinished active work
- **AND** the active and archived subtotals SHALL reconcile with the actual folders and task lists rather than a copied historical total.

#### Scenario: A completed change is waiting to be archived

- **GIVEN** an active change has completed its implementation checklist but has not been archived
- **WHEN** its status is described
- **THEN** it SHALL be distinguished from both archived changes and unfinished active changes
- **AND** it SHALL NOT be queued for re-application merely because its folder remains active.

#### Scenario: The assigned correction is complete

- **GIVEN** a session is assigned only a planning-baseline correction
- **WHEN** the correction's acceptance criteria pass
- **THEN** its handoff SHALL preserve the existing shared-file ordering for later work
- **AND** the correction session SHALL NOT automatically launch unrelated runtime implementation or restart a closed campaign.

### Requirement: Public capability/status claims match evidence

README and current-state claims SHALL describe the actually implemented/validated system rather than stale milestone state. A current completion claim SHALL identify the revision supported by its certification evidence. Corrections to immutable historical claims SHALL explicitly identify the superseded claim, the corrected claim and supporting evidence without rewriting archived records. Current evidence and provenance citations SHALL resolve to retained files or an explicitly identified historical revision. Validation totals SHALL identify their command, population and lifecycle stage, and SHALL NOT conflate active changes, baseline specifications and archived changes.

#### Scenario: A previously in-progress milestone is complete

- **GIVEN** durable test/performance evidence marks the milestone complete
- **WHEN** current user-facing status is read
- **THEN** it SHALL NOT still present that milestone as in progress.

#### Scenario: Timing source is described

- **GIVEN** a benchmark/performance statement references frame timing
- **WHEN** timing is CPU/rAF-derived rather than a GPU timestamp
- **THEN** it SHALL be labeled accordingly
- **AND** true GPU timestamp measurements SHALL be identified only where actually available.

#### Scenario: Scientific fidelity is described

- **GIVEN** a production phenomenon is labeled `DIRECT`, `DATA_DRIVEN` or `PROCEDURAL_SCIENTIFIC`
- **WHEN** the user-facing/scientific docs describe the feature
- **THEN** the label/claim SHALL match the implementation and validation evidence.

#### Scenario: An earlier checkpoint is mislabeled as final

- **GIVEN** a historical completion header names an earlier implementation checkpoint
- **AND** later implementation changes and certification evidence establish a different final certified revision
- **WHEN** the current completion record is read
- **THEN** it SHALL identify the final certified revision and its supporting task/certification record
- **AND** it SHALL distinguish the earlier checkpoint from final certification rather than inheriting the incorrect final label.

#### Scenario: A correction concerns an immutable archive

- **GIVEN** a reviewed error is in an archived record
- **WHEN** a correction is published
- **THEN** the archive SHALL remain unchanged
- **AND** a current, discoverable correction record SHALL identify the affected archived claim and the evidence-backed replacement
- **AND** current execution and certification guidance SHALL link that correction rather than repeat the erroneous claim as authoritative.

#### Scenario: An evidence file has moved to an archive

- **GIVEN** a retained task record, defect ledger or source-lock design moved during archiving
- **WHEN** a current document cites it as evidence
- **THEN** the citation SHALL resolve to the retained archive path or an explicitly identified historical revision
- **AND** an unqualified missing working-tree path SHALL NOT be presented as a live evidence location.

#### Scenario: Validation runs before and after archiving

- **GIVEN** archiving changes the set of active changes and may update baseline specifications
- **WHEN** validation results are recorded
- **THEN** each result SHALL identify the exact command and whether it was gathered before or after archiving
- **AND** change-only and spec-only totals SHALL describe their respective populations
- **AND** the aggregate total SHALL count only the items actually validated by that command, not every archived campaign.
