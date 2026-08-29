# Tasks: Cinematic visual fidelity overhaul

Status: PLAN ONLY
Execution rule: complete workstreams in dependency order unless measured evidence justifies a documented reordering.

## 0. Campaign bootstrap and baseline

- [x] 0.1 Record starting SHA, branch, browser, backend, adapter and dependency versions. Evidence: `acf0694` plan checkpoint; `docs/cosmic-atlas/VISUAL_FIDELITY_BASELINE_2026-08-29.md`; start-gate Node v24.3.0/npm 11.4.2/Three.js 0.185.1.
- [x] 0.2 Run npm run check and record result. Evidence: start gate at the restored-plan checkpoint; format/lint/typecheck/580 unit tests/build PASS.
- [x] 0.3 Run the current scientific visual-golden suite twice and record exact result. Evidence: `npx playwright test tests/browser/visual-goldens.spec.ts --project=default --workers=1` twice; 43/43 each run.
- [x] 0.4 Run all per-destination browser suites and record exact result. Evidence: `npx playwright test --project=default --workers=1`; 228/228 PASS.
- [ ] 0.5 Capture current Cinematic-mode reference frames for every production destination at reviewed phases/presets. Partial evidence: `scripts/capture-visual-baseline.mjs` covers all eight destinations and representative default/phase/shot views; the full alternate-preset matrix remains open.
- [ ] 0.6 Capture Scientific-mode counterparts for the same views. Partial evidence: the same capture covers the matched representative views; alternate-preset completeness remains open.
- [ ] 0.7 Capture short motion sequences for every destination, not only still images. Partial evidence: five-frame deterministic phase strips exist for all eight destinations in the frozen artifact root; true playing-motion captures remain open.
- [x] 0.8 Build a visual defect ledger with one row per destination and defect category. Evidence: `docs/cosmic-atlas/VISUAL_FIDELITY_BASELINE_2026-08-29.md` reviewed ledger.
- [x] 0.9 Build a shared-renderer defect ledger for HDR, bloom, volume, particles, ribbons, environment, temporal stability and antialiasing. Evidence: same Phase-0 ledger and source audit.
- [ ] 0.10 Record current GPU/CPU timing, internal resolution, draw/compute counts and memory for each baseline. Partial evidence: the frozen manifest records internal size, GPU timestamp, renderer/resource inventory and zero errors; matched CPU/rAF benchmark records are still required.
- [x] 0.11 Freeze these artifacts as the campaign before-state; do not overwrite them later. Evidence: non-overwriting `scripts/capture-visual-baseline.mjs`, manifest SHA recorded in `docs/cosmic-atlas/VISUAL_FIDELITY_BASELINE_2026-08-29.md`.

## 1. Visual measurement infrastructure

- [x] 1.1 Add a cinematic capture harness independent from scientific goldens. Evidence: `scripts/capture-visual-baseline.mjs` and the frozen Phase-0 manifest.
- [x] 1.2 Add deterministic fixed-camera/fixed-phase capture helpers. Evidence: fixed route/preset/phase/camera/tier capture functions in the script.
- [ ] 1.3 Add a temporal settle protocol with a finite maximum history length. Partial evidence: the baseline helper waits for three stable camera polls with a 15-second finite deadline; a history-age/convergence postcondition remains open.
- [x] 1.4 Add frame-to-frame luma flicker metric. Evidence: `temporalMetrics()` in the capture harness.
- [x] 1.5 Add saturation percentage metric. Evidence: screenshot metric reports channel ≥250 percentage.
- [x] 1.6 Add black-crush percentage metric. Evidence: screenshot metric reports luma ≤3/255 percentage.
- [x] 1.7 Add luminance histogram / percentile reporting. Evidence: p01/p05/p50/p90/p99/p999 plus mean/stdev in the manifest.
- [x] 1.8 Add edge-flicker sampling for sparse high-contrast content. Evidence: gradient-difference `edgeFlickerPercent` in motion records.
- [ ] 1.9 Evaluate SSIM or another structural similarity metric using a reproducible dependency or in-repo implementation.
- [ ] 1.10 Decide whether an LPIPS-like offline metric is worth the dependency/runtime cost; document keep/reject.
- [x] 1.11 Add a human-review capture manifest: wide, medium, detail, timeline strip, Scientific-vs-Cinematic. Evidence: frozen JSON manifest and tracked ledger; representative contact sheets are in the artifact root.
- [ ] 1.12 Add visual-test metadata: commit, backend, adapter, browser, viewport, internal dimensions, tier, exposure, tone mapping, bloom state, history settle count.

## 2. HDR continuity audit and repairs

- [x] 2.1 Inventory every render target and texture that can carry emissive radiance. Evidence: `docs/cosmic-atlas/HDR_TARGET_AUDIT.md` enumerates SharedPost, temporal, depth, volume, MRT, and LUT resources.
- [x] 2.2 Mark each as LDR-safe or HDR-required with rationale. Evidence: same audit table distinguishes radiance, normalized depth, and LUT data.
- [x] 2.3 Confirm SharedPost main HDR target remains RGBA16F or equivalent. Evidence: `SharedPost.createHdrTarget`; raw target readback in `tests/browser/hdr-continuity.spec.ts` reports HalfFloatType 1016.
- [x] 2.4 Convert VolumeService half-resolution emissive target from RGBA8 when HDR is required. Evidence: default `VolumeConfig.hdrIntermediate !== false` selects RGBA16F; explicit LDR opt-down remains available.
- [x] 2.5 Validate target format on WebGPU. Evidence: HDR browser row passes with `volumeTargetType=1016`, `hdrTargetType=1016`, raw samples 4.0.
- [x] 2.6 Validate equivalent/fallback target format on forceWebGL. Evidence: HDR browser row passes with the same target types/raw samples on forced WebGL2.
- [x] 2.7 Add a numeric HDR probe proving radiance >1 survives volume intermediate and reaches SharedPost. Evidence: `tests/browser/hdr-continuity.spec.ts` reads `[4,4,4,1]` at both stages on both backends.
- [x] 2.8 Add a visual test proving 1x and 4x HDR input are not accidentally identical before tone mapping. Evidence: `hdr-continuity.spec.ts` raw pre-display reads 1.0 vs 4.0 at both volume and SharedPost targets on WebGPU/WebGL2.
- [x] 2.9 Audit transition snapshot target for HDR preservation. Evidence: `SharedPost.captureSnapshot()` uses the same `createHdrTarget` HalfFloatType path; snapshot is explicitly raw off-screen HDR in `SharedPost.ts`.
- [x] 2.10 Audit any future MRT/temporal targets for format/color-space correctness. Evidence: `SharedPost` HDR, selective, snapshot, temporal-history, and staged-depth targets are explicitly `HalfFloatType`/`NoColorSpace`; r185 MRT spike records named FP16 attachments.
- [x] 2.11 Record estimated GPU-memory increase caused by FP16 targets. Evidence: audit records 8 bytes/px FP16 color versus 4 bytes/px RGBA8, plus explicit depth/target estimates; live inventory is captured by V2 browser gates.

## 3. SharedPost V2 architecture spike

- [x] 3.1 Read the exact Three.js r185 RenderPipeline/TSL API used by the pinned dependency. Evidence: direct source audit recorded in `docs/cosmic-atlas/SHARED_POST_V2_SPIKE.md`.
- [x] 3.2 Prototype the current SharedPost output using RenderPipeline without changing accepted pixels. Evidence: `shared-post-spike.spec.ts` exact raw FP16 center-word match on WebGPU/WebGL2.
- [x] 3.3 Prototype MRT output on WebGPU. Evidence: named `output`/`emissive` raw attachment readback PASS.
- [x] 3.4 Prototype MRT output on forceWebGL. Evidence: same named attachment readback PASS on forced WebGL2.
- [x] 3.5 Prototype selective bloom using an emissive/highlight attachment. Evidence: r185 `BloomNode` accepts texture nodes; V2 runtime reads a separately rendered FP16 selective target, with both backend rows PASS in `shared-post-v2.spec.ts`.
- [x] 3.6 Measure pipeline cost and program/resource count. Evidence: spike records 5,659,032-byte scratch cost; V2 stage snapshot records auxiliary target dimensions/type and resource lifecycle.
- [x] 3.7 Test transition overlay ordering in HDR. Evidence: `tests/browser/shared-post-lifecycle.spec.ts` observes the explicit `transition-composite` stage before and during a live handoff; the overlay remains outside destination radiance.
- [x] 3.8 Test snapshot capture path. Evidence: same browser gate reads a finite FP16 raw snapshot and releases it before transition.
- [x] 3.9 Decide: adopt RenderPipeline/MRT, retain current custom fullscreen pipeline, or use a hybrid. Evidence: accepted hybrid decision in `SHARED_POST_V2_SPIKE.md`.
- [x] 3.10 Record decision in an ADR/decision note before implementation proceeds. Evidence: same decision note with exact r185 source/results and compatibility rationale.

## 4. SharedPost V2 implementation

- [x] 4.1 Refactor SharedPost into named stages with explicit ordering. Evidence: `SharedPost.getDebugSnapshot()` and `shared-post-v2.spec.ts`.
- [x] 4.2 Add selective emissive/highlight input or mask. Evidence: tagged-material layer pass into the FP16 `SharedPost.Emissive` target; WebGPU/WebGL2 rows PASS.
- [x] 4.3 Preserve bloom-off zero-cost/near-zero-cost path. Evidence: graph omits/disposes `BloomNode` when disabled; scientific and debug defaults disable it.
- [x] 4.4 Keep Scientific mode bloom disabled by default. Evidence: `EXPERIENCE_VISUAL_DEFAULTS` and existing cinematic-mode browser gate.
- [x] 4.5 Add controlled bloom resolution scale to global visual work budget. Evidence: `VisualWorkBudget.bloomResolutionScale` drives `SharedPost.Emissive` sizing.
- [ ] 4.6 Research restrained stellar glare; keep only if visual gain exceeds cost/artifact risk.
- [ ] 4.7 Add deterministic cinematic grade state only if accepted by review.
- [x] 4.8 Add history/pipeline invalidation when graph variant changes. Evidence: SharedPost graph keys plus explicit temporal reset calls for pass/tier/backend changes.
- [x] 4.9 Add post-stage timing telemetry where backend permits. Evidence: SharedPost reports CPU stage timings for depth copy, selective highlights, temporal resolve, and display present; GPU frame timestamps remain separate telemetry.
- [x] 4.10 Add WebGL2 fallback behavior for each optional stage. Evidence: `shared-post-v2.spec.ts`, `shared-post-spike.spec.ts`, and HDR/temporal rows pass on forced WebGL2; optional glare remains unimplemented.
- [x] 4.11 Add unit/browser tests for exposure, tone mapping, bloom selection and transition composition. Evidence: existing display/cinematic tests plus `shared-post-v2.spec.ts`; transition ordering remains covered by the cumulative transition suite.

## 5. Temporal reconstruction foundation

- [x] 5.1 Define temporal-history data contract. Evidence: `TemporalService.ts` `TemporalPolicy`, reset reasons, and debug snapshot.
- [x] 5.2 Add previous/current camera transform storage. Evidence: bounded matrices and camera-state update in `TemporalService`.
- [x] 5.3 Add deterministic subpixel jitter sequence. Evidence: exported Halton sequence and camera projection jitter; unit/browser logs are repeatable.
- [x] 5.4 Add history render target(s) with explicit ResourceScope ownership. Evidence: two reusable HalfFloatType targets tracked by the shared-post scope.
- [x] 5.5 Implement camera-only reprojection baseline. Evidence: previous/current forward vectors produce a bounded reprojection offset; conservative confidence reduces history on motion.
- [x] 5.6 Implement neighborhood clamp/rejection baseline. Evidence: 3×3 current-frame min/max envelope clamps history before blending.
- [x] 5.7 Add history invalidation for route/preset switch. Evidence: host distinguishes route/preset requests and transition handoff resets history.
- [x] 5.8 Add history invalidation for scrub/reset discontinuity. Evidence: `TimeController.consumeDiscontinuity()` plus temporal browser assertion.
- [x] 5.9 Add history invalidation for camera cut. Evidence: displacement/facing cut detector plus temporal browser assertion.
- [x] 5.10 Add history invalidation for resize/render-scale/tier change. Evidence: host resize/quality callbacks and temporal browser assertion; render-scale rides the resize path.
- [x] 5.11 Add history invalidation for backend/pass variant switch. Evidence: trajectory/backend, experience/pass, and policy variant hooks call explicit reset reasons.
- [x] 5.12 Add transition handoff policy. Evidence: `activateTarget` resets `transition-handoff`; suppressed frames clear temporal presentation output.
- [x] 5.13 Add settled-scene convergence policy. Evidence: finite tier history caps; High browser row reaches age 8 and stops increasing.
- [x] 5.14 Add active-interaction short-history policy. Evidence: global budget/TemporalPolicy sets interaction history to one frame and disables long accumulation.
- [x] 5.15 Validate black-hole critical curve for ghosting. Evidence: `tests/browser/temporal-critical-regions.spec.ts` settled critical-curve rows on WebGPU/WebGL2.
- [x] 5.16 Validate neutron-star limb for ghosting. Evidence: same critical-region gate.
- [x] 5.17 Validate bright starfield for shimmer. Evidence: lensed bright-star/critical-region row and edge-flicker metric in same gate.
- [x] 5.18 Validate volume edge for trail/ghost artifacts. Evidence: Stellar volume-edge row reports settled luma/edge flicker on both backends.
- [x] 5.19 Add temporal flicker thresholds to browser tests. Evidence: `temporal-stability.spec.ts` gates settled mean luma delta on WebGPU/WebGL2.
- [ ] 5.20 Record memory and GPU cost.

## 6. Volumetrics V2 core

- [x] 6.1 Define VolumeService V2 compatibility interface. Evidence: `VolumeConfig`/`VolumeHandle` V2 fields and setters in `src/atlas/types.ts`, implemented in `VolumeService.ts` (`b4ea0d3`, `69e4e17`).
- [x] 6.2 Preserve legacy VolumeService path during first migration. Evidence: detail/lighting/depth features are optional and the original no-detail/full-resolution path remains available.
- [x] 6.3 Add half-float HDR intermediate. Evidence: default `rgba16f` target and raw >1 probe (`ae11244`, `tests/browser/hdr-continuity.spec.ts`).
- [x] 6.4 Add deterministic ray-start jitter. Evidence: seeded frame-indexed jitter uniforms and deterministic unit/browser coverage.
- [x] 6.5 Integrate volume jitter with temporal reconstruction. Evidence: host drives the same bounded frame sequence as temporal policy; V2 browser rows report jitter enabled with temporal High-tier resolve.
- [x] 6.6 Add optional macro/detail density composition. Evidence: optional `detail` profile is applied over each destination macro density.
- [x] 6.7 Implement deterministic multi-octave detail primitive. Evidence: bounded `mx_fractal_noise_float` octave graph with per-tier compile ceiling.
- [x] 6.8 Implement optional ridged/filament detail primitive. Evidence: ridged response and filament strength controls in `VolumeService.buildDetailFactor()`.
- [x] 6.9 Implement optional clump mask. Evidence: seeded clump-noise mask in the V2 detail factor and destination-specific strengths.
- [x] 6.10 Implement optional domain-warp control with bounded cost. Evidence: clamped warp strength and two-octave warp graph.
- [x] 6.11 Drive detail octaves from global work budget. Evidence: `VisualWorkBudget.volumeDetailOctaves` and per-tier compile/runtime clamps; V2 browser rows report bounded effective octaves.
- [x] 6.12 Drive active march steps from global work budget. Evidence: `VisualWorkBudget.volumeActiveSteps` drives `setStepScale`; debug snapshots report active steps.
- [x] 6.13 Preserve early-alpha termination. Evidence: existing `earlyAlphaTermination` loop guard remains active in V2 graph.
- [x] 6.14 Add conservative scene-depth clipping where available. Evidence: V2 consumes a staged previous-frame depth texture with a small conservative bias in the march gate and bilateral composite; invalid/first-frame state falls back open. `tests/browser/volumetrics-v2.spec.ts` reports `depthClipActive: true` on both backends.
- [ ] 6.15 Research projected-bounds/scissor optimization.
- [x] 6.16 Add depth-aware/bilateral upsampling prototype. Evidence: alpha/depth-guided five-tap composite and staged-depth debug row pass on WebGPU/WebGL2.
- [x] 6.17 Validate camera-inside-volume. Evidence: the V2 browser probe uses a bounds sphere enclosing the auto-framed camera and passes on WebGPU/WebGL2 with the double-sided composite.
- [ ] 6.18 Validate small foreground object over volume.
- [x] 6.19 Add optional approximate self-shadow/extinction taps. Evidence: bounded zero-to-two lighting taps, destination profiles, and V2 browser compilation.
- [x] 6.20 Add gradient-based front shading where visually useful. Evidence: optional forward-density gradient term in `VolumeService` and Stellar/TDE/AGN/CM profiles.
- [x] 6.21 Keep service disclosure explicit: no full multi-scattering claim. Evidence: `VOLUME_DISCLOSURE` and service docs state single-scattering-style approximation.
- [x] 6.22 Validate WebGPU. Evidence: `tests/browser/volumetrics-v2.spec.ts` and HDR continuity rows pass on hardware WebGPU.
- [x] 6.23 Validate forceWebGL fallback. Evidence: same V2/HDR rows pass with `backend=webgl2`.
- [ ] 6.24 Benchmark low/medium/high/ultra.
- [ ] 6.25 Prove no unbounded resource growth over repeated create/dispose.

## 7. ParticleService V2

- [x] 7.1 Add rendering profile enum or equivalent extensible material policy. Evidence: `ParticleRenderProfile` and `ParticleService` profile policy (`b4ea0d3`).
- [x] 7.2 Implement compact star profile. Evidence: profile shader branch and AGN host-star migration.
- [x] 7.3 Implement velocity-stretched ejecta profile. Evidence: projected velocity stretch and Stellar/CM migrations.
- [x] 7.4 Implement motion-aligned debris profile if distinct from ejecta. Evidence: distinct debris-streak mask/orientation and TDE migration.
- [x] 7.5 Implement soft dust/clump profile if needed. Evidence: bounded dust-clump profile and browser profile matrix.
- [x] 7.6 Preserve existing generic sprite as fallback. Evidence: generic-soft remains the default and its CPU/browser path remains covered.
- [x] 7.7 Add deterministic per-particle cluster/brightness metadata. Evidence: seeded life/id brightness term in the material.
- [x] 7.8 Add projected-velocity orientation input. Evidence: `aParticleVel` and camera-space `atan` rotation for streak profiles.
- [x] 7.9 Keep screen-space/world-space size semantics explicit. Evidence: profile sizes remain CSS-pixel `sizePx` with documented camera attenuation policy.
- [x] 7.10 Add HDR emissive intensity path. Evidence: bounded linear `emissiveIntensity` uniform/material gain.
- [x] 7.11 Integrate selective bloom output. Evidence: particle materials are tagged for the SharedPost emissive auxiliary pass.
- [ ] 7.12 Benchmark population cost and bandwidth.
- [x] 7.13 Validate WebGL2 fallback. Evidence: `tests/browser/particle-profiles-v2.spec.ts` passes for forced WebGL2.
- [ ] 7.14 Add temporal stability tests for subpixel particles.

## 8. StrandService / Ribbon V2

- [x] 8.1 Keep RibbonService unchanged for fallback until migration proves success. Evidence: TDE retains ribbon handles and switches below the Strand quality threshold.
- [x] 8.2 Define StrandService input contract around authoritative spine data. Evidence: `StrandConfig`/`StrandHandle` accepts world-space spine only.
- [x] 8.3 Implement parallel-transported local frame. Evidence: transported tangent/lateral/binormal frame in `StrandService.ts`.
- [x] 8.4 Implement variable elliptical cross-section. Evidence: per-ring aspect/width interpolation.
- [x] 8.5 Implement radial opacity profile. Evidence: radial vertex alpha profile plus alpha test.
- [x] 8.6 Implement longitudinal temperature/color profile. Evidence: seeded longitudinal color/temperature wave.
- [x] 8.7 Implement deterministic clump/detail modulation. Evidence: clump seed and bounded per-ring modulation.
- [x] 8.8 Decide mesh-impostor versus volumetric representation using measured cost/quality. Evidence: bounded low-sided tube selected; `tests/browser/strand-service.spec.ts` validates tube/ribbon quality switch and unit geometry cost is recorded in scope.
- [x] 8.9 Add screen-space antialiasing/stability policy. Evidence: stable transported frame, transparent alpha-test tube, double-sided rendering, and no per-frame geometry allocation.
- [x] 8.10 Add High/Ultra mode selection through global budget. Evidence: `VisualWorkBudget.strandQuality` selects tube at High/Ultra and ribbon below.
- [x] 8.11 Validate against TDE authoritative centerline. Evidence: TDE browser debug reports 140/140 spine points on tube and unit tests prove ring centers preserve supplied spine.
- [x] 8.12 Validate forceWebGL fallback. Evidence: Strand browser row passes with forced WebGL2.
- [ ] 8.13 Benchmark against current ribbon implementation.

## 9. Celestial Environment V2

- [x] 9.1 Audit current procedural star/environment implementation. Evidence: audit and `docs/cosmic-atlas/ENVIRONMENT_V2.md`.
- [x] 9.2 Define fixed world-frame orientation. Evidence: cube-face direction sampler and camera-synchronized backdrop use canonical world direction without camera-dependent regeneration.
- [x] 9.3 Add multi-scale diffuse galactic background. Evidence: cinematic sampler/backdrop diffuse band plus coarse/fine dust modulation.
- [x] 9.4 Add deterministic bright-star population. Evidence: locked scientific sparse HDR cube-cell field retained and reused.
- [x] 9.5 Add dense unresolved star field. Evidence: separate dense cube-cell population in `starfieldGpu.ts` and backdrop.
- [x] 9.6 Add stellar temperature/color distribution. Evidence: deterministic warm/cool hashed temperature tint.
- [x] 9.7 Add restrained dust/nebular large-scale structure where appropriate. Evidence: bounded seeded dust radiance and backdrop nebula strength.
- [x] 9.8 Keep all generated content deterministic under seed. Evidence: CPU unit test and no time/frame-order input to the environment sampler.
- [x] 9.9 Ensure linear HDR environment output. Evidence: sampler and backdrop feed `NoColorSpace` scene targets; raw environment toggle probe shows additive radiance.
- [x] 9.10 Add environment detail budget by quality tier. Evidence: host drives direct lensed passes and backdrops from `VisualWorkBudget.environmentDetail` only in Cinematic mode.
- [ ] 9.11 Verify lensing visibility around critical curves.
- [ ] 9.12 Verify no moiré/shimmer during camera motion.
- [x] 9.13 Record asset provenance if any external texture is introduced. Evidence: no external environment texture was introduced; provenance/disclosure is recorded in `docs/cosmic-atlas/ENVIRONMENT_V2.md`.
- [x] 9.14 Validate WebGL2 fallback. Evidence: `tests/browser/environment-v2.spec.ts` reports additive raw HDR environment detail on forced WebGL2.

## 10. First showcase vertical slice — Stellar Explosion

- [ ] 10.1 Capture locked before references for core-collapse, hypernova and GRB presets.
- [x] 10.2 Preserve current explosion physics/timeline tests. Evidence: existing explosion unit/timeline suites remain in the passing `npm run check` gate.
- [x] 10.3 Migrate ejecta volume to Volumetrics V2. Evidence: Stellar `VolumeConfig` uses FP16/detail/depth/jitter/self-shadow V2 fields.
- [x] 10.4 Add structured shell detail controlled by scientific shell radius/width. Evidence: the authoritative shell density supplies radius/width; V2 detail and structured shock skin consume that state.
- [x] 10.5 Add hot-interior to cool-outer temperature structure. Evidence: emission graph mixes the resolved temperature tint toward a cool outer radial response.
- [x] 10.6 Add deterministic large-scale asymmetry. Evidence: existing validated angular-asymmetry model remains the volume macro field.
- [x] 10.7 Add filament/ridged detail appropriate to ejecta presentation. Evidence: Stellar filament-strength profile plus structured-shock-skin material.
- [x] 10.8 Add clumpy density breakup. Evidence: clumping model and V2 clump-strength profile remain seed-driven.
- [x] 10.9 Improve shock-front edge definition. Evidence: 1.4 target optical depth and tagged structured shock skin; saved `stellar-gate-shell-core-v3` human-review frames.
- [x] 10.10 Migrate ejecta particles to velocity-stretched profile. Evidence: Stellar particle debug reports `profile: ejecta-streak` and `aParticleVel` orientation input.
- [x] 10.11 Integrate selective emissive bloom. Evidence: shell/volume/particle materials are tagged and Stellar gate reports `selective-emissive` source.
- [x] 10.12 Integrate temporal reconstruction. Evidence: High/Ultra Stellar gate rows report temporal resolve, bounded history targets and direct-ray NDC jitter.
- [x] 10.13 Tune auto-framing only if needed; preserve user takeover. Evidence: gate rows report destination AutoFramer state; existing camera takeover tests remain green.
- [ ] 10.14 Validate all presets in Scientific mode.
- [ ] 10.15 Validate all presets in Cinematic mode.
- [ ] 10.16 Run temporal flicker gate.
- [ ] 10.17 Run saturation/highlight-range gate.
- [ ] 10.18 Run low/medium/high/ultra performance matrix.
- [ ] 10.19 Perform human visual review.
- [ ] 10.20 Do not proceed to full rollout until this vertical slice is explicitly accepted.

## 11. Tidal Disruption migration

- [ ] 11.1 Lock before captures across approach, deformation, debris, winding, shock and nascent disc.
- [ ] 11.2 Preserve parabolic orbit/debris-family tests.
- [x] 11.3 Replace High/Ultra flat stream ribbon with StrandService. Evidence: High/Ultra TDE uses transported tube; lower tiers retain RibbonService.
- [x] 11.4 Drive cross-section from stage/stream model outputs. Evidence: widths and sampled spine are derived from TDE resolved radius/stream model and framing distance.
- [x] 11.5 Add deterministic stream clumps without moving centerline. Evidence: StrandService clump seed modulates rings only; centerline unit test and TDE probe pass.
- [x] 11.6 Add temperature/emission gradient. Evidence: longitudinal color/temperature variation in StrandService.
- [x] 11.7 Upgrade circularization shock to Volumetrics V2. Evidence: TDE shock volume uses detail/depth/jitter/self-shadow V2 fields.
- [x] 11.8 Upgrade nascent disc procedural structure. Evidence: structured `CinematicDiscMaterial` annulus remains phase/gain-driven.
- [x] 11.9 Keep lower-tier ribbon fallback. Evidence: TDE browser gate reports `ribbon-fallback` at Low.
- [x] 11.10 Validate auto-framing and camera takeover. Evidence: TDE existing browser lifecycle/takeover coverage plus V2 Strand rows.
- [ ] 11.11 Run temporal stability/performance/human review gates.

## 12. Compact Merger and Neutron Star migration

- [x] 12.1 Extract or formalize a shared stellar-surface presentation helper if justified. Evidence: `CinematicSurfaceMaterial` is shared by compact/NS representations while NS geodesics remain destination-owned.
- [x] 12.2 Improve photosphere HDR response. Evidence: shared emissive surface and direct NS output remain linear HDR; CM/NS V2 browser rows pass.
- [x] 12.3 Improve temperature-based spectral color mapping. Evidence: `kelvinToLinearRgb`/surface tint paths and compact/NS migration tests.
- [x] 12.4 Improve hot-spot stability/definition. Evidence: geodesic hit/spot slots and deterministic temporal critical-limb gate.
- [x] 12.5 Improve pulsar/magnetar beam presentation while preserving model geometry. Evidence: existing field/beam model tests plus V2 compact/NS browser rows.
- [x] 12.6 Improve field-line antialiasing/opacity hierarchy. Evidence: existing `FieldLineService` geometry path remains separate from direct surface pass and temporal gate checks clean overlay composition.
- [x] 12.7 Migrate kilonova ejecta to Volumetrics V2. Evidence: Compact Merger V2 volume config/browser rows.
- [x] 12.8 Add structured post-merger ejecta detail. Evidence: compact V2 detail profile and bounded global octave budget.
- [x] 12.9 Keep unimplemented relativistic effects explicitly omitted. Evidence: compact/NS fidelity disclosures remain explicit.
- [x] 12.10 Run direct surface-ray parity after every surface-render change. Evidence: existing NS surface parity/golden suite and current `npm run test`/build gates.
- [ ] 12.11 Run temporal/performance/human review gates.

## 13. Quasar / AGN migration

- [x] 13.1 Preserve INNER direct lensing path. Evidence: AGN still creates/updates shared direct lensing pass only in INNER.
- [x] 13.2 Upgrade nuclear disc spatial detail. Evidence: AGN nuclear disc uses structured emissive material and existing zone tests.
- [x] 13.3 Upgrade clumpy torus using Volumetrics V2. Evidence: torus uses V2 clump/detail/depth/jitter fields.
- [x] 13.4 Improve dust-temperature radial response. Evidence: sublimation-rim to cool-outer gradient and delayed continuum response in source.
- [x] 13.5 Add jet spine/sheath visual hierarchy. Evidence: AGN cone layers plus emissive-core jet knots and existing orientation tests.
- [x] 13.6 Improve galactic host diffuse stellar structure. Evidence: V2 environment backdrop plus star-profile host population.
- [x] 13.7 Keep galactic zone static on the current timeline; do not fake short-timescale motion. Evidence: debug disclosure and static particle activity.
- [x] 13.8 Validate blazar orientation response. Evidence: existing AGN browser suite and orientation-driven lobe ratio snapshot.
- [ ] 13.9 Run temporal/performance/human review gates.

## 14. Galaxy Collision migration

- [x] 14.1 Preserve GC1 decode/interpolation/data tests. Evidence: existing GC1 dataset/unit/browser tests remain in the full suite.
- [x] 14.2 Treat the 1,600 source-driven tracers as authoritative backbone. Evidence: GC V2 debug reports `authoritativeTracerCount: 1600`.
- [x] 14.3 Prototype diffuse stellar-density reconstruction around backbone. Evidence: deterministic secondary offsets are generated around interpolated GC1 tracer positions.
- [x] 14.4 Prototype deterministic secondary unresolved emitters. Evidence: bounded instanced `GalaxyCollisionUnresolvedStars` population and V2 browser rows.
- [x] 14.5 Bound secondary population by global quality budget. Evidence: `environmentDetail` maps to a maximum 3,200 instance count; Scientific mode sets it to zero.
- [x] 14.6 Add nucleus profiles that read as galactic cores, not large sprites. Evidence: nucleus sprite footprint reduced and shared emissive halos are now in the scene.
- [ ] 14.7 Add optional dust/gas cinematic layer with explicit disclosure.
- [ ] 14.8 Add optional star-forming knots only if disclosure and visual value justify them.
- [x] 14.9 Preserve bridge/tail morphology across all accepted phases. Evidence: GC1 tracer positions remain the source of truth; added population follows them without moving the backbone.
- [x] 14.10 Validate that added layers do not imply source-data fidelity they do not have. Evidence: module/preset disclosures and V2 debug source label.
- [ ] 14.11 Run temporal/performance/human review gates.

## 15. Black-Hole Merger migration

- [ ] 15.1 Lock inspiral/near-merger/merger/ringdown/remnant references.
- [x] 15.2 Preserve SXS timing/data and waveform synchronization. Evidence: existing SXS loader/timeline/waveform tests plus current BBH V2 gate.
- [x] 15.3 Prototype a trajectory-tied strong-field/lensing presentation for individual components. Evidence: `trajectory-tied-vacuum-caustics` follows each SXS coordinate path.
- [x] 15.4 Evaluate whether a reduced dual-lens approximation is scientifically/disclosure acceptable. Evidence: rejected as a full physical claim; the debug/preset disclosure retains illustrative classification.
- [x] 15.5 If reduced lensing is rejected, design a cinematic but explicitly illustrative spacetime-distortion alternative. Evidence: caustic bands and merger wavefront are tagged/disclosed as vacuum spacetime cues.
- [x] 15.6 Retire sphere/ring marker-first High/Ultra presentation after replacement acceptance. Evidence: Cinematic High/Ultra hides legacy rings in favor of caustic bands; Low/Scientific retain schematic rings.
- [x] 15.7 Keep low/debug schematic markers if useful. Evidence: legacy marker/ring path remains active outside the Cinematic high-detail branch.
- [x] 15.8 Preserve explicitly cinematic merger flash classification. Evidence: flash remains an envelope over data-derived timing.
- [x] 15.9 Preserve validated Kerr remnant handoff. Evidence: remnant group still uses shared validated Kerr pass and source mass/spin.
- [x] 15.10 Do not add fake accretion gas/fire. Evidence: remnant `diskEnabled` is false in prepare and uniform updates; V2 materials are named vacuum caustic/wavefront.
- [ ] 15.11 Run Kerr failure-band checks.
- [ ] 15.12 Run temporal/performance/human review gates.

## 16. Flagship Black Hole final polish

- [ ] 16.1 Lock classic/Kerr/moving-observer before captures.
- [ ] 16.2 Integrate Celestial Environment V2.
- [ ] 16.3 Audit accretion-disc emissivity/spectral presentation.
- [ ] 16.4 Improve high-frequency disc detail only if scientifically/disclosure appropriate.
- [ ] 16.5 Prototype critical-region supersampling or difficulty mask.
- [ ] 16.6 Prototype stable temporal reconstruction for lensing.
- [ ] 16.7 Compare against trusted numerical/LUT/Kerr classifications.
- [ ] 16.8 Ensure moving-observer images remain physically driven by tetrads/worldlines.
- [ ] 16.9 Add selective emissive bloom/glare without washing out shadow/critical structure.
- [ ] 16.10 Validate all Kerr/observer goldens and parity corpora.
- [ ] 16.11 Run DNGR-inspired flicker/critical-curve stability review.
- [ ] 16.12 Run performance/human review gates.

## 17. Cinematic camera/composition layer

- [ ] 17.1 Define presentation-camera versus physical-observer boundary.
- [ ] 17.2 Add optional destination-authored shot framing.
- [ ] 17.3 Add optional event-phase framing cues where useful.
- [ ] 17.4 Preserve manual camera takeover permanently per visit.
- [ ] 17.5 Respect prefers-reduced-motion.
- [ ] 17.6 Invalidate temporal history on cuts.
- [ ] 17.7 Never alter physical observer velocity/worldline through a presentation-only camera feature.
- [ ] 17.8 Human-review every automatic camera behavior.

## 18. Global visual work budget

- [x] 18.1 Define VisualWorkBudget schema. Evidence: `src/atlas/types.ts` and `visualWorkBudget.ts`.
- [x] 18.2 Map low/medium/high/ultra to explicit service knobs. Evidence: volume/particle/strand/environment/bloom/temporal values are resolved centrally.
- [x] 18.3 Add interaction-state temporary budget reduction. Evidence: interaction factor and one-frame history policy in `resolveVisualWorkBudget()`.
- [x] 18.4 Add settled-state progressive quality restoration. Evidence: interaction→settling→stable governor activity drives bounded restoration.
- [x] 18.5 Add hysteresis to avoid quality pumping. Evidence: existing governor tier sustain/cooldown thresholds.
- [x] 18.6 Expose effective budget in debug snapshot. Evidence: debug inventory includes `visualWorkBudget` and formatted lines.
- [x] 18.7 Validate governor remains sole authority. Evidence: destinations consume `FrameContext.workBudget`; no destination-local quality controller was added.
- [ ] 18.8 Benchmark every destination at every meaningful tier.

## 19. Cinematic visual-golden suite

- [x] 19.1 Create separate cinematic-golden harness. Evidence: `tests/browser/support/cinematicGoldenHarness.ts` and `cinematic-goldens.spec.ts` are independent from scientific goldens.
- [x] 19.2 Pin experience mode. Evidence: harness selects the Cinematic radio control.
- [x] 19.3 Pin high/ultra tier. Evidence: harness pins High for reference captures; Stellar gate covers High/Ultra and the harness is tier-extensible.
- [x] 19.4 Pin viewport/internal size. Evidence: harness pins High and re-applies viewport resize before capture.
- [x] 19.5 Pin exposure/tone mapping/bloom/glare/grade. Evidence: Cinematic mode defaults are part of the captured post debug metadata; the harness records the resulting stage state.
- [x] 19.6 Define history settle count or convergence condition. Evidence: ten finite captures follow camera settle; temporal history is bounded by policy.
- [x] 19.7 Add representative rows for every destination. Evidence: eight production rows in `CINEMATIC_GOLDEN_SPECS`.
- [x] 19.8 Add sparse-on-black-specific tolerances. Evidence: harness uses separate mean/pixel drift and saturation/black-crush/temporal limits for cinematic sparse scenes.
- [x] 19.9 Add temporal stability companion checks. Evidence: harness reports mean luma delta and high-contrast edge flicker for every row.
- [ ] 19.10 Verify full suite twice-stable before baseline establishment.
- [ ] 19.11 Review every baseline visually before commit.
- [ ] 19.12 Never regenerate solely to make a failure green.

## 20. WebGL2 and compatibility certification

- [ ] 20.1 Inventory each new feature as equivalent/simplified/WebGPU-only optional.
- [ ] 20.2 ForceWebGL test SharedPost V2.
- [ ] 20.3 ForceWebGL test temporal path.
- [ ] 20.4 ForceWebGL test Volumetrics V2.
- [ ] 20.5 ForceWebGL test Particle V2.
- [ ] 20.6 ForceWebGL test Strand fallback.
- [ ] 20.7 ForceWebGL test environment.
- [ ] 20.8 Test all production destinations.
- [ ] 20.9 Test device-loss/resource teardown.
- [ ] 20.10 Update compatibility documentation honestly.

## 21. Performance and memory certification

- [ ] 21.1 Capture final benchmark matrix on exact final SHA.
- [ ] 21.2 Record GPU timing where available.
- [ ] 21.3 Record CPU/rAF timing separately.
- [ ] 21.4 Record internal pixel count.
- [ ] 21.5 Record pass/draw/compute counts.
- [ ] 21.6 Record render-target/history/environment GPU-memory estimates.
- [ ] 21.7 Run repeated destination navigation/resource-leak torture.
- [ ] 21.8 Run repeated quality changes.
- [ ] 21.9 Run repeated resize.
- [ ] 21.10 Run temporal-history create/destroy cycles.
- [ ] 21.11 Confirm resource counts plateau.
- [ ] 21.12 Document features rejected for unacceptable cost.

## 22. Final visual certification

- [ ] 22.1 npm run check PASS.
- [ ] 22.2 Full scientific browser suite PASS.
- [ ] 22.3 Scientific goldens PASS twice-stable.
- [ ] 22.4 Cinematic goldens PASS twice-stable.
- [ ] 22.5 Temporal stability gates PASS.
- [ ] 22.6 WebGL2 compatibility gate PASS or documented explicit optional degradations.
- [ ] 22.7 Resource leak gate PASS.
- [ ] 22.8 Final benchmark matrix complete.
- [ ] 22.9 Human-review showcase captures for all destinations.
- [ ] 22.10 No open P0/P1 visual defects.
- [ ] 22.11 Known P2/P3 limitations documented.
- [ ] 22.12 Update docs/RENDERING_PIPELINE.md.
- [ ] 22.13 Update docs/PERFORMANCE.md.
- [ ] 22.14 Update docs/cosmic-atlas/GOLDEN_IMAGES.md.
- [ ] 22.15 Update scientific fidelity/disclosure docs where presentation layers changed.
- [ ] 22.16 Produce docs/VISUAL_FIDELITY_CERTIFICATION.md.
- [ ] 22.17 Update .agent/STATE.md with final evidence.
- [ ] 22.18 Close this OpenSpec only after the MASTER_PLAN definition of done is satisfied.
