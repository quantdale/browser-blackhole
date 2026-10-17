## Purpose

Defines the contract that every long-lived renderer service enforces a single ownership model,
refuses creation after disposal, unlinks disposed handles, performs no redundant per-frame work,
and reports telemetry that describes the frame it claims to describe.

## ADDED Requirements

### Requirement: Every renderer service SHALL enforce a uniform lifecycle contract

Every long-lived renderer service SHALL provide a resource-scope, SHALL refuse to create new
resources after disposal, SHALL unlink a resource when it is released, and SHALL release every
resource it owns when the service is disposed. The same contract test SHALL be applied to every
service.

#### Scenario: Creation after disposal

- **WHEN** a service that has been disposed is asked to create a resource
- **THEN** the request is refused with an explicit error
- **AND** no resource is created

#### Scenario: A released resource is unlinked

- **WHEN** a resource owned by a service is released
- **THEN** the service no longer iterates it in per-frame sweeps
- **AND** repeated create-and-release cycles do not grow the service's internal collection

#### Scenario: Disposal releases everything

- **WHEN** a service is disposed
- **THEN** every resource it still owns is released
- **AND** its resource-scope counters return to zero

#### Scenario: The contract is enforced uniformly

- **WHEN** the shared service-contract test is run
- **THEN** it is applied to every service in the shared renderer layer
- **AND** a service that does not satisfy it fails

### Requirement: A documented temporal behaviour SHALL be implemented

Where a temporal accumulation service documents a policy parameter, the accumulation SHALL implement
the documented effect of that parameter, and the change SHALL be observable.

#### Scenario: The interaction history cap reduces accumulated weight

- **WHEN** history weight has reached its settled ceiling and interaction begins
- **THEN** the weight on that first interaction frame is strictly lower than the settled ceiling
- **AND** the implementation does not leave the weight at the ceiling by dividing accumulated age by
  the lowered cap

#### Scenario: A settled cap still applies

- **WHEN** interaction is inactive
- **THEN** accumulation converges to the documented settled weight

#### Scenario: The applied cap is observable without a forced reset

- **WHEN** interaction begins
- **THEN** the diagnostic snapshot reports the active cap and the applied weight
- **AND** satisfying the weight change does not require invalidating accumulated history

### Requirement: Presentation setters SHALL be idempotent

A setter that applies a presentation value SHALL perform no work when the value is unchanged, and
SHALL NOT override an explicit visibility request made through another setter.

#### Scenario: The same value is applied twice

- **WHEN** a presentation setter is called with a value equal to the current one
- **THEN** no buffer is re-uploaded
- **AND** no material or node property is reassigned

#### Scenario: Visibility survives a presentation update

- **WHEN** a resource is hidden and a presentation value is subsequently applied
- **THEN** the resource remains hidden
- **AND** the explicit visibility request is not overwritten

#### Scenario: A quality value below the visibility threshold still respects the request

- **WHEN** a presentation value falls below the threshold at which the resource is shown
- **THEN** the resource is hidden regardless of its requested visibility
- **AND** raising the value back restores the requested visibility

### Requirement: Quality scaling SHALL reduce the work performed, not only the work drawn

Where a service reports a population or density scale, the work performed per frame SHALL be
bounded by that scale on every update path, and the service SHALL report which path it used.

#### Scenario: Reduced population on a compute path

- **WHEN** a particle population scale is reduced
- **THEN** the per-frame simulation work is bounded by the reduced population on a compute path as
  well as on a central-processing path
- **AND** the reported skip count reflects the work avoided

#### Scenario: The update path is reported

- **WHEN** a service reports its population
- **THEN** it reports which update path performed the work
- **AND** a caller can tell whether the reported population reflects work performed or work drawn

#### Scenario: A path that cannot honour the scale is stated

- **WHEN** an update path cannot bound its work by the configured scale
- **THEN** the service reports that limitation
- **AND** it does not report the reduced population as though the work were avoided

### Requirement: Reported renderer counters SHALL describe a single frame

Where per-frame renderer counters are sampled, the application SHALL obtain them by an explicit
per-frame sample rather than relying on a reset performed by a loop the application does not own.
Counters describing a whole session SHALL NOT be reported as per-frame values.

#### Scenario: Two consecutive frames report comparable counters

- **WHEN** two consecutive rendered frames are sampled
- **THEN** the reported draw-call and geometry counts are of the same order
- **AND** they do not grow monotonically across the session

#### Scenario: A skipped frame does not report stale counters

- **WHEN** no frame was rendered
- **THEN** the per-frame counters are reported as not applicable
- **AND** they are not carried over from a previous frame

#### Scenario: Lifetime counters remain lifetime counters

- **WHEN** memory and resource-lifetime counters are reported
- **THEN** they continue to describe the whole session
- **AND** they are not presented as per-frame values

### Requirement: A frame that presents nothing SHALL not rebuild its display graph

The display chain SHALL rebuild its node graph only when a value it depends on actually changes. A
settled frame SHALL NOT reassign node graphs or mark materials for recompilation.

#### Scenario: A settled frame

- **WHEN** consecutive frames render with no change to exposure, tone mapping, bloom, temporal
  policy or output target
- **THEN** the display graph is not rebuilt
- **AND** the rebuild counter does not increase

#### Scenario: A real change rebuilds the graph

- **WHEN** a value the display graph depends on changes
- **THEN** the graph is rebuilt once

#### Scenario: Every policy setter has a value guard

- **WHEN** a policy setter is called with an unchanged value
- **THEN** it performs no work
- **AND** the guard is present on every setter that can invalidate the graph

### Requirement: Resize SHALL be gated on device availability and SHALL surface reduction

A resize SHALL NOT issue renderer commands after device loss. Where a requested internal size is
reduced to satisfy a device limit, the reduction SHALL be surfaced.

#### Scenario: Resize after device loss

- **WHEN** a resize is requested after the device has been lost
- **THEN** no renderer sizing or post-target command is issued
- **AND** the terminal device-loss state is preserved

#### Scenario: Requested size exceeds the device limit

- **WHEN** a requested internal size exceeds the maximum supported texture size
- **THEN** the size is reduced to the maximum
- **AND** the reduction is reported with the requested and applied values

#### Scenario: A size within limits

- **WHEN** a requested internal size is within limits
- **THEN** no reduction is reported

### Requirement: The hot path SHALL NOT allocate diagnostic structures

A code path executed every rendered frame SHALL NOT construct a diagnostic object graph, clone
matrices, or copy arrays that the caller does not retain. Diagnostics SHALL be produced on demand.

#### Scenario: A cheap enabled-state query

- **WHEN** a per-frame path needs to know whether a subsystem is enabled
- **THEN** it queries a scalar property
- **AND** it does not build a diagnostic snapshot

#### Scenario: Reusable scratch values

- **WHEN** a per-frame path performs intermediate vector and matrix arithmetic
- **THEN** it reuses preallocated scratch values
- **AND** it does not allocate per frame

### Requirement: Uniform writes SHALL be revision-checked

A service that writes a uniform value from a per-frame fan-out SHALL compare the incoming value with
the currently applied value and skip the write when unchanged.

#### Scenario: An unchanged value is not rewritten

- **WHEN** a per-frame fan-out supplies a value equal to the one already applied
- **THEN** no uniform write occurs
- **AND** no dependent derived value is recomputed

#### Scenario: A changed value is written once

- **WHEN** a value changes
- **THEN** it is written once
- **AND** dependent derived values are recomputed

### Requirement: Strided storage channels SHALL be indexed by their own stride

Where a service stores several quantities in parallel arrays with separate stride constants, each
channel SHALL be indexed using that channel's stride.

#### Scenario: A stride constant changes

- **WHEN** one channel's stride differs from another's
- **THEN** each channel is still read and written at its correct element offset
- **AND** a test asserts the update with differing stride values produces the expected trajectory

### Requirement: Runtime data assets SHALL be cached across arrivals

A destination whose runtime data asset is loaded from the network SHALL cache the validated asset so
that returning to the destination does not re-fetch and re-verify it.

#### Scenario: Returning to a destination

- **WHEN** the user leaves a data-driven destination and returns to it
- **THEN** the validated asset is served from the cache
- **AND** no network request is issued for the asset

#### Scenario: Cache bounds

- **WHEN** several data assets are cached
- **THEN** the cache is bounded
- **AND** evicting an entry does not leave a partially validated asset reachable

#### Scenario: A cached asset is still the validated asset

- **WHEN** a cached asset is served
- **THEN** it is the same validated object that was verified on first load
- **AND** it is not re-validated from partially written state
