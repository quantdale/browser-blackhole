# Design — Shared renderer service lifecycle

## Context

This layer is the product's GPU long-lived state, and the performance campaign's main subject. The
quality of the individual services is high. The problem is consistency: the rules exist, two or three
services implement them, the rest do not, and nothing enforces the difference.

`RibbonService.spineUnchanged` (`:270-283`) and `StrandHandleImpl.spineUnchanged` (`:296-306`)
value-compare before re-uploading and document why. `StrandService.setQuality` — three lines below a
correct implementation of the same discipline — re-uploads unconditionally. `RibbonService` and
`StrandService` unlink disposed handles; `ParticleService` and `VolumeService` do not.
`LensingService` has no `disposed` flag at all while three of its four siblings do.

This is the same lesson as the verification-gate change, one layer down: **a convention that only
some implementers follow is not a convention.** The fix in both cases is a shared contract test.

`docs/OBSERVABILITY_DIAGNOSTICS.md` and the project's measurement-honesty rules add a second
requirement here: a reported number must describe the thing it names. `renderer.info` is reported as
per-frame and is actually session-cumulative, because the reset lives inside a three.js code path the
Atlas lane does not take.

## Goals / Non-Goals

**Goals**

- One lifecycle contract, enforced by one test, applied to every service.
- No per-frame work that produces nothing.
- No telemetry that describes something other than what it claims.

**Non-Goals**

- Not a rendering change. Nothing here alters what is drawn.
- Not a budget or tuning change.
- Not a service rewrite, addition or removal.
- No performance claim. This removes work that is specified but not performed; measuring the gain is
  a separate, evidence-gated activity.

## Decisions

### D1 — One shared service-contract test, applied to every service

**Decision.** Write a table-driven contract test with a service descriptor per service, asserting:
resource-scope present, creation-after-dispose refused, released handles unlinked, dispose releases
everything, counters return to zero.

**Rationale.** This is the only approach that prevents recurrence. Fixing the five individual
defects without the shared test leaves the sixth service free to reintroduce the first defect. The
repository already has the pattern to copy — `lutSchema.test.ts`'s 18-case rejection table with
exact reason codes.

**Design constraint.** Services have genuinely different resource kinds (textures, buffers,
geometry, render targets, materials). The contract must be expressed in terms all of them share —
lifetime, unlinking, counter return — not in terms of any one resource type.

### D2 — Bound the numerator by the active cap and divide by the settled cap

**Decision.** Compute

`weight = min(0.94, min(historyAge, activeCap) / settledCap * 0.94) * confidence`

where `activeCap` is `interactionHistoryFrames` during interaction and `settledCap` is
`historyFrames`. Record the active cap and applied weight in the diagnostic snapshot. Do not require
a history invalidation solely to prove the change.

**Forbidden formula.** `historyAge / loweredMaxAge`, and `min(historyAge, previousMaxAge) /
loweredMaxAge`, both remain at the 0.94 ceiling when history is saturated. They do not implement
this requirement.

**Rejected alternative — reset history when interaction begins.** That lowers the weight, but it
discards accumulation and produces a flash. The documented intent is a shorter cap, not a reset.

**Why the bug exists.** The current code already selects the shorter cap as `maxAge`. Because the
numerator is not bounded before that division, a saturated age divided by the lowered cap is still
at least 1 and the weight stays at the ceiling.

### D3 — Idempotent presentation setters; separate visibility state

**Decision.** `setQuality` early-returns when the clamped value is unchanged, and stores the
requested visibility separately from the threshold-derived visibility. Both setters compute the
effective visibility from both.

**Rationale.** Two setters writing one property is the defect. The fix is to give each setter
authority over one input and have a single place combine them.

**On the colour buffer upload:** the colours already carry per-vertex alpha and opacity is a
uniform, so the unconditional `needsUpdate` appears to have no purpose beyond habit. Confirm before
removing — if a per-vertex colour genuinely depends on quality, guard the write instead of deleting
it.

### D4 — Report the two particle update paths distinctly

**Decision.** Make the compute dispatch honour the population scale where the API allows; where it
does not, report the population by update path so a caller can tell performed work from drawn work.

**Rationale.** `kernel.compute(this.capacity)` bakes the dispatch size into the node at build time.
Rebuilding the dispatch per population change would be a real cost and a real change to the
compilation lifecycle. The honest minimum — and the one that preserves the campaign's claims
accurately — is that the telemetry stops conflating the two. `skippedUpdates` currently reads 0 on
the compute path while the work is not avoided, which is the precise claim that needs correcting.

**Recommendation.** Attempt the bounded dispatch; if the API does not support it, ship the
distinction and record the limitation in `docs/cosmic-atlas/RENDERING_SERVICES.md`.

### D5 — Explicit per-frame counter sampling

**Decision.** Sample renderer counters by an explicit reset-and-read around the orchestrated frame,
storing the delta; keep memory and lifetime counters absolute.

**Rationale.** three resets `info` only inside its own animation loop, which the Atlas lane does not
use. Relying on it is a cross-module assumption about a library's internals that happens to hold for
the legacy path and not for the product path. The repository's own browser test already works around
it, so the correct production behaviour is known and simply was not applied.

### D6 — Restore the missing value guard

**Decision.** Give `setTemporalPolicy` the same early-return guard as `setBloom` and
`setBloomResolutionScale`; only null the graph key when the resolved output actually flips; key the
graph on the output texture pair rather than a single resolved id so alternating targets do not force
a rebuild.

**Rationale.** The cache is defeated by two unconditional invalidations, both in code paths called
from the per-frame host loop. The guard exists in two of three setters — the third is an oversight,
not a design decision.

### D7 — Removal of hot-path diagnostic allocation

**Decision.** Expose a scalar enabled accessor; reuse module-scope scratch vectors and matrices in
the temporal update; return internal jitter by reference from a non-copying accessor.

**Rationale.** `getDebugSnapshot()` builds an object plus array copies plus two 16-element matrix
copies, and is called every frame only to read `.enabled`. This is small per frame and pure waste;
the fix is uncontroversial.

**Measurement discipline.** Per `AGENTS.md`, do not claim a gain from intuition. Measure
allocation-sampling or a frame-time comparison before and after, and report the number.

## Risks / Trade-offs

- **[Temporal visual change]** Making the interaction cap effective changes camera-drag appearance:
  less smear of moving content, less noise reduction during motion. → Mitigation: this is the
  documented intent; the temporal goldens are the gate, and any change must be justified per row.
- **[New test surface]** The contract test may expose further latent lifecycle defects. → Mitigation:
  that is the point; triage each as a finding rather than weakening the contract.
- **[Host file contention]** The per-frame fan-out lives in `src/atlas/host.ts`, shared with
  `quality-ladder-resolution-integrity`. → Mitigation: sequence the two changes.
- **[Allocation micro-optimization risk]** D7 is a small change and easy to over-claim. →
  Mitigation: measure; report the measurement; do not assert a percentage improvement without one.

## Testing strategy

- **Contract test** across every service: create, release, dispose, create-after-dispose, repeated
  cycles, counters.
- **Temporal:** resolve for N settled frames, flip to interaction, assert the weight drops on the next
  resolve; assert the reset-reason ring records it.
- **Strand:** apply the same quality twice and assert no re-upload; hide then apply a quality above
  the threshold and assert the resource stays hidden.
- **Particles:** pin the population scale low and assert the update path reports accurately, on both
  paths.
- **Counters:** two consecutive frames report comparable values; a skipped frame reports
  not-applicable.
- **Graph:** a settle loop shows a non-increasing rebuild counter; changing tone mapping increments
  it once.
- **Stride:** update a particle with differing channel strides and assert the expected trajectory.
- **Cache:** navigate away and back with network throttling; assert no second request.
- **Gates.** `npm run check`; the temporal, particle, strand and shared-post browser specs; the full
  goldens twice-stable.

## Open Questions

None blocking. One judgement call: whether to attempt a bounded compute dispatch (D4) or ship the
distinction alone. Recommendation — attempt the dispatch, time-boxed; ship the distinction either
way, because that is required regardless.
