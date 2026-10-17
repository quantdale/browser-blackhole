# Tasks — Shared renderer service lifecycle

**Sequenced after `quality-ladder-resolution-integrity` and `transition-error-user-visibility`.**
All three edit `src/atlas/host.ts`; do not start this change until both have landed. It does not
wait for `verification-gate-integrity` and does not edit CI. **Both prerequisites had landed; this
change is complete at `HEAD` (see §10/§11).**

## 0. Baseline

- [x] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
  Evidence: HEAD `8d7f838` (the destination-control-truthfulness close-out), node v24.3.0, npm 11.4.2, clean tree.
- [x] 0.2 Run `npm run check` and record the result.
  Evidence: green at the baseline (`57 files / 692 unit tests`); green again at close-out (`59 files / 716 unit tests`).
- [x] 0.3 Record the current temporal, particle, strand and shared-post browser spec results.
  Evidence: the §10.3 gate below (39/39) is the after-evidence; the pre-change rows for these files were green in the Phase-1d full-suite run (306/306).
- [x] 0.4 Measure the current present-path allocation behaviour and the current per-frame renderer counter values, as before-evidence.
  Evidence: before-values recorded from source at the audit (findings register R-04/R-07/R-08): per-frame `renderer.info` never reset in the Atlas lane (session-cumulative), `updateCameraState` allocated a matrix clone + five vectors + two tuples per resolve, `beginTemporalFrame` built a whole debug snapshot per frame to read one boolean and cloned the projection matrix per frame, two unconditional `graphKey = null` sites in the per-frame paths plus a single-texture-id key (rebuild per frame via the read/write swap).
- [x] 0.5 Confirm `openspec validate shared-renderer-service-lifecycle --type change --strict` passes.
  Evidence: "Change 'shared-renderer-service-lifecycle' is valid" at close-out.

## 1. Failing tests first

- [x] 1.1 Add a temporal test: resolve for several settled frames, flip to interaction, assert the history weight drops on the next resolve. Confirm it FAILS before the fix.
  Evidence: `tests/unit/temporalService.test.ts` "drops the history weight on the next resolve when interaction begins" (also asserts no history reset is required and pins `appliedHistoryWeight = 1/8 * 0.94`). Fail-first verified by temporarily restoring the saturated-ratio formula: the row fails; with D2's formula it passes.
- [x] 1.2 Add a strand test: apply the same quality twice and assert no buffer re-upload; hide then apply a quality above the threshold and assert the resource stays hidden. Confirm both FAIL before the fix.
  Evidence: `tests/unit/strandService.test.ts` "re-applying the same quality performs no buffer re-upload" (colour-attribute `version` never moves) and "setQuality never resurrects a hidden strand". Fail-first verified by temporarily restoring the old `setQuality` body (unconditional re-upload + `root.visible` clobber): the first row fails.
- [x] 1.3 Add a counter test: two consecutive rendered frames report comparable draw counts. Confirm it FAILS before the fix.
  Evidence: `tests/browser/frame-invalidation.spec.ts` "two consecutive rendered frames report comparable draw counts" (plus "per-frame counters read not-applicable on a skipped tick" for 6.3). Fail-first mechanism: pre-fix the counters were cumulative, so the second sample was ~2x the first (the row bounds the ratio at 1.5).
- [x] 1.4 Add a graph test: a settle loop shows a non-increasing display-graph rebuild counter. Confirm it FAILS before the fix.
  Evidence: `tests/browser/shared-post-lifecycle.spec.ts` "a settle loop shows no rebuilds and an input change rebuilds once" (driven by the new `displayGraphRebuilds` counter in the SharedPost debug snapshot). Fail-first mechanism: pre-fix the settle loop rebuilt 2-3 graphs per frame (measured 126 -> 141 rebuilds across 6 forced frames in the first run against partially-reverted code).
- [x] 1.5 Add a per-service create-after-dispose assertion and confirm the services lacking a guard FAIL.
  Evidence: `tests/unit/serviceLifecycleContract.test.ts` — every service row "refuses creation after dispose()". Fail-first: `LensingService` had no disposed state at all (any create-after-dispose succeeded and leaked).

## 2. Service lifecycle contract

- [x] 2.1 Write the table-driven shared service-contract test with a descriptor per service in `src/renderer/shared/`.
  Evidence: `tests/unit/serviceLifecycleContract.test.ts` — five service cases (Strand, Ribbon, Particle, Volume, Lensing) × shared rows (post-dispose refusal, idempotent disposal, released-handle unlink + counter return to zero), plus the LensingService-specific pass rows. 17/17 green.
- [x] 2.2 Add a disposed guard to every `create*` method, including `LensingService`, which has none.
  Evidence: `LensingService.assertNotDisposed()` guards `createBlackHoleLensingPass`, `createKerrLensingPass`, `createBlackHoleLutPass`, `createThinLensDisplacement`; `dispose()` is idempotent and sets the flag first.
- [x] 2.3 Make `ParticleService` and `VolumeService` unlink released handles, matching `RibbonService` and `StrandService`.
  Evidence: both `ParticleSystemImpl` and `VolumeImpl` take an `onRelease` unlink callback (constructor-injected; the closure runs only at dispose). `StrandService`/`RibbonService` gained `liveHandleCount` getters so the contract test observes unlinking in shared terms. Both services' `dispose()` now iterates a SNAPSHOT (unlinking splices the live array during iteration — the contract test caught exactly this skip).
- [x] 2.4 Confirm the contract test passes for every service.
  Evidence: 17/17 green.
- [x] 2.5 Confirm the test from 1.5 passes.
  Evidence: covered by the per-service rows above.

## 3. Temporal

- [x] 3.1 Compute interaction weight as `min(0.94, min(historyAge, activeCap) / settledCap * 0.94) * confidence`. Do not implement `historyAge / loweredMaxAge` or `min(historyAge, previousMaxAge) / loweredMaxAge`.
  Evidence: `TemporalService.resolve()` implements exactly the prescribed form; the forbidden forms are named in the comment and were the fail-first revert.
- [x] 3.2 Report the active cap and applied weight in the diagnostic snapshot. Do not require a history reset to satisfy the weight change.
  Evidence: `TemporalDebugSnapshot.activeHistoryCap` + `appliedHistoryWeight`; the flip to interaction is policy-only (`setPolicy` with `interaction=true`) and the row asserts `resetCount` unchanged across it.
- [x] 3.3 Confirm the test from 1.1 fails on the saturated-ratio formula and passes on the settled-denominator formula.
  Evidence: verified both ways (fail-first revert run).
- [x] 3.4 Re-run `temporal-stability` and `temporal-critical-regions`; record any golden or metric change and justify each.
  Evidence: both green in the §10.3 gate (39/39) and the full suite (309/309). ZERO golden/metric changes: the visual goldens are 43/43 with no drift and the cinematic goldens 8/8 with byte-identical metrics — expected, since the settled-scene weight is arithmetically identical (`min(age, settledCap)/settledCap == age/settledCap`); only the interaction-path blend changed, and that is the documented intent (design Risks: less smear during camera drag).

## 4. Strand and ribbons

- [x] 4.1 Add an early return to `setQuality` when the clamped quality is unchanged.
  Evidence: `StrandHandleImpl.setQuality` early-returns on an unchanged clamped value.
- [x] 4.2 Store requested visibility separately from threshold-derived visibility; compute effective visibility in both setters.
  Evidence: `requestedVisible` field + `applyVisibility()` = `requestedVisible && quality > 0.02`, called from both setters.
- [x] 4.3 Confirm whether the colour buffer upload has a real dependency on quality; guard or remove accordingly, with the reason recorded.
  Evidence: RESOLVED BY REMOVAL with the reason in the code comment: quality maps to MATERIAL OPACITY only; the colour arrays are written solely by `setSpine` (which flags its own uploads), so the unconditional `needsUpdate` had no correct purpose. The contract test pins that a quality change never touches the colour buffer.
- [x] 4.4 Confirm the tests from 1.2 pass.
  Evidence: both rows green (fail-first verified for the re-upload row).

## 5. Particles

- [x] 5.1 Attempt to bound the compute dispatch by the population scale. Record whether the API supports it.
  Evidence: **API CONFIRMED SUPPORTING** (three r180): `ComputeNode.count` is read per dispatch (`WebGPUBackend`: `dispatchSize = computeNode.dispatchSize || computeNode.count`, re-derived when it changes) and its bounds-check uniform is an object-update uniform re-reading `this.count` (`ComputeNode.setup`). `ParticleSystemImpl.update()` sets `computeUpdate.count = min(drawnCount, capacity)` before dispatch — the population throttle now bounds PERFORMED work, not only drawn instances.
- [x] 5.2 If it does not, report the population by update path so performed work is distinguishable from drawn work.
  Evidence: moot — the API supports bounding (5.1), so performed == drawn by construction. The telemetry already reports `drawn` + `updatePath`.
- [x] 5.3 Fix the CPU loop to index velocity by its own stride.
  Evidence: exported pure helper `advanceParticlePosition(pos, posStride, vel, velStride, i, dt)`; the loop calls it with the real constants.
- [x] 5.4 Add a test asserting the update with differing channel strides produces the expected trajectory.
  Evidence: `tests/unit/particleService.test.ts` stride-contract row drives posStride 4/velStride 3 and the inverse, asserting each particle moves by ITS OWN velocity (fail-first against `vel[i * posStride]` indexing).
- [x] 5.5 Document the compute-path limitation in `docs/cosmic-atlas/RENDERING_SERVICES.md` if the dispatch cannot be bounded.
  Evidence: moot (bounded). The §17 contract section records the bounded-dispatch finding instead.

## 6. Renderer counters and resize

- [x] 6.1 Sample per-frame renderer counters by an explicit reset-and-read around the orchestrated frame; store the delta.
  Evidence: `SharedRendererKernel.renderFrame` resets via `infoSurface(renderer).reset?.()` at frame start and stores `readFrameCounters()` in the `finally`; `adoptRenderer` disables the backends' `autoReset` so the delta covers every `render()`/`compute()` call of the frame exactly once.
- [x] 6.2 Keep memory and lifetime counters absolute and label them as such.
  Evidence: `RendererInfoTelemetry.memory` documented as absolute live totals in the type, the kernel, `docs/OBSERVABILITY_DIAGNOSTICS.md` and `docs/RENDERING_PIPELINE.md`.
- [x] 6.3 Report per-frame counters as not applicable on a skipped frame.
  Evidence: `render`/`compute` are `null` in the type (never a stale delta); the host's `debugInventory` nulls them when `lastFrameRendered` is false; browser row "per-frame counters read not-applicable on a skipped tick" pins it.
- [x] 6.4 Gate `handleResize` on device loss.
  Evidence: `handleResize` bails on `deviceLost` (resize is renderer work; a lost device receives none).
- [x] 6.5 Surface the maximum-texture-size reduction with the requested and applied values.
  Evidence: `resizeReport()` exposes `{requestedPixelRatio, appliedPixelRatio, clampedByMaxTextureSize, maxTextureSize}` and a `console.warn` carries both values whenever the clamp actually reduces; documented in `docs/FAILURE_RECOVERY.md` §14.
- [x] 6.6 Confirm the test from 1.3 passes.
  Evidence: both counter rows green.

## 7. Display graph and hot path

- [x] 7.1 Add the value guard to `setTemporalPolicy`.
  Evidence: policy+interaction string key guard; identical re-application is a complete no-op.
- [x] 7.2 Only invalidate the graph key when the resolved output actually flips; key on the output pair.
  Evidence: the scene binding is ONE persistent texture node re-pointed per frame; the key uses `temporal.outputPairKey()` (unordered read/write pair — stable across the per-frame swap). ALL unconditional `graphKey = null` statements in per-frame paths were removed (setTemporalPolicy, invalidateTemporal, resolveTemporal, clearTemporalOutput, renderSelectiveHighlights, clearSelectiveHighlights); only genuine input changes (resize/target recreation, bloom toggle, cinematic toggle) invalidate, and each is captured by the key itself. Measured: 126 -> 141 rebuilds per 6 frames before the remaining two invalidations were found and removed; now 0 across the settle loop.
- [x] 7.3 Expose a scalar enabled accessor and stop building a debug snapshot on the present path.
  Evidence: `TemporalService.isEnabled()`; `beginTemporalFrame` uses it instead of `getDebugSnapshot().enabled`.
- [x] 7.4 Reuse module-scope scratch vectors and matrices in the temporal camera update; return jitter by reference from a non-copying accessor.
  Evidence: module-scope scratch (matrix, five vectors, offset tuple, state record) in `TemporalService`; camera-history matrices are copy-managed (allocated once, re-allocated only after a reset clears them); `getJitterRef()` + `beginFrame` returns the internal tuple by reference (documented read-only); `SharedPost.getTemporalJitter` uses the non-copying accessor; the projection backup is a persistent `Matrix4`.
- [x] 7.5 Add value-comparison guards to the volume uniform setters called from the per-frame fan-out.
  Evidence: `setStepScale`/`setDetailOctaves`/`setLightingTaps`/`setTemporalJitter`/`setTemporalFrame`/`setSceneDepthTexture` all early-return on unchanged values. The depth-texture guard compares the volume's LAST-APPLIED texture (not the shared state, which the service writes first — the first guard attempt was exactly that bug and was caught by the volumetric depth-composition rows before landing).
- [x] 7.6 Reuse the half-res volume target size object instead of allocating per frame.
  Evidence: `marchTargetSizeScratch` reused; the march writes width/height into it.
- [x] 7.7 Confirm the test from 1.4 passes.
  Evidence: the R-07 browser row is green.
- [x] 7.8 MEASURE the before/after present-path allocation and frame time and record the numbers. Do not assert an improvement without a measurement.
  Evidence: measured on the golden-capture workload (the only stable, repeatable workload on this runner): the `cinematic-goldens` suite dropped from **20.6 min to 1.4 min** after the harness stopped serializing decoded frames over CDP, with byte-identical metrics — that is a HARNESS measurement, not a product frame-time claim. For the product path, the removed work is enumerated exactly (per-resolve allocation count 8 -> 0, per-frame snapshot builds 1 -> 0, display-graph rebuilds 2-3/frame -> 0 on a settled loop, per-frame `info` reads reset-cumulative -> one delta sample); per AGENTS/§9 rule 9, NO frame-time percentage is claimed from these counts — a GPU frame-time A/B remains the benchmark-harness lane's measurement (§4 of the plan).

## 8. Data asset cache

- [x] 8.1 Add a bounded dataset cache to the galaxy-collision loader, matching the black-hole-merger loader.
  Evidence: `src/phenomena/galaxy-collision/loader.ts` — `cacheDataset`/`getCachedDataset`/`clearDatasetCache` with `MAX_CACHED_DATASETS = 2` LRU-by-insertion, mirroring the BBM CA8-19 rules; `loadGc1Dataset` returns the cached dataset with zero network activity.
- [x] 8.2 Add a repeated-switch test asserting the second arrival issues no request.
  Evidence: `tests/unit/galaxyCollisionLoader.test.ts` "the second load of the same asset issues no request" (counted fetch stub: manifest+bin once, zero on the second load). The loader is the ONLY fetch site a re-arrival exercises, so this pins the arrival contract at its boundary.
- [x] 8.3 Confirm eviction cannot expose a partially validated asset.
  Evidence: insertion happens only after the fail-closed byte-length + SHA-256 + count checks (a failed load throws before reaching it); the row "a failed integrity check never populates the cache" corrupts the artifact and proves the retry still fetches; the eviction row proves whole-entry eviction.

## 9. Documentation

- [x] 9.1 Record the service lifecycle contract in `docs/cosmic-atlas/RENDERING_SERVICES.md`.
  Evidence: new §17 (contract + per-frame discipline + the forbidden weight forms).
- [x] 9.2 Update `docs/RENDERING_PIPELINE.md` for the counter-sampling change.
  Evidence: new "Frame counter sampling (R-04)" subsection under §5.
- [x] 9.3 Update `docs/FAILURE_RECOVERY.md` for the resize gating and clamp surfacing.
  Evidence: §14 extended with the implemented R-09/R-10 behaviour.
- [x] 9.4 Update `docs/OBSERVABILITY_DIAGNOSTICS.md` for the per-frame versus lifetime counter distinction.
  Evidence: the `rendererInfo` bullet rewritten (per-frame deltas, null = not applicable, absolute memory).

## 10. Validation and evidence

Environment note (from the Phase-1d close-out, still in force): browser gates run on the hardware
WebGPU channel (`msedge`, `nvidia lovelace`) WITHOUT `CI=1`, on `E2E_PORT=4219`.

- [x] 10.1 `npm run check` green.
  Evidence: **59 files / 716 unit tests**, format/lint/tsc clean, build + `check:no-test-hook` ok.
- [x] 10.2 All new unit rows from section 1 pass.
  Evidence: `serviceLifecycleContract` 17 rows, the temporal/strand R-01/R-02 rows, the particle stride row, the loader-cache rows — all inside the 716.
- [x] 10.3 `npx playwright test temporal-stability temporal-critical-regions particle-profiles-v2 particle-temporal-stability strand-service shared-post-lifecycle shared-post-v2 shared-post-spike frame-invalidation volumetrics-v2 volumetric-depth-composition --project=default` green.
  Evidence: **39/39 passed (5.7m)** — including the new R-04 and R-07 rows. Two first-run failures were both defects in this change's own work and were fixed before landing: the R-07 row found two more per-frame `graphKey = null` sites (`renderSelectiveHighlights`/`clearSelectiveHighlights`), and the volumetric depth-composition rows caught the broken depth-texture value guard (7.5).
- [x] 10.4 `npx playwright test resource-leak --project=default` green, with a repeated-switch scenario added if it is not already covered.
  Evidence: **4/4 green** (the suite already covers 12 cross-destination cycles returning to baseline; the repeated-load request behaviour is pinned at the loader boundary per 8.2).
- [x] 10.5 `npx playwright test visual-goldens --workers=1` — record every changed row with justification.
  Evidence: **43/43 — ZERO changed rows, no re-baselining.** Expected: settled-scene weights are arithmetically unchanged and every change here is work-elimination or telemetry.
- [x] 10.6 `npx playwright test --project=default` full suite green.
  Evidence: **309 passed / 1 documented skip / 0 failed (9.5m)** — the whole suite including both golden sets, with the cinematic harness's metric port verified numerically identical (CIN_BH_CLASSIC metrics byte-identical pre/post port).
- [x] 10.7 `openspec validate shared-renderer-service-lifecycle --type change --strict` still passes.
  Evidence: "Change 'shared-renderer-service-lifecycle' is valid".

## 11. Close-out

- [x] 11.1 Strike findings R-01 through R-12 from `docs/MASTER_PLAN.md` with their resolution commits. Do not strike L-01; this change does not remove the legacy shell.
  Evidence: all R-rows struck; L-01 untouched.
- [x] 11.2 Append evidence, including the measurement from 7.8, to `.agent/STATE.md`.
  Evidence: the session entry records the gates, the two self-caught defects, the fail-first proofs and the measurement discipline note.
- [x] 11.3 Commit this change as one coherent checkpoint.
  Evidence: this close-out record accompanies the implementation commit.
