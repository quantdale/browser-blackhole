# Design: M12 Neutron-Star Surface Lensing Fidelity Closure

## 1. Context

The repository already owns a validated Schwarzschild geodesic stack for the black-hole destination and a pure neutron-star physics module for mass/radius/redshift/spin/beacon geometry. The missing link is a strong-field material-surface ray terminal and renderer path.

The implementation must reuse validated mathematics where sensible without turning the neutron-star change into a risky rewrite of the black-hole backend.

## 2. Fidelity boundary

The target model is:

- spherical neutron-star material surface at radius `R`;
- exterior Schwarzschild spacetime with mass `M`;
- static-surface gravitational redshift;
- rotating hot-spot/beam geometry may continue to use the existing reduced analytic model;
- no frame dragging, Doppler, aberration, atmosphere transfer, oblateness or interior metric.

This is `DIRECT` for the spherical Schwarzschild photon trajectory and static redshift, and reduced/procedural where already documented for emission/beams/fields/flares.

## 3. Ray semantics

A neutron-star camera ray must finish in one of these neutron-star-local outcomes:

- `SURFACE_HIT`
- `ESCAPED`
- `NUMERICAL_FAILURE`
- optional explicit `INVALID_INITIAL_STATE` if the implementation benefits from preserving the diagnostic distinction

Do **not** renumber or repurpose the black-hole renderer’s stable ray codes 0..6. If GPU diagnostics need a packed value for neutron-star outcomes, define a neutron-star-local mapping and document it.

### 3.1 Surface event

Let `R_rg = R / r_g`, with `R_rg > 2`.

During backwards integration, a segment that crosses from `r > R_rg` to `r <= R_rg` is a material-surface candidate and MUST terminate before black-hole horizon/capture logic would apply. The crossing point must be refined enough that the resulting surface normal/hit coordinate is stable at the validation tolerance.

Preferred refinement strategy:

1. preserve the previous and candidate integration states;
2. bracket the surface crossing on the accepted segment;
3. refine the crossing using the same numerical discipline used elsewhere for event boundaries, or an equivalent bounded bisection/interpolation justified by tests;
4. reconstruct the hit point in the geodesic plane/world frame;
5. normalize it to the material radius only if the refinement error is already within tolerance; never use normalization to conceal a large integration error.

### 3.2 Escape

A ray satisfying the canonical Schwarzschild escape policy samples the celestial/background environment. Existing conservative escape semantics should be reused rather than introducing a neutron-star-only arbitrary distance cutoff.

### 3.3 Numerical failure

Non-finite state, invalid launch state, or step-budget exhaustion must remain diagnosable. Do not convert failure pixels into surface/background success silently.

## 4. Reuse strategy

Before editing, inspect:

- `src/phenomena/black-hole/cpuReference.ts`
- `src/physics/schwarzschild.ts`
- `src/phenomena/black-hole/schwarzschildIntegrator.ts`
- relevant TSL/GPU renderer code in the black-hole path
- `src/renderer/shared/LensingService.ts`
- `src/phenomena/neutron-star/neutronStarModule.ts`
- `src/phenomena/neutron-star/physics.ts`

Use the narrowest architecture that produces a single authoritative Schwarzschild trajectory convention.

### Preferred architecture A — shared low-level event-capable core

Extract/reuse only the low-level geodesic stepping/math needed by both destinations, then allow the caller to supply destination-specific terminal/event policy:

```text
ray initialization
  -> canonical Schwarzschild step/invariants
  -> destination event policy
       black hole: horizon/capture, disk, escape
       neutron star: surface hit, escape
  -> destination shading
```

This is preferred only if black-hole CPU/GPU parity and visual output remain unchanged.

### Acceptable architecture B — neutron-star wrapper over existing canonical primitives

If extracting the production GPU loop is too risky, build a neutron-star-specific surface integrator that imports/copies **canonical formulas through shared helpers**, with explicit parity tests against the CPU reference. Duplication of a small, locked event wrapper is preferable to destabilizing mature black-hole code.

### Rejected architecture

Do not use `createThinLensDisplacement()` or any generic weak-field offset as the direct neutron-star surface path. Its contract is not valid for compact-object strong-field limb mapping.

## 5. CPU/reference model

Create a pure TypeScript reference surface-ray layer (file name may vary, suggested `src/phenomena/neutron-star/surfaceRayReference.ts`). It must remain free of `three` imports.

Minimum result data:

```ts
interface NeutronStarSurfaceRayResult {
  classification: 'surface-hit' | 'escaped' | 'numerical-failure' | 'invalid-initial-state';
  steps: number;
  minRadiusRg: number;
  finalRadiusRg: number;
  hitPositionRg?: [number, number, number];
  hitNormal?: [number, number, number];
  escapeDirection?: [number, number, number];
  diagnostics: { /* finite/error data required by tests */ };
}
```

Exact names are not mandated; semantics are.

Reference tests must include radial hits, clear misses/escapes, near-limb rays, deterministic repeats, invalid compactness, and finite diagnostics.

## 6. Analytic apparent-radius validation

For a static spherical surface outside the photon sphere (`R > 3 r_g` in this repository’s `r_g = GM/c^2` convention), the asymptotic limb impact parameter is:

```text
b_limb = R / sqrt(1 - 2 r_g / R)
```

Use at least one production-relevant mass/radius case (the canonical ~1.4 solar-mass / 12 km model is comfortably outside `3 r_g`) to validate the hit/miss transition or measured apparent radius.

The test must state its regime. Do not generalize the simple limb formula to ultra-compact `2 r_g < R <= 3 r_g` without handling the additional photon-sphere/multiple-image behavior.

If user controls allow radii in that ultra-compact regime, choose one of the following and document it:

- fully support it with the numerical integrator and test representative multiple-image behavior; or
- constrain the `DIRECT` production surface-ray control range to the validated regime while retaining a clearly labeled experimental path elsewhere.

Do not silently clamp user input.

## 7. Surface shading and hot spots

The ray tracer determines **where** the photon intersects the material sphere. Surface emission must then use that hit coordinate, not the screen-space/direct sphere fragment that would have been visible without bending.

At minimum:

1. derive a world/local surface normal from the refined hit point;
2. transform/evaluate the existing rotating hot-spot geometry at that surface coordinate;
3. apply the existing static gravitational redshift factor `g = sqrt(1 - 2 r_g/R)` consistently with the project’s frequency-ratio convention;
4. preserve current procedural magnetic field lines/beams/flares as overlays whose fidelity remains separately labeled.

Do not add Doppler/aberration incidentally. Those remain deferred until explicitly specified and validated.

## 8. GPU path and debug observability

The production renderer needs a GPU/TSL path that mirrors the reference event semantics.

Provide a deterministic debug surface that tests can query. Examples:

- classification debug render target;
- small sampled ray probe API behind existing test/debug hooks;
- destination debug snapshot containing aggregate hit/escape/failure counts plus fixed probe results.

Do not expose an expensive per-frame CPU readback in normal production rendering merely for tests.

Representative CPU/GPU probes should span:

- center/radial surface hit;
- just-inside limb hit;
- just-outside limb escape;
- off-axis hit;
- near-critical/high-deflection ray that remains within the supported model;
- invalid/numerical-failure handling where injectable.

## 9. Black-hole non-regression

Any shared-core change is gated by existing black-hole reference and GPU parity suites. At minimum run the relevant:

- unit Schwarzschild/reference tests;
- ray/integrator parity browser suites;
- LUT/disk parity if touched;
- Kerr parity only if shared code reaches Kerr paths;
- Black Hole visual goldens.

Unexpected black-hole golden/parity drift is a blocker until explained as a separately proven bug. Do not accept drift because the neutron-star result looks better.

## 10. Dedicated neutron-star tests

Add a dedicated unit suite for current neutron-star physics plus surface rays. Cover existing redshift/compactness/spin/light-cylinder/pulse geometry functions as well as the new ray path.

Add `tests/browser/neutron-star.spec.ts` (or equivalent) covering:

- direct route and each production preset;
- pause/scrub deterministic entry;
- surface-ray debug classification availability;
- preset switching without leaked resources;
- no console/page errors;
- viewport resize and quality-tier transition sanity;
- surface/hot-spot/beam states remain finite;
- WebGL2 fallback behavior is truthful if the direct path has backend-specific capability requirements.

Do not duplicate generic accessibility/resource torture tests unless the destination exposes unique behavior; instead add targeted assertions and let global suites remain global.

## 11. Visual goldens

The corrected ray-bent surface is expected to change `NS_SURFACE`, `NS_PULSAR`, and `NS_MAGNETAR` images.

Procedure:

1. make physics/reference/parity tests green first;
2. run existing goldens without update and capture the expected failures/diffs;
3. visually inspect the changed limb/hot-spot morphology for consistency with the new model;
4. regenerate only the neutron-star baselines using the repository’s explicit `UPDATE_GOLDENS=1` workflow;
5. run the complete golden suite twice independently to establish stability.

Never regenerate all goldens indiscriminately.

## 12. Performance

Add a dedicated neutron-star benchmark harness that reports the same common fields used by Cosmic Atlas benchmark evidence and distinguishes CPU/rAF timing from real GPU timestamp timing when available.

Measure before/after on the same machine/config. Record:

- preset;
- backend;
- quality tier/render scale/internal resolution;
- p50/p95 frame timing using the repository’s established semantics;
- GPU frame ms if truly available;
- resource counts/bytes if already exposed;
- notes on unsupported/fallback backend.

Do not reduce geodesic correctness to meet a budget without an explicit fidelity/quality-tier design and parity evidence.

## 13. Documentation updates

On successful direct implementation, update at least:

- `README.md`
- `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md`
- `docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md`
- `docs/cosmic-atlas/BENCHMARK_MATRIX.md` if evidence/contracts change
- testing/diagnostic docs if new probes are introduced
- `.agent/STATE.md` and relevant backlog/roadmap status at closure

State both what is now direct and what is still deliberately omitted.

## 14. Rollback/containment

Keep the direct path behind a clean destination-level implementation seam while developing. If a production backend cannot support it correctly, fail/degrade truthfully according to capability policy rather than silently rendering the old direct sphere under a `DIRECT` label.
