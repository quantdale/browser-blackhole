---
name: goal
description: Execute or resume the repository's planner-generated development campaign while preserving native agent and governance rules.
type: prompt
whenToUse: When the user asks to continue, resume, execute, or finish the current repository development goal or campaign.
disableModelInvocation: false
---

Use `$ARGUMENTS` as goal-mode arguments. Read all applicable `AGENTS.md`, `.agent/PLANNER_HANDOFF.md`, `.agent/EXECUTION_PROMPT.md` if present, and native goal/campaign/state/OpenSpec files. Inspect current Git and implementation. If the planner prompt is `ACTIVE`, reconcile work completed since `Planned-From`, resume the first genuinely incomplete requirement, execute autonomously, preserve intended behavior, avoid unrelated rewrites, run required tests/integration validation, repair introduced Critical/High regressions, update durable state, and commit/push per repository policy. Mark `COMPLETED` only when acceptance criteria pass; record `BLOCKED` only for a genuine blocker. If no active planner prompt exists, fall back to native continuation semantics; if none exists, report that a planner pass is required.