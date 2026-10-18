> **COMPLETE — archived 2026-10-18.** All tasks checked with evidence. Do not re-apply.

## 1. Failing floor

- [x] 1.1 In `tests/unit/lutEquivalence.test.ts`, add a compared-count assertion of 2 to the critical-boundary test before the class expectations, counting only samples whose status is not `fallback-numerical`.
- [x] 1.2 Confirm the current shipped manifest still has a zero hybrid band, so both samples compare and the updated test passes. — `public/luts/schwarzschild-v1-415dea94/manifest.json` reads `hybridBandHalfWidthX = 0`; test green.
- [x] 1.3 Add a focused case, or a comment-backed fixture note in the test, that a non-zero hybrid band covering both offsets must fail the floor rather than skip the expectations. — comment-backed fixture note in `lutEquivalence.test.ts` (D1 comment: fallback counts as not compared, non-zero band covering the offsets must fail the floor).

## 2. Gate

- [x] 2.1 Run the `lutEquivalence` unit file and record the pass count. — `npx vitest run tests/unit/lutEquivalence.test.ts`: 1 file passed, **8/8 tests passed** (1.49s).
- [x] 2.2 Run `openspec validate --change lut-boundary-assertion-floor --strict` and record that it passes. — `openspec validate lut-boundary-assertion-floor --type change --strict`: **valid**.

## 3. Review follow-up (spec re-check)

- [x] 3.1 The requirement is generic: ANY test that claims both sides of a critical boundary must count its subjects — a second test in `tests/unit/lutRuntime.test.ts` ("classifies captured/escaped exactly across the critical boundary") made the same claim with only status-filtered assertions. Add per-side compared counters (subjects below b_c and above b_c), each floored at 1, so a fully- or one-side-excluded run fails naming the side. — `lutRuntime.test.ts` updated; the loop still asserts the classification for every non-fallback subject.
- [x] 3.2 Re-run and re-validate. — `npx vitest run tests/unit/lutRuntime.test.ts`: all rows pass with the new floors; `openspec validate lut-boundary-assertion-floor --type change --strict`: **valid**.
