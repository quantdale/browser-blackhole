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

### D6 — Mass convention: thread `a = a* · M` through every metric term

**Decision (revised).** Thread the physical spin length `a = a* · M` through every Kerr metric
term in `kerrIntegrator.ts` (shared `aPhys`/`aPhysSq` nodes), and reject only invalid masses
(non-finite / non-positive) with the existing `RangeError`.

**Original decision and why it changed.** The change first chose REJECT for non-unit `massRg`
("thread or reject, never mix"), on the premise that `massRg` was hard-pinned to 1 by the
destination. The caller audit that followed — triggered when `BHM_MERGER_FLASH` timed out stuck
in `transitioning` — found a second, deliberate caller: `BlackHoleMergerModule.ensureKerrPass`
and `pushKerrUniforms` pass the source-derived remnant mass (`dataset.remnantMassOverM =
0.95159626…`) with `spinDimensionless: remnantChiZ`. That convention is documented in code
("scene units are total-mass M and the remnant parameters are SOURCE-DERIVED") and in the
user-facing disclosure ("reuses the validated Kerr backend with source-derived remnant mass/
spin"). The rejection threw from `update()` on every frame during merger/ringdown/remnant and
stuck the destination mid-transition; rejection would also have falsified both documents.

**Rationale for threading.** (1) It is the spec's primary branch — "the spin length used SHALL
be `a = a* · M`" (`specs/kerr-photon-initialization`); rejection is only sanctioned "if a
non-unit mass is requested while only the dimensionless convention is implemented", and this
change implements the dimensionless-to-physical bridge instead. (2) It preserves the merger's
documented convention and disclosure. (3) `reference.kerrRhs` already threads
(`const a = aStar * massRg`), so the GPU edit brings the TSL graph onto the validated CPU
formula rather than inventing one. (4) At unit mass every inserted factor is exactly `1.0`
(IEEE-exact), so every M=1 graph value is bit-identical to the pre-edit graph: the full
kerr-parity suite, the census, and all 43 goldens re-run as the no-op proof of the edit for
every destination except the BHM remnant rows, whose pixels must move (see below).

**What changed in code.** `aPhys = uSpin · uMassRg` and `aPhysSq = aPhys²` nodes; every metric
site switched: `Sigma` (init/stage/guard/terminal), `Delta` (init/stage/stall/guard/terminal),
the `A` quartic at both `bigANode` call sites, the `4 M a` Hamiltonian term, the `2 M a r E`
azimuthal-rate term, `g_tphi` at init and terminal, the stall denominator `Delta/(r²+a²)`, and
the camera-side mirror `kerrCameraBigA` (`aSq = (spin · massRg)²`). One structural correction
fell out of mirroring `reference.kerrRhs`: the GPU `wTh` theta-derivative term carried a
spurious `uMassRg.mul(2)` — both `reference.kerrRhs` and a direct ∂/∂θ of
`(Δ − a² sin²θ) L_z² / sin²θ` give `2 Δ L_z² cosθ / sin³θ` with no factor of M — invisible at
unit mass, mis-scaling the θ-derivative at M ≠ 1; it is now `float(2)`.

**Known limitations accepted (documented, not fixed here).**
- The equatorial disk-emitter kinematics (`u^t`, `Omega`; ADR §1.16, `kerrIntegrator.ts`
  orbit block) remain in the unit-mass convention (`r³ − 3r² + 2a·r^(3/2)`). They are
  unreachable for non-unit-mass passes today — the only such caller sets `diskEnabled: false`
  (vacuum BBH remnant). Enabling a disk at M ≠ 1 requires threading that block first.
- `reference.kerrFragments` computes `Sigma`/`Delta` in the unit-mass form (`r² + aStar² cos²θ`,
  `r² − 2r + aStar²`), so `reference.kerrRhs` mixes those with its threaded `aSq`/`m` terms and
  is only self-consistent at M = 1 — exactly where every gate exercises it (default options
  `massRg: 1`, parity rows, unit tests). A non-unit-mass CPU-oracle revalidation is out of
  scope for this change; `initKerrRay`/`terminalLocalDirection` share the fragments form.
- The observer-frame moving-leg block runs only under the unit-mass destination; it consumes
  the threaded init nodes but is never exercised at M ≠ 1.

**Validation.** `tests/unit/kerrMassConvention.test.ts` pins the convention twin: threaded
`Delta(r+) ≡ 0` for M ∈ {1, 0.9516, 0.5, 2} × a* grid; the pre-fix mixed formula violates that
identity at M ≠ 1 (residual > 1e-3 at the remnant mass) and is exactly equal at M = 1; the
camera-side mirror matches the manual threaded quartic; `g_tphi` homogeneity. In the browser,
all M=1 rows are no-op proof: kerr-parity 4/4, and the full 43-row golden suite passes with
only two re-recorded rows, neither of them BHM — `BHM_RINGDOWN`/`BHM_REMNANT` stay within their
committed tolerances (the remnant-metric shift at M = 0.9516 is below 8/4/48), and the two
re-records are justified in tasks.md §5.4 for their own defects (D7 guard on
`KERR_HIGH_PROGRADE`, D1 init quartic on `KERR_CIRCULAR_OBSERVER`).

**Alternatives rejected.** (a) Keeping REJECT and pinning the merger to `massRg: 1`: falsifies
the `pushKerrUniforms` doc and the user-facing disclosure, and imposes a ~5 % scene-scale error
(merger scene coordinates are total-mass M). (b) Silent passthrough of the mixed convention
(pre-fix behavior): exactly the "SHALL NOT mix" defect this requirement exists to close.

### D7 — Near-horizon half-step guard in the Kerr integrator

**Decision.** In `kerrIntegrator.ts`, after the existing step-size policy, bound the step by
`h <= (r − r+) / max(|Δ·p_r/Σ|, 1)` so every RK4 stage — including the `(h/2)` sub-stages and the
full-`h` third stage — stays above `r+` where `Δ > 0`. The guard may shrink the step below
`uMinStep`; it is inactive whenever the horizon gap is large.

**Why this belongs in this change.** The close-in rows (task 1.3) cannot pass without it. A recorded
pre-fix pixel (`diag-b4.6`, camera `r=10`, `a*=0.9`) rendered `RAY_NON_FINITE` magenta on both
backends while the binary64 oracle classifies it `captured`. Replaying the exact GPU step policy
(`uBaseStep=0.3`, `uMinStep=0.001`, capture band `r+ + 0.01M`) against the recorded initial state
shows the defect independent of precision: at step 48 an RK4 stage evaluates `r < r+` (state
`r=1.493`, `p_r=−1131`, `h=0.0171`; the half-step drop exceeds the 0.057 horizon gap), `Δ` goes
negative, and the floored-delta metric terms blow the state past `1e30` — in f64 *and* in f32. The
CPU oracle survives only because its `0.005` step (60× finer) never builds such a step. With the
guard, the same replay captures cleanly at step 50 (f64 and f32); in the browser the pixel moves
from status `(255,124,255)` / parity `(80,0,80)` to status `(0,0,0)` / parity `(0,0,0)`.

**Rationale for the bound form.** `dr/dλ = Δ·p_r/Σ` is the exact radial RHS (`kerrRhs`), so
`h·|dr| <= r − r+` is precisely "the full step may consume the remaining horizon gap, nothing
more"; half-stages then consume at most half of it. A plain `h <= r − r+` bound (no `|dr|` factor)
is insufficient: the observed failure had `|dr| ≈ 21`, so it changed nothing. A bound without the
`minStep` escape hatch would stall asymptotically before the capture band.

**Alternatives rejected.** (a) Widening the capture band — does not stop a stage from crossing
`r+`. (b) Floor `Δ` harder inside stage metrics — the f64 replay shows the blow-up is a stage
overshoot, not a floor-width problem. (c) Documenting as a precision finding — the f64 replay proves
it is a policy defect, not a precision limit, and design.md's close-in mitigation explicitly
forbids widening before such an investigation; the investigation exonerated precision.

**Risk accepted.** The guard changes near-horizon step sequences, so terminal classes/positions of
rays that skirt `r+` can shift between backends at f32 rounding granularity. The census shift
recorded in `tasks.md` §5.3 is the observed effect; the guard is exercised by
`tests/unit/kerrHorizonStepGuardPolicy.test.ts`, which pins the policy twin (unguarded replay must
throw; guarded replay must capture; guard inactive at `r=10`).

### D8 — Observer row is a cross-backend class invariant, not CPU direction parity

**Decision.** Task 1.4's observer row is implemented as a cross-backend classification invariant
(identical ray grid under `observer.mode='circular'`, per-pixel class agreement, magenta share
bounded, escaped share non-zero, plus snapshot fields `activePassKind`/`observerMode`/
`effectiveSpin`). Full CPU direction parity for the moving-observer sky is deferred.

**Rationale.** Both backends compile the same TSL constants, so a cross-backend invariant cannot
see a *shared* initializer defect — confirmed by measurement: the row passes on the pre-fix baseline
while the static rows fail (`diag-b4.6` `received 80`). Its value is guarding the observer-specific
regression surface (mode plumbing, uniform wiring, snapshot truthfulness), which is what the
destination control work of Phase 1 depends on. Fail-before evidence for the shared defect is
carried by the static rows (1.3) and the unit twins (1.1–1.2); the moving-observer `bigA0` constant
that feeds `L_z` extraction is pinned at unit level by the `kerrCameraBigA`/`metricFragments` twin.

**Recorded honestly.** Task 1.4's "record that it FAILS before the fix" is not satisfiable by a
cross-backend invariant by construction; the deviation is recorded in `tasks.md` with this
rationale rather than papered over.

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

None that change the approach. D6 was the one judgement call delegated to the implementing agent
(reject vs thread for non-unit mass); it is resolved as THREAD — see D6 for the caller audit that
reversed the initial reject choice (the black-hole merger's source-derived remnant mass) and for
the accepted limitations (disk-emitter block and CPU fragments stay unit-mass-native; both are
unreachable at M ≠ 1 today).
