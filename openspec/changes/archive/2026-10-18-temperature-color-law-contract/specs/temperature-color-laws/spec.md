## Purpose

Locks the three existing temperature-to-linear-RGB presentation laws as distinct contracts, including their domains and the meaning of a clamped result, without restyling any destination.

## ADDED Requirements

### Requirement: Three temperature color laws SHALL remain distinct

The repository SHALL keep three named presentation laws for temperature-to-linear-RGB: the accretion-disk law, the stellar-explosion ramp, and the compact-merger locus. They SHALL NOT be replaced by one shared function. A test SHALL fail if any two of the three return the same color at a temperature where their current implementations differ.

#### Scenario: An edit merges the laws

- **WHEN** two of the three laws are changed to return equal colors at a temperature where they currently differ
- **THEN** the contract test fails
- **AND** the laws are not accepted as unified

#### Scenario: Each law keeps its domain

- **WHEN** the laws are evaluated inside their stated domains
- **THEN** the accretion-disk law and the compact-merger law accept 1000 K through 40000 K
- **AND** the stellar-explosion ramp accepts 1000 K through 10000000 K

### Requirement: A clamped temperature SHALL NOT be presented as distinguishable

A temperature outside a law's stated domain SHALL produce the same color as that law's nearest domain endpoint. A call site that passes a temperature above a law's ceiling SHALL NOT describe or depend on the result being distinguishable from the ceiling color.

#### Scenario: Temperature above the compact-merger ceiling

- **WHEN** the compact-merger law is evaluated above 40000 K
- **THEN** the color equals the color at 40000 K
- **AND** a call site that passes a hotter temperature does not claim a distinguishable tint

#### Scenario: Temperature inside the domain

- **WHEN** a law is evaluated at two temperatures inside its domain that currently produce different colors
- **THEN** those two colors remain different
- **AND** no visual baseline is replaced to satisfy this capability
