## Context

See `proposal.md`. `openspec validate --archived --strict` counts every `- [ ]` as incomplete. It does not read `DEFERRED` or `REJECTED`. The quality job in `.github/workflows/ci.yml` does not invoke OpenSpec. Archive policy otherwise forbids editing archived changes. This change authorizes a checkbox-form correction only, because the validator reads those checkboxes.

## Goals / Non-Goals

**Goals:**

- Make both strict validators pass, and run them in the hosted quality job.
- Preserve deferred and rejected text without marking it done.
- Check the three quality-ladder closeout boxes only after re-verifying their evidence.

**Non-Goals:**

- Rewriting archive proposals, designs, or requirement text.
- Checking the 58 whole-atlas deferrals as complete.
- Regenerating benchmarks or goldens.

## Decisions

### D1 — Deferred items leave the checkbox list

In the whole-atlas archived `tasks.md`, move each annotated `DEFERRED` or `REJECTED` item into a non-checkbox record under the same section. Keep the annotation and the reason. Do not convert them to `- [x]`.

**Alternatives rejected.** (a) A wrapper script that ignores the CLI — the requirement is that the official archived validator passes. (b) Checking the 58 boxes — that would report unfinished research as done.

### D2 — Quality-ladder boxes are checked only with evidence

Before checking 9.1–9.3, confirm the findings they name are struck in the register and that `.agent/STATE.md` records the closeout. If either is missing, stop and leave the box unchecked. Do not invent evidence.

### D3 — The quality job runs both commands

Add a step after install:

- `openspec validate --all --strict`
- `openspec validate --archived --strict`

A non-zero exit fails the job. Do not add `--json` in a way that hides the exit code.

## Risks / Trade-offs

- **[Archive edit exception]** Future agents may treat this as permission to rewrite archives. → Mitigation: the proposal names the two files and limits the edit to checkbox form. The task list repeats that limit.
- **[CLI upgrade]** A future OpenSpec may count non-checkbox lines. → Mitigation: the gate is the current CLI's strict archived mode, re-run after the edit.
