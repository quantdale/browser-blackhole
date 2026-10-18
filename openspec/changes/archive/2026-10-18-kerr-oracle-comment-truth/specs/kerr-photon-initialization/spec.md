## ADDED Requirements

### Requirement: Reference commentary SHALL state the normative static-extraction normalisation

Commentary immediately adjacent to the binary64 reference solver's static axial-angular-momentum extraction, and commentary immediately adjacent to its terminal azimuthal reconstruction, SHALL state the same frame-dragging normalisation the executable lines use. That normalisation SHALL be division by the square root of the static lapse, not division by the lapse. A change that alters the executable term to match a contradictory comment SHALL fail a unit test before it can merge.

#### Scenario: Adjacent commentary disagrees with the executable term

- **WHEN** the commentary next to the static extraction or the terminal azimuthal reconstruction states division by the lapse
- **AND** the executable term divides by the square root of the lapse
- **THEN** the reference text is treated as defective
- **AND** the executable term is not changed to match the commentary

#### Scenario: Lapse below one distinguishes the two normalisations

- **WHEN** a unit test evaluates the frame-dragging term at a static lapse below 1
- **THEN** the term equals the metric component divided by the square root of the lapse
- **AND** the test fails if the term equals the metric component divided by the lapse

#### Scenario: The GPU contract is unchanged

- **WHEN** this requirement is satisfied
- **THEN** the GPU static-extraction formula required by this capability is unchanged
- **AND** no parity tolerance or visual baseline is widened or replaced to satisfy it
