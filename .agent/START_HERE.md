# START HERE — repository status

Updated: 2026-08-27

The historical M0–M11 campaign, M12-NS, M12-RI, CA9 (Galaxy Collision), and the
**final-production-readiness** certification pass are all complete. **Do not
restart any completed historical packet.**

The repository is certified production-ready. Authoritative evidence:

1. `docs/RELEASE_CERTIFICATION.md` — full certification report (defects, CI
   green-run list, gates, fidelity, compatibility, verdict).
2. `.agent/STATE.md` — durable evidence/history, most recent closure record
   first.
3. `openspec/changes/final-production-readiness/` — the certification change
   (proposal, design, tasks, spec, defect ledger).
4. `openspec/AGENTS.md` / `openspec/project.md` — repository-wide OpenSpec
   context.
5. `.agent/QUALITY_GATES.md` — cumulative gates.

## CI topology (important — read before touching CI or browser tests)

Hosted GitHub Actions CI runs only:

- `quality` — format/lint/typecheck/unit/build (deterministic, no GPU).
- `browser-smoke` — the cheap, backend-agnostic M0 smoke
  (`tests/browser/smoke.spec.ts`) on Chromium under the WebGL2 fallback.

The full behavioral+parity suite, the 43 visual goldens (hardware-WebGPU
baselines), and the Firefox second-engine matrix are a **documented local
capable-runner gate** — hosted runners have no GPU and cannot stably render
the heavy lensing/Kerr shaders or the hyperspace transition (runner speed
varies too much for any fixed timeout). Run them on a WebGPU-capable machine:

```bash
npm run e2e                                                      # full suite incl. goldens
npx playwright install firefox && npx playwright test --project=firefox   # second engine
```

See `docs/CI_CD.md` §2/§16 for the full rationale and evidence requirement —
record local-gate results, never claim them as hosted-CI PASS.

## Starting a new campaign

If picking up new work, read `docs/RELEASE_CERTIFICATION.md` and
`.agent/STATE.md` first to confirm current state, then follow the OpenSpec
workflow (`openspec/AGENTS.md`) to propose the next change.

## Non-negotiable rules

- Never invent scientific parameters or silently promote exercise/example values to production.
- Never use the weak-field thin-lens helper as proof of compact-object strong-field surface ray tracing.
- Never auto-update visual goldens to hide an unexplained physics/rendering difference.
- Never change black-hole stable ray codes/parity as collateral damage without an independently proven need.
- Never call an environment-deferred gate PASS without running it.
- Never commit downloaded third-party paper PDFs/raw datasets without explicit redistribution rights.
- Never claim hosted-CI coverage for a suite that only ran locally.
- Prefer deterministic state/event assertions over fixed sleeps.
- Keep docs/fidelity labels synchronized with what the code actually does.
