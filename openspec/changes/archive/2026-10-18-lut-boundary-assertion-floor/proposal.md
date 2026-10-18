> **COMPLETE — archived 2026-10-18.** Specs synced into `openspec/specs/`. Do not re-apply.

## Why

The unit test named "classification boundary is exact at b_c within fp precision" can pass without asserting anything. Both expectations sit inside `if (status !== 'fallback-numerical')`, and there is no compared-count floor. `resolveRay` returns `fallback-numerical` inside a non-zero hybrid band around `b_c`. The shipped manifest currently has that band at 0, so the test asserts today. A later non-zero band makes the test green while measuring nothing.

## What Changes

- The critical-boundary classification test SHALL fail when it compares fewer than both boundary samples.
- A sample that falls back to numerical SHALL count as not compared, not as a silent pass.
- Classification math, the shipped LUT family, and hybrid-band policy SHALL NOT change.

## Capabilities

### New Capabilities

### Modified Capabilities

- `verification-gate-integrity`: a status-filtered classification check must assert how many subjects it actually compared, including the critical-boundary case where every assertion is currently behind a filter.

## Impact

- `tests/unit/lutEquivalence.test.ts` only.
- No shader, manifest, or tolerance change.
- Assumption: the minimum compared count for this test is 2 (one sample below `b_c`, one above). If the hybrid band excludes either sample, the test fails rather than exempting itself.
