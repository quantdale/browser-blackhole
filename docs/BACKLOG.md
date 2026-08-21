# Implementation backlog / work packets

This backlog converts the roadmap into agent-sized tasks. IDs are stable references for commits/state updates.

## Foundation

- **BH-001** Initialize Vite + TypeScript, pin current stable compatible dependencies, commit lockfile.
- **BH-002** Add format/lint/typecheck/test/build scripts and CI.
- **BH-003** Implement capability detection and backend/error UI.
- **BH-004** Initialize Three.js WebGPURenderer and deterministic render loop.
- **BH-005** Implement full-screen triangle + TSL diagnostic shader.
- **BH-006** Add camera/OrbitControls abstraction and resize handling.
- **BH-007** Implement canonical application-state schema, validation, and preset versioning skeleton.
- **BH-008** Establish Playwright browser smoke test and console-error gate.

## Camera/environment

- **BH-020** Implement camera ray reconstruction from viewport/camera basis.
- **BH-021** Add CPU tests for ray basis/FOV/aspect.
- **BH-022** Implement deterministic procedural celestial background.
- **BH-023** Create first visual golden-test infrastructure.

## Schwarzschild reference/production physics

- **BH-040** Implement geometric-unit conversion module and characteristic-radius tests.
- **BH-041** Implement readable CPU Schwarzschild null-geodesic reference solver.
- **BH-042** Produce trusted reference-ray fixtures around weak/strong/critical regimes.
- **BH-043** Implement GPU Schwarzschild geodesic integrator.
- **BH-044** Add captured/escaped/max-step classifications and debug output.
- **BH-045** Compare representative GPU results to CPU reference.
- **BH-046** Add weak-field, critical-impact, and spherical-symmetry tests.

## Disk

- **BH-060** Implement thin equatorial disk representation/state.
- **BH-061** Detect/refine disk intersections along curved paths.
- **BH-062** Add disk-hit radius/debug view.
- **BH-063** Implement deterministic radial emissivity/turbulence baseline.
- **BH-064** Add face-on/edge-on disk regression presets.

## Relativistic emission

- **BH-080** Implement orbital emitter velocity/four-velocity model.
- **BH-081** Implement frequency-shift `g` calculation and tests.
- **BH-082** Implement temperature/emissivity profile.
- **BH-083** Implement documented blackbody-to-RGB/spectral approximation.
- **BH-084** Apply correct specific/bolometric intensity transform for chosen shading formulation.
- **BH-085** Implement normalized vs physical mass/distance UI/state semantics.

## Visual/product

- **BH-100** Add HDR render target/color-management contract.
- **BH-101** Add exposure and tone mapping.
- **BH-102** Add bloom as post-process only.
- **BH-103** Implement Scientific/Cinematic/Debug modes.
- **BH-104** Build structured responsive control panel.
- **BH-105** Add deterministic production presets.
- **BH-106** Accessibility and touch pass.

## Performance

- **BH-120** Add local performance telemetry and benchmark metadata.
- **BH-121** Add GPU timestamp timing when supported.
- **BH-122** Instrument ray termination/step statistics in debug benchmark builds.
- **BH-123** Implement conservative early termination improvements.
- **BH-124** Implement adaptive integration and accuracy comparison tests.
- **BH-125** Add effective-DPR cap/internal render scale.
- **BH-126** Implement Auto quality controller with smoothed timing/hysteresis.
- **BH-127** Implement interaction-quality drop and stationary recovery.

## Temporal

- **BH-140** Add deterministic subpixel jitter.
- **BH-141** Add accumulation buffer/history lifecycle.
- **BH-142** Define exact state changes that invalidate history.
- **BH-143** Add reprojection only after camera transforms are validated.
- **BH-144** Add history rejection/ghosting regression scenes.

## Schwarzschild LUT

- **BH-160** Reproduce/read Bruneton paper math and map it to repository conventions.
- **BH-161** Complete license/provenance review before adapting source.
- **BH-162** Implement versioned offline LUT generator/data format.
- **BH-163** Validate LUT samples against numerical reference.
- **BH-164** Implement LUT runtime backend.
- **BH-165** Compare numerical/LUT images and benchmark speedup.

## Kerr

- **BH-200** Write Kerr-specific design note locking coordinates, spin convention, constants of motion, and integrator.
- **BH-201** Implement higher-precision reference trajectories.
- **BH-202** Implement GPU Kerr geodesic backend.
- **BH-203** Implement spin-dependent horizon/ISCO helpers.
- **BH-204** Validate `spin=0` convergence.
- **BH-205** Add prograde/retrograde visual/reference scenes.
- **BH-206** Optimize Kerr only after failure/error telemetry is trustworthy.

## Observer/release

- **BH-220** Separate camera pose from physical observer four-velocity.
- **BH-221** Circular observer mode.
- **BH-222** Flyby mode.
- **BH-223** Free-fall/plunge mode.
- **BH-224** Relativistic aberration/observer Doppler validation.
- **BH-240** Browser/device-loss hardening.
- **BH-241** Mobile/touch performance pass.
- **BH-242** Asset/license/provenance audit.
- **BH-243** Production deployment and cache headers.
- **BH-244** Final cross-device benchmark report.

## Prioritization rule

Within the active milestone, choose the smallest unblocked ID that establishes infrastructure required by other tasks. Do not implement later IDs merely because they are easier or more visually impressive.
