# START HERE — active next campaign

Updated: 2026-08-26

The historical M0–M11 campaign is complete. **Do not restart M0, M1, or any completed historical packet.**

`.agent/STATE.md` contains durable evidence/history and may still contain a historical “no active planner prompt” snapshot from immediately before this planning commit. The active instruction source is now:

1. `.agent/EXECUTION_PROMPT.md`
2. `docs/NEXT_CAMPAIGN_AUDIT_2026-08-26.md`
3. `openspec/AGENTS.md`
4. `openspec/project.md`
5. the current ordered OpenSpec change folder
6. `.agent/QUALITY_GATES.md`

## Ordered changes

Execute these in order and treat each gate as a dependency barrier:

1. ~~`openspec/changes/m12-neutron-star-surface-lensing/`~~ — **COMPLETE** (2026-08-26, commit `a827563`; direct Schwarzschild surface ray tracing implemented and validated).
2. `openspec/changes/m12-repository-integrity/` — **ACTIVE** (the current phase).
3. `openspec/changes/ca9-galaxy-collision/` — blocked until M12-RI gates pass; then source-lock from Toomre & Toomre 1972 via NASA GISS/NTRS.

Why this order: the deep audit found a HIGH scientific-fidelity mismatch in the already-production Neutron Star destination. Its documentation/spec requires direct Schwarzschild backward ray tracing to the material surface, while current implementation comments explicitly say photon paths remain straight and that surface ray tracing is not implemented. Close that production defect before adding CA9.

## First commands

From repository root, after reading the active change (`openspec/changes/m12-repository-integrity/`):

```bash
git status --short
git rev-parse HEAD
node --version
npm --version
npm ci
npm run check
```

Then execute the change-specific baseline and tasks.

## Non-negotiable rules

- Never invent scientific parameters or silently promote exercise/example values to production.
- Never use the weak-field thin-lens helper as proof of compact-object strong-field surface ray tracing.
- Never auto-update visual goldens to hide an unexplained physics/rendering difference.
- Never change black-hole stable ray codes/parity as collateral damage without an independently proven need.
- Never call an environment-deferred gate PASS without running it.
- Never commit downloaded third-party paper PDFs/raw datasets without explicit redistribution rights.
- Prefer deterministic state/event assertions over fixed sleeps.
- Keep docs/fidelity labels synchronized with what the code actually does.

Read `.agent/EXECUTION_PROMPT.md` completely before implementation.