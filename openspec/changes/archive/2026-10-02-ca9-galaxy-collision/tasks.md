# Tasks: CA9 Galaxy Collision

Do not begin section 3 or later until the source-lock gate in section 2 is complete. If a required production parameter remains materially unsupported, record `BLOCKED_SOURCE` and stop dependent tasks.

## 1. Prerequisite and baseline gate

- [x] 1.1 Confirm M12-NS and M12-RI are closed (both pushed: a827563, 5e01bbb) with their required evidence and the repository current-state docs name CA9 as the next feature.
- [x] 1.2 Record baseline HEAD (HEAD 5e01bbb, Node 22.23.2, Edge 151, npm ci + check), tool versions, browser/GPU context and run `npm ci` plus `npm run check`.
- [x] 1.3 Run the existing CA9 integrator self-check/unit prework (exercise still placeholder, 515 unit) and confirm exercise mode remains clearly non-production.
- [x] 1.4 Read `docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION.md`, `DATA_PIPELINE.md`, roadmap/work-packet/fidelity docs, the full restricted-three-body tool, its tests and the CA8 data-driven pipeline precedent. (read all before coding)

## 2. Primary-source lock — HARD GATE

- [x] 2.1 Retrieve the Toomre & Toomre (1972) scan (GISS to03000u.pdf + NTRS 19730032576, DOI 10.1086/151823) through the NASA GISS publication record and confirm bibliographic identity/DOI against NASA NTRS metadata.
- [x] 2.2 Do not commit the downloaded paper PDF (not committed, URL/date in source-lock doc) unless redistribution rights are independently established; record retrieval URL/access date in docs instead.
- [x] 2.3 Select one reproducible paper model/case (equal-mass bridge/tail) suitable for the first CA9 production scenario and record why it is sufficient.
- [x] 2.4 Transcribe required mass/gravitational parameters (M=1, G=1, ratio 1:1) with exact page/section/figure/table provenance.
- [x] 2.5 Transcribe encounter/orbit type (parabolic e=1, q=4), closest-approach/scale and initial-state information required by the reduced model.
- [x] 2.6 Transcribe disk/tracer radial distribution (R_in 0.5, R_out 2.5) and orientation/sense parameters required by the selected case.
- [x] 2.7 Freeze coordinate frame (G=1, Barker), handedness, angle convention, dimensionless length/time/velocity normalization and mappings to repository units.
- [x] 2.8 Identify source epochs/phases/figures (figs 19/21/22/23, window -50..70) used for qualitative or quantitative reconstruction checks.
- [x] 2.9 Label every derived or figure-digitized value (source-lock table) as derived, record the method and uncertainty, and never present it as a verbatim tabulated value.
- [x] 2.10 Create/update the source-lock table (source-lock doc) with value, units, source location, derivation and confidence for every production parameter.
- [x] 2.11 Have the generator (fail-closed)’s production config reference only source-locked or explicitly derived fields; no exercise/default placeholder may satisfy a production-required field.
- [x] 2.12 If any required parameter is materially unresolved (no blocker), write the exact blocker into the source doc/state, leave dependent tasks unchecked, mark CA9 `BLOCKED_SOURCE`, and stop sections 3–10.

## 3. Production offline configuration and generator

- [x] 3.1 Define a versioned production scenario/config schema separate from exercise/self-check values.
- [x] 3.2 Add strict guards for missing, non-finite, exercise-marked, unit-inconsistent or unsupported production fields.
- [x] 3.3 Refactor `restricted_three_body.py` only as needed so production runs consume the explicit source-locked config rather than embedded placeholder constants.
- [x] 3.4 Preserve deterministic seed/order/integration behavior and document Python/tool dependencies required to reproduce generation.
- [x] 3.5 Add tests proving production mode refuses incomplete/exercise configuration.
- [x] 3.6 Add tests for unit/frame conversion and initial-condition construction from the locked scenario.
- [x] 3.7 Characterize integration step sensitivity/error for representative center/tracer trajectories and choose production settings from evidence.
- [x] 3.8 Run deterministic repeat generation and verify identical logical output/checksum under the pinned environment.
- [x] 3.9 Verify no non-finite center/tracer trajectories and record source-derived invariants/qualitative comparison limits.

## 4. Runtime data artifact

- [x] 4.1 Specify a versioned `GC1` (or equivalently named) runtime binary schema with magic/version, counts, time range, encoding/scales and deterministic record order.
- [x] 4.2 Choose keyframe cadence and numeric precision from measured interpolation/quantization error versus asset-size/runtime cost.
- [x] 4.3 Serialize galaxy centers and tracer trajectories/keyframes deterministically.
- [x] 4.4 Generate a manifest containing source/scenario id, schema version, generator version/commit, generation command, byte size and checksum.
- [x] 4.5 Add a production loader that bounds-checks lengths/counts/offsets, rejects unsupported versions and rejects corrupt/truncated data truthfully.
- [x] 4.6 Add parser fixtures/tests for valid, truncated, corrupt, unsupported-version and pathological-count inputs.
- [x] 4.7 Prove a committed runtime artifact can be regenerated from the documented production config/tooling without the raw paper PDF in the repository.
- [x] 4.8 Keep raw/huge intermediate data and downloaded source documents out of git unless repository policy explicitly requires and licenses them.

## 5. CPU reference interpolation

- [x] 5.1 Implement a pure deterministic time-mapping/interpolation helper for the runtime artifact.
- [x] 5.2 Define exact endpoint/clamp behavior and prohibit unsupported extrapolation beyond the validated data range.
- [x] 5.3 Add pinned tests for first/last keyframes and representative midpoint samples.
- [x] 5.4 Compare interpolated center/tracer probe states with offline generator reference output within documented tolerance.
- [x] 5.5 Add reversible scrub tests (`t0 -> t1 -> t0`) proving no stateful drift.

## 6. Galaxy Collision module/renderer

- [x] 6.1 Add a dynamic `galaxy-collision` phenomenon module following existing Atlas attach/update/render/detach contracts.
- [x] 6.2 Add source-informed presets/epochs only after their times/views are defined by the locked scenario.
- [x] 6.3 Upload/use the reduced trajectory asset through the existing asset/resource management path; do not introduce runtime scientific network APIs.
- [x] 6.4 Implement GPU/renderer interpolation of centers/tracers from keyframe data; scientific particle positions MUST NOT come from cinematic Euler drift.
- [x] 6.5 Batch particle rendering using existing/shared particle/material infrastructure where compatible without conflating its cinematic drift mode with scientific dynamics.
- [x] 6.6 Keep glow/dust/background/bloom/camera choreography separate from the data-driven trajectory state and label them procedural/cinematic in docs.
- [x] 6.7 Add deterministic timeline phase handling and reversible pause/scrub behavior.
- [x] 6.8 Add a bounded debug/probe mechanism exposing fixed tracer samples/timeline mapping for browser parity tests without normal-frame heavy readback.
- [x] 6.9 Implement fallback/capability behavior consistent with the Atlas contract; never silently replace the trajectory model with a lower-fidelity simulation.
- [x] 6.10 Verify all created GPU/scene/listener resources are scoped and disposed on destination exit.

## 7. Atlas integration

- [x] 7.1 Add registry/launch-catalog metadata only when the development route can be kept non-production until gates pass.
- [x] 7.2 Add route normalization/deep-link tests for the Galaxy Collision destination.
- [x] 7.3 Integrate transition/camera/control panel state using existing shell abstractions rather than destination-specific app plumbing.
- [x] 7.4 Verify direct deep-link, menu launch, back/forward navigation and repeated destination cycles.
- [x] 7.5 Do not mark production/available in public catalog metadata until section 10 closes.

## 8. Scientific and browser validation

- [x] 8.1 Add unit tests for source-config guards, artifact parser, time mapping and interpolation.
- [x] 8.2 Add offline/reference tests for locked source invariants and clearly distinguish quantitative tests from qualitative morphology checks.
- [x] 8.3 Add browser tests comparing fixed runtime tracer probes with CPU reference interpolation at pinned times.
- [x] 8.4 Add browser tests for all production-intended presets/epochs, pause/scrub-before-navigation and deterministic re-entry.
- [x] 8.5 Add resize/quality-tier/fallback tests and confirm finite state/no console/page errors.
- [x] 8.6 Add repeated enter/exit resource checks and run the global leak/navigation suites.
- [x] 8.7 Run the existing full unit/browser suites to catch shell/shared-renderer regressions.

## 9. Visual and performance evidence

- [x] 9.1 Establish scientifically meaningful golden scenarios for bridge/tail formation and at least one alternate epoch/view after interpolation/reference gates are green.
- [x] 9.2 Review initial golden output against source-locked morphology constraints and document which comparison is qualitative versus numeric.
- [x] 9.3 Generate only the intentional CA9 baselines, then run the complete golden suite twice independently.
- [x] 9.4 Add `bench:galaxy-collision` using established benchmark record conventions.
- [x] 9.5 Record asset load/parse/upload time, tracer/keyframe counts, internal resolution/quality/backend and frame p50/p95 with timing source identified.
- [x] 9.6 Record true GPU frame timing where supported; do not relabel CPU/rAF timing as GPU timing.
- [x] 9.7 Verify resource bytes/counts and repeated navigation remain bounded.
- [x] 9.8 If performance misses budget, optimize data layout/interpolation/batching/validated LOD before reducing scientific trajectory correctness.

## 10. Documentation, release and closure

- [x] 10.1 Update `DATA_SOURCES_GALAXY_COLLISION.md` from old closed-access status to the final source-lock record with exact provenance/ambiguities.
- [x] 10.2 Update `DATA_PIPELINE.md` with production config, generation command, schema, checksum and reproducibility instructions.
- [x] 10.3 Update `PHENOMENA_IMPLEMENTATION.md`, `SCIENTIFIC_FIDELITY.md`, benchmark/testing docs and roadmap/backlog for the shipped reduced model.
- [x] 10.4 Add/update asset provenance/license documentation and explicitly distinguish repository-generated reduced data from the uncommitted source scan.
- [x] 10.5 Run `npm ci`, `npm run check`, full available Playwright suite, all CA9 reference/parity tests and complete goldens.
- [x] 10.6 Inspect the final diff for raw papers/intermediate datasets, secrets, machine paths, unrelated refactors and accidental baseline churn.
- [x] 10.7 Only after all mandatory gates pass, mark Galaxy Collision production/available in launch-catalog/public docs.
- [x] 10.8 Update `.agent/STATE.md` and backlog with exact evidence, remaining model limitations and environment-deferred tests.
- [x] 10.9 Commit with a detailed CA9 report including source lock, data artifact checksum/schema, validation, benchmark context, limitations and reproduction command.
- [x] 10.10 Push when authorized.
