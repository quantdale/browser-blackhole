## Purpose

Defines the contract that a benchmark harness either reports a measurement or refuses, that a
refusal fails the process and its orchestrator, that every recorded result describes the environment
it was actually measured in, and that a regression claim is refused unless the compared runs are
comparable.

## ADDED Requirements

### Requirement: A harness SHALL fail the process when it refuses to report

A benchmark harness SHALL terminate with a non-zero exit status when it refuses to emit a
measurement. Setting an exit code and then exiting explicitly with a success status SHALL NOT be
used.

#### Scenario: The renderer produces no frames

- **WHEN** a benchmark harness observes that no frame was rendered during its sampling window
- **THEN** it emits its explicit refusal
- **AND** the process terminates with a non-zero exit status

#### Scenario: A required pre-condition is not met

- **WHEN** a harness verifies that the intended render path was active and finds it was not
- **THEN** it aborts
- **AND** the process terminates with a non-zero exit status

#### Scenario: A successful run

- **WHEN** a harness completes a valid measurement
- **THEN** it terminates with a zero exit status

### Requirement: An orchestrator SHALL fail when a child refuses

A benchmark orchestrator that runs child harnesses SHALL fail when any child refuses, regardless of
whether the child itself propagates a non-zero status.

#### Scenario: A child reports zero rendered frames

- **WHEN** an orchestrated run produces a child record reporting zero rendered frames
- **THEN** the orchestrator marks that workload as a failure
- **AND** the orchestrator terminates with a non-zero exit status

#### Scenario: A child reports a mismatched environment

- **WHEN** an orchestrated child reports a backend, tier or viewport different from the one
  requested
- **THEN** the orchestrator marks that workload as a failure

#### Scenario: A child aborts unexpectedly

- **WHEN** an orchestrated child exits non-zero
- **THEN** the orchestrator marks that workload as a failure and continues with the remaining
  workloads
- **AND** the overall run is reported as failed

### Requirement: A harness SHALL honour its invoked environment

A benchmark harness SHALL apply every environment parameter it is invoked with, including browser
channel, viewport dimensions, quality tier and backend preference.

#### Scenario: A non-default viewport is requested

- **WHEN** a harness is invoked with a viewport different from its default
- **THEN** the measured session uses the requested viewport
- **AND** the reported record states the requested viewport

#### Scenario: A non-default browser channel is requested

- **WHEN** a harness is invoked with a browser channel different from its default
- **THEN** the measured session uses the requested channel
- **AND** the reported record states the requested channel

#### Scenario: The internal render area is measured, not assumed

- **WHEN** a harness sizes the rendering surface for a measurement
- **THEN** it derives that size from the application's actual viewport element
- **AND** it does not hardcode an assumed user-interface size

### Requirement: A reported record SHALL describe the run that produced it

Every committed benchmark record SHALL identify the source revision it was measured from and the
environment it was actually measured in, and those values SHALL be read from the run rather than
supplied by the caller.

#### Scenario: The harness can read the source revision

- **WHEN** a harness records a result
- **THEN** the record states the current source revision as a full revision identifier
- **AND** it does not emit a placeholder when the revision is readable

#### Scenario: The source revision is explicitly pinned

- **WHEN** an operator pins the revision for a reproducibility run
- **THEN** the record states the pinned value
- **AND** a pinned value is distinguishable from a read one

#### Scenario: A historical record cannot be attributed

- **WHEN** a committed record has no attributable source revision
- **THEN** it is annotated in the campaign documentation as not attributable
- **AND** it is not presented as evidence for a specific revision

### Requirement: A harness SHALL NOT write into a certified evidence directory by default

A benchmark harness SHALL write to a run-specific location. Writing into a directory holding
certified historical evidence SHALL require an explicit override.

#### Scenario: Default invocation

- **WHEN** a harness is invoked without an output directory
- **THEN** it writes to a location derived from the current run
- **AND** no committed historical record is overwritten

#### Scenario: A run would overwrite a certified record

- **WHEN** a harness's output path resolves to a directory holding certified evidence
- **THEN** the harness refuses unless an explicit overwrite is requested
- **AND** the refusal explains which record would be affected

#### Scenario: Explicit overwrite

- **WHEN** an operator explicitly requests overwriting
- **THEN** the harness writes and records that the overwrite was intentional

### Requirement: A recorded run SHALL satisfy a machine-checkable schema

Every benchmark record SHALL conform to a versioned schema that states its measurement kind, its
unit of work, and its environment metadata. Records conforming to a superseded schema SHALL be
marked as such.

#### Scenario: A record omits required metadata

- **WHEN** a record is missing a required schema field
- **THEN** schema validation fails
- **AND** the record is not used as evidence

#### Scenario: A legacy record

- **WHEN** a committed record conforms to a superseded schema version
- **THEN** it is marked as legacy
- **AND** it is not compared automatically against current-schema records

### Requirement: A comparison SHALL be refused unless the runs are comparable

A benchmark comparison tool SHALL refuse to emit a percentage change between two runs whose
metadata differ in any dimension that affects the measurement, and SHALL name the differing
dimensions.

#### Scenario: Comparable runs

- **WHEN** two runs share the same backend, quality, preset, unit of work, internal resolution,
  browser, adapter and sample count
- **THEN** the comparison reports a percentage change

#### Scenario: Differing internal resolution

- **WHEN** two runs differ in internal render resolution
- **THEN** the comparison refuses
- **AND** it names internal resolution as a differing dimension

#### Scenario: Differing sample count

- **WHEN** two runs differ in the number of sampled frames
- **THEN** the comparison refuses
- **AND** it names the sample count as a differing dimension

#### Scenario: Differing record shape

- **WHEN** two records do not share a schema version
- **THEN** the comparison refuses
- **AND** it does not emit a percentage

#### Scenario: Explicit override

- **WHEN** an operator explicitly overrides a comparability refusal
- **THEN** the output states that comparability was overridden and which dimensions differed

### Requirement: Every harness SHALL be discoverable and SHALL report all its refusal reasons

A benchmark harness SHALL be invokable through the project's documented command surface, and a
record that carries more than one independent refusal SHALL report all of them.

#### Scenario: A harness is invoked from the documented surface

- **WHEN** an operator looks for the command that runs a harness
- **THEN** it is listed in the project's command surface and in the documentation

#### Scenario: A record has multiple refusals

- **WHEN** a measurement fails for more than one independent reason
- **THEN** every reason is reported
- **AND** the first reason is not silently replaced by a later one
PROPOSAL
echo written