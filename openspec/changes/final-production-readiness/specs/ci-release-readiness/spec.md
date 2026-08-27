# CI / release-readiness delta specification

## ADDED Requirements

### Requirement: Hosted CI executes the coverage it claims

Every browser engine and suite the hosted CI reports as covered SHALL actually run in CI with the required browser installed. CI SHALL NOT name or imply coverage it does not execute.

#### Scenario: Firefox compatibility is claimed

- **GIVEN** the workflow declares Firefox compatibility coverage
- **WHEN** the CI browser jobs run
- **THEN** a job SHALL install Firefox and execute the `firefox` Playwright project
- **AND** that job SHALL fail loudly if the Firefox browser is missing, never pass while skipping Firefox.

#### Scenario: A hosted job cannot validate a GPU-only gate

- **GIVEN** a suite (e.g. hardware-WebGPU visual goldens) whose baselines require a capability the hosted runner lacks
- **WHEN** the CI topology is defined
- **THEN** that suite SHALL be excluded from the hosted job and routed to a capable runner
- **AND** its status SHALL be recorded as environment-deferred with a reason, never marked PASS on the hosted runner.

### Requirement: Hosted browser CI is deterministic under software rendering

The hosted browser suite SHALL be scheduled so that software-WebGL2 CPU contention cannot cause nondeterministic arrival/transition timeouts. Concurrency SHALL be reduced rather than behavioral coverage.

#### Scenario: Heavy render tests run on a shared-CPU runner

- **GIVEN** hosted runners render every scene through software WebGL2 on limited vCPUs
- **WHEN** the behavioral+parity suite runs
- **THEN** it SHALL run with a single worker per runner (no two render contexts sharing a CPU)
- **AND** wall-clock MAY be restored by sharding across independent runners
- **AND** the arrival/transition state SHALL be reached within its poll on an uncontended runner.

#### Scenario: A green run is claimed stable

- **GIVEN** the browser jobs previously flaked from contention
- **WHEN** stability is asserted
- **THEN** there SHALL be at least three consecutive full green runs of the flaky-risk jobs
- **AND** a single lucky green run SHALL NOT be treated as sufficient.

### Requirement: Documented commands succeed on a clean cross-platform checkout

The documented aggregate gate (`npm run check`) SHALL pass on a fresh checkout on Linux, Windows and macOS without manual line-ending fixes.

#### Scenario: Windows contributor runs the documented gate

- **GIVEN** a fresh clone on Windows with `core.autocrlf=true`
- **WHEN** the contributor runs `npm run check`
- **THEN** `format:check` SHALL pass because text files are checked out as LF via `.gitattributes`
- **AND** content-addressed binary artifacts SHALL NOT be line-ending normalized.

### Requirement: Release state agrees with CI state

Control-plane documentation SHALL NOT declare a campaign complete or the project release-ready while hosted CI on the release branch is red.

#### Scenario: Docs claim completion

- **GIVEN** user-facing/agent docs state the project is production-ready
- **WHEN** hosted CI on `main` is inspected
- **THEN** CI SHALL be green
- **AND** a certification report SHALL cite the specific green runs, defect counts (P0=0, P1=0) and any environment-deferred gates.
