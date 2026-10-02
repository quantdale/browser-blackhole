# Galaxy-collision delta specification

## ADDED Requirements

### Requirement: Production parameters are source-locked before use

Galaxy Collision SHALL use only production parameters that are traceable to the selected primary/accepted source or explicitly documented derivations.

#### Scenario: Required parameter is available in the primary source

- **GIVEN** a production encounter parameter is required by the reduced model
- **WHEN** the source-lock record is completed
- **THEN** the parameter SHALL record its value, units/convention and exact page/section/figure/table source location
- **AND** any repository-side transformation SHALL be documented.

#### Scenario: Required parameter cannot be established

- **GIVEN** a required production parameter cannot be supported without material guesswork
- **WHEN** source locking reaches that field
- **THEN** CA9 SHALL be marked `BLOCKED_SOURCE`
- **AND** production data/runtime implementation SHALL NOT continue using a plausible substitute.

#### Scenario: Value is derived from a figure

- **GIVEN** a parameter/sample must be digitized or inferred from a source figure
- **WHEN** it is used
- **THEN** it SHALL be labeled derived rather than verbatim
- **AND** its extraction method and uncertainty SHALL be documented.

### Requirement: Source documents are not redistributed without rights

Public availability of the research scan SHALL NOT be treated as automatic permission to commit/re-publish the full third-party paper.

#### Scenario: Executor downloads the paper for source locking

- **GIVEN** the NASA GISS/NTRS source can be retrieved for research
- **WHEN** repository changes are prepared
- **THEN** the scan SHALL remain uncommitted unless redistribution rights are independently established
- **AND** bibliographic/retrieval provenance SHALL be recorded instead.

### Requirement: Exercise parameters cannot satisfy production configuration

The offline generator SHALL distinguish self-check/exercise configuration from source-locked production configuration and SHALL fail closed when production data is incomplete or unverified.

#### Scenario: Exercise defaults are supplied to production mode

- **GIVEN** a configuration contains exercise/example/unverified fields
- **WHEN** production generation is requested
- **THEN** the generator SHALL reject the run with a diagnostic identifying the invalid field(s)
- **AND** SHALL NOT emit a production runtime artifact.

### Requirement: Offline generation is deterministic and reproducible

The source-locked reduced model SHALL produce deterministic logical output under its pinned generation environment/settings.

#### Scenario: Same source config is generated twice

- **GIVEN** the same production config, tool version and pinned environment
- **WHEN** the offline generator is run twice
- **THEN** the logical trajectory output SHALL be identical within the declared serialization contract
- **AND** the runtime artifact checksum SHALL be reproducible.

### Requirement: Runtime artifact is versioned, checksummed and bounds-safe

Galaxy Collision scientific runtime data SHALL use a versioned compact artifact with a manifest and a loader that rejects corrupt/unsupported inputs.

#### Scenario: Valid artifact is loaded

- **GIVEN** a supported artifact with matching schema/version/counts/checksum expectations
- **WHEN** the destination loads it
- **THEN** center/tracer keyframes and time metadata SHALL be parsed deterministically
- **AND** no runtime source-network service SHALL be required.

#### Scenario: Artifact is truncated/corrupt/unsupported

- **GIVEN** invalid magic/version/counts/offsets/truncation or other manifest/schema corruption
- **WHEN** the loader parses it
- **THEN** loading SHALL fail truthfully and boundedly
- **AND** the destination SHALL NOT continue with silently fabricated/default trajectory data.

### Requirement: Scientific runtime motion comes from reduced source data

Galaxy Collision center/tracer motion SHALL be produced by interpolation of the validated offline trajectory artifact rather than a cinematic per-frame drift solver.

#### Scenario: Timeline lands between two keyframes

- **GIVEN** a valid timeline time within the data range
- **WHEN** runtime positions are evaluated
- **THEN** the surrounding source keyframes SHALL be selected deterministically
- **AND** positions SHALL be computed using the documented interpolation method
- **AND** fixed runtime probes SHALL match the CPU reference within documented tolerance.

#### Scenario: Timeline returns to an earlier time

- **GIVEN** the user scrubs `t0 -> t1 -> t0`
- **WHEN** positions are reevaluated
- **THEN** the final `t0` scientific state SHALL equal the original `t0` state within deterministic numeric tolerance
- **AND** no stateful integration drift SHALL accumulate.

### Requirement: Data-driven and cinematic layers are distinguishable

The destination SHALL not describe procedural presentation effects as simulated galaxy dynamics.

#### Scenario: Procedural dust/glow/camera effects are rendered

- **GIVEN** visual layers not contained in the source trajectory model
- **WHEN** they are shown/documented
- **THEN** scientific tracer motion SHALL remain driven by the data artifact
- **AND** the extra layers SHALL be labeled procedural/cinematic where fidelity documentation discusses them.

### Requirement: Galaxy Collision follows Atlas lifecycle/resource contracts

The destination SHALL attach/update/render/detach through existing Atlas abstractions and SHALL not leak resources across repeated navigation.

#### Scenario: User repeatedly enters and exits Galaxy Collision

- **GIVEN** repeated destination cycles
- **WHEN** each module instance is detached
- **THEN** destination-owned GPU/scene/listener resources SHALL return to the established bounded baseline behavior
- **AND** global resource-leak gates SHALL remain green.

### Requirement: Production route is gated by scientific/release evidence

Galaxy Collision SHALL NOT be marked production/available until source, data, runtime, validation, visual and performance gates pass.

#### Scenario: Runtime renderer exists before source/release closure

- **GIVEN** an implementation can render a development Galaxy Collision scene
- **WHEN** mandatory source-lock or release tasks remain incomplete
- **THEN** public production catalog metadata SHALL NOT claim the destination is complete/available.

### Requirement: Performance optimization preserves trajectory correctness

Runtime performance work SHALL first optimize data layout, interpolation, batching and validated LOD rather than silently altering source-locked trajectories.

#### Scenario: Particle-heavy preset misses performance budget

- **GIVEN** benchmark evidence shows a budget miss
- **WHEN** optimization is applied
- **THEN** scientific probe/interpolation reference tests SHALL remain within their existing tolerance
- **AND** any quality-tier tracer-density reduction SHALL be explicitly documented as presentation sampling/LOD rather than changed dynamics.

### Requirement: CA9 documentation states the reduced-model limitation

User/scientific documentation SHALL state that CA9 is a reduced restricted-three-body/test-particle reconstruction and SHALL not imply live self-consistent N-body/hydrodynamic simulation.

#### Scenario: User reads the Galaxy Collision fidelity description

- **GIVEN** the production destination is released
- **WHEN** its scientific-fidelity documentation is inspected
- **THEN** the primary source/provenance, data-driven components, procedural layers and omitted physics SHALL be stated explicitly.
