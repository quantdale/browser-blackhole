# START HERE — active campaign

Updated: 2026-09-30
Planning revision: `c0ee5f5` and later. Product-code findings were derived at `dc0b3ba`; re-derive citations before editing.

The feature-completion, final-production-readiness, and whole-atlas performance campaigns are complete or complete-with-deferrals. **Do not restart M0–M12, CA9, final-production-readiness, or `whole-atlas-performance-optimization`.**

## Active work

The active campaign is the hardening plan:

1. `docs/MASTER_PLAN.md` — priority, sequencing, and file ownership. §7 overrides any older parallel-lane sentence.
2. The assigned change under `openspec/changes/`. Its proposal, design, tasks, and spec are the behavioural contract.
3. `.agent/QUALITY_GATES.md`

Start with `specification-baseline-hygiene` unless a later change has already landed and the master plan's sequence says otherwise. Do not implement `spatial-atlas-continuous-navigation` as part of this campaign.

Mission: correct confirmed defects and make gates, controls, deployment, and documentation truthful. Do not add a destination or reopen a completed campaign.

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
