# Design — Quality ladder resolution integrity

## Context

The adaptive quality system has three parts that were built and reviewed independently: the
`PerformanceGovernor` decision logic, the `SharedRendererKernel` sizing path, and the host wiring
that connects them. Each is individually correct. The defects are all in the seams, which is
consistent with a campaign that tuned the governor's decision logic and the services it gates
without ever asserting the end-to-end claim "the tier's render scale is the resolution in use".

`docs/PERFORMANCE_BUDGETS.md` states the contract this change restores:
`floor(cssWidth × effectiveDpr × renderScale)`. `docs/PERFORMANCE.md` §3 documents a per-tier render
scale ladder. `.agent/QUALITY_GATES.md` Gate E requires dynamic resolution to actually work and
requires that "hidden tab throttling is not misclassified as GPU benchmark result" — the same class
of error as defect 5 below.

## Goals / Non-Goals

**Goals**

- One owner of the pixel-ratio formula, applied once.
- Every quality decision reaches the buffer; every reported quality value describes the buffer.
- The governor measures the same thing in production and in its unit tests.

**Non-Goals**

- Not a tuning change. No threshold, tier, hysteresis constant or budget value moves.
- Not a performance claim. This change restores specified behaviour; measuring the improvement is a
  separate, evidence-gated activity under `benchmark-harness-integrity`.
- Not a change to post-processing, temporal accumulation, or bloom.

## Decisions

### D1 — Route the tier change through `handleResize`

**Decision.** The `onTierChanged` handler re-issues the resize with the new effective scale.

**Alternatives considered.** (a) Have the kernel read the scale each frame — rejected: it spreads
sizing policy across two owners and would run every frame. (b) Have the governor own sizing —
rejected: the governor must stay a pure decision authority with no renderer knowledge, which is
the property that makes it unit-testable. (c) Re-issue `handleResize` — chosen: one code path, so
buffer, post targets, overlay and telemetry all stay consistent by construction.

The handler already has the CSS size available (it stored the last applied size for the overlay
mirror), so the re-issue needs no new plumbing.

### D2 — Resolve the base quality mode at motion end, not at construction

**Decision.** Replace the director's `baseQualityMode` snapshot with a resolver callback that reads
the user's current selection when motion ends.

**Rationale.** The current design is correct for the case it was written for (nothing else can change
the mode mid-transition) and wrong for the case that exists. A callback keeps the forced-low window
intact while making the restore reflect the latest user intent, including a selection made *during*
the transition.

**Note.** The governor already receives the user's selection through `host.setQualityMode`. The fix
removes the second, stale source of truth rather than adding a synchronisation.

### D3 — Sample the applied scale from the renderer

**Decision.** `runtimeTelemetry().size` reports the scale and dimensions the kernel actually
applied, with an explicit "unknown" before the first successful resize.

**Rationale.** The existing `effectiveSize()` already reads the live renderer where possible and
falls back to the stored value; the telemetry simply was not using it. Reporting "unknown" before
first use is already the established convention in this file and in `frameTelemetry`, so this
extends an existing truthfulness pattern rather than inventing one.

### D4 — Single application of the render scale

**Decision.** The kernel owns the pixel-ratio formula. It passes already-scaled pixel dimensions to
`SharedPost.ensureSize` with a scale of one, and the scale parameter on the interface is
re-documented as applying to unscaled dimensions only.

**Alternatives considered.** (a) Remove the scale parameter from `ISharedPost.ensureSize`
entirely — attractive, but it is a public interface with a `DeferredSharedPost` forwarder and test
harnesses; changing the signature widens the blast radius beyond the defect. (b) Have the kernel
stop folding scale into the pixel ratio and let the post chain apply it — rejected: the drawing
buffer would then be unscaled, which is not what the DPR policy means.

The invariant to pin is both equality and the documented formula. HDR dimensions must equal the
drawing buffer, and both must equal `floor(cssSize * effectiveDpr * renderScale)`. Equality alone
can pass if both targets are scaled twice, so it is not a sufficient regression test.

### D5 — Measure frame cadence for the governor's FPS signal

**Decision.** The FPS signal is the interval between presented frames, derived from the frame delta
the host already receives. CPU submission duration is retained as a separately reported metric.

**Rationale.** The current bracket is inside `kernel.renderFrame`, so it measures how long it took to
*submit* work. On a GPU-bound machine submission is fast while presentation is slow, so the signal
reads high — the opposite of the condition the governor exists to detect. The governor's own unit
harness already supplies frame-interval timing, so the harness is right and the wiring is wrong;
aligning the wiring to the harness is the smaller change.

**This is the one change whose runtime magnitude is `indicated` rather than `confirmed`.** The
mechanism is certain from source; whether it visibly walks the tier ladder upward under GPU load
requires a browser measurement. The design note in `docs/MASTER_PLAN.md` records this, and the
validation step requires measuring rather than assuming.

### D6 — Advance the activity clock on wall time

**Decision.** The activity clock and the settle/grace bookkeeping advance from the frame delta the
host already receives, independent of whether that frame was rendered.

**Rationale.** The clock's thresholds are wall-clock semantics ("quiet for 2.5 s"). Making it a
function of *rendered* frames means a correctly-skipping idle application never reaches the settled
state — the optimisation and the state machine are fighting each other.

**Alternatives considered.** Forcing one rendered frame on settle — rejected: it costs exactly the
frame the frame-skipping work removed, on every settle.

## Risks / Trade-offs

- **[Golden churn at non-unity scale] Fixing the double application raises the effective pixel count
  at `low` and `medium`.** Rows captured at those tiers may change. → Mitigation: fix both halves in
  the same change, prove the new size equals the documented formula, and justify every affected
  golden individually. Never re-baseline to green without that proof.
- **[Perf regression risk] More pixels at `low` costs more than before.** That cost is what the
  documented budget already specified; the previous behaviour under-delivered on quality. If
  measurement shows `low` is now too expensive, the correct response is a new budget decision under
  a separate, evidence-gated change — not a silent re-introduction of the double application.
- **[Frame-skipping interaction] Making the tier change resize could interact with the frame-skip
  gate.** → Mitigation: a tier change already invalidates a frame; the resize must not introduce a
  second invalidation path. The existing `frame-invalidation.spec.ts` rows pin this.
- **[Governor semantics change] A cadence-based signal may behave differently from the submit-based
  one the thresholds were tuned against.** → Mitigation: run the governor's tier-churn torture test
  and the scenario matrix before and after; if thresholds demonstrably misbehave, raise a separate
  budget change rather than adjusting thresholds inside this one.

## Testing strategy

- **Unit — telemetry truthfulness.** Assert the reported render scale equals the applied scale and
  that dimensions match the live buffer. Fails before the fix.
- **Unit — harness alignment.** Update the governor harness to model the production measurement
  boundary, and assert the governor still reaches each tier under the documented thresholds.
- **Unit — size formula.** Assert the HDR target equals the drawing buffer at scale 0.6 and 0.8.
  Fails before the fix.
- **Browser — tier change resizes.** Drive the governor across a tier boundary and read the live
  drawing-buffer dimensions. Fails before the fix.
- **Browser — manual mode survives.** Select a manual mode, run a full transition, assert the mode
  and the displayed control. Fails before the fix.
- **Gates.** `npm run check`; `frame-invalidation`, `atlas-webgl2`, `shared-post-*` specs; the
  scenario matrix; both golden suites twice-stable.

## Open Questions

One, and it does not change the approach: whether to fix the `visualWorkBudget` duplicate render-scale
table (finding A-07) here. Recommendation — **no**. It is a P3 and fixing it in this change mixes a
policy de-duplication into a correctness fix. Fold it into whichever change next touches the budget.
