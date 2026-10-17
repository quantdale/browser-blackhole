# Tasks — Benchmark harness integrity

## 0. Baseline

- [x] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [x] 0.2 Run `npm run check` and record the result.
- [x] 0.3 Record the current exit status of a harness that renders nothing (see task 1.1) as the before-evidence.
- [x] 0.4 Inventory the record shape of all 12 committed benchmark result directories. The earlier "13" count was wrong.
- [x] 0.5 Confirm `openspec validate benchmark-harness-integrity --type change --strict` passes.

## 1. Negative test first

- [x] 1.1 Temporarily neuter the forced-continuous-render path and run `npm run bench:neutron-star`. Confirm it currently exits 0. Record that.
- [x] 1.2 Run the cinematic matrix with a deliberately failing child. Confirm the orchestrator currently exits 0. Record that.

## 2. Refusal gates

- [x] 2.1 Remove the trailing `process.exit(0)` from the nine affected harnesses, so `process.exitCode` survives.
- [x] 2.2 Verify each of the nine now exits non-zero when it refuses, and zero when it succeeds.
- [x] 2.3 Add a `framesRendered > 0` assertion in `bench-cinematic-matrix.mjs` alongside its existing backend and tier validation.
- [x] 2.4 Have the matrix cross-check each child's reported backend, tier and viewport against what it requested, and fail on mismatch.
- [x] 2.5 Ensure the matrix continues with remaining workloads after a child fails, and reports the run as failed overall.
- [x] 2.6 Confirm the checks from 1.1 and 1.2 now fail as intended.

## 3. Argument contract

- [x] 3.1 Add `--channel`, `--width` and `--height` parsing to `bench-stellar-explosion.mjs` and `bench-galaxy-collision.mjs`.
- [x] 3.2 Derive the render area from the application's real `#viewport` element rect in both, removing the hardcoded `1280 - 320` assumption.
- [x] 3.3 Port the `currentCommit()` helper into both harnesses so they attribute their own revision.
- [x] 3.4 Add `schemaVersion` and `kind` to both harnesses' records.
- [x] 3.5 Verify with a non-default viewport and channel that both harnesses honour them and report them.
- [x] 3.6 Add unit tests for the record-normalisation logic extracted from the harnesses.

## 4. Evidence safety

- [x] 4.1 Change the default output directory of `bench-black-hole-merger.mjs` to a run-scoped path.
- [x] 4.2 Refuse to write into a directory holding certified evidence unless an explicit overwrite is requested; name the record that would be affected.
- [x] 4.3 Add a unit test for both the refusal and the override.
- [x] 4.4 Annotate the four commit-unattributable rows in `benchmarks/results/2026-08-28-ws0-baseline/SUMMARY.md`.
- [x] 4.5 State in `docs/PERFORMANCE_CERTIFICATION.md` that the "WebGL2 faster than WebGPU" finding draws partly on commit-unattributable rows.
- [x] 4.6 Do NOT rewrite the four historical records.

## 5. Schema and comparison gate

- [x] 5.1 Write `benchmarks/schema.json` covering the union of the record shapes in use.
- [x] 5.2 Mark the older-shape records `legacy` in the schema so existing evidence is not invalidated.
- [x] 5.3 Implement `scripts/compare-benchmarks.mjs` with the mismatch list from `docs/BENCHMARK_MATRIX.md` section 12: backend, quality, preset, unit of work, internal resolution, browser, adapter, sample count, schema version.
- [x] 5.4 Make the comparator name every differing dimension when it refuses.
- [x] 5.5 Provide an explicit override that states comparability was overridden and which dimensions differed.
- [x] 5.6 Add unit tests: a mismatched pair is refused and names the dimensions; a matched pair reports a percentage; a cross-schema pair is refused.
- [x] 5.7 Run the comparator across two committed matrices and confirm it refuses rather than printing a percentage.
- [x] 5.8 Wire the comparator into the documented command surface.

## 6. Discoverability and diagnosability

- [x] 6.1 Add a package script for `bench-scenarios.mjs`.
- [x] 6.2 List it in the README benchmark list.
- [x] 6.3 Change `record.refusal` in `bench-scenarios.mjs` to accumulate every reason.
- [x] 6.4 Add a test that a record with two independent refusals reports both.

## 7. Documentation

- [x] 7.1 Update `docs/BENCHMARK_MATRIX.md` so sections 11 and 12 describe what now exists.
- [x] 7.2 Update `docs/PERFORMANCE.md` and `docs/PERFORMANCE_CERTIFICATION.md` for the schema, the comparison gate and the annotated limitation.
- [x] 7.3 Correct the WS0 baseline summary's claim that a zero-render harness exits non-zero, once it is true.

## 8. Validation and evidence

- [x] 8.1 `npm run check` green.
- [x] 8.2 Every negative test from section 1 now fails as intended.
- [x] 8.3 Run one representative harness end to end and confirm a valid record and a zero exit.
- [x] 8.4 Run the cinematic matrix at one tier and confirm a valid matrix and a zero exit.
- [x] 8.5 Run the scenario matrix and confirm a valid matrix and a zero exit.
- [x] 8.6 Confirm no committed benchmark record was modified: `git status --short benchmarks/`.
- [x] 8.7 `openspec validate benchmark-harness-integrity --type change --strict` still passes.

## 9. Close-out

- [x] 9.1 Strike findings B-01 through B-07 from `docs/MASTER_PLAN.md` with their resolution commits.
- [x] 9.2 Append evidence to `.agent/STATE.md`.
- [x] 9.3 Commit this change as one coherent checkpoint.


---

## Evidence summary (2026-10-17 completion pass)

- **B-01 (0.3/1.1/2.2/2.6):** the nine harnesses' trailing `process.exit(0)`
  overwrote `process.exitCode = 1` from the zero-render refusal. Removed in
  all nine (the comment records why). ACCEPTANCE PROVEN: neutering the
  forced-continuous-render path in `bench-neutron-star` and running it
  (`--frames=20 --warmupMs=1000`) now exits **1** (recorded before-fix exit 0
  in the tasks); restored and green.
- **B-02 (3.1-3.5):** `bench-stellar-explosion` and `bench-galaxy-collision`
  now parse and HONOUR `--channel/--width/--height` (previously hardcoded
  `channel: 'msedge'`, `1280x800` while the matrix recorded the requested
  values), derive the render area from the real `#viewport` rect (the
  `1280 - 320` literal is gone), attribute their own revision via
  `currentCommit()`, and emit `schemaVersion: 2` + `kind` records reporting
  the honoured viewport/channel. **3.6:** `normalizeRecord` extracted to
  `scripts/lib/bench-records.mjs` and unit-tested (`benchRecords.test.ts`).
- **B-03 (4.4-4.6):** the four commit-unattributable ws0 rows
  (`stellar-explosion-*`, `galaxy-collision-*`) are ANNOTATED in the
  baseline SUMMARY and in `docs/PERFORMANCE_CERTIFICATION.md` (the
  "WebGL2 faster than WebGPU" finding draws partly on them and is cited with
  that qualification). The historical records are NOT rewritten.
- **B-04 (4.1-4.3):** `bench-black-hole-merger` defaults to a RUN-SCOPED
  output directory (was `2026-08-25-ca8`, committed evidence) and refuses to
  overwrite an existing record without `--allow-overwrite`, naming the record
  at risk. The manifest parse at the trust boundary now fails loudly.
- **B-05 (6.1/6.2):** `npm run bench:scenarios` added and listed in the
  README benchmark table.
- **B-06 (6.3/6.4):** `accumulateRefusal` accumulates EVERY reason (the
  `record.refusal = x` overwrite lost the first); unit test proves a record
  with two independent refusals reports both.
- **B-07 (5.1-5.8):** `benchmarks/schema.json` covers the union of the record
  shapes (legacy schemaVersion 1 explicitly valid — 5.2); the §12 mismatch
  list is exactly what `npm run bench:compare` checks (backend, quality,
  preset, unit of work, internal resolution, browser, adapter, sample count,
  schema version), naming every differing dimension on refusal and requiring
  `--override` to state that comparability was overridden. **5.7 demonstrated
  live:** comparing two committed ws0 records REFUSES and names `preset` and
  `unitOfWork` (was: an incomparable percentage). Unit tests cover refusal,
  percentage, cross-schema refusal and the override note.
- **2.3-2.5:** the cinematic matrix asserts `framesRendered > 0` per child
  (a zero-render child is a refusal, not a measurement) and cross-checks the
  child-reported backend, tier, VIEWPORT and CHANNEL against what it
  requested; children that fail are recorded and the run continues, failing
  overall via `process.exitCode = 1` (the orchestrators were already correct
  on that axis).
