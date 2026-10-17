## Purpose

Defines what an exported Schwarzschild reference trace may claim about disk crossings, and which integrator remains the authority for that classification.

## ADDED Requirements

### Requirement: An exported reference trace SHALL NOT claim a disk hit it does not compute

The repository SHALL NOT export a reference-ray function whose result can be read as a disk-hit classification when that function does not compute a disk crossing. Production and parity checks that need disk-hit classification SHALL use the integrator that already classifies crossings. This capability SHALL NOT require a second disk-crossing implementation.

#### Scenario: A wrapper omits crossing refinement

- **WHEN** a reference-ray wrapper does not compute a disk crossing
- **THEN** it is not exported as a disk-hit oracle
- **AND** its result cannot be read as a successful disk-hit classification

#### Scenario: Parity needs a disk-hit classification

- **WHEN** a production or parity check classifies a disk crossing
- **THEN** it uses the integrator that already performs that classification
- **AND** it does not import a wrapper that omits crossing refinement

#### Scenario: No second integrator is added

- **WHEN** this capability is implemented
- **THEN** no new disk-crossing integrator is introduced
- **AND** rendered output is unchanged
