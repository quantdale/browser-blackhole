# Testing, validation, and benchmarking

## 1. Test layers

Use four distinct layers:

1. deterministic unit/state tests;
2. physics/reference tests;
3. browser/visual integration tests;
4. performance benchmarks.

A screenshot alone is not a physics test; an analytic ray alone is not a browser lifecycle test.

## 2. Unit tests

Cover:

- physical unit conversions;
- characteristic radii;
- state validation/clamping;
- preset serialization/versioning;
- render-quality controller/hysteresis;
- camera basis/ray reconstruction math where CPU-equivalent functions exist;
- deterministic random/star seeds;
- LUT metadata/checksum validation later.

## 3. Schwarzschild physics tests

Required fixtures:

- radial inward ray captured;
- clearly outward/far ray escaped;
- large impact parameter has small weak-field deflection;
- near-critical rays show increasing deflection/winding without being mislabeled due to max-step exhaustion;
- critical threshold approaches `b_c = 3 sqrt(3) r_g` for a distant observer/reference setup;
- rotational symmetry around a Schwarzschild black hole;
- disk crossing radius is stable under tighter integration tolerance;
- face-on disk does not develop arbitrary left/right Doppler asymmetry;
- inclined disk has the expected approaching/receding frequency-shift ordering.

Record numerical tolerances in tests; do not use vague "looks close" assertions.

## 4. CPU/reference solver

Create a readable CPU reference solver before heavily optimizing the GPU geodesic implementation. It may be slower and use higher precision. It returns trajectory/termination diagnostics for a small set of rays.

Later Rust/WASM is optional if TypeScript precision/performance limits offline/reference tasks. Keep fixture outputs versioned and reviewed.

## 5. GPU/reference comparison

For selected camera pixels/initial conditions, expose a debug readback/test path or equivalent deterministic calculation and compare:

- termination class;
- disk-hit radius/position;
- escape direction;
- redshift factor;
- minimum radius;
- step failure rate.

Avoid expensive readbacks in production frames.

## 6. Visual regression

Use Playwright in a fixed browser configuration and deterministic preset state. Capture at fixed viewport + DPR + seed + backend/quality.

Golden scenes should eventually include:

- camera-ray diagnostic;
- star field;
- Schwarzschild shadow/lensing without disk;
- face-on disk;
- edge-on disk;
- Doppler demonstration;
- photon-ring high quality;
- each debug heatmap family;
- LUT-versus-numerical comparison;
- Kerr spin=0 comparison later.

Use perceptual/pixel thresholds carefully; post-processing and browser/GPU differences can require backend-specific baselines. Physics-value tests remain authoritative where visual baselines are flaky.

## 7. Browser E2E

Smoke test:

- app loads;
- canvas obtains expected backend;
- deterministic frame rendered;
- controls update state;
- pointer/orbit input updates camera;
- resize works;
- quality switch works;
- no console/page errors;
- unsupported path shows a meaningful message.

## 8. Performance benchmarks

Benchmarks are not ordinary pass/fail unit tests on shared CI hardware. Store representative benchmark scenarios and emit machine-readable measurements.

Scenes:

- mostly escaping star field;
- shadow centered;
- disk-heavy edge-on;
- near-critical/photon-ring stress;
- camera moving Auto quality;
- stationary convergence;
- Kerr stress later.

Record browser version, renderer backend, GPU/adapter information if available, viewport, internal resolution, timing, quality parameters, and build SHA.

## 9. CI strategy

Initial CI:

- install with lockfile;
- formatting/lint/typecheck;
- unit/physics tests;
- production build;
- headless browser smoke test where WebGPU is reliably available in the CI environment.

If CI cannot expose a representative GPU, do not fake performance certification. Keep deterministic CPU/reference tests in CI and run GPU visual/performance suites on known developer/runner hardware.

## 10. Dependency upgrades

Three.js/WebGPU APIs can evolve. Upgrade dependencies in focused commits. Re-run:

- shader compile/build;
- visual baselines;
- color management/tone mapping checks;
- browser smoke tests;
- benchmark scenario.

Do not combine a major Three.js upgrade with unrelated physics changes.
