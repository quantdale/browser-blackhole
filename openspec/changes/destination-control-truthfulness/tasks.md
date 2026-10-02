# Tasks — Destination control truthfulness

## 0. Baseline

- [ ] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [ ] 0.2 Run `npm run check` and record the result.
- [ ] 0.3 Record the current AGN_* and NS_* golden results as before-evidence.
- [ ] 0.4 Confirm `openspec validate destination-control-truthfulness --type change --strict` passes.

## 1. Failing tests first

- [ ] 1.1 Add a module-level test: prepare the AGN module, change zone, update once, assert effective torus visibility follows the control. Confirm it FAILS before the fix.
- [ ] 1.2 Add an assertion that the AGN debug snapshot reports effective visibility rather than raw state. Confirm it FAILS before the fix.
- [ ] 1.3 Add a Neutron Star test asserting the reported observer inclination equals the camera orbit polar angle after an orbit change. Confirm it FAILS before the fix.
- [ ] 1.4 Add a browser row loading a deep-linked `dc=` URL and asserting the control displays the encoded value. Confirm it FAILS before the fix.
- [ ] 1.5 Add an accessibility row asserting focus is not on the document body after a destination switch, and that the observer-mode section stays expanded. Confirm it FAILS before the fix.
- [ ] 1.6 Add a share round-trip row with both `mode=` and a display value. Confirm it FAILS before the fix.

## 2. AGN

- [ ] 2.1 Remove the `activeZone` term from the torus `setVisible` call in `quasarAgnModule.ts`.
- [ ] 2.2 Make the debug snapshot report effective torus visibility.
- [ ] 2.3 Apply the sibling finiteness-guard convention to the AGN time coordinate.
- [ ] 2.4 Confirm the tests from 1.1 and 1.2 pass.

## 3. Neutron Star

- [ ] 3.1 Bind `observerInclinationDeg` to the camera rig: a control change sets polar angle, and an orbit change updates the control and canonical state. A preset may seed the rig on enter only. Do not leave the control as a passive readout.
- [ ] 3.2 Correct the `surface` preset's `fidelityNote` to describe the shipped direct surface-ray path.
- [ ] 3.3 Correct the `physics.ts` module header to name `surfaceLensingGpu` rather than the shared lensing pass.
- [ ] 3.4 Preserve the still-true omitted effects in the corrected note (Doppler, aberration, frame dragging, atmosphere).
- [ ] 3.5 Confirm the test from 1.3 passes.

## 4. Test hook gating (do this early; it can break the whole browser suite)

- [ ] 4.1 Introduce a build-time opt-in for the test hook, consumed at build time rather than runtime.
- [ ] 4.2 Set that opt-in in the Playwright `webServer` command in `playwright.config.ts` so the preview build keeps its hooks.
- [ ] 4.3 Immediately run ONE browser spec to confirm the suite still works. Do not defer this check.
- [ ] 4.4 Add an assertion that a production build built WITHOUT the opt-in exposes no hook global.
- [ ] 4.5 Confirm `host.ts`'s "not reachable from production UI" comment is now true.

## 5. Share and control reflection

- [ ] 5.1 Apply `experience` before `sharedVisual` when decoding a share payload, so the more specific encoded value wins.
- [ ] 5.2 Move destination-control reflection from build time into the interface reflection tick, for all destinations.
- [ ] 5.3 Retain handles for both resolution controls and reflect the shared underlying value in both.
- [ ] 5.4 Wire `transport.setRateLabel` from the timeline rate; relabel the control to describe the effective rate.
- [ ] 5.5 Fix the serialise/parse key mismatch so a serialised preset is readable.
- [ ] 5.6 Ensure `?rm=1` is applied rather than parsed and discarded.
- [ ] 5.7 Confirm the tests from 1.4 and 1.6 pass.

## 6. Focus and accessibility state

- [ ] 6.1 Give destination chips and controls stable identities.
- [ ] 6.2 Capture and restore focus across a panel rebuild, restoring only when focus was inside the rebuilt subtree.
- [ ] 6.3 Capture and restore the expanded/collapsed set of regions across a rebuild.
- [ ] 6.4 Prefer reflecting the observer-mode select through the existing pattern instead of forcing a rebuild.
- [ ] 6.5 Set an explicit hidden/aria state on the panel when collapsed, covering the narrow-viewport drawer.
- [ ] 6.6 Fix the self-referencing `aria-labelledby` on collapsible regions.
- [ ] 6.7 Associate slider value badges with their inputs so units are obtainable.
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
