## Purpose

Defines the contract that a passing verification gate means the check it names actually ran,
actually measured the subjects it claims to cover, and would have failed if the property it
protects were broken.

## ADDED Requirements

### Requirement: A declared tolerance SHALL be enforced or explicitly marked unenforced

A tolerance stated in a test's documented description SHALL be asserted by that test, or the test
SHALL be marked as measurement-only in a way that is visible in the test report and in the source.

#### Scenario: A declared tolerance is breached

- **WHEN** a measured quantity exceeds a tolerance the test's own description declares
- **THEN** the test fails

#### Scenario: A measurement-only test is honestly marked

- **WHEN** a test computes a quantity without asserting a bound
- **THEN** it is marked as measurement-only in its name and in a source comment
- **AND** it does not use a name that claims a tolerance it does not apply

#### Scenario: Computed values are not silently discarded

- **WHEN** a test computes a value that it does not assert
- **THEN** the value is either asserted or explicitly recorded as a diagnostic

### Requirement: A test SHALL assert how many subjects it compared

A test that can exclude or skip individual subjects SHALL assert the number of subjects it actually
compared, against a stated minimum, before or alongside its substantive assertions.

#### Scenario: Every subject is excluded

- **WHEN** all subjects in a test's corpus are excluded by a filter
- **THEN** the test fails
- **AND** it does not report as passed

#### Scenario: The corpus is smaller than expected

- **WHEN** the compared count falls below the test's stated minimum
- **THEN** the test fails
- **AND** the failure names the expected and actual counts

#### Scenario: A full corpus passes

- **WHEN** every subject is compared and the substantive property holds
- **THEN** the test passes

### Requirement: An image regression gate SHALL assert absolute content

An image regression gate SHALL assert, in addition to agreement with its baseline, that the captured
frame contains a minimum amount of the content it is meant to capture. A frame whose subject is
absent SHALL fail even when the surrounding background is unchanged.

#### Scenario: Subject removed from a sparse scene

- **WHEN** the subject of a scene is not rendered
- **THEN** the image regression gate for that scene fails
- **AND** it fails even if the background is pixel-identical to the baseline

#### Scenario: Content is present

- **WHEN** the scene renders its subject
- **THEN** the measured content floor is satisfied
- **AND** the relative-delta comparison is also applied

#### Scenario: All-scene content floors are defined

- **WHEN** the image regression suite is enumerated
- **THEN** every scene has an explicit content floor or an explicit documented exemption

### Requirement: Image regression baselines SHALL be inventoried

The set of committed image baselines and the set of scenes the suite exercises SHALL match in both
directions. A missing, renamed or orphaned baseline SHALL be detected by an automated check.

#### Scenario: A baseline is deleted

- **WHEN** a committed baseline referenced by a scene is absent
- **THEN** the inventory check fails

#### Scenario: A baseline is orphaned

- **WHEN** a committed baseline exists that no scene references
- **THEN** the inventory check fails

#### Scenario: A scene has no baseline

- **WHEN** a scene is declared with no corresponding committed baseline
- **THEN** the inventory check fails

### Requirement: Runtime asset resolution SHALL be covered by the gate

The code path a product uses to resolve a runtime asset — including any index or mapping file that
selects which asset is loaded — SHALL be covered by a test that runs in the automated gate.

#### Scenario: The asset index is corrupted

- **WHEN** the asset index selects a family or asset that does not exist
- **THEN** the automated gate fails

#### Scenario: The index selects a valid asset

- **WHEN** the index selects the shipped asset
- **THEN** the gate confirms the resolved asset passes its full structural and checksum validation

#### Scenario: Asset resolution failure is reported

- **WHEN** asset resolution fails at runtime
- **THEN** the failure is surfaced rather than silently degrading to a different backend

### Requirement: A degraded gate SHALL fail rather than pass quietly

When a gate's intended coverage is reduced for environmental reasons — an unavailable backend, a
missing capability — the gate SHALL fail or report a distinct, blocking outcome, and SHALL NOT report
the same result as a full pass.

#### Scenario: Backend unavailable in a gate environment

- **WHEN** a gate that requires a working backend runs in an environment without one
- **THEN** the gate does not report the same outcome as a full pass
- **AND** the reduced coverage is visible in the gate result

#### Scenario: Documented capability skip

- **WHEN** a gate row is skipped because a documented capability is unavailable
- **THEN** the skip is reported with its reason
- **AND** the overall gate outcome distinguishes a skip from a pass

### Requirement: Committed generated artifacts SHALL be provably current

An artifact generated by a tool and asserted by the test suite SHALL either be regenerated by the
automated gate and compared for drift, or be explicitly annotated with the conditions under which
it may be stale and excluded from a current claim.

#### Scenario: Generator output drifts

- **WHEN** the generating tool's output changes
- **THEN** the automated gate fails because the committed artifact no longer matches

#### Scenario: Artifact is historical

- **WHEN** a committed artifact is not regenerated by the gate
- **THEN** the test asserting it records that it verifies a stored verdict rather than a current
  measurement
- **AND** the artifact is annotated accordingly

#### Scenario: Tool cannot run in the gate environment

- **WHEN** the generating tool cannot run in the automated environment
- **THEN** the reason is documented
- **AND** the affected tests are listed explicitly

### Requirement: A gate SHALL contain no test that can pass without asserting

Every test in the automated gate SHALL contain at least one assertion, or SHALL be removed.

#### Scenario: A test with no assertions

- **WHEN** a test file contains a test with no assertion
- **THEN** that test is removed or converted into a real assertion

#### Scenario: Output-only debugging

- **WHEN** a test exists solely to print diagnostic output
- **THEN** it is not part of the automated gate
- **AND** its diagnostic value is preserved as a documented manual tool if it is still needed

### Requirement: Coverage SHALL be reported

The automated gate SHALL report statement, branch and function coverage of the production source
tree, and the report SHALL be recorded as evidence.

#### Scenario: Coverage report is produced

- **WHEN** the automated quality gate runs
- **THEN** a coverage report for the production source is produced
- **AND** the summary is recorded with the run

#### Scenario: Coverage is not used as a gate

- **WHEN** a module is deliberately covered only by browser tests
- **THEN** the coverage gate does not fail solely because of that module
- **AND** the deliberate exclusion is documented

#### Scenario: A new untested module is visible

- **WHEN** a new production module is added with no unit coverage
- **THEN** it appears in the coverage report with zero coverage
- **AND** the reviewing agent can see it

### Requirement: Capability failure modes SHALL be covered as data

Capability-driven decision logic SHALL be exercised over a table of capability snapshots covering
every documented failure mode, rather than only the nominal cases.

#### Scenario: A documented capability failure mode is untested

- **WHEN** the documented list of capability failure modes includes a case the tests do not exercise
- **THEN** the gap is visible
- **AND** the case is added to the table or explicitly marked as unreachable with a reason

#### Scenario: Required feature missing

- **WHEN** a required capability is absent while a nominally preferred backend is present
- **THEN** the decision logic is exercised for that snapshot

### Requirement: Destination enumeration SHALL be authoritative

Any check that enumerates registered components SHALL derive the enumeration from the same
authoritative source the product uses, and SHALL fail if discovery is incomplete.

#### Scenario: A component is registered but not enumerated

- **WHEN** a component is registered in the product registry but absent from the product's
  enumeration
- **THEN** the completeness check fails

#### Scenario: Discovery is incomplete

- **WHEN** the enumeration source cannot be read for one component
- **THEN** the completeness check fails
- **AND** it does not treat the omission as an acceptable floor