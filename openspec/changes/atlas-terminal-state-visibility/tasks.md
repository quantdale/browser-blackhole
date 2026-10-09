# Tasks — Atlas terminal state visibility

> **Status (2026-10-09).** Sections 1–4 implemented and validated; §5 evidence is below.
> The file-ownership gates in §1 were confirmed BEFORE any edit: the
> `destination-control-truthfulness` scoped slice had landed (`87deee3`, close-out
> `661f6d5`) so `src/app/atlasApp.ts` was free, and `shared-renderer-service-lifecycle`
> was still at 0/59 tasks and therefore not an active writer of
> `src/atlas/host.ts` / `src/atlas/TransitionDirector.ts`.

## 1. Ownership gate

- [x] 1.1 `destination-control-truthfulness` released `src/app/atlasApp.ts` before this change
  took it. Evidence: its scoped slice (U-01, U-04, U-09, U-10) is committed at
  `87deee3` with the close-out at `661f6d5`; that change's `tasks.md` scope note
  marks U-02, U-03 and U-05…U-19 as explicitly out of the slice, so no lane was
  holding unfinished `atlasApp.ts` edits when this change started.
- [x] 1.2 `shared-renderer-service-lifecycle` was NOT the active writer of
  `src/atlas/host.ts` or `src/atlas/TransitionDirector.ts`. Evidence: MASTER_PLAN
  §7 row 2 places that change after 1b and 1c, both of which had landed;
  `openspec list` reported it at 0/59 tasks and `git status` was clean apart from
  this change. Both files were therefore free, and this change edited them
  directly instead of landing only the shell half.

## 2. Terminal graphics surface

- [x] 2.1 Failing-then-passing browser row: `device-loss.spec.ts` →
  "device loss is perceivable with the control panel collapsed". Collapses the
  drawer by keyboard, injects loss through `simulateDeviceLoss()`, and asserts the
  card is visible, outside `#panel`, NOT inside an inert subtree, with a
  keyboard-operable **Reload page** action. **Fail-first verified:** before the
  implementation all three new terminal-surface rows failed with
  `waiting for locator('.atlas-alert') — element(s) not found` (the card did not
  exist in the DOM at all); the three pre-existing M11-03 rows kept passing.
- [x] 2.2 Failing-then-passing browser row: "device loss survives a panel rebuild
  and is not a destination retry". After loss it navigates (rebuilding nav and
  panel wholesale), then asserts the card is still visible, still names the loss,
  and offers no **Try again** and no **Dismiss**. Same fail-first run as 2.1.
- [x] 2.3 `renderDeviceLossTerminal()` in `src/app/atlasApp.ts` renders the card
  in the existing outside-panel `.atlas-alert-region` from the single `onFatal`
  subscription, using `buildUnsupportedMessage(host.debugInventory().backend,
  'GPU_DEVICE_LOST')` for title and detail — the same authored remediation copy
  the boot-failure surface uses, not a second vocabulary. Reload is the only
  action and there is no dismiss. It sets `deviceLossTerminalActive`, which stops
  the UI tick from clearing the surface when the published transition error later
  reads null — which is exactly the state a post-loss navigation leaves behind.
- [x] 2.4 The `.atlas-status` mirror is kept: the existing `unsubscribeFatal`
  status write is unchanged, and `device-loss.spec.ts` went **8/8** including
  "navigation after device loss does not resurrect a dead renderer".
- [x] 2.5 "the terminal surface states the meaning in text and does not move the
  pinned chrome" reads `--atlas-topbar-h` and `--atlas-panel-w` before and after
  showing the surface and asserts both are unchanged, and asserts the card's own
  text carries the whole meaning (title, "cannot continue rendering", "reload") —
  nothing conveyed by colour alone.

## 3. Slow-preparation notice

- [x] 3.1 Failing browser row: `tests/browser/slow-preparation.spec.ts` → "a
  slow open is announced without claiming the destination failed". Holds the
  galaxy-collision lazy chunk 3.5 s through the HTTP layer (the production
  condition — a slow network), collapses the panel, and asserts the notice names
  **Galaxy Collision**, does NOT say fail/could not/cannot/error, uses
  `role="status"` rather than the assertive alert channel, leaves the
  `.atlas-alert-region` hidden, is outside `#panel` and outside its inert
  subtree, and that the previous destination is still live. **Fail-first
  verified:** all three rows failed once the notice rendering was disabled.
- [x] 3.2 Failing coverage for all three clearing rules:
  - *Unit* (`transitionFailurePublication.test.ts`, new `slow-preparation
    notice` describe): notice set past the slow-load threshold; cleared by a
    newer request so it cannot name a superseded destination; cleared by a
    published `TRANSITION_PREPARE_FAILED` rather than competing with it; cleared
    when the destination becomes interactive. **Fail-first verified:** with the
    `getPublicState()` publication stubbed out, 4/4 of these rows failed and the
    10 pre-existing rows still passed.
  - *Browser* ("the notice is cleared when the destination becomes interactive"
    and "a newer request takes the notice over from the superseded destination"
    — the latter records every text the region ever shows via a MutationObserver
    and asserts no post-retarget entry names Galaxy Collision).
- [x] 3.3 The director publishes the notice on its existing public state
  (`TransitionPublicState.slowLoad`, set in `maybeEmitSlowLoad()` and cleared in
  the same places `publicError` clears). The shell reads it on the `host.state`
  tick it already runs. **No second status bus was added** and no private director
  field is polled. The host's existing `director.onStatus` subscription now
  handles `slow-load` too (it previously dropped the event entirely), keeping the
  debug-diagnostics console line rather than the silent gap.
- [x] 3.4 `.atlas-slowprep` is a separate absolutely positioned `role="status"`
  region, sibling of the alert region, hidden by default, and NOT inside `#panel`.
  It is hidden in the same tick as a published preparation error, as a device-loss
  alert, and when the notice is cleared.

## 4. Occluding overlay

- [x] 4.1 Reproduced device loss during BOTH `outgoing` and `hyperspace`. Method:
  an in-page rAF watcher polls `host.state.atlas.transition.phase` and calls
  `host.simulateDeviceLoss()` the instant the target phase opens, so no round-trip
  latency lets the phase advance past the window. Measured the presented frame
  (16×16 grid over `#viewport`), `destinationOccluded`, and the DOM state of the
  terminal card. **Recorded result — the OCRUSION SUSPICION IS NOT REPRODUCED:**
  - `outgoing`: `destinationOccluded=false`, presented frame 972×727,
    near-black fraction 0.50, 69 distinct colours; `alertRegionVisible=true`,
    `alertInsidePanel=false`, `alertInInertSubtree=false`, and
    `document.elementFromPoint(card centre)` returned **`atlas-alert-body`** — the
    card is the TOPMOST element at its own centre.
  - `hyperspace`: `destinationOccluded=true` (the envelope is mathematically
    opaque there by design), near-black fraction 0.04, 240 distinct colours; the
    card was again the topmost element at its centre, outside `#panel`, and
    outside any inert subtree.
  So in both phases the held overlay never covers the terminal surface: the card
  draws above the frozen canvas. `renderOverlay`'s early return pre-init/device
  loss path holds the last valid texture, but that hold is under the DOM surface.
- [x] 4.2 The occlusion was NOT confirmed, so per the design **overlay rendering
  is left unchanged** — `renderOverlay` and `applyOverlayEnvelope` are untouched,
  and `git diff` on the director shows only the new `slowLoadNotice` field and its
  lifecycle. The negative result is recorded IN THIS FILE (4.1) and pinned by two
  permanent rows in `device-loss.spec.ts` ("the terminal surface stays on top of
  the held overlay during outgoing/hyperspace"), which fail if a later change
  buries the card under the canvas or moves it into the panel.
- [x] 4.3 No golden frame changed, because no overlay code changed. Recorded as
  "not required" rather than run-on-principle; see 5.3 for the reasoning plus the
  positive evidence that was gathered instead. **No golden was re-baselined.**

## 5. Validation

- [x] 5.1 `npm run check`: **exit 0** — format, lint, typecheck,
  **55 files / 681 unit tests**, build, and the production test-hook gate. One
  repair was made on the way: the pre-existing real-time frame loop in
  `transitionFailurePublication.test.ts` awaited ~400 × 16 ms sleeps (~6.4 s)
  against a 5 s default budget, so it failed under the full-suite load this change
  added. Nothing in the post-prepare phases reads the wall clock, so the loop now
  pumps `update()` directly through a new deterministic `pumpMotion()` helper —
  the same 14 rows pass in 2.8 s instead of 12 s and the row is no longer
  load-dependent.
- [x] 5.2 `device-loss.spec.ts` **8/8** (3 pre-existing M11-03 rows + 3 terminal
  rows + 2 overlay rows). Combined run with the rows that cover the alert region
  and the surfaces this change touches —
  `atlas-navigation accessibility mobile-touch slow-preparation production-hygiene
  --project=default --workers=1` — **31/31 passed (3.9m)**, including every
  pre-existing transition-failure row, the collapsed-panel failure row, the mobile
  drawer row, and both U-04 hygiene rows.
- [x] 5.3 Goldens: `visual-goldens --project=default --workers=1` → **43/43 passed (6.8m)**, no
  re-baselining and no golden-update prompt. The goldens were run rather than
  waived even though 5.3's own criterion (overlay code changed) did not apply,
  because this change adds DOM to the shell the goldens capture; the two new
  regions are `position: absolute` and `display: none` when hidden, and the
  `#viewport` box is unchanged. `cinematic-goldens` were **not** run — they grade
  cinematic motion/overlay sequences, no overlay or motion code changed (4.2), and
  the scientific goldens cover the same scenes at the same pinned geometry.
  **No golden was re-baselined.**
- [x] 5.4 `openspec validate atlas-terminal-state-visibility --strict`:
  **valid**.
