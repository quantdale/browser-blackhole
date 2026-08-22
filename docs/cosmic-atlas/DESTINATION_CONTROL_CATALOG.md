# Destination control catalog

This catalog defines intended user controls and prevents agents from inventing misleading sliders.

Controls marked **physical** require model units/conventions. Controls marked **scenario** select validated/model presets. Controls marked **visual** affect presentation only.

## Shared Atlas controls

- Destination — navigation
- Preset — scenario
- Play/Pause — timeline
- Time/Phase — physical or normalized depending destination
- Camera mode — observer/navigation
- Reset camera
- Reset destination
- Quality — rendering
- Target FPS — rendering
- Exposure — visual
- Bloom — visual
- Fidelity/About — documentation

## Black Hole

Owned by existing black-hole specification.

Atlas must reuse existing control semantics rather than redefining mass/spin/disk parameters here.

### Scenario

- `default`, `cinematic-orbit` — presentation presets over the full numerical
  Schwarzschild backwards ray tracer;
- `debug-parity` — DEBUG TOOL: encoded terminal escape direction
  (`rgb = dir*0.5+0.5`, linear), black captured rays, failure-magenta failures,
  disk disabled. Not a presentation view; consumed by the integrator parity
  corpus (docs/cosmic-atlas/VALIDATION_TESTING.md §4).

## Neutron Star

### Physical/model

- Mass
- Radius
- Spin frequency
- Spin-axis orientation
- Observer inclination
- Hot-spot angular radius
- Hot-spot latitude/longitude
- Surface temperature/emission preset

### Scenario

- Standard neutron star
- Pulsar
- Magnetar
- Magnetar flare

### Model/illustrative

- Magnetic-axis tilt
- Beam opening preset
- Field-line visibility/density

### Visual

- field-line brightness
- beam visual opacity
- surface false-color mode

Do not expose magnetic-field-line twist as a precise physical number until a defined model supports it.

## Stellar Explosion

### Scenario

- Core-collapse standard
- Stripped-envelope-like
- Hypernova
- Long-GRB / jetted collapse

### Model

- expansion/energy proxy
- ejecta asymmetry preset
- clumping level
- progenitor radius preset
- jet opening preset
- observer inclination

### Timeline

- phase/time compression
- play/pause

### Visual

- volume opacity scale
- particle visibility
- cinematic bloom

Hypernova mode must alter physical/model parameters, not only visual brightness.

## Compact Merger

### Scenario

- equal-mass NS-NS
- unequal-mass NS-NS
- future NS-BH preset
- kilonova-focused
- short-GRB-focused

### Model

- component masses where supported
- viewing angle
- jet opening scenario
- ejecta scenario
- remnant scenario

### Timeline

- phase scrubber with named phases
- playback rate

Avoid continuous freeform remnant selection if physics mapping is not modeled.

## Black-Hole Merger

### Scenario/data

- reference dataset/event
- mass-ratio/spin case only when represented by actual data

### Timeline

- inspiral/merger/ringdown phase
- playback rate

### Observer/visual

- camera orientation
- waveform component display
- lensing illustration toggle

The lensing toggle must be labeled illustrative if the runtime is not using dynamical NR ray tracing.

## Tidal Disruption

### Physical/model

- black-hole mass
- stellar type/mass/radius preset
- encounter penetration/periapsis scenario
- observer orientation

### Timeline

- approach/disruption/stream/disk phase

### Visual

- debris density visibility
- shock visualization

Avoid a free slider that implies exact TDE hydrodynamics unless supported.

## Quasar / AGN

### Scenario

- quasar/AGN reference preset
- blazar viewing preset
- radio-loud/jet-visible illustrative preset where researched

### Physical/model

- SMBH mass via existing black-hole model
- accretion/disk preset
- observer angle to jet

### Navigation

- scale jump: Inner / Nuclear / Galactic
- continuous zoom where supported

### Visual

- torus visibility
- host-galaxy visibility
- jet tracer density

Do not let a visual jet-brightness slider masquerade as intrinsic jet power.

## Galaxy Collision

### Data/scenario

- dataset/simulation case
- phase
- playback rate

### Rendering

- star tracer density
- gas overlay
- dust overlay
- starburst proxy
- trajectory/center markers

Scientific source trajectories are not user-editable unless an interactive reduced dynamics model is deliberately added later.

## Stellar Merger

### Scenario

- collision/contact case
- luminous-red-nova-like outcome

### Timeline

- approach/contact/merger/ejecta/transient

### Visual/model

- ejecta morphology preset
- dust/light-echo visibility if implemented

## Solar Activity

### Scenario

- quiet active region
- solar flare
- CME

### Model

- field-line seed region
- flare phase
- CME speed/scale proxy if documented

### Visual

- corona exposure
- field-line density

## Lensing Lab

### Physical under chosen lens model

- lens mass/strength
- lens distance
- source distance
- source angular position
- source size

### Scenario

- perfect Einstein-ring alignment
- double-image case
- arc/extended-source case

### Debug/education

- show lens plane
- show image positions
- show Einstein radius
- show caustic/critical curves if model supports them

## Control review rule

Every new control must answer:

1. Is it physical, scenario/model, rendering, or visual?
2. What units/range apply?
3. What subsystem invalidates?
4. Is it serializable in a share link?
5. Can it produce unsupported/unphysical combinations?
6. Does the label imply more precision than the model provides?