## 1. Evidence for the three closeout boxes

- [x] 1.1 Re-read archived tasks 9.1–9.3 in `openspec/changes/archive/2026-10-17-quality-ladder-resolution-integrity/tasks.md`. — all three read as bare `- [ ]` closeout items (strike register findings / append STATE evidence / coherent commit).
- [x] 1.2 Confirm the findings those boxes name are struck in `docs/MASTER_PLAN.md` and that `.agent/STATE.md` records the closeout. If either is missing, stop and leave the boxes unchecked. — both present: register rows 330–335 read "RESOLVED 2026-10-03 `274c591`" for A-01…A-06 and the Phase 1b progress row states "close-out `e364437` — A-01…A-06 struck"; `.agent/STATE.md`'s 2026-10-03 session block opens "implemented, validated and CLOSED — Status: **COMPLETE (committed `274c591`)**" with per-row A-01…A-06 evidence.
- [x] 1.3 If the evidence is present, check only those three boxes and cite the evidence in the same lines. Do not edit any other line in that archive. — done: exactly the three 9.x lines edited, each with "Evidence re-verified 2026-10-17" citation naming the register rows, the STATE block, and commits `274c591`/`e364437`; no other line touched.

## 2. Deferred record

- [x] 2.1 In `openspec/changes/archive/2026-10-03-whole-atlas-performance-optimization/tasks.md`, move each `- [ ]` item that contains `DEFERRED` or `REJECTED` into a non-checkbox record in the same section. — script-generated transform: each of the 58 annotated open items became `- [DEFERRED] <text>` or `- [REJECTED] <text>` in place (same line, same section); 0 `- [ ]` boxes remain in the archive.
- [x] 2.2 Keep the annotation and the reason. Do not convert those items to `- [x]`. — the body text after the checkbox (including the `— DEFERRED: reason` / `— REJECTED: reason` annotation) is byte-identical; zero `- [x]` boxes were created.
- [x] 2.3 Do not edit that archive's proposal, design, or spec text. — `git diff --stat` for the archive covers only `tasks.md`.

## 3. Quality job

- [x] 3.1 Add `openspec validate --all --strict` and `openspec validate --archived --strict` to the hosted quality job. — added to `quality` in `.github/workflows/ci.yml` right after `npm ci`: pinned `npm install --global @fission-ai/openspec@1.9.0` (the CLI is a global tool, not an npm dependency) then the two strict validate steps; non-zero exit fails the job (`set -e`-style GitHub step semantics).
- [x] 3.2 Run both commands locally and record the pass counts. Both must exit 0 before this change is done. — after the archive edits: `openspec validate --all --strict` → **24 passed, 0 failed (24 items)**; `openspec validate --archived --strict` → **18 passed, 0 failed (18 items)**. Both exit 0.
- [x] 3.3 Run `openspec validate --change archive-validation-gate --strict`. — `openspec validate archive-validation-gate --type change --strict`: **valid**.
