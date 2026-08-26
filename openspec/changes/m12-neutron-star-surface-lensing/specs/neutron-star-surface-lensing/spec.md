# Neutron-star surface-lensing delta specification

## ADDED Requirements

### Requirement: Direct Schwarzschild material-surface ray tracing

The Neutron Star destination SHALL trace observer camera rays through the exterior Schwarzschild spacetime and SHALL terminate a ray on the material stellar surface when the ray intersects `R > 2 r_g`, rather than rendering the stellar surface through straight-line projection.

#### Scenario: Inbound ray intersects the star

- **GIVEN** a valid neutron-star mass and radius with the observer outside the surface
- **AND** a backwards camera ray whose Schwarzschild trajectory crosses the material radius
- **WHEN** the ray is integrated
- **THEN** the result SHALL be `SURFACE_HIT`
- **AND** the ray SHALL terminate at the material surface before any would-be horizon/capture terminal
- **AND** the result SHALL contain a finite refined surface-hit position or equivalent surface coordinate.

#### Scenario: Ray misses the star and escapes

- **GIVEN** a valid neutron-star model
- **AND** a camera ray whose trajectory does not cross the material radius
- **WHEN** the canonical escape condition is satisfied
- **THEN** the result SHALL be `ESCAPED`
- **AND** the renderer SHALL sample the destination background/celestial field using the escaped ray direction.

#### Scenario: Numerical integration fails

- **GIVEN** an invalid or numerically unresolved ray
- **WHEN** the surface integrator cannot produce a valid surface hit or escape
- **THEN** the result SHALL remain diagnosable as a numerical/initial-state failure
- **AND** the renderer SHALL NOT silently classify it as a successful surface or background ray.

### Requirement: Refined surface hit geometry

The direct path SHALL refine a radius-crossing event sufficiently to produce stable material-surface geometry for shading and validation.

#### Scenario: Surface crossing lies between accepted integration states

- **GIVEN** consecutive accepted ray states that bracket `R`
- **WHEN** the event is classified as a material-surface crossing
- **THEN** the implementation SHALL refine the crossing using a documented bounded method
- **AND** the resulting hit radius SHALL satisfy the documented event tolerance
- **AND** the surface normal/coordinate used for shading SHALL be derived from the refined hit rather than from the old straight-line sphere fragment.

### Requirement: Surface emission uses the geodesic hit coordinate

Surface color/emission and hot-spot geometry SHALL be evaluated at the material coordinate reached by the bent ray.

#### Scenario: Bent ray reaches an off-axis surface point

- **GIVEN** a ray whose Schwarzschild path intersects a surface point different from its straight-line projection
- **WHEN** the surface is shaded
- **THEN** hot-spot/surface emission SHALL be evaluated at the geodesic hit coordinate
- **AND** the direct-sphere screen-space fragment SHALL NOT determine the physical surface sample.

### Requirement: Static gravitational redshift remains direct and explicit

For the supported spherical static exterior, the destination SHALL apply the project convention `g = nu_obs/nu_emit = sqrt(1 - 2 r_g/R)` to static surface emission and SHALL continue to disclose omitted rotational-relativistic effects.

#### Scenario: Compactness increases within the supported range

- **GIVEN** two valid static neutron-star models with the same emitted spectrum and different compactness
- **WHEN** their surface redshift factors are evaluated
- **THEN** the more compact model SHALL have the smaller observed/emitted frequency ratio
- **AND** no Doppler, aberration or frame-dragging correction SHALL be implied unless separately implemented and specified.

### Requirement: Apparent-radius reference validation

For validation cases with `R > 3 r_g`, the implementation SHALL reproduce the Schwarzschild apparent-limb relation within a documented tolerance.

#### Scenario: Canonical surface outside the photon sphere

- **GIVEN** a static spherical star with `R > 3 r_g`
- **WHEN** the CPU/reference hit/miss transition is measured in asymptotic impact parameter
- **THEN** the transition SHALL agree within the documented tolerance with `b_limb = R / sqrt(1 - 2 r_g/R)`.

#### Scenario: Ultra-compact control range is exposed

- **GIVEN** a user-controllable radius in `2 r_g < R <= 3 r_g`
- **WHEN** the direct path claims support for that value
- **THEN** the implementation SHALL use a numerically validated treatment appropriate to the photon-sphere/multiple-image regime
- **OR** the production DIRECT control range SHALL explicitly exclude that regime without silently clamping input.

### Requirement: CPU/GPU surface-ray parity

The production GPU/TSL path SHALL agree with a pure CPU/reference surface-ray model for a representative deterministic corpus.

#### Scenario: Representative probe corpus

- **GIVEN** fixed center-hit, near-limb-hit, near-limb-escape, off-axis-hit and supported high-deflection rays
- **WHEN** CPU and GPU results are compared
- **THEN** their hit/escape classifications SHALL agree
- **AND** their hit radius/position or equivalent invariants SHALL agree within documented precision-aware tolerances.

#### Scenario: Parity mismatch occurs

- **GIVEN** a CPU/GPU disagreement
- **WHEN** the parity test fails
- **THEN** the failure output SHALL identify the input ray/model and both results sufficiently to debug the mismatch
- **AND** the gate SHALL remain failed rather than widening tolerance without justification.

### Requirement: Existing black-hole ray contracts remain stable

Neutron-star implementation reuse SHALL NOT silently change validated Black Hole Schwarzschild/LUT/Kerr behavior.

#### Scenario: Shared geodesic code is modified

- **GIVEN** the neutron-star change edits code reachable by an existing black-hole backend
- **WHEN** black-hole parity and golden gates run
- **THEN** validated classifications/trajectories SHALL remain within their existing contracts
- **AND** unexplained golden/parity drift SHALL block completion.

### Requirement: Neutron-star-specific regression coverage

The repository SHALL contain dedicated neutron-star unit and browser tests for the destination’s physics and direct surface-ray behavior.

#### Scenario: Destination presets are exercised

- **GIVEN** each production neutron-star preset
- **WHEN** the dedicated browser suite enters, pauses/scrubs, switches and re-enters the destination
- **THEN** state and ray diagnostics SHALL remain finite/deterministic
- **AND** no uncaught page error or unbounded destination resource growth SHALL occur.

### Requirement: Visual baselines change only after physics validation

Neutron-star golden images SHALL be regenerated only after the direct ray model passes independent reference/parity validation.

#### Scenario: Corrected surface lensing changes the image

- **GIVEN** green CPU/reference and CPU/GPU validation
- **WHEN** the old neutron-star baselines fail because the physical limb/surface mapping changed
- **THEN** only the affected neutron-star baselines MAY be regenerated after review
- **AND** the complete golden suite SHALL subsequently pass twice independently.

### Requirement: Performance evidence is destination-specific and truthful

The repository SHALL provide a discoverable neutron-star benchmark path and SHALL identify whether reported timing is CPU/rAF or true GPU timing.

#### Scenario: M12-NS benchmark is recorded

- **GIVEN** representative neutron-star presets and a documented machine/backend/quality configuration
- **WHEN** performance evidence is captured
- **THEN** the record SHALL include enough context to reproduce/compare it
- **AND** it SHALL NOT describe CPU/rAF timing as GPU time.

## MODIFIED Requirements

### Requirement: Neutron Star production fidelity claim

The Neutron Star destination MAY be documented as direct compact-surface Schwarzschild ray tracing only when the material-surface ray path, reference validation and production parity requirements above are satisfied. Otherwise all public and scientific documentation SHALL explicitly describe the actual reduced/straight-line rendering model and its limitation.
