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

Read in this order for active work:

1. `.agent/START_HERE.md`
2. `.agent/EXECUTION_PROMPT.md`
3. `docs/NEXT_CAMPAIGN_AUDIT_2026-08-26.md`
4. the active `openspec/changes/<change>/` folder
5. `.agent/QUALITY_GATES.md`
6. implementation-specific docs referenced by that change
7. `.agent/STATE.md` for durable historical evidence

When historical text conflicts with an active OpenSpec change, do not silently choose one. Determine whether the historical statement is stale, update it as part of the appropriate truthfulness task, and preserve scientific/runtime invariants.

## OpenSpec conventions for this repository

Each change contains:

- `proposal.md` — why/what/scope and dependencies;
- `design.md` — architecture, decisions, risks and validation strategy;
- `tasks.md` — executable checklist; only mark tasks complete with evidence;
- `specs/<capability>/spec.md` — delta requirements and scenarios.

Requirements use `SHALL`/`MUST`. Scenarios use GIVEN/WHEN/THEN/AND. If a scientific source or license blocks a requirement, record the blocker and stop dependent tasks rather than inventing data.
