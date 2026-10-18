## Context

See `proposal.md`. The GPU pass and the executable lines in `reference.ts` already use `g_tφ / √f_s`. Two comments in that file still say `g_tφ / f_s`. The capability spec already requires the square-root form. This change makes the adjacent text and a unit lock agree with that spec.

## Goals / Non-Goals

**Goals:**

- Replace the two contradictory comments with the normalisation the executable lines use.
- Add a unit test that fails if the frame-dragging term is changed to division by `f_s` at a lapse below 1.

**Non-Goals:**

- Editing `kerrIntegrator.ts`, parity tolerances, goldens, or the ADR's resolved formula.
- Re-deriving the extraction.

## Decisions

### D1 — Comments follow the executable lines

Update only the static-extraction comment and the terminal-reconstruction comment in `reference.ts`. Do not "correct" the code to match the old comments.

**Alternatives rejected.** Changing the CPU and GPU to `g_tφ / f_s` — that contradicts the existing capability requirement and the lines the GPU already matches.

### D2 — Lock the term, not the comment text

A string search for the comment is brittle. The test evaluates the same expression the function uses, at a lapse below 1, and asserts inequality with division by the lapse. Comment review is a task, not the gate.

## Risks / Trade-offs

- **[Comment drift elsewhere]** Other files may still say `1/f_s`. → Mitigation: this change covers the two comments adjacent to the executable oracle. A repo-wide comment sweep is out of scope.
