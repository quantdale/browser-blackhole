## ADDED Requirements

### Requirement: Archived changes SHALL pass strict validation in the automated gate

The automated quality gate SHALL run strict validation of active changes and of archived changes. A bare unchecked task in an archived change SHALL fail that gate. A task annotated as deferred or rejected SHALL remain recorded and SHALL NOT be marked complete. It SHALL NOT remain an unchecked checkbox, because an unchecked checkbox means work is still required.

#### Scenario: An archived change has a bare unchecked task

- **WHEN** strict archived validation runs
- **AND** an archived change contains an unchecked task with no deferral or rejection annotation
- **THEN** the gate fails
- **AND** the failure names the change

#### Scenario: Deferred work is recorded without an open checkbox

- **WHEN** an archived change records work as deferred or rejected
- **THEN** the record remains readable
- **AND** that item is not an unchecked checkbox
- **AND** it is not marked as completed work

#### Scenario: The quality gate omits archive validation

- **WHEN** the automated quality gate does not run strict archived validation
- **THEN** the gate does not satisfy this requirement
