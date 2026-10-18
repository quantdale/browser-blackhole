> **COMPLETE — archived 2026-10-18.** All tasks checked with evidence. Do not re-apply.

## 1. Lock the three laws

- [x] 1.1 Add a unit test that names the accretion-disk law, the stellar-explosion ramp, and the compact-merger locus. — `tests/unit/temperatureColorLaws.test.ts`: one row per law naming it and asserting its output contract (disk: finite HDR unit-luminance × SB energy; ramp: finite, inside anchor range; merger locus: finite, in [0,1]).
- [x] 1.2 Assert they are pairwise unequal at one interior temperature where the current implementations already differ. — 6000 K interior sample: `maxAbsDiff > 1e-3` for every pair (disk/`blackbodyRgb` vs explosion ramp vs merger locus).
- [x] 1.3 Assert each capped law returns the endpoint color above its ceiling, and that the stellar-explosion ramp still accepts a temperature between 40000 K and 1e7 K. — disk law: 40001 K and 1.2e9 K both `toEqual(blackbodyRgb(4e4))`; merger locus likewise; ramp: 1e6 K is an interpolated color ≠ the 1e7 K endpoint (red is larger redward) and 1e7+1 K clamps `toEqual` the endpoint.

## 2. Ceiling call sites

- [x] 2.1 Find every compact-merger color call site. Record any argument above 40000 K. — call sites of `kelvinToLinearRgb` (compact-merger/emission.ts): `kilonovaSampleAt` (emission.ts:104, peak 4500 K — in-domain), `compactMergerModule.ts:113` `STAR_TINT = kelvinToLinearRgb(4e4)` (AT the ceiling — compliant precedent), and `remnant.ts:41` `HOT_TINT = kelvinToLinearRgb(REMNANT_TEMPERATURE_K)` — **1.2e9 K, above 40000 K, silently clamped**. Above-ceiling call site found: `remnant.ts`.
- [x] 2.2 If one exists, change it so it does not claim a distinguishable hotter tint. Do not change a call that already passes the ceiling except to cover it in the test. — `remnant.ts` `HOT_TINT` now passes the ceiling value `4e4` explicitly with a comment stating the remnant proxy clamps to the endpoint (same precedent as `STAR_TINT`); the `REMNANT_TEMPERATURE_K` import left with it (constant itself stays in `types.ts`, now imported by the test's equivalence row). Output values are bit-identical (the old call hit the same 4e4 clamp), so no pixel changes. `STAR_TINT` untouched; the test covers the ceiling equality.
- [x] 2.3 Do not edit anchors, gamma shaping, or golden images. — untouched (diff scope: `remnant.ts` call site + new test only).

## 3. Gate

- [x] 3.1 Run the new unit test. — `npx vitest run tests/unit/temperatureColorLaws.test.ts`: **8/8 passed** (0.43s); `tsc --noEmit` clean (one test-file tuple-indexing fix along the way).
- [x] 3.2 Run `openspec validate --change temperature-color-law-contract --strict`. — `openspec validate temperature-color-law-contract --type change --strict`: **valid**.

## 4. Review follow-up (standards re-check)

- [x] 4.1 The ceiling was expressed three times (4e4 literal at the call site, the clamp literal in the law, and a test-local constant) — a Primitive Obsession / duplicated-magic-number smell the review flagged. Export the law's ceiling as `KELVIN_LOCUS_MAX_K` from `compact-merger/emission.ts` and use it at the clamp, the `HOT_TINT` call site, and the test. — done; output values unchanged (same 40000 endpoint), `STAR_TINT` untouched, the accretion-disk law keeps its own `ACCRETION_CEILING_K` test constant because it is a different function's clamp.
- [x] 4.2 Re-run the law tests and the gate. — `npx vitest run tests/unit/temperatureColorLaws.test.ts`: **8/8 passed**; `npx tsc --noEmit`: clean; `openspec validate temperature-color-law-contract --type change --strict`: **valid**.
