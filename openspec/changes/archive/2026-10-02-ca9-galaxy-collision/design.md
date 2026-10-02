# Design: CA9 Galaxy Collision

## 1. Scientific model boundary

CA9 is a **DATA_DRIVEN reduced restricted-three-body/test-particle reconstruction**, not a live self-consistent galaxy merger simulation.

The scientific core is generated offline from source-locked encounter parameters. The browser consumes compact trajectories/keyframes and interpolates them on the GPU/renderer path. Any glow, dust, background, bloom or camera choreography added for readability is visual presentation and must not be described as simulated dynamics.

## 2. Source-lock stage is mandatory and precedes production code

Before modifying the generator’s production constants or creating runtime assets, retrieve and inspect the primary source:

- Toomre, A. & Toomre, J. (1972), *Galactic Bridges and Tails*, ApJ 178, 623, DOI `10.1086/151823`.
- NASA GISS publication record / scan: `https://pubs.giss.nasa.gov/abs/to01000a.html`.
- NASA NTRS reprint metadata: `https://ntrs.nasa.gov/citations/19720056411`.

The scan is a research input. Public download/distribution metadata is not automatically a license to re-publish the PDF in this repository. Do not commit the scan unless redistribution rights are independently confirmed.

Create/update a source-lock document under `docs/cosmic-atlas/` that records, for every production parameter:

| Field | Value | Units/convention | Source location | Derivation | Confidence/notes |
| --- | --- | --- | --- | --- | --- |

Required categories depend on the selected reproducible case but include at minimum:

- selected model/case identifier;
- galaxy/perturber mass ratio or gravitational parameters;
- encounter/orbit type and orientation;
- pericenter/closest-approach or equivalent scale;
- initial disk/tracer radii/distribution assumptions;
- disk orientation(s)/inclination(s)/sense of rotation;
- coordinate/frame conventions;
- dimensionless time/length/velocity normalization;
- sample epoch(s)/phase mapping used to compare output to the paper;
- any values derived from figures rather than text, labeled as such with method/uncertainty.

A value inferred visually from a figure is not equivalent to a tabulated exact value. If figure digitization is necessary, record that it is derived, preserve a reproducible extraction method where possible, and bound uncertainty.

## 3. Production-vs-exercise configuration

`tools/cosmic-data/restricted_three_body.py` already embodies the correct safety posture: exercise values exist for self-check/development and production should refuse unverified parameters.

Refactor/configure the tool so production mode requires an explicit source-locked configuration object/file. Suggested shape (adapt to existing code):

```text
source id/version
scenario id
units + normalizations
galaxy potentials / mass parameters
encounter initial state
tracer disk initialization
integration method/options
sampling/keyframe options
provenance references
```

The production path MUST fail closed when required fields are missing, marked exercise/example, non-finite, internally inconsistent, or unsupported by the source-lock record.

Do not merely rename the current exercise constants to “production”.

## 4. Offline integrator validation

Before generating a runtime asset, validate the offline model independent of rendering.

Minimum checks:

- deterministic repeat run produces identical logical output/checksum under pinned environment/tool version;
- central/perturber orbit invariants behave as expected for the chosen reduced model;
- tracer initial conditions match the locked disk distribution/orientation;
- no non-finite trajectories;
- integration error/step sensitivity is characterized for representative particles/orbit;
- pinned sample states/qualitative morphology are consistent with the selected source case at the cited phase, within the fidelity of the reduced reconstruction;
- time/length/unit conversion round trips are tested.

If the source does not provide a point-by-point numeric trajectory, do not invent a “paper parity” metric. Validate source-stated/derived invariants and clearly label morphology comparison as qualitative/derived where appropriate.

## 5. Runtime artifact

Use the project’s established offline-data pattern: versioned compact binary plus manifest/checksum/provenance.

A suggested logical `GC1` payload:

```text
header
  magic/schema version
  scenario/source id
  tracer count
  keyframe count
  time range / normalization
  position encoding / scale
body
  galaxy center keyframes
  perturber center keyframes
  tracer positions (or compact coefficients) per keyframe
optional
  stable tracer groups / presentation metadata that is not scientific state
```

Exact storage is an implementation decision. Requirements:

- deterministic serialization order;
- explicit endian/precision/scale contract;
- bounds-checked loader;
- manifest with SHA-256 (or repository-standard checksum), byte size, schema version, generator version/commit, source-lock version and generation command;
- runtime rejects corrupt/unsupported artifacts truthfully;
- no runtime network fetch is required beyond the normal bundled/static asset load path.

Choose keyframe cadence/precision by measured interpolation error and size/performance, not arbitrary visual convenience.

## 6. Runtime interpolation

Scientific tracer positions at browser time `t` must come from the validated runtime data, not from `ParticleService` cinematic drift.

Implement a deterministic interpolation contract:

- map normalized atlas timeline time to source-data time;
- locate surrounding keyframes;
- interpolate centers/tracers using a documented method (linear is acceptable if cadence error is proven; cubic is acceptable only with stable/bounded behavior and reference tests);
- clamp/handle exact endpoints deterministically;
- no extrapolation beyond the validated data range unless explicitly specified and labeled.

Build a CPU reference interpolation helper and test runtime/GPU output against pinned samples.

## 7. Renderer/module architecture

Follow existing Cosmic Atlas lifecycle contracts:

```text
launchCatalog / registry
  -> dynamic phenomenon module
  -> create/attach resources in destination scope
  -> update(timeline, controls)
  -> render through shared kernel
  -> detach/dispose without leaks
```

Suggested module structure (adapt to repository conventions):

```text
src/phenomena/galaxy-collision/
  galaxyCollisionModule.ts
  data.ts / loader.ts
  interpolation.ts
  physics.ts (only pure reduced-model helpers if needed)
  presets.ts
  shaders/material helpers as appropriate
```

Do not add a second atlas lifecycle framework.

## 8. Visual decomposition

Separate scientific data from presentation layers:

### Data-driven

- galaxy/perturber centers;
- stellar/tracer trajectories/tidal tails/bridges derived from offline model;
- source-timeline phase.

### Procedural/cinematic allowed when labeled

- star sprite appearance;
- dust/emission haze not present in source model;
- bloom/tone mapping;
- background field;
- camera choreography/transition;
- non-dynamical contextual grid/annotation.

If a visual layer drifts independently of data-driven particles, it must not be described as a simulated mass component.

## 9. Timeline and presets

Define deterministic presets that expose scientifically meaningful viewpoints/epochs rather than only aesthetic variants. Suggested minimum:

- encounter setup / pre-pericenter;
- bridge/tail formation near the selected source phase;
- post-encounter extended tails.

Preset names and exact times must follow the source-locked scenario. Do not claim named real galaxies unless the model/source actually supports that identification.

Timeline scrubbing must be reversible and deterministic because the renderer is interpolation-based, not stateful simulation.

## 10. Runtime validation

### Unit

- source-lock config schema/guards;
- binary parser bounds/corruption/version rejection;
- time mapping;
- interpolation endpoints/midpoints;
- checksum/manifest fixtures where feasible;
- source-derived invariants.

### Browser

- route/preset boot;
- deterministic pause/scrub before/after navigation;
- fixed probe tracers match CPU reference interpolation;
- quality-tier/resize behavior;
- repeated destination cycles with resource counts returning to baseline;
- fallback backend truthfulness;
- no page/console errors.

### Visual

Create a small, intentionally chosen golden set only after data/interpolation tests are green. Goldens should cover the bridge/tail morphology and at least one alternate epoch/view.

## 11. Performance strategy

Galaxy collision is particle-heavy but scientifically simple at runtime. The performance budget should be met by data layout/interpolation/render batching, not by reducing correctness silently.

Measure:

- tracer count/keyframe asset size;
- load/parse/upload time;
- p50/p95 frame timing at repository-standard viewport/quality tiers;
- true GPU timing when available;
- GPU/resource memory exposed by diagnostics;
- navigation/disposal stability.

Potential optimization levers, in order:

1. interleaved/batched buffers and GPU interpolation;
2. keyframe cadence/quantization proven against error bounds;
3. quality-tier tracer-density presentation subsets that preserve source trajectory sampling semantics and are documented;
4. LOD sprite/material complexity.

Rejected: runtime pairwise gravitational solver, per-frame large CPU object churn, network streaming of raw source data.

## 12. Provenance and licensing

Update data/provenance docs with:

- primary bibliographic citation;
- NASA GISS/NTRS retrieval URLs/access date;
- exact source-lock locations;
- what is a fact/transcription vs repository-derived reduction;
- generator/tool version;
- runtime artifact checksum/license status;
- explicit statement that the repository-generated reduced trajectory file is derived data, while the scanned article itself is not redistributed unless permitted.

If legal/provenance uncertainty affects the runtime artifact, stop and resolve before release.

## 13. Registration/release gate

Do not mark the Galaxy Collision launch-catalog destination `production`/available until source lock, runtime artifact, loader/interpolation, browser tests, performance evidence, goldens and documentation are complete.

During development it may exist behind test/dev-only registration if the existing architecture supports that without leaking an unfinished user-facing route.
