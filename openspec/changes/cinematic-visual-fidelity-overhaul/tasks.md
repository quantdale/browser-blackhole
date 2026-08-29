# Tasks: Cinematic visual fidelity overhaul

Status: PLAN ONLY
Execution rule: complete workstreams in dependency order unless measured evidence justifies a documented reordering.

## 0. Campaign bootstrap and baseline

- [ ] 0.1 Record starting SHA, branch, browser, backend, adapter and dependency versions.
- [ ] 0.2 Run npm run check and record result.
- [ ] 0.3 Run the current scientific visual-golden suite twice and record exact result.
- [ ] 0.4 Run all per-destination browser suites and record exact result.
- [ ] 0.5 Capture current Cinematic-mode reference frames for every production destination at reviewed phases/presets.
- [ ] 0.6 Capture Scientific-mode counterparts for the same views.
- [ ] 0.7 Capture short motion sequences for every destination, not only still images.
- [ ] 0.8 Build a visual defect ledger with one row per destination and defect category.
- [ ] 0.9 Build a shared-renderer defect ledger for HDR, bloom, volume, particles, ribbons, environment, temporal stability and antialiasing.
- [ ] 0.10 Record current GPU/CPU timing, internal resolution, draw/compute counts and memory for each baseline.
- [ ] 0.11 Freeze these artifacts as the campaign before-state; do not overwrite them later.

## 1. Visual measurement infrastructure

- [ ] 1.1 Add a cinematic capture harness independent from scientific goldens.
- [ ] 1.2 Add deterministic fixed-camera/fixed-phase capture helpers.
- [ ] 1.3 Add a temporal settle protocol with a finite maximum history length.
- [ ] 1.4 Add frame-to-frame luma flicker metric.
- [ ] 1.5 Add saturation percentage metric.
- [ ] 1.6 Add black-crush percentage metric.
- [ ] 1.7 Add luminance histogram / percentile reporting.
- [ ] 1.8 Add edge-flicker sampling for sparse high-contrast content.
- [ ] 1.9 Evaluate SSIM or another structural similarity metric using a reproducible dependency or in-repo implementation.
- [ ] 1.10 Decide whether an LPIPS-like offline metric is worth the dependency/runtime cost; document keep/reject.
- [ ] 1.11 Add a human-review capture manifest: wide, medium, detail, timeline strip, Scientific-vs-Cinematic.
- [ ] 1.12 Add visual-test metadata: commit, backend, adapter, browser, viewport, internal dimensions, tier, exposure, tone mapping, bloom state, history settle count.

## 2. HDR continuity audit and repairs

- [ ] 2.1 Inventory every render target and texture that can carry emissive radiance.
- [ ] 2.2 Mark each as LDR-safe or HDR-required with rationale.
- [ ] 2.3 Confirm SharedPost main HDR target remains RGBA16F or equivalent.
- [ ] 2.4 Convert VolumeService half-resolution emissive target from RGBA8 when HDR is required.
- [ ] 2.5 Validate target format on WebGPU.
- [ ] 2.6 Validate equivalent/fallback target format on forceWebGL.
- [ ] 2.7 Add a numeric HDR probe proving radiance >1 survives volume intermediate and reaches SharedPost.
- [ ] 2.8 Add a visual test proving 1x and 4x HDR input are not accidentally identical before tone mapping.
- [ ] 2.9 Audit transition snapshot target for HDR preservation.
- [ ] 2.10 Audit any future MRT/temporal targets for format/color-space correctness.
- [ ] 2.11 Record estimated GPU-memory increase caused by FP16 targets.

## 3. SharedPost V2 architecture spike

- [ ] 3.1 Read the exact Three.js r185 RenderPipeline/TSL API used by the pinned dependency.
- [ ] 3.2 Prototype the current SharedPost output using RenderPipeline without changing accepted pixels.
- [ ] 3.3 Prototype MRT output on WebGPU.
- [ ] 3.4 Prototype MRT output on forceWebGL.
- [ ] 3.5 Prototype selective bloom using an emissive/highlight attachment.
- [ ] 3.6 Measure pipeline cost and program/resource count.
- [ ] 3.7 Test transition overlay ordering in HDR.
- [ ] 3.8 Test snapshot capture path.
- [ ] 3.9 Decide: adopt RenderPipeline/MRT, retain current custom fullscreen pipeline, or use a hybrid.
- [ ] 3.10 Record decision in an ADR/decision note before implementation proceeds.

## 4. SharedPost V2 implementation

- [ ] 4.1 Refactor SharedPost into named stages with explicit ordering.
- [ ] 4.2 Add selective emissive/highlight input or mask.
- [ ] 4.3 Preserve bloom-off zero-cost/near-zero-cost path.
- [ ] 4.4 Keep Scientific mode bloom disabled by default.
- [ ] 4.5 Add controlled bloom resolution scale to global visual work budget.
- [ ] 4.6 Research restrained stellar glare; keep only if visual gain exceeds cost/artifact risk.
- [ ] 4.7 Add deterministic cinematic grade state only if accepted by review.
- [ ] 4.8 Add history/pipeline invalidation when graph variant changes.
- [ ] 4.9 Add post-stage timing telemetry where backend permits.
- [ ] 4.10 Add WebGL2 fallback behavior for each optional stage.
- [ ] 4.11 Add unit/browser tests for exposure, tone mapping, bloom selection and transition composition.

## 5. Temporal reconstruction foundation

- [ ] 5.1 Define temporal-history data contract.
- [ ] 5.2 Add previous/current camera transform storage.
- [ ] 5.3 Add deterministic subpixel jitter sequence.
- [ ] 5.4 Add history render target(s) with explicit ResourceScope ownership.
- [ ] 5.5 Implement camera-only reprojection baseline.
- [ ] 5.6 Implement neighborhood clamp/rejection baseline.
- [ ] 5.7 Add history invalidation for route/preset switch.
- [ ] 5.8 Add history invalidation for scrub/reset discontinuity.
- [ ] 5.9 Add history invalidation for camera cut.
- [ ] 5.10 Add history invalidation for resize/render-scale/tier change.
- [ ] 5.11 Add history invalidation for backend/pass variant switch.
- [ ] 5.12 Add transition handoff policy.
- [ ] 5.13 Add settled-scene convergence policy.
- [ ] 5.14 Add active-interaction short-history policy.
- [ ] 5.15 Validate black-hole critical curve for ghosting.
- [ ] 5.16 Validate neutron-star limb for ghosting.
- [ ] 5.17 Validate bright starfield for shimmer.
- [ ] 5.18 Validate volume edge for trail/ghost artifacts.
- [ ] 5.19 Add temporal flicker thresholds to browser tests.
- [ ] 5.20 Record memory and GPU cost.

## 6. Volumetrics V2 core

- [ ] 6.1 Define VolumeService V2 compatibility interface.
- [ ] 6.2 Preserve legacy VolumeService path during first migration.
- [ ] 6.3 Add half-float HDR intermediate.
- [ ] 6.4 Add deterministic ray-start jitter.
- [ ] 6.5 Integrate volume jitter with temporal reconstruction.
- [ ] 6.6 Add optional macro/detail density composition.
- [ ] 6.7 Implement deterministic multi-octave detail primitive.
- [ ] 6.8 Implement optional ridged/filament detail primitive.
- [ ] 6.9 Implement optional clump mask.
- [ ] 6.10 Implement optional domain-warp control with bounded cost.
- [ ] 6.11 Drive detail octaves from global work budget.
- [ ] 6.12 Drive active march steps from global work budget.
- [ ] 6.13 Preserve early-alpha termination.
- [ ] 6.14 Add conservative scene-depth clipping where available.
- [ ] 6.15 Research projected-bounds/scissor optimization.
- [ ] 6.16 Add depth-aware/bilateral upsampling prototype.
- [ ] 6.17 Validate camera-inside-volume.
- [ ] 6.18 Validate small foreground object over volume.
- [ ] 6.19 Add optional approximate self-shadow/extinction taps.
- [ ] 6.20 Add gradient-based front shading where visually useful.
- [ ] 6.21 Keep service disclosure explicit: no full multi-scattering claim.
- [ ] 6.22 Validate WebGPU.
- [ ] 6.23 Validate forceWebGL fallback.
- [ ] 6.24 Benchmark low/medium/high/ultra.
- [ ] 6.25 Prove no unbounded resource growth over repeated create/dispose.

## 7. ParticleService V2

- [ ] 7.1 Add rendering profile enum or equivalent extensible material policy.
- [ ] 7.2 Implement compact star profile.
- [ ] 7.3 Implement velocity-stretched ejecta profile.
- [ ] 7.4 Implement motion-aligned debris profile if distinct from ejecta.
- [ ] 7.5 Implement soft dust/clump profile if needed.
- [ ] 7.6 Preserve existing generic sprite as fallback.
- [ ] 7.7 Add deterministic per-particle cluster/brightness metadata.
- [ ] 7.8 Add projected-velocity orientation input.
- [ ] 7.9 Keep screen-space/world-space size semantics explicit.
- [ ] 7.10 Add HDR emissive intensity path.
- [ ] 7.11 Integrate selective bloom output.
- [ ] 7.12 Benchmark population cost and bandwidth.
- [ ] 7.13 Validate WebGL2 fallback.
- [ ] 7.14 Add temporal stability tests for subpixel particles.

## 8. StrandService / Ribbon V2

- [ ] 8.1 Keep RibbonService unchanged for fallback until migration proves success.
- [ ] 8.2 Define StrandService input contract around authoritative spine data.
- [ ] 8.3 Implement parallel-transported local frame.
- [ ] 8.4 Implement variable elliptical cross-section.
- [ ] 8.5 Implement radial opacity profile.
- [ ] 8.6 Implement longitudinal temperature/color profile.
- [ ] 8.7 Implement deterministic clump/detail modulation.
- [ ] 8.8 Decide mesh-impostor versus volumetric representation using measured cost/quality.
- [ ] 8.9 Add screen-space antialiasing/stability policy.
- [ ] 8.10 Add High/Ultra mode selection through global budget.
- [ ] 8.11 Validate against TDE authoritative centerline.
- [ ] 8.12 Validate forceWebGL fallback.
- [ ] 8.13 Benchmark against current ribbon implementation.

## 9. Celestial Environment V2

- [ ] 9.1 Audit current procedural star/environment implementation.
- [ ] 9.2 Define fixed world-frame orientation.
- [ ] 9.3 Add multi-scale diffuse galactic background.
- [ ] 9.4 Add deterministic bright-star population.
- [ ] 9.5 Add dense unresolved star field.
- [ ] 9.6 Add stellar temperature/color distribution.
- [ ] 9.7 Add restrained dust/nebular large-scale structure where appropriate.
- [ ] 9.8 Keep all generated content deterministic under seed.
- [ ] 9.9 Ensure linear HDR environment output.
- [ ] 9.10 Add environment detail budget by quality tier.
- [ ] 9.11 Verify lensing visibility around critical curves.
- [ ] 9.12 Verify no moiré/shimmer during camera motion.
- [ ] 9.13 Record asset provenance if any external texture is introduced.
- [ ] 9.14 Validate WebGL2 fallback.

## 10. First showcase vertical slice — Stellar Explosion

- [ ] 10.1 Capture locked before references for core-collapse, hypernova and GRB presets.
- [ ] 10.2 Preserve current explosion physics/timeline tests.
- [ ] 10.3 Migrate ejecta volume to Volumetrics V2.
- [ ] 10.4 Add structured shell detail controlled by scientific shell radius/width.
- [ ] 10.5 Add hot-interior to cool-outer temperature structure.
- [ ] 10.6 Add deterministic large-scale asymmetry.
- [ ] 10.7 Add filament/ridged detail appropriate to ejecta presentation.
- [ ] 10.8 Add clumpy density breakup.
- [ ] 10.9 Improve shock-front edge definition.
- [ ] 10.10 Migrate ejecta particles to velocity-stretched profile.
- [ ] 10.11 Integrate selective emissive bloom.
- [ ] 10.12 Integrate temporal reconstruction.
- [ ] 10.13 Tune auto-framing only if needed; preserve user takeover.
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
- [ ] 11.3 Replace High/Ultra flat stream ribbon with StrandService.
- [ ] 11.4 Drive cross-section from stage/stream model outputs.
- [ ] 11.5 Add deterministic stream clumps without moving centerline.
- [ ] 11.6 Add temperature/emission gradient.
- [ ] 11.7 Upgrade circularization shock to Volumetrics V2.
- [ ] 11.8 Upgrade nascent disc procedural structure.
- [ ] 11.9 Keep lower-tier ribbon fallback.
- [ ] 11.10 Validate auto-framing and camera takeover.
- [ ] 11.11 Run temporal stability/performance/human review gates.

## 12. Compact Merger and Neutron Star migration

- [ ] 12.1 Extract or formalize a shared stellar-surface presentation helper if justified.
- [ ] 12.2 Improve photosphere HDR response.
- [ ] 12.3 Improve temperature-based spectral color mapping.
- [ ] 12.4 Improve hot-spot stability/definition.
- [ ] 12.5 Improve pulsar/magnetar beam presentation while preserving model geometry.
- [ ] 12.6 Improve field-line antialiasing/opacity hierarchy.
- [ ] 12.7 Migrate kilonova ejecta to Volumetrics V2.
- [ ] 12.8 Add structured post-merger ejecta detail.
- [ ] 12.9 Keep unimplemented relativistic effects explicitly omitted.
- [ ] 12.10 Run direct surface-ray parity after every surface-render change.
- [ ] 12.11 Run temporal/performance/human review gates.

## 13. Quasar / AGN migration

- [ ] 13.1 Preserve INNER direct lensing path.
- [ ] 13.2 Upgrade nuclear disc spatial detail.
- [ ] 13.3 Upgrade clumpy torus using Volumetrics V2.
- [ ] 13.4 Improve dust-temperature radial response.
- [ ] 13.5 Add jet spine/sheath visual hierarchy.
- [ ] 13.6 Improve galactic host diffuse stellar structure.
- [ ] 13.7 Keep galactic zone static on the current timeline; do not fake short-timescale motion.
- [ ] 13.8 Validate blazar orientation response.
- [ ] 13.9 Run temporal/performance/human review gates.

## 14. Galaxy Collision migration

- [ ] 14.1 Preserve GC1 decode/interpolation/data tests.
- [ ] 14.2 Treat the 1,600 source-driven tracers as authoritative backbone.
- [ ] 14.3 Prototype diffuse stellar-density reconstruction around backbone.
- [ ] 14.4 Prototype deterministic secondary unresolved emitters.
- [ ] 14.5 Bound secondary population by global quality budget.
- [ ] 14.6 Add nucleus profiles that read as galactic cores, not large sprites.
- [ ] 14.7 Add optional dust/gas cinematic layer with explicit disclosure.
- [ ] 14.8 Add optional star-forming knots only if disclosure and visual value justify them.
- [ ] 14.9 Preserve bridge/tail morphology across all accepted phases.
- [ ] 14.10 Validate that added layers do not imply source-data fidelity they do not have.
- [ ] 14.11 Run temporal/performance/human review gates.

## 15. Black-Hole Merger migration

- [ ] 15.1 Lock inspiral/near-merger/merger/ringdown/remnant references.
- [ ] 15.2 Preserve SXS timing/data and waveform synchronization.
- [ ] 15.3 Prototype a trajectory-tied strong-field/lensing presentation for individual components.
- [ ] 15.4 Evaluate whether a reduced dual-lens approximation is scientifically/disclosure acceptable.
- [ ] 15.5 If reduced lensing is rejected, design a cinematic but explicitly illustrative spacetime-distortion alternative.
- [ ] 15.6 Retire sphere/ring marker-first High/Ultra presentation after replacement acceptance.
- [ ] 15.7 Keep low/debug schematic markers if useful.
- [ ] 15.8 Preserve explicitly cinematic merger flash classification.
- [ ] 15.9 Preserve validated Kerr remnant handoff.
- [ ] 15.10 Do not add fake accretion gas/fire.
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

- [ ] 18.1 Define VisualWorkBudget schema.
- [ ] 18.2 Map low/medium/high/ultra to explicit service knobs.
- [ ] 18.3 Add interaction-state temporary budget reduction.
- [ ] 18.4 Add settled-state progressive quality restoration.
- [ ] 18.5 Add hysteresis to avoid quality pumping.
- [ ] 18.6 Expose effective budget in debug snapshot.
- [ ] 18.7 Validate governor remains sole authority.
- [ ] 18.8 Benchmark every destination at every meaningful tier.

## 19. Cinematic visual-golden suite

- [ ] 19.1 Create separate cinematic-golden harness.
- [ ] 19.2 Pin experience mode.
- [ ] 19.3 Pin high/ultra tier.
- [ ] 19.4 Pin viewport/internal size.
- [ ] 19.5 Pin exposure/tone mapping/bloom/glare/grade.
- [ ] 19.6 Define history settle count or convergence condition.
- [ ] 19.7 Add representative rows for every destination.
- [ ] 19.8 Add sparse-on-black-specific tolerances.
- [ ] 19.9 Add temporal stability companion checks.
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
