# browser-blackhole OpenSpec project context

## Product

`browser-blackhole` is a browser-first Three.js/WebGPU scientific visualization project whose original Black Hole renderer has expanded into Cosmic Atlas. The project favors scientifically honest reduced models over impressive but unsupported visuals.

## Current production surface

Certified production-ready as of 2026-08-27 (`docs/RELEASE_CERTIFICATION.md`).
Eight production Cosmic Atlas destinations:

- Black Hole (incl. Kerr presets)
- Neutron Star
- Stellar Explosion
- Compact Merger
- Tidal Disruption Event
- Quasar / AGN
- Black-Hole Merger
- Galaxy Collision (CA9 — DATA_DRIVEN restricted three-body bridge/tail, source-locked to Toomre & Toomre 1972 via NASA GISS/NTRS, offline GC1 artifact + CPU/GPU interpolation)

## CI topology

Hosted GitHub Actions CI runs `quality` (format/lint/typecheck/unit/build) and
a cheap backend-agnostic `browser-smoke` only. Hosted runners have no GPU and
cannot stably render the full lensing/Kerr/hyperspace suite (runner-speed
variance defeats any fixed timeout). The full behavioral+parity suite, the
visual goldens (hardware-WebGPU baselines), and the Firefox second-engine
matrix are a documented **local capable-runner gate** (`docs/CI_CD.md` §2/§16)
— run with `npm run e2e` / `--project=firefox` on a WebGPU-capable machine and
record results as evidence, never claim them as hosted-CI PASS.

## Active campaign

There is no live implementation campaign. The hardening plan in `docs/MASTER_PLAN.md`
(Phases 0–6) is complete; its §7 file-serialization rules remain binding if that plan is
ever reopened, but it is not an open queue. The whole-atlas performance optimization
campaign is complete-with-deferrals (certified at `179eb56`).
`spatial-atlas-continuous-navigation` is the only active OpenSpec change: 0/123, not
started, and not authorization to implement. Do not restart M0–M12, CA9,
final-production-readiness, or `whole-atlas-performance-optimization`.

`docs/SPECIFICATION_BASELINE_CORRECTIONS.md` remains authoritative for the Phase 0 review
findings — the cinematic final certified checkpoint is `17c4644` (not `2fc1b5d`). The
2026-10-03 population (7 archived, 11 active, 6 specs) is historical. Current inventory,
quoted with command: `openspec list` shows 1 active change;
`openspec validate --archived --strict` passed 25/25;
`openspec validate --all --strict` passed 20/20 on 2026-10-22.

## Technical stack

- TypeScript
- Three.js `three/webgpu` + TSL
- Vite
- Vitest
- Playwright
- offline Python tooling for selected scientific-data reduction
- no required runtime backend/API

## Repository invariants

1. Scientific fidelity labels are contracts. `DIRECT`, `DATA_DRIVEN`, and `PROCEDURAL_SCIENTIFIC` claims MUST match runtime behavior.
2. Strong-field black-hole physics and stable ray classifications MUST not regress as collateral damage from new destinations.
3. CPU/reference validation precedes or accompanies GPU implementation for numerically meaningful paths.
4. Runtime scientific assets are compact, pinned, checksummed and provenance-documented; raw giant source datasets remain offline.
5. Visual goldens are regression evidence, not an oracle for scientific correctness. Never auto-update them to hide a behavior change.
6. Performance claims require same-machine/config evidence and must distinguish CPU/rAF timing from actual GPU timestamp timing.
7. Capability/fallback behavior must fail truthfully; no silent scientific-quality substitution.
8. Every long-lived renderer/module resource must participate in the existing disposal/resource-scope contracts.
9. Do not introduce runtime O(N^2) scientific simulation for Galaxy Collision; browser runtime consumes validated reduced trajectories/keyframes.
10. Do not treat the weak-field thin-lens helper as a substitute for direct strong-field surface geodesics.

## Canonical commands

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run check
npm run e2e
```

Use narrower unit/browser/parity/golden commands during development, but close a campaign change only with the gates required by `.agent/QUALITY_GATES.md` and its change-specific tasks.

## Planning/execution sources of truth

Read in this order before editing:

1. `.agent/STATE.md` (newest section is the continuation point)
2. `.agent/START_HERE.md` and `AGENTS.md`
3. `.agent/EXECUTION_PROMPT.md` only when its status is `ACTIVE`
4. the assigned `openspec/changes/<change>/` folder, if one is assigned
5. `.agent/QUALITY_GATES.md`
6. implementation-specific docs referenced by that assignment
7. `docs/MASTER_PLAN.md` as the completed hardening record, not as an open queue

`docs/NEXT_CAMPAIGN_AUDIT_2026-08-26.md` and `docs/NEXT_CAMPAIGN_AUDIT_2026-08-28.md`
are historical input documents, not active guidance.

When historical text conflicts with an active OpenSpec change, do not silently choose one. Determine whether the historical statement is stale, update it as part of the appropriate truthfulness task, and preserve scientific/runtime invariants.

## OpenSpec conventions for this repository

Each change contains:

- `proposal.md` — why/what/scope and dependencies;
- `design.md` — architecture, decisions, risks and validation strategy;
- `tasks.md` — executable checklist; only mark tasks complete with evidence;
- `specs/<capability>/spec.md` — delta requirements and scenarios.

Requirements use `SHALL`/`MUST`. Scenarios use GIVEN/WHEN/THEN/AND. If a scientific source or license blocks a requirement, record the blocker and stop dependent tasks rather than inventing data.
