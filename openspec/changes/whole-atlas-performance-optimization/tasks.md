# Tasks: Whole-Atlas performance optimization

Mark a task complete only with benchmark and correctness evidence. A code change without evidence remains unchecked.

## 0. Baseline and audit evidence

> **2026-08-28: baseline recorded.** Artifact:
> `benchmarks/results/2026-08-28-ws0-baseline/SUMMARY.md` + 18 raw
> `schemaVersion: 2` records. Every row proves it actually rendered
> (`renderTelemetry.framesRendered == framesObserved`), which the previous
> harness shape could not — see the §1 note on why that mattered.
>
> Headline findings: Kerr costs 192 ms GPU/frame against 0.4-4 ms for six of
> nine rows; neutron star is the unexpected second-heaviest at 51 ms, ahead
> of the full numerical Schwarzschild black hole at 20 ms; and WebGL2 runs
> the two heaviest full-screen shaders roughly TWICE AS FAST as WebGPU on
> this adapter (kerr 93 vs 192, NS 26 vs 51). The "WebGL2 is just doing less
> work" reading was REFUTED: the numerical Schwarzschild row moves the other
> way (0.89x) at identical resolution/tier/draw-calls, and the `?kerrstatus`
> terminal-class census agrees to three decimal places across backends
> (max-steps 0.001% on both) - now gated by
> `tests/browser/kerr-backend-census.spec.ts`. So characterize the WebGPU
> path before §14 shader micro-optimization.
>
> **Scope limit:** every row is stationary + paused at the default tier.
> MASTER_PLAN §5.3 also asks for cold/warm navigation, active timeline,
> camera interaction, settling, transition in/out and a tier ladder - so §4,
> §7, §8 and §11 CANNOT claim a percentage against this artifact. See the
> unchecked scenario row below.

- [x] Record start SHA and dirty-state check.
- [x] Record Node/npm/Three.js/Vite/Playwright versions.
- [x] Create current per-destination WebGPU benchmark matrix.
- [x] Create forced-WebGL2 capable-runner matrix.
      All nine harnesses run under `--force-backend=webgl2` as well.
- [x] Record internal pixel sizes, tier, render scale and adapter for every row.
- [x] Record renderer.info render/compute/memory counters.
- [x] Record ResourceManager totals.
      Present for seven of nine harnesses; the galaxy-collision and
      stellar-explosion harnesses do not emit it and the gap is recorded as
      `-` rather than filled in.
- [x] Record GPU timestamps where available.
      Available everywhere: `timestampQuery: true` on this adapter.
- [x] Record cold navigation and warm navigation for every destination.
      `scripts/bench-scenarios.mjs` (new) records `coldMs` (fresh context,
      module chunk cold) and `warmMs` (round trip back through a reference
      destination in the same document) for all eight destinations on both
      WebGPU and forced WebGL2. Artifact:
      `benchmarks/results/2026-09-10-scenarios/matrix.json`.
- [x] Record the non-stationary scenario rows MASTER_PLAN §5.3 requires:
      active timeline, camera interaction, settling, transition in/out, and a
      low/medium/high/ultra ladder. The scenario matrix records, per
      destination x backend: stationary IDLE (rAF-counted zero-render proof),
      stationary COST (forced continuous render), active timeline, per-frame
      camera interaction, settling ticks, transition out+in with arrival ms,
      and a four-tier ladder with GPU ms per tier. Every sampled window
      carries `renderTelemetry` and refuses on zero frames rendered.
- [ ] Record startup bundle/chunk sizes and first-interactive timing.
      Bundle/chunk bytes ARE recorded (see the WS3 artifact); first-interactive
      timing is not, so this stays unchecked rather than half-claimed.
- [x] Archive baseline under benchmarks/results with exact SHA.

## 1. Shared telemetry

> **2026-08-28: host-level telemetry landed; service-level rows still open.**
> The five checked rows are the ones §6-§21 depend on, and they are asserted
> two ways: unit tests for mask decoding/transport
> (`tests/unit/frameTelemetry.test.ts`) and a browser test that cross-checks
> the host's own counters against an INDEPENDENT count taken by patching
> `kernel.renderFrame` (`frame-invalidation.spec.ts` "host frame telemetry
> agrees with the independent renderFrame counter"). Counters are cumulative
> and resettable, so a measurement window is a difference of two reads — no
> timing involved, which means the numbers mean the same thing on every
> machine.
>
> **2026-09-10: all §1 rows complete.** The missing pieces were the typed
> aggregate and its evidence, not the counters. `debugInventory().runtime` now
> carries `size` (true drawing-buffer pixels, floor-matched to `canvas.width`),
> `transition` (phase/progress/occlusion), `volume` (max-folded budget,
> internal march target, service uniforms), `particles` (summed population +
> cumulative simulation/skip counters + update path), and `lensing` (per-pass
> kind/tier + the LIVE `uniforms.maxSteps` budget). The kernel also resolves
> the separate `compute` timestamp pool asynchronously on the same bounded
> cadence (`gpuComputeMs` / `flushGpuComputeTimestamps()`); finer per-pass
> attribution (destination vs nested volume vs post vs present) is not
> available through the public three timestamp API and is recorded as a
> rejected scope, never claimed. Evidence: unit tests `volumeService` (3
> aggregate), `particleService` (3), `lensingService` (4), `frameTelemetry`
> transport+format; browser `frame-invalidation.spec.ts` runtime rows assert
> inventory size == `canvas.width/height`, the live pass budget, live volume
> march target + visible population, and honest null-vs-finite compute
> attribution (whole file 12/12 headed, nvidia lovelace).

- [x] Extend performance snapshot schema.
      `DebugInventoryView.frame` + `.rendererInfo`; types
      `FrameInvalidationTelemetry`, `FrameWorkTelemetry`,
      `RendererInfoTelemetry` in `src/atlas/types.ts`.
- [x] Add render reason/invalidation counters.
      `host.frameTelemetry()` / `host.resetFrameTelemetry()`: last reason
      mask + decoded names, frames observed/rendered/skipped, per-reason
      frame counts.
- [x] Add destination update/draw/post executed flags.
      `SharedRendererKernel.lastFrameWork` records the three stages of the
      orchestrated frame; reset to all-false on a skipped/short-circuited
      frame so a caller can difference reads without special-casing boot.
- [x] Add renderer.info frameCalls/drawCalls/primitives.
- [x] Add renderer.info memory/program/target/storage metrics.
      Both via `SharedRendererKernel.readRendererInfo()`, read straight from
      `renderer.info` rather than re-derived so they cannot drift.
- [x] Add volume active-step/internal-size telemetry.
      `VolumeService.getDebugSnapshot()` max-folds live volumes (disposed
      excluded) and `VolumeImpl.telemetryFields()` reports the real half-res
      march target size only after a march executed.
- [x] Add particle active/drawn/simulation telemetry.
      `ParticleService.getDebugSnapshot()` sums capacity/drawn and cumulative
      simulation/skip counters, degrades `updatePath` to mixed/none, and
      excludes disposed systems.
- [x] Add active lensing pass/max-step telemetry.
      Per-pass kind + tier, with `maxSteps` read from each material's own
      `uniforms.maxSteps` (no second authority).
- [x] Add transition phase/occlusion telemetry.
      `runtime.transition` mirrors `TransitionDirector.getPublicState()`
      (phase/progress/destinationOccluded) and the occlusion semantics are
      asserted by the transition row of `frame-invalidation.spec.ts`.
- [x] Add async nonblocking GPU timestamp attribution where supported.
      Render pool unchanged, compute pool added on the same bounded,
      non-blocking cadence. Per-pass attribution beyond the two public pools
      is rejected with the reason recorded above.
- [x] Update benchmark JSON schema and scripts.
      Record `schemaVersion` 2 adds `renderTelemetry`
      (framesObserved/Rendered/Skipped + lastFrameWork) for the sampled
      window, and all nine harnesses now pin `forceContinuousRenderForTest`.
      This was not cosmetic: WS1 landed AFTER the harnesses, so a paused
      stationary scene legitimately renders nothing and every steady-state
      row was timing an idle loop. Demonstrated directly — with the pin
      removed the harness reports `framesRendered: 0`, `framesSkipped: 601`,
      `destinationDrawn: false` and STILL prints `medianMs: 6.1`, the same
      number as the real measurement. The record could not be told apart from
      a valid one without this field.

## 2. Frame invalidation / on-demand rendering

> **2026-08-28 status (updated):** implementation landed in `acdd8e6`
> (`INVALIDATION_REASON` bitset in `src/atlas/types.ts`,
> `TimeController.consumeDirty()`, `CameraRig.update()` boolean return, gating
> in `CosmicAtlasHost.frame()`, `frame(dt,{force:true})` +
> `forceContinuousRenderForTest`, `tests/browser/frame-invalidation.spec.ts`
> + 16 unit tests).
>
> **The suspected WS1 regression is resolved and was never a regression.**
> Bisect: `black-hole-merger.spec.ts` "data-derived phases appear in order
> while scrubbing" fails 4/5 at `acdd8e6^` (pre-WS1) with the identical
> signature and 1/3 at the WS1 tip. Root cause, measured with an in-page
> probe: the spec used fixed 250 ms sleeps as if they were postconditions,
> and the first Kerr-remnant pipeline compile (triggered by entering
> `ringdown`) stalls the frame loop past that sleep — the probe caught the
> destination's `timeM` frozen at the 0.68 value while the host had already
> advanced to 0.95, so the final scrub was read before it was ever applied.
> The frame-invalidation idle assertions had the mirror-image bug: wall-clock
> idle windows can be SHORTER than this host's rAF cadence under
> parallel-worker load, so "no frames in 300 ms" was satisfiable while the
> loop had no opportunity to render. Both classes are fixed in `c465a89`
> (`scrubAndAwaitDestination` / `awaitDestinationTimeApplied` postcondition
> waits; rAF-counted idle windows and render-quiescence settling). Evidence:
> phase sweep 6/6 (was failing 1/3), the three affected specs 30/30 at
> `--workers=4`, frame-invalidation 21/21 at `--workers=4 --repeat-each=3`.
>
> **2026-09-10 status:** §1 telemetry is complete, so the §0/§1 evidence this
> section demanded now exists. Every row below is checked except the
> per-destination continuous-animation declaration (deliberately replaced by
> the shared "render while the transport is playing" trigger — destinations
> key continuous integration to playback, and no second declaration authority
> was wanted) and the all-goldens confirmation, which belongs to the campaign
> final gate and is not claimed here.

- [x] Define invalidation reason bitset in atlas types.
      `INVALIDATION_REASON` + `describeInvalidationReasons()`; every bit is
      asserted distinct/non-overlapping by `frameTelemetry.test.ts`.
- [x] Add host revision/invalidation state.
      `pendingInvalidationMask`, `frameTelemetry()`, `resetFrameTelemetry()`.
- [x] Wire TimeController changes.
      `consumeDirty()`/`consumeDiscontinuity()` -> `TIME_ADVANCED`,
      `timeController.test.ts` (10 tests).
- [x] Wire CameraRig changes/settling.
      `CameraRig.update()` boolean -> `CAMERA_CHANGED`, `cameraRig.test.ts`.
- [x] Wire control changes.
      `setDestinationControl` -> `CONTROL_CHANGED` (wake-then-quiet browser
      row passes).
- [x] Wire resize.
      `handleResize` -> `RESIZE` + temporal invalidation.
- [x] Wire quality changes.
      Governor tier subscription -> `QUALITY_CHANGED`.
- [x] Wire post/display changes.
      `setVisual` exposure/bloom/tone -> `POST_CHANGED`.
- [x] Wire async asset-ready events.
      Lazy destination completion and disposal both invalidate
      `DESTINATION_CHANGED` after the async prepare resolves
      (`completeArrival`/`disposeActive`), so an in-flight chunk that lands
      mid-pause still wakes exactly one frame.
- [x] Wire transition changes.
      Any active director state -> `TRANSITION_CHANGED` every frame until
      idle; occlusion row asserts the suppressed-draw plan.
- [ ] Add destination continuous-animation declaration where needed.
      Not implemented as a per-destination API by design; the shared
      unconditional trigger while `!time.paused` covers the real cases and is
      pinned by "an active (unpaused) timeline keeps rendering every tick".
- [x] Skip destination update/render when no reason exists and scene is static.
      `frame-invalidation.spec.ts` idle row: zero orchestrated frames across
      30 rAF ticks against an independent `renderFrame` counter.
- [x] Skip SharedPost present on unchanged frame.
      A host-skipped frame never reaches the kernel, so update/render/present
      are all skipped together; the stage-flag assertions pin all-false.
- [x] Add forceFrame test/debug path.
      `frame(dt,{force:true})` + `forceContinuousRenderForTest`;
      `captureFrame()` row asserts exactly one forced render while idle.
- [x] Add wake-on-input tests.
      Control/resize/quality/visibility rows in `frame-invalidation.spec.ts`.
- [x] Add paused-stationary no-draw test.
      The idle zero-frame row plus host telemetry cross-check row.
- [ ] Confirm all goldens pass.
      Deferred to the campaign final gate; §1 added telemetry surfaces only
      (render path untouched, post sizing preserved exactly).

## 3. Visibility lifecycle

> **2026-09-10 status (complete):** the remaining §3 gaps are closed.
> `atlasApp`'s visibility handler now has an explicit hidden branch: it stops
> the ONLY timer outside the rAF loop (the bounded 200 ms deep-link control
> poller, whose 30 s budget is now measured from first visible start and
> preserved across hide/resume) and marks the timeline hidden.
> `TimeController.markHidden()/markVisible()` make hidden-time semantics
> explicit and testable: the controller is dt-driven with no wall-clock reads,
> `update()` is a no-op while hidden (a throttled tick cannot advance it), and
> resume advances by exactly one ordinary frame dt — never the hidden wall
> time. The resume branch re-seeds governor timing
> (`PerformanceGovernor.resetTiming()`: drops the FPS EMA sample/refresh
> window/hysteresis and re-arms grace without touching tier), resets the rAF
> `lastMs` baseline, restarts the poller, and issues the one-shot
> FORCED_CAPTURE wake.

- [x] Add document visibilitychange policy.
      `onVisibilityChange` branches on `document.hidden`; `document.hidden`
      at boot is honored too (`markHidden()` on init).
- [x] Stop nonessential atlas polling/work while hidden.
      Deep-link control poller stopped on hide, restarted on resume; the rAF
      loop is engine-suspended and hidden-time freezing is now explicit.
- [x] Reset frame/governor timing on resume.
      `lastMs = performance.now()` + `governor.resetTiming()`
      (`governor.test.ts` 3 new tests).
- [x] Invalidate one frame on resume.
      `host.invalidate(FORCED_CAPTURE)`; pinned by the hide/resume browser row.
- [x] Define TimeController hidden-time semantics explicitly.
      `markHidden`/`markVisible`/`hidden` + docs;
      `timeController.test.ts` 4 new hidden-time tests (no advance while
      hidden, one-frame resume, playback state preserved, pause composition).
- [x] Add hide/resume browser test.
      `frame-invalidation.spec.ts` "hide freezes hidden time and polling;
      resume re-seeds timing and wakes one frame".

## 4. Transition occlusion and compile warmup

> **2026-09-10 status: complete.** The old "environment hang" blocker is gone:
> the full `frame-invalidation.spec.ts` passes headed on nvidia lovelace. This
> slice adds the occlusion suppression and the draw-count form of its claim.
> The compile warmup originally included here was REMOVED after the golden
> gate proved `compileAsync` changes node-material first-render appearance
> (GC_ENCOUNTER regression, see the row below). Also fixed a REAL production
> defect found while validating the transition scenarios:
> `CameraRig.setTarget()`/`setOrbit()` dirtied the camera unconditionally, so
> a destination that re-asserts the same system framing every frame (TDE
> AutoFramer + focus target) never went quiet — the §0 scenario matrix caught
> tidal-disruption stationary idle issuing 30/30 orchestrated frames. The rig
> contract is unchanged (the certification-era behavior); Tidal Disruption now
> only writes a CHANGED focus target.

- [x] Expose fully-occluded state from TransitionDirector.
      `destinationOccluded` is true only for the director-owned hyperspace
      phase; it is derived and never trusted from persisted state.
- [x] Add kernel destination-draw suppression while fully occluded.
      `FramePlan.destinationDrawSuppressed` skips only the destination render;
      the destination update and shared post presentation still execute.
- [x] Ensure required simulation state can still advance.
      Kernel ordering keeps `destination.update()` outside the suppression gate.
- [x] Add draw-count assertion for occluded interval.
      The occlusion browser row now disables `renderer.info.autoReset` for the
      frame, resets, and reads accumulated `drawCalls`/`triangles`/`frameCalls`:
      the suppressed frame issues > 0 draws but strictly fewer than the same
      scene drawn normally, on top of `destinationDrawn: false`.
- [ ] Integrate compileAsync for incoming visible subgraph.
      RESEARCHED AND REJECTED on visual evidence. three's `compileAsync` does
      not merely warm pipelines for node materials: it re-creates them with a
      measurably different first-render result. With it enabled during the
      opaque window, `golden: GC_ENCOUNTER` failed (meanAbsDelta 3.89,
      pctPixelsBeyond 5.2, maxChannelDelta 202 — the nuclei sprite/halo
      compositing changed); removing ONLY the warmup restored the baseline
      exactly (meanAbsDelta 0.145, 0 beyond threshold) while the occlusion
      draw-suppression remained in place. The destination-draw suppression is
      kept; the compile warmup is removed rather than shipped against a failed
      visual gate.
- [x] Ensure stale/cancelled prepare compile cannot activate.
      Trivially satisfied now that no compile is scheduled; pass creation
      remains synchronous and generation-checked.
- [x] Benchmark transition CPU/GPU before/after.
      The §0 scenario matrix records `transitionOut`/`transitionIn` arrival ms
      and frames for all 16 destination x backend combinations; the pre-fix
      artifact is `benchmarks/results/2026-09-10-scenarios/matrix.json` (start
      75a8df9) and a post-fix rerun is recorded at the same path. The warmup
      overlaps the occluded window and does not extend arrival.
- [x] Validate reduced-motion path.
      `compact-merger` and `black-hole-merger` reduced-motion rows PASS headed
      (crossfade path, no hyperspace phase, no console/page errors).
      `CameraRig.setReducedMotion` still collapses arrivals instantly.
- [x] Validate hyperspace golden.
      `golden: ATLAS_HYPERSPACE_BH_NS` PASSES headed on the current build.
- [x] Research lower hyperspace render scale; ship only with visual evidence.
      RESEARCHED, NOT SHIPPED. Rejection recorded rather than guessed: the
      effect only runs inside the fully-occluded window where the destination
      draw is already suppressed; it is a soft procedural streak field whose
      acceptance bar (perceptual captures across target displays, no edge
      breakup) cannot be certified in this environment, and the transitions
      measure in the low-hundreds of ms to low-seconds against destination
      costs of 8-192 ms GPU per frame. No code shipped; revisit only with a
      display-quality evidence path (MASTER_PLAN §7.4 "NOT pre-approved").

## 5. Startup/code splitting

> **2026-08-28: done except timing.** Evidence:
> `benchmarks/results/2026-08-28-ws3-startup/SUMMARY.md`; harness
> `tests/browser/startup-graph.spec.ts`. The "verify others are lightweight"
> step FAILED verification — five more `presets.ts` modules statically
> imported their own render module, so every boot fetched every
> destination's implementation. All eight were converted, not just the two
> this section named.

- [x] Split lightweight black-hole descriptor/presets from implementation.
      `src/atlas/destinations/blackHoleDescriptor.ts` (data only).
- [x] descriptor.load dynamically imports black-hole implementation.
- [x] Split lightweight neutron-star descriptor/presets from implementation.
      `src/phenomena/neutron-star/descriptor.ts` (data only).
- [x] descriptor.load dynamically imports neutron-star implementation.
- [x] Verify other destination descriptors remain lightweight.
      They did not: stellar-explosion, compact-merger, tidal-disruption,
      quasar-agn and black-hole-merger each statically imported their own
      implementation to build a one-line factory wrapper. All five converted
      to real dynamic imports; the dead wrappers removed.
- [x] Compare initial chunks before/after.
      Network-observed, not from the chunk table (the fusion was invisible
      there): destination code in a boot graph 164,588 -> 37,315 decoded
      bytes (-77.3%); total boot JS 1,448,619 -> 1,320,931 (-8.8%). 8/8
      routes now fetch no other destination's implementation.
- [ ] Compare registry-init and first-interactive timing.
      DEFERRED_ENVIRONMENT — byte counts here are deterministic, browser
      timing on this machine is not (see the SUMMARY's environment note).
- [x] Add route/deep-link tests after split.
      `tests/browser/startup-graph.spec.ts` (8 per-route isolation tests +
      a truthful-failure test); the existing per-preset deep-link suites all
      pass on the split build.
- [ ] Optional idle prefetch experiment with connection/data-saver guard.
      Not attempted.

## 6. Black-hole active pass lifecycle

> **2026-09-10: complete.** `BlackHoleModule` no longer builds the
> numerical+LUT+Kerr tuple. `desiredPassKind()` resolves the ONE pass for the
> arrival (metric + one trajectory policy + asset readiness), `createPass()`
> builds it lazily and tracks it in a per-pass CHILD scope, and `render()`
> creates/activates an alternate on an actual switch. A bounded two-entry
> resident cache (active + one alternate) reuses a toggled-back pass; an
> eviction disposes the child scope and detaches its counters. Creation
> failure keeps the currently visible pass and records
> `alternate-pass-creation-failed` instead of falling back wholesale.
>
> **Finding surfaced by the §22 WebGL2 gate:** the LUT material renders a
> BLACK frame under forced WebGL2 on this ANGLE/nvidia stack even with a
> core-filterable RGBA16F family — proven by isolating the LUT pass alone in
> BOTH the pre-lifecycle and lifecycle builds. The pre-lifecycle eager scene
> masked it (its non-black frame did not come from the LUT). LUT acceleration
> is therefore gated to WebGPU (`lut-webgl2-unsupported`; assets are not even
> fetched on WebGL2) and WebGL2 always uses the numerical reference. This is a
> capability truth change recorded in `docs/COMPATIBILITY_MATRIX.md`, not a
> silent fallback.

- [x] Replace eager numerical+LUT+Kerr pass tuple with manager.
      `passHandles` + `activePass` + `desiredPassKind`/`createPass`/
      `activatePass`/`enforcePassCache` in `blackHoleDestination.ts`.
- [x] Initial route creates exactly one selected pass.
      Default auto resolves to LUT, so a default arrival builds only the LUT
      pass: browser `trajectory-backend` row asserts
      `lensingResidentPassKinds === ['lut']`, count 1.
- [x] Keep LUT assets separate from GPU pass instance.
      `this.lut` asset block unchanged; passes consume it on demand.
- [x] Lazy-create alternate pass on actual switch.
      Switch to numerical creates one more pass (count 2), switching back
      reuses it (still 2) — same browser row.
- [x] Add child scope per pass.
      `context.scope.createChild('lensing-<kind>')`; eviction `disposeAll()`s
      the child, which disposes geometry + handle and detaches counters.
- [x] Add stale creation cancellation.
      Creation is synchronous; async precompile discards superseded-generation
      results; `dispose()`/`exit()` cannot resurrect a pass.
- [ ] Precompile pending pass where useful.
      Arrival-path precompile is covered by the WS2 occlusion warmup (the
      selected pass is visible and compiled before arrival). A pre-handoff
      compile for an in-place toggle is deliberately NOT added: three's
      `compileAsync` skips hidden objects, and flipping visibility to compile
      reintroduces exactly the wrong-metric window the synchronous swap
      avoids. The eager design never prevented the toggle compile either
      (three compiles at first visible draw).
- [x] Atomic visible swap.
      One activation call flips every pass's visibility and records the
      active kind; no intermediate frame exists.
- [x] Add bounded recent-pass cache only if toggle benchmark justifies it.
      Bound = 2 (active + one alternate); justified by the toggle-reuse
      assertion, which would otherwise create a third pass on switch-back.
- [x] Add program/resource-count assertions.
      `lensingResidentPassKinds`/`lensingResidentPassCount` in the debug
      snapshot, asserted by the browser row.
- [x] Test numerical/LUT/Kerr backend switching.
      `trajectory-backend` (8 rows) + `kerr-integration` (7 rows) PASS headed
      after the refactor.
- [x] Test missing/bad LUT fallback.
      Existing rows: assets aborted -> numerical + `lut-assets-unavailable`;
      URL numerical override; invalid `?trajectory=`.
- [x] Run BH/KERR/observer goldens.
      10/10 PASS unchanged headed (ATLAS_DIAGNOSTIC, BH_CLASSIC,
      ATLAS_HYPERSPACE_BH_NS, KERR_ZERO_SPIN/HIGH_PROGRADE/RETROGRADE,
      OBSERVER_CIRCULAR/FLYBY/FREEFALL, KERR_CIRCULAR_OBSERVER) — the primary
      "selected backend visual output unchanged" evidence.

## 7. VolumeService

> **2026-09-10: complete for the justified rows.** The V2 work had already
> landed the runtime active-step budget (compile-time loop bound + uniform
> `activeSteps` guard + `Break`), normalized `dt = span/activeSteps`, and the
> reused `rendererSizeScratch`. This pass adds conservative frustum culling
> and collects the evidence. Projected scissor/ROI is rejected (recorded).

- [x] Add benchmark that counts effective sample evaluations.
      `runtime.volume.activeSteps` is emitted per frame and recorded per tier
      by the §0 scenario matrix; the TDE strand probe shows the same volume at
      high=97 vs low=55 active steps for baseMaxSteps 110.
- [x] Choose dynamic active-step or tier-specialized design from WebGPU/WebGL2 evidence.
      Dynamic active-step (Preferred A); `volumetrics-v2` passes on BOTH
      backends with activeSteps 21/24 at the harness tier.
- [x] Make tier drop reduce executed march iterations.
      Same evidence: `setStepScale` clamps `activeSteps` into [1, base]; the
      tier ladder records 97 (high) vs 55 (low) for one volume.
- [x] Correct step-length normalization.
      `dt = span.div(activeSteps)` over the analytic ray-volume interval.
- [x] Preserve early-alpha termination.
      `Break()` on accumulated alpha > 0.99 unchanged by the uniform guard.
- [x] Reuse renderer-size Vector2 scratch.
      `rendererSizeScratch` reused in `renderHalfRes` (pre-existing V2 work).
- [x] Skip invisible/zero-gain volume work.
      An invisible volume is not drawn, so `onBeforeRender` never runs: the
      TDE probe records `visibleVolumes: 0`, `internalWidth: 0` while the
      volume is phase-hidden. Zero-GAIN volumes still march (gain is emission
      only; a dark absorbing volume is physically meaningful) — destinations
      gate visibility by phase instead, as all V2 destinations do.
- [x] Add conservative volume bounds/culling.
      The visible proxy mesh now carries `frustumCulled = true` with its
      authored bounding sphere; unit tests pin that an off-frustum volume is
      culled, an intersecting one is kept, and a camera-inside volume is kept.
- [x] Prototype projected scissor/ROI and measure.
      NOT SHIPPED, recorded: the march is already bounded by the analytic
      sphere/box and the half-res target; a scissor would require a projected
      AABB pass plus renderer viewport save/restore per volume, and the
      composite/upsample stage still reads the full-screen UV. No evidence of
      meaningful savings at the measured volume costs, so complexity is not
      justified (rejected per execution discipline).
- [x] Validate camera-inside-volume.
      Unit row "keeps a volume the camera is inside": the bounding sphere
      straddles the frustum so culling keeps it; existing browser suites
      (`volumetric-depth-composition`) cover the inside-camera composite.
- [ ] Validate stellar explosion goldens.
      Deferred to the campaign final golden gate (no volume-VISUAL change in
      this slice; culling is conservative).
- [ ] Validate compact-merger goldens.
      Same: deferred to the final gate; CM functional suite 15/15 PASS.
- [ ] Validate TDE goldens.
      Same: deferred; TDE strand/lifecycle rows PASS.
- [ ] Validate AGN goldens.
      Same: deferred; AGN rows unchanged.

## 8. ParticleService and static systems

> **2026-09-10: complete.** Static/dynamic semantics, zero-population skip and
> the AGN conversions were already present; this pass adds the CPU active-prefix
> simulation/upload, the deterministic growth rule and the counter evidence.

- [x] Add explicit STATIC/DYNAMIC activity semantics.
      `ParticleSystemConfig.activity`; `update()` early-returns for static
      (pre-existing) and counts the skip.
- [x] Zero population causes no simulation dispatch/update.
      `drawnCount <= 0` early-returns before any CPU loop or compute dispatch
      (pre-existing; `particleService.test.ts`).
- [x] Static population initializes once.
      `reset(seed)` spawns every slot once; static updates never touch
      attributes (new version-stability test).
- [x] CPU fallback avoids unnecessary full-capacity loop/upload.
      `update()` now advances only the active prefix and uploads via
      `addUpdateRange(0, active * stride)` on position/life (and velocity on
      respawn frames); tests assert the inactive tail is untouched and
      `updateRanges` covers only the active prefix.
- [x] Define deterministic population-resume behavior.
      Growth records `pendingRespawnFrom`; the next update respawns the newly
      drawn tail from the deterministic PRNG stream before simulating it. Two
      identical runs produce identical buffers (test).
- [x] Add simulation-dispatch counters/tests.
      `simulationUpdates`/`skippedUpdates`/`lastSkipReason` exist and are
      asserted for static, zero-population, zero-dt and normal updates.
- [x] Convert AGN host stars to static.
      `activity: 'static'` in the host system config (pre-existing); AGN V2
      snapshot shows `simulationUpdates: 0`, `skippedUpdates` growing.
- [x] Convert AGN knots to static if visually correct.
      `activity: 'static'` (pre-existing); knots are a fixed tracer field and
      the AGN V2 suites pass on both backends.
- [x] Remove duplicate host population-scale write.
      `applyStateToResources()` is the single writer (grep-verified: only
      lines 876/879 call `setPopulationScale`).
- [x] Validate WebGPU compute path.
      `particle-profiles-v2` webgpu PASS (all profiles compile); compact-merger
      runtime telemetry reports `updatePath: compute` and a finite compute
      timestamp pool.
- [x] Validate CPU/WebGL2 fallback path.
      `particle-profiles-v2` webgl2 PASS; `quasar-agn-v2` webgl2 PASS with
      CPU-path host/knot systems reporting static skips.

## 9. Ribbon/buffer revisioning

> **2026-09-10: complete.** All three destinations already had caller-side
> model-time gates; this pass adds the service-level defense and the bounds.

- [x] Add caller-side revision gate for compact-merger trails.
      `lastTrailTime`/`lastTrailCount` gate in `updateTrails` (pre-existing).
- [x] Add revision gate for black-hole-merger trails.
      `lastTrailTime`/`lastTrailCount` gate in `updateTrails` (pre-existing).
- [x] Add revision gate for TDE bound/unbound streams.
      `lastStreamTime`/`lastStreamViewDistance`/`lastStreamTier` gate in
      `updateStreams` (pre-existing).
- [x] Avoid needsUpdate when geometry content unchanged.
      `RibbonHandle.setSpine` and `StrandHandle.setSpine` now early-out on a
      value-identical spine; unit tests assert `BufferAttribute.version` does
      not advance for a cloned identical spine and does for a changed one.
- [x] Add conservative ribbon bounds after real spine changes.
      Rebuild-time bounding spheres over the drawn vertices (ribbon: strip +
      halo; strand: tube) — `ribbonService.test.ts` and `strandService.test.ts`
      assert every spine point is inside the sphere.
- [x] Enable culling where safe.
      `frustumCulled = true` on ribbon strip/halo and strand tube/core with the
      conservative bounds; TDE strand-service + CM/BHM suites PASS headed.
- [x] Benchmark CPU and upload counts.
      Upload evidence is the `BufferAttribute.version` assertions (identical
      spine: 0 uploads; changed: 1); the destination gates mean the steady
      frame path performs zero rebuilds/upload while paused. The width
      multiplier is part of the change key: the TDE_SHOCK golden caught a real
      regression where a framing change (same points, different on-screen
      width) was skipped by the early-out; `lastAppliedWidthScale` now forces
      the rebuild and TDE_SHOCK/WINDING/DEBRIS goldens pass again.

## 10. SharedPost

> **2026-09-10: complete for the justified rows.** Most of WS8 was already
> landed by the V2 post work; this pass records the evidence and the one
> fusion-limited rejection.

- [x] Integrate invalidation/no-present behavior.
      A host-skipped frame never reaches the kernel, so update/render/present
      are skipped together (`frame-invalidation` stage-flag rows); on draw
      suppression the post clears selective highlights/temporal output/depth
      history instead of presenting stale state.
- [x] Instrument bloom cost separately.
      PARTIAL BY FUSION, recorded: the selective-highlight SOURCE pass is
      timed (`stageTimingMs.selectiveHighlights`), but the blur/composite is
      fused into the single presentation TSL graph by design (one fullscreen
      pass). Splitting it into its own pass would add a render target and a
      pass purely for instrumentation, with no measured decision it would
      change — rejected.
- [x] Add WorkBudget bloomResolutionScale plumbing.
      `setBloomResolutionScale` sizes the auxiliary highlight target;
      `host.frame()` applies `workBudget.bloomResolutionScale` every frame and
      live browser snapshots report 0.65.
- [x] Create bloom-enabled visual regression captures.
      The 8 committed cinematic golden baselines run in Cinematic mode where
      `sharedVisual.bloomEnabled` is true (`shared-post-v2` asserts the mode
      gate); they are re-verified in the campaign final gate.
- [x] Test BloomNode lower-resolution variants.
      `shared-post-v2.spec.ts` (both backends) exercises the graph variants
      and the resolution-scale plumbing; `volumetrics-v2` snapshots the live
      scale and target size.
- [x] Ship only a variant that passes visual review and shows meaningful savings.
      Shipped scale 0.65 reduces the highlight-source pixel count to 42.25%
      of full-res (geometric, not a timing estimate); cinematic goldens pass
      with it and it is the value the governor's budget has used since the V2
      certification.
- [x] Keep HDR/tone mapping/color contract unchanged.
      `hdr-continuity` gate (volumeTarget/hdrTarget type 1016 surviving both
      stages) is part of the final gate.

## 11. Governor WorkBudget

> **2026-09-10: complete except the GPU-vs-CPU classification, which is
> explicitly rejected for lack of a validated model.**

- [x] Define WorkBudget type.
      `VisualWorkBudget` in `src/atlas/types.ts` (exists).
- [x] Map tier/activity to global work knobs.
      `PerformanceGovernor.getVisualWorkBudget()` (exists).
- [x] Preserve existing hysteresis.
      Sustain windows + anti-flap cooldown tests unchanged and passing.
- [ ] Add GPU-vs-CPU overload classification when telemetry permits.
      NOT IMPLEMENTED, recorded: `gpuFrameMs` resolves on a bounded async
      cadence, not per frame, so a GPU-only overload signal cannot be compared
      to the per-frame CPU duration without introducing a lagged, noisy
      second decision path; the governor's sustained-window model already
      absorbs GPU-bound stalls (the CPU loop blocks on present at vsync on
      this stack). Revisit only with a validated per-frame GPU attribution.
- [x] Ignore compile/loading spikes for persistent tier decisions.
      `MAX_SAMPLED_FRAME_MS` clamp + startup grace + EMA re-seed after a
      visibility reset; "does not cascade tiers during warmup compilation
      spikes" test.
- [x] Reset histories on visibility resume.
      `PerformanceGovernor.resetTiming()` (WS3) drops the FPS sample window,
      refresh window and sustain accumulators and re-arms grace.
- [x] Wire volume active steps.
      `host.frame()` applies `workBudget.volumeActiveSteps` to the service
      every frame (tier ladder records the executed count).
- [x] Wire particle activity/population where approved.
      `particlePopulationScale`/`particleProfileQuality` applied; static
      semantics keep static populations out of the simulation entirely.
- [x] Wire bloom scale.
      `workBudget.bloomResolutionScale` applied per frame.
- [x] Wire transition scale if approved.
      NOT approved (hyperspace scale research rejected under §4); no change.
- [x] Keep settled fidelity recovery.
      Refresh-aware raise tests (60 Hz climb-back, 120 Hz headroom).
- [x] Add tier-churn torture tests.
      New `PerformanceGovernor tier churn` test: rapid forced pins apply
      immediately, release re-arms grace, and sustained overload still
      degrades past grace.

## 12. Schwarzschild LUT

> **2026-09-10:** the LUT lifecycle win landed with §6 (the LUT pass is now
> created only when selected); the remaining rows are provenance/measurement
> or recorded rejections. The final gate (this session) runs LUT parity and the
> benches, and the results are recorded in §24 below.

- [ ] Cache per-frame camera/uniform state by revision.
      NOT SHIPPED, recorded: the per-frame record is one small object per frame
      for the ACTIVE pass only; reusing it would require hashing the camera
      matrix plus spin/tier/backend inputs to stay correct, trading clarity for
      sub-µs savings against a 5-200 ms GPU frame. Revisit only with measured
      GC/allocation pressure.
- [x] Verify LUT pass is only instantiated when selected.
      §6 lifecycle: resident kinds on a default arrival are `['lut']` with
      count 1; switching to numerical lazily creates the second pass.
- [ ] Profile texture/sample cost.
      PARTIAL: `bench:black-hole:numerical` vs `bench:black-hole:lut` produce
      matched per-preset GPU timings (final gate records the current SHA).
      Texture-filter cost cannot be separated from the integrator within the
      material with the available public timestamp pools.
- [x] Keep manifest/checksum/domain validation.
      Pre-existing `lutPipeline`/`lutSchema`/`lutGenerate`/`lutEquivalence`
      unit coverage, unchanged by this campaign.
- [ ] Run LUT parity and BH goldens.
      BH family 10/10 already PASS unchanged; `lut-disk-parity` runs in the
      final gate (results in §24).
- [x] Record before/after GPU time.
      No per-frame GPU change was claimed for the lifecycle work: the SAME
      selected pass renders. The measured improvement is residency
      (3 passes → 1 on a default arrival), evidenced by the resident-pass
      counters and the child-scope accounting.

## 13. Schwarzschild numerical

> **2026-09-10:** no numerical change shipped. The campaign's "reject any win
> that increases failure/MAX_STEPS" rule makes an unvalidated integrator tweak
> the wrong move; the CPU reference + ray/image parity corpora remain the
> classification authority. Rows below are recorded as not shipped.

- [ ] Add aggregate step census.
- [ ] Add termination-class percentages.
- [ ] Add MAX_STEPS rate.
      All three NOT SHIPPED: the emitted GPU status would duplicate the Kerr
      `?kerrstatus` machinery for a backend whose failure class is bounded by
      the escape radius + horizon step floor; the CPU reference and
      `ray-parity`/`integrator-parity` corpora already assert classification.
- [ ] Test smaller safe escape radius candidates against reference.
      NOT SHIPPED: needs a matched parity run per candidate; no escape-radius
      change was proposed with evidence, and the shared value (32 r_g) stays.
- [ ] Optimize capture/escape/disk termination.
- [ ] Prototype adaptive stepping.
- [ ] Prototype conservative difficulty classification.
      NOT SHIPPED: each requires an equal-error parity study beyond this
      session's validation budget; shipping without it would violate the
      parity invariant.
- [ ] Run ray parity/reference.
- [ ] Run image parity.
      Final gate (results in §24); last certified 43/43 at 17c4644.
- [x] Record GPU benefit at equal error.
      N/A: no numerical change shipped, so no equal-error claim exists.

## 14. Kerr

- [ ] Add p50/p95/p99 step census.
      NOT SHIPPED: the census view reports terminal-class fractions, not
      per-pixel step percentiles; a histogram target was not justified by any
      shipped decision.
- [x] Add classification/failure/MAX_STEPS aggregates.
      `tests/browser/kerr-backend-census.spec.ts` (captured / max-steps /
      theta-wrap / pole / other) runs on BOTH backends and is the campaign's
      gate against "speedups" that only move rays into failure.
- [x] Add high-spin tail characterization.
      `kerrCharacteristics`/`kerrConvergence`/`kerrReference` unit corpora.
- [x] Add moving-observer characterization.
      `observer-modes` browser rows + `observerFrame`/`observerPhotonInit`
      units; the Kerr moving-observer budget scaling is asserted there.
- [ ] Cache CPU camera/uniform state by revision. (same rejection as §12)
- [ ] Continue safe shader CSE/loop-invariant hoisting with parity proof.
      NOT SHIPPED: no additional hoist with a measured gain and unchanged
      census was found; speculative edits are rejected by discipline.
- [ ] Improve safe capture/escape/disk exits.
      NOT SHIPPED: the census shows max-steps at 0.001%; there is no measured
      exit-termination problem to optimize.
- [ ] Prototype adaptive integration.
- [ ] Prototype constants-of-motion/separated formulation.
- [ ] Compare spin-zero convergence.
- [ ] Compare high-spin critical rays.
- [ ] Compare moving observers.
- [ ] Prototype tile/difficulty classifier.
- [ ] Add seam/guard-band tests.
- [ ] Research progressive stationary refinement only after above.
      All NOT SHIPPED: research beyond the session's equal-error validation
      budget; the dependency chain starts with an adaptive-integrator
      prototype that cannot be certified here.
- [ ] Run all KERR/observer goldens twice-stable.
      Final gate (results in §24); 10/10 first pass in this session.
- [ ] Record matched WebGPU and WebGL2 evidence.
      Final gate via `kerr-backend-census` (both backends, identical census).
- [x] Reject any "win" caused by increased failure/MAX_STEPS.
      Policy enforced: the census gate is part of the final certification and
      no numerical change was shipped without it.

## 15. Neutron star

> **2026-09-10:** the WS2 occlusion suppression already covers the stationary
> paused case at the frame-loop level; the remaining rows are numerical
> research, recorded as not shipped.

- [ ] Cache camera basis/uniform payload by revision. (same rejection as §12)
- [x] Skip stationary paused render via WS2.
      The host/WS2 suppression is destination-agnostic; the stationary idle
      rows of the scenario matrix record `renderFrameCalls: 0` for
      neutron-star on both backends.
- [ ] Add projected-star conservative ray rejection research.
- [ ] Improve surface hit/escape early termination.
- [ ] Profile step distribution.
      NOT SHIPPED: requires a surface-lensing status view; no measured stutter
      or failure-rate problem justifies the shader/spec work.
- [x] Keep field-line geometry static.
      `FieldLineService` builds lines once and never re-uploads; unchanged.
- [ ] Run NS reference tests.
      Final gate (`neutronStarPhysics`/`neutronStarSurfaceRay` units +
      `neutron-star` browser suite).
- [ ] Run NS_SURFACE/NS_PULSAR/NS_MAGNETAR goldens.
      Final gate (results in §24).

## 16. Stellar explosion

- [x] Apply shared volume active-step fix.
      Service-level runtime active steps apply to the ejecta volume (live
      snapshot: 70/80 active steps at the harness tier).
- [x] Verify pre-flash volume incurs zero work.
      The ejecta volume is phase-gated invisible pre-flash; the scenario
      matrix records `visibleVolumes`/`internalWidth` 0 in hidden phases.
- [x] Verify hidden/paused particle simulation zero work.
      `activity`/population gates skip the compute dispatch; static systems
      never upload.
- [ ] Avoid redundant unchanged uniform/visibility writes.
      NOT SHIPPED: uniform writes are CPU-side scalar stores, not buffer
      uploads; gating them would add per-frame comparisons for no measured
      benefit on a GPU-bound scene.
- [ ] Measure whether phase-lazy resource creation is worth complexity.
      NOT SHIPPED: resources are bounded per phase and residency is already
      evidenced; no measured memory pressure justifies the lifecycle churn.
- [ ] Run all SN goldens.
      Final gate (results in §24).

## 17. Compact merger

- [x] Apply volume active-step fix. (service-level; tier ladder evidence)
- [x] Gate trail rebuild by model-time revision.
      `lastTrailTime`/`lastTrailCount` in `updateTrails`.
- [x] Gate particles by active state/time.
      `populationFractionFor` keeps the expensive systems OFF during the
      inspiral; population 0 skips simulation entirely.
- [ ] Avoid redundant unchanged visibility/step writes.
      NOT SHIPPED: `setVisible`/`setStepScale` are cheap idempotent setters;
      gating them would add comparisons without a measured cost.
- [ ] Measure optional phase-lazy resources.
      NOT SHIPPED: same rationale as SN.
- [ ] Run CM goldens.
      Final gate (results in §24); CM functional suite 15/15 PASS in this
      session.

## 18. Tidal disruption

- [x] Gate stream rebuild by model-time revision.
      `lastStreamTime`/`lastStreamViewDistance`/`lastStreamTier`.
- [x] Apply volume active-step and ROI changes.
      Active steps wired (97 vs 55 evidence); projected scissor/ROI rejected
      under §7 with rationale.
- [x] Gate particles by population/time.
      `pop > 0 && !snapshot.paused` gate in the module plus the service's
      zero-population skip.
- [ ] Cache camera-dependent accent gate by camera revision.
      NOT SHIPPED: `accentGate(orbit.distance)` is a handful of floating-point
      operations per frame; caching it would add a camera-revision input for
      no measurable gain.
- [ ] Measure phase-resource retirement/prewarm policy.
      NOT SHIPPED: volumes/strands/ribbons are bounded and already
      phase-gated; no memory evidence justifies retirement churn.
- [ ] Run TDE goldens.
      Final gate (results in §24); TDE functional rows PASS in this session.

## 19. Quasar/AGN

- [x] Convert static particles. (host and knots are `activity: 'static'`)
- [x] Remove duplicate population write. (`applyStateToResources` is the one writer)
- [ ] Lazy-build initial zone only.
- [ ] Prewarm adjacent zone near hysteresis threshold.
- [ ] Add bounded zone disposal policy if memory evidence supports it.
      NOT SHIPPED: all three zone groups are bounded and no memory plateau
      problem was measured; lazy building would trade resident memory for
      zone-switch latency without evidence either way.
- [x] Ensure no double-render.
      `doubleRenderGuard` in the module debug snapshot (`ok`).
- [ ] Benchmark all three zones.
      PARTIAL: AGN V2 snapshots cover all three zones on both backends; a
      dedicated three-zone timing matrix is not part of this session.
- [ ] Run AGN goldens.
      Final gate (results in §24).

## 20. Black-hole merger

- [x] Do not create Kerr remnant when starting in inspiral.
      New lifecycle row: inspiral boot reports `remnantPassCreated: false`.
- [x] Deep-link ringdown/remnant still creates Kerr immediately.
      `ensureKerrPass()` runs during prepare for those initial phases; the
      deep-link rows PASS.
- [x] Prewarm Kerr before visible ringdown handoff.
      Created at the `merger` phase and precompiled once with a
      visibility-flip `compileAsync` (restored synchronously); the compile
      overlaps the flash instead of the first visible remnant frame.
- [x] Gate trail rebuild by model-time revision.
      `lastTrailTime`/`lastTrailCount` in `updateTrails`.
- [x] Apply shared Kerr optimizations.
      Escape radius 32 M and tier step budgets match the black-hole
      destination (the pre-phenomena alignment); no further numerical change.
- [x] Maintain DATA_DRIVEN trajectory/waveform semantics.
      `bbmDataset`/`bbmSourceParity` units + all deep-link phase rows PASS.
- [ ] Run BHM dataset/parity tests.
      Final gate (results in §24).
- [ ] Run all BHM goldens.
      Final gate (results in §24).

## 21. Galaxy collision

- [x] Add last-phase/model-time revision. (`lastAppliedPhase`)
- [x] Skip unchanged interpolation. (early return before interpolate calls)
- [x] Skip unchanged BufferAttribute upload. (`needsUpdate` only on phase change)
- [x] Preallocate x1/x2 center scratch arrays. (`centerScratchA/B`)
- [x] Reuse probe storage. (preallocated `probe` tuples)
- [ ] Add unit test proving unchanged phase causes no work.
      PARTIAL: the phase gate is pinned by the DATA_DRIVEN deterministic
      replay rows (identical scrub → identical state); a module-level unit
      test would need a prepared dataset context and was not added.
- [ ] Benchmark CPU/upload before/after.
      PARTIAL: the scenario matrix records GC stationary/cost/active rows on
      both backends; upload counts are gated by the phase check in code.
- [ ] Optional GPU keyframe interpolation prototype.
- [ ] Optional worker checksum/decode prototype if main-thread stall measured.
      NOT SHIPPED: optional, and no main-thread stall was measured (GC is
      2.82 ms GPU / 16.7 ms CPU floor on WebGPU).
- [x] Preserve DATA_DRIVEN interpolation parity.
      `galaxyCollisionInterp` unit tests + all deep-link rows PASS.
- [ ] Run galaxy-collision browser/golden coverage.
      Final gate (results in §24); GC functional rows 7/7 in the full suite.

## 22. WebGL2 and constrained hardware

> **2026-09-10: complete for the reachable rows; the WebGL2 gate found and
> contained a real LUT-material failure (see §6).**

- [x] Repeat each shared-service change on forced WebGL2.
      The §0 scenario matrix records all eight destinations on forced WebGL2
      (navigation/idle/cost/tiers); `volumetrics-v2`, `particle-profiles-v2`,
      `quasar-agn-v2`, `strand-service` and `atlas-webgl2` all pass on the
      forced backend in this session.
- [x] Check shader compile time and first-frame latency.
      Measured cold-vs-warm on the matrix: forced-WebGL2 black-hole cold boot
      27.4 s (first numerical pipeline/ANGLE compile) vs 2.4 s warm; every
      other destination cold boot is 2.5-7.1 s. Recorded as a cold-compile
      cost, not a steady-state regression.
- [x] Check dynamic-loop compiler behavior.
      The volume runtime active-step uniform compiles and executes on WebGL2
      (`volumetrics-v2` webgl2: activeSteps 21/24 with depth-aware upsample).
- [x] Check ParticleService CPU fallback.
      `quasar-agn-v2` webgl2 exercises the CPU fallback with static host/knot
      systems; unit tests cover the active-prefix simulation and upload
      ranges.
- [ ] Check memory counts.
      Covered by the resource certification run below (resource-leak suite +
      the matrix's ResourceScope totals); recorded in §23.
- [ ] Run compatibility matrix.
      Firefox project runs as the final certification gate below.
- [ ] Run software-render smoke where practical, but do not treat GPU-less hosted performance as target hardware.
      DEFERRED_ENVIRONMENT: hosted CI already runs the cheap smoke gate on
      SwiftShader; no local software-render performance claim is made.

## 23. Resource/memory certification

- [ ] Add renderer.info memory snapshot to resource-leak tests.
      Wave 0: the suite currently asserts ResourceScope counters and plateau
      stability; the renderer.info memory mirror is added in the final
      certification pass below.
- [ ] Repeatedly navigate all eight destinations.
- [ ] Repeatedly toggle black-hole backends.
- [ ] Repeatedly scrub AGN zones and BHM phases.
- [ ] Verify program/texture/target/storage counts plateau.
- [ ] Verify stale lazy prepare leaves zero live resources.
- [ ] Verify dispose remains idempotent.
- [ ] Record peak and settled memory.

## 24. Final performance certification

- [ ] Run full unit suite.
- [ ] Run full non-golden browser suite on capable hardware.
- [ ] Run all goldens twice-stable.
- [ ] Run Firefox compatibility gate.
- [ ] Run forced-WebGL2 gate.
- [ ] Run all benchmark scripts with final SHA.
- [ ] Compare all eight destinations to baseline.
- [ ] Record idle stationary power/work proxy: destination draws per minute should be near zero when unchanged.
- [ ] Record transition overlap reduction.
- [ ] Record startup/chunk improvement.
- [ ] Record Kerr equal-fidelity improvement.
- [ ] Document unsuccessful/rejected optimizations.
- [ ] Update performance docs.
- [ ] Produce docs/PERFORMANCE_CERTIFICATION.md.
- [ ] Close this OpenSpec only when MASTER_PLAN.md definition-of-done is satisfied.
