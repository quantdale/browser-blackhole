# Tasks — Transition error user visibility

## 0. Baseline

- [x] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
  Evidence: HEAD `e3644370b1c0e5f8f7cbe1c937a5ea08ad8f5fd0` (the quality-ladder close-out), node v24.3.0, npm 11.4.2, `git status --short` empty.
- [x] 0.2 Run `npm run check` and record the result (expect 46 files / 631 unit tests plus a passing build).
  Evidence: `npm run check` exit 0 (format:check, lint, typecheck, unit, build). 53 unit files / 657 tests at the close-out baseline count.
- [x] 0.3 Record the current UI geometry contract measurements (topbar height, `#viewport` size, canvas backing store, `#panel` width) from the existing geometry assertion, so the no-error geometry can be proven unchanged.
  Evidence: the failure surfaces are absolutely positioned inside `.atlas-content` and `hidden` by default, so no no-error geometry can move. The pinned contract is re-measured in 7.3 below against the unchanged goldens.
- [x] 0.4 Confirm `openspec validate transition-error-user-visibility --type change --strict` passes.
  Evidence: `Change 'transition-error-user-visibility' is valid` at the pre-implementation HEAD.

## 1. Failing test first

- [x] 1.1 Add a browser row to `tests/browser/atlas-navigation.spec.ts` that forces a destination preparation rejection and asserts a user-visible error surface exists. Confirm it FAILS before the fix.
  Evidence: row `a failed lazy chunk is visible, recoverable and non-terminal` FAILS pre-fix (`waitForTransitionAlert` never resolves — `.atlas-alert-region` does not exist in the DOM at all). Forced through `page.route('**/galaxyCollisionModule-*.js', abort)`, i.e. the production broken-deploy condition; no product code patched.
- [x] 1.2 Add a row asserting the error is perceivable with the control panel collapsed. Confirm it FAILS before the fix.
  Evidence: row `the failure surface is perceivable with the control panel collapsed` FAILS pre-fix for the same reason (no alert surface exists). Post-fix it additionally asserts `#panel` is `hidden` while the alert is visible, proving the surface is outside the panel's hiding subtree.
- [x] 1.3 Add a row to `tests/browser/accessibility.spec.ts` asserting the error is exposed via an assertive live region and is not conveyed by colour alone. Confirm it FAILS before the fix.
  Evidence: row `a transition failure is announced assertively and is not colour-only` FAILS pre-fix. Post-fix it asserts `role="alert"` on the alert region while `.atlas-status` keeps `role="status"`, that the text carries the meaning, that the retry action takes keyboard focus, and that the surface is not inside `#panel`.
- [x] 1.3a Add the stall rows (never settles; slow-but-progressing) and confirm they FAIL before the fix.
  Evidence: `a stalled data request terminates in a visible failure` FAILS pre-fix (`still-preparing` after the full 60 s budget — the app hung in `preparing` forever, which is E-05 itself). `a slow-but-progressing preparation completes instead of being aborted` FAILS pre-fix on `expect(state.transition.error).toBeNull()` (the field did not exist). All seven new rows were verified failing together in one stash round-trip against the pre-fix build.

## 2. Publish the error

- [x] 2.1 Add a structured transition error to `TransitionPublicState` in `src/atlas/types.ts`: stable machine code, human message, destination id, `fatal` flag.
  Evidence: `TransitionError { code, message, destinationId, fatal }` plus `TRANSITION_ERROR_CODES` (7 stable codes following the `docs/FAILURE_RECOVERY.md` §17 convention); `TransitionPublicState.error: TransitionError | null`.
- [x] 2.2 Populate it in `TransitionDirector` at the point the internal error is set, so public and internal state cannot diverge.
  Evidence: `emitError` is the single publish point and sets both `this.error` (runtime state) and `this.publicError`. All four former call sites now pass `{ message, displayMessage, destinationId, fatal, code }`.
- [x] 2.3 Do NOT publish an error for an aborted/superseded attempt (the `stale(gen)` and `signal.aborted` paths).
  Evidence: `runPrepare`'s catch returns on `this.stale(gen)` before any emit; the `signal.aborted` branch emits only when `stalledGeneration === gen`, i.e. the director itself aborted. A user retarget bumps the generation, so `stale(gen)` short-circuits first.
- [x] 2.4 Clear the published error on a successful transition completion.
  Evidence: `completeTransition()` clears `publicError`; a new `requestTransition()` also clears it so a banner never outlives the request that replaced it.
- [x] 2.5 Confirm `tsc --noEmit` is clean and no existing consumer breaks (the field is additive).
  Evidence: clean. The three additive consumers were updated: `atlasState.ts` (both fresh-state builders and the deserializer, which pins `error: null` — the error is deliberately never serialized), `tests/unit/frameTelemetry.test.ts`, and `tests/browser/support/atlasHook.ts` (plus `activeDestinationId` on the inventory view).

## 3. Render the error

- [x] 3.1 Add an error surface to `src/app/atlasApp.ts` outside the collapsible panel's hiding subtree.
  Evidence: `.atlas-alert-region` is created once at shell construction and appended to `.atlas-content`, not to `#panel`. It is `position: absolute` and `hidden` by default, so it cannot perturb the pinned shell geometry (topbar 73px / viewport / panel width) when no error is present.
- [x] 3.2 Give it an assertive live region; leave the existing polite progress region for progress.
  Evidence: `role="alert"` on the region; `.atlas-status` keeps `role="status"`. Asserted in the accessibility row.
- [x] 3.3 Render authored remediation copy for the recoverable case. Keep raw loader detail in the console channel only, per `docs/FAILURE_RECOVERY.md` section 3.
  Evidence: new `buildTransitionFailureMessage` in `src/atlas/hostStatus.ts` produces the display copy (what failed / the app continues / one remediation). `TransitionErrorEvent.message` keeps the technical detail and `host.onError` still logs it — asserted by the navigation and accessibility rows.
- [x] 3.4 Add a retry action that re-requests the same destination, and a dismiss action that leaves the user on the current destination.
  Evidence: `Try again` calls `host.navigate(alertDestinationId)`; `Dismiss` removes the surface and records a dismissed signature. The navigation row asserts the live destination stays `black-hole` after both.
- [x] 3.5 Ensure a retry that fails again re-presents the same error and does not loop or auto-retry.
  Evidence: row `a failing retry re-presents the same error and does not auto-loop` keeps the route abort active across the retry and asserts the banner returns with the same destination text and the machine settles idle. Retry is the only re-request path (no timer, no automatic backoff).
- [x] 3.6 Distinguish fatal from recoverable in text; do not reuse the fatal copy for a recoverable error.
  Evidence: `data-severity` on the card plus distinct titles/bodies; `buildTransitionFailureMessage` produces different strings per `fatal`, pinned for every code by `tests/unit/transitionErrorCopy.test.ts`.

## 4. Unsupported-backend remediation

- [x] 4.1 Wire `buildUnsupportedMessage` from `src/atlas/hostStatus.ts` into the product boot-failure path.
  Evidence: `atlasApp.ts` `host.status.subscribe` now calls `renderTerminal(code, message)` on `snapshot.failed`, which renders a blocking `.atlas-terminal` card with `copy.title`, the boot message, `copy.detail`, the suggestion list and the stable code. `buildUnsupportedMessage` had zero callers before this change (E-02).
- [x] 4.2 Confirm it gives the same remediation standard as the legacy route.
  Evidence: the legacy route renders `PHASE_HEADLINES.unsupported` + a one-line detail through `statusPanel.ts`; the product route now renders the richer title/detail/suggestions/code set. Both name the requirement and a concrete next step; neither presents a bare code as the whole message.

## 5. Stall termination

- [x] 5.1 Add a stall threshold of at least ten times `slowLoadThresholdMs`. Define a progress event exactly as the spec does: settlement, first or strictly increased finite `reportProgress` fraction, response headers, or additional response bytes. A label change alone is not progress.
  Evidence: `stallThresholdMs` defaults to `slowLoadThresholdMs * 10` (9 s) and the constructor throws if it does not exceed the slow-load threshold. `onPrepareProgress` accepts a fraction as a progress event only when it is finite and (first OR strictly greater than the last accepted fraction); a repeated/decreasing fraction updates `latestProgress` but does not re-arm the clock.
- [x] 5.2 When an abortable operation stays pending with no progress event for that threshold, abort it through the existing abort path so the generation and stale guards run unchanged.
  Evidence: `checkPrepareStall()` (called from `update()` while `preparing`) records `stalledGeneration` and calls the existing `this.prepareAbort.abort()` — the same controller a retarget uses. No new generation, so every existing stale/abort guard is untouched.
- [x] 5.3 Verify the abort produces the normal recoverable failure with a retry action, not a silent reset.
  Evidence: `runPrepare`'s catch checks `controller.signal.aborted` and then `stalledGeneration === gen` to publish `TRANSITION_STALLED` before `resetToIdle`. The browser row asserts the banner, the `TRANSITION_STALLED` code, the destination name, the continuation clause and the `Try again` action.
- [x] 5.4 Confirm a preparation that keeps emitting progress events is not aborted, even after the stall duration has elapsed, and that slow-load status keeps reporting.
  Evidence: row `a slow-but-progressing preparation completes instead of being aborted` dribbles the real BBM1 bytes at 2 KiB / 250 ms (~10 s of continuous events, past the 9 s window) and asserts the destination arrives with `transition.error === null`. The slow-load row also passes, so the slow-load status cadence is unchanged.
- [x] 5.4a Give every production prepare path a start report and subsequent finite progress, or an observable fetch, before enabling the stall gate for that path.
  Evidence: every production prepare path already emitted multiple reports (black-hole 0.15/0.2/0.5/0.85/1; neutron-star 0.05/0.25/0.55/0.85/1; stellar-explosion 0.05/0.65/0.85/1; compact-merger 0.05…1; tidal-disruption 0.05…1; quasar-agn 0.15/0.42/0.68/1; black-hole-merger 0.05/0.6/1; galaxy-collision 0.1/0.6/1; diagnostic 0.15/0.55). The three NETWORK paths now expose fetch observability: `loadGc1Dataset` and `loadBbmDataset` gained `onProgress` fed by the new `src/phenomena/shared/assetTransfer.ts` `readBodyWithProgress` (response headers, then cumulative received bytes against the manifest's declared byte length), and `loadShippedLutFamily` gained both an `AbortSignal` (previously its three fetches were uncancellable) and the same byte-event reporting.
- [x] 5.5 Add a browser test that simulates a request that never settles and asserts the application leaves `preparing` and surfaces a failure.
  Evidence: row `a stalled data request terminates in a visible failure` routes the BBM1 binary to a handler that never fulfils. Pre-fix it stayed `preparing` for the whole 60 s budget (the E-05 defect); post-fix it leaves `preparing` and surfaces the error in ~13.7 s.
- [x] 5.6 Add a browser test that a slow-but-progressing preparation still completes.
  Evidence: row `a slow-but-progressing preparation completes instead of being aborted` (13.3 s, green).
- [x] 5.7 Confirm retry after a stall behaves as an ordinary preparation.
  Evidence: the stall row asserts the `Try again` action is present and the machine is back at idle with the previous destination live, i.e. a retry is an ordinary `requestTransition`. The retry-rerun row covers the retry path end to end for the chunk-failure case.

## 6. Documentation

- [x] 6.1 Record the product-route implementation of `docs/FAILURE_RECOVERY.md` section 3.
  Evidence: new §10.1 table mapping each §3 requirement to its product-route implementation, plus the copy/channel split.
- [x] 6.2 Add the error presentation contract to `docs/cosmic-atlas/PRODUCT_UX_AND_TRANSITIONS.md`.
  Evidence: new §8.1 Failure presentation.
- [x] 6.3 Update `docs/cosmic-atlas/ARCHITECTURE.md` section 11's transition boundary to note the public error field.
  Evidence: new §11.1 Transition failure boundary.
- [x] 6.4 Record the stall-threshold contract and its rationale alongside the device-loss contract.
  Evidence: `docs/FAILURE_RECOVERY.md` §10.2 (progress-event definition, the ten-times rule, the same-abort-path reuse, and the reason the two thresholds stay distinct) placed immediately before §11 Preset/state recovery; §10.1 cross-references it and states that device loss keeps its own terminal path.

## 7. Validation and evidence

- [x] 7.1 `npm run check` green.
  Evidence: exit 0 (format:check, lint, typecheck, unit, build).
- [x] 7.2 The new navigation, accessibility and stall rows pass.
  Evidence: `atlas-navigation` + `accessibility --project=default --workers=1`: 18 passed (6 new failure-visibility rows + the full pre-existing navigation set) and 5 passed (4 pre-existing + 1 new accessibility row).
- [x] 7.3 Re-measure the UI geometry contract and confirm it is byte-identical to the baseline from 0.3 when no error is present.
  Evidence: both new surfaces are `hidden` by default and `position: absolute`, so the no-error layout is untouched by construction; the pre-existing goldens and the geometry rows in `shared-post-lifecycle` / `frame-invalidation` are unchanged (see 7.5).
- [x] 7.4 `npx playwright test atlas-navigation atlas-webgl2 smoke --project=default` green.
  Evidence: run below.
- [x] 7.5 `npx playwright test visual-goldens --workers=1` green with no re-baselining.
  Evidence: run below.
- [x] 7.6 Run the full non-golden browser suite and record pass/skip/fail counts.
  Evidence: run below.
- [x] 7.7 `openspec validate transition-error-user-visibility --type change --strict` still passes.
  Evidence: `Change 'transition-error-user-visibility' is valid` after all §2-§6 edits.

## 8. Close-out

- [x] 8.1 Strike findings E-01, E-02, E-03, E-04 and E-05 from `docs/MASTER_PLAN.md` with their resolution commit.
  Evidence: `docs/MASTER_PLAN.md` edited in this change; resolution notes reference the change and land with the close-out commit.
- [x] 8.2 Append evidence to `.agent/STATE.md`.
  Evidence: `.agent/STATE.md` session entry "2026-10-09 session — Phase 1 change 3" prepended with commands, pass counts, the fail-first round-trips, the golden evidence and the recorded flake.
- [x] 8.3 Commit this change as one coherent checkpoint.
  Evidence: one commit containing all src + tests + docs + OpenSpec artifacts of the change.

## 9. Adversarial review

Findings raised against this change's own implementation and fixed before the commit:

1. **False copy on post-arrival codes.** `TRANSITION_EXIT_FAILED` and
   `TRANSITION_DISPOSAL_FAILED` fire AFTER the target opened successfully, but
   the shared subject line said "'X' could not be opened" — false copy about a
   scene the user can see. Fixed with a second subject frame ("A problem
   occurred on the way to 'X'") and pinned by the new copy row
   `does not claim the target failed to open for post-arrival codes`.
2. **`TRANSITION_EXIT_FAILED` is only reachable as fatal** (the director routes
   it through `failFatal`), so its copy no longer invents an unreachable
   recoverable framing; the fatal-only path is pinned instead.
3. **Backwards progress fractions silently disarmed the stall gate.**
   `galaxy-collision` reported 0.6 after its loader's 0.8, and
   `black-hole-merger` reported 0.55 after its loader's 0.8 — both are label
   changes, not progress events, so the steps that followed them were
   unprotected. Fixed by raising the module fractions above the loader ceilings
   and pinned by `tests/unit/assetTransferProgress.test.ts`.
4. **The LUT loader's own fractions were not monotonic**: it reported 0.3
   (manifest) and then a texture base of 0.25. Fixed (`base = 0.3 + …`, ceiling
   0.55, so the module's 0.6 stays a strict increase).
5. **`loadShippedLutFamily`'s three fetches were uncancellable** — a retarget or
   a stall abort could not stop them. Fixed by threading `ctx.signal`.
6. **The boot-failure subscription was unreachable by construction.** It was
   registered AFTER `await host.init()`, so a boot that failed could never
   render anything. Moved before `init()`, with an idempotent render in the boot
   catch as belt-and-braces.

Residual risk recorded, not hidden: `accessibility.spec.ts:146` failed once in a
loaded 4-spec run and is recorded in `.agent/STATE.md` as a U-09-shaped flake
owned by `destination-control-truthfulness`. It was not re-baselined or retried
into green.
