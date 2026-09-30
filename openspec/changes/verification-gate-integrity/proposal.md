## Why

Four P0/P1 defects were certified as production-ready across multiple campaigns. None of them was
found by a test. They were found by reading the source during this audit. That is the finding this
change addresses: **the gates are structurally unable to fail for the defect classes that matter
most.**

The evidence is specific and repeated:

- **A declared tolerance that is measured, printed, and never asserted.**
  `tests/unit/lutEquivalence.test.ts` declares in its own header "terminal direction: <= 5e-3 rad",
  computes the angular error on every run, prints it, then executes `void angErr;` and asserts only
  `results.length > 0`. The test name says "category-specific tolerance". A drift to 0.3 rad would
  print a larger number and stay green.

- **Subjects that can all be skipped while the test still reports passed.** `lutEquivalence.ts:106`
  `continue`s on domain exclusion; `:115-116` places *both* assertions inside `if (status !==
  'fallback-numerical')`; `kerrReference.test.ts:170,201,205` `continue`/`return` inside the corpus
  loop; `kerrConvergence.test.ts:58` returns before any assertion. Each exclusion is individually
  documented and defensible. None counts. The browser parity specs solve exactly this problem
  correctly with `expect(rays.length).toBeGreaterThanOrEqual(N)` after the filters — the pattern
  exists in this repository and was simply not applied to the unit tier.

- **A golden gate with no absolute content floor.** `visual-goldens.spec.ts` asserts only
  `status === 'pass'`, a *relative* delta against a baseline. The harness's own comment, repeated
  across 11 rows, records two measured false passes on 2026-08-29 where a subject was destroyed and
  the comparison still passed. The cinematic suite, in the same repository, already asserts an
  absolute `meanLuma` floor.

- **A stored verdict asserted as a measurement.** `tests/unit/ca9Integrator.test.ts` asserts
  `report.allPass === true` from a committed JSON produced by a Python tool that CI never runs.

- **A refusal gate that cannot refuse.** Nine of ten benchmark harnesses set `process.exitCode = 1`
  and then call `process.exit(0)`, which overwrites it. The campaign's own summary claims "a harness
  that renders nothing now exits non-zero".

- **The production asset-resolution path is untested.** The app resolves the LUT through
  `public/luts/index.json`; the unit tests scan directories instead. A corrupted index silently
  degrades the whole application to the numerical backend with a green suite.

- **The hosted CI gate can skip.** Two of five smoke tests `test.skip` on a backend-less runner and
  the job still exits 0.

This change makes a green gate mean *"the stated check ran and measured"*. It is the highest
leverage change in the plan: it is what prevents the next campaign from repeating this.

## What Changes

- **Assert every declared tolerance.** Where a tolerance in a test header is not yet enforced,
  either enforce it or mark the test explicitly as measurement-only.
- **Count compared subjects.** Any test that can skip subjects asserts a minimum compared count.
- **Give the scientific golden suite an absolute content floor** and a golden-inventory assertion,
  generalising the pattern the cinematic suite already uses.
- **Cover the production asset-resolution path** for every runtime asset, not an ad-hoc directory
  scan.
- **Make a skip observable.** Skips that are correct stay, but a gate that degrades below its
  intended coverage fails instead of passing quietly.
- **Make every runtime asset loader reject unsafe asset references.** The LUT loader already
  rejects a parent-directory segment, a backslash or a leading slash in a declared asset file name;
  the black-hole-merger and galaxy-collision loaders validate the field only as a string and
  interpolate it directly into a request URL. Bring the two loaders onto the existing rule.
- **Make stored artifacts provably fresh**, or explicitly annotated as historical.
- **Delete the zero-assertion test file** and resolve the orphaned golden fixtures.
- **Add cheap compensating CI checks** for the GPU work hosted CI cannot run.
- **Add coverage tooling** as a reported signal, not a gate.

Non-goals, explicitly out of scope:

- No new test *scope* beyond closing these specific classes. Writing tests for untested modules is a
  separate, larger activity; this change makes the existing suite honest.
- No change to any existing tolerance value, golden baseline, or test assertion strength in the
  direction of being looser. Every change here makes a gate stricter or more truthful.
- No change to the browser test harness's capture protocol.
- No attempt to run the GPU suites on hosted runners. That decision is correct and stays.

## Capabilities

### New Capabilities
- `verification-gate-integrity`: the contract that a passing gate means the check it names actually
  ran, measured the subjects it claims, and would fail if the property it protects were broken.

### Modified Capabilities
- None. No archived baseline capability specifications exist yet
  (`openspec list --specs` reports none); `specification-baseline-hygiene` creates that baseline.
  Every requirement here is an ADDED requirement under the new `verification-gate-integrity`
  capability.

## Impact

**Affected code**

- `tests/unit/{lutEquivalence,lutRuntime,kerrReference,kerrConvergence,capability,launchCatalog}.test.ts`.
- `tests/browser/{visual-goldens.spec.ts,support/goldenHarness.ts,smoke.spec.ts,ca9Integrator paths}`.
- `tests/unit/__probe.test.ts` — deleted.
- `scripts/bench-*.mjs` — the refusal exit codes (shared with `benchmark-harness-integrity`; this
  change covers the *test-facing* consequence, that change covers the *harness* consequence).
- `vite.config.ts`, `package.json` — coverage configuration.
- `.github/workflows/ci.yml` — the compensating checks.

**Affected tests**

- Every test listed above, plus the golden harness and the CI workflow.

**Affected documents**

- `docs/TESTING.md`, `docs/CI_CD.md`, `.agent/QUALITY_GATES.md`, `docs/BENCHMARK_MATRIX.md`.

**Dependencies**

- **Must not start before the phase-1 correctness changes land.** Writing a gate against defective
  code encodes the defect as expected behaviour. Specifically: the LUT tolerance gate must be
  written against the corrected LUT (from `kerr-gpu-initializer-correctness`), and the Kerr
  compared-count assertions against the corrected Kerr.

**Compatibility risk**

- Some previously-passing tests will fail on first run after their compared-count assertions are
  added. That is the intended discovery, not a regression: it reveals that the effective corpus was
  smaller than documented. Each such failure must be investigated and either fixed in the code or
  documented as a reduced, deliberate corpus.
- Adding an absolute content floor may require re-capturing sparse-content goldens, because the
  current baselines are themselves near-empty. That must be handled as a *discovered* problem with
  its own justification, never as a quiet re-baseline.
