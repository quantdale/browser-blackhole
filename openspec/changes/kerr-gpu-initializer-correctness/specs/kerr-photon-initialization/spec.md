## Purpose

Defines the contract that the GPU Kerr ray-tracing pass derives camera-side photon integration
constants — energy, axial angular momentum, radial and polar momenta, and the observed/emitted
frequency ratio — identically to the binary64 CPU reference solver, for every combination of spin,
camera radius and observer mode that the product can reach.

## ADDED Requirements

### Requirement: Kerr camera-side constants SHALL match the CPU reference

The Kerr GPU pass SHALL compute the Kerr quartic `A = (r² + a²)² − a²Δ sin²θ` at the camera, and
SHALL use that same `A` for the metric component `g_φφ = A sin²θ / σ` that enters the moving-observer
axial angular momentum extraction. The GPU pass SHALL NOT substitute any other expression for `A`,
and the camera-side `A` and the integration-loop `A` SHALL be constructed from one shared definition.

#### Scenario: Kerr quartic is the metric quartic at the camera

- **WHEN** the Kerr pass builds the camera-side quartic for radius `r` and spin `a`
- **THEN** the value equals `(r² + a²)² − a²Δ sin²θ`
- **AND** it equals the quartic the binary64 reference solver builds for the same `(r, θ, a)`

#### Scenario: Spin-zero limit of the camera-side quartic

- **WHEN** the spin parameter is zero
- **THEN** the camera-side quartic equals `r⁴`
- **AND** the moving-observer `g_φφ` derived from it equals `r² sin²θ`

#### Scenario: Camera-side and integration-loop constants cannot drift

- **WHEN** a change modifies the Kerr metric constants used at the camera
- **THEN** the integration loop consumes the identical definition
- **AND** a unit test asserts the two constructed values are equal for a sampled `(r, θ, a)` grid

### Requirement: Static-observer axial angular momentum SHALL use the ADR normalisation

For the legacy static-camera path, the GPU pass SHALL compute the conserved axial angular momentum
as `L_z = ε [ n_ph sin(θ) √(Δ/f_s) + g_tφ / √f_s ]`, where `f_s` is the static lapse factor and `g_tφ`
is the time-azimuthal metric component. The GPU pass SHALL NOT divide `g_tφ` by `f_s` or by any
power of `f_s` other than `√f_s`.

#### Scenario: Static camera agrees with the reference at a representative radius

- **WHEN** a static camera ray is initialised at radius `r` with polar angle `θ` and spin `a`
- **THEN** the GPU `L_z` equals the reference solver's `L_z` within the Kerr parity tolerance
- **AND** the ratio of the two equals 1 to within that tolerance

#### Scenario: Frame-dragging term uses the square root of the lapse

- **WHEN** the static axial angular momentum is evaluated at a radius where `f_s < 1`
- **THEN** the frame-dragging contribution is `g_tφ / √f_s`
- **AND** it is not equal to `g_tφ / f_s` unless `f_s` is exactly 1

#### Scenario: Schwarzschild limit of the static extraction

- **WHEN** the spin parameter is zero
- **THEN** the static axial angular momentum reduces to `r sin(θ) n_ph`
- **AND** the energy reduces to `√f`

### Requirement: Frequency ratio SHALL be gated by the observer-frequency convention

The Kerr pass SHALL apply the comoving frequency normalisation factor only when the observer
frequency convention is active. On the legacy static-camera path the factor SHALL be exactly 1, so
that a Kerr static camera and a Schwarzschild static camera at the same radius apply the identical
convention.

#### Scenario: Static camera applies no normalisation

- **WHEN** the observer frequency convention is inactive
- **THEN** the frequency ratio is computed without division by the photon energy
- **AND** the Kerr and Schwarzschild passes agree on the convention for the same static observer

#### Scenario: Moving observer applies the normalisation

- **WHEN** the observer frequency convention is active
- **THEN** the frequency ratio is divided by the photon energy as the observer-frame ADR specifies

#### Scenario: Kerr and Schwarzschild static conventions are equivalent

- **WHEN** the same static observer radius and inclination are rendered by the Kerr and the
  Schwarzschild backend
- **THEN** the ratio of the two passes' disk brightness equals `√f_s` for that radius

### Requirement: Kerr parity SHALL cover close camera radii and moving observers

The Kerr GPU parity suite SHALL include rays from static and relativistic observers at camera
radii inside the far-field regime used by the default preset, and SHALL include at least one row
combining non-zero spin with a non-camera observer mode.

#### Scenario: Close-in static camera is compared against the reference

- **WHEN** the Kerr parity suite runs
- **THEN** it compares terminal directions, classifications and minimum radii for static cameras
  at radii inside twice the Schwarzschild ISCO
- **AND** each compared ray is counted, and a minimum compared count is asserted

#### Scenario: Kerr with a relativistic observer is compared against the reference

- **WHEN** the Kerr parity suite runs
- **THEN** it includes at least one row with non-zero spin and an observer mode other than the
  free camera
- **AND** that row asserts agreement on classification and terminal direction within tolerance

#### Scenario: A comparable count is asserted, not assumed

- **WHEN** any parity row filters out rays
- **THEN** the row asserts the number of rays actually compared against a minimum
- **AND** a row that compares zero rays fails

### Requirement: Kerr metric terms SHALL use a consistent spin-length convention

Where the Kerr metric is evaluated for a mass other than the normalised unit mass, the spin length
used SHALL be `a = a* · M`. The pass SHALL NOT mix the dimensionless `a*` with a metric that
assumes unit mass. If a non-unit mass is requested while only the dimensionless convention is
implemented, the pass SHALL reject it explicitly rather than silently computing with the wrong
convention.

#### Scenario: Unit mass is unaffected

- **WHEN** the normalised mass is one
- **THEN** `a` equals the dimensionless spin and every existing Kerr row is unchanged

#### Scenario: Non-unit mass is rejected rather than mis-computed

- **WHEN** a Kerr pass is constructed with a non-unit mass
- **THEN** the pass either threads `a = a* · M` through every metric term, or reports an explicit
  unsupported condition
- **AND** it does not silently evaluate the metric with the dimensionless spin

### Requirement: LUT capture classification SHALL be analytic on the GPU

The LUT GPU pass SHALL decide capture membership from the analytic comparison of the impact
parameter against the critical impact parameter, and SHALL NOT derive capture membership from a
stored sentinel value read through an interpolating sampler. A sentinel MAY remain as a secondary
guard but SHALL NOT be the authority.

#### Scenario: Captured rays at the critical boundary

- **WHEN** a ray is traced with an impact parameter below the critical impact parameter, within one
  texel of the boundary
- **THEN** the pass classifies it as captured
- **AND** it does not report it as an escaping ray resolved from the LUT

#### Scenario: Classification matches the analytic criterion

- **WHEN** the LUT pass classifies a ray
- **THEN** the reported classification is consistent with the analytic impact-parameter comparison
  for that ray, including inside the hybrid band

#### Scenario: Interpolation cannot blur class membership

- **WHEN** a captured column and an escaping column are adjacent in the texture
- **THEN** no bilinear sample of the classification channel can produce an escaping verdict for a
  ray whose impact parameter is below the critical value

### Requirement: The LUT axis mapping SHALL come from the validated manifest

The LUT GPU pass SHALL take its `x → u` axis mapping from the validated manifest of the family it
loads. It SHALL NOT hard-code axis-mapping constants at the shader call site. If the family being
loaded declares a mapping the runtime cannot honour, the family SHALL be rejected with an explicit
reason rather than sampled with a different mapping.

#### Scenario: Non-default axis mapping is honoured

- **WHEN** a LUT family whose manifest declares a non-default `x → u` mapping is loaded
- **THEN** the GPU pass uses that declared mapping
- **AND** the rendered result matches the numerical reference for the same family

#### Scenario: Unsupported axis mapping is rejected

- **WHEN** a LUT family declares an axis mapping the runtime does not support
- **THEN** loading fails with an explicit unsupported-mapping reason
- **AND** the product falls back to the numerical backend rather than sampling with a wrong mapping

#### Scenario: Default mapping still matches the shipped family

- **WHEN** the shipped LUT family is loaded
- **THEN** the mapping used equals the mapping declared in its manifest
