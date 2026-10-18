> **COMPLETE — archived 2026-10-18.** Specs synced into `openspec/specs/`. Do not re-apply.

## Why

`openspec validate --archived --strict` fails two archived changes, and the hosted quality job never runs an OpenSpec validator. `2026-10-17-quality-ladder-resolution-integrity` has three bare unchecked closeout boxes (9.1–9.3) whose described work is already in later commits. `2026-10-03-whole-atlas-performance-optimization` has 58 unchecked boxes; each is annotated `DEFERRED` or `REJECTED`, and the CLI still counts them incomplete.

## What Changes

- The automated quality job SHALL run `openspec validate --all --strict` and `openspec validate --archived --strict`.
- Bare unchecked archived tasks SHALL fail that gate.
- Annotated deferred or rejected items SHALL remain readable and SHALL NOT be marked done. They SHALL leave the unchecked-checkbox list so the CLI's incomplete count means "work still required."
- The three quality-ladder closeout boxes SHALL be checked only after the implementing session re-verifies the evidence commits. That is a checkbox correction, not a feature edit.
- This is an explicit, narrow exception to "never edit an archive": checkbox form only. Requirement text, design, and proposal scope in those archives SHALL NOT change.

## Capabilities

### New Capabilities

### Modified Capabilities

- `specification-hygiene`: archive validation is part of the automated gate, and an annotated deferral is not an incomplete task.
- `ci-release-readiness`: the hosted quality job executes that gate.

## Impact

- `.github/workflows/ci.yml`.
- Checkbox form only in the two named archived `tasks.md` files.
- Assumption: do not check the 58 deferred boxes as complete. Do not regenerate performance evidence.
