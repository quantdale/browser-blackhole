## MODIFIED Requirements

### Requirement: Neutron Star production fidelity claim

The Neutron Star destination MAY be documented as direct compact-surface Schwarzschild ray tracing only when the material-surface ray path, reference validation and production parity requirements above are satisfied. Otherwise all public and scientific documentation SHALL explicitly describe the actual reduced/straight-line rendering model and its limitation.

#### Scenario: fidelity documentation matches the shipped path

- **GIVEN** the material-surface ray path, reference validation and production parity requirements are satisfied for the documented production revision
- **AND** the published fidelity note claims direct compact-surface Schwarzschild ray tracing
- **WHEN** that note is checked against the implementation and validation record
- **THEN** the claimed model SHALL match the validated material-surface ray path in that revision
- **AND** the note SHALL NOT present a different or unvalidated implementation as the validated direct path.

#### Scenario: The material-surface path is absent or unvalidated

- **GIVEN** the required material-surface ray path is absent or unvalidated
- **WHEN** the production fidelity note is published
- **THEN** it SHALL describe the actual rendering model and its material-surface limitation
- **AND** it SHALL NOT claim validated direct compact-surface Schwarzschild ray tracing.

#### Scenario: Reference validation is incomplete

- **GIVEN** the material-surface ray path exists but its required reference validation is incomplete
- **WHEN** the production fidelity note is published
- **THEN** it SHALL disclose the actual rendering model and the missing reference validation
- **AND** it SHALL NOT claim validated direct compact-surface Schwarzschild ray tracing.

#### Scenario: Production parity is failing or missing

- **GIVEN** the material-surface path and reference validation are present but required production parity is failing or missing
- **WHEN** the production fidelity note is published
- **THEN** it SHALL disclose the actual rendering model and the production parity limitation
- **AND** it SHALL NOT claim validated direct compact-surface Schwarzschild ray tracing.
