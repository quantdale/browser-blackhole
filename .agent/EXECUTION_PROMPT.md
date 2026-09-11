# EXECUTION PROMPT — Browser Blackhole active campaign

Status: **COMPLETED** (certified 2026-09-10 at `179eb56`; ledger closed in commit `5cb9ea6`)
Updated: 2026-08-28
Active change: `whole-atlas-performance-optimization`
Audit: `docs/NEXT_CAMPAIGN_AUDIT_2026-08-28.md`

> Reconciliation note (2026-09-11): this campaign reached its completion gate —
> `npm run check` 46 files / 631 tests, full default browser suite 275 passed /
> 1 documented skip, 43 scientific + 8 cinematic goldens twice-stable, Firefox
> 4/4, benchmarks captured, `docs/PERFORMANCE_CERTIFICATION.md` finalized. See
> `.agent/STATE.md` §"CAMPAIGN CERTIFIED at 179eb56" for the full evidence
> table. No workstream below remains open, so a `/goal continue` must **not**
> resume this campaign.
>
> The work that followed (2026-09-11) was a separate, explicitly user-directed
> **UI/UX product-surface campaign** — see `.agent/STATE.md` §"UI/UX design
> system" and `docs/UI_DESIGN_SYSTEM.md`. It is recorded there rather than
> here because it was not planner-generated.

## Mission

Execute `openspec/changes/whole-atlas-performance-optimization/EXECUTION_PROMPT.md` to completion.

This is a **performance-hardening campaign**, not a new feature campaign. The product's current eight-destination surface is already production-certified. Preserve accepted visuals, scientific fidelity, deterministic behavior, compatibility and resource safety while substantially reducing unnecessary CPU/GPU work, idle rendering, startup/transition cost and strong-field rendering expense.

## Required order

1. measurement + telemetry baseline;
2. render invalidation + visibility lifecycle;
3. transition occlusion + warmup;
4. startup/code splitting + lazy heavy resources;
5. black-hole active-pass lifecycle;
6. shared volume/particle/ribbon/post/work-budget optimization;
7. Schwarzschild optimization;
8. Kerr optimization;
9. destination-specific optimization across all eight destinations;
10. WebGL2/constrained-hardware verification;
11. resource/memory certification;
12. final performance certification.

Use the active OpenSpec's `tasks.md` as the authoritative checkbox list and `MASTER_PLAN.md` as the engineering rationale.

## Execution discipline

- baseline before optimization;
- evidence before checkbox completion;
- optimize work elimination before fidelity reduction;
- preserve reference/parity/goldens by default;
- reject noisy or unjustified optimizations;
- fix regressions immediately;
- keep blocked/environment-deferred items explicit;
- continue productively through hardening and certification rather than stopping at the first passing benchmark.

The full detailed autonomous prompt is already committed here:

`openspec/changes/whole-atlas-performance-optimization/EXECUTION_PROMPT.md`

Read it in full before editing production code.
