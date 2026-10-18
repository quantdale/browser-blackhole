## ADDED Requirements

### Requirement: The hosted quality job SHALL run specification validation

The hosted quality job SHALL run strict validation of every active change and every archived change. A failure SHALL fail the job. The job SHALL NOT treat a missing validator invocation as a pass.

#### Scenario: Archived validation fails

- **WHEN** strict archived validation reports a failure
- **THEN** the hosted quality job fails
- **AND** the failure is visible in the job log

#### Scenario: Active and archived validation pass

- **WHEN** strict validation of active changes and of archived changes both pass
- **THEN** the specification step of the quality job passes

#### Scenario: The validator is not invoked

- **WHEN** the quality job completes without running specification validation
- **THEN** the job does not satisfy this requirement
