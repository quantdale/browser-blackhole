## Purpose

Defines the contract that a single adaptive-quality authority decides the rendering quality tier,
that each decision is actually applied to the drawing buffer, and that every quality number the
application reports describes the frame it claims to describe.

## ADDED Requirements

### Requirement: A quality tier change SHALL be applied to the drawing buffer

When the adaptive quality authority changes tier, the application SHALL re-apply the render
resolution associated with that tier to the drawing buffer, through the same path a viewport resize
uses. A tier change SHALL NOT leave the buffer at the previous tier's resolution.

#### Scenario: Automatic tier drop changes the buffer

- **WHEN** the quality authority drops from a higher tier to a lower tier
- **THEN** the drawing buffer's pixel dimensions are recomputed for the new tier
- **AND** the new dimensions differ from the previous tier's whenever the tiers' render scales
  differ

#### Scenario: Automatic tier raise changes the buffer

- **WHEN** the quality authority raises the tier
- **THEN** the drawing buffer's pixel dimensions are recomputed for the new tier

#### Scenario: Tier change at an unchanged viewport

- **WHEN** the tier changes and the viewport size has not changed
- **THEN** the buffer is still resized to the new tier's resolution
- **AND** the application does not wait for a viewport resize event

#### Scenario: Post-processing targets follow the buffer

- **WHEN** a tier change resizes the drawing buffer
- **THEN** the HDR and auxiliary post targets are resized to match the new resolution
- **AND** temporal history is invalidated so no stale accumulation survives the change

### Requirement: The user-selected quality mode SHALL survive a transition

A quality mode explicitly selected by the user SHALL be restored after a transition completes. A
transition's temporary quality reduction SHALL NOT overwrite the stored user selection.

#### Scenario: Manual ultra survives navigation

- **WHEN** the user selects a manual quality mode and then navigates to another destination
- **THEN** the transition applies its temporary reduced quality while in motion
- **AND** the user's selected mode is restored on arrival
- **AND** the quality control displays the mode the user selected

#### Scenario: Automatic mode is unaffected

- **WHEN** the quality mode is automatic
- **THEN** a transition still applies its temporary reduction and returns to automatic afterwards

#### Scenario: A new user selection during a transition wins

- **WHEN** the user changes the quality mode while a transition is in motion
- **THEN** the transition's completion restores the mode the user most recently selected

### Requirement: Render scale SHALL be applied exactly once

The render scale SHALL be applied exactly once when deriving internal render resolution. The
drawing buffer, the HDR render target, auxiliary post targets and the transition overlay SHALL all
derive their sizes from one shared formula. A render scale SHALL NOT be multiplied into an
already-scaled value.

#### Scenario: Internal resolution matches the documented formula

- **WHEN** internal resolution is derived for a viewport, a device pixel ratio and a render scale
- **THEN** the resulting pixel dimensions equal the viewport size multiplied by the effective
  device pixel ratio and the render scale, once each
- **AND** a test asserts the relationship for at least two non-unity render scales

#### Scenario: Drawing buffer and HDR target agree with the documented formula

- **WHEN** the render scale is not one
- **THEN** the HDR render target's dimensions equal the drawing buffer's dimensions
- **AND** both equal `floor(cssSize * effectiveDpr * renderScale)` for that viewport
- **AND** equality of the two sizes is not sufficient when both differ from that formula

#### Scenario: Overlay and post targets agree

- **WHEN** the transition overlay is sized
- **THEN** it is sized by the same formula as the HDR render target

### Requirement: Reported quality values SHALL describe the frame in use

Every render scale, internal resolution and quality value the application reports — in telemetry,
in the debug inventory and in the user interface — SHALL describe the resolution actually in use.

#### Scenario: Reported render scale equals the applied scale

- **WHEN** telemetry reports a render scale
- **THEN** that value equals the scale that was applied to the drawing buffer
- **AND** it is sampled from the renderer's current state rather than derived from the tier alone

#### Scenario: Reported dimensions match the live buffer

- **WHEN** telemetry reports internal pixel dimensions
- **THEN** those dimensions equal the drawing buffer's current dimensions

#### Scenario: Reported values before the first frame

- **WHEN** quality telemetry is read before any resize or frame has occurred
- **THEN** the application reports that the value is not yet known
- **AND** it does not report a fabricated or nominal value

### Requirement: The governor's frame-rate signal SHALL measure frame cadence

The signal the adaptive quality authority uses to detect frame-rate pressure SHALL be derived from
the interval between presented frames, not from the duration of a single render submission. CPU
submission time MAY be retained as a separate reported metric.

#### Scenario: A GPU-bound application triggers a tier drop

- **WHEN** the application presents frames at a rate below the tier's target while CPU submission
  time remains low
- **THEN** the authority observes the low presented rate
- **AND** it acts on it as a frame-rate shortfall

#### Scenario: A CPU-bound application triggers a tier drop

- **WHEN** CPU submission time is the dominant cost
- **THEN** the authority observes the shortfall through the same frame-interval signal

#### Scenario: Test harness models the production measurement

- **WHEN** the governor is exercised by an automated test
- **THEN** the test supplies frame-interval timing
- **AND** the test's measurement boundary matches the boundary used in production

#### Scenario: Idle frames are not misclassified

- **WHEN** the application is idle and no frame is presented
- **THEN** the absence of frames is not interpreted as a frame-rate shortfall
- **AND** no tier change is driven by idle

### Requirement: Activity state SHALL reflect real activity

The reported activity state SHALL describe whether the user or the scene is currently driving
change, and SHALL reach a settled state after activity stops regardless of whether frames are being
rendered.

#### Scenario: Activity settles while the application is idle

- **WHEN** interaction stops and the application stops presenting frames
- **THEN** the reported activity state advances to settled rather than remaining in the interacting
  state

#### Scenario: Settled work budget is applied on the next frame

- **WHEN** a frame is presented after activity has settled
- **THEN** the work budget applied corresponds to the settled activity state

#### Scenario: Interaction re-arms immediately

- **WHEN** the user interacts again
- **THEN** the reported activity state returns to the interacting state
- **AND** the reduced interaction budget is applied
