## Purpose

Makes a lost graphics device and a slow destination open visible and actionable even when the control panel is collapsed, without leaving an occluding transition as the only thing on screen.

## ADDED Requirements

### Requirement: A session-terminal graphics failure SHALL be visible outside the control panel

When the rendering device is lost and the session cannot continue, the product SHALL present a terminal state the user can perceive with the control panel collapsed, on a narrow viewport, and after the panel is rebuilt. The presentation SHALL use the repository's existing graphics-device-lost remediation copy, SHALL state that rendering cannot continue, and SHALL offer reload as the recovery action. It SHALL NOT be presented as a recoverable destination-preparation failure. A status line inside the control panel MAY mirror the same fact and SHALL NOT be the only surface.

#### Scenario: Device loss while the panel is collapsed

- **WHEN** the graphics device is lost and the control panel is collapsed
- **THEN** the user can still perceive a terminal message
- **AND** the message is not inside a subtree removed from the accessibility tree
- **AND** the message offers a reload action

#### Scenario: Device loss survives a panel rebuild

- **WHEN** the graphics device is lost and the control panel is later rebuilt
- **THEN** the terminal message remains visible
- **AND** it is not destroyed by the rebuild

#### Scenario: Device loss is not a destination retry

- **WHEN** the graphics device is lost
- **THEN** the presentation says rendering cannot continue until the page is reloaded
- **AND** it does not offer a destination retry as the recovery action
- **AND** the meaning is available as text and is not conveyed by colour alone

#### Scenario: Assistive announcement

- **WHEN** the terminal graphics failure appears
- **THEN** it is announced through an assertive live region
- **AND** the announcement names the failure rather than only changing a status colour

### Requirement: A slow destination preparation SHALL be announced before it fails

When destination preparation remains in progress past the product's slow-load threshold, the product SHALL show a user-visible notice that names the destination being opened. The notice SHALL be perceivable when the control panel is collapsed. It SHALL be cleared when preparation completes, when a newer navigation request supersedes it, or when a published preparation failure replaces it. Elapsed waiting SHALL NOT by itself be presented as a failure.

#### Scenario: Preparation is slow but still progressing

- **WHEN** the user selects a destination and preparation remains in progress past the slow-load threshold
- **THEN** the user sees a notice naming that destination
- **AND** the notice does not say the destination failed
- **AND** the previous destination remains available

#### Scenario: The notice is cleared on success

- **WHEN** a slow preparation later completes
- **THEN** the slow-preparation notice is removed
- **AND** it is not left on screen after the destination is interactive

#### Scenario: A newer request replaces the notice

- **WHEN** the user selects a different destination while a slow-preparation notice is showing
- **THEN** the notice follows the newer request
- **AND** it does not keep naming the superseded destination after that request is no longer current

#### Scenario: Failure replaces the notice

- **WHEN** a slow preparation later fails and a preparation-failure message is published
- **THEN** the slow-preparation notice is not shown together with that failure as two competing explanations
- **AND** the failure message remains the actionable surface

### Requirement: An occluding transition SHALL NOT hide a lost device

If the graphics device is lost while a transition overlay is occluding the scene, the product SHALL still present the terminal graphics-failure surface. The overlay SHALL NOT remain an unexplained full-screen occlusion after the device is lost. This requirement applies only when that occlusion is reproduced. A failure to reproduce it SHALL be recorded and SHALL NOT be treated as a reason to change overlay rendering.

#### Scenario: Device loss under an occluding overlay

- **WHEN** the graphics device is lost while the transition overlay is occluding the scene
- **THEN** the terminal graphics-failure surface is visible
- **AND** the overlay is not the only content on screen
- **AND** the user is offered reload

#### Scenario: The occlusion is not reproduced

- **WHEN** device loss during an outgoing or occluding transition is exercised and the overlay does not remain an unexplained occlusion
- **THEN** the negative result is recorded with the steps used
- **AND** overlay rendering is left unchanged

### Requirement: These surfaces SHALL NOT move the pinned shell geometry

The terminal and slow-preparation surfaces SHALL be presented without changing the pinned top bar height or control-panel width that the visual-regression viewport depends on. They SHALL NOT add a destination, a new scientific control, or a restyle of the instrument console.

#### Scenario: Status surfaces do not resize the instrument chrome

- **WHEN** either surface is shown at the visual-regression viewport
- **THEN** the top bar height and control-panel width remain the pinned values
- **AND** the canvas element box used by visual regression does not change because the surface appeared
