## Why

`AGENTS.md` states two rules the product currently breaks:

- "Do not expose a control that has no defined physical or visual semantics."
- "Scientific fidelity labels are contracts... MUST match runtime behavior."

A focused audit of all eight destinations and the product shell found four confirmed violations, each
a single line of code with a large blast radius:

1. **The AGN torus never renders after a zone change.** `quasarAgnModule.ts:873` evaluates
   `torusVolume.setVisible(this.state.torusVisible && this.activeZone === 'nuclear')` inside
   `applyStateToResources()`, which is called only from `prepare()` and `applyControlState()`. The
   zone machine in `update()` (`:699-701`) mutates `this.activeZone` and then calls
   `applyZoneVisibility()` — which sets only group visibility. So the torus's own flag is written
   against a *stale* zone and never corrected. Clicking "Nuclear" while in another zone makes the
   engine visible with no torus, permanently. The debug snapshot then reports `torusVisible` from raw
   *state* (true), so diagnostics actively contradict the frame.

2. **The Neutron Star `observerInclinationDeg` control has no effect.** It is written to state,
   runtime, the debug snapshot and the share serializer, and never reaches a uniform, a transform or
   the beam calculation. The rendered observer comes from `cameraRig.getOrbit()`
   (`neutronStarModule.ts:733-742`). The control is labelled with observer-frame physics semantics and
   is inert.

3. **The Neutron Star default preset's fidelity note contradicts the renderer.**
   `neutron-star/presets.ts:47-49` says "Visible surface is direct emission (no ray-bent limb yet)"
   and `physics.ts:24-26` says photon paths are "STRAIGHT lines here... The lensing DIRECT path for
   this destination arrives later via the shared LensingService pass." The shipped implementation is
   `surfaceLensingGpu.ts`, which loops a geodesic, bisects the material-surface crossing and branches
   on surface-hit/escaped — and uses neither `LensingService` nor a mesh. The user is told the
   opposite of what they are looking at.

4. **The `__ATLAS_APP__` test hook ships unguarded.** `atlasApp.ts:1277-1284` assigns it
   unconditionally, exposing `host` (including `forceContinuousRenderForTest()`), `navigate()` and
   `captureFrame()` — which performs a synchronous framebuffer readback — to any script on the page.
   `host.ts:777` documents that the forced-render entry point is "Not reachable from production UI",
   which is false of the shipped build. A gating precedent already exists in the same codebase
   (`statusPanel.ts:88`).

Five more confirmed defects in the same family, lower severity but the same root cause — a control
or a displayed value that does not agree with canonical state:

- Share `mode=` overwrites the share `e`/`b`/`bs`/`t=` values it is supposed to accompany
  (`atlasApp.ts:1021-1031` + `host.ts:941-948`).
- Deep-linked `?dc=` control payloads are applied to canonical state but not reflected in the panel
  for six of eight destinations, so the displayed control disagrees with state.
- The dynamic-resolution toggle and the Render-scale slider both mutate one field with no reflection,
  so two visible controls contradict each other.
- The timeline rate select permanently shows `0.25x` while the clock runs at `1x`;
  `setRateLabel` was written and never wired.
- Focus is destroyed on every destination switch and every panel rebuild, and a collapsed mobile
  drawer stays in the accessibility tree.

## What Changes

- **Make the AGN torus visibility a pure function of `state.torusVisible`.** Group-level zone gating
  already provides exclusivity.
- **Make the reported observer inclination agree with the rendered observer** — derive the reported
  value from the camera orbit, or drive the orbit from the control. One source of truth.
- **Correct the Neutron Star fidelity note and module header** to describe the shipped DIRECT
  surface-ray path, keeping the still-true omissions (Doppler, aberration, frame dragging,
  atmosphere).
- **Gate the test hook** behind a development/test opt-in.
- **Make every displayed control value equal its canonical state value**, including share
  application order, deep-linked control payloads, the paired resolution controls, and the rate
  control.
- **Preserve focus across rebuilds** and keep a collapsed drawer out of the accessibility tree.
- **Fix the smaller confirmed defects in the same family**: the AGN finiteness guard, the
  Galaxy-Collision cloud rebuild in a hidden mode, and the saturated temperature literal.

Non-goals, explicitly out of scope:

- No change to any physical model, equation, or preset default. Every fix here is about a control or
  a note agreeing with the model that already exists.
- No redesign of the panel, the destination selector, or the visual language.
- No change to any golden image as part of this change. If correcting a fidelity note or a control
  changes a rendered frame, that is a bug in the note, not the frame — the frame stays.
- No accessibility overhaul. This closes the specific confirmed defects; a full audit is a separate
  activity.

## Capabilities

### New Capabilities
- `destination-control-integrity`: the contract that every exposed control affects rendered or
  canonical state, that every displayed value equals its canonical value, that share and deep links
  round-trip, that declared fidelity notes describe the shipped model, and that debug/test
  instrumentation is not reachable in a production build.

### Modified Capabilities
- None. No archived baseline capability specifications exist yet
  (`openspec list --specs` reports none); `specification-baseline-hygiene` creates that baseline.
  Every requirement here is an ADDED requirement under the new `destination-control-integrity`
  capability.

## Impact

**Affected code**

- `src/phenomena/quasar-agn/quasarAgnModule.ts`, `src/phenomena/neutron-star/{neutronStarModule.ts,
  presets.ts, physics.ts}`, `src/phenomena/galaxy-collision/galaxyCollisionModule.ts`,
  `src/phenomena/compact-merger/compactMergerModule.ts`.
- `src/app/atlasApp.ts` — share application order, control reflection, focus preservation, hook
  gating.
- `src/ui/atlas/components.ts`, `src/ui/atlas/atlasPanel.css` — drawer accessibility state, slider
  value association, touch target.
- `src/app/testHooks.ts` — gate shape if the opt-in moves the hook registration.

**Affected tests**

- `tests/browser/atlas-navigation.spec.ts` — AGN torus visibility across a zone change; focus
  preservation; deep-linked control reflection.
- `tests/browser/accessibility.spec.ts` — drawer accessibility state; focus after rebuild.
- `tests/browser/quasar-agn*.spec.ts`, `neutron-star.spec.ts` — destination-level rows.
- `tests/browser/smoke.spec.ts` — a production build must not expose the hook.

**Affected documents**

- `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md`, `docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md` (the
  Neutron Star note), `docs/UI_UX.md`, `docs/UI_CONTROL_CATALOG.md`, `docs/UI_DESIGN_SYSTEM.md`.

**Dependencies**

- **Must be SEQUENCED after `transition-error-user-visibility`, not run in parallel.** Both changes
  edit `src/app/atlasApp.ts` (this one for control reflection, focus preservation and test-hook
  gating; that one to render the error surface). `docs/MASTER_PLAN.md` §7 makes that file
  single-owner. Running this change first would rebuild the panel and focus model around a shell
  that the next change then edits again. This change goes **second**.
- Independent of the other phase-1 changes in files; it owns the destination modules and the UI kit,
  which no other lane touches.

**Compatibility risk**

- The AGN torus fix changes a rendered frame for affected zone sequences. That is the point: the
  torus is documented, controllable and currently absent. Any affected golden must be re-captured
  with the justification that a documented control now has its documented effect.
- The test-hook gating removes `window.__ATLAS_APP__` from production builds. The Playwright harness
  reads it via `tests/browser/support/atlasHook.ts`, which runs against the preview build — so the
  opt-in must be enabled for that build. This is a build-configuration concern, not a test-only
  concern, and must be handled explicitly.
