# Tasks — Kerr GPU initializer correctness

Ordered by dependency. Every task states its verification. Do not mark a task complete without the
evidence its Verification line names.

## 0. Baseline

- [ ] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, and a clean `git status --short`. Re-derive every cited symbol against that HEAD. Audit citations were taken at `dc0b3ba` and are not authoritative line numbers.
- [ ] 0.2 Run and record the required baseline: `npm run check` (expect 46 files / 631 unit tests green plus a passing build).
- [ ] 0.3 Record the current `kerr-backend-census` terminal-class percentages and the current KERR_*/OBSERVER_* golden results as the before-evidence for this change.
- [ ] 0.4 Record `openspec validate kerr-gpu-initializer-correctness --type change --strict` passes before any implementation edit.

## 1. Failing tests first

- [ ] 1.1 Add a unit test asserting the Kerr camera-side quartic equals the CPU `metricFragments` quartic for a sampled `(r, θ, a)` grid. Confirm it FAILS before the fix.
- [ ] 1.2 Add a unit test asserting the static `L_z` frame term uses `g_tφ/√f_s` and equals `kerr/reference.ts` within tolerance. Confirm it FAILS before the fix.
- [ ] 1.3 Add close-in static-camera rows to `tests/browser/kerr-parity.spec.ts` (radii inside 2× the Schwarzschild ISCO, at least two non-zero spins). Record that they FAIL before the fix.
- [ ] 1.4 Add a Kerr + relativistic-observer parity row (non-zero spin, observer mode other than the free camera). Record that it FAILS before the fix.
- [ ] 1.5 Add the compared-count assertion to every new and pre-existing parity row so a row that compares zero rays fails.

## 2. Kerr camera-side corrections

- [ ] 2.1 Introduce one shared TSL `bigA` factory in `kerrIntegrator.ts` taking `(r, theta, delta, spin)`.
- [ ] 2.2 Replace the camera-side quartic at the current `:464` with a call to the shared factory.
- [ ] 2.3 Replace the integration-loop quartic with a call to the same factory so both sites are literally the same definition.
- [ ] 2.4 Correct the static `L_z` frame term to `g_tphi0 / sqrt(max(fS0, denomFloor))`.
- [ ] 2.5 Add the `observerFrequencyComoving` uniform to the Kerr uniform block. Mirror the Schwarzschild `energyMultiplier`: inactive multiplies by exactly 1; active multiplies by `1/max(|E|, denomFloor)`. Do not use a different sign convention, and do not treat a `sqrt(f_s)` brightness ratio as the expected result.
- [ ] 2.6 Make the mass convention explicit: reject a non-unit normalised mass with a clear reason, or thread `a = a* · M` through every metric term if the agent judges threading safe.
- [ ] 2.7 Confirm the unit tests from §1.1–1.2 now pass and the typecheck is clean.

## 3. LUT corrections

- [ ] 3.1 In `lut/lensingGpu.ts`, derive capture classification from the analytic impact-parameter comparison; route the hybrid band to the numerical fallback.
- [ ] 3.2 Retain the stored sentinel only as a secondary guard and document why it is not the authority.
- [ ] 3.3 Thread the manifest's `x → u` axis mapping into the LUT GPU material as uniforms; build the mapping node from them rather than module-scope literals.
- [ ] 3.4 Reject a family whose declared axis mapping is not the supported form, with an explicit reason and a truthful fallback to the numerical backend.
- [ ] 3.5 Add a unit test that a non-default manifest axis produces a different mapping, and that the shipped family still loads.
- [ ] 3.6 Add a test that a ray just inside `b_c` is never reported as LUT-escaped.

## 4. Documentation

- [ ] 4.1 Update `docs/KERR_BACKEND_ADR.md` to state the resolved static `L_z` normalisation and the g-factor gating decision; remove the misleading inline comment in the shader.
- [ ] 4.2 Update `docs/NUMERICAL_METHODS.md` only if a decision here changes a documented convention.
- [ ] 4.3 Record in this change's `design.md` the final resolution of the D6 mass-convention choice.

## 5. Validation and evidence

- [ ] 5.1 `npm run check` green: format, lint, typecheck, unit tests, build.
- [ ] 5.2 `npx playwright test kerr-parity --project=default` green, including the new rows, with the compared-count assertion satisfied.
- [ ] 5.3 `npx playwright test kerr-backend-census observer-modes` green; record the before/after terminal-class percentages and explain any shift as a consequence of the correction.
- [ ] 5.4 `npx playwright test visual-goldens --workers=1` — record which KERR_*/OBSERVER_* rows changed. Every changed row MUST be justified in this section with before/after evidence showing the CPU reference now agrees better. No row may be re-baselined without that justification.
- [ ] 5.5 `npx playwright test lut-disk-parity --project=default` green.
- [ ] 5.6 Re-run the changed golden rows a second time to confirm twice-stability.
- [ ] 5.7 `openspec validate kerr-gpu-initializer-correctness --type change --strict` still passes.

## 6. Close-out

- [ ] 6.1 Strike the resolved findings (Q-01, Q-02, Q-03, Q-04, Q-05, Q-07) out of `docs/MASTER_PLAN.md` with their resolution commit.
- [ ] 6.2 Append the evidence (commands, pass counts, golden before/after, census deltas) to `.agent/STATE.md`.
- [ ] 6.3 Commit this change as one coherent checkpoint.
