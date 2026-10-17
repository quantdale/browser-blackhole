## ADDED Requirements

### Requirement: Planning-complete SHALL NOT be reported as implementation-complete

A change whose planning artifacts exist and whose implementation checklist has no completed task SHALL be reported as implementation-not-started. A tooling flag that means only that planning artifacts exist SHALL NOT be the repository's implementation-status authority. The change's own status header SHALL state that implementation has not started, and an automated check SHALL fail if that header claims implementation is complete while the checklist is untouched.

#### Scenario: Planning artifacts exist and no task is complete

- **WHEN** an active change has every planning artifact and zero completed implementation tasks
- **THEN** repository status reports implementation as not started
- **AND** it does not report the change as implementation-complete

#### Scenario: A header claims implementation is complete

- **WHEN** that change's own status header says implementation is complete
- **THEN** the automated check fails

#### Scenario: Implementation later starts

- **WHEN** at least one implementation task is completed with evidence
- **THEN** repository status may report the change as in progress
- **AND** it still does not report the change as implementation-complete until the checklist says so
