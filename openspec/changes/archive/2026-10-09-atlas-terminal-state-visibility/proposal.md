# Proposal — Atlas terminal state visibility

Change ID: `atlas-terminal-state-visibility`
Status: **COMPLETE — implemented at `bbf66ea` and archived.** All 18 tasks closed with evidence
in `tasks.md` §1–§5; the capability is now the baseline spec
`openspec/specs/atlas-terminal-state-visibility/spec.md`. Corrections land in a new change.

## Why

A lost graphics device and a slow destination open can still leave the user looking at a frozen canvas with no explanation. Transition failures already have an alert outside the collapsible panel. Device loss does not: the shell writes a status string into `#panel`, which is rebuilt on every destination change and removed from the accessibility tree when collapsed. Slow-load events are emitted by the transition director and then ignored, so the user gets no "still opening" state before a stall becomes an error. A device loss during the outgoing overlay is also an unverified way to freeze that overlay opaque.

This is the highest-value user-facing gap that is not already owned by `destination-control-truthfulness`. That change owns lying controls and fidelity notes. This change does not redesign the instrument, add a destination, or restate those requirements.

## What Changes

- Present session-terminal graphics-device loss outside the panel's hiding subtree, using the existing authored `GPU_DEVICE_LOST` remediation copy, a reload action, and an assertive text announcement. The panel status line may mirror it; it SHALL NOT be the only surface.
- Present slow destination preparation to the user before the stall failure, naming the destination, without moving the pinned shell geometry. Clear that notice when preparation completes, is superseded, or becomes a published transition error.
- Verify whether device loss during `outgoing` or `hyperspace` leaves the transition overlay frozen opaque. If confirmed, the overlay SHALL NOT remain the only thing on screen: the terminal surface appears, and the overlay does not keep an unexplained full-screen occlusion. If not confirmed, record the evidence and do not change overlay rendering to force a visual difference.
- Do not add controls, restyle the console, change topbar height or panel width, or alter physics, presets, or golden baselines unless an independently validated overlay correction requires a justified re-capture.

## Capabilities

### New Capabilities

- `atlas-terminal-state-visibility`: session-terminal device loss and in-progress slow preparation are perceivable, actionable, and not trapped in the collapsible panel. An occluding transition overlay cannot outlive a lost device without that terminal surface.

### Modified Capabilities

- None. `atlas-error-reporting` is a delta inside the still-unarchived `transition-error-user-visibility` change, not a baseline spec under `openspec/specs/`. This change does not weaken that delta. It closes the device-loss and slow-load presentation gap that delta's implementation did not cover.

## Impact

- `src/app/atlasApp.ts` — terminal and slow-load presentation. Exclusive to `destination-control-truthfulness` until that change releases the file. This change does not start editing it before then.
- `src/atlas/host.ts` and `src/atlas/TransitionDirector.ts` — publish slow-load to the shell, and the overlay hold on a null renderer. Those files are also claimed by `shared-renderer-service-lifecycle`. One writer at a time; this change does not run in parallel with that lane on those files.
- `src/atlas/hostStatus.ts` — reuse `GPU_DEVICE_LOST` copy. Do not invent a second remediation vocabulary.
- `src/ui/atlas/atlasPanel.css` — only if the existing alert region cannot host the new states without a geometry change. No change to `--atlas-topbar-h` or `--atlas-panel-w`.
- Browser tests for collapsed-panel device loss, slow-load announcement, and the overlay suspicion. No golden re-baseline as part of the status surface itself.

Out of scope: U-02 through U-19, reduced-motion URL wiring (`U-13`), panel redesign, Spatial Explorer, legacy-shell removal, and automatic GPU recovery.
