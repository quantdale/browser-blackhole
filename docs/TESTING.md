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

### Coverage model (verification-gate-integrity 7.2/V-10)

`npm run coverage:report` prints a STATIC unit-test import-coverage report
(report-only: no threshold, never a build failure). The following families
are **deliberately browser-only covered** and listed as such by the report —
their absence from unit coverage is intentional, not accidental:

- `src/shaders/*` — TSL GPU graphs cannot run in a Node unit environment;
  their CPU reference (`cameraRayMath.ts`, `starfield.ts`) IS unit-tested and
  the browser parity corpora validate the GPU paths;
- `src/ui/*` — pure DOM factories covered by the browser accessibility/
  interaction suites;
- `src/app/*` (the two app shells) — covered end-to-end by the browser
  suites; only their pure helpers (`capability.ts` decision logic, state
  normalizers) are unit-tested by design.

The preferred tooling (vitest statement coverage via
`@vitest/coverage-v8`) is recorded as wanted but currently blocked by a
deterministic npm/arborist failure on the development machine — see
`openspec/changes/verification-gate-integrity/tasks.md` §7.1.

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

## 3a. Kerr physics tests (M9)

Implemented in `tests/unit/kerrCharacteristics.test.ts`, `kerrReference.test.ts`,
`kerrConvergence.test.ts` and browser specs `kerr-parity.spec.ts` /
`kerr-integration.spec.ts`. Coverage per docs/KERR_BACKEND_ADR.md:

- characteristic helpers vs published vectors: ISCO(±0.5/±0.9/0.998/±1),
  photon-orbit boundary, horizons/ergosurface limits, emitter u^t/Omega
  normalization against the RAW metric, a*=0 equality with the validated
  Schwarzschild formulas;
- reference-solver invariants: finite-difference Hamiltonian-gradient
  agreement, machine-null initialization through the tetrad, Carter/null
  residual conservation, exact spin-sign + azimuth-reversal symmetry,
  frame-dragging sign, monotone capture/escape transition with prograde
  critical-offset ordering (b_pro < b_0 < b_retro, matching known Kerr
  shadow-edge values), high-spin stress without hidden failures, distinct
  failure taxonomy, disk-hit contract, step-halving convergence;
- spin->0 convergence gate (PRIMARY RELEASE GATE): a*=0 agreement with
  cpuReference on classification/min-radius/direction/hit-existence plus
  bounded LINEAR-in-|a*| departure bounds across a signed sweep;
- browser: selected-ray CPU/GPU parity through the canonical control channel
  with non-vacuous backend proof (`activePassKind === 'kerr'`), lifecycle/
  persistence/deep-link/dc round trip/tier+resize/torture suites, and the
  Kerr golden set (zero-spin/high-prograde/retrograde).

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

### Backend-specific cinematic baselines (V-09/6.6)

The cinematic suite captures per-backend baselines with a `_<BACKEND>` suffix.
This is the documented command that reaches the eight committed `_WEBGL2`
rows (they are not orphans — the golden-inventory gate
`tests/unit/goldenInventory.test.ts` accepts exactly these suffix variants):

```sh
CINEMATIC_GOLDEN_BACKEND=webgl2 E2E_PORT=4219 npx playwright test cinematic-goldens --project=default --workers=1
```

Only `webgpu` and `webgl2` are accepted values (the spec throws on anything
else). The default run (no env var) captures the backend-natural baselines.
Every scientific golden row also carries a per-scene ABSOLUTE content floor
(`minMeanLuma`) asserted alongside the relative comparison — a destroyed
subject must fail even when the baseline carries the same destruction.

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
