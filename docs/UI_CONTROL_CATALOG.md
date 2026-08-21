# UI control catalog and semantics

This is the authoritative inventory of user-facing controls. Exact ranges may be tuned by implementation/benchmark evidence, but semantic meaning and physical-vs-cinematic separation must remain clear.

## 1. Global mode

### Experience mode

Options:
- Scientific
- Cinematic
- Debug

Scientific prioritizes physically defined output and conservative post-processing. Cinematic may enhance presentation without changing core geodesic geometry. Debug exposes numerical views/advanced controls.

Changing mode should apply a known preset of visual/debug settings while preserving user physical state unless explicitly documented.

## 2. Black Hole panel

### Metric

`Schwarzschild | Kerr`

Kerr disabled/marked unavailable until M9 exists. Do not present a nonfunctional spin slider as if implemented.

### Mass

Display logarithmic-friendly astrophysical range. Suggested UI spans stellar to supermassive masses while accepting validated manual input.

Units: solar masses by default, with derived kg optional in info view.

Normalized-mode explanation: changing mass alone does not alter normalized image when all distances remain in `r_g`.

### Distance system

`Normalized (r_g) | Physical`

Explain exactly what changes.

### Spin

Kerr only. Signed dimensionless `a*`. Show prograde/retrograde relationship to disk orientation.

### Spin/disk axis

Advanced control or orientation gizmo later. For Schwarzschild this is scene/disk orientation, not spacetime spin.

## 3. Observer panel

### Camera mode

Initially `Free`. Later:
- Static
- Circular orbit
- Flyby
- Free fall / plunge

Modes requiring physics remain disabled until implemented.

### Distance

Normalized mode: `r_g`.
Physical mode: selectable km/AU/pc where meaningful.

Show derived normalized distance in physical mode.

### Inclination

For convenience, camera inclination relative to disk normal. Free orbit controls may update it. Avoid singular UX at exact pole.

### Field of view

Vertical FOV degrees. Suggested initial usable range about 15–110°, default around 50–60°. Extreme values may be advanced only.

### Time / time scale

Added when disk animation/observer worldlines require it. Include pause.

## 4. Accretion Disk panel

### Enabled

Turns emitting disk on/off. Gravitational lensing/background still operates.

### Inner radius

Units `r_g`. Scientific Schwarzschild default `6 r_g` for stable-orbit thin disk unless a plunging emission model is separately selected.

UI may show markers:
- horizon 2;
- photon sphere 3;
- ISCO 6 (Schwarzschild).

Do not allow an “inner radius” below horizon as ordinary scientific input.

### Outer radius

Must exceed inner radius. Use logarithmic slider if broad range needed.

### Temperature/emissivity model

Scientific options must name model/approximation. Avoid a raw “hotness” slider in Scientific mode; expose physical/model scale and explanatory tooltip.

### Temperature scale/accretion proxy

If not a full accretion-rate model, call it what it is. Do not label arbitrary emissivity scalar as `Mdot` without an equation connecting them.

### Turbulence

Cinematic/visual procedural structure. If used in Scientific mode, label as visualization texture, not simulated GRMHD turbulence.

### Animation speed

Controls procedural evolution/time visualization. Does not change orbital geodesic formulas unless tied explicitly to simulation time.

## 5. Relativity panel

Educational toggles:

### Gravitational lensing

Scientific renderer normally on. `off` may switch to straight-ray comparison mode.

### Gravitational redshift

Affects frequency/radiance transformation, not ray geometry.

### Doppler shift/beaming

Separate only if implementation can meaningfully isolate them; otherwise group under `Relativistic disk motion` with detailed tooltip.

### Higher-order images

These emerge from trajectories. Prefer an explanation/quality indicator rather than a fake independent toggle. If performance policy suppresses long-winding rays in low quality, describe the quality limitation.

## 6. Visual panel

### Exposure

EV-like display when practical. Pure post-process.

### Tone mapping

Only list options actually supported/validated by current Three.js renderer.

### Bloom

Enable, threshold, strength. Mark as display effect.

### Background/star intensity

Display scalar.

### Cinematic disk tint

Cinematic mode only or clearly marked nonphysical.

### UI overlays

Labels for horizon/photon sphere/ISCO can be educational overlays; ensure they do not imply apparent shadow boundary equals the coordinate radius.

## 7. Rendering panel

### Quality

`Auto | Low | Medium | High | Ultra | Custom`

Show compact summary such as internal scale/max steps/temporal status for advanced users.

### Backend

`Auto | Numerical | LUT` once LUT exists. Kerr backend selection follows metric automatically; do not expose incompatible combinations without explanation.

### Target FPS

Advanced/Auto control: 30/60, optionally 90/120 where useful.

### Dynamic resolution

Default on in Auto. Show current render scale in telemetry, not as rapidly moving slider.

### Render scale

Custom mode. Clamp safe range.

### Max steps / integration quality

Advanced Debug/Custom only. Tooltips explain that increasing can be expensive and does not linearly equal accuracy.

### Temporal refinement

Enable/disable and target stationary samples where supported.

## 8. Debug panel

### Render view

- Final
- Classification
- Step count
- Minimum radius
- Winding
- Disk hit
- Redshift `g`
- Escape direction
- Numerical error
- History age

### Selected pixel probe

Click/tap canvas in Debug mode to select pixel. Panel displays CPU/GPU diagnostics when available.

### Freeze deterministic time

Useful for screenshots/tests.

### Telemetry

Show CPU/GPU frame ms, backend, internal resolution, render scale, temporal samples.

## 9. Presets

Preset card/menu shows:

- name;
- one-line physical purpose;
- metric;
- scientific/cinematic tag;
- expected performance class if unusual.

Initial production set:

- Lensing Only
- Face-on Disk
- Edge/High Inclination
- Doppler Showcase
- Photon Ring
- Cinematic Hero
- Performance Typical

Later:
- Kerr Prograde
- Kerr Retrograde
- Near-Extremal Research
- Freefall/Plunge.

## 10. Reset behavior

Provide:
- Reset current panel;
- Reset all to default;
- Load preset.

Reset is deterministic and does not retain hidden advanced values that change output unexpectedly.

## 11. Control update rates

Continuous sliders should not rebuild GPU pipelines. State updates may be throttled/coalesced to animation frames for expensive rendering while label values update responsively.

On pointer release, stationary refinement begins after settling delay.

## 12. Mobile interaction

- canvas remains primary gesture area;
- one-finger orbit;
- pinch dolly where controls support it;
- control panel collapsible/bottom sheet style if implemented;
- sliders have touch-friendly targets;
- avoid simultaneous page scroll and camera gesture conflicts;
- no critical feature requires hover.

## 13. Accessibility

- every control has visible label;
- units included in label/value;
- keyboard operation;
- focus indicator;
- textual description of canvas/current preset;
- color is not the sole indicator for numerical classification in textual debug panel;
- respect reduced motion for UI transitions, not necessarily simulation unless user pauses it;
- semantic groups/headings.

## 14. Tooltips/explanations

Minimum educational definitions:

- gravitational radius;
- event horizon;
- photon sphere;
- black-hole shadow;
- ISCO;
- gravitational redshift;
- Doppler beaming;
- normalized scale invariance;
- numerical vs LUT renderer;
- Scientific vs Cinematic.

## 15. Dangerous combinations

Validation prevents or warns:

- static observer inside unsupported region;
- disk inner > outer;
- inner disk below horizon;
- absurd render scale/max steps likely to hang mobile GPU;
- Kerr-only setting while Schwarzschild active;
- unsupported backend/feature combination.

## 16. URL/persistence UX

Do not add share URLs/local persistence until schema/versioning exists. When added, provide visible reset/recovery from malformed state and never encode debug adapter/fingerprint data.

## 17. Scientific labeling rule

A control name must match the implemented equation. If a value merely changes art direction, label it Visual/Cinematic. This is a core product integrity requirement.