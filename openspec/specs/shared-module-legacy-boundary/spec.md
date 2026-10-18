# shared-module-legacy-boundary Specification

## Purpose

Keeps shared rendering modules independent of the legacy application's state module, so the product path does not depend on the diagnostic shell it replaced as the default landing.

## Requirements

### Requirement: A shared shader module SHALL NOT import legacy application state

A shader module shared by the product SHALL NOT import types or values from the legacy application state module. The legacy shell's own renderer files MAY keep that import. Moving a shared type to a neutral module SHALL NOT change rendered diagnostic colors or view-mode behavior.

#### Scenario: A shared shader imports legacy application state

- **WHEN** a shader module outside the legacy shell imports the legacy application state module
- **THEN** the dependency check fails

#### Scenario: The legacy shell imports its own state

- **WHEN** a renderer file that exists only to serve the legacy diagnostic application imports the legacy application state module
- **THEN** the dependency check does not fail for that file

#### Scenario: The shared type moves

- **WHEN** the view-mode type moves to a neutral module
- **THEN** the set of view modes is unchanged
- **AND** diagnostic rendering for a given view mode is unchanged
