## 1. Header

- [x] 1.1 Add an implementation-not-started banner to `openspec/changes/spatial-atlas-continuous-navigation/proposal.md` and `tasks.md`. — both files now open with `**implementation status: NOT STARTED**` (checked with the new check; see 2.1). No task line was touched.
- [x] 1.2 State in that banner that OpenSpec planning-complete is not implementation-complete, and that 0 completed tasks means not started. — both banners state exactly that, plus the `isComplete: true`-because-planning note and the `openspec list` as progress authority.
- [x] 1.3 Do not check, reorder, or implement any spatial-atlas task. — diff scope is the two banner blocks only; `openspec list --json` still reads `completedTasks: 0, totalTasks: 123, status: "in-progress"` after the banner edit (3.3 evidence).

## 2. Check

- [x] 2.1 Add a repository check that fails when an active change has zero completed tasks and its header claims implementation is complete. — `scripts/check-change-status-honesty.mjs` (black-box tested by `tests/unit/changeStatusHonesty.test.ts`, 7/7): reads every active change under `openspec/changes/` (archive excluded), counts `tasks.md` checkboxes (fenced blocks excluded), parses each change's own `implementation status:` header line from either `proposal.md` or `tasks.md`, and fails on contradiction — COMPLETE requires `completed === total` (total > 0), NOT STARTED requires 0, IN PROGRESS requires a genuinely partial checklist, and unrecognized values fail loudly. Header-less changes are reported with the derived status but do not fail (no claim, no contradiction).
- [x] 2.2 The check must pass for the spatial atlas change after 1.1, and must fail on a fixture header that says implementation is complete with zero completed tasks. — both directions live in `changeStatusHonesty.test.ts`: the `spatial-atlas-like` fixture (NOT STARTED banner over 0/123) exits 0; the `claimed-complete-zero` fixture (COMPLETE over 0/3) exits 1 naming the change and the count. The reverse direction (NOT STARTED over checked tasks) also fails. Real-root run: `node scripts/check-change-status-honesty.mjs` → ok, 8 active changes inspected, spatial-atlas-continuous-navigation reads `0/123 header=not-started derived=not-started ok`.
- [x] 2.3 Wire the check into the existing specification or command gate. Do not add a new campaign document. — wired into the `npm run check` chain as `check:status-honesty` (between `build` and `check:no-test-hook`); no new campaign document, and CI's quality job already runs `npm run check`.

## 3. Gate

- [x] 3.1 Run the new check. — `node scripts/check-change-status-honesty.mjs` (alias `npm run check:status-honesty`): **ok — 8 active changes inspected**; the four implemented changes report 5/5, 6/6, 7/7, 8/8 `derived=complete`, the three pending ones and the spatial atlas report 0/N `derived=not-started`.
- [x] 3.2 Run `openspec validate --change spatial-atlas-status-honesty --strict`. — `openspec validate spatial-atlas-status-honesty --type change --strict`: **valid**.
- [x] 3.3 Confirm `openspec list` still shows `spatial-atlas-continuous-navigation` as unfinished. — `openspec list --json`: `completedTasks: 0, totalTasks: 123, status: "in-progress"` (banner edit did not touch the checklist).
