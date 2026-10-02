## Purpose

Defines the contract that every user-visible application failure — destination preparation,
asset loading, device loss, and unsupported backend — terminates in a state the user can see,
understand, and act on, and that the public state the application shell reads carries the
information needed to render that state.

## ADDED Requirements

### Requirement: Transition failure SHALL be published in the public application state

The public transition state the application shell reads SHALL carry the last transition error,
including the failing destination and whether the failure is fatal. The error SHALL be part of the
published contract rather than only internal director state.

#### Scenario: A preparation failure is published

- **WHEN** a destination's preparation rejects
- **THEN** the public transition state carries the error and the destination that failed
- **AND** the transition returns to the idle phase rather than remaining in a preparing phase

#### Scenario: A superseded attempt does not publish an error

- **WHEN** a preparation is aborted because a newer navigation request superseded it
- **THEN** no error is published
- **AND** the machine remains owned by the newer attempt

#### Scenario: A successful transition clears a previous error

- **WHEN** a transition completes successfully after an earlier failure
- **THEN** the published error is cleared

### Requirement: A preparation failure SHALL be visible to the user

When a destination fails to prepare, the application SHALL present a user-visible error that states
what failed, whether the application can continue, what state the application is in, and one
practical remediation.

#### Scenario: Destination chunk fails to load

- **WHEN** a user selects a destination and its lazy module fails to load
- **THEN** the user sees a message identifying the destination that failed
- **AND** the message states that the previous destination remains available
- **AND** the message offers at least one recovery action

#### Scenario: Destination dataset fails to load

- **WHEN** a destination's data asset fails its integrity or fetch check
- **THEN** the user sees a message identifying the destination
- **AND** the message states that the application remains usable and on the previous destination

#### Scenario: Failure is never reported only to the console

- **WHEN** any preparation failure occurs
- **THEN** at least one user-visible surface reflects it
- **AND** the console diagnostic is retained as a technical-detail channel rather than the only one

### Requirement: Recoverable failure SHALL be distinguishable from fatal failure

A failure that leaves the application usable SHALL be presented differently from one that
terminates the session, and the difference SHALL be conveyed in text and not by colour alone.

#### Scenario: Recoverable preparation failure

- **WHEN** a destination fails to prepare and the previous destination is still active
- **THEN** the presentation indicates the application is continuing
- **AND** a retry or equivalent recovery action is offered

#### Scenario: Fatal device loss

- **WHEN** the graphics device is lost
- **THEN** the presentation indicates a terminal state requiring reload
- **AND** it is not presented as a recoverable preparation failure

### Requirement: The user-visible error surface SHALL be reachable and announced

The surface carrying an error SHALL remain perceivable when the control panel is collapsed, and
SHALL be announced to assistive technology when it appears.

#### Scenario: Error while the panel is collapsed

- **WHEN** a failure occurs and the control panel is collapsed
- **THEN** the error is still perceivable to the user
- **AND** it is not hidden inside a subtree that is not rendered

#### Scenario: Assistive announcement

- **WHEN** an error appears
- **THEN** it is exposed through a live region that announces errors assertively
- **AND** the error meaning is available as text and is not conveyed by colour alone

#### Scenario: Error state survives a panel rebuild

- **WHEN** the panel is rebuilt after an error
- **THEN** the error remains visible

### Requirement: The unsupported-backend state SHALL carry remediation copy

When no usable render backend is available, the product route SHALL present the repository's
existing remediation guidance rather than a bare error code.

#### Scenario: Unsupported backend on the product route

- **WHEN** the application boots on a browser with neither WebGPU nor WebGL2
- **THEN** the user sees guidance describing what is required and what to try
- **AND** the presentation is not limited to an error code

#### Scenario: Guidance matches the legacy route's standard

- **WHEN** the product and legacy routes reach their unsupported state
- **THEN** both present remediation guidance to the user
- **AND** neither presents a bare code as the whole message

### Requirement: A stalled destination preparation SHALL terminate

A destination preparation SHALL terminate in a user-visible failure when it has an outstanding
abortable operation and no progress event occurs for the stall threshold. Elapsed time alone SHALL
NOT abort a preparation that continues to emit progress events. The stall threshold SHALL be at
least ten times the slow-load reporting threshold, and the two thresholds SHALL remain distinct.

A progress event is one of: settlement of the prepare operation; a `reportProgress` report whose
finite fraction is the first report or is strictly greater than the last accepted fraction; receipt
of response headers for that operation; or an increase in received response bytes. A changed label
without one of those events is not progress. A preparation that can neither report progress nor
expose fetch activity SHALL emit a start report and subsequent finite progress before the stall
gate applies to it.

#### Scenario: A data request never completes

- **WHEN** a destination's abortable data request remains pending and emits no progress event for
  the stall threshold
- **THEN** the preparation is aborted through the existing abort path
- **AND** the user sees a failure identifying the destination
- **AND** a recovery action is offered

#### Scenario: Continued progress is not treated as a stall

- **WHEN** a preparation remains pending beyond both the slow-load threshold and the stall duration
- **AND** it continues to emit progress events within each stall window
- **THEN** it is not aborted
- **AND** the slow-load status continues to be reported

#### Scenario: Elapsed time alone is not progress

- **WHEN** a pending request emits no progress event, regardless of how long the slow-load status
  has been displayed
- **THEN** expiry of the stall threshold aborts it
- **AND** merely remaining in `preparing` is not treated as progress

#### Scenario: Recovery after a stall

- **WHEN** the user retries a destination whose preparation stalled
- **THEN** the retry is permitted
- **AND** it behaves as an ordinary preparation, including the same progress definition and stall
  threshold
