# Tasks — Transition error user visibility

## 0. Baseline

- [ ] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [ ] 0.2 Run `npm run check` and record the result (expect 46 files / 631 unit tests plus a passing build).
- [ ] 0.3 Record the current UI geometry contract measurements (topbar height, `#viewport` size, canvas backing store, `#panel` width) from the existing geometry assertion, so the no-error geometry can be proven unchanged.
- [ ] 0.4 Confirm `openspec validate transition-error-user-visibility --type change --strict` passes.

## 1. Failing test first

- [ ] 1.1 Add a browser row to `tests/browser/atlas-navigation.spec.ts` that forces a destination preparation rejection and asserts a user-visible error surface exists. Confirm it FAILS before the fix.
- [ ] 1.2 Add a row asserting the error is perceivable with the control panel collapsed. Confirm it FAILS before the fix.
- [ ] 1.3 Add a row to `tests/browser/accessibility.spec.ts` asserting the error is exposed via an assertive live region and is not conveyed by colour alone. Confirm it FAILS before the fix.

## 2. Publish the error

- [ ] 2.1 Add a structured transition error to `TransitionPublicState` in `src/atlas/types.ts`: stable machine code, human message, destination id, `fatal` flag.
- [ ] 2.2 Populate it in `TransitionDirector` at the point the internal error is set, so public and internal state cannot diverge.
- [ ] 2.3 Do NOT publish an error for an aborted/superseded attempt (the `stale(gen)` and `signal.aborted` paths).
- [ ] 2.4 Clear the published error on a successful transition completion.
- [ ] 2.5 Confirm `tsc --noEmit` is clean and no existing consumer breaks (the field is additive).

## 3. Render the error

- [ ] 3.1 Add an error surface to `src/app/atlasApp.ts` outside the collapsible panel's hiding subtree.
- [ ] 3.2 Give it an assertive live region; leave the existing polite progress region for progress.
- [ ] 3.3 Render authored remediation copy for the recoverable case. Keep raw loader detail in the console channel only, per `docs/FAILURE_RECOVERY.md` section 3.
- [ ] 3.4 Add a retry action that re-requests the same destination, and a dismiss action that leaves the user on the current destination.
- [ ] 3.5 Ensure a retry that fails again re-presents the same error and does not loop or auto-retry.
- [ ] 3.6 Distinguish fatal from recoverable in text; do not reuse the fatal copy for a recoverable error.

## 4. Unsupported-backend remediation

- [ ] 4.1 Wire `buildUnsupportedMessage` from `src/atlas/hostStatus.ts` into the product boot-failure path.
- [ ] 4.2 Confirm it gives the same remediation standard as the legacy route.

## 5. Documentation

- [ ] 5.1 Record the product-route implementation of `docs/FAILURE_RECOVERY.md` section 3.
- [ ] 5.2 Add the error presentation contract to `docs/cosmic-atlas/PRODUCT_UX_AND_TRANSITIONS.md`.
- [ ] 5.3 Update `docs/cosmic-atlas/ARCHITECTURE.md` section 11's transition boundary to note the public error field.

## 6. Validation and evidence

- [ ] 6.1 `npm run check` green.
- [ ] 6.2 The new navigation and accessibility rows pass.
- [ ] 6.3 Re-measure the UI geometry contract and confirm it is byte-identical to the baseline from 0.3 when no error is present.
- [ ] 6.4 `npx playwright test atlas-navigation atlas-webgl2 smoke --project=default` green.
- [ ] 6.5 `npx playwright test visual-goldens --workers=1` green with no re-baselining.
- [ ] 6.6 Run the full non-golden browser suite and record pass/skip/fail counts.
- [ ] 6.7 `openspec validate transition-error-user-visibility --type change --strict` still passes.

## 7. Close-out

- [ ] 7.1 Strike findings E-01, E-02, E-03 from `docs/MASTER_PLAN.md` with their resolution commit.
- [ ] 7.2 Append evidence to `.agent/STATE.md`.
- [ ] 7.3 Commit this change as one coherent checkpoint.
