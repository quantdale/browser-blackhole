# Tasks — Shared renderer service lifecycle

**Sequenced after `quality-ladder-resolution-integrity`** (both edit `src/atlas/host.ts`) and after
`verification-gate-integrity` (whose contract-test conventions this change reuses).

## 0. Baseline

- [ ] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [ ] 0.2 Run `npm run check` and record the result.
- [ ] 0.3 Record the current temporal, particle, strand and shared-post browser spec results.
- [ ] 0.4 Measure the current present-path allocation behaviour and the current per-frame renderer counter values, as before-evidence.
- [ ] 0.5 Confirm `openspec validate shared-renderer-service-lifecycle --type change --strict` passes.

## 1. Failing tests first

- [ ] 1.1 Add a temporal test: resolve for several settled frames, flip to interaction, assert the history weight drops on the next resolve. Confirm it FAILS before the fix.
- [ ] 1.2 Add a strand test: apply the same quality twice and assert no buffer re-upload; hide then apply a quality above the threshold and assert the resource stays hidden. Confirm both FAIL before the fix.
- [ ] 1.3 Add a counter test: two consecutive rendered frames report comparable draw counts. Confirm it FAILS before the fix.
- [ ] 1.4 Add a graph test: a settle loop shows a non-increasing display-graph rebuild counter. Confirm it FAILS before the fix.
- [ ] 1.5 Add a per-service create-after-dispose assertion and confirm the services lacking a guard FAIL.

## 2. Service lifecycle contract

- [ ] 2.1 Write the table-driven shared service-contract test with a descriptor per service in `src/renderer/shared/`.
- [ ] 2.2 Add a disposed guard to every `create*` method, including `LensingService`, which has none.
- [ ] 2.3 Make `ParticleService` and `VolumeService` unlink released handles, matching `RibbonService` and `StrandService`.
- [ ] 2.4 Confirm the contract test passes for every service.
- [ ] 2.5 Confirm the test from 1.5 passes.

## 3. Temporal

- [ ] 3.1 Compute the effective history weight relative to the cap in effect while the history was accumulated.
- [ ] 3.2 Record the interaction-cap transition in the reset-reason ring.
- [ ] 3.3 Confirm the tests from 1.1 pass.
- [ ] 3.4 Re-run `temporal-stability` and `temporal-critical-regions`; record any golden or metric change and justify each.

## 4. Strand and ribbons

- [ ] 4.1 Add an early return to `setQuality` when the clamped quality is unchanged.
- [ ] 4.2 Store requested visibility separately from threshold-derived visibility; compute effective visibility in both setters.
- [ ] 4.3 Confirm whether the colour buffer upload has a real dependency on quality; guard or remove accordingly, with the reason recorded.
- [ ] 4.4 Confirm the tests from 1.2 pass.

## 5. Particles

- [ ] 5.1 Attempt to bound the compute dispatch by the population scale. Record whether the API supports it.
- [ ] 5.2 If it does not, report the population by update path so performed work is distinguishable from drawn work.
- [ ] 5.3 Fix the CPU loop to index velocity by its own stride.
- [ ] 5.4 Add a test asserting the update with differing channel strides produces the expected trajectory.
- [ ] 5.5 Document the compute-path limitation in `docs/cosmic-atlas/RENDERING_SERVICES.md` if the dispatch cannot be bounded.

## 6. Renderer counters and resize

- [ ] 6.1 Sample per-frame renderer counters by an explicit reset-and-read around the orchestrated frame; store the delta.
- [ ] 6.2 Keep memory and lifetime counters absolute and label them as such.
- [ ] 6.3 Report per-frame counters as not applicable on a skipped frame.
- [ ] 6.4 Gate `handleResize` on device loss.
- [ ] 6.5 Surface the maximum-texture-size reduction with the requested and applied values.
- [ ] 6.6 Confirm the test from 1.3 passes.

## 7. Display graph and hot path

- [ ] 7.1 Add the value guard to `setTemporalPolicy`.
- [ ] 7.2 Only invalidate the graph key when the resolved output actually flips; key on the output pair.
- [ ] 7.3 Expose a scalar enabled accessor and stop building a debug snapshot on the present path.
- [ ] 7.4 Reuse module-scope scratch vectors and matrices in the temporal camera update; return jitter by reference from a non-copying accessor.
- [ ] 7.5 Add value-comparison guards to the volume uniform setters called from the per-frame fan-out.
- [ ] 7.6 Reuse the half-res volume target size object instead of allocating per frame.
- [ ] 7.7 Confirm the test from 1.4 passes.
- [ ] 7.8 MEASURE the before/after present-path allocation and frame time and record the numbers. Do not assert an improvement without a measurement.

## 8. Data asset cache

- [ ] 8.1 Add a bounded dataset cache to the galaxy-collision loader, matching the black-hole-merger loader.
- [ ] 8.2 Add a repeated-switch test asserting the second arrival issues no request.
- [ ] 8.3 Confirm eviction cannot expose a partially validated asset.

## 9. Documentation

- [ ] 9.1 Record the service lifecycle contract in `docs/cosmic-atlas/RENDERING_SERVICES.md`.
- [ ] 9.2 Update `docs/RENDERING_PIPELINE.md` for the counter-sampling change.
- [ ] 9.3 Update `docs/FAILURE_RECOVERY.md` for the resize gating and clamp surfacing.
- [ ] 9.4 Update `docs/OBSERVABILITY_DIAGNOSTICS.md` for the per-frame versus lifetime counter distinction.

## 10. Validation and evidence

- [ ] 10.1 `npm run check` green.
- [ ] 10.2 All new unit rows from section 1 pass.
- [ ] 10.3 `npx playwright test temporal-stability temporal-critical-regions particle-profiles-v2 particle-temporal-stability strand-service shared-post-lifecycle shared-post-v2 shared-post-spike frame-invalidation volumetrics-v2 volumetric-depth-composition --project=default` green.
- [ ] 10.4 `npx playwright test resource-leak --project=default` green, with a repeated-switch scenario added if it is not already covered.
- [ ] 10.5 `npx playwright test visual-goldens --workers=1` — record every changed row with justification.
- [ ] 10.6 `npx playwright test --project=default` full suite green.
- [ ] 10.7 `openspec validate shared-renderer-service-lifecycle --type change --strict` still passes.

## 11. Close-out

- [ ] 11.1 Strike findings R-01 through R-12 and L-01 from `docs/MASTER_PLAN.md` with their resolution commits.
- [ ] 11.2 Append evidence, including the measurement from 7.8, to `.agent/STATE.md`.
- [ ] 11.3 Commit this change as one coherent checkpoint.
