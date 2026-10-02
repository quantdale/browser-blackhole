# Design — Transition error user visibility

## Context

`docs/FAILURE_RECOVERY.md` §3 already states the contract this change implements: messages must say
what failed, whether the app can continue, the active fallback/degraded mode, and one useful
remediation; and §3's closing rule is "do not dump WGSL/stack traces into ordinary UI". The
repository also already has a remediation message builder, `buildUnsupportedMessage` in
`src/atlas/hostStatus.ts:497`, that the product shell never calls.

The gap is a layering accident. When the Cosmic Atlas shell replaced the M0 shell, the new status
path was written against `InitStatusTracker` (boot/fatal) and never grew a transition channel. The
error lives in the director because that is where it is produced, and the director's public state
was defined before anyone needed to render an error from it.

## Goals / Non-Goals

**Goals**

- Make the transition error a published part of the public contract.
- Give the product route a real terminal-UX surface that satisfies `docs/FAILURE_RECOVERY.md` §3.
- Keep the failure recoverable: the user must be able to stay where they are and try again.

**Non-Goals**

- Not a transition-choreography change. The director's phases, the occlusion point and the arrival
  ramp are untouched.
- Not a device-loss policy change. That contract is locked and already correct.
- Not a fetch-retry design. We make the failure visible and actionable; we do not add retry
  semantics to `loadLutFamily`/`loadGc1Dataset`, which are correctly fail-closed.
- Not a panel redesign.

## Decisions

### D1 — Publish the error; do not read director internals from the shell

**Decision.** Add a structured error to `TransitionPublicState` and have the director populate it
at the point it already sets `this.error`. The shell reads the public state, as it already does for
`phase` and `progress`.

**Rationale.** Reading `getRuntimeState()` from the shell would couple the UI to director
internals and re-create the divergence. Making the field public fixes the root cause (the error was
never exposed) rather than the symptom (the shell forgot to read it).

**Rejected alternative — widen `onError` subscription.** The host already exposes
`director.onError`. Wiring the shell to it would be a two-line fix. It is rejected because
`onError` is an *event*, not state: it fires once and is not replayed on shell rebuild, so the
error would vanish when the panel is rebuilt — which is exactly the "error state survives a panel
rebuild" scenario. A state field is required, not optional.

### D2 — Error object, not a string

**Decision.** The public error carries a machine code, a human message, the destination id, and a
`fatal` flag. The message is pre-formatted for display; the code is for diagnostics.

**Rationale.** The repository has a stable-error-code convention
(`docs/FAILURE_RECOVERY.md` §17, `src/app/runtimeStatus.ts` `ERROR_CODES`) that the atlas path
partially follows via `snapshot.errorCode`. Matching it keeps one vocabulary instead of two, and
lets the golden/debug readouts show the code while ordinary users see the message.

**Note.** Error *codes* must stay stable — they are asserted by browser specs. Error *messages* may
change freely.

### D3 — Distinguish fatal from recoverable by construction

**Decision.** `fatal` is already carried on the director's error event. Map it through unchanged.
Device loss keeps its own dedicated terminal path via `host.onFatal` and must not also be
rendered as a recoverable transition error.

**Rationale.** The M11 device-loss contract is deliberately a hard stop ("reload required"). Mixing
it into the recoverable channel would dilute a locked, well-tested contract. The two paths stay
separate; only the *recoverable* transition error is in scope here.

### D4 — Status surface moves out of the collapsible panel's hiding

**Decision.** The error banner is rendered in a container that is not hidden when the panel is
collapsed, and uses an assertive live region.

**Rationale.** A failure the user cannot see is not surfaced. Collapsing the panel to hide controls
must not hide the reason the app stopped doing what they asked. `role="alert"` (assertive) is the
correct choice for an error that interrupts; the existing `role="status"` (polite) is right for
progress and should stay for it.

### D5 — Wire the existing remediation builder rather than write new copy

**Decision.** Call `buildUnsupportedMessage` from the product boot-failure path.

**Rationale.** The copy already exists and was written for exactly this. A third status UI is not
needed. This is also a self-check on the audit: the builder being unreferenced is itself evidence
that the product route was left incomplete.

### D6 — Recovery action: retry, then stay

**Decision.** The error offers a retry action that re-requests the same destination, and a
dismiss action that leaves the user on the current destination. A retry that fails again does not
loop; it re-presents the same error with the same actions.

**Rationale.** The most common cause is transient (a network blip), so retry is the useful action.
Because preparation already leaves the previous destination active, "stay" is always safe and
requires no rollback work. There is no spinner state to get wrong, because the director is already
back at `idle` before the error is published.

### D7 — Stall means no progress event, not elapsed time

**Decision.** Reuse the director's existing `reportProgress(fraction01)` channel and observable
fetch activity. A progress event is settlement, a first or strictly increased finite fraction, response
headers, or additional response bytes. The stall threshold is at least ten times
`slowLoadThresholdMs`. Expiry aborts through the existing `AbortController` path.

**Rationale.** Elapsed time cannot distinguish a hung fetch from a slow fetch that is still
delivering bytes. A label-only status update is also not progress. Destinations that today neither
report progress nor expose fetch activity must emit start and subsequent finite progress before the
gate applies; otherwise a healthy silent compile would be aborted.

**Rejected alternative — abort every preparation after a wall-clock limit.** That satisfies the hung
request scenario and fails the continued-progress scenario. Both are required.

## Risks / Trade-offs

- **[Over-notification risk] A retry loop could spam the error region.** → Mitigation: retry is
  user-initiated only; there is no automatic retry. D6's "does not loop" clause is asserted.
- **[Message leak risk] Raw loader strings could reach the UI.** The current console line carries
  e.g. `manifest fetch failed: 404`. → Mitigation: the *display* message is authored copy; the raw
  detail stays in the console channel, per `docs/FAILURE_RECOVERY.md` §3 ("expandable technical
  details in debug/development mode").
- **[Existing spec breakage] `atlas-navigation.spec.ts` may assert a silent revert.** → Mitigation:
  it will fail, and that failure is the point; update it to assert visibility instead.
- **[Visual geometry risk] A new banner could shift the canvas and invalidate the UI-geometry
  contract** that the goldens depend on (the 2026-09-11 certification pinned topbar/viewport/panel
  dimensions). → Mitigation: the banner is positioned in a way that does not alter the pinned
  geometry when no error is present, and the geometry contract test is re-run.

## Testing strategy

- **Browser.** `atlas-navigation.spec.ts` gains rows that force a preparation rejection and assert
  the error surface, the recovery action and the dismissed state. Forcing is done through the
  existing test hook surface, not by editing product code.
- **Accessibility.** `accessibility.spec.ts` asserts the error is exposed via an assertive live
  region, has text content independent of colour, and is perceivable with the panel collapsed.
- **Regression.** `atlas-webgl2.spec.ts`, `smoke.spec.ts` and the goldens must be unaffected in the
  no-error case.
- **Gates.** `npm run check`; the accessibility and navigation specs; the full non-golden browser
  suite; both golden suites twice-stable.

## Open Questions

None blocking. One judgement call: whether the error banner should be a `role="alert"` element or a
persistent region whose text is updated. Both satisfy the requirement; the implementing agent
should choose whichever keeps the existing polite progress region untouched.
