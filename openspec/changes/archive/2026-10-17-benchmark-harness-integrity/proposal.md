## Why

The performance campaign was the repository's largest effort and its evidence rests entirely on
`scripts/bench-*.mjs` harnesses. The harnesses are unusually honest about what they measure
— each reports `frameCpuMs` and `frameGpuMs` separately with a `gpuTimingNote` explaining exactly
where the GPU number came from, and refuses to report when zero frames were rendered. That
discipline is the point of the campaign's credibility.

It is undermined by a set of confirmed defects in the harness plumbing, all of which cause a
*refusal or a recorded value to be wrong*:

1. **The zero-render refusal cannot fail the process.** Nine of the eleven `scripts/bench-*.mjs`
   files set `process.exitCode = 1` and then terminate with an explicit `process.exit(0)`, which
   overwrites the assigned exit code. The nine are exactly the per-destination harnesses;
   `bench-scenarios.mjs` and `bench-cinematic-matrix.mjs` do not call `process.exit` and are correct —
   which is why running the orchestrators hides the bug.
   The campaign's own `benchmarks/results/2026-08-28-ws0-baseline/SUMMARY.md` states "A harness that
   renders nothing now exits non-zero with an explicit refusal instead of emitting a plausible
   number." For all nine per-destination harnesses that statement is false.

2. **The matrix orchestrator does not compensate.** `bench-cinematic-matrix.mjs` validates the
   effective backend, the effective tier and console errors, but never checks
   `normalized.renderTelemetry.framesRendered`. So a child that silently rendered nothing is
   accepted into `matrix.json` as a success.

3. **Two harnesses ignore the environment the matrix pins.** `bench-stellar-explosion.mjs` and
   `bench-galaxy-collision.mjs` hardcode `chromium.launch({ channel: 'msedge' })` and a
   `1280x800` viewport, and parse neither `--channel` nor `--width`/`--height`. The matrix passes
   all three to every workload and then writes *its requested* values into the manifest. With the
   shipped defaults the values coincide, which is why the committed matrix looks correct. A single
   environment-variable change produces a matrix whose header contradicts its own rows.
   Both also hardcode a `1280 - 320` control-panel subtraction rather than reading the real
   `#viewport` rect the other eight harnesses read.

4. **Four committed baseline rows are unattributable to a commit.** Those same two harnesses emit
   `commit: process.env.BENCH_COMMIT ?? 'uncommitted'` and never shell out to git, unlike the other
   eight. In the committed WS0 baseline, the stellar-explosion and galaxy-collision WebGPU and
   WebGL2 rows all read `"commit": "uncommitted"`, while their fourteen siblings carry
   `90b107ec63ebb988bb2145048383187c50ccef2f`. `docs/BENCHMARK_MATRIX.md:11` makes `commit` a
   required field, and the campaign's "WebGL2 is faster than WebGPU" finding draws on these rows.

5. **A harness can overwrite certified historical evidence.** `bench-black-hole-merger.mjs` defaults
   `--outdir` to `2026-08-25-ca8`, a committed campaign directory, and writes
   `${phase}-${quality}-${label}.json` — so a re-run with the same labels silently overwrites a
   certified record. `docs/BENCHMARK_MATRIX.md:213` explicitly says "Do not overwrite unrelated
   historical benchmark data".

6. **The comparison contract does not exist.** `docs/BENCHMARK_MATRIX.md` §11 prescribes a
   `benchmarks/` tree with `schema.json` and §12 requires a comparison script that refuses to
   compare mismatched metadata. Neither exists. The 12 committed result directories use at least
   three different record shapes, and nothing detects the difference — so any future "X% faster"
   claim has no enforced precondition.

7. **Discovery and diagnosability.** `bench-scenarios.mjs` — the most-cited harness in the campaign
   — has no `package.json` script and is absent from the README benchmark list. And it overwrites
   `record.refusal` rather than accumulating, so a record with two defects reports one.

## What Changes

- **Make the refusal gate able to refuse**, in every harness and in the matrix orchestrator.
- **Honour the matrix's pinned environment** in every child, and have the matrix assert that each
  child's *reported* environment matches what it requested.
- **Attribute every committed baseline row to a commit**, and annotate the four historical rows that
  cannot be.
- **Prevent writes into certified historical directories** by default.
- **Implement the documented benchmark schema and comparison gate**, so a percentage regression claim
  has an enforced precondition.
- **Make every harness discoverable** through a package script, and make a record report all its
  refusal reasons.

Non-goals, explicitly out of scope:

- No change to what any harness measures, how it samples, or how it reports CPU versus GPU time.
  That measurement discipline is correct and must be preserved exactly.
- No re-running of the campaign benchmarks. This change fixes the instruments; re-measuring is a
  separate evidence-gated activity.
- No change to any committed benchmark result. Historical records are evidence, including the four
  unattributable ones — they are annotated, not rewritten.
- No new benchmark dimension.

## Capabilities

### New Capabilities
- `benchmark-harness-integrity`: the contract that a benchmark harness reports a measurement or
  refuses, that a refusal fails the process and its orchestrator, that every recorded result
  describes the environment it was actually measured in, and that a regression claim is refused
  unless the compared runs are comparable.

### Modified Capabilities
- None. No archived baseline capability specifications exist yet
  (`openspec list --specs` reports none); `specification-baseline-hygiene` creates that baseline.
  Every requirement here is an ADDED requirement under the new `benchmark-harness-integrity`
  capability.

## Impact

**Affected code**

- All nine per-destination `scripts/bench-*.mjs` harnesses (exit codes).
- `scripts/bench-stellar-explosion.mjs`, `scripts/bench-galaxy-collision.mjs` (argument contract,
  commit attribution, viewport rect).
- `scripts/bench-cinematic-matrix.mjs` (child validation, refusal accumulation).
- `scripts/bench-scenarios.mjs` (refusal accumulation, package script).
- `scripts/bench-black-hole-merger.mjs` (default output directory).
- New: `benchmarks/schema.json`, `scripts/compare-benchmarks.mjs`.
- `package.json`, `README.md`.

**Affected tests**

- None directly; the harnesses are not unit-tested today. This change should add a small test for
  the record-normalisation and refusal logic, which is currently only exercisable by running the
  whole harness.

**Affected documents**

- `docs/BENCHMARK_MATRIX.md` (§11/§12 become real), `docs/PERFORMANCE.md`,
  `docs/PERFORMANCE_CERTIFICATION.md`, `docs/BENCHMARK_MATRIX.md` §"Not recorded" lists.

**Dependencies**

- Shares the smoke/CI lane with `verification-gate-integrity` (both touch `.github/workflows/ci.yml`);
  coordinate that file. Sequentially follows it, because the harness fixes make the CI gate checks
  meaningful.

**Compatibility risk**

- Fixing the exit codes will make the nine harnesses exit non-zero in situations where they
  currently exit zero. If any of those situations is routine, it will surface immediately — which is
  the intent, but it should be discovered on a scratch run, not in a certification run.
