## Purpose

Defines the contract that the shipped application satisfies its own documented static-hosting
requirements, that those requirements are exercised by an automated check rather than assumed from
development tooling, and that the supply-chain and release-tooling surface is gated.

## ADDED Requirements

### Requirement: The documented static-host contract SHALL be satisfiable from the repository

Every mandatory host requirement stated in the deployment contract SHALL be satisfiable by copying
an artifact committed in this repository, without the operator having to reconstruct it.

#### Scenario: A deep link on a static host

- **WHEN** the built application is served by a static host using the committed configuration
- **THEN** a deep link such as the black-hole destination route returns the application shell
- **AND** the application boots and renders

#### Scenario: Browser history works on a static host

- **WHEN** a user navigates between destinations and then uses browser back and forward
- **THEN** the application restores the corresponding destination
- **AND** no request returns a not-found response

#### Scenario: A missing asset is still a not-found

- **WHEN** a request is made for an asset that does not exist
- **THEN** the host returns a not-found response for that asset
- **AND** it does not serve the application shell in place of a missing asset

#### Scenario: Caching headers

- **WHEN** the deployment contract requires immutable caching for hashed assets and no caching for
  the application shell
- **THEN** the committed configuration expresses that policy
- **AND** it is documented which host families it applies to

#### Scenario: Repository-root configuration is not published as an asset

- **WHEN** a host reads its configuration from the repository root rather than the publish directory
- **THEN** that configuration is not placed under `public/`
- **AND** the production build does not contain it as an application asset
- **AND** a missing runtime asset still returns a not-found response

### Requirement: The deployment contract SHALL be exercised by an automated check

The deployment contract SHALL be verified by serving the built application from a server that does
NOT provide history fallback, and asserting both the failure and the corrected behaviour. Verification
against development-server behaviour does not satisfy this requirement.

#### Scenario: A host without history fallback

- **WHEN** the built application is served without history fallback
- **THEN** a deep link request does not return the application shell
- **AND** the check records that the host configuration is required

#### Scenario: A host with the committed configuration

- **WHEN** the built application is served with the committed host configuration
- **THEN** a deep link request returns the application shell
- **AND** the application's own boot checks still pass

#### Scenario: The check runs without a graphics device

- **WHEN** the deployment contract check runs in an environment without a graphics device
- **THEN** it still validates routing, response status and asset resolution
- **AND** it does not require a renderer

### Requirement: Sub-path hosting SHALL be an explicit, supported position

The repository SHALL either support serving the application under a sub-path, or state the root-path
assumption explicitly and check that it holds.

#### Scenario: Sub-path build

- **WHEN** the application is built for a sub-path deployment
- **THEN** its asset references resolve under that sub-path
- **AND** the application boots from that sub-path

#### Scenario: Root-path build

- **WHEN** the application is built for a root-path deployment
- **THEN** its asset references resolve from the root
- **AND** a deep link on that deployment returns the application shell

#### Scenario: The assumption is documented

- **WHEN** a reader consults the deployment contract
- **THEN** the supported deployment shapes are enumerated
- **AND** an unsupported shape is named rather than left to be discovered

### Requirement: The continuous-integration surface SHALL be hardened and bounded

The continuous-integration workflow SHALL declare the minimum token permissions it needs, SHALL bound
job runtime, SHALL cancel superseded runs, and SHALL pin its actions to immutable references.

#### Scenario: Token permissions

- **WHEN** the workflow runs
- **THEN** it declares the minimum repository permissions it requires
- **AND** it does not inherit a broader default

#### Scenario: Superseded runs

- **WHEN** a new commit is pushed to a branch with a run in progress
- **THEN** the superseded run is cancelled
- **AND** it does not consume a runner to completion

#### Scenario: Runaway job

- **WHEN** a job hangs
- **THEN** it is terminated by the declared timeout
- **AND** it does not occupy a runner indefinitely

#### Scenario: Action immutability

- **WHEN** the workflow references an external action
- **THEN** that action is pinned to an immutable reference
- **AND** a mechanism keeps those references current

### Requirement: Dependency vulnerabilities SHALL be gated

The automated workflow SHALL report dependency vulnerabilities at a defined severity threshold and
SHALL fail when that threshold is exceeded, and any accepted exception SHALL be recorded with its
justification.

#### Scenario: A high-severity advisory is present

- **WHEN** a high-severity advisory is present in the dependency tree
- **THEN** the automated workflow fails

#### Scenario: Only lower-severity advisories are present

- **WHEN** no advisory at or above the threshold is present
- **THEN** the automated workflow passes that gate

#### Scenario: A runtime dependency advisory

- **WHEN** an advisory affects a production runtime dependency
- **THEN** it is treated as blocking regardless of the threshold used for development-only
  dependencies

#### Scenario: An accepted exception

- **WHEN** an advisory is accepted rather than remediated
- **THEN** the acceptance is recorded with its scope, its justification and a review date

#### Scenario: Reviews report new advisories

- **WHEN** a change introduces a dependency
- **THEN** the review reports whether it introduces a known advisory

### Requirement: The offline scientific toolchain SHALL be pinned and SHALL fail informatively

The offline data-reduction toolchain SHALL declare a supported interpreter range, and any entry point
whose dependencies are unavailable on the running interpreter SHALL fail with a message naming the
dependency and the supported range.

#### Scenario: Unsupported interpreter

- **WHEN** the reduction tool is run on an interpreter its dependencies do not support
- **THEN** it terminates with a message naming the missing dependency and the supported interpreter
  range
- **AND** it does not report a bare import failure

#### Scenario: Supported interpreter

- **WHEN** the reduction tool is run on a supported interpreter
- **THEN** it runs the reduction
- **AND** the toolchain version it records identifies the interpreter it ran on

#### Scenario: The supported range is documented

- **WHEN** an operator consults the onboarding and toolchain documentation
- **THEN** the supported interpreter range is stated

#### Scenario: Reproducibility is stated

- **WHEN** the toolchain documentation describes reproducing a committed artifact
- **THEN** it states the conditions under which reproduction is exact
- **AND** it does not imply reproducibility is available on every current interpreter

### Requirement: Generated scientific artifacts SHALL match their declared parameters

Where a data generator accepts parameters describing the scenario it will emit, the emitted artifact
SHALL be produced from those parameters, and the generator SHALL verify the correspondence before
writing.

#### Scenario: A parameter is changed

- **WHEN** a scenario parameter supplied to the generator differs from the previously used value
- **THEN** the emitted artifact reflects the new parameter
- **AND** the emitted manifest records the new parameter

#### Scenario: Parameters are not applied

- **WHEN** a generator receives parameters it does not apply
- **THEN** it fails before writing
- **AND** it does not emit a manifest asserting parameters the artifact does not implement

#### Scenario: The correspondence is self-checked

- **WHEN** the generator emits an artifact
- **THEN** it verifies the emitted scenario against the parameters it was given
- **AND** the verification is reported with the artifact

### Requirement: Tooling that inspects configuration SHALL NOT invoke a shell unnecessarily

A tooling script that executes external commands with arguments derived from a configuration file
SHALL invoke them without a command interpreter, and its path-safety rules SHALL be anchored to path
syntax rather than matching arbitrary substrings.

#### Scenario: An external command is invoked

- **WHEN** the preflight script invokes a package query
- **THEN** it invokes the executable directly with an argument array
- **AND** it does not pass a configuration-derived string through a command interpreter

#### Scenario: A version range is inspected

- **WHEN** the preflight script inspects a pinned version range for home-directory references
- **THEN** an ordinary version range is not reported as a home-directory path
- **AND** a genuine absolute home-directory reference is still reported

#### Scenario: The preflight gate is trusted

- **WHEN** the preflight script passes a configuration
- **THEN** it has in fact evaluated the configuration as parsed
- **AND** its own parsing has been tested against a configuration containing values that could be
  truncated by a naive comment stripper
