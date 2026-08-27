# Tasks: Whole-Atlas performance optimization

Mark a task complete only with benchmark and correctness evidence. A code change without evidence remains unchecked.

## 0. Baseline and audit evidence

- [ ] Record start SHA and dirty-state check.
- [ ] Record Node/npm/Three.js/Vite/Playwright versions.
- [ ] Create current per-destination WebGPU benchmark matrix.
- [ ] Create forced-WebGL2 capable-runner matrix.
- [ ] Record internal pixel sizes, tier, render scale and adapter for every row.
- [ ] Record renderer.info render/compute/memory counters.
- [ ] Record ResourceManager totals.
- [ ] Record GPU timestamps where available.
- [ ] Record cold navigation and warm navigation for every destination.
- [ ] Record startup bundle/chunk sizes and first-interactive timing.
- [ ] Archive baseline under benchmarks/results with exact SHA.

## 1. Shared telemetry

- [ ] Extend performance snapshot schema.
- [ ] Add render reason/invalidation counters.
- [ ] Add destination update/draw/post executed flags.
- [ ] Add renderer.info frameCalls/drawCalls/primitives.
- [ ] Add renderer.info memory/program/target/storage metrics.
- [ ] Add volume active-step/internal-size telemetry.
- [ ] Add particle active/drawn/simulation telemetry.
- [ ] Add active lensing pass/max-step telemetry.
- [ ] Add transition phase/occlusion telemetry.
- [ ] Add async nonblocking GPU timestamp attribution where supported.
- [ ] Update benchmark JSON schema and scripts.

## 2. Frame invalidation / on-demand rendering

- [ ] Define invalidation reason bitset in atlas types.
- [ ] Add host revision/invalidation state.
- [ ] Wire TimeController changes.
- [ ] Wire CameraRig changes/settling.
- [ ] Wire control changes.
- [ ] Wire resize.
- [ ] Wire quality changes.
- [ ] Wire post/display changes.
- [ ] Wire async asset-ready events.
- [ ] Wire transition changes.
- [ ] Add destination continuous-animation declaration where needed.
- [ ] Skip destination update/render when no reason exists and scene is static.
- [ ] Skip SharedPost present on unchanged frame.
- [ ] Add forceFrame test/debug path.
- [ ] Add wake-on-input tests.
- [ ] Add paused-stationary no-draw test.
- [ ] Confirm all goldens pass.

## 3. Visibility lifecycle

- [ ] Add document visibilitychange policy.
- [ ] Stop nonessential atlas polling/work while hidden.
- [ ] Reset frame/governor timing on resume.
- [ ] Invalidate one frame on resume.
- [ ] Define TimeController hidden-time semantics explicitly.
- [ ] Add hide/resume browser test.

## 4. Transition occlusion and compile warmup

- [ ] Expose fully-occluded state from TransitionDirector.
- [ ] Add kernel destination-draw suppression while fully occluded.
- [ ] Ensure required simulation state can still advance.
- [ ] Add draw-count assertion for occluded interval.
- [ ] Integrate compileAsync for incoming visible subgraph.
- [ ] Ensure stale/cancelled prepare compile cannot activate.
- [ ] Benchmark transition CPU/GPU before/after.
- [ ] Validate reduced-motion path.
- [ ] Validate hyperspace golden.
- [ ] Research lower hyperspace render scale; ship only with visual evidence.

## 5. Startup/code splitting

- [ ] Split lightweight black-hole descriptor/presets from implementation.
- [ ] descriptor.load dynamically imports black-hole implementation.
- [ ] Split lightweight neutron-star descriptor/presets from implementation.
- [ ] descriptor.load dynamically imports neutron-star implementation.
- [ ] Verify other destination descriptors remain lightweight.
- [ ] Compare initial chunks before/after.
- [ ] Compare registry-init and first-interactive timing.
- [ ] Add route/deep-link tests after split.
- [ ] Optional idle prefetch experiment with connection/data-saver guard.

## 6. Black-hole active pass lifecycle

- [ ] Replace eager numerical+LUT+Kerr pass tuple with manager.
- [ ] Initial route creates exactly one selected pass.
- [ ] Keep LUT assets separate from GPU pass instance.
- [ ] Lazy-create alternate pass on actual switch.
- [ ] Add child scope per pass.
- [ ] Add stale creation cancellation.
- [ ] Precompile pending pass where useful.
- [ ] Atomic visible swap.
- [ ] Add bounded recent-pass cache only if toggle benchmark justifies it.
- [ ] Add program/resource-count assertions.
- [ ] Test numerical/LUT/Kerr backend switching.
- [ ] Test missing/bad LUT fallback.
- [ ] Run BH/KERR/observer goldens.

## 7. VolumeService

- [ ] Add benchmark that counts effective sample evaluations.
- [ ] Choose dynamic active-step or tier-specialized design from WebGPU/WebGL2 evidence.
- [ ] Make tier drop reduce executed march iterations.
- [ ] Correct step-length normalization.
- [ ] Preserve early-alpha termination.
- [ ] Reuse renderer-size Vector2 scratch.
- [ ] Skip invisible/zero-gain volume work.
- [ ] Add conservative volume bounds/culling.
- [ ] Prototype projected scissor/ROI and measure.
- [ ] Validate camera-inside-volume.
- [ ] Validate stellar explosion goldens.
- [ ] Validate compact-merger goldens.
- [ ] Validate TDE goldens.
- [ ] Validate AGN goldens.

## 8. ParticleService and static systems

- [ ] Add explicit STATIC/DYNAMIC activity semantics.
- [ ] Zero population causes no simulation dispatch/update.
- [ ] Static population initializes once.
- [ ] CPU fallback avoids unnecessary full-capacity loop/upload.
- [ ] Define deterministic population-resume behavior.
- [ ] Add simulation-dispatch counters/tests.
- [ ] Convert AGN host stars to static.
- [ ] Convert AGN knots to static if visually correct.
- [ ] Remove duplicate host population-scale write.
- [ ] Validate WebGPU compute path.
- [ ] Validate CPU/WebGL2 fallback path.

## 9. Ribbon/buffer revisioning

- [ ] Add caller-side revision gate for compact-merger trails.
- [ ] Add revision gate for black-hole-merger trails.
- [ ] Add revision gate for TDE bound/unbound streams.
- [ ] Avoid needsUpdate when geometry content unchanged.
- [ ] Add conservative ribbon bounds after real spine changes.
- [ ] Enable culling where safe.
- [ ] Benchmark CPU and upload counts.

## 10. SharedPost

- [ ] Integrate invalidation/no-present behavior.
- [ ] Instrument bloom cost separately.
- [ ] Add WorkBudget bloomResolutionScale plumbing.
- [ ] Create bloom-enabled visual regression captures.
- [ ] Test BloomNode lower-resolution variants.
- [ ] Ship only a variant that passes visual review and shows meaningful savings.
- [ ] Keep HDR/tone mapping/color contract unchanged.

## 11. Governor WorkBudget

- [ ] Define WorkBudget type.
- [ ] Map tier/activity to global work knobs.
- [ ] Preserve existing hysteresis.
- [ ] Add GPU-vs-CPU overload classification when telemetry permits.
- [ ] Ignore compile/loading spikes for persistent tier decisions.
- [ ] Reset histories on visibility resume.
- [ ] Wire volume active steps.
- [ ] Wire particle activity/population where approved.
- [ ] Wire bloom scale.
- [ ] Wire transition scale if approved.
- [ ] Keep settled fidelity recovery.
- [ ] Add tier-churn torture tests.

## 12. Schwarzschild LUT

- [ ] Cache per-frame camera/uniform state by revision.
- [ ] Verify LUT pass is only instantiated when selected.
- [ ] Profile texture/sample cost.
- [ ] Keep manifest/checksum/domain validation.
- [ ] Run LUT parity and BH goldens.
- [ ] Record before/after GPU time.

## 13. Schwarzschild numerical

- [ ] Add aggregate step census.
- [ ] Add termination-class percentages.
- [ ] Add MAX_STEPS rate.
- [ ] Test smaller safe escape radius candidates against reference.
- [ ] Optimize capture/escape/disk termination.
- [ ] Prototype adaptive stepping.
- [ ] Prototype conservative difficulty classification.
- [ ] Run ray parity/reference.
- [ ] Run image parity.
- [ ] Record GPU benefit at equal error.

## 14. Kerr

- [ ] Add p50/p95/p99 step census.
- [ ] Add classification/failure/MAX_STEPS aggregates.
- [ ] Add high-spin tail characterization.
- [ ] Add moving-observer characterization.
- [ ] Cache CPU camera/uniform state by revision.
- [ ] Continue safe shader CSE/loop-invariant hoisting with parity proof.
- [ ] Improve safe capture/escape/disk exits.
- [ ] Prototype adaptive integration.
- [ ] Prototype constants-of-motion/separated formulation.
- [ ] Compare spin-zero convergence.
- [ ] Compare high-spin critical rays.
- [ ] Compare moving observers.
- [ ] Prototype tile/difficulty classifier.
- [ ] Add seam/guard-band tests.
- [ ] Research progressive stationary refinement only after above.
- [ ] Run all KERR/observer goldens twice-stable.
- [ ] Record matched WebGPU and WebGL2 evidence.
- [ ] Reject any "win" caused by increased failure/MAX_STEPS.

## 15. Neutron star

- [ ] Cache camera basis/uniform payload by revision.
- [ ] Skip stationary paused render via WS2.
- [ ] Add projected-star conservative ray rejection research.
- [ ] Improve surface hit/escape early termination.
- [ ] Profile step distribution.
- [ ] Keep field-line geometry static.
- [ ] Run NS reference tests.
- [ ] Run NS_SURFACE/NS_PULSAR/NS_MAGNETAR goldens.

## 16. Stellar explosion

- [ ] Apply shared volume active-step fix.
- [ ] Verify pre-flash volume incurs zero work.
- [ ] Verify hidden/paused particle simulation zero work.
- [ ] Avoid redundant unchanged uniform/visibility writes.
- [ ] Measure whether phase-lazy resource creation is worth complexity.
- [ ] Run all SN goldens.

## 17. Compact merger

- [ ] Apply volume active-step fix.
- [ ] Gate trail rebuild by model-time revision.
- [ ] Gate particles by active state/time.
- [ ] Avoid redundant unchanged visibility/step writes.
- [ ] Measure optional phase-lazy resources.
- [ ] Run CM goldens.

## 18. Tidal disruption

- [ ] Gate stream rebuild by model-time revision.
- [ ] Apply volume active-step and ROI changes.
- [ ] Gate particles by population/time.
- [ ] Cache camera-dependent accent gate by camera revision.
- [ ] Measure phase-resource retirement/prewarm policy.
- [ ] Run TDE goldens.

## 19. Quasar/AGN

- [ ] Convert static particles.
- [ ] Remove duplicate population write.
- [ ] Lazy-build initial zone only.
- [ ] Prewarm adjacent zone near hysteresis threshold.
- [ ] Add bounded zone disposal policy if memory evidence supports it.
- [ ] Ensure no double-render.
- [ ] Benchmark all three zones.
- [ ] Run AGN goldens.

## 20. Black-hole merger

- [ ] Do not create Kerr remnant when starting in inspiral.
- [ ] Deep-link ringdown/remnant still creates Kerr immediately.
- [ ] Prewarm Kerr before visible ringdown handoff.
- [ ] Gate trail rebuild by model-time revision.
- [ ] Apply shared Kerr optimizations.
- [ ] Maintain DATA_DRIVEN trajectory/waveform semantics.
- [ ] Run BHM dataset/parity tests.
- [ ] Run all BHM goldens.

## 21. Galaxy collision

- [ ] Add last-phase/model-time revision.
- [ ] Skip unchanged interpolation.
- [ ] Skip unchanged BufferAttribute upload.
- [ ] Preallocate x1/x2 center scratch arrays.
- [ ] Reuse probe storage.
- [ ] Add unit test proving unchanged phase causes no work.
- [ ] Benchmark CPU/upload before/after.
- [ ] Optional GPU keyframe interpolation prototype.
- [ ] Optional worker checksum/decode prototype if main-thread stall measured.
- [ ] Preserve DATA_DRIVEN interpolation parity.
- [ ] Run galaxy-collision browser/golden coverage.

## 22. WebGL2 and constrained hardware

- [ ] Repeat each shared-service change on forced WebGL2.
- [ ] Check shader compile time and first-frame latency.
- [ ] Check dynamic-loop compiler behavior.
- [ ] Check ParticleService CPU fallback.
- [ ] Check memory counts.
- [ ] Run compatibility matrix.
- [ ] Run software-render smoke where practical, but do not treat GPU-less hosted performance as target hardware.

## 23. Resource/memory certification

- [ ] Add renderer.info memory snapshot to resource-leak tests.
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
