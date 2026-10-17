## Why

When a destination fails to load, the product shows the user nothing.

Destinations are lazy chunks and their datasets are network fetches, so preparation failure is an
*expected* production condition, not an exotic one: a deploy that renames a hashed chunk, a CDN
hiccup, an offline laptop, a blocked or truncated data fetch, or any throw inside a module's
`prepare()`. When one happens today the transition silently reverts to the previous destination and
the only trace is a `console.error`.

The reason is structural, not an oversight in the shell. `TransitionPublicState`
(`src/atlas/types.ts:942-948`) carries `{ active, phase, progress, destinationOccluded }` and no
error field. The director keeps the error in its internal runtime state
(`TransitionDirector.getRuntimeState()`), and `src/atlas/host.ts:499-509` subscribes to `onError`
purely to log. `src/app/atlasApp.ts` never reads the director's error at all, so even a shell that
*wanted* to display it has no value to display.

This directly violates the repository's own contracts:

- `docs/FAILURE_RECOVERY.md` §3 requires user-facing messages to state what failed, whether the
  app can continue, the active fallback mode, and one useful remediation. The product route
  satisfies none of the four.
- `docs/ARCHITECTURE.md` §9: "A black/blank canvas with only a console error is never an
  acceptable failure mode."
- `.agent/QUALITY_GATES.md` Gate G: "invalid presets/state fail safely" and failures are surfaced.

There is a second, related gap in the same surface: the atlas shell's own remediation builder,
`buildUnsupportedMessage` in `src/atlas/hostStatus.ts:497`, has **zero callers**, while the legacy
route renders an equivalent and better message. Two divergent status UIs were written and the
product one was left as a code plus a raw string.

## What Changes

- **Add the transition error to `TransitionPublicState`** so the error is part of the public
  contract the shell is documented to read, not director-internal state.
- **Render it in the product shell** as a visible, accessible, non-color-only status with the four
  elements `docs/FAILURE_RECOVERY.md` §3 requires, and with a recovery action (retry / stay /
  return to the previous destination).
- **Distinguish recoverable from fatal** preparation failure, so a chunk-load failure does not
  present like a device loss.
- **Wire `buildUnsupportedMessage` into the product route** so the terminal unsupported state has
  real remediation copy instead of a code.
- **Ensure the status surface is never hidden** behind the collapsible panel, and is announced
  assertively rather than only politely.
- **Terminate a stalled preparation.** A destination preparation currently has no stall timeout: the
  slow-load threshold only emits a status event, and the only things that abort a prepare are a
  retargeting navigation, an explicit cancel and teardown. A data request that never completes
  therefore leaves the application in `preparing` indefinitely. Stall is absence of a defined
  progress event, not elapsed time by itself. A long preparation that keeps reporting an increased
  fraction or receiving additional bytes is not aborted.
- **Keep the existing console diagnostics** — they stay as the technical-detail channel, not the
  only channel.
- **Keep the existing slow-load status behaviour** unchanged: a slow load that is still progressing
  is reported as in progress, not as a failure. The new stall threshold is a separate, much longer
  bound.

Non-goals, explicitly out of scope:

- No change to the transition choreography, the occlusion point, the camera arrival, or any
  rendering behaviour.
- No change to device-loss policy, which is already terminal and correct per the locked M11
  contract.
- No retry/backoff of the network fetch itself. This change makes the failure visible and
  recoverable; it does not paper over it.
- No redesign of the panel.

## Capabilities

### New Capabilities
- `atlas-error-reporting`: the contract that every user-visible application failure terminates in a
  state the user can see, understand, and act on, and that the public state the shell reads carries
  the information needed to render it.

### Modified Capabilities
- None. No archived baseline capability specifications exist yet
  (`openspec list --specs` reports none); `specification-baseline-hygiene` creates that baseline.
  Every requirement here is an ADDED requirement under the new `atlas-error-reporting` capability.

## Impact

**Affected code**

- `src/atlas/types.ts` — `TransitionPublicState` gains the error field.
- `src/atlas/TransitionDirector.ts` — publish the error into public state; keep the abort/stale
  path from publishing a superseded error.
- `src/atlas/host.ts` — surface the public error; keep `onError` logging.
- `src/app/atlasApp.ts` — render the error with remediation and a recovery action.
- `src/atlas/hostStatus.ts` — wire `buildUnsupportedMessage` into the product route.

**Affected tests**

- `tests/browser/atlas-navigation.spec.ts` — new rows: a forced preparation rejection is visible
  and recoverable; a fatal error is distinguished; the status surface is reachable when the panel
  is collapsed.
- `tests/browser/accessibility.spec.ts` — the error surface is announced and is not conveyed by
  colour alone.
- `tests/unit/` — a unit test for the public-state error contract, if the director is testable
  without a browser (it is not currently unit-tested; see `docs/MASTER_PLAN.md` R-lane).

**Affected documents**

- `docs/FAILURE_RECOVERY.md` — record the product-route implementation of §3.
- `docs/cosmic-atlas/PRODUCT_UX_AND_TRANSITIONS.md` — the error presentation contract.
- `docs/cosmic-atlas/ARCHITECTURE.md` §11 — the transition host boundary.

**Dependencies**

- **Must be SEQUENCED with `destination-control-truthfulness`, not run in parallel.** Both changes
  edit `src/app/atlasApp.ts` (this one to render the error surface, that one for control reflection,
  focus preservation and test-hook gating). `docs/MASTER_PLAN.md` §7 makes that file single-owner to
  avoid two agents rewriting the shell concurrently. This change goes **first**: it defines the
  error surface, and `destination-control-truthfulness` then rebuilds the panel around a shell that
  already has one.
- Independent of `kerr-gpu-initializer-correctness` in files, so that change may run beside it.
  It is not independent of `quality-ladder-resolution-integrity` or
  `shared-renderer-service-lifecycle`: all three edit `src/atlas/host.ts`. Quality lands first,
  this change second, and lifecycle only after this change. "Coordinate" is not permission to
  edit those files concurrently.

**Blast radius**

- The new public error field is additive in product behaviour, but it is not source-compatible
  without edits. `getPublicState()` and every value satisfying `TransitionPublicState` must include
  it, and exact-shape assertions or normalizers must be updated. A typecheck failure at those sites
  is expected work, not evidence that the change is wrong. The user-visible behaviour change is
  that a previously silent failure becomes visible.
- Shared shell file: see the Dependencies note. `src/app/atlasApp.ts` must not be edited by two
  agents at once.
