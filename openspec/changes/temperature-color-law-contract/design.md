## Context

See `proposal.md`. Three functions already exist: the accretion-disk chromaticity fit (1000–40000 K), the stellar-explosion anchor ramp (1000–1e7 K), and the compact-merger closed-form locus (1000–40000 K). The compact-merger star tint is evaluated at 40000 K. This change does not restyle them.

## Goals / Non-Goals

**Goals:**

- Name the three laws in tests and fail if two that currently differ become equal at a sampled interior temperature.
- Assert clamp-to-endpoint above each ceiling.
- Assert the compact-merger star tint equals the ceiling color, and that no call site passes a hotter value expecting a different tint.

**Non-Goals:**

- Unifying the laws, changing anchors, changing the gamma-2.2 shaping, or rebaselining goldens.
- Claiming any law is a Planck integral.

## Decisions

### D1 — Lock samples, do not invent a shared function

Pick one interior temperature where the current three outputs already differ, and assert the pairwise differences. Pick one above-ceiling temperature per capped law and assert equality with the endpoint. Record the sample temperatures in the test, not as new production constants.

**Alternatives rejected.** Routing all three through `temperatureRamp.ts` — that restyles the disk and the kilonova. The explore pass did not render them and did not justify a visual change.

### D2 — Call-site audit is a test, not a rewrite

Search call sites of the compact-merger law. If one passes a value above 40000 K, change that call to the ceiling or stop claiming a distinguishable hotter tint. Do not change a call that already passes 40000 K except to make the ceiling explicit in the test.

## Risks / Trade-offs

- **[Sample brittleness]** A legitimate restyle later fails the inequality test. → Mitigation: that failure is the point. A restyle belongs in a later change that updates the contract on purpose.
