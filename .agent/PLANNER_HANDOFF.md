# Universal Planner → Executor Handoff

Version: 1

This is an additive cross-agent protocol. It does not replace repository-specific product, architecture, governance, OpenSpec, campaign, state, validation, or Git rules.

## Canonical planner output

The repository-planning skill writes the next execution-ready campaign to `.agent/EXECUTION_PROMPT.md`. That file is a planner-generated overlay, not a replacement for native files such as `.agent/GOAL.md`, `.agent/CURRENT_CAMPAIGN.md`, `.agent/STATE.md`, OpenSpec state, roadmaps, ADRs, or execution plans.

An execution prompt should record `Status: ACTIVE | BLOCKED | COMPLETED`, `Planned-From: <commit SHA>`, `Planned-At: <ISO date/time>`, and `Target-Branch: <branch>`, then define mission, rationale, repository findings, behavior to preserve, scope/out-of-scope, ordered workstreams, implementation constraints, migrations/data work when relevant, testing, integration/E2E validation, acceptance criteria, completion gate, Git requirements, and final reporting.

## Planner contract

Before writing the prompt, inspect the repository's actual current state: relevant source/configuration, tests, documentation, recent commits/diffs, open issues/PRs when useful, agent/governance files, and any native campaign/state system. Build on completed work; choose exactly one coherent high-impact campaign large enough for a long autonomous session; prioritize product value, dependency leverage, risk and maturity rather than raw change count; preserve working behavior unless intentionally changed; require automated and integration/E2E validation; require no known Critical/High regressions; integrate with native control-plane files instead of replacing them; write/update `EXECUTION_PROMPT.md`, commit and push the planning-only change per repository policy; then stop without implementing.

## Executor contract

For `/goal continue`, `continue`, `continue working`, or the shared `goal` command/skill: read all applicable repository instructions and this file; read `.agent/EXECUTION_PROMPT.md` if present plus native goal/campaign/state/OpenSpec files; inspect current branch, worktree, recent commits, tests, and implementation; reconcile `Planned-From` with work already landed; if the prompt is `ACTIVE`, resume from the first genuinely incomplete requirement and do not redo completed work; work autonomously, follow existing patterns, avoid unrelated rewrites, run required validation, repair introduced Critical/High regressions, update durable state at meaningful checkpoints, and commit/push per repository policy; mark `COMPLETED` only when acceptance criteria pass; durably record `BLOCKED` only for a genuine blocker.

If `EXECUTION_PROMPT.md` is absent or completed, use native continuation semantics if defined. If neither an active planner prompt nor a native active campaign exists, do not invent a major campaign in executor mode; report that a planner pass is required.

Explicit user instructions and stricter repository-specific rules remain authoritative.