## Purpose

Defines the contract that the repository's specification artifacts are machine-validatable, that a
change's declared status matches its recorded state, that the execution instructions describe the
repository as it actually is, and that completed work produces a baseline capability specification
against which future changes can express modified behaviour.

## ADDED Requirements

### Requirement: The specification toolchain SHALL be configured and healthy

The repository SHALL provide a specification configuration file, and the specification tooling
SHALL report the repository as healthy when run against it.

#### Scenario: Health check on a fresh checkout

- **WHEN** the specification tooling's health check is run against the repository
- **THEN** it reports the repository as healthy
- **AND** it reports no missing required configuration

#### Scenario: Configuration is version-controlled

- **WHEN** the repository is checked out fresh
- **THEN** the specification configuration is present
- **AND** no local setup step is required before the tooling can be used

### Requirement: Every change SHALL pass strict validation

Every change in the repository SHALL validate under the strictest available validation mode, and a
validation failure SHALL be treated as a defect in the change rather than as an accepted state.

#### Scenario: A change omits a required scenario

- **WHEN** a change contains a requirement with no scenario
- **THEN** strict validation fails
- **AND** the change is not considered complete until it passes

#### Scenario: A requirement body carries no normative statement

- **WHEN** a requirement states a rule only in its heading and not in its body
- **THEN** strict validation fails
- **AND** the failure is resolved by moving the normative statement into the body

#### Scenario: Aggregate validation

- **WHEN** strict validation is run across all changes
- **THEN** every change passes
- **AND** no change is exempt by virtue of being already implemented

#### Scenario: A change with no behavioural delta

- **WHEN** a change introduces no externally observable behaviour change
- **THEN** it declares that explicitly
- **AND** it is not required to carry an invented requirement

### Requirement: A change's declared status SHALL match its recorded state

A change SHALL declare a status that matches its task list, its implementation record and the
project's certification documents. A change that is implemented SHALL not declare that no
implementation occurred.

#### Scenario: An implemented change's status is read

- **WHEN** a change's status is read
- **THEN** it states that the change was implemented
- **AND** it names the implementing revision or date
- **AND** it agrees with the change's own task list

#### Scenario: Deferred tasks are interpretable

- **WHEN** a change is complete with tasks left unchecked
- **THEN** each unchecked task is annotated with why it was deferred or rejected
- **AND** the reported completion count is explainable from the annotations

#### Scenario: Status and certification agree

- **WHEN** a change's status is compared against the project's certification documents
- **THEN** they do not contradict each other

### Requirement: Execution instructions SHALL describe the repository as it is

The repository's agent-facing execution instructions SHALL enumerate the changes that exist, state
the ordering constraints that actually apply, and name a single set of planning sources of truth.

#### Scenario: An agent reads the execution instructions

- **WHEN** an agent reads the repository's execution instructions
- **THEN** every change present in the repository is accounted for
- **AND** no change listed there is already complete and closed

#### Scenario: Ordering constraints are real

- **WHEN** the instructions state an ordering or prerequisite
- **THEN** the stated constraint reflects the actual state of the changes it names

#### Scenario: A single source of truth

- **WHEN** the instructions name planning sources of truth
- **THEN** exactly one document is named as current for each concern
- **AND** any other relevant document is named as historical

### Requirement: Completed work SHALL produce a baseline capability specification

When a change is completed, its behavioural requirements SHALL be incorporated into a baseline
capability specification, and the completed change SHALL be archived.

#### Scenario: A change is archived

- **WHEN** a change is archived
- **THEN** its requirements are present in a baseline capability specification
- **AND** the archived change is no longer presented as pending work

#### Scenario: A later change modifies existing behaviour

- **WHEN** a new change alters behaviour that a baseline capability already specifies
- **THEN** the new change declares that capability as modified
- **AND** it is validated against the existing capability rather than redeclared as new

#### Scenario: Capabilities are not duplicated

- **WHEN** two changes describe the same capability
- **THEN** they reference the same capability path
- **AND** they do not create divergent capabilities under different names

#### Scenario: Archived work is not lost

- **WHEN** a change is archived
- **THEN** its design rationale, task record and evidence remain retrievable
