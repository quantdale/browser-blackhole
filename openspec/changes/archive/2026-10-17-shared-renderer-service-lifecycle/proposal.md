## Why

`src/renderer/shared/*` is where the performance campaign's wins live and where the product's
long-lived GPU state lives. The services are well designed and mostly correct — `ResourceScope` is
idempotent, disposes in reverse order and aggregates disposer errors, and the `RibbonService`
geometry-revision discipline (comparing spine values before re-uploading) is the exact pattern the
whole layer should follow.

The confirmed defects are all instances of the same omission: **the ownership and idempotence rules
that two services implement are not implemented by their siblings, and no shared contract test
enforces them.**

1. **Lowering the interaction cap does not reduce saturated blend weight.** `TemporalService.resolve`
   does select `interactionHistoryFrames` as `maxAge`. The weight is then
   `min(0.94, historyAge / maxAge * 0.94)`. Once history is saturated, lowering `maxAge` leaves that
   ratio at or above 1, so the weight stays at the 0.94 ceiling on the first interaction frame and
   after `historyAge` is clamped. The defect is this saturated ratio, not a missing cap selection.
   Dividing accumulated age by the lowered cap preserves the bug and is forbidden.

2. **`StrandService.setQuality` re-uploads the colour buffer every frame and cancels
   `setVisible(false)`.** `host.ts:741` calls it on every rendered frame. `setQuality` (`:331-337`)
   writes opacity, sets `root.visible = quality > 0.02`, then unconditionally sets
   `colorAttribute.needsUpdate = true` with no comparison against the previous quality. And
   `setVisible(false)` (`:343-345`) sets `root.visible`, which the next frame's `setQuality`
   overwrites — so a destination cannot reliably hide a strand.

3. **`ParticleService` compute dispatch ignores the population throttle.** `buildComputeGraph`
   ends with `return kernel.compute(this.capacity)` (`:621`) — the dispatch size is fixed at
   construction. `setPopulationScale` (`:838-850`) throttles only `geometry.instanceCount`, and
   `update()` (`:745-755`) short-circuits only on the CPU-side drawn count. So on the compute path
   a system at 20% population still simulates 100% of capacity every frame, while telemetry reports
   `drawn` as 20% and `skippedUpdates` as 0. The CPU path *is* correctly bounded to the active
   prefix (`:770-790`). The work-elimination claim is true for one path and false for the other, and
   the telemetry does not distinguish them.

4. **`renderer.info` is read as per-frame telemetry but never reset in the Atlas lane.**
   `readRendererInfo()` documents that three resets the render counters each render. In three's
   WebGPU build the only `info.reset()` is inside the animation-loop callback, reached through
   `setAnimationLoop` — which the Atlas lane never calls, because it drives its own rAF loop
   (`atlasApp.ts:1166`). Only the legacy `BlackHoleRenderer.startLoop` uses `setAnimationLoop`. So
   in production the counters are session-cumulative. The repository's own test already works around
   this explicitly (`frame-invalidation.spec.ts:409-412` sets `autoReset = false` and resets before
   each measured frame) — the test is honest and the production path is not.

5. **`LensingService` has no post-dispose creation guard.** A pass created after `dispose()` is
   pushed into a fresh array and never released. `RibbonService` and `StrandService` both unlink
   disposed handles; `ParticleService` and `VolumeService` retain them for the page lifetime and
   filter only at read time, so every per-frame sweep iterates dead entries.

6. **The present/copy TSL graphs are rebuilt every frame.** `host.ts:713` calls
   `post.setTemporalPolicy(...)` unconditionally; that setter has no value-equality guard and ends
   with `this.graphKey = null` — unlike its siblings `setBloom` and `setBloomResolutionScale`, which
   both guard. `resolveTemporal` nulls the key unconditionally too. The graph cache is defeated by
   two setters that are called from the per-frame host loop, and the cache's own design intent is
   documented in the code that bypasses it.

7. **Resize path gaps.** `handleResize` silently clamps to `maxTextureSize` without surfacing the
   reduction, although `docs/FAILURE_RECOVERY.md:192` requires surfacing it; and it is not gated on
   device loss, unlike `resolveGpuTimestamps`.

Plus smaller confirmed items: per-frame debug-object allocation on the present path, volume uniform
writes with no value comparison, a CPU particle loop that indexes velocity at the position stride
(correct only while the two strides coincide), and a missing dataset cache in the galaxy-collision
loader that its sibling has.

## What Changes

- **Make the temporal interaction cap reduce saturated history weight on the first interaction
  frame.** Use the settled cap as the denominator and the active cap as the numerator bound. Do not
  implement `historyAge / loweredMaxAge`, and do not require a full history reset to satisfy the
  weight change.
- **Make `StrandService.setQuality` idempotent** and stop it from overriding an explicit visibility
  request.
- **Make the particle compute dispatch honour the population throttle**, or report the two paths
  distinctly so the work-elimination claim is not overstated.
- **Sample per-frame renderer counters explicitly** so the debug panel and the work-elimination
  evidence describe one frame rather than the session.
- **Give every service a post-dispose creation guard and unlink disposed handles**, with a shared
  contract test.
- **Restore the graph-cache guard** in the setter that defeats it.
- **Gate resize on device loss and surface the max-texture clamp.**
- **Remove the remaining hot-path allocation and redundant uniform writes.**

Non-goals, explicitly out of scope:

- No change to what any service renders. Every fix is about lifetime, idempotence, honesty, or
  avoiding work that produces nothing.
- No change to any work-budget value, tier, or quality constant.
- No new service and no removal of a service. In particular, this change does not remove the legacy
  shell (L-01) and does not retarget `src/shaders/diagnostic.ts` (L-02).
- No performance claim. This change removes work that is currently specified but not performed;
  measuring the improvement is a separate, evidence-gated activity.

## Capabilities

### New Capabilities
- `shared-renderer-services`: the contract that every long-lived renderer service enforces a single
  ownership model, refuses creation after disposal, unlinks disposed handles, performs no
  redundant per-frame work, and reports telemetry that describes the frame it claims to describe.

### Modified Capabilities
- None. No archived baseline capability specifications exist yet
  (`openspec list --specs` reports none); `specification-baseline-hygiene` creates that baseline.
  Every requirement here is an ADDED requirement under the new `shared-renderer-services`
  capability.

## Impact

**Affected code**

- `src/renderer/shared/{TemporalService,StrandService,ParticleService,VolumeService,LensingService,
  RibbonService,SharedPost}.ts`.
- `src/renderer/SharedRendererKernel.ts` — per-frame counter sampling; resize gating.
- `src/atlas/host.ts` — the per-frame service fan-out that drives the redundant writes.
- `src/phenomena/galaxy-collision/loader.ts` — dataset cache.

**Affected tests**

- `tests/unit/{temporalService,strandService,particleService,volumeService,lensingService,ribbonService}.test.ts`.
- New: a shared service-contract test applied to every service.
- `tests/browser/{temporal-stability,temporal-critical-regions,particle-profiles-v2,strand-service,shared-post-*,frame-invalidation}.spec.ts`.

**Affected documents**

- `docs/cosmic-atlas/RENDERING_SERVICES.md`, `docs/RENDERING_PIPELINE.md`, `docs/FAILURE_RECOVERY.md`,
  `docs/OBSERVABILITY_DIAGNOSTICS.md`.

**Dependencies**

- Touches `src/atlas/host.ts`, `SharedRendererKernel.ts`, and `SharedPost.ts`. It starts only
  after `quality-ladder-resolution-integrity` and `transition-error-user-visibility` have landed.
  Do not edit those files concurrently with either change.
- Its new service-contract tests should follow the conventions from `verification-gate-integrity`
  when that change has landed. It does not wait for verification before fixing a confirmed
  lifecycle defect, and it does not edit `.github/workflows/ci.yml`.

**Compatibility risk**

- Making the temporal interaction cap effective changes what a camera drag looks like: less
  smearing of moving content, at the cost of less noise reduction during motion. That is the
  documented intent, but it is a visible change and the temporal goldens may move. Each such change
  must be justified individually.
