# START HERE — active campaign

Updated: 2026-08-28
Audit base: `main@02d129fe29d3f4fa383c3ed5760d70b7381a0191`

The feature-completion and final-production-readiness campaigns are complete. **Do not restart M0–M12, CA9, or final-production-readiness.**

## Active work

The active campaign is:

`openspec/changes/whole-atlas-performance-optimization/`

Start with:

1. `docs/NEXT_CAMPAIGN_AUDIT_2026-08-28.md`
2. `openspec/changes/whole-atlas-performance-optimization/EXECUTION_PROMPT.md`
3. `openspec/changes/whole-atlas-performance-optimization/MASTER_PLAN.md`
4. `openspec/changes/whole-atlas-performance-optimization/tasks.md`
5. `.agent/QUALITY_GATES.md`

Mission: execute the performance-hardening campaign across all eight production destinations and shared runtime. Eliminate unnecessary CPU/GPU work before reducing fidelity. Preserve visual goldens, scientific parity, deterministic behavior, WebGPU/WebGL2 compatibility, and resource-lifecycle guarantees.

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
