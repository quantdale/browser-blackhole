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

A destination preparation that makes no progress for longer than a defined stall threshold SHALL
terminate in a user-visible failure with a recovery action, rather than remaining pending
indefinitely. The stall threshold SHALL be distinct from, and much longer than, the threshold at
which a slow load is reported as still in progress.

#### Scenario: A data request never completes

- **WHEN** a destination's data request remains outstanding past the stall threshold
- **THEN** the preparation is aborted
- **AND** the user sees a failure identifying the destination
- **AND** a recovery action is offered

#### Scenario: A slow but progressing load is not aborted

- **WHEN** a preparation takes longer than the slow-load reporting threshold but continues to make
  progress
- **THEN** it is not aborted
- **AND** the slow-load status continues to be reported

#### Scenario: A progressing load after a stall warning

- **WHEN** a preparation continues to make progress beyond the stall threshold
- **THEN** it completes normally
- **AND** the stall warning did not terminate it

#### Scenario: Recovery after a stall

- **WHEN** the user retries a destination whose preparation stalled
- **THEN** the retry is permitted
- **AND** it behaves as an ordinary preparation, including the same stall threshold
