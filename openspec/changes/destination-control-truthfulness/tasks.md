# Tasks — Destination control truthfulness

> **Scope note (2026-10-09, superseded at completion).** The change was first implemented as a
> focused slice covering the four findings that were user-visible, single-line and high
> blast-radius: **U-01** (AGN torus), **U-04** (test-hook gating), **U-09** (focus preservation) and
> **U-10** (collapsed drawer accessibility). The completion pass (this close-out) landed the
> remaining rows — **U-02** (Neutron-Star inclination binding), **U-03** (fidelity note), the
> share/control-reflection family (**U-05…U-08**), and the smaller confirmed fixes
> (**U-11…U-19**). Per-row evidence is recorded below.
>
> **Preservation note (2026-10-09) — from the archived `atlas-terminal-state-visibility`.**
> The remaining `src/app/atlasApp.ts` work in this change rebuilds `#panel` wholesale.
> That is exactly the path the session-terminal surfaces were placed outside of, so every
> `atlasApp.ts` edit in this change MUST (and does):
>
> 1. keep `.atlas-alert-region` and `.atlas-slowprep` **outside `#panel`**. They are created once as
>    siblings of the panel and are the only surfaces that survive a collapse, a rebuild and an
>    `inert` drawer. Moving either one into `#panel` re-creates the defect both changes exist to fix.
> 2. NOT clear the device-loss card when `transition.error` is null. The `deviceLossTerminalActive`
>    guard is what makes the card survive a post-loss navigation (whose public state reads null);
>    clearing on null hands the user a frozen canvas with no explanation.
> 3. NOT add a **Dismiss** action to the device-loss card. Dismissing the only explanation returns
>    the user to the frozen canvas; reload must remain its sole action.
>
> U-09's focus restore leaves focus-identity capture scoped to the shell root, since the card and
> the notice are part of that same subtree. All three properties were preserved by the completion
> pass: the device-loss and slow-preparation rows re-ran green in the full suite below.

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
- [x] 1.3 Add a Neutron Star test asserting the reported observer inclination equals the camera orbit polar angle after an orbit change. Confirm it FAILS before the fix.
  Evidence: **U-02.** `tests/browser/neutron-star.spec.ts` "the reported observer inclination equals the camera orbit polar angle after an orbit change" and "the observer-inclination control sets the camera rig polar angle". Fail-first confirmed by temporarily disabling ONLY the `update()` read-back: the first row fails (reported value held the preset seed while the rig polar had moved to 42°); with the read-back restored both rows pass.
- [x] 1.4 Add a browser row loading a deep-linked `dc=` URL and asserting the control displays the encoded value. Confirm it FAILS before the fix.
  Evidence: **U-06.** `tests/browser/atlas-navigation.spec.ts` "a deep-linked dc= payload is reflected in the destination control". Fail-first observed directly: before the fix set completed, the row failed with the slider displaying the build-time default (`Expected: "33", Received: "75"`) — twice, for two distinct reasons that the fix set removes: `parseFromUrl` keyed a `d=`-less `dc` payload to the DEFAULT destination (never applied), and the panel captured control values at build time only. With both fixed the row passes.
- [x] 1.5 Add an accessibility row asserting focus is not on the document body after a destination switch. Confirm it FAILS before the fix.
  Evidence: **U-09/U-10.** `focus is preserved across a destination switch` and `a collapsed control drawer leaves the accessibility tree` in `tests/browser/accessibility.spec.ts`. Fail-first confirmed both ways: with the restore removed, `focus must not fall back to <body>` fails; without `inert`, the drawer row fails.
- [x] 1.6 Add a share round-trip row with both `mode=` and a display value. Confirm it FAILS before the fix.
  Evidence: **U-05.** `tests/browser/atlas-navigation.spec.ts` "share mode= does not overwrite the encoded display values". Fail-first confirmed by temporarily restoring the PRE-FIX application order (sharedVisual before experience): the row fails — `setExperienceMode`'s cinematic display defaults clobber the encoded `e=1.35`/`b=0` values. With the order fixed (experience first) the row passes. The same row also surfaced and now pins the `role="switch"` contract on toggle rows (the switch was never announced as a switch).

## 2. AGN

- [x] 2.1 Remove the `activeZone` term from the torus `setVisible` call in `quasarAgnModule.ts`.
  Evidence: **U-01.** `setVisible(this.state.torusVisible)`. Group gating already provides the exclusivity, so the zone term was both redundant and the source of the staleness.
- [x] 2.2 Make the debug snapshot report effective torus visibility.
  Evidence: **U-01.** Already exposed as `volumeWork.torus.visible`; the defect was that it disagreed with `torusVisible`. Asserting the agreement is the regression protection.
- [x] 2.3 Apply the sibling finiteness-guard convention to the AGN time coordinate.
  Evidence: **U-16.** `quasarAgnModule.ts` `update()` now guards `ctx.time.physicalTime` with `Number.isFinite` (exact sibling convention) and falls back to the phase mapping; a non-finite physical time can no longer reach shader coordinates or the variability factor.
- [x] 2.4 Confirm the tests from 1.1 and 1.2 pass.
  Evidence: `npx playwright test quasar-agn.spec.ts --project=default --workers=1` → **14 passed**, including both U-01 rows and the pre-existing zone-navigation, control-persistence and tier-switch rows.

## 3. Neutron Star

- [x] 3.1 Bind `observerInclinationDeg` to the camera rig: a control change sets polar angle, and an orbit change updates the control and canonical state. A preset may seed the rig on enter only. Do not leave the control as a passive readout.
  Evidence: **U-02.** `neutronStarModule.ts` gained `applyControlState` (canonical CA5 channel) which writes the CAMERA RIG's polar angle (never a uniform), and `update()` reads the rig's polar angle back into runtime — the source of `serializeShareState` (canonical state) and the debug snapshot — held while an arrival ease is interpolating so a transient pose never masquerades as a chosen inclination. `src/app/atlasApp.ts` gained the live "Observer inclination" panel control (rig's achievable polar envelope 9°–171°). Fail-first per 1.3.
- [x] 3.2 Correct the `surface` preset's `fidelityNote` to describe the shipped direct surface-ray path.
  Evidence: **U-03.** `neutron-star/presets.ts` surface note now describes the per-pixel Schwarzschild null-geodesic path (`surfaceLensingGpu`), ray-bent limb and lensed background included.
- [x] 3.3 Correct the `physics.ts` module header to name `surfaceLensingGpu` rather than the shared lensing pass.
  Evidence: **U-03.** `physics.ts` header now states the rendered image comes from `surfaceLensingGpu.ts` (surface-hit vs escaped-background over integrated null geodesics) — not the shared LensingService pass and not a mesh.
- [x] 3.4 Preserve the still-true omitted effects (Doppler, aberration, frame dragging, atmosphere).
  Evidence: the corrected surface note and `PHENOMENA_IMPLEMENTATION.md` §2 / `SCIENTIFIC_FIDELITY.md` §6 all keep the omissions disclosed.
- [x] 3.5 Confirm the test from 1.3 passes.
  Evidence: both U-02 rows pass in the targeted run and in the full suite below.

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

- [x] 5.1 Apply `experience` before `sharedVisual` when decoding a share payload, so the more specific encoded value wins.
  Evidence: **U-05.** `atlasApp.ts` boot applies experience mode first, then the shared visual block; fail-first per 1.6 (pre-fix order fails the row).
- [x] 5.2 Move destination-control reflection from build time into the interface reflection tick, for all destinations.
  Evidence: **U-06.** New `liveSyncs` registry in `atlasApp.ts` runs per-tick (4 Hz) reflection closures for every destination-control row (compact-merger, tidal-disruption, black-hole-merger toggles, neutron-star inclination), the paired resolution controls (5.3) and the FOV slider (6.9); the black-hole observer rows were the first user of this pattern and now ride the same registry. Deep-link payloads, share state and module-side writes (NS orbit read-back) self-correct without a rebuild. The `dc=` payload is additionally keyed to the ROUTE destination when the query omits `d=` (the deep-link defect 1.4 surfaced).
- [x] 5.3 Retain handles for both resolution controls and reflect the shared underlying value in both.
  Evidence: **U-07.** `dynamicResolutionToggle` reflects `state.rendering.dynamicResolution`; `renderScaleSlider` reflects `host.renderScaleOverride ?? governor.renderScale`; both mutate the one override field and now always agree.
- [x] 5.4 Wire `transport.setRateLabel` from the timeline rate; relabel the control to describe the effective rate.
  Evidence: **U-08.** The tick calls `transport.setRateLabel(`${host.time.playbackRate}x`)`; the select is labelled "Playback speed multiplier" (the effective rate is the per-destination base rate × this multiplier).
- [x] 5.5 Fix the serialise/parse key mismatch so a serialised preset is readable.
  Evidence: **U-15.** `parseRoute` accepts the compact share key `p` as an alias (canonical `preset` wins when both present); `parseFromUrl` accepts `preset` as an alias. `tests/unit/routes.test.ts` pins both directions plus a full serialize→route-parse round trip.
- [x] 5.6 Ensure `?rm=1` is applied rather than parsed and discarded.
  Evidence: **U-13.** The boot share block calls `host.setReducedMotion(share.accessibility.reducedMotion)` when the key is present (it was previously parsed into canonical state and dropped — `setReducedMotion` had zero external callers).
- [x] 5.7 Confirm the tests from 1.4 and 1.6 pass.
  Evidence: both rows pass in the targeted run and in the full suite below.

## 6. Focus and accessibility state

- [x] 6.1 Give destination chips and controls stable identities.
  Evidence: **U-09.** `focusIdentityOf` derives (role-bearing tag, type, accessible name) from the live DOM — resolved from `aria-label`, `aria-labelledby`, the wrapping `<label>`, then text content. No new attributes or bookkeeping are introduced.
- [x] 6.2 Capture and restore focus across a panel rebuild, restoring only when focus was inside the rebuilt subtree.
  Evidence: **U-09.** Scoped to the shell ROOT, not `#panel`, because the control the user last touched is usually the destination chip — which `refreshNav()` rebuilds too. A capture taken after either `replaceChildren` has already lost focus to `<body>`, so the capture is taken BEFORE any destructive step; that ordering bug was found and fixed during implementation.
- [x] 6.3 Capture and restore the expanded/collapsed set of regions across a rebuild.
  Evidence: `atlasApp.ts` captures the per-title `aria-expanded` state of every panel section before `buildPanel()` and replays it after, through each section's own toggle handler (the one code path that changes openness). Sections not present before the rebuild keep their defaults.
- [x] 6.4 Prefer reflecting the observer-mode select through the existing pattern instead of forcing a rebuild.
  Evidence: the mode-select VALUE is reflected per tick through the shared reflection registry (`observerSync` pattern); a rebuild happens only when the MODE CHANGES, where the mode-specific row sets genuinely differ — reflecting a mode change without swapping those rows would leave stale controls on screen. This is the documented intent of the row.
- [x] 6.5 Set an explicit hidden/aria state on the panel when collapsed, covering the narrow-viewport drawer.
  Evidence: **U-10.** `panelElement.inert = !panelOpen` in `applyPanelVisibility`. On narrow viewports the drawer is translated off-canvas rather than `display: none`, so `inert` is what actually removes it from the a11y tree and tab order; `display:none` would break the slide transition.
- [x] 6.6 Fix the self-referencing `aria-labelledby` on collapsible regions.
  Evidence: **U-11.** `createCollapsibleSection` now labels the region from the section TITLE node (`titleId`); the region previously pointed `aria-labelledby` at its own id.
- [x] 6.7 Associate slider value badges with their inputs so units are obtainable.
  Evidence: **U-12.** The `.atlas-slider-value` badge carries an id wired into the slider's `aria-describedby` (alongside the description), so screen-reader users hear the formatted value and its unit.
- [x] 6.8 Bring the mode-switch option into the coarse-pointer touch-target rule.
  Evidence: `.atlas-mode-option` joins the `@media (pointer: coarse)` `min-height: var(--ctl-h-touch)` rule in `atlasPanel.css`.
- [x] 6.9 Align the FOV slider range with the canonical range and reflect the reset action.
  Evidence: **U-14.** The FOV slider spans `CAMERA_FOV_DEG_RANGE` (10°–150°, the state normalizer's clamp) instead of the contradicting 20–120, and reflects `host.camera.fov` per tick — the Reset-camera action's restored `fovDeg` shows up in the control.
- [x] 6.10 Confirm the test from 1.5 passes.
  Evidence: the accessibility rows pass in the targeted run and in the full suite below.

## 7. Smaller confirmed fixes in the same lane

- [x] 7.1 Early-return the Galaxy-Collision secondary population block when its count is zero.
  Evidence: **U-17.** `applyPhase()` now populates the 3,200-instance secondary cloud only while it is drawn (`secondaryCount > 0`); when hidden it defers and marks `secondaryPopulationStale`, and `update()` pays the deferred rebuild the moment the cloud becomes visible again (so a detail change without a phase change can never show a stale/zeroed cloud).
- [x] 7.2 Express the Compact-Merger star-tint temperature so the conversion is not silently saturated, with a comment on the helper's ceiling.
  Evidence: **U-18.** `STAR_TINT = kelvinToLinearRgb(4e4)` — expressed AT the helper's empirical-fit ceiling (identical output to the previously clamped 6×10⁵ K call) with a comment documenting why; no silent clamp remains.
- [x] 7.3 Fix the waveform cursor ordering so it is not one tick stale.
  Evidence: `waveformPanel.ts` `update()` records `lastTimeM` BEFORE `redraw()`, so the drawn cursor and the text readout show the same time (the cursor previously lagged one UI tick behind the readout).
- [x] 7.4 Remove the unescaped regular expression built from a descriptor title in the panel builder.
  Evidence: `atlasApp.ts` `presetLabel` now does a literal `startsWith`/`slice` prefix strip — the descriptor title is data, not a pattern.

## 8. Documentation

- [x] 8.1 Update `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md` and `docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md` for the corrected Neutron Star note.
  Evidence: both now name `surfaceLensingGpu.ts` as the shipped DIRECT renderer and record the note correction (U-03); the deliberate omissions stay disclosed.
- [x] 8.2 Record the observer-inclination source-of-truth decision in `docs/WORLD_FRAME.md` or the destination control catalogue.
  Evidence: `docs/cosmic-atlas/DESTINATION_CONTROL_CATALOG.md` "Observer inclination — source of truth (U-02)" section: the rig owns the observer direction; control↔rig bidirectional; preset seeds on enter only; control range = rig envelope.
- [x] 8.3 Update `docs/UI_UX.md`, `docs/UI_CONTROL_CATALOG.md` and `docs/UI_DESIGN_SYSTEM.md` for the reflection, focus and aria changes.
  Evidence: `UI_UX.md` "Value reflection and rebuild behaviour" section (U-05…U-09, 6.3, U-10); `UI_DESIGN_SYSTEM.md` component table corrected (region labelling U-11, badge association U-12, load-bearing `role=switch`, multiplier label U-08, touch-target 6.8); `UI_CONTROL_CATALOG.md` inclination semantics (U-02).
- [x] 8.4 Record the test-hook opt-in in `docs/CI_CD.md` section 6 so the suite's requirement is documented.
  Evidence: `CI_CD.md` §6 "Atlas test-hook opt-in (U-04)" — build-time `VITE_ATLAS_TEST_HOOKS=1` / `npm run build:e2e`, production artifact hook-free, webServer-owned e2e build.

## 9. Validation and evidence

Environment note: all browser gates on this host must run on the hardware-WebGPU channel (the
`msedge` default when `CI` is unset; `CI=1` silently switches to Playwright's bundled Chromium,
which has NO GPU here — software WebGL2 runs the heavy scenes at 1.6–2.3 s/frame and produces
spurious frame-budget timeouts that vanish on the hardware channel).

- [x] 9.1 `npm run check` green.
  Evidence: format/lint/typecheck clean; **57 files / 692 unit tests** green (one standalone-run
  `observerFrame` convergence row flaked once under concurrent load and passes 11/11 isolated and
  in every quiet run — the documented V-17 load-sensitivity, fixed structurally by
  `verification-gate-integrity`); build clean; `check-no-test-hook` ok.
- [x] 9.2 All new unit and browser rows from section 1 pass.
  Evidence: `tests/unit/temperatureRamp.test.ts` (U-19 shared ramp) and `tests/unit/routes.test.ts`
  (U-15/U-06 key agreement) green in the suite above; the four new browser rows (U-02 ×2, U-05,
  U-06) pass with fail-first verified in both directions where required.
- [x] 9.3 `npx playwright test atlas-navigation accessibility mobile-touch quasar-agn quasar-agn-v2 neutron-star --project=default` green.
  Evidence: **57 passed (8.1m)** at the hardware-WebGPU channel.
- [x] 9.4 `npx playwright test visual-goldens --workers=1` — record every changed row. Each change must be justified here with before/after evidence (for AGN: the torus is now present as documented; for NS: none expected). No row may be re-baselined without justification.
  Evidence: **43/43 passed — ZERO rows changed, no re-baselining.** Expected: the change is
  pixel-neutral (control reflection, note text, idempotent deferral with identical content,
  identical clamped tint output, DOM-only aria/role/label fixes).
- [x] 9.5 `npx playwright test cinematic-goldens --project=default` green, or the change justified.
  Evidence: **8/8 passed, no re-baselining.** One gate-parameter normalization (recorded in the
  spec header per MASTER_PLAN §9 rule 7): the per-row wall-clock budget `test.setTimeout(180_000)`
  → `300_000`. The heaviest row (CIN_BH_CLASSIC) measures ~175–228 s on this capable runner and
  timed out at 180 s deterministically under full-suite load before any comparison assertion ran;
  sibling heavy rows already use 300 s. Comparison thresholds, tolerances, settle-protocol counts
  and baselines are untouched; in-suite and standalone comparison metrics are byte-identical
  (meanAbsDelta 0.20056…, ssim 0.98944…).
- [x] 9.6 `npx playwright test --project=default` full suite green.
  Evidence: **306 passed / 1 skipped / 0 failed (24.3m)** — every pre-existing row green, the
  single documented skip intact, all goldens included in-suite.
- [x] 9.7 `npx playwright test --project=firefox` green.
  Evidence: **4 passed (1.0m)**.
- [x] 9.8 `openspec validate destination-control-truthfulness --type change --strict` still passes.
  Evidence: "Change 'destination-control-truthfulness' is valid".

## 10. Close-out

- [x] 10.1 Strike findings U-01 through U-19 from `docs/MASTER_PLAN.md` with their resolution commits. Do not strike L-02; this change does not retarget `src/shaders/diagnostic.ts`.
  Evidence: all U-rows struck in the register and the phase-1d table row updated; L-02 untouched.
- [x] 10.2 Append evidence to `.agent/STATE.md`.
  Evidence: the completion-pass session entry records the findings, fixes, fail-first proofs and gate results.
- [x] 10.3 Commit this change as one coherent checkpoint.
  Evidence: implementation commit + this close-out record.
