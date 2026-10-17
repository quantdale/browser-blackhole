## Context

See `proposal.md`. The failing shape is two `expect` calls, each guarded by `status !== 'fallback-numerical'`, with no count after the filter. The sibling corpus test in the same file already asserts a compared-count floor. The shipped LUT manifest's hybrid band is currently 0, so the hole is latent.

## Goals / Non-Goals

**Goals:**

- Make the critical-boundary test fail when either sample is not compared.
- Keep the existing classification rule.

**Non-Goals:**

- Changing `resolveRay`, the hybrid band, the shipped manifest, or any tolerance.
- Rewriting the other conditional expects in the LUT suite. Those already have an unguarded `expect` before the filter.

## Decisions

### D1 — Floor of 2, no exemption

The test compares exactly two samples: just below `b_c` and just above it. After resolving both, it asserts `compared === 2` before the class assertions. A fallback status increments nothing and fails the floor.

**Alternatives rejected.** (a) Skip the test when the band is non-zero — that is the current silent pass. (b) Widen the sample offsets until they leave the band — that stops testing the boundary the test names.

### D2 — Do not touch the sampler

The sampler's fallback inside the hybrid band is intentional. The defect is the test, not the fallback.

## Risks / Trade-offs

- **[Latent until the band changes]** The current manifest keeps the test green after the floor is added, because both samples compare today. → Mitigation: the floor is still the regression lock. A unit comment records that a non-zero band must fail this test rather than exempt it.
