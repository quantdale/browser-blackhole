## Why

The Kerr GPU backend derives its camera-side integration constants inside the TSL shader
(`src/phenomena/black-hole/kerr/kerrIntegrator.ts`). Three of those expressions disagree with the
binary64 CPU oracle, with the project's own locked Kerr ADR, and — in one case — with the correct
expression used a few lines further down the *same file*.

The consequences are wrong physics on reachable product paths, and the existing test suite is
structurally incapable of seeing them:

- `docs/KERR_BACKEND_ADR.md` §1.8 fixes the static-observer constants. The GPU static `L_z` uses
  `g_tφ / f_s`; the ADR, `kerr/reference.ts` and `observer/metric.ts` all use `g_tφ / √f_s`.
- The Kerr quartic `A` is `(r² + a²)² − a²Δ sin²θ` in `kerr/reference.ts`,
  `observer/metric.ts`, `observer/photonInit.ts` **and** at `kerrIntegrator.ts:555`. At
  `kerrIntegrator.ts:464` the same quantity is written `(r + a)²`, which is wrong even at `a = 0`.
- The Kerr g-factor divides by `|E|` unconditionally. The Schwarzschild pass gates the same factor
  on the observer-frequency flag, and the Kerr path's own comment claims the factor is exactly 1
  for the legacy static camera — which it is not.

The parity suite that should catch this (`tests/browser/kerr-parity.spec.ts`) pins a far camera at
the default framing, and the observer-mode spec only asserts a CPU readout snapshot. Two certified
campaigns have passed without noticing, because a defect at close radii and a defect on a
Kerr-plus-moving-observer combination are both outside the sampled corpus.

This is release-blocking: the repository's own severity policy classifies "gross scientific
falsehood across ordinary output" as Critical, and `.agent/QUALITY_GATES.md` Gate C forbids a
Kerr/observer change that regresses classification or geometry.

## What Changes

- **Correct the camera-side Kerr quartic** so the moving-observer `L_z` extraction uses the same
  `A` as the integration loop and as every CPU implementation. Add a shared, single-source
  `bigA` construction so the two GPU sites cannot diverge again.
- **Correct the static `L_z` frame-dragging term** to `g_tφ / √f_s`, matching
  `docs/KERR_BACKEND_ADR.md` §1.8 and `kerr/reference.ts`.
- **Gate the Kerr g-factor by the observer-frequency flag** so the legacy static-camera path stays
  bit-identical to the validated Schwarzschild convention.
- **Make LUT capture classification analytic on the GPU** instead of reading an interpolation
  sentinel through a linear filter, and plumb the manifest's `x→u` axis mapping into the shader
  instead of hard-coding it.
- **Add the missing GPU parity rows** that would have caught all of the above: close-in Kerr
  camera radii, and Kerr combined with a relativistic observer mode.
- **Thread `a = a* · M` consistently** in the Kerr metric terms, or explicitly reject a non-unit
  mass, so the latent unit inconsistency cannot become a silent physics error.

Non-goals, explicitly out of scope:

- No change to the Schwarzschild integrator, the CPU oracle, the disk model, or the observer
  layer. Those are correct and are the reference.
- No change to any numerical tolerance. The parity tolerances stay exactly as they are.
- No change to the visual goldens, unless a fix provably corrects a defect and that golden change
  is justified in `design.md` with before/after evidence.
- No re-derivation of the Kerr formulation. The ADR remains authoritative; the shader is brought
  into line with it.

## Capabilities

### New Capabilities
- `kerr-photon-initialization`: the contract that the GPU Kerr pass derives the same camera-side
  integration constants (energy, `L_z`, `p_r`, `p_θ`, and the frequency factor `g`) as the
  binary64 CPU oracle, for every reachable combination of spin, camera radius and observer mode.

### Modified Capabilities
- None. This repository has no archived baseline capability specifications yet
  (`openspec list --specs` reports none); `specification-baseline-hygiene` creates that baseline.
  Every requirement in this change is therefore written as an ADDED requirement under the new
  `kerr-photon-initialization` capability.

## Impact

**Affected code**

- `src/phenomena/black-hole/kerr/kerrIntegrator.ts` — the three corrected expressions plus the
  shared `bigA` construction and the observer-frequency gate.
- `src/phenomena/black-hole/lut/lensingGpu.ts` — analytic classification and axis-mapping uniforms.
- `src/phenomena/black-hole/lut/domain.ts`, `lut/types.ts`, `lut/textures.ts` — expose the axis
  mapping to the GPU layer.

**Affected tests**

- `tests/browser/kerr-parity.spec.ts` — new close-in-radius rows and a Kerr + moving-observer row.
- `tests/browser/kerr-backend-census.spec.ts` — re-baseline only where a fix provably changes a
  captured classification count, justified in `design.md`.
- `tests/unit/kerrCharacteristics.test.ts` — unaffected; it is the reference and must not move.

**Affected documents**

- `docs/KERR_BACKEND_ADR.md` — record the resolved static `L_z` normalisation and the g-factor
  gating decision, replacing the currently misleading inline comment.
- `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md` — only if a fidelity note is implicated.

**Dependencies**

- None. This is the first phase-1 change and has no prerequisite other than
  `specification-baseline-hygiene` (Phase 0), which is documentation-only.

**Blast radius**

- Confined to the Kerr pass and the LUT pass of the Black-Hole destination. The Schwarzschild
  numerical pass, the disk, the observer worldlines and every other destination are untouched.
- The one user-visible consequence is that Kerr rendering becomes *correct*; any golden that
  changes does so because it previously recorded the wrong physics.
