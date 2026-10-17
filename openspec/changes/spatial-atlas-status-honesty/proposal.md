## Why

`openspec list` reports `spatial-atlas-continuous-navigation` as in progress with 0 of 123 tasks complete. `openspec status` on the same change reports `isComplete: true` because the planning artifacts exist. A search of `src/` finds no explorer implementation. An agent that treats planning-complete as shipped will either skip the work or apply a 123-task change that was written against an older host.

## What Changes

- Repository status SHALL distinguish planning-complete from implementation-complete.
- The spatial atlas change's own headers SHALL state that implementation has not started.
- A check SHALL fail if an active change with zero completed tasks is described as implementation-complete.
- This change SHALL NOT implement the explorer, and SHALL NOT treat the CLI planning flag as authority for implementation status.

## Capabilities

### New Capabilities

### Modified Capabilities

- `specification-hygiene`: a change whose planning artifacts are done and whose implementation checklist is untouched must not be reported as implementation-complete.

## Impact

- Status header in `openspec/changes/spatial-atlas-continuous-navigation`, and a small repository check wired where the other specification checks run.
- Assumption: the OpenSpec CLI's `isComplete` flag means planning artifacts exist. This change does not fork the CLI. The repository check is the implementation-status authority.
