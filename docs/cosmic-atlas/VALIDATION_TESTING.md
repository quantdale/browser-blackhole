# Validation and testing plan

## 1. Test layers

Cosmic Atlas uses six complementary layers:

1. pure unit/state tests;
2. scientific/numerical validation;
3. GPU/render integration tests;
4. visual regression;
5. browser/E2E lifecycle tests;
6. performance/resource tests.

A beautiful screenshot cannot substitute for physics or lifecycle evidence.

## 2. Shared platform tests

### Destination registry

- IDs unique;
- routes unique;
- default presets valid;
- lazy loaders resolve expected module;
- capability declarations parse.

### Lifecycle

For each destination:

```text
prepare → enter → update/render → exit → dispose
```

Must be valid.

Test:

- dispose before enter after cancelled prepare;
- repeated enter/exit;
- stale generation cannot reactivate;
- exceptions during prepare clean up partial scope.

### ResourceScope

Synthetic tests register and dispose every resource class.

After disposal expected scene-local inventory = zero.

### Navigation races

Automate rapid A→B→C selection.

C must win; A/B stale async work cannot commit.

## 3. Transition tests

- preloaded target transition completes without blank frame;
- slow target preparation leaves current scene responsive;
- reduced motion uses crossfade path;
- browser back/forward updates destination correctly;
- direct deep link skips fake departure animation;
- transition abort does not leak resources;
- outgoing simulation throttles in TRANSITION quality.

## 4. Black-hole regression

Wrapping Black Hole in Atlas must rerun relevant existing black-hole quality gates.

The host must not alter:

- physics state;
- deterministic reference images;
- backend selection semantics;
- numerical classification behavior.

### Integrator CPU/GPU parity corpus

`tests/browser/integrator-parity.spec.ts` runs a selected-ray numeric corpus
against the binary64 oracle (`src/phenomena/black-hole/cpuReference.ts`) on
BOTH backends (hardware WebGPU and forced WebGL2):

- the destination's `debug-parity` preset (`/atlas/black-hole?preset=debug-parity`)
  renders `rgb = finalDirection * 0.5 + 0.5` in LINEAR space for ESCAPED rays,
  pure black for CAPTURED, failure-magenta for numerical failures; disk shading
  is disabled through the same uniforms;
- presentation is forced to exposure 1 / bloom off / 'linear' tone mapping, so
  presented pixels are exactly sRGB(linear) and direction components decode
  numerically;
- rays bracket b_c = 3 sqrt(3) M on both sides along two screen axes plus a
  radial center ray, deliberately away from the step-budget-sensitive critical
  boundary; CPU integration uses the SAME termination policy as the GPU pass
  (escape radius 32 r_g, capture epsilon 0.01 M);
- tolerance: 0.06 per linear direction component (budgets 8-bit output
  quantization, f32-vs-f64 trajectory drift over <= 32 r_g, half-float HDR
  intermediate storage). Captured rays must present near-black through any
  monotonic display chain.

## 5. Neutron-star validation

Required cases:

### Surface geometry

- central ray hits near-side surface;
- sufficiently off-axis ray escapes;
- symmetry under rotation for spherical non-rotating model.

### Compactness

At fixed dimensionless configuration, increasing compactness should produce expected stronger lensing/redshift trends under the chosen model.

### Gravitational redshift

Validate emitted/observed frequency factor for static surface observers in the selected exterior metric.

### Hot spots/pulses

- known aligned-axis case gives no rotational modulation from geometry alone;
- misaligned magnetic/observer geometry produces deterministic periodic pulse pattern;
- fixed seed/time produces reproducible frames.

### GPU/reference

Selected rays compared with CPU/reference solver tolerance.

## 6. Stellar Explosion validation

Because initial model is procedural-scientific, validate invariants rather than claiming hydrodynamic truth:

- shock/ejecta characteristic radius monotonically increases after explosion;
- no negative density/temperature;
- finite volume samples;
- energy/brightness proxy remains within documented preset range;
- hypernova preset changes the documented parameters, not only bloom;
- GRB mode produces collimated bipolar jets;
- timeline reset reproduces identical state.

Visual goldens:

- pre-explosion;
- shock breakout/early;
- asymmetric ejecta;
- hypernova;
- off-axis jet.

## 7. Compact Merger validation

- separation decreases during inspiral;
- orbital frequency trend increases toward contact under chosen reduced model/data;
- phase transitions occur at deterministic timestamps;
- ejecta begins only after appropriate phase;
- kilonova expansion/cooling ordering is monotonic under model;
- jet has finite opening angle and orientation;
- on-axis/off-axis visual response differs appropriately;
- timeline scrub is reversible/deterministic where data permits.

## 8. Black-Hole Merger validation

Data-driven tests:

- manifest checksum;
- decoded samples equal extractor output;
- waveform timing/phase matches source reduction;
- merger index/time stable;
- remnant metadata matches manifest;
- interpolation at source keyframes is exact/within floating tolerance.

Scientific honesty test:

UI string/fidelity metadata must identify illustrative lensing if not dynamical-spacetime exact.

## 9. TDE validation

- star follows configured encounter trajectory before disruption;
- deformation increases near tidal encounter;
- debris stream remains continuous;
- stream does not self-intersect before modeled phase;
- bound/unbound classification proxy deterministic;
- rewind/reset exactly reconstructs state;
- phase-based resource systems turn off when not needed.

## 10. Quasar validation

- scale-zone transitions use hysteresis;
- only intended zone services active;
- no central GR double-render with proxy;
- jet axis remains stable across zoom;
- blazar mode is driven by observer orientation;
- unit conversion across `r_g`/parsec/kpc presentation remains consistent.

## 11. Galaxy Collision validation

- binary manifest/checksum;
- center tracks match reduced source;
- keyframe interpolation error bounded;
- tracer positions finite;
- reset/scrub deterministic;
- quality-tier tracer subsampling preserves macro morphology;
- known phase goldens show expected tidal features;
- no O(N^2) CPU loop appears in production path.

## 12. Lensing Lab validation

Point-mass baseline:

- exact alignment yields ring symmetry;
- source offset breaks ring into images consistent with selected equation;
- rotational symmetry;
- distance/mass scaling under documented lens equation;
- coordinate transform invertibility where expected.

## 13. Visual regression protocol

Every golden records:

- destination;
- preset;
- schema version;
- seed;
- timeline phase;
- camera;
- viewport;
- effective DPR/internal resolution;
- renderer backend;
- quality tier;
- relevant asset versions.

Use perceptual threshold justified per destination.

Physics changes require physical validation even if goldens are updated.

## 14. Browser matrix

Development minimum:

- current Chromium desktop WebGPU path;
- fallback path where supported/configured;
- touch-capable/mobile smoke before release.

Release expands to current target matrix documented by deployment policy.

Test actual backend in telemetry; never claim WebGPU test if browser fell back.

## 15. Device-loss/recovery

Atlas-level tests must ensure:

- active destination receives renderer generation reset;
- stale buffers/pipelines are not reused;
- resource scopes recreate only current destination;
- transition state recovers or fails visibly;
- app does not display silent black canvas.

## 16. Accessibility tests

- reduced-motion transition path;
- keyboard navigation for destination selector;
- focus remains sensible after destination swap;
- control labels/units accessible;
- color is not sole encoding for critical state;
- flashing effects constrained.

## 17. Performance tests

Use `BENCHMARK_MATRIX.md`.

Performance CI should distinguish:

- deterministic CPU/resource assertions usable everywhere;
- real GPU benchmark runs requiring suitable hardware.

Do not make unavailable GPU timing a fake pass.

## 18. Destination completion gate

A destination is complete only if:

- fidelity class documented;
- scientific scope and limitations documented;
- deterministic preset(s) exist;
- source/provenance complete;
- unit/physics invariants pass;
- browser smoke passes;
- visual goldens exist;
- transition in/out passes;
- dispose returns resources to bounded baseline;
- Low/Medium/High quality tiers validated;
- representative benchmark recorded;
- failure mode is visible and recoverable.