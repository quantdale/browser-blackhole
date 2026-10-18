> **COMPLETE — archived 2026-10-18.** Specs synced into `openspec/specs/`. Do not re-apply.

## Why

Temperature-to-linear-RGB is three different functions. The accretion-disk law clamps to 1000–40000 K. The stellar-explosion ramp clamps to 1000–1e7 K. The compact-merger law is a separate closed form that also clamps at 40000 K, and its star tint is passed at exactly that ceiling. Nothing in the tree makes that split a tested contract, so a later edit can mix the laws or treat a clamped result as a distinguishable hotter color.

## What Changes

- The three laws SHALL remain distinct named contracts. They SHALL NOT be unified.
- A temperature outside a law's stated domain SHALL clamp, and the clamped result SHALL NOT be presented as distinguishable from the domain endpoint.
- No golden rebaseline and no pixel change. This change locks the split that is already in the code.

## Capabilities

### New Capabilities

- `temperature-color-laws`: the three presentation color laws, their domains, and the rule that they must not be silently merged.

### Modified Capabilities

## Impact

- The three existing color functions, their call sites that sit on a ceiling, and unit tests that pin domain and non-equivalence.
- Assumption: do not pick a single physical blackbody. Do not restyle any destination.
