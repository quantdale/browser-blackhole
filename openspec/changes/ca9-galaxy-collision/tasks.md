# Tasks: CA9 Galaxy Collision

Do not begin section 3 or later until the source-lock gate in section 2 is complete. If a required production parameter remains materially unsupported, record `BLOCKED_SOURCE` and stop dependent tasks.

## 1. Prerequisite and baseline gate

- [ ] 1.1 Confirm M12-NS and M12-RI are closed with their required evidence and the repository current-state docs name CA9 as the next feature.
- [ ] 1.2 Record baseline HEAD, tool versions, browser/GPU context and run `npm ci` plus `npm run check`.
- [ ] 1.3 Run the existing CA9 integrator self-check/unit prework and confirm exercise mode remains clearly non-production.
- [ ] 1.4 Read `docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION.md`, `DATA_PIPELINE.md`, roadmap/work-packet/fidelity docs, the full restricted-three-body tool, its tests and the CA8 data-driven pipeline precedent.

## 2. Primary-source lock — HARD GATE

- [ ] 2.1 Retrieve the Toomre & Toomre (1972) scan through the NASA GISS publication record and confirm bibliographic identity/DOI against NASA NTRS metadata.
- [ ] 2.2 Do not commit the downloaded paper PDF unless redistribution rights are independently established; record retrieval URL/access date in docs instead.
- [ ] 2.3 Select one reproducible paper model/case suitable for the first CA9 production scenario and record why it is sufficient.
- [ ] 2.4 Transcribe required mass/gravitational parameters with exact page/section/figure/table provenance.
- [ ] 2.5 Transcribe encounter/orbit type, closest-approach/scale and initial-state information required by the reduced model.
- [ ] 2.6 Transcribe disk/tracer radial distribution and orientation/sense parameters required by the selected case.
- [ ] 2.7 Freeze coordinate frame, handedness, angle convention, dimensionless length/time/velocity normalization and mappings to repository units.
- [ ] 2.8 Identify source epochs/phases/figures used for qualitative or quantitative reconstruction checks.
- [ ] 2.9 Label every derived or figure-digitized value as derived, record the method and uncertainty, and never present it as a verbatim tabulated value.
- [ ] 2.10 Create/update the source-lock table with value, units, source location, derivation and confidence for every production parameter.
- [ ] 2.11 Have the generator’s production config reference only source-locked or explicitly derived fields; no exercise/default placeholder may satisfy a production-required field.
- [ ] 2.12 If any required parameter is materially unresolved, write the exact blocker into the source doc/state, leave dependent tasks unchecked, mark CA9 `BLOCKED_SOURCE`, and stop sections 3–10.

## 3. Production offline configuration and generator

- [ ] 3.1 Define a versioned production scenario/config schema separate from exercise/self-check values.
- [ ] 3.2 Add strict guards for missing, non-finite, exercise-marked, unit-inconsistent or unsupported production fields.
- [ ] 3.3 Refactor `restricted_three_body.py` only as needed so production runs consume the explicit source-locked config rather than embedded placeholder constants.
- [ ] 3.4 Preserve deterministic seed/order/integration behavior and document Python/tool dependencies required to reproduce generation.
- [ ] 3.5 Add tests proving production mode refuses incomplete/exercise configuration.
- [ ] 3.6 Add tests for unit/frame conversion and initial-condition construction from the locked scenario.
- [ ] 3.7 Characterize integration step sensitivity/error for representative center/tracer trajectories and choose production settings from evidence.
- [ ] 3.8 Run deterministic repeat generation and verify identical logical output/checksum under the pinned environment.
- [ ] 3.9 Verify no non-finite center/tracer trajectories and record source-derived invariants/qualitative comparison limits.

## 4. Runtime data artifact

- [ ] 4.1 Specify a versioned `GC1` (or equivalently named) runtime binary schema with magic/version, counts, time range, encoding/scales and deterministic record order.
- [ ] 4.2 Choose keyframe cadence and numeric precision from measured interpolation/quantization error versus asset-size/runtime cost.
- [ ] 4.3 Serialize galaxy centers and tracer trajectories/keyframes deterministically.
- [ ] 4.4 Generate a manifest containing source/scenario id, schema version, generator version/commit, generation command, byte size and checksum.
- [ ] 4.5 Add a production loader that bounds-checks lengths/counts/offsets, rejects unsupported versions and rejects corrupt/truncated data truthfully.
- [ ] 4.6 Add parser fixtures/tests for valid, truncated, corrupt, unsupported-version and pathological-count inputs.
- [ ] 4.7 Prove a committed runtime artifact can be regenerated from the documented production config/tooling without the raw paper PDF in the repository.
- [ ] 4.8 Keep raw/huge intermediate data and downloaded source documents out of git unless repository policy explicitly requires and licenses them.

## 5. CPU reference interpolation

- [ ] 5.1 Implement a pure deterministic time-mapping/interpolation helper for the runtime artifact.
- [ ] 5.2 Define exact endpoint/clamp behavior and prohibit unsupported extrapolation beyond the validated data range.
- [ ] 5.3 Add pinned tests for first/last keyframes and representative midpoint samples.
- [ ] 5.4 Compare interpolated center/tracer probe states with offline generator reference output within documented tolerance.
- [ ] 5.5 Add reversible scrub tests (`t0 -> t1 -> t0`) proving no stateful drift.

## 6. Galaxy Collision module/renderer

- [ ] 6.1 Add a dynamic `galaxy-collision` phenomenon module following existing Atlas attach/update/render/detach contracts.
- [ ] 6.2 Add source-informed presets/epochs only after their times/views are defined by the locked scenario.
- [ ] 6.3 Upload/use the reduced trajectory asset through the existing asset/resource management path; do not introduce runtime scientific network APIs.
- [ ] 6.4 Implement GPU/renderer interpolation of centers/tracers from keyframe data; scientific particle positions MUST NOT come from cinematic Euler drift.
- [ ] 6.5 Batch particle rendering using existing/shared particle/material infrastructure where compatible without conflating its cinematic drift mode with scientific dynamics.
- [ ] 6.6 Keep glow/dust/background/bloom/camera choreography separate from the data-driven trajectory state and label them procedural/cinematic in docs.
- [ ] 6.7 Add deterministic timeline phase handling and reversible pause/scrub behavior.
- [ ] 6.8 Add a bounded debug/probe mechanism exposing fixed tracer samples/timeline mapping for browser parity tests without normal-frame heavy readback.
- [ ] 6.9 Implement fallback/capability behavior consistent with the Atlas contract; never silently replace the trajectory model with a lower-fidelity simulation.
- [ ] 6.10 Verify all created GPU/scene/listener resources are scoped and disposed on destination exit.

## 7. Atlas integration

- [ ] 7.1 Add registry/launch-catalog metadata only when the development route can be kept non-production until gates pass.
- [ ] 7.2 Add route normalization/deep-link tests for the Galaxy Collision destination.
- [ ] 7.3 Integrate transition/camera/control panel state using existing shell abstractions rather than destination-specific app plumbing.
- [ ] 7.4 Verify direct deep-link, menu launch, back/forward navigation and repeated destination cycles.
- [ ] 7.5 Do not mark production/available in public catalog metadata until section 10 closes.

## 8. Scientific and browser validation

- [ ] 8.1 Add unit tests for source-config guards, artifact parser, time mapping and interpolation.
- [ ] 8.2 Add offline/reference tests for locked source invariants and clearly distinguish quantitative tests from qualitative morphology checks.
- [ ] 8.3 Add browser tests comparing fixed runtime tracer probes with CPU reference interpolation at pinned times.
- [ ] 8.4 Add browser tests for all production-intended presets/epochs, pause/scrub-before-navigation and deterministic re-entry.
- [ ] 8.5 Add resize/quality-tier/fallback tests and confirm finite state/no console/page errors.
- [ ] 8.6 Add repeated enter/exit resource checks and run the global leak/navigation suites.
- [ ] 8.7 Run the existing full unit/browser suites to catch shell/shared-renderer regressions.

## 9. Visual and performance evidence

- [ ] 9.1 Establish scientifically meaningful golden scenarios for bridge/tail formation and at least one alternate epoch/view after interpolation/reference gates are green.
- [ ] 9.2 Review initial golden output against source-locked morphology constraints and document which comparison is qualitative versus numeric.
- [ ] 9.3 Generate only the intentional CA9 baselines, then run the complete golden suite twice independently.
- [ ] 9.4 Add `bench:galaxy-collision` using established benchmark record conventions.
- [ ] 9.5 Record asset load/parse/upload time, tracer/keyframe counts, internal resolution/quality/backend and frame p50/p95 with timing source identified.
- [ ] 9.6 Record true GPU frame timing where supported; do not relabel CPU/rAF timing as GPU timing.
- [ ] 9.7 Verify resource bytes/counts and repeated navigation remain bounded.
- [ ] 9.8 If performance misses budget, optimize data layout/interpolation/batching/validated LOD before reducing scientific trajectory correctness.

## 10. Documentation, release and closure

- [ ] 10.1 Update `DATA_SOURCES_GALAXY_COLLISION.md` from old closed-access status to the final source-lock record with exact provenance/ambiguities.
- [ ] 10.2 Update `DATA_PIPELINE.md` with production config, generation command, schema, checksum and reproducibility instructions.
- [ ] 10.3 Update `PHENOMENA_IMPLEMENTATION.md`, `SCIENTIFIC_FIDELITY.md`, benchmark/testing docs and roadmap/backlog for the shipped reduced model.
- [ ] 10.4 Add/update asset provenance/license documentation and explicitly distinguish repository-generated reduced data from the uncommitted source scan.
- [ ] 10.5 Run `npm ci`, `npm run check`, full available Playwright suite, all CA9 reference/parity tests and complete goldens.
- [ ] 10.6 Inspect the final diff for raw papers/intermediate datasets, secrets, machine paths, unrelated refactors and accidental baseline churn.
- [ ] 10.7 Only after all mandatory gates pass, mark Galaxy Collision production/available in launch-catalog/public docs.
- [ ] 10.8 Update `.agent/STATE.md` and backlog with exact evidence, remaining model limitations and environment-deferred tests.
- [ ] 10.9 Commit with a detailed CA9 report including source lock, data artifact checksum/schema, validation, benchmark context, limitations and reproduction command.
- [ ] 10.10 Push when authorized.
