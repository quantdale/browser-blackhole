# Product UX and hyperspace transitions

## 1. User mental model

Cosmic Atlas is one explorable universe.

The top destination selector acts like choosing where to travel, not opening another unrelated webpage.

The transition should feel intentional and cinematic while also serving a practical engineering role: masking scene handoff, shader warm-up, asset activation and resource disposal.

## 2. Destination selector

### Desktop

Primary launch destinations can appear as compact tabs/chips when width allows:

```text
Black Hole | Neutron Star | Stellar Explosion | Compact Merger | ...
```

On narrower desktop widths, group by category and provide an overflow selector.

### Mobile

Prefer:

- horizontal scrollable destination strip;
- or a compact `Destinations` button opening grouped navigation.

Do not squeeze eight unreadable labels into one row.

## 3. Route model

Canonical paths:

```text
/atlas/black-hole
/atlas/neutron-star
/atlas/stellar-explosion
/atlas/compact-merger
/atlas/black-hole-merger
/atlas/tidal-disruption
/atlas/quasar
/atlas/galaxy-collision
/atlas/stellar-merger
/atlas/solar-activity
/atlas/lensing
```

Stable query parameters may encode presets:

```text
?preset=pulsar
?preset=magnetar
?preset=hypernova
?preset=kilonova
?mode=blazar
?case=einstein-ring
```

Reload/deep-link must reproduce deterministic destination state or fall back safely when state is invalid.

## 4. Transition state machine

```text
IDLE
  │ user selects B
  ▼
PREPARE_TARGET
  │
  ├─ dynamic import
  ├─ essential manifest/assets
  ├─ decode/preprocess
  └─ pipeline/material warm-up
  │
  ▼
DEPART
  │
  ├─ camera departure cue
  ├─ transition field ramps in
  ├─ outgoing expensive simulation throttles
  └─ outgoing temporal accumulation stops
  │
  ▼
OCCLUDE
  │
  ├─ screen dominated by hyperspace
  ├─ outgoing heavy resources release
  ├─ target minimum-ready activation
  └─ route commit
  │
  ▼
ARRIVE
  │
  ├─ incoming rendered at conservative quality
  ├─ transition field decays
  ├─ camera settles
  └─ high-quality optional assets continue
  │
  ▼
INTERACTIVE
```

If target preparation is slow, `PREPARE_TARGET` may retain the current scene and show subtle destination-loading status before departure rather than beginning a transition that stalls midway.

## 5. Hyperspace render design

The transition should be cheap enough to remain smooth on the very hardware already stressed by a heavy astrophysical scene.

Preferred initial implementation:

- one full-screen triangle;
- procedural radial star streaks;
- domain-warped tunnel/noise field;
- exposure curve;
- vignette;
- optional restrained chromatic separation;
- outgoing scene texture;
- incoming scene texture or target arrival color field.

Conceptually:

```text
final = outgoing * wA
      + hyperspace(uv,time,intensity)
      + incoming * wB
```

Avoid a scene containing tens of thousands of individual streak meshes solely for transition graphics.

## 6. Transition phases and resource budget

### PREPARE_TARGET

Target:

- no visible frame hitch;
- network and decoding concurrency bounded;
- essential assets prioritized over optional assets;
- no full second heavy scene simulation.

### DEPART

Outgoing destination switches to `TRANSITION` quality:

- lower internal render scale;
- stop expensive stationary-only refinement;
- reduce volume steps;
- reduce particle update frequency if visually hidden;
- freeze data-driven time if appropriate.

### OCCLUDE

Ideal resource swap point.

Because most of the frame is transition graphics, the target may start below normal quality and outgoing scene can be released.

### ARRIVE

Use a predetermined arrival camera/preset so the first target frame is visually coherent.

Gradually restore target quality using global hysteresis rather than jumping directly to Ultra.

## 7. Reduced motion

Required behavior when `prefers-reduced-motion` is active or user toggles reduced travel motion:

```text
current destination
↓
short fade / luminance dissolve
↓
resource swap
↓
target destination
```

Avoid:

- rapid radial streaking;
- simulated high acceleration;
- large camera roll;
- repeated flashes;
- parallax tunnel motion.

Reduced motion changes presentation only; asset lifecycle remains identical.

## 8. Loading communication

Do not show a blocking progress bar for fast transitions.

If preparation exceeds a threshold, show a small status:

```text
Preparing Galaxy Collision…
Loading simulation data 2/3
```

Only expose percentages when actual byte/step progress is known.

## 9. Cancellation and rapid reselection

Users may click multiple destinations quickly.

Required:

- preparation receives an abort signal;
- stale destination preparation cannot commit state;
- target generation/token prevents old promises from activating;
- resource scope for abandoned preparation disposes correctly;
- final selected destination wins.

Do not allow race:

```text
click A -> B
click B -> C
B finishes late
B incorrectly becomes active
```

## 10. Browser navigation

Back/forward should trigger the same destination transition policy when practical.

Direct page load should skip hyperspace departure and initialize the requested destination normally.

Do not force a fake travel animation before the first scene is available.

## 11. Arrival cameras

Each destination provides one or more named arrival shots:

- `default`;
- `wide`;
- `close`;
- `educational`.

The transition director can select a deterministic arrival based on destination/preset.

## 12. Audio policy

Audio is optional and must not autoplay unexpectedly.

If added later:

- user enables it explicitly;
- transition sound must respect reduced-motion/accessibility preferences;
- no sound is required for feature completeness.

## 13. Destination-specific UI continuity

Persistent elements:

- destination selector;
- quality/performance access;
- About/Fidelity explanation;
- reset camera;
- accessibility controls.

Destination-specific controls change underneath without rebuilding the entire host UI.

## 14. Transition performance acceptance

For a preloaded target on representative desktop hardware:

- no multi-frame main-thread stall >50 ms;
- transition animation frame pacing should remain within current quality target;
- outgoing/incoming GPU memory overlap must stay inside device tier budget;
- repeated 20-destination-switch test shows no monotonic resource growth.

For slow/network-bound targets:

- current destination remains responsive while preparation occurs;
- transition does not begin until target has reached minimum-ready threshold.