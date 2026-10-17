## 1. Failing floor

- [x] 1.1 In `tests/unit/lutEquivalence.test.ts`, add a compared-count assertion of 2 to the critical-boundary test before the class expectations, counting only samples whose status is not `fallback-numerical`.
- [x] 1.2 Confirm the current shipped manifest still has a zero hybrid band, so both samples compare and the updated test passes. — `public/luts/schwarzschild-v1-415dea94/manifest.json` reads `hybridBandHalfWidthX = 0`; test green.
- [x] 1.3 Add a focused case, or a comment-backed fixture note in the test, that a non-zero hybrid band covering both offsets must fail the floor rather than skip the expectations. — comment-backed fixture note in `lutEquivalence.test.ts` (D1 comment: fallback counts as not compared, non-zero band covering the offsets must fail the floor).

## 2. Gate

- [x] 2.1 Run the `lutEquivalence` unit file and record the pass count. — `npx vitest run tests/unit/lutEquivalence.test.ts`: 1 file passed, **8/8 tests passed** (1.49s).
- [x] 2.2 Run `openspec validate --change lut-boundary-assertion-floor --strict` and record that it passes. — `openspec validate lut-boundary-assertion-floor --type change --strict`: **valid**.
