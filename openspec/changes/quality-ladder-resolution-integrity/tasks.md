# Tasks — Quality ladder resolution integrity

## 0. Baseline

- [ ] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [ ] 0.2 Run `npm run check` and record the result.
- [ ] 0.3 Record the live drawing-buffer dimensions at each tier (`low`, `medium`, `high`, `ultra`) at the standard 1280x800 viewport, plus the current HDR target dimensions. This is the before-evidence for the double-application defect.
- [ ] 0.4 Record the current `runtimeTelemetry().size` payload at a non-unity tier.
- [ ] 0.5 Confirm `openspec validate quality-ladder-resolution-integrity --type change --strict` passes.

## 1. Failing tests first

- [ ] 1.1 Add a unit test asserting the HDR render target dimensions equal the drawing-buffer dimensions at render scale 0.6 and 0.8. Confirm it FAILS before the fix.
- [ ] 1.2 Add a unit test asserting the telemetry-reported render scale equals the scale applied to the buffer. Confirm it FAILS before the fix.
- [ ] 1.3 Add a browser row in `tests/browser/frame-invalidation.spec.ts` that drives a tier change and asserts the drawing-buffer dimensions change. Confirm it FAILS before the fix.
- [ ] 1.4 Add a browser row asserting a user-selected manual quality mode survives a full transition. Confirm it FAILS before the fix.

## 2. Single application of render scale

- [ ] 2.1 Make the kernel the single owner of the pixel-ratio formula; pass already-scaled dimensions to `SharedPost.ensureSize`.
- [ ] 2.2 Re-document the `renderScale` parameter on `ISharedPost.ensureSize` as applying to unscaled dimensions only.
- [ ] 2.3 Verify the `DeferredSharedPost` forwarder in `src/atlas/host.ts` passes the value through consistently.
- [ ] 2.4 Confirm the test from 1.1 now passes and the measured dimensions match the formula in `docs/PERFORMANCE_BUDGETS.md`.

## 3. Tier change applies to the buffer

- [ ] 3.1 In `host.ts`, make the `onTierChanged` handler re-issue `handleResize` with the new effective scale.
- [ ] 3.2 Ensure the post targets and the transition overlay are resized by the same re-issue.
- [ ] 3.3 Ensure temporal history is invalidated by the tier change (existing behaviour; verify it still holds after the resize path is re-entered).
- [ ] 3.4 Confirm the test from 1.3 now passes.
- [ ] 3.5 Confirm the governor tier-churn torture test still passes (no oscillation introduced).

## 4. Manual quality mode survives transitions

- [ ] 4.1 Replace the director's construction-time `baseQualityMode` snapshot with a resolver read at motion end.
- [ ] 4.2 Ensure a quality-mode change made during a transition wins at motion end.
- [ ] 4.3 Ensure automatic mode still round-trips correctly.
- [ ] 4.4 Confirm the panel control displays the user's selected mode after arrival.
- [ ] 4.5 Confirm the test from 1.4 now passes.

## 5. Telemetry truthfulness

- [ ] 5.1 Make `runtimeTelemetry().size` report the scale and dimensions the kernel actually applied.
- [ ] 5.2 Report an explicit unknown before the first successful resize instead of a nominal value.
- [ ] 5.3 Keep CPU submission time as a separately reported metric; do not merge it into the frame-rate signal.
- [ ] 5.4 Confirm the test from 1.2 now passes.

## 6. Governor frame-rate signal

- [ ] 6.1 Change the governor's FPS signal to the interval between presented frames.
- [ ] 6.2 Update `tests/unit/governor.test.ts` so its harness models the production measurement boundary, and confirm the documented thresholds still reach each tier.
- [ ] 6.3 Move the activity clock and settle/grace bookkeeping onto the frame delta so they advance regardless of whether a frame was rendered.
- [ ] 6.4 Confirm the idle-skipping scenario still reports zero rendered frames AND a settled activity state.
- [ ] 6.5 Record a runtime measurement: on a deliberately heavy preset, log the frame-interval signal, the CPU submission time and the resulting tier, before and after this task.

## 7. Documentation

- [ ] 7.1 Update `docs/PERFORMANCE_BUDGETS.md` so the render-scale formula matches the implemented single application.
- [ ] 7.2 Update `docs/PERFORMANCE.md` section 3 to state that a tier change resizes the buffer.
- [ ] 7.3 Update `docs/cosmic-atlas/RENDERING_SERVICES.md` for the telemetry source change.

## 8. Validation and evidence

- [ ] 8.1 `npm run check` green.
- [ ] 8.2 All new unit and browser rows from section 1 pass.
- [ ] 8.3 `npx playwright test frame-invalidation atlas-webgl2 shared-post-lifecycle shared-post-v2 --project=default` green.
- [ ] 8.4 `npx playwright test visual-goldens --workers=1` — record every changed row. Each change must be justified here with before/after dimensions and a statement that the new size matches the documented formula. No row may be re-baselined without that justification.
- [ ] 8.5 `npx playwright test cinematic-goldens --project=default` green, or the change justified.
- [ ] 8.6 Re-run the scenario matrix and record the per-tier GPU/CPU numbers.
- [ ] 8.7 `npx playwright test --project=default` full suite green.
- [ ] 8.8 `openspec validate quality-ladder-resolution-integrity --type change --strict` still passes.

## 9. Close-out

- [ ] 9.1 Strike findings A-01, A-02, A-03, A-04, A-05, A-06 from `docs/MASTER_PLAN.md` with their resolution commit.
- [ ] 9.2 Append evidence to `.agent/STATE.md`.
- [ ] 9.3 Commit this change as one coherent checkpoint.
