## ADDED Requirements

### Requirement: Hosted CI SHALL boot the product entry

The hosted browser job SHALL execute a check that enters through the product route and observes the atlas shell. A check that forces the legacy diagnostic application SHALL NOT be the only browser evidence the hosted job runs. The product-entry check SHALL remain stable on a GPU-less software-rendered runner. It SHALL NOT require a lensed frame, a hyperspace transition, or a hardware-WebGPU baseline. The legacy diagnostic application SHALL remain reachable by its explicit opt-in.

#### Scenario: Hosted job runs only the legacy smoke

- **WHEN** the hosted browser job executes no check that mounts the atlas shell
- **THEN** the job does not satisfy this requirement
- **AND** a green legacy-only smoke is not reported as product-entry coverage

#### Scenario: Product entry mounts the atlas shell

- **WHEN** the hosted product-entry check runs
- **THEN** it observes the atlas shell on the product route
- **AND** it does not treat the legacy diagnostic application as that shell
- **AND** it accepts a truthful ready, fallback, or unsupported terminal state without requiring a lensed frame

#### Scenario: Legacy opt-in remains available

- **WHEN** a caller explicitly requests the legacy diagnostic application
- **THEN** that application still mounts
- **AND** this requirement does not remove that opt-in
