# Tasks — Destination control truthfulness

> **Scope note (2026-10-09).** This change was implemented as a focused slice covering the four
> findings that are user-visible, single-line and high blast-radius: **U-01** (AGN torus), **U-04**
> (test-hook gating), **U-09** (focus preservation) and **U-10** (collapsed drawer accessibility).
> The remaining rows below — notably **U-02** (Neutron-Star inclination binding), **U-03** (fidelity
> note), the share/control-reflection family (U-05…U-08) and U-11…U-19 — are NOT done by this slice
> and are deliberately left unchecked. Each is either a two-way binding with real regression risk
> on the observer presets, a documentation change touching the Fidelity contract, or a distinct
> control-reflection refactor that deserves its own campaign rather than being folded in here.
> See `.agent/STATE.md` for the delivered evidence.

## 0. Baseline

- [x] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
  Evidence: HEAD `3c31f4f` (the committed transition-error-user-visibility close-out), node v24.3.0, npm 11.4.2, clean tree.
- [x] 0.2 Run `npm run check` and record the result.
  Evidence: exit 0 at the slice baseline; the change also runs `npm run check:no-test-hook` as its final step.
- [x] 0.3 Record the current AGN_* and NS_* golden results as before-evidence.
  Evidence: `AGN_RADIO_GALAXY` and all `NS_*` rows pass unchanged in the 43/43 scientific golden run at `3c31f4f`; the cinematic `CIN_AGN_NUCLEAR` row passes with `torusVisible: true` and `volumeWork.torus.visible: true`.
- [x] 0.4 Confirm `openspec validate destination-control-truthfulness --type change --strict` passes.
  Evidence: valid at HEAD.

## 1. Failing tests first

- [x] 1.1 Add a module-level test: change zone, assert effective torus visibility follows the control. Confirm it FAILS before the fix.
  Evidence: **U-01.** Two browser rows in `tests/browser/quasar-agn.spec.ts` — the AGN scene needs a live GPU context, so the observable is the module's own debug snapshot. Fail-first confirmed by removing ONLY the re-application call: `torus must return after re-entering nuclear` fails; with the fix both rows pass.
- [x] 1.2 Add an assertion that effective torus visibility agrees with the reported state. Confirm it FAILS before the fix.
  Evidence: **U-01.** The snapshot already carried both `torusVisible` (raw state) and `volumeWork.torus.visible` (effective). The rows assert the effective value equals the state across a zone change — exactly the pre-fix contradiction (state `true`, effective `false`).
- [ ] 1.3 Add a Neutron Star test asserting the reported observer inclination equals the camera orbit polar angle after an orbit change. Confirm it FAILS before the fix.
  Not done: **U-02** is outside this slice.
- [ ] 1.4 Add a browser row loading a deep-linked `dc=` URL and asserting the control displays the encoded value. Confirm it FAILS before the fix.
  Not done: **U-06** is outside this slice.
- [x] 1.5 Add an accessibility row asserting focus is not on the document body after a destination switch. Confirm it FAILS before the fix.
  Evidence: **U-09/U-10.** `focus is preserved across a destination switch` and `a collapsed control drawer leaves the accessibility tree` in `tests/browser/accessibility.spec.ts`. Fail-first confirmed both ways: with the restore removed, `focus must not fall back to <body>` fails; without `inert`, the drawer row fails.
- [ ] 1.6 Add a share round-trip row with both `mode=` and a display value. Confirm it FAILS before the fix.
  Not done: **U-05** is outside this slice.

## 2. AGN

- [x] 2.1 Remove the `activeZone` term from the torus `setVisible` call in `quasarAgnModule.ts`.
  Evidence: **U-01.** `setVisible(this.state.torusVisible)`. Group gating already provides the exclusivity, so the zone term was both redundant and the source of the staleness.
- [x] 2.2 Make the debug snapshot report effective torus visibility.
  Evidence: **U-01.** Already exposed as `volumeWork.torus.visible`; the defect was that it disagreed with `torusVisible`. Asserting the agreement is the regression protection.
- [ ] 2.3 Apply the sibling finiteness-guard convention to the AGN time coordinate.
  Not done: **U-16** is outside this slice.
- [x] 2.4 Confirm the tests from 1.1 and 1.2 pass.
  Evidence: `npx playwright test quasar-agn.spec.ts --project=default --workers=1` → **14 passed**, including both U-01 rows and the pre-existing zone-navigation, control-persistence and tier-switch rows.

## 3. Neutron Star

- [ ] 3.1 Bind `observerInclinationDeg` to the camera rig: a control change sets polar angle, and an orbit change updates the control and canonical state. A preset may seed the rig on enter only. Do not leave the control as a passive readout.
  Not done: **U-02** is outside this slice.
- [ ] 3.2 Correct the `surface` preset's `fidelityNote` to describe the shipped direct surface-ray path.
  Not done: **U-03** is outside this slice.
- [ ] 3.3 Correct the `physics.ts` module header to name `surfaceLensingGpu` rather than the shared lensing pass.
  Not done: **U-03** is outside this slice.
- [ ] 3.4 Preserve the still-true omitted effects in the corrected note (Doppler, aberration, frame dragging, atmosphere).
  Not done: **U-03** is outside this slice.
- [ ] 3.5 Confirm the test from 1.3 passes.
  Not done: blocked by 3.1.

## 4. Test hook gating (do this early; it can break the whole browser suite)

- [x] 4.1 Introduce a build-time opt-in for the test hook, consumed at build time rather than runtime.
  Evidence: **U-04.** `vite.config.ts` reads `VITE_ATLAS_TEST_HOOKS === '1'` and substitutes `__ATLAS_TEST_HOOKS_OPT_IN__` via `define`. Verified in both directions: a plain `npm run build` contains neither the hook assignment nor the unsubstituted define; `npm run build:e2e` contains `window.__ATLAS_APP__={host:…}`.
- [x] 4.2 Set that opt-in in the Playwright `webServer` command in `playwright.config.ts` so the preview build keeps its hooks.
  Evidence: **U-04.** The webServer now runs `npm run build:e2e && npm run preview …` and owns its build, instead of reusing whatever `dist/` happened to hold. That also removes the stale-artifact failure mode where a plain production build strips every hook and the whole suite fails at once.
- [x] 4.3 Immediately run ONE browser spec to confirm the suite still works. Do not defer this check.
  Evidence: `npx playwright test smoke production-hygiene --project=default --workers=1` → **7 passed**, run immediately after the gating landed and before any other browser row was touched.
- [x] 4.4 Add an assertion that a production build built WITHOUT the opt-in exposes no hook global.
  Evidence: **U-04.** `scripts/check-no-test-hook.mjs` asserts the production property and runs as the final step of `npm run check`. `tests/browser/production-hygiene.spec.ts` asserts the invariant that holds for every bundle (define always substituted) plus that the hook IS reachable in the e2e bundle the suite runs against — so a lost opt-in fails loudly instead of silently disabling the suite.
- [x] 4.5 Confirm `host.ts`'s "not reachable from production UI" comment is now true.
  Evidence: **U-04.** `forceContinuousRenderForTest()` is only reachable through the hook, which a plain `npm run build` does not install; `scripts/check-no-test-hook.mjs` gates that artifact.

## 5. Share and control reflection

- [ ] 5.1 Apply `experience` before `sharedVisual` when decoding a share payload, so the more specific encoded value wins.
  Not done: **U-05** is outside this slice.
- [ ] 5.2 Move destination-control reflection from build time into the interface reflection tick, for all destinations.
  Not done: **U-06** is outside this slice.
- [ ] 5.3 Retain handles for both resolution controls and reflect the shared underlying value in both.
  Not done: **U-07** is outside this slice.
- [ ] 5.4 Wire `transport.setRateLabel` from the timeline rate; relabel the control to describe the effective rate.
  Not done: **U-08** is outside this slice.
- [ ] 5.5 Fix the serialise/parse key mismatch so a serialised preset is readable.
  Not done: **U-15** is outside this slice.
- [ ] 5.6 Ensure `?rm=1` is applied rather than parsed and discarded.
  Not done: **U-13** is outside this slice.
- [ ] 5.7 Confirm the tests from 1.4 and 1.6 pass.
  Not done: blocked by 5.1/5.2.

## 6. Focus and accessibility state

- [x] 6.1 Give destination chips and controls stable identities.
  Evidence: **U-09.** `focusIdentityOf` derives (role-bearing tag, type, accessible name) from the live DOM — resolved from `aria-label`, `aria-labelledby`, the wrapping `<label>`, then text content. No new attributes or bookkeeping are introduced.
- [x] 6.2 Capture and restore focus across a panel rebuild, restoring only when focus was inside the rebuilt subtree.
  Evidence: **U-09.** Scoped to the shell ROOT, not `#panel`, because the control the user last touched is usually the destination chip — which `refreshNav()` rebuilds too. A capture taken after either `replaceChildren` has already lost focus to `<body>`, so the capture is taken BEFORE any destructive step; that ordering bug was found and fixed during implementation.
- [ ] 6.3 Capture and restore the expanded/collapsed set of regions across a rebuild.
  Not done: no confirmed finding requires it yet.
- [ ] 6.4 Prefer reflecting the observer-mode select through the existing pattern instead of forcing a rebuild.
  Not done: outside this slice.
- [x] 6.5 Set an explicit hidden/aria state on the panel when collapsed, covering the narrow-viewport drawer.
  Evidence: **U-10.** `panelElement.inert = !panelOpen` in `applyPanelVisibility`. On narrow viewports the drawer is translated off-canvas rather than `display: none`, so `inert` is what actually removes it from the a11y tree and tab order; `display:none` would break the slide transition.
- [ ] 6.6 Fix the self-referencing `aria-labelledby` on collapsible regions.
  Not done: **U-11** is outside this slice.
- [ ] 6.7 Associate slider value badges with their inputs so units are obtainable.
  Not done: **U-12** is outside this slice.
- [ ] 6.8 Bring the mode-switch option into the coarse-pointer touch-target rule.
- [ ] 6.9 Align the FOV slider range with the canonical range and reflect the reset action.
- [ ] 6.10 Confirm the test from 1.5 passes.

## 7. Smaller confirmed fixes in the same lane

- [ ] 7.1 Early-return the Galaxy-Collision secondary population block when its count is zero.
- [ ] 7.2 Express the Compact-Merger star-tint temperature so the conversion is not silently saturated, with a comment on the helper's ceiling.
- [ ] 7.3 Fix the waveform cursor ordering so it is not one tick stale.
- [ ] 7.4 Remove the unescaped regular expression built from a descriptor title in the panel builder.

## 8. Documentation

- [ ] 8.1 Update `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md` and `docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md` for the corrected Neutron Star note.
- [ ] 8.2 Record the observer-inclination source-of-truth decision in `docs/WORLD_FRAME.md` or the destination control catalogue.
- [ ] 8.3 Update `docs/UI_UX.md`, `docs/UI_CONTROL_CATALOG.md` and `docs/UI_DESIGN_SYSTEM.md` for the reflection, focus and aria changes.
- [ ] 8.4 Record the test-hook opt-in in `docs/CI_CD.md` section 6 so the suite's requirement is documented.

## 9. Validation and evidence

- [ ] 9.1 `npm run check` green.
- [ ] 9.2 All new unit and browser rows from section 1 pass.
- [ ] 9.3 `npx playwright test atlas-navigation accessibility mobile-touch quasar-agn quasar-agn-v2 neutron-star --project=default` green.
- [ ] 9.4 `npx playwright test visual-goldens --workers=1` — record every changed row. Each change must be justified here with before/after evidence (for AGN: the torus is now present as documented; for NS: none expected). No row may be re-baselined without justification.
- [ ] 9.5 `npx playwright test cinematic-goldens --project=default` green, or the change justified.
- [ ] 9.6 `npx playwright test --project=default` full suite green.
- [ ] 9.7 `npx playwright test --project=firefox` green.
- [ ] 9.8 `openspec validate destination-control-truthfulness --type change --strict` still passes.

## 10. Close-out

- [ ] 10.1 Strike findings U-01 through U-19 from `docs/MASTER_PLAN.md` with their resolution commits. Do not strike L-02; this change does not retarget `src/shaders/diagnostic.ts`.
- [ ] 10.2 Append evidence to `.agent/STATE.md`.
- [ ] 10.3 Commit this change as one coherent checkpoint.
