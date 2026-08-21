# Atlas state, routes, presets and invalidation

## 1. State architecture

Cosmic Atlas separates global host state from destination state.

Conceptual schema:

```ts
interface CosmicAtlasStateV1 {
  schemaVersion: 1;

  atlas: {
    activeDestination: DestinationId;
    activePreset: string;
    targetDestination: DestinationId | null;
    targetPreset: string | null;
    transition: TransitionPublicState;
  };

  sharedVisual: {
    exposure: number;
    bloomEnabled: boolean;
    bloomStrength: number;
    toneMapping: string;
  };

  rendering: {
    qualityMode: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
    targetFps: 30 | 60;
    renderScaleOverride: number | null;
  };

  accessibility: {
    reducedMotion: boolean;
    highContrastUi: boolean;
  };

  camera: AtlasCameraPublicState;

  destinations: {
    [id: string]: VersionedDestinationState;
  };
}
```

Runtime-only handles/resources do not live in serialized state.

## 2. Route parsing

Route is authoritative for destination identity on direct load/history navigation.

Canonical:

```text
/atlas/:destination
```

Recognized public query values are destination-specific and validated.

Unknown destination:

- redirect to default (`black-hole`) with visible/logged reason;
- or show destination-not-found UI if product prefers.

Invalid preset:

- fall back to destination default;
- never throw during startup.

## 3. Preset schema

Each preset defines:

- stable ID;
- display name;
- destination ID;
- state schema version;
- physical model/fidelity metadata;
- destination public state;
- camera arrival preset;
- deterministic seed where needed;
- timeline initial phase.

Presets are versioned data, not arbitrary UI callbacks.

## 4. Transition runtime state

Runtime state may include:

```text
phase
sourceId
targetId
generation
prepareAbortController
preparedTargetHandle
phaseStartedAt
outgoingSnapshot
minimumReady
error
```

Most of this is not serialized into URL/share state.

## 5. Generation safety

Every requested destination change increments a target generation.

Async completion checks generation before commit.

```text
prepare B generation 10
user selects C generation 11
B finishes
10 != 11 -> B cannot activate; dispose B prepared scope
```

## 6. State validation

All public values pass one normalizer before reaching render services.

Responsibilities:

- finite-number checks;
- enum validation;
- clamp documented control ranges;
- unit conversion;
- preset migration;
- cross-field constraints;
- dangerous-combination guardrails.

UI does not write raw GPU uniforms directly.

## 7. Invalidation flags

Use bitmask/set semantics for expensive subsystem invalidation.

Suggested categories:

```text
CAMERA
DESTINATION_MODEL
TIMELINE
PARTICLES
VOLUME
LENSING
POST
QUALITY
RESOLUTION
ASSET
TEMPORAL_HISTORY
```

A bloom-strength change should not rebuild galaxy trajectory buffers.

A timeline scrub should not recompile shaders.

## 8. Destination state examples

### Neutron Star

```text
preset
mass
radius
spinHz
spinAxis
magneticTilt
observerInclination
hotSpots[]
beamMode
flareState
time
```

### Stellar Explosion

```text
preset
timelinePhase
energyProxy
asymmetryPreset
clumpingSeed
jetEnabled
jetOpeningPreset
observerInclination
```

### Compact Merger

```text
preset
phase
playbackRate
massScenario
viewingAngle
jetScenario
kilonovaScenario
```

### Galaxy Collision

```text
datasetId
phase
playbackRate
tracerQuality
overlayGas
overlayStarburst
```

## 9. Share-state policy

Do not put huge arrays or binary state in URL.

Share links contain:

- destination;
- preset;
- compact overrides;
- camera if stable/useful;
- timeline phase.

Binary data always referenced by versioned dataset ID.

## 10. Schema migrations

On state schema change:

- write explicit migration;
- test old fixture -> new normalized state;
- reject unsupported future versions;
- never silently reinterpret units.

## 11. Reset behavior

Each destination provides:

- reset controls to preset;
- reset camera;
- reset timeline;
- full destination reset.

Reset must be deterministic.

## 12. Quality state is not scientific state

Changing Auto/Low/High must not change intended physical state. It may change numerical/render approximation within documented tolerances and visible quality, not physical parameters.

## 13. Timeline state

Destinations define a timeline adapter:

```ts
interface TimelineAdapter {
  getPhase(): number;
  setPhase(x: number): void;
  getPhysicalLabel(): string;
  step(dtDisplay: number): void;
  reset(): void;
}
```

Data-driven timelines map phase to source sample time.

Procedural timelines map phase to model parameters.

## 14. History behavior

Back/forward destination changes should:

- validate route;
- prepare target;
- use transition if current app is already interactive and reduced-motion policy permits;
- preserve browser history semantics;
- never create history loops through internal redirects.