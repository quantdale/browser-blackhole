# Checkpoint / handoff template

Copy this structure into the final session report and persist the durable subset in `.agent/STATE.md`.

## Checkpoint identity

- Date/time:
- Branch:
- Commit SHA:
- Milestone:
- Completed packet IDs:
- Status: `PASS | PARTIAL | BLOCKED | DEFERRED_ENVIRONMENT`

## Objective

One paragraph describing what this checkpoint was intended to prove or deliver.

## Changes

- file/module — behavior changed;
- file/module — behavior changed;
- architecture/physics decision if any.

## Scientific/numerical evidence

- reference fixtures exercised:
- CPU/GPU comparisons:
- tolerance/result:
- numerical failures observed:
- convention changes: none / documented in ...

Use `N/A` only when checkpoint truly does not affect physics.

## Rendering/browser evidence

- browser + version:
- backend actually active:
- adapter/device info if exposed:
- viewport/internal resolution:
- preset/debug view inspected:
- screenshot/artifact path:
- console errors: none / details.

## Test commands

```text
<command> -> PASS/FAIL (counts/details)
<command> -> PASS/FAIL
```

Never write merely “tests pass” when commands are available.

## Performance evidence

- benchmark preset:
- settings/internal resolution:
- warmup/sample count:
- median CPU frame ms:
- p95 CPU frame ms:
- median GPU ms if available:
- p95 GPU ms if available:
- before/after comparison:

Use `N/A — performance harness not reached` before M6 unless relevant ad hoc evidence exists.

## Quality gates

- Gate A Repository: PASS/FAIL
- Gate B Browser: PASS/FAIL/DEFERRED_ENVIRONMENT
- Gate C Physics: PASS/FAIL/NOT_YET_APPLICABLE
- Gate D Visual: PASS/FAIL/NOT_YET_APPLICABLE
- Gate E Performance: PASS/FAIL/NOT_YET_APPLICABLE
- Gate F Compatibility: PASS/FAIL/PARTIAL
- Gate G Release: NOT_YET_APPLICABLE until M11

## Known limitations/debt

- severity — issue — impact — next action/packet.

No Critical/High item may be omitted because it is inconvenient.

## Deferred environment gates

List exact gate, why current environment cannot execute it, and what environment is required. A deferred gate is not a pass.

## Next actions

1. packet ID + precise outcome;
2. packet ID + precise outcome;
3. packet ID + precise outcome.

## Repository state

- pushed remote?:
- working tree clean?:
- untracked files?:
- branch relationship to main:

## Notes for next fresh agent

Only facts that are not obvious from code/docs/commit history and materially affect continuation.