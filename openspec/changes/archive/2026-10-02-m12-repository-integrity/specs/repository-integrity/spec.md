# Repository-integrity delta specification

## ADDED Requirements

### Requirement: Active executor instructions are unambiguous

The repository SHALL expose one current executor route that cannot be mistaken for a completed historical campaign.

#### Scenario: Fresh autonomous agent starts from repository root

- **GIVEN** an agent with no prior session context
- **WHEN** it reads the documented startup path
- **THEN** it SHALL be routed to the current OpenSpec campaign order
- **AND** it SHALL NOT be instructed to restart completed M0–M11 work.

### Requirement: Dependency policy matches manifests

Direct dependency version policy SHALL agree with `package.json`, `package-lock.json` and dependency documentation.

#### Scenario: Exact-pin policy is retained

- **GIVEN** the repository states that direct dependency versions are exact pins
- **WHEN** the direct manifest is inspected
- **THEN** covered dependencies SHALL NOT use `^` or `~` ranges
- **AND** a clean `npm ci` SHALL reproduce the lockfile without unintended upgrades.

### Requirement: Hosted browser CI has an explicit coverage contract

The hosted browser job SHALL describe and execute the same scope.

#### Scenario: Hosted job is a fallback suite

- **GIVEN** the workflow invokes the broad Playwright suite under fallback capability
- **WHEN** maintainers inspect the job name/comments/docs
- **THEN** they SHALL describe broad fallback-suite semantics and expected capability skips rather than calling it only a smoke test.

#### Scenario: Hosted job is intentionally smoke-only

- **GIVEN** project policy chooses smoke-only hosted coverage
- **WHEN** the workflow runs
- **THEN** it SHALL invoke an explicit smoke project/spec/tag
- **AND** documentation SHALL state which release/full-suite evidence remains outside that job.

### Requirement: Timing-sensitive browser assertions wait on behavior

Tests SHALL prefer observable postconditions over arbitrary sleeps when a deterministic state/event is available.

#### Scenario: Waveform cursor synchronization is delayed under load

- **GIVEN** the black-hole-merger waveform/cursor update completes asynchronously
- **WHEN** the browser test waits for synchronization
- **THEN** it SHALL poll/wait for the relevant bounded postcondition
- **AND** failure output SHALL identify the unmet condition
- **AND** the test SHALL NOT rely solely on increasing a fixed sleep duration.

### Requirement: Production benchmark harnesses are discoverable

Maintained benchmark harnesses for production destinations SHALL have consistent invocation paths or explicitly documented exceptions.

#### Scenario: Maintainer wants to benchmark a production destination

- **GIVEN** a maintained benchmark harness exists for that destination
- **WHEN** package scripts are inspected
- **THEN** a predictably named benchmark command SHALL expose it
- **AND** benchmark documentation SHALL not imply unavailable evidence.

### Requirement: Public capability/status claims match evidence

README and current-state claims SHALL describe the actually implemented/validated system rather than stale milestone state.

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

### Requirement: Integrity hardening does not change scientific rendering accidentally

Repository-integrity work SHALL not alter visual/scientific output unless a separate specified behavior change requires it.

#### Scenario: Integrity pass changes a visual golden

- **GIVEN** only control-plane, dependency-policy, CI, test synchronization, benchmark invocation or documentation work is intended
- **WHEN** a visual baseline differs
- **THEN** the difference SHALL be treated as an unexpected regression and investigated
- **AND** the baseline SHALL NOT be regenerated merely to close the integrity change.
