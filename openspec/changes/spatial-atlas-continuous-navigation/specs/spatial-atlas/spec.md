# Spatial Atlas specification

## ADDED Requirements

### Requirement: Explorer SHALL ship as a lightweight destination at /atlas/explore

The spatial explorer SHALL be exposed as a lightweight destination behind the existing atlas route model, without widening the existing local camera rig.

#### Scenario: explorer route boots without a new camera controller class

- GIVEN the atlas shell is running
- WHEN the user navigates to /atlas/explore
- THEN the Explorer destination SHALL activate without replacing the existing destination camera controllers
- AND the Specialized destination routes SHALL remain governed by their own controllers.

### Requirement: Authoritative spatial coordinates SHALL use CPU binary64

Global spatial state SHALL be normalized at a single boundary into a namespaced `SpatialStateV1`, and the GPU SHALL receive only focus-relative normalized f32 coordinates.

#### Scenario: large-world position does not jitter on GPU

- GIVEN two catalog objects separated by orders-of-magnitude distances
- WHEN the camera focuses on one object
- THEN the GPU-bound positions SHALL be focus-relative normalized floats
- AND no focus-relative screen position SHALL exhibit f32 precision jitter as the camera crosses scale bands.

### Requirement: Reality classes SHALL remain distinct

Real, historical, reference and conceptual positions SHALL be separate reality classes in the catalog, and conceptual hubs SHALL be used for simulations without valid real coordinates.

#### Scenario: simulation without coordinates gets a conceptual hub

- GIVEN a catalog entry for a simulation that has no defensible real coordinate
- WHEN the entry is placed in the spatial catalog
- THEN it SHALL be marked conceptual rather than assigned a fabricated real position
- AND its marker SHALL NOT imply a scientifically valid position.

### Requirement: TransitionDirector SHALL gain continuous-handoff modes

Destination transitions SHALL support `hyperspace | crossfade | continuous-handoff`, and Explorer takeover SHALL NOT replace the existing TransitionDirector.

#### Scenario: entering a destination from Explorer

- GIVEN the user is orbiting a cataloged object in Explorer
- WHEN the user activates the linked destination
- THEN the handoff SHALL use the director's continuous-handoff or crossfade path
- AND existing direct destination routes SHALL continue to work unchanged.

### Requirement: Spatial failures SHALL fall back truthfully

A spatial failure SHALL return the user to Explorer or a truthful status view, never a blank canvas or a fabricated position.

#### Scenario: catalog load fails

- GIVEN the spatial catalog fails to load
- WHEN Explorer attempts to activate
- THEN the shell SHALL present a truthful error or status view
- AND no fabricated marker positions SHALL render.

### Requirement: Explorer SHALL work without WebGPU compute

All baseline Explorer functionality SHALL work on both WebGPU and the WebGL2 fallback, with no mandatory compute dependency.

#### Scenario: WebGL2 fallback can still explore

- GIVEN the app is forced onto the WebGL2 backend
- WHEN the user uses markers, labels, search and picking in Explorer
- THEN the core navigation SHALL remain functional without WebGPU compute.

### Requirement: Explorer rendering SHALL remain bounded and cheap

Explorer SHALL use one or a few batched/instanced passes, bounded DOM labels, the global quality authority and on-demand rendering.

#### Scenario: dense catalog remains within budget

- GIVEN a catalog with many markers across several scale bands
- WHEN Explorer is idle in a region
- THEN visible labels SHALL be bounded and budgeted
- AND rendering SHALL be driven by the global quality authority rather than a destination-local governor.

### Requirement: The default landing route SHALL NOT switch before certification

The root route SHALL NOT switch to Explorer until the SA12 certification gate passes, and all existing direct destination routes SHALL remain supported throughout.

#### Scenario: pre-certification root behavior

- GIVEN SA12 certification has not passed
- WHEN a user opens the root route
- THEN the product SHALL NOT default to Explorer
- AND every pre-existing direct destination route SHALL remain reachable.

### Requirement: Linked destinations SHALL disclose their relationship class

A marker linking to a destination SHALL disclose whether it is an exact/representative object, a representative model, or a related concept.

#### Scenario: marker to a representative model

- GIVEN a catalog marker whose destination renders a representative model of a related concept
- WHEN the marker label is displayed
- THEN the UI SHALL state that relationship rather than implying an exact object.
