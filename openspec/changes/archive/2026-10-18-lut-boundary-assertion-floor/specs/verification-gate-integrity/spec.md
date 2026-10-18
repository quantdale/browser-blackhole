## ADDED Requirements

### Requirement: A status-filtered classification check SHALL count the subjects it compared

A test that claims to check classification on both sides of a critical boundary SHALL assert the number of subjects it actually compared. An assertion that runs only when a subject is not excluded SHALL NOT by itself satisfy this requirement. Exclusion, including an explicit numerical fallback, SHALL reduce the compared count. If the compared count is below the test's stated minimum, the test SHALL fail.

#### Scenario: Both boundary samples are excluded

- **WHEN** every sample a critical-boundary classification test would assert is excluded by a status filter
- **THEN** the test fails
- **AND** it does not report as passed

#### Scenario: One side of the boundary is excluded

- **WHEN** only one of the two boundary samples is compared
- **THEN** the test fails
- **AND** the failure names the expected minimum and the actual compared count

#### Scenario: Both sides are compared and agree

- **WHEN** one sample below the critical boundary and one sample above it are both compared
- **AND** each has the classification the test claims for that side
- **THEN** the test passes
