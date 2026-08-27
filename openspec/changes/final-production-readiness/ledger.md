# Final production-readiness — defect ledger

Baseline: `main@7d6d19ddcb85bd8c963c40ed9ea9feabac9a7dbd` (2026-08-27).
Severity: P0 catastrophic · P1 major (crash/correctness/false-science/release-blocking) · P2 significant · P3 polish/low-risk.

Hard gate: P0 = 0 and P1 = 0 before release.

Final CI architecture (owner-approved 2026-08-27): **hosted CI = `quality` + `browser-smoke`** (reliable, cheap, backend-agnostic); the **full behavioral+parity+golden suite and the Firefox second-engine matrix are local capable-runner gates** whose evidence is recorded in the certification. This is explicit environment routing forced by hosted runners having no GPU — not silent coverage reduction.

| ID | Sev | Subsystem | Summary | Root cause | Resolution | Validation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | P1 | CI / Playwright | Hosted `main` CI red on every push; browser job fully failing (release-blocking: docs claimed complete while CI red). | Bare `npx playwright test` ran the full GPU suite + all projects on a GPU-less hosted runner. See F-01a/b. | Hosted browser job reduced to the reliable M0 smoke (`browser-smoke`); full suite → local gate. Quality gate unchanged. | Hosted `quality` + `browser-smoke` green on `79b2da9`: run `33079109595` and 2 re-runs, all PASS. | CLOSED |
| F-01a | P1 | CI / Firefox | All 12 `[firefox]` tests failed at launch (`Executable doesn't exist`). | CI installed only Chromium but ran all projects incl. `firefox`. | Firefox removed from hosted CI entirely (it cannot get a GL context there — see F-06); it is a local second-engine gate. | Local `--project=firefox` on a capable machine. | CLOSED (local gate) |
| F-01b | P1 | CI / rendering | ~half the `default` suite timed out on the 30s arrival poll; a broad set still exceeded even a 180s poll on a second run. | Hosted runners have no GPU: heavy TSL lensing/Kerr shaders + the full-screen hyperspace transition compile/render at seconds/frame under software WebGL2, and hosted runner speed varies wildly (same black-hole arrival 18s in one run, >180s in another). `workers=1` removed contention and the 180s ceiling cut failures 65→26, but no fixed timeout survives the variance. | The GPU-heavy suite is not a stable hosted gate — moved to the local capable-runner gate (already green: 131/131 non-golden + 43/43 goldens locally). The centralized `ARRIVAL_TIMEOUT_MS` (env-overridable) is retained for slower local machines; `workers=1`/serial retained where relevant. | Local full suite green; hosted `browser-smoke` (cheap diagnostic path) stable. | CLOSED (local gate) |
| F-01c | — | CI / measurement | Isolated destination arrivals under software WebGL2 measured 3–6s, but two early runs showed a single destination spiking to 120s+/257s. | Non-reproducible; concurrent load on the *measuring* machine (parallel Playwright + downloads), not intrinsic cost (clean re-measure: Kerr 5.0s, stellar 4.7s). | No destination is intrinsically excluded; the whole GPU suite is local-gated for the variance reason in F-01b, not per-destination cost. | Clean re-measurement. | CLOSED (not a defect) |
| F-02 | P2 | CI / visual goldens | 42 goldens never executed on hosted CI (cascade-skip); cannot pass there (hardware-WebGPU baselines vs software WebGL2). | Baselines are hardware-WebGPU captures. | Goldens are a local capable-runner gate (documented); hosted = DEFERRED_ENVIRONMENT. | Local goldens 43/43 twice-stable (pass 1 + pass 2, exit 0). | CLOSED (local gate) |
| F-03 | P3 | tooling / DX | `npm run check` failed on a clean Windows checkout (`format:check`). | `core.autocrlf=true` → CRLF working tree; Prettier `endOfLine:"lf"`; no `.gitattributes`. Invisible to Linux CI. | `.gitattributes` (`* text=auto eol=lf`; `*.png`/`*.bin binary`); one-time renormalize (4 data JSONs, whitespace-only). | Whitespace-ignoring diff empty; 63 data tests pass; clean LF worktree `prettier --check` passes. | FIXED |
| F-04 | P3 | docs | Control-plane docs marked "campaign complete" while `main` CI red — repository/CI/release state disagreed. | Prior campaign closure did not gate on hosted CI going green. | `docs/RELEASE_CERTIFICATION.md` authored; `.agent/STATE.md`, `START_HERE.md`, `EXECUTION_PROMPT.md`, README, `openspec/project.md`, `COMPATIBILITY_MATRIX.md` all synced to the certified state. | Certification report cites 3 green runs. | CLOSED |
| F-05 | P3 | src/docs | `stellar-explosion/presets.ts` factory docstring called itself a "TEMPORARY placeholder ... lands with CA4" though it already delegates to the landed `createRenderingModule()`. | Stale comment from CA4 scaffolding. | Rewrote the docstring to describe the real metadata/rendering split. | Comment-only; lint/typecheck/tests unaffected. | FIXED |
| F-06 | P2 | CI / Firefox | Headless Firefox on the hosted runner cannot initialize any WebGL context (`this.gl is null`); the app correctly fails closed. `firefoxUserPrefs` (`webgl.force-enabled`, software webrender) did NOT enable it. | Headless Firefox on a GPU-less Linux host has no usable GL (EGL/GLX) even with force-enabled — unlike Chromium's bundled SwiftShader. | Firefox is a local capable-runner gate (a machine with a real GL stack), not a hosted gate. The `firefoxUserPrefs` remain in config (harmless, help local software runs). | Local `--project=firefox` on a capable machine. | CLOSED (local gate) |

## Audit sweep status

Full-repository audit (TODO/FIXME/stub/mock/skip/hardcoded/etc.) and independent hard-gate re-verification are tracked in `tasks.md` §4. No P0 found. All P1 root causes (F-01a/b) resolved by the local-gate architecture; no P1 remains in the shipped code paths.

## Notes on what was explicitly NOT changed

- No numerical tolerance, quality budget, parity threshold or golden tolerance was weakened.
- No test was skipped, deleted, or had assertions loosened to obtain green.
- No black-hole stable-ray classification code was renumbered.
- No timeout was inflated to *mask* a defect — the GPU suite is routed to the environment that can run it, and the hosted smoke is genuinely cheap/stable.
- Behavioral coverage is not lost: the full suite still runs (locally, with recorded evidence); only its *execution environment* moved to where a GPU exists.
