# Design — Kerr GPU initializer correctness

## Context

See `proposal.md` for the motivation. This design records why the corrections are made the way they
are, and what the implementation agent must preserve.

The Kerr pass builds its per-pixel integration constants in TSL. Four independent implementations
of the Kerr metric exist in this repository, and the shader is the only one that diverges:

| Quantity | `kerr/reference.ts` | `observer/metric.ts` | `observer/photonInit.ts` | `kerrIntegrator.ts` |
| --- | --- | --- | --- | --- |
| `A` | `(r2+aSq)² − aSq·Δ·s2` | `(r2+a2)² − a2·Δ·sin2` | `(r²+a*²)² − a*²·Δ·s2` | `:555` matches; **`:464` does not** |
| static `L_z` frame term | `gTφ/√fS` | — | derived from `g_φφ` | **`gTphi0/f_s`** |
| `g` factor | n/a | n/a | n/a | **unconditional `/|E|`** |

The two CPU oracle paths that the parity tests already trust both build `A` correctly and derive
`L_z` from the metric components rather than from a hand-expanded formula. The GPU shader expanded
the formula by hand instead, which is where the drift entered.

## Goals / Non-Goals

**Goals**

- Make the GPU camera-side constants provably identical to the CPU oracle's, and make that identity
  a *tested* invariant rather than a review convention.
- Remove the possibility of a second, divergent copy of `A` inside the shader.
- Extend the parity corpus to the parameter regions where the defects are large, so a recurrence is
  caught by a gate rather than by a human reading the shader.

**Non-Goals**

- Rewriting the Kerr formulation. `docs/KERR_BACKEND_ADR.md` is the authority and is not being
  changed except to record the resolved decisions.
- Touching the Schwarzschild numerical pass, the CPU oracle, the disk model or the observer
  worldlines.
- Changing any parity tolerance. The tolerances were set from measured f32 behaviour and remain
  valid; the defects are in the model, not in the tolerance.
- The LUT changes here are limited to *classification authority* and *axis mapping*. Broader LUT
  work is not in this change.

## Decisions

### D1 — Introduce one shared `bigA` node factory inside the shader

**Decision.** Define a single TSL helper that, given `(r, theta, delta, spin)`, returns the Kerr
quartic, and call it from both the camera-side site and the integration loop.

**Rationale.** The defect survived two certified campaigns precisely because the shader carried two
copies of `A`. A shared factory makes divergence a compile-time impossibility rather than a review
burden. It also matches the CPU side, where `kerrFragments`/`metricFragments` are already the single
authority.

**Alternatives rejected.** (a) Fix `:464` in place and rely on review — this is the status quo that
failed. (b) Compute `g_φφ` by calling the same `metricFragments` logic the observer path uses — the
GPU path deliberately avoids the CPU-style scalar helpers for graph-shape reasons, and this would
change the compiled node graph well beyond the fix.

### D2 — Static `L_z` uses `√f_s`; record it in the ADR

**Decision.** Use `gTphi0.div(sqrt(max(fS0, denomFloor)))` and update `docs/KERR_BACKEND_ADR.md` to
state the resolved normalisation explicitly, replacing the inline comment that currently describes a
`1/f_s` form the code does not use.

**Rationale.** The `φ`-leg is orthogonalised against the timelike leg, so the extraction is
`L_z = ε[n_ph sinθ √(Δ/f_s) + g_tφ/√f_s]`. The ADR text, the reference solver and this form agree.
The `1/f_s` variant is a copy of the metric-component form without the orthonormal leg scaling.

**Note on impact.** The error is `g_tφ(1/f_s − 1/√f_s)`, which is small at the far default camera
radius (the reason the default goldens pass) and grows toward the ISCO. This is why the new parity
rows are required, not merely desirable.

### D3 — Gate the `g` factor with an explicit observer-frequency flag

**Decision.** Add an `observerFrequencyComoving` uniform to the Kerr uniforms, mirror the
Schwarzschild selection, and select `1/|E|` only when the flag is active.

**Rationale.** The Schwarzschild pass already establishes the correct pattern
(`schwarzschildIntegrator.ts:432-437`). The Kerr pass folded the comoving factor in unconditionally,
which silently changes the legacy static-camera output. Mirroring the existing, tested pattern is
lower risk than inventing a Kerr-specific mechanism.

**Compatibility.** These are two separate corrections. The frequency gate removes the unconditional
`/|E|` from the legacy path, so static Kerr output changes relative to the current shader. The
`L_z` normalisation also changes photon constants. Neither effect is accepted by prescribing a
brightness ratio such as `sqrt(f_s)`. Acceptance is CPU/GPU parity at the existing tolerances. Any
golden that changes must be justified by that improved agreement, not by a fixed ratio.

### D4 — Classification authority moves to the analytic comparison

**Decision.** In `lut/lensingGpu.ts`, compute capture membership from `x >= 1` (equivalently
`b >= b_c`) and route rays inside the hybrid band to the numerical fallback. Keep the stored
sentinel only as a secondary guard.

**Rationale.** The module header and `lut/runtime.ts` both already claim classification is analytic
and never interpolated. The implementation tests a sentinel value *after* bilinear filtering, so
the claim is false exactly at the boundary. Making the claim true is both a fix and a
spec-conformance repair.

**Alternatives rejected.** Switching the aux texture to `NearestFilter` — that would break the
continuous channels (`nR`, `nT`, arc-end) in the same texture. Splitting classification into its
own nearest-filtered texture — viable but a larger asset change than the defect warrants.

### D5 — Axis mapping becomes a uniform sourced from the manifest

**Decision.** Thread `axisX` from the validated manifest into the LUT GPU resource/params and build
`xToUNode` from uniforms. If the mapping is not the supported form, reject the family with an
explicit reason.

**Rationale.** `lut/domain.ts` states the mapping "always comes from a validated manifest, never
from hard-coded literals at the call site". The shipped family happens to match the literal, so the
defect is latent — but a regeneration with a different axis would produce confidently wrong
trajectories with no gate firing. Rejecting is preferred over silently accepting.

### D6 — Mass convention: thread or reject, never mix

**Decision.** Either thread `a = a* · M` through every Kerr metric term, or reject a non-unit mass
explicitly. Today `massRg` is hard-pinned to 1 by the destination, so the pragmatic choice is to
reject, and to make the rejection explicit rather than implicit.

## Risks / Trade-offs

- **[Golden churn] Static Kerr goldens may change.** Both the frequency gate and the `L_z`
  correction can change the image. → Mitigation: re-capture only rows whose CPU/GPU disagreement
  improves after the fix, and justify each in `tasks.md`. Never re-baseline a golden to make a red
  test green, and never treat a `sqrt(f_s)` brightness ratio as the expected result.
- **[Parity tolerance interaction] The new close-in rows may not meet existing tolerances.** The
  defects are model errors, not precision errors, so a correct model should *improve* agreement.
  → Mitigation: if a new row fails after the fix, investigate as a precision finding before
  widening anything.
- **[Census shift] `kerr-backend-census` records terminal-class percentages.** Correcting the model
  can legitimately move those percentages. → Mitigation: re-run twice-stable; treat a shift as
  expected only if the change makes CPU and GPU agree more closely.
- **[LUT rejection risk] Axis-mapping rejection could reject a family that previously "worked".**
  The shipped family declares the default mapping, so it is unaffected. → Mitigation: assert the
  shipped family still loads in a unit test before and after.

## Testing strategy

- **Unit.** Extend `tests/unit/kerrCharacteristics.test.ts` (or a new sibling) with the cross-
  implementation equality: the shared `bigA` factory vs `metricFragments`, and the Schwarzschild
  `a = 0` limit. These run in CI.
- **Browser parity.** Extend `tests/browser/kerr-parity.spec.ts` with close-in static radii
  (inside 2× ISCO) and at least one Kerr + relativistic-observer row. Add the compared-count
  assertion so the rows cannot vacuously pass.
- **Regression direction.** Every new row must fail before the fix and pass after. Record both.
- **Gates.** `npm run check` (631 unit tests + build), then the KERR_*/OBSERVER_* goldens, then
  `kerr-backend-census`, then the LUT parity rows.

## Open Questions

None that change the approach. The one judgement call for the implementing agent is D6 (reject vs
thread for non-unit mass); rejecting is recommended because `massRg` is pinned to 1 in the
destination and threading would widen the blast radius of this change.
