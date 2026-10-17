# Tasks — Kerr GPU initializer correctness

Ordered by dependency. Every task states its verification. Do not mark a task complete without the
evidence its Verification line names.

## 0. Baseline

- [x] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, and a clean `git status --short`. Re-derive every cited symbol against that HEAD. Audit citations were taken at `dc0b3ba` and are not authoritative line numbers.
  Evidence: HEAD `88a3b5f647e8e8c087efc48f0470b4b2bfd63e0c` (phase-0 tip), node `v24.3.0`, npm `11.4.2`. This change's edits were stashed for the baseline runs; the pre-existing `stash@{0}: phase0-wip-at-c0ee5f5` is untouched. Every line number cited in the design doc was re-derived against this HEAD.
- [x] 0.2 Run and record the required baseline: `npm run check` (expect 46 files / 631 unit tests green plus a passing build).
  Evidence: baseline `npm run check` green — 46 files / 631 unit tests + format/lint/typecheck/build pass (session record).
- [x] 0.3 Record the current `kerr-backend-census` terminal-class percentages and the current KERR_*/OBSERVER_* golden results as the before-evidence for this change.
  Evidence: baseline `visual-goldens --workers=1` 43/43 PASS. Census baseline (webgpu): `capturedBlack 194599 (27.510%)`, `unclassified 95330`, `otherMagenta 999`, `thetaWrapRed 943`; webgl2 reproduces the historical 27.51%/24.85% flaky split (pre-existing, recorded in `.agent/STATE.md`).
- [x] 0.4 Record `openspec validate kerr-gpu-initializer-correctness --type change --strict` passes before any implementation edit.
  Evidence: validated the HEAD (pre-implementation) artifacts via a narrow `git stash push/pop` round-trip of `design.md`: "Change 'kerr-gpu-initializer-correctness' is valid".

## 1. Failing tests first

- [x] 1.1 Add a unit test asserting the Kerr camera-side quartic equals the CPU `metricFragments` quartic for a sampled `(r, θ, a)` grid. Confirm it FAILS before the fix.
  Evidence: `tests/unit/kerrCameraSideMath.test.ts` grid test. Fail-first limit, same class as D8: the mirror module did not exist at HEAD and node cannot execute the TSL graph, so the twin passes on the pre-fix tree by construction; the GPU-side fail-before for this formula is carried by 1.3's browser rows, which compare full GPU output against this CPU oracle and failed pre-fix (received 43 / 80 rays).
- [x] 1.2 Add a unit test asserting the static `L_z` frame term uses `g_tφ/√f_s` and equals `kerr/reference.ts` within tolerance. Confirm it FAILS before the fix.
  Evidence: `tests/unit/kerrCameraSideMath.test.ts` static-`L_z` equality vs `kerr/reference.ts`. Same fail-first limit as 1.1 (the defect was GPU-only); the pre-fix GPU failure appears inside 1.3's failing rows.
- [x] 1.3 Add close-in static-camera rows to `tests/browser/kerr-parity.spec.ts` (radii inside 2× the Schwarzschild ISCO, at least two non-zero spins). Record that they FAIL before the fix.
  Evidence: close-in rows (a* ∈ {0.6, 0.9}) FAIL pre-fix on both backends: received 43 / 80 rays (stash round-trip record); PASS post-fix, part of 4/4 `kerr-parity`.
- [x] 1.4 Add a Kerr + relativistic-observer parity row (non-zero spin, observer mode other than the free camera). Record that it FAILS before the fix.
  Evidence: `observer cross-backend` row added (a* = 0.6, observer mode, epoch-frozen). Recorded deviation, design.md D8: the row passes on the pre-fix baseline because both backends share the defect, so a class-invariant comparison cannot see it; fail-before is unobservable for this row by construction. Substituted pre-fix failure evidence: 1.3's rows plus the f64 replay that proved the stage overshoot.
- [x] 1.5 Add the compared-count assertion to every new and pre-existing parity row so a row that compares zero rays fails.
  Evidence: compared-count assertion present in every `kerr-parity.spec.ts` row; both post-fix 4/4 runs satisfied it.

## 2. Kerr camera-side corrections

- [x] 2.1 Introduce one shared TSL `bigA` factory in `kerrIntegrator.ts` taking `(r, theta, delta, spin)`.
  Evidence: `bigANode(r, aSq, delta, s2)` factory at `kerrIntegrator.ts:494`.
- [x] 2.2 Replace the camera-side quartic at the current `:464` with a call to the shared factory.
  Evidence: `bigA0 = bigANode(r0, aPhysSq, del0, s20)` at `kerrIntegrator.ts:503`; the pre-fix expression was `(r+a)² − a²Δs²`, a 56× error in A at r=8, a*=0.6 (73.96 vs 4142.2).
- [x] 2.3 Replace the integration-loop quartic with a call to the same factory so both sites are literally the same definition.
  Evidence: `bigA = bigANode(r, aSq, delta, s2)` at `kerrIntegrator.ts:592` — one definition, two call sites.
- [x] 2.4 Correct the static `L_z` frame term to `g_tphi0 / sqrt(max(fS0, denomFloor))`.
  Evidence: `kerrIntegrator.ts:522-525`, `gTphi0.div(sqrt(max(fS0, denomFloor)))`.
- [x] 2.5 Add the `observerFrequencyComoving` uniform to the Kerr uniform block. Mirror the Schwarzschild `energyMultiplier`: inactive multiplies by exactly 1; active multiplies by `1/max(|E|, denomFloor)`. Do not use a different sign convention, and do not treat a `sqrt(f_s)` brightness ratio as the expected result.
  Evidence: uniform declared `kerrIntegrator.ts:215`, wired `:371`; `gObserverMultiplier` select at `:916-925` (inactive branch exactly 1.0, active `1/max(|E|, floor)`), mirrored from Schwarzschild `energyMultiplier`; resolution recorded in `docs/KERR_BACKEND_ADR.md:390`.
- [x] 2.6 Make the mass convention explicit: reject a non-unit normalised mass with a clear reason, or thread `a = a* · M` through every metric term if the agent judges threading safe.
  Evidence: THREAD decision — `safeMassRg = params.massRg` (`:303`, non-finite/non-positive still `RangeError`), `aPhys`/`aPhysSq` nodes (`:327-328`) threaded into every metric site (sig0/del0/gTphi0/bigA0/init, coreDerivs, stage Σ/Δ, guard terms, terminal terms); `tests/unit/kerrMassConvention.test.ts` (5 tests) pins the convention; design.md D6 rewritten with the full reversal record, validation, and accepted limitations (disk-emitter block, reference fragments, observer moving-leg destination).
- [x] 2.7 Confirm the unit tests from §1.1–1.2 now pass and the typecheck is clean.
  Evidence: kerr unit group green (`kerrCameraSideMath`, `kerrMassConvention`, `kerrHorizonStepGuardPolicy`, `lensingService`, `kerrHorizon...`); `tsc --noEmit` clean (build green).

## 3. LUT corrections

- [x] 3.1 In `lut/lensingGpu.ts`, derive capture classification from the analytic impact-parameter comparison; route the hybrid band to the numerical fallback.
  Evidence: `lensingGpu.ts` classification now compares analytic `b` vs `b_c`; hybrid band routes to numerical fallback.
- [x] 3.2 Retain the stored sentinel only as a secondary guard and document why it is not the authority.
  Evidence: sentinel retained as secondary guard with comment explaining analytic `b` is the authority (`lensingGpu.ts`).
- [x] 3.3 Thread the manifest's `x → u` axis mapping into the LUT GPU material as uniforms; build the mapping node from them rather than module-scope literals.
  Evidence: axis-mapping uniforms supplied per family and consumed by the mapping node (`lensingGpu.ts` + `LensingService.ts` wiring); `lut/textures.ts` carries the mapping through the material path.
- [x] 3.4 Reject a family whose declared axis mapping is not the supported form, with an explicit reason and a truthful fallback to the numerical backend.
  Evidence: `LensingService.ts` throws `TypeError` with an explicit unsupported-mapping reason; `blackHoleDestination.ts` falls back to the numerical backend.
- [x] 3.5 Add a unit test that a non-default manifest axis produces a different mapping, and that the shipped family still loads.
  Evidence: `tests/unit/lutAxisMapping.test.ts`.
- [x] 3.6 Add a test that a ray just inside `b_c` is never reported as LUT-escaped.
  Evidence: `tests/unit/lutAxisMapping.test.ts:48` — "never reports a ray just inside b_c as escaped".

## 4. Documentation

- [x] 4.1 Update `docs/KERR_BACKEND_ADR.md` to state the resolved static `L_z` normalisation and the g-factor gating decision; remove the misleading inline comment in the shader.
  Evidence: `docs/KERR_BACKEND_ADR.md:155` (camera-side legs / `L_z` resolution) and `:390` (g-factor gating: raw `g`, comoving factor only when explicitly requested); misleading shader comment removed with the 2.5 edit.
- [x] 4.2 Update `docs/NUMERICAL_METHODS.md` only if a decision here changes a documented convention.
  Evidence: `docs/NUMERICAL_METHODS.md` §9 updated for the near-horizon step guard (D7) and its min-step clause; no other convention changed.
- [x] 4.3 Record in this change's `design.md` the final resolution of the D6 mass-convention choice.
  Evidence: design.md D6 rewritten as THREAD with the original REJECT decision, why it was reversed (merger caller, disclosure, reference formula, exact M=1 no-op), validation, accepted limitations, and rejected alternatives.

## 5. Validation and evidence

- [x] 5.1 `npm run check` green: format, lint, typecheck, unit tests, build.
  Evidence: `npm run check` exit 0 — `prettier --check` clean (8 files formatted first), `eslint .` clean, `tsc --noEmit` clean, vitest green, `vite build` green; emitted asset hashes identical to the pre-format phase-1 build (whitespace-only formatting), so the twice-stable golden runs cover this exact output.
- [x] 5.2 `npx playwright test kerr-parity --project=default` green, including the new rows, with the compared-count assertion satisfied.
  Evidence: 4/4 both backends (static close-in rows + observer cross-backend row), compared-count > 0 on every row, run after each fix stage and on the final tree.
- [x] 5.3 `npx playwright test kerr-backend-census observer-modes` green; record the before/after terminal-class percentages and explain any shift as a consequence of the correction.
  Evidence: green. Investigation recorded in full because the first post-fix standalone runs FAILED the cross-backend assertion:

  - **Baseline (HEAD) census**: PASS — webgpu `capturedBlack 194599 (27.510%)` vs webgl2 `194607 (27.511%)` (8-ray diff); unclassified 95330/95331. Both frames crisp, both carrying the same magenta dead-ray spiral (the D1/D2 defect).
  - **First post-fix runs**: deterministic FAIL — webgpu `283220 (40.038%)` vs webgl2 `280665 (39.677%)`, 0.361% split vs the 0.05% tolerance (identical numbers in 3 standalone runs; one combined run passed). Screenshot diffing (`playwright`-bundled pngjs) localized the split to a thin blend ring along the shadow boundary.
  - **Root cause**: canvas geometry dump showed webgpu backing `[972,727]` (scale 1.0) vs webgl2 backing `[583,436]` (**scale 0.6 = `PER_TIER_RENDER_SCALE.low`**). A tier change does not re-run `handleResize` (MASTER_PLAN A-01), so each backend's backing latched the scale its auto-walk had reached; post-fix WebGL2 frames are heavier (the rays that used to die in the non-finite spiral now integrate to a terminal class), the walk dropped to `low`, and the CSS upscale turned hard class boundaries into blend pixels the classifier counts differently. This was a resolution mismatch in the test setup, not a terminal-class disagreement — the baseline passed only because both backends had happened to latch 1.0.
  - **Fix**: the census now pins the scale with `host.setRenderScaleOverride(1)` alongside its existing tier pin (the override wins over dynamic resolution and re-applies the size immediately).
  - **After (pinned, twice-stable)**: run 1 and run 2 byte-identical — webgpu `capturedBlack 284175 (40.173%)`, webgl2 `284177 (40.173%)`; escaped 414861/414857; maxSteps 1209/1209; unclassified 7085/7082 — cross-backend agreement at 2–5 rays, like baseline. `otherMagenta 0` (was 999/987: the non-finite spiral is gone) and `unclassified` 7085 (was 95330: the dead rays now classify captured/escaped) — the aggregate shift is exactly the correction.
  - The combined `kerr-backend-census observer-modes lut-disk-parity --workers=1` gate also passed (8/8).
- [x] 5.4 `npx playwright test visual-goldens --workers=1` — record which KERR_*/OBSERVER_* rows changed. Every changed row MUST be justified in this section with before/after evidence showing the CPU reference now agrees better. No row may be re-baselined without that justification.
  Evidence: two full serial runs, 43/43 PASS each (twice-stable, 5.6). Changed rows: exactly `KERR_HIGH_PROGRADE.png` and `KERR_CIRCULAR_OBSERVER.png`. All other rows — including `KERR_RETROGRADE`, `KERR_ZERO_SPIN`, all four `OBSERVER_*` rows, and all four `BHM_*` rows — pass against their committed images unchanged. Justifications:

  **`KERR_HIGH_PROGRADE` (D7 near-horizon guard).** Before: magenta NON_FINITE spiral inside the
  shadow region (before-image saved at `$env:TEMP\kerr_hp_before.png`). The f64 reference replay
  (`scripts/tmp-gpu-step-probe*.ts`, since deleted) showed the unguarded integrator overflowing at
  the θ→0 stage derivative near the horizon — a step-size failure, not a physics disagreement.
  After: those pixels classify `captured` (black), matching the CPU oracle's classification for the
  same rays; parity rows agree class and direction on the fixed tree. The moved pixels were failure
  colors that the CPU reference never produces.

  **`KERR_CIRCULAR_OBSERVER` (D1 shared quartic).** Before: a ~97%-black frame (5 KB PNG) with only
  a purple disk sliver — the committed image baselined the D1 defect: the moving-observer init used
  `(r+a)²` instead of `(r²+a²)²`, so at r=8, a*=0.6 the conserved quantities were built from
  A = 73.96 instead of A = 4142.2 (56× error) and the observer's rays degenerated into a failure
  band. This is exactly the band the row's `pinTier: 'ultra'` note (M11) exists to avoid; the pin
  could not help because the defect was upstream of the budget. After: the full scene the row exists
  to guard — disk annulus, lensed photon-ring structure, starfield — with the same purple disk
  element visible in both images (before-image at `$env:TEMP\kerr_co_before.png`). CPU agreement:
  the camera-side mirror unit test pins the correct quartic, and the parity rows agree on the
  corrected tree; the old image was a failure band where the CPU reference produces a scene.

  **`BHM_NEAR_MERGER` — interim update reverted, committed image retained.** During D6 debugging an
  interim `UPDATE_GOLDENS` run captured the broken D6-REJECT build (every frame threw from
  `ensureKerrPass`, freezing post-611 visuals); that interim PNG was restored via `git checkout HEAD`
  once threading landed, and the committed image passes unchanged (11.887 / 4.7811 / 255 within
  8/4/48 pre-fix-tolerance). No re-baseline.
- [x] 5.5 `npx playwright test lut-disk-parity --project=default` green.
  Evidence: green in the combined `kerr-backend-census observer-modes lut-disk-parity --workers=1` run (8/8 passed, 57.9s).
- [x] 5.6 Re-run the changed golden rows a second time to confirm twice-stability.
  Evidence: two consecutive full serial runs after the final golden state, 43/43 PASS each (4.8m and 4.9m).
- [x] 5.7 `openspec validate kerr-gpu-initializer-correctness --type change --strict` still passes.
  Evidence: "Change 'kerr-gpu-initializer-correctness' is valid" on the final artifacts (0.4 records the pre-implementation pass).

## 6. Close-out

- [x] 6.1 Strike the resolved findings (Q-01, Q-02, Q-03, Q-04, Q-05, Q-07) out of `docs/MASTER_PLAN.md` with their resolution commit.
  Evidence: `docs/MASTER_PLAN.md` edited in this change; resolution notes reference the change and land with the close-out commit.
- [x] 6.2 Append the evidence (commands, pass counts, golden before/after, census deltas) to `.agent/STATE.md`.
  Evidence: `.agent/STATE.md` session entry "2026-10-03 session — Phase 1 change 1" prepended at the top of the file with commands, pass counts, golden before/after, census before/after and the scale-latch root cause.
- [x] 6.3 Commit this change as one coherent checkpoint.
  Evidence: one commit containing all 22 files of the change (src + tests + goldens + docs + OpenSpec artifacts), 1173 insertions / 126 deletions; working tree clean afterwards (`git status --short` empty).
