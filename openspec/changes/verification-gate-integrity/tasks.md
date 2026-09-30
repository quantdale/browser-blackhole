# Tasks — Verification gate integrity

**Do not start this change before the phase-1 correctness changes have landed.** Writing a gate
against defective code encodes the defect as expected behaviour.

## 0. Baseline

- [ ] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [ ] 0.2 Run `npm run check` and record the unit test count and file count as the before-state.
- [ ] 0.3 Record which of the section-1 items currently pass and which currently fail, by actually attempting each negative test. This is the audit trail for "this gate was blind".
- [ ] 0.4 Confirm `openspec validate verification-gate-integrity --type change --strict` passes.

## 1. Negative tests first (the acceptance suite for this change)

- [ ] 1.1 Point `public/luts/index.json` at a non-existent family. Confirm `npm run test` currently PASSES. Record that.
- [ ] 1.2 Delete one committed golden PNG. Confirm no automated check currently fails. Record that.
- [ ] 1.3 Widen a LUT domain exclusion so all corpus rays are skipped. Confirm the affected tests currently PASS. Record that.
- [ ] 1.4 Delete a subject from a sparse-content scene (or simulate it). Confirm the golden row currently PASSES. Record that.
- [ ] 1.5 Run a benchmark harness with the renderer neutered. Confirm the process currently exits 0. Record that.

## 2. Declared tolerances

- [ ] 2.1 Attempt to enforce the LUT terminal-direction tolerance using the matched-anchor comparison technique already used in `tests/unit/lutGenerate.test.ts`.
- [ ] 2.2 If enforcement succeeds, assert it and record the measured margin.
- [ ] 2.3 If enforcement is out of scope, rename the test to state it is a measurement, remove the tolerance claim from the header, add a source comment, and delete the `void angErr;` statement.
- [ ] 2.4 Remove the `void x;` statements in `tests/unit/lutRuntime.test.ts`, restoring or deleting the underlying cross-check.
- [ ] 2.5 Re-run the 1.1-style check: perturb the generator's terminal-direction channel and confirm the gate goes red (or, under 2.3, confirm the test no longer claims a bound).

## 3. Compared-subject counts

- [ ] 3.1 Add a compared-count assertion to `tests/unit/lutEquivalence.test.ts` (three locations).
- [ ] 3.2 Add a compared-count assertion to `tests/unit/kerrReference.test.ts` (three locations).
- [ ] 3.3 Add a compared-count assertion to `tests/unit/kerrConvergence.test.ts`.
- [ ] 3.4 Add compared-count assertions to any other unit test found to contain an unguarded `continue`/`return` before its assertion.
- [ ] 3.5 Run the suite. Triage every newly-red test: either a real defect, or an explicitly documented reduced corpus recorded in this change's `tasks.md`. Do NOT lower a minimum to match an observed count without recording the reason.
- [ ] 3.6 Convert `lutEquivalence.test.ts`'s setup `it()` into a `beforeAll` with a real assertion, so a broken family produces one clear failure rather than seven cascading ones.
- [ ] 3.7 Confirm the check from 1.3 now fails.

## 4. Image regression integrity

- [ ] 4.1 Extract the luminance-grid computation from `tests/browser/support/appHarness.ts` into a shared helper.
- [ ] 4.2 Return `meanLuma` (and a spatial statistic if useful) from the golden comparison.
- [ ] 4.3 Define a per-scene absolute content floor for every row in the scientific suite, with explicit documented exemptions where a scene is genuinely near-empty.
- [ ] 4.4 Assert the floor in `tests/browser/visual-goldens.spec.ts`.
- [ ] 4.5 Add a golden-inventory check: set equality between declared scene names and committed baseline filenames, in both directions, runnable without a GPU.
- [ ] 4.6 Wire the inventory check into the hosted CI quality job.
- [ ] 4.7 Confirm the checks from 1.2 and 1.4 now fail as intended.
- [ ] 4.8 Handle any baseline that genuinely fails its new floor: raise the defect it represents, fix it, and re-capture with a written justification. Never lower the floor to fit a weak baseline.

## 5. Runtime asset resolution

- [ ] 5.1 Extract the LUT index-resolution step of the production path into a testable pure function used by BOTH the product and the test.
- [ ] 5.2 Add a test that resolves the shipped index and fully validates the selected family (structure, byte length, per-asset checksum).
- [ ] 5.3 Add the equivalent resolution test for the BBH merger and galaxy-collision data manifests.
- [ ] 5.4 Make the production index-resolution failure paths report a reason instead of returning null silently.
- [ ] 5.5 Add a test for the same behaviour on the BBH and GC loaders.
- [ ] 5.6 Confirm the check from 1.1 now fails.
- [ ] 5.7 Remove the order-dependent `findShippedFamilyDir()` helpers; share one resolver.

## 6. Skips, artifacts, dead tests

- [ ] 6.1 Make the hosted smoke job fail when fewer than the expected number of tests execute, or when any test skips.
- [ ] 6.2 Prefer forcing a known backend in the smoke tests over skipping on an unknown one.
- [ ] 6.3 Add the galaxy-collision self-check to CI with a `git diff --exit-code` freshness gate (it is pure-stdlib and can run hosted).
- [ ] 6.4 Annotate the BBH reducer artifacts and their tests as stored verdicts, listing them explicitly, until the Python toolchain is fixed.
- [ ] 6.5 Delete `tests/unit/__probe.test.ts`; fold anything still valuable from it into `starfield.test.ts` as a real assertion.
- [ ] 6.6 Resolve the eight orphaned `_WEBGL2` cinematic baselines: either add a documented command that reaches them or delete them.
- [ ] 6.7 Add unit coverage for `src/shaders/cameraRayMath.ts`, the CPU reference the browser parity gate depends on.

## 7. Coverage and enumeration

- [ ] 7.1 Add coverage tooling to the quality job as a report only, with no global threshold.
- [ ] 7.2 Document the deliberate browser-only coverage of `src/shaders/*` and the DOM shells so the exclusion is intentional, not accidental.
- [ ] 7.3 Record the coverage summary with the run.
- [ ] 7.4 Table-drive the capability decision tests over the documented failure-mode list, widening the input type where the current signature cannot express a case.
- [ ] 7.5 Mark unreachable documented cases explicitly with a reason.
- [ ] 7.6 Make the destination-enumeration completeness check derive from the authoritative registry and fail on incomplete discovery, rather than accepting a floor.

## 8. Documentation

- [ ] 8.1 Update `docs/TESTING.md` with the conventions this change establishes: compared-count assertions, declared-tolerance enforcement, content floors, and measurement-only marking.
- [ ] 8.2 Update `docs/CI_CD.md` with the new hosted checks and what each one compensates for.
- [ ] 8.3 Update `.agent/QUALITY_GATES.md` to state that a skip is not a pass.
- [ ] 8.4 Update `docs/BENCHMARK_MATRIX.md` if the artifact-freshness gate changes its evidence model.

## 9. Validation and evidence

- [ ] 9.1 `npm run check` green, with the unit count recorded (it will change: `-1` for the deleted probe, `+N` for the new tests).
- [ ] 9.2 Every negative test from section 1 now fails as intended. Record each.
- [ ] 9.3 `npx playwright test visual-goldens --workers=1` green with no row weakened.
- [ ] 9.4 `npx playwright test cinematic-goldens --project=default` green.
- [ ] 9.5 `npx playwright test --project=default` full suite green.
- [ ] 9.6 `npx playwright test --project=firefox` green.
- [ ] 9.7 Run hosted-equivalent CI locally (the `quality` and `browser-smoke` jobs) and record the result.
- [ ] 9.8 `openspec validate verification-gate-integrity --type change --strict` still passes.

## 10. Close-out

- [ ] 10.1 Strike findings V-01 through V-15 from `docs/MASTER_PLAN.md` with their resolution commits.
- [ ] 10.2 Append the negative-test evidence — the before/after table showing each gate was blind and is now not — to `.agent/STATE.md`. This table is the durable proof of the change's value.
- [ ] 10.3 Commit this change as one coherent checkpoint.
