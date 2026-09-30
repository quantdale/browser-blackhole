## Purpose

Defines the contract that every control the product exposes affects rendered or canonical state,
that every value the interface displays equals its canonical value, that share links and deep
links round-trip exactly, that declared scientific fidelity notes describe the shipped model, and
that debug and test instrumentation is not reachable from a production build.

## ADDED Requirements

### Requirement: An exposed control SHALL affect rendered or canonical state

A control that is exposed to the user SHALL change either the rendered image or a canonical state
value. A control that changes neither SHALL NOT be exposed, or SHALL be removed.

#### Scenario: Destination zone control shows its destination's objects

- **WHEN** the user selects a destination's zone or scale band
- **THEN** every object that zone is documented to contain becomes visible
- **AND** it remains visible until the user selects a different zone

#### Scenario: A visibility control survives a related state change

- **WHEN** a visibility control is enabled and the destination subsequently changes an unrelated
  internal mode
- **THEN** the object controlled by that toggle remains visible
- **AND** it does not require the user to toggle twice to restore

#### Scenario: An observer control is reflected in the render

- **WHEN** the user changes a control that declares observer-orientation semantics
- **THEN** the rendered observer orientation changes accordingly
- **AND** the reported value for that orientation equals the rendered value

#### Scenario: Reported values equal effective values

- **WHEN** a diagnostic or interface value describes an object's effective state
- **THEN** it reports the effective state rather than the requested state
- **AND** a control and its diagnostic never disagree

### Requirement: Declared fidelity SHALL describe the shipped model

Every user-visible fidelity note and every module-level model description SHALL describe the model
the product actually runs. Where a model is a reduced or approximated form, the note SHALL state
the reduction accurately and SHALL list the physical effects it omits.

#### Scenario: Fidelity note matches the implemented path

- **WHEN** a user reads a destination's fidelity note
- **THEN** the rendering path it describes is the rendering path the product uses
- **AND** it does not claim an effect is absent when the product renders it

#### Scenario: Module description matches the implementation

- **WHEN** a maintainer reads a module's model description
- **THEN** it names the component the module actually renders through
- **AND** it does not direct the reader toward a component the module does not use

#### Scenario: Omitted effects remain disclosed

- **WHEN** a destination's fidelity note is corrected
- **THEN** the effects the model genuinely omits remain listed
- **AND** the correction does not overstate the model in the other direction

### Requirement: Debug and test instrumentation SHALL NOT be reachable in a production build

Test hooks, forced-render entry points, and synchronous framebuffer readback helpers SHALL NOT be
reachable from a page served as a production build unless an explicit development or test opt-in is
present.

#### Scenario: Production build exposes no test hook

- **WHEN** a production build is loaded without an opt-in
- **THEN** no test hook global is defined
- **AND** no forced-render entry point is reachable
- **AND** no synchronous framebuffer readback helper is reachable

#### Scenario: Test and development builds retain their hooks

- **WHEN** the application is served for automated testing or local development with the opt-in
  present
- **THEN** the test hook global is defined with its documented shape
- **AND** the automated browser suite continues to function

#### Scenario: Capability telemetry is never suppressed by the opt-in

- **WHEN** the test hook opt-in is active
- **THEN** capability and backend telemetry continues to report the real probes

### Requirement: A share link SHALL round-trip exactly

A URL that encodes application state SHALL restore that state exactly, and fields encoded in the
same URL SHALL not override one another.

#### Scenario: Experience mode and display values coexist

- **WHEN** a URL encodes both an experience mode and display values such as exposure or bloom
- **THEN** applying the URL results in the encoded display values
- **AND** the experience mode does not silently replace them

#### Scenario: Destination control payloads reach both state and interface

- **WHEN** a URL encodes destination control values
- **THEN** those values are applied to canonical state
- **AND** the controls that represent them display those values
- **AND** the interface and canonical state agree

#### Scenario: Preset in a share link is honoured

- **WHEN** a share link encodes a preset
- **THEN** the application activates that preset
- **AND** the value the link encodes is the value the application reads

#### Scenario: Serialisation and parsing are symmetric

- **WHEN** state is serialised into a URL and that URL is parsed again
- **THEN** every field that was written is read back with the same value

### Requirement: Paired controls over one value SHALL agree

When two interface controls write the same underlying value, they SHALL both reflect the current
value of that value.

#### Scenario: Toggling one control updates the other

- **WHEN** the user changes one of two controls that share an underlying value
- **THEN** the other control displays the resulting value

#### Scenario: Canonical state and both controls agree

- **WHEN** the underlying value is read from canonical state
- **THEN** both controls display that same value

#### Scenario: Playback rate is reported truthfully

- **WHEN** a playback rate control is shown
- **THEN** it displays the rate the timeline is actually running at
- **AND** it is not permanently showing a rate the application never uses

### Requirement: Interface state SHALL be preserved across programmatic rebuilds

When the interface rebuilds because application state changed, the user's focus position and the
open/closed state of collapsible regions SHALL be preserved.

#### Scenario: Focus survives a destination switch

- **WHEN** the user activates a destination using the keyboard
- **THEN** focus remains on a meaningful interactive element after the switch
- **AND** focus does not fall back to the document body

#### Scenario: Focus survives a panel rebuild

- **WHEN** a control change causes the panel to rebuild
- **THEN** focus remains within the panel on the equivalent control
- **AND** the region containing it remains expanded

#### Scenario: Collapsed regions are not reachable

- **WHEN** a collapsible region is collapsed
- **THEN** its contents are removed from the accessibility tree and from the tab order
- **AND** this holds for both the desktop and the narrow-viewport presentation

#### Scenario: Values are programmatically associated with their inputs

- **WHEN** a control displays a formatted value including its unit
- **THEN** assistive technology can obtain the formatted value together with the unit
- **AND** each collapsible region has an accessible name

### Requirement: Destination modules SHALL guard their time coordinate

Every destination that derives a physical time coordinate from the shared timeline SHALL guard it
against a non-finite value before using it in rendering.

#### Scenario: Non-finite time does not reach the scene

- **WHEN** the shared timeline reports a non-finite physical time
- **THEN** the destination substitutes its documented default rather than propagating the
  non-finite value
- **AND** the reported diagnostic value is finite

#### Scenario: All destinations follow one convention

- **WHEN** destinations are compared
- **THEN** they use the same finiteness-guard convention for their time coordinate

### Requirement: Work SHALL be skipped when its output is not presented

A destination SHALL NOT perform per-frame production and upload work for content it is not
currently presenting.

#### Scenario: Hidden population is not rebuilt

- **WHEN** a destination's quality setting reduces a population to zero
- **THEN** the destination does not rebuild or upload that population's buffers
- **AND** the reported skip count reflects the work that was avoided

### Requirement: Physical parameters SHALL be clamped to the range their conversion supports

Where a module converts a physical parameter through a helper with a supported range, the parameter
SHALL be expressed so the conversion produces the intended result, or the limitation SHALL be
disclosed.

#### Scenario: Conversion is not silently saturated

- **WHEN** a temperature-like parameter is converted to a colour
- **THEN** the converted value corresponds to the parameter as written
- **AND** the module does not rely on a helper silently clamping beyond its supported range