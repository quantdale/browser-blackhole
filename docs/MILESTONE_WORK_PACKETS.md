# Detailed milestone work packets

This document expands `ROADMAP.md` into executable work packets. IDs are stable planning identifiers. An autonomous agent should mark completion/evidence in `.agent/STATE.md` rather than deleting packets.

## M0 — Repository and rendering foundation

### M0-01 Toolchain resolution

Deliver:
- verify current stable compatible Node, package manager, Vite, TypeScript, Three.js, Vitest, Playwright, lint/format versions;
- record chosen versions and primary-source links in `docs/DEPENDENCIES.md`;
- choose one package manager;
- create exact lockfile.

Tests/evidence:
- clean install from lockfile;
- `node --version` and package-manager version recorded;
- no floating dependency ranges where reproducibility would be compromised.

### M0-02 Project skeleton

Deliver:
- Vite TypeScript app;
- `src/app`, `src/renderer`, `src/camera`, `src/physics`, `src/shaders`, `src/ui` only as needed;
- production/dev entry point;
- strict TypeScript configuration.

Gate:
- `typecheck`, `build` pass from clean checkout.

### M0-03 Renderer capability layer

Deliver:
- runtime capability snapshot;
- WebGPURenderer initialization;
- WebGPU-preferred and documented WebGL2 fallback behavior;
- explicit unsupported state.

Gate:
- unit tests for capability decision logic;
- browser smoke displays actual backend/status.

### M0-04 Full-screen diagnostic pass

Deliver:
- one full-screen triangle/pass;
- deterministic ray/NDC diagnostic color;
- no black-hole physics yet.

Gate:
- screenshot proves full coverage/no seam;
- resize does not corrupt output.

### M0-05 Camera abstraction

Deliver:
- PerspectiveCamera + OrbitControls behind `CameraController`;
- canonical camera basis export;
- movement/change events;
- damping/update lifecycle.

Gate:
- center ray follows camera forward;
- camera disposal removes listeners.

### M0-06 Resize and DPR plumbing

Deliver:
- ResizeObserver or robust container sizing;
- positive-size guard;
- internal render size calculation;
- initial DPR cap/quality hook.

Gate:
- portrait/landscape resize browser test;
- zero-sized container recovery test.

### M0-07 Canonical state/presets skeleton

Deliver:
- schema v1 types/defaults;
- normalization/validation;
- initial diagnostic preset;
- revision/invalidation classification skeleton.

Gate:
- invalid numbers/vectors handled deterministically.

### M0-08 Test and CI foundation

Deliver:
- Vitest;
- Playwright smoke;
- format/lint/typecheck/test/build scripts;
- GitHub Actions deterministic gate.

Gate:
- clean local aggregate;
- CI truthful about GPU availability.

### M0-09 Error UX

Deliver:
- initialization status component;
- unsupported/failure messages;
- technical details in debug/development mode.

Gate:
- injected capability failure produces visible non-blank UI.

### M0-10 M0 checkpoint

Deliver:
- update `.agent/STATE.md`;
- record commands/results/environment;
- screenshot diagnostic frame;
- commit/push.

Exit: all M0 roadmap requirements satisfied.

---

## M1 — Camera rays and celestial environment

### M1-01 Camera-ray reconstruction

Implement `makeCameraRay` from pixel NDC, camera basis, aspect, and FOV.

Tests:
- center/corners/edges;
- odd/even resolutions;
- portrait/landscape;
- CPU-vs-selected-pixel GPU comparison.

### M1-02 Canonical world/environment frame

Define handedness, axes, black-hole center, disk normal default, sky orientation. Add diagram/comments. No module may independently reinterpret axes.

### M1-03 Deterministic star generator

Implement procedural star field with fixed seed/time. Separate star density, brightness distribution, and background base radiance.

Gate:
- identical preset produces identical visual baseline under fixed browser environment.

### M1-04 Straight-ray environment sampling

Before gravity, use camera world direction to sample environment. Validate orientation under camera rotation.

### M1-05 Ray debug view

Encode XYZ direction to visible debug output; selected-pixel probe exposes numeric direction.

### M1-06 M1 visual baseline

Commit goldens for diagnostic ray and no-gravity star field.

---

## M2 — Reference physics and Schwarzschild geodesics

### M2-01 Physical constants/units

Implement centralized `G`, `c`, solar mass, `r_g`, Schwarzschild radius, photon sphere, ISCO, `t_g` conversions.

### M2-02 Static observer tetrad

Implement CPU reference mapping from local photon direction to Schwarzschild constants/state as specified in `NUMERICAL_METHODS.md`.

### M2-03 CPU RK4 reference solver

Implement readable double-precision solver with classification/diagnostics. No premature optimization.

### M2-04 Convergence harness

Automate step-size tightening and fixture generation metadata.

### M2-05 Core fixtures

Generate radial, weak-field, critical-boundary, symmetry fixtures from `VALIDATION_VECTORS.md`.

### M2-06 GPU Schwarzschild state initialization

Port initial-state mapping to TSL with selected-pixel comparison.

### M2-07 GPU fixed-step integrator

Implement bounded numerical loop and explicit classifications.

### M2-08 Horizon/escape events

Implement capture and conservative escape. Add debug colors.

### M2-09 Escaped sky lensing

Sample environment using final escaped direction. Verify actual star duplication/warping emerges.

### M2-10 Debug diagnostics

Add classification, steps, min-radius, winding/trajectory indicator views.

### M2-11 CPU/GPU corpus comparison

Selected pixels/rays compare classification and observables with documented f32 tolerances.

### M2-12 M2 checkpoint

No hidden `MAX_STEPS`/NaN as shadow. Persist failure cases and limits.

---

## M3 — Thin accretion disk geometry

### M3-01 Disk canonical geometry

Implement validated normal, inner/outer radii, scientific defaults.

### M3-02 Segment plane-crossing detector

Detect sign change/small distance in world-reembedded curved trajectory.

### M3-03 Crossing refinement

Bounded refinement/substep to hit tolerance; expose failure.

### M3-04 Radial acceptance

Reject crossings inside inner hole/outside outer radius.

### M3-05 Direct disk image

Render simple deterministic emissivity to prove hit geometry before relativity/color.

### M3-06 Higher-order images

Verify naturally lensed secondary disk images in strong-field view; do not paint them manually.

### M3-07 Disk fixtures

Generate direct, far-side, grazing, inner-hole, outer-edge, higher-order cases.

### M3-08 Disk debug views

Hit radius/order/candidate refinement visualization.

### M3-09 M3 checkpoint

Tighter integration settings converge on hit location within documented bounds.

---

## M4 — Relativistic disk emission

### M4-01 Circular emitter four-velocity

Implement Schwarzschild circular geodesic `Omega`, `u^t`, `u^phi` for supported radii.

### M4-02 Frequency shift invariant

Implement `g=(-k·u_obs)/(-k·u_emit)` with centralized backward-tracing sign convention.

### M4-03 Static redshift fixture

Validate analytic static-emitter gravitational shift before Doppler.

### M4-04 Doppler ordering fixture

Verify approaching side `g` > corresponding receding side at inclination.

### M4-05 Intensity/radiance model

Declare whether primary shader stores specific/bolometric approximation and apply consistent `g` power.

### M4-06 Temperature/emissivity profile

Implement documented radial model; scientific and cinematic parameters remain separate.

### M4-07 RGB/spectrum approximation

Implement Planck/blackbody approximation or efficient validated mapping. Guard exponential overflow/underflow.

### M4-08 Mass scale invariance

Implement normalized/physical modes and automated equality test for normalized geometry.

### M4-09 M4 checkpoint

Physics debug outputs and scientific image tests pass.

---

## M5 — HDR, post-processing, and full product UI

### M5-01 Linear HDR target

Primary ray output remains linear HDR/half-float where supported.

### M5-02 Exposure/tone mapping

Implement selected supported tone mapping with deterministic settings.

### M5-03 Bloom

Add bloom after radiance calculation. Scientific defaults restrained; cinematic can increase.

### M5-04 Structured control panel

Implement sections from `UI_CONTROL_CATALOG.md`: Black Hole, Observer, Disk, Relativity, Visual, Rendering, Debug.

### M5-05 Scientific/Cinematic/Debug modes

Modes change appropriate defaults/presentation; Scientific never substitutes fake physics.

### M5-06 Production presets

Add face-on, inclined, lensing-only, Doppler, cinematic hero, benchmark presets.

### M5-07 Responsive/accessibility

Keyboard access, visible labels, mobile layout, canvas alternative explanation, reduced-motion consideration.

### M5-08 M5 visual suite

Golden expected/actual metadata includes backend and render settings.

---

## M6 — Measured real-time optimization

### M6-01 Telemetry

CPU frame time, GPU timestamp when supported, render scale, dimensions, profile.

### M6-02 Benchmark harness

Implement `BENCH_*` deterministic scenes and JSON record writer.

### M6-03 Baseline report

Capture numerical renderer before optimization on available representative hardware.

### M6-04 Early escape tuning

Sweep escape radius vs reference angular error.

### M6-05 Adaptive step policy

Compare candidate heuristic/error controller on ray corpus.

### M6-06 Dynamic resolution

Implement hysteretic scale controller with faster decrease/slower increase.

### M6-07 Interaction quality state

Moving/settling/stationary behavior.

### M6-08 DPR caps

Validate high-DPR/mobile behavior.

### M6-09 M6 report

Before/after frame-time percentiles and physics-error evidence.

---

## M7 — Temporal refinement

### M7-01 Jitter sequence

Deterministic low-discrepancy/subpixel jitter suitable for temporal accumulation.

### M7-02 History buffers

Allocate bounded resources and expose memory cost.

### M7-03 Invalidation key

Reset for camera/geometry/radiance changes as required; preserve for post-only changes when mathematically valid.

### M7-04 Stationary accumulation

Increase sample quality while stationary.

### M7-05 Motion behavior

Reset or reproject; begin with reset if reprojection correctness is not ready.

### M7-06 Reprojection research

Only add motion/history reprojection with valid motion mapping and disocclusion rejection.

### M7-07 Ghosting suite

Camera orbit, FOV change, disk control, backend switch, resolution change, time animation.

### M7-08 M7 checkpoint

Quantify convergence and ghost rejection.

---

## M8 — Optimized Schwarzschild LUT backend

### M8-01 Paper/reference review

Document equations/mapping understood from Bruneton and provenance/license implications.

### M8-02 LUT schema/manifest

Versioned metadata/checksum/error schema.

### M8-03 Generator prototype

Offline deterministic generation with reference comparison.

### M8-04 Domain parameterization

Design nonlinear/critical sampling based on error study.

### M8-05 Runtime sampler

Implement validated table decode/interpolation and out-of-domain handling.

### M8-06 Disk/environment integration

Ensure direct/higher-order disk and beam/star filtering quality.

### M8-07 Equivalence corpus

Numerical vs LUT selected rays and goldens.

### M8-08 Performance report

Frame time and memory comparison on same presets.

### M8-09 Auto backend policy

Use LUT only when validated assets/capabilities available; numerical remains selectable.

---

## M9 — Kerr spacetime

Follow `KERR_RESEARCH_PLAN.md`; do not implement from memory.

### M9-01 Convention ADR
### M9-02 Independent CPU reference solver/fixtures
### M9-03 GPU Kerr state evolution
### M9-04 Horizon/capture and coordinate regularity
### M9-05 Carter constants/diagnostics
### M9-06 Spin-dependent ISCO/disk orbit model
### M9-07 Frame-dragging visuals/debug
### M9-08 `spin -> 0` convergence suite
### M9-09 prograde/retrograde fixtures
### M9-10 Kerr performance characterization

---

## M10 — Relativistic observer modes

### M10-01 Observer four-velocity interface
### M10-02 Static observer
### M10-03 Circular orbit observer
### M10-04 Flyby worldline
### M10-05 Freefall/plunge worldline
### M10-06 Aberration/frequency transformation
### M10-07 time/pause controls
### M10-08 near-horizon stability/error behavior
### M10-09 observer reference scenarios

Observer mode is complete only when apparent changes come from physical observer frame/worldline, not merely moving a Three.js camera.

---

## M11 — Production hardening

### M11-01 Browser matrix
### M11-02 Mobile/touch/DPR hardening
### M11-03 device-loss recovery torture
### M11-04 resource leak/reinitialize torture
### M11-05 accessibility review
### M11-06 asset/provenance/license audit
### M11-07 production bundle/HTTPS deployment
### M11-08 final benchmark report
### M11-09 user-facing physics/about documentation
### M11-10 release candidate full gate

## Cross-milestone rule

A packet may be researched ahead of its milestone, but integration must not violate the main roadmap dependency chain. Every implemented packet has evidence; every deferred packet has a reason.