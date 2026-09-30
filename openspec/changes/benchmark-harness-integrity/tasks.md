# Tasks — Benchmark harness integrity

## 0. Baseline

- [ ] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [ ] 0.2 Run `npm run check` and record the result.
- [ ] 0.3 Record the current exit status of a harness that renders nothing (see task 1.1) as the before-evidence.
- [ ] 0.4 Inventory the record shape of all 13 committed benchmark result directories.
- [ ] 0.5 Confirm `openspec validate benchmark-harness-integrity --type change --strict` passes.

## 1. Negative test first

- [ ] 1.1 Temporarily neuter the forced-continuous-render path and run `npm run bench:neutron-star`. Confirm it currently exits 0. Record that.
- [ ] 1.2 Run the cinematic matrix with a deliberately failing child. Confirm the orchestrator currently exits 0. Record that.

## 2. Refusal gates

- [ ] 2.1 Remove the trailing `process.exit(0)` from the nine affected harnesses, so `process.exitCode` survives.
- [ ] 2.2 Verify each of the nine now exits non-zero when it refuses, and zero when it succeeds.
- [ ] 2.3 Add a `framesRendered > 0` assertion in `bench-cinematic-matrix.mjs` alongside its existing backend and tier validation.
- [ ] 2.4 Have the matrix cross-check each child's reported backend, tier and viewport against what it requested, and fail on mismatch.
- [ ] 2.5 Ensure the matrix continues with remaining workloads after a child fails, and reports the run as failed overall.
- [ ] 2.6 Confirm the checks from 1.1 and 1.2 now fail as intended.

## 3. Argument contract

- [ ] 3.1 Add `--channel`, `--width` and `--height` parsing to `bench-stellar-explosion.mjs` and `bench-galaxy-collision.mjs`.
- [ ] 3.2 Derive the render area from the application's real `#viewport` element rect in both, removing the hardcoded `1280 - 320` assumption.
- [ ] 3.3 Port the `currentCommit()` helper into both harnesses so they attribute their own revision.
- [ ] 3.4 Add `schemaVersion` and `kind` to both harnesses' records.
- [ ] 3.5 Verify with a non-default viewport and channel that both harnesses honour them and report them.
- [ ] 3.6 Add unit tests for the record-normalisation logic extracted from the harnesses.

## 4. Evidence safety

- [ ] 4.1 Change the default output directory of `bench-black-hole-merger.mjs` to a run-scoped path.
- [ ] 4.2 Refuse to write into a directory holding certified evidence unless an explicit overwrite is requested; name the record that would be affected.
- [ ] 4.3 Add a unit test for both the refusal and the override.
- [ ] 4.4 Annotate the four commit-unattributable rows in `benchmarks/results/2026-08-28-ws0-baseline/SUMMARY.md`.
- [ ] 4.5 State in `docs/PERFORMANCE_CERTIFICATION.md` that the "WebGL2 faster than WebGPU" finding draws partly on commit-unattributable rows.
- [ ] 4.6 Do NOT rewrite the four historical records.

## 5. Schema and comparison gate

- [ ] 5.1 Write `benchmarks/schema.json` covering the union of the record shapes in use.
- [ ] 5.2 Mark the older-shape records `legacy` in the schema so existing evidence is not invalidated.
- [ ] 5.3 Implement `scripts/compare-benchmarks.mjs` with the mismatch list from `docs/BENCHMARK_MATRIX.md` section 12: backend, quality, preset, unit of work, internal resolution, browser, adapter, sample count, schema version.
- [ ] 5.4 Make the comparator name every differing dimension when it refuses.
- [ ] 5.5 Provide an explicit override that states comparability was overridden and which dimensions differed.
- [ ] 5.6 Add unit tests: a mismatched pair is refused and names the dimensions; a matched pair reports a percentage; a cross-schema pair is refused.
- [ ] 5.7 Run the comparator across two committed matrices and confirm it refuses rather than printing a percentage.
- [ ] 5.8 Wire the comparator into the documented command surface.

## 6. Discoverability and diagnosability

- [ ] 6.1 Add a package script for `bench-scenarios.mjs`.
- [ ] 6.2 List it in the README benchmark list.
- [ ] 6.3 Change `record.refusal` in `bench-scenarios.mjs` to accumulate every reason.
- [ ] 6.4 Add a test that a record with two independent refusals reports both.

## 7. Documentation

- [ ] 7.1 Update `docs/BENCHMARK_MATRIX.md` so sections 11 and 12 describe what now exists.
- [ ] 7.2 Update `docs/PERFORMANCE.md` and `docs/PERFORMANCE_CERTIFICATION.md` for the schema, the comparison gate and the annotated limitation.
- [ ] 7.3 Correct the WS0 baseline summary's claim that a zero-render harness exits non-zero, once it is true.

## 8. Validation and evidence

- [ ] 8.1 `npm run check` green.
- [ ] 8.2 Every negative test from section 1 now fails as intended.
- [ ] 8.3 Run one representative harness end to end and confirm a valid record and a zero exit.
- [ ] 8.4 Run the cinematic matrix at one tier and confirm a valid matrix and a zero exit.
- [ ] 8.5 Run the scenario matrix and confirm a valid matrix and a zero exit.
- [ ] 8.6 Confirm no committed benchmark record was modified: `git status --short benchmarks/`.
- [ ] 8.7 `openspec validate benchmark-harness-integrity --type change --strict` still passes.

## 9. Close-out

- [ ] 9.1 Strike findings B-01 through B-07 from `docs/MASTER_PLAN.md` with their resolution commits.
- [ ] 9.2 Append evidence to `.agent/STATE.md`.
- [ ] 9.3 Commit this change as one coherent checkpoint.
