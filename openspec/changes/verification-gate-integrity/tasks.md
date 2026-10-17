# Tasks — Verification gate integrity

**Do not start this change before the phase-1 correctness changes have landed.** Writing a gate
against defective code encodes the defect as expected behaviour.

## 0. Baseline

- [x] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [x] 0.2 Run `npm run check` and record the unit test count and file count as the before-state.
- [x] 0.3 Record which of the section-1 items currently pass and which currently fail, by actually attempting each negative test. This is the audit trail for "this gate was blind".
- [x] 0.4 Confirm `openspec validate verification-gate-integrity --type change --strict` passes.

## 1. Negative tests first (the acceptance suite for this change)

- [x] 1.1 Point `public/luts/index.json` at a non-existent family. Confirm `npm run test` currently PASSES. Record that.
- [x] 1.2 Delete one committed golden PNG. Confirm no automated check currently fails. Record that.
- [x] 1.3 Widen a LUT domain exclusion so all corpus rays are skipped. Confirm the affected tests currently PASS. Record that.
- [x] 1.4 Delete a subject from a sparse-content scene (or simulate it). Confirm the golden row currently PASSES. Record that.
- [x] 1.6 Demonstrate the flake: run the full unit gate 3 times and record that `launchCatalog.test.ts` fails on a subset of runs. This is the before-evidence that the gate is not reproducible.

## 2. Declared tolerances

- [x] 2.1 Attempt to enforce the LUT terminal-direction tolerance using the matched-anchor comparison technique already used in `tests/unit/lutGenerate.test.ts`.
- [x] 2.2 If enforcement succeeds, assert it and record the measured margin.
- [x] 2.3 If enforcement is out of scope, rename the test to state it is a measurement, remove the tolerance claim from the header, add a source comment, and delete the `void angErr;` statement.
- [x] 2.4 Remove the `void x;` statements in `tests/unit/lutRuntime.test.ts`, restoring or deleting the underlying cross-check.
- [x] 2.5 Re-run the 1.1-style check: perturb the generator's terminal-direction channel and confirm the gate goes red (or, under 2.3, confirm the test no longer claims a bound).

## 3. Compared-subject counts

- [x] 3.1 Add a compared-count assertion to `tests/unit/lutEquivalence.test.ts` (three locations).
- [x] 3.2 Add a compared-count assertion to `tests/unit/kerrReference.test.ts` (three locations).
- [x] 3.3 Add a compared-count assertion to `tests/unit/kerrConvergence.test.ts`.
- [x] 3.4 Add compared-count assertions to any other unit test found to contain an unguarded `continue`/`return` before its assertion.
- [x] 3.5 Run the suite. Triage every newly-red test: either a real defect, or an explicitly documented reduced corpus recorded in this change's `tasks.md`. Do NOT lower a minimum to match an observed count without recording the reason.
- [x] 3.6 Convert `lutEquivalence.test.ts`'s setup `it()` into a `beforeAll` with a real assertion, so a broken family produces one clear failure rather than seven cascading ones.
- [x] 3.7 Confirm the check from 1.3 now fails.

## 4. Image regression integrity

- [x] 4.1 Extract the luminance-grid computation from `tests/browser/support/appHarness.ts` into a shared helper.
- [x] 4.2 Return `meanLuma` (and a spatial statistic if useful) from the golden comparison.
- [x] 4.3 Define a per-scene absolute content floor for every row in the scientific suite, with explicit documented exemptions where a scene is genuinely near-empty.
- [x] 4.4 Assert the floor in `tests/browser/visual-goldens.spec.ts`.
- [x] 4.5 Add a golden-inventory check: set equality between declared scene names and committed baseline filenames, in both directions, runnable without a GPU.
- [x] 4.6 Wire the inventory check into the hosted CI quality job.
- [x] 4.7 Confirm the checks from 1.2 and 1.4 now fail as intended.
- [x] 4.8 Handle any baseline that genuinely fails its new floor: raise the defect it represents, fix it, and re-capture with a written justification. Never lower the floor to fit a weak baseline.

## 5. Runtime asset resolution

- [x] 5.1 Extract the LUT index-resolution step of the production path into a testable pure function used by BOTH the product and the test.
- [x] 5.2 Add a test that resolves the shipped index and fully validates the selected family (structure, byte length, per-asset checksum).
- [x] 5.3 Add the equivalent resolution test for the BBH merger and galaxy-collision data manifests.
- [x] 5.4 Make the production index-resolution failure paths report a reason instead of returning null silently.
- [x] 5.5 Add a test for the same behaviour on the BBH and GC loaders.
- [x] 5.6 Confirm the check from 1.1 now fails.
- [x] 5.7 Remove the order-dependent `findShippedFamilyDir()` helpers; share one resolver.
- [x] 5.8 Apply the LUT's existing unsafe-path rule (`..`, backslash, leading slash) to the black-hole-merger and galaxy-collision manifest validators, so all three loaders agree.
- [x] 5.9 Add a test per loader asserting a traversing asset reference is rejected with an explicit reason and that no request is issued.

## 6. Skips, artifacts, dead tests

- [x] 6.1 Make the hosted smoke job fail when fewer than the expected number of tests execute, or when any test skips.
- [x] 6.2 Prefer forcing a known backend in the smoke tests over skipping on an unknown one.
- [x] 6.3 Add the galaxy-collision self-check to CI with a `git diff --exit-code` freshness gate (it is pure-stdlib and can run hosted).
- [x] 6.4 Annotate the BBH reducer artifacts and their tests as stored verdicts, listing them explicitly, until the Python toolchain is fixed.
- [x] 6.5 Delete `tests/unit/__probe.test.ts`; fold anything still valuable from it into `starfield.test.ts` as a real assertion.
- [x] 6.6 Resolve the eight orphaned `_WEBGL2` cinematic baselines: either add a documented command that reaches them or delete them.
- [x] 6.7 Add unit coverage for `src/shaders/cameraRayMath.ts`, the CPU reference the browser parity gate depends on.

## 7. Coverage and enumeration

- [x] 7.1 Add coverage tooling to the quality job as a report only, with no global threshold.
- [x] 7.2 Document the deliberate browser-only coverage of `src/shaders/*` and the DOM shells so the exclusion is intentional, not accidental.
- [x] 7.3 Record the coverage summary with the run.
- [x] 7.4 Table-drive the capability decision tests over the documented failure-mode list, widening the input type where the current signature cannot express a case.
- [x] 7.5 Mark unreachable documented cases explicitly with a reason.
- [x] 7.6 Make the destination-enumeration completeness check derive from the authoritative registry and fail on incomplete discovery, rather than accepting a floor.
- [x] 7.7 FIX THE FLAKY GATE: `tests/unit/launchCatalog.test.ts` times out under load (measured 2 of 3 full-suite failures during this audit). Give the module-graph-loading test a timeout proportionate to its work, and confirm the failure cannot recur.
- [x] 7.8 Sweep every other unit test for the same pattern: one test that loads a large module graph against the default timeout. Give each a proportionate timeout or split the work.
- [x] 7.9 Run the full unit gate 5 consecutive times on a quiet host and record the result. All 5 MUST be identical; any variance is a remaining defect.

## 8. Documentation

- [x] 8.1 Update `docs/TESTING.md` with the conventions this change establishes: compared-count assertions, declared-tolerance enforcement, content floors, and measurement-only marking.
- [x] 8.2 Update `docs/CI_CD.md` with the new hosted checks and what each one compensates for.
- [x] 8.3 Update `.agent/QUALITY_GATES.md` to state that a skip is not a pass.
- [x] 8.4 Update `docs/BENCHMARK_MATRIX.md` if the artifact-freshness gate changes its evidence model.

## 9. Validation and evidence

- [x] 9.1 `npm run check` green, with the unit count recorded (it will change: `-1` for the deleted probe, `+N` for the new tests).
- [x] 9.2 Every negative test from section 1 now fails as intended. Record each.
- [x] 9.3 `npx playwright test visual-goldens --workers=1` green with no row weakened.
- [x] 9.4 `npx playwright test cinematic-goldens --project=default` green.
- [x] 9.5 `npx playwright test --project=default` full suite green.
- [x] 9.6 `npx playwright test --project=firefox` green.
- [x] 9.7 Run hosted-equivalent CI locally (the `quality` and `browser-smoke` jobs) and record the result.
- [x] 9.8 `openspec validate verification-gate-integrity --type change --strict` still passes.

## 10. Close-out

- [x] 10.1 Strike findings V-01 through V-15 from `docs/MASTER_PLAN.md` with their resolution commits.
- [x] 10.2 Append the negative-test evidence — the before/after table showing each gate was blind and is now not — to `.agent/STATE.md`. This table is the durable proof of the change's value.
- [x] 10.3 Commit this change as one coherent checkpoint.


---

## Evidence summary (2026-10-17 completion pass)

**Negative-test before/after table (task 0.3 + 9.2 — the durable proof):**

| # | Mutation | BEFORE (blind) | AFTER (gate bites) |
| --- | --- | --- | --- |
| 1.1 | `public/luts/index.json` -> non-existent family | 81/81 LUT tests PASS | 3 files / 13 rows FAIL (lutDiscovery + lutRuntime + lutEquivalence) |
| 1.2 | delete a golden PNG | unit gate 716/716 PASS, no check notices | `goldenInventory` FAILS ("every declared scene must have a committed baseline") |
| 1.3 | skip every LUT corpus subject | 9/9 PASS | compared-count assertions FAIL (1 failed) |
| 1.4 | destroyed subject (sparse scene) | relative-only compare passes black==black (the TDE_NASCENT_DISK baseline WAS pure black, caught by measurement) | per-scene `minMeanLuma` floors FAIL (demonstrated live: SN_GRB_ON floor violation during calibration) |
| 1.6 | unit-gate flake | `launchCatalog` failed 2-of-3 full-suite runs (audit) | 5/5 consecutive full unit runs IDENTICAL (738/738) |

**Key results:**
- V-01: the 5e-3 rad terminal-direction tolerance is ENFORCED (frame-invariant |nT| comparison; measured max 3e-4, 16x margin). The `[M8-07 metrics]` block's signed comparison was measuring the nT sign convention (~0.95 rad), not angular error — corrected to the same frame-invariant form.
- V-03: compared-count/non-vacuity assertions across lutEquivalence (3), kerrReference (3), kerrConvergence (1). This turned the ENTIRE a*=0 agreement corpus red — every row was vacuous (`cpuReference` returned `max-steps` for all corpus rays). TRIAGED AS A REAL DEFECT: the binary64 oracle lacked stall-capture; the Schwarzschild form of the validated Kerr `captured-stall` guard (`pr < 0 && 1 - 2M/r < 1e-3`) was added to `cpuReference.ts` (event policy documented in the header + NUMERICAL_METHODS lineage). The a*=0 agreement now compares for real. One further triage: the disk-hit existence probe measured "near-plane samples" while the Kerr reference counts sign-change crossings (ADR §1.14) — aligned to the canonical convention.
- V-02/D3: per-scene absolute content floors (`minMeanLuma`, two tiers: 50% standard / 20%-of-measured sparse-content exemptions) + `meanLuma`/`spatialStdLuma` returned from the comparison. The measurement pass caught TDE_NASCENT_DISK's baseline as PURE BLACK (0.000/0.000) while its notes claimed it "catches disk-gain regressions" — investigated as a product defect: the TDE auto-framer chased the diverging analytic star coordinate (camera at x=-211,411) while the annulus at the origin was out of frame. FIXED (framer targets the origin post-disruption, matching its own comment) and the baseline re-captured with justification (3.6 KB black -> 46.9 KB with the disk; measured 8.48 meanLuma).
- V-04/V-14: `resolveLutFamilyFromIndex` + `isUnsafeAssetPath` (lut/discovery.ts) shared by product and tests; both `findShippedFamilyDir` readdir-scans replaced; the product's silent `return null` paths now report reasons (5.4).
- V-16: the unsafe-path rule applied to the BBH and GC manifest validators; traversal rows assert rejection with no request issued (5.9).
- V-05 compensations: golden inventory (runs in `npm run test`, i.e. hosted CI), smoke coverage gate (5/5 executed, 0 skipped — demonstrated live), GC self-check freshness gate (caught the committed report genuinely stale; regeneration verified SEMANTICALLY IDENTICAL and committed).
- V-06: the two skip-on-unknown-backend smoke rows now force `?backend=webgl2` and FAIL loudly.
- V-07: BBH reducer artifacts annotated as STORED VERDICTS (ca9Integrator.test.ts + BENCHMARK_MATRIX §1).
- V-08: `__probe.test.ts` deleted; its nugget folded into `starfield.test.ts` as a real round-trip assertion (23/23).
- V-09: the `_WEBGL2` cinematic baselines' command documented (TESTING.md §6) + inventory accepts exactly those suffix variants.
- V-10: `npm run coverage:report` (static unit-test import coverage, report-only) + deliberate browser-only families documented. NOTE: the preferred `@vitest/coverage-v8` provider could NOT be installed — npm/arborist fails deterministically on this machine (`Cannot read properties of null (reading 'edgesOut')`, after `npm ci` and with `--package-lock-only`); the dependency-free report substitutes the stated visibility goal and the provider remains the documented preference.
- V-12/D9: `BackendDecisionInput` widened (`webgpuMissingRequiredFeature`) and the capability table covers all six documented CI_CD §10 failure modes (out-of-decision cases marked explicitly with reasons).
- V-11/7.6: launchCatalog completeness derives from the registry in BOTH directions; import failures are collected, not swallowed. The stricter row found a real discovery gap (WS3's `descriptor.ts` split was never probed).
- V-17/7.7-7.9: proportionate timeouts (30s/60s/120s on heavy rows) + 5/5 identical full unit runs (738/738).

**Gates (9.x):** `npm run check` 62 files / 738 unit green; visual-goldens 43/43
(zero drift — only TDE_NASCENT_DISK changed, justified above); cinematic
8/8; full suite 309/309 + 1 documented skip (9.6m); firefox 4/4;
hosted-equivalent CI checks green (coverage report + smoke 5/5 + GC
freshness); `openspec validate --strict` valid.
