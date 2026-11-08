# START HERE

Updated: 2026-10-22

There is no active implementation campaign. Do not invent one from this file.

## Completed — do not restart

- M0–M12, CA9, `final-production-readiness`, `cinematic-visual-fidelity-overhaul`, and `whole-atlas-performance-optimization`.
- The hardening plan in `docs/MASTER_PLAN.md` (Phases 0–6). That document is the completed record, including its file-serialization rules. It is not an open queue. Do not start at `specification-baseline-hygiene`.

## Not authorization to implement

`openspec/changes/spatial-atlas-continuous-navigation` is the only active OpenSpec change. It is 0/123 and its own header says implementation status NOT STARTED. Read it only to avoid contradicting the plan. Do not implement it unless the user, or an `ACTIVE` prompt in `.agent/EXECUTION_PROMPT.md`, assigns it.

## Before editing

1. `git status`, `HEAD`, and whether `origin/main` is current.
2. The newest section of `.agent/STATE.md`.
3. `AGENTS.md` and `.agent/QUALITY_GATES.md`.
4. `.agent/EXECUTION_PROMPT.md` only if its status is `ACTIVE`. It is not.

## Mandatory start gate

Before changing runtime behavior:

```bash
git status --short
git rev-parse HEAD
node --version
npm --version
npm ci
npm run check
```

Then establish the benchmark/telemetry baseline required by the active OpenSpec. Do not claim a performance win without matched before/after evidence.

## Autonomous-session rule

Continue through dependency-ordered workstreams without stopping after the first improvement. Repair regressions immediately. If implementation work completes, continue into performance regression hunting, compatibility/resource verification, and final performance certification. Do not manufacture low-value work merely to consume time.

## Existing release evidence

`docs/RELEASE_CERTIFICATION.md` remains authoritative for the certified pre-optimization product baseline. Hosted CI proves deterministic quality + cheap browser smoke; the GPU-heavy full suite/goldens/Firefox remain capable-runner gates.

## Non-negotiable rules

- Never weaken scientific/reference/parity tolerances to obtain speed.
- Never auto-update goldens to hide an optimization-induced visual change.
- Never conflate CPU/rAF timing with GPU timestamp timing.
- Never silently drop WebGL2 fallback.
- Never introduce unbounded resource/program growth.
- Never mark an environment-deferred gate PASS.
