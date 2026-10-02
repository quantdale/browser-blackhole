## Why

The repository has exactly one adaptive-quality authority — `PerformanceGovernor` — and
`.agent/QUALITY_GATES.md` Gate E requires "native DPR capped by policy", "dynamic-resolution
controller uses hysteresis and does not oscillate", and "before/after evidence for claimed
optimization". The controller is well built and well unit-tested. But the wiring between it and the
renderer does not deliver what the controller decides, and the reporting does not describe what is
actually applied.

Four confirmed defects, all in the same causal chain:

1. **A tier change never re-applies the drawing-buffer size.** `host.ts:517` handles
   `onTierChanged` by invalidating a frame and invalidating temporal history — it does not call
   `handleResize`. The only callers of `kernel.handleResize` are the initial resize
   (`host.ts:568`), the `ResizeObserver` (`atlasApp.ts:1106`, fires only on element size change)
   and the manual render-scale override (`host.ts:1025`). The dynamic-resolution half of the
   quality ladder is therefore inert: dropping to `low` changes service budgets but not pixel count.

2. **Telemetry reports the tier's nominal scale, not the applied one.**
   `runtimeTelemetry().size.renderScale` (`host.ts:1215`) returns `effectiveRenderScale()`, which is
   the current tier's value. When (1) happens, that number no longer describes the buffer. The
   repository's measurement-honesty rule is that a diagnostic must not report a value that does not
   describe the frame — the same rule `frameTelemetry` already honours for `lastFrameWork`.

3. **Every transition overwrites the user's manual quality mode with `auto`.** The director is
   constructed once with `{ baseQualityMode: 'auto' }` (`host.ts:488`) and restores that snapshot at
   the end of every transition (`TransitionDirector.ts:872`). `host.setQualityMode` writes only to
   the governor, so a user who pinned `ultra` is returned to `auto` after every navigation, and the
   panel then displays a mode the user never chose.

4. **`renderScale` is applied twice.** `SharedRendererKernel.handleResize` folds the scale into the
   pixel ratio (`pixelRatio = min(dpr, dprCap) * scale`, `:542`), computes the post size from that
   already-scaled ratio (`:555`), and then passes `scale` again to
   `post.ensureSize(..., scale)` (`:561`), which multiplies a second time (`SharedPost.ts:173-174`).
   The HDR target is therefore `css · dpr · scale²` while the drawing buffer it presents into is
   `css · dpr · scale`. At `low` (scale 0.6) the destination renders 36% of the intended linear
   pixel count. The host's own overlay-sizing mirror (`host.ts:892-897`) uses the single-application
   formula, so the overlay and the HDR target follow different rules.

Fixing (1) without (4) would activate a resolution change that is more aggressive than documented,
so they must land together.

## What Changes

- **Make a governor tier change re-apply the drawing-buffer size** through the same path a resize
  uses, so the tier ladder's render scale is real.
- **Make the manual quality mode survive transitions** by resolving the base mode at motion end from
  the user's current selection rather than from a construction-time snapshot.
- **Make the reported render scale describe the buffer actually in use**, sampled from the kernel.
- **Apply the render scale exactly once**, with a single owner of the pixel-ratio formula, and a
  test that pins the relationship between the HDR target, the drawing buffer and the reported
  scale.
- **Make the governor's FPS signal a frame-interval measurement**, and make the unit harness model
  the same measurement the production wiring performs.
- **Advance the activity clock independently of whether a frame was rendered**, so a settled
  application does not report `interaction` forever.

Non-goals, explicitly out of scope:

- No change to any tier ladder, threshold, hysteresis constant, or work-budget value. Those are
  calibrated and correct; this change makes the existing decisions take effect and be reported
  truthfully.
- No change to the post-processing chain, the temporal service, or the bloom path.
- No change to the DPR cap policy.
- No performance claim is made by this change. It removes work that is currently specified but not
  performed; measuring the resulting improvement is a separate, evidence-gated activity.

## Capabilities

### New Capabilities
- `rendering-quality-authority`: the contract that one adaptive-quality authority decides, that
  its decisions are applied to the actual drawing buffer, and that every reported quality number
  describes the frame it claims to describe.

### Modified Capabilities
- None. No archived baseline capability specifications exist yet
  (`openspec list --specs` reports none); `specification-baseline-hygiene` creates that baseline.
  Every requirement here is an ADDED requirement under the new `rendering-quality-authority`
  capability.

## Impact

**Affected code**

- `src/atlas/host.ts` — tier-change handling, quality-mode resolution, telemetry source.
- `src/atlas/TransitionDirector.ts` — resolve the base quality mode at motion end.
- `src/renderer/SharedRendererKernel.ts` / `shared/SharedPost.ts` — single application of the
  render scale; expose the applied size for telemetry.

**Affected tests**

- `tests/unit/frameTelemetry.test.ts` — the reported scale must equal the applied scale.
- `tests/unit/governor.test.ts` — the harness must model the production measurement boundary.
- `tests/browser/frame-invalidation.spec.ts` — a tier change must change the drawing buffer.
- `tests/browser/atlas-webgl2.spec.ts` — the HDR/buffer size relationship under forced WebGL2.

**Affected documents**

- `docs/PERFORMANCE_BUDGETS.md` (the render-scale formula), `docs/PERFORMANCE.md`,
  `docs/cosmic-atlas/RENDERING_SERVICES.md`.

**Dependencies**

- It shares `src/atlas/host.ts`, `TransitionDirector.ts`, `SharedRendererKernel.ts`, and
  `SharedPost.ts` with later changes. This change lands before
  `transition-error-user-visibility` and `shared-renderer-service-lifecycle`. Kerr may run beside
  it. Do not edit the shared files concurrently with either later change.

**Compatibility risk**

- **This change alters rendered resolution at tiers other than `high`/`ultra`.** Because (4) is
  fixed at the same time, the net pixel count at `low` rises from `scale²` to `scale`. Golden rows
  captured at a non-unity scale may therefore change. Every such change must be justified in
  `tasks.md` as the documented behaviour being restored, and no golden may be re-baselined to hide
  a regression.
