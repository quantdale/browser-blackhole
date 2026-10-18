## Context

See `proposal.md`. OpenSpec's `isComplete` on this schema means the planning artifacts exist. `openspec list` already reports 0/123. The hazard is a reader, or a status summary, treating the planning flag as implementation-complete. There is no explorer code under `src/`.

## Goals / Non-Goals

**Goals:**

- Put an implementation-not-started header on the spatial atlas change.
- Add a repository check that fails if an active change has zero completed tasks and its header claims implementation is complete.
- Make that check part of the existing command or specification gate, not a new campaign.

**Non-Goals:**

- Implementing any spatial-atlas task.
- Changing the OpenSpec CLI's `isComplete` meaning.
- Archiving the spatial atlas change. It remains the active unfinished change.

## Decisions

### D1 — The checklist is the implementation authority

The check reads `tasks.md` checkbox counts and the change's status header. It does not parse `openspec status` `isComplete`. A header that says implementation is complete while `completed == 0` fails. A header that says implementation has not started passes.

**Alternatives rejected.** (a) Delete the planning artifacts so `isComplete` becomes false — that destroys the plan. (b) Fork the CLI — out of scope.

### D2 — Header edit is allowed; task prose is not

The apply phase may add a status banner to `spatial-atlas-continuous-navigation/proposal.md` and `tasks.md`. It must not check, reorder, or implement those tasks. The first prerequisite box stays unchecked until a later change owns implementation.

## Risks / Trade-offs

- **[Two status languages]** CLI planning-complete and repo implementation-not-started will both be true. → Mitigation: the header says that in one sentence, so a reader does not have to infer it.
