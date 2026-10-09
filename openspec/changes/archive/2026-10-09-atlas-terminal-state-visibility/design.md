## Context

See `proposal.md` for why this change exists. The constraints that shape the approach:

- Transition failures already render in `.atlas-alert-region`, which is a sibling of `#panel`, absolutely positioned, `hidden` by default, and outside the panel rebuild. That is the pattern to extend, not a new visual language.
- Device loss already latches in the host (`isFatalDeviceLoss`, `simulateDeviceLoss()`) and the shell mirrors a status string into `.atlas-status`. That node is the first child of `#panel`. Collapsing the panel sets `inert`, so the status line leaves the accessibility tree. `tests/browser/device-loss.spec.ts` currently asserts only that status line.
- `buildUnsupportedMessage` already has authored `GPU_DEVICE_LOST` copy and zero product callers on the post-boot loss path. Boot failures use it. Session loss does not.
- `TransitionDirector` emits `slow-load` status. `host.ts` subscribes to `onStatus` and handles only `route-commit`. The shell never reads the event.
- `renderOverlay` returns immediately when the renderer is null and the comment says to hold the last overlay. Whether that hold stays fully opaque across device loss is not yet reproduced. Treat that as a gated check, not as a settled defect.
- `docs/MASTER_PLAN.md` §7 gives `src/app/atlasApp.ts` to `destination-control-truthfulness` until that change releases it, and gives `host.ts` / `TransitionDirector.ts` / the kernel to `shared-renderer-service-lifecycle` once that lane starts. This change must not take those files while another lane owns them.
- Pinned chrome: topbar 73px and panel width at the golden viewport. Status UI must not change those tokens.

## Goals / Non-Goals

**Goals:**

- One terminal graphics surface that remains perceivable when the panel is collapsed, inert, or rebuilt.
- One slow-preparation notice that names the in-flight destination and gets out of the way when the attempt ends.
- A recorded yes/no on the opaque-overlay suspicion before any overlay code changes.
- Keep the existing device-loss latch, the status-line mirror, and the current fatal-vs-recoverable distinction.

**Non-Goals:**

- No second remediation vocabulary, no automatic device recovery, no dismiss control on the terminal graphics surface.
- No panel, token, or destination-selector redesign.
- No edit to U-02 through U-19, reduced-motion URL application, or physics.
- No golden re-baseline for showing or hiding an absolutely positioned notice.

## Decisions

### D1 — Reuse the outside-panel alert for device loss; keep the status line as a mirror

**Decision.** On fatal device loss, render the existing alert region with the fatal card treatment: authored title and detail from `buildUnsupportedMessage(backend, 'GPU_DEVICE_LOST')`, code line, and a single primary **Reload page** action. Continue writing the current status string so `device-loss.spec.ts` stays true. Do not add Dismiss. Dismissing the only explanation would return the user to the frozen canvas this change exists to prevent.

**Rationale.** The transition-error change already proved this region survives collapse and rebuild and does not move golden geometry. A new modal or a panel-only message would reintroduce the defect.

**Rejected.** Putting the authored copy only in `.atlas-status`. That is the current bug. Replacing the status line and deleting the existing assertions. Those assertions still describe a true mirror.

### D2 — Slow-load is a polite notice, not an alert

**Decision.** Add a second absolutely positioned region, sibling of the alert, `role="status"`, hidden by default. The host forwards director `slow-load` events onto a small public snapshot the shell already polls or subscribes to. The notice text names the destination and does not say the open failed. Hide it when the attempt completes, is superseded, or a preparation error is published. Do not put this notice inside `#panel`.

**Rationale.** `role="alert"` is already the failure channel. A slow open is not a failure; the stall requirement already turns a true hang into an alert. Sharing one assertive region would announce "still opening" as an error, or would force the failure alert to change role.

**Rejected.** Logging the existing `emitStatus` and calling that user-visible. The host already drops the event. Also rejected: a progress modal that blocks the previous destination. The previous scene must stay available.

### D3 — Overlay hold is a reproduction gate, not a preset fix

**Decision.** Before editing `renderOverlay`, add a test or a recorded probe that injects device loss while the director is in `outgoing` or `hyperspace` and reads the overlay opacity / visibility. If the overlay remains an unexplained full-screen occlusion and the new terminal surface is hidden behind it, set the overlay alpha to 0 on the fatal-loss path and do not keep presenting it. If the probe shows the canvas is not left occluded, record the steps and stop. Do not retune streak speed, hyperspace style, or reduced-motion scale.

**Rationale.** The source comment admits a hold, but a hold of a transparent or already-decayed overlay is not a user-facing defect. The spec forbids changing overlay rendering to manufacture a difference.

**Rejected.** Always clearing the overlay on any null renderer. That could hide a legitimate pre-init frame and is wider than the reproduced case.

### D4 — File ownership is a start gate, not a design fork

**Decision.** Implementation starts only when `destination-control-truthfulness` no longer has unfinished edits to `src/app/atlasApp.ts`. Director and host edits start only when `shared-renderer-service-lifecycle` is not the active writer of those files. If that lane is active, land the shell surface against the public host API that already exists (`onFatal`, `isFatalDeviceLoss`) and defer the slow-load publication and overlay probe until the file is free. Do not create a parallel host.

**Rationale.** §7 exists because the last two shell changes rewrote the same file. A UX change that races them will not be reviewable.

**Rejected.** Waiting to write this change until every later phase finishes. The gap is user-visible now; the wait is only for the exclusive files.

### D5 — Geometry and motion

**Decision.** Both surfaces use the existing absolute alert positioning. No change to `--atlas-topbar-h` or `--atlas-panel-w`. Notices appear and disappear without depending on the hyperspace streak animation. `prefers-reduced-motion` styling already in the panel CSS applies if a transition is added; do not add a motion-only explanation.

## Risks / Trade-offs

- **[Two live regions compete]** A slow-load status and a fatal alert can both be in the DOM. → Mitigation: publishing a preparation error or a device-loss alert hides the slow-load notice in the same tick. Device loss wins over slow-load.
- **[Existing device-loss tests only see the status line]** A shell that updates the alert and forgets the status string fails the current suite. → Mitigation: D1 keeps the mirror. New rows assert the outside-panel surface with the panel collapsed; they do not replace the old rows.
- **[False overlay fix]** Clearing the overlay without a reproduced occlusion changes a cinematic frame for no user benefit and may force a golden update. → Mitigation: D3. No golden update unless a reproduced overlay correction changes a captured frame, and then only that frame, with before/after evidence in this design's implementation notes.
- **[Serialization stall]** Phase 2 may own `host.ts` when this change is ready to implement. → Mitigation: the shell half can land on `onFatal` alone. Slow-load forwarding waits. Do not copy director state into the shell by polling private fields.
- **[4 Hz or rAF lag]** If the shell reads slow-load from the frame tick, the notice can lag one frame. → Mitigation: acceptable. Do not add a second rAF loop.

## Migration Plan

No data migration and no persisted schema change. The product is a static bundle. Rollback is reverting the change commit. Deploy is the next static build. Do not feature-flag the terminal surface: a lost device with the surface compiled out is the bug.

Implementation order:

1. Confirm file ownership. Stop if `atlasApp.ts` or, for the director half, `host.ts` / `TransitionDirector.ts` is still exclusively owned.
2. Failing browser row: collapse the panel, inject device loss, assert the outside-panel terminal surface and the reload action. The existing status-line rows must still pass.
3. Wire the fatal alert from `onFatal`, using `buildUnsupportedMessage`.
4. Failing row or unit test: a slow-load event becomes a visible notice and clears on success, supersession, and published failure.
5. Forward `slow-load` from the existing director subscription. Do not add a second status bus.
6. Probe the overlay hold. Fix only if reproduced.
7. `npm run check`, `device-loss.spec.ts`, the navigation/accessibility rows that cover the alert region, and the golden suites if any overlay code changed. Otherwise goldens are a non-goal.

## Open Questions

None. The overlay outcome is a gated task, not an unresolved product decision.
