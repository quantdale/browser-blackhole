# Proposal: Final production-readiness certification

Change ID: `final-production-readiness`
Priority: **HIGH / RELEASE BLOCKER**
Planned-From: `main@7d6d19ddcb85bd8c963c40ed9ea9feabac9a7dbd`
Planned-At: 2026-08-27
Target-Branch: `main`
Depends on: M0–M11, `m12-neutron-star-surface-lensing`, `m12-repository-integrity`, `ca9-galaxy-collision` (all landed)
Blocks: tagging a release candidate

## Why

The implementation campaign is complete and every prior OpenSpec change is landed with local evidence, but the repository is **not release-certified**: hosted GitHub Actions CI on `main` has been red on every recent push. A green quality job coexisted with a fully red browser job, and the control-plane docs were marked "campaign complete" while `main` CI stayed red — repository state, CI state and release state disagree.

Independent investigation of run `33039618290` (HEAD `7d6d19d`) found the browser job failing through two independent mechanisms, not a functional regression:

1. **Firefox never ran.** The job installs only Chromium but the command was a bare `npx playwright test`, which runs *all* projects including the `firefox` project. All 12 Firefox tests failed at browser launch (`Executable doesn't exist`). CI claimed Firefox compatibility coverage it never executed.
2. **Software-WebGL2 worker starvation.** The `default` project ran `fullyParallel` with 2 workers on a 2-vCPU hosted runner using software WebGL2 (SwiftShader). Two heavy render contexts starved each other; because the atlas arrival/transition clock advances from `requestAnimationFrame`, a starved worker never reached the `arrived` state within the 30s poll. 66 tests failed with `Expected "arrived", Received "transitioning"` and screenshot-heavy parity tests exceeded their 120s budget. In the *same* run 68 tests passed (one at 46.9s), proving the app boots and arrives correctly whenever it gets CPU. Zero functional assertion failures, zero golden pixel mismatches, zero magenta/NaN.

A third, cross-platform defect surfaced during baselining: the documented `npm run check` fails on a fresh Windows checkout because `core.autocrlf=true` yields CRLF working-tree files while Prettier is pinned to `endOfLine: "lf"` and no `.gitattributes` enforces LF. CI (Linux) is unaffected, so this was invisible to hosted gates.

## What changes

- Reduce the hosted browser job to the reliable, backend-agnostic **M0 smoke** (`browser-smoke`: boot to ready/fallback/unsupported, forced-WebGL2 diagnostic render, safe interaction/resize — all cheap because the root renders the diagnostic gradient, not the heavy lensing/Kerr passes). Investigation proved the full GPU/TSL suite cannot be a *stable* hosted gate: hosted runners have no GPU, heavy shaders + the hyperspace transition render at seconds/frame under software WebGL2, and hosted runner speed varies wildly run-to-run (a black-hole arrival measured 18s in one run, >180s in another), so no fixed timeout survives — `workers=1` (contention) and a 180s ceiling only cut failures 65→26.
- Route the **full behavioral+parity suite, the visual goldens, and the Firefox second-engine matrix** to a documented **local capable-runner gate** (owner-approved 2026-08-27). They already pass there (131/131 non-golden + 43/43 goldens twice-stable locally). Record each result as evidence and mark environment-deferred for hosted CI — explicit environment routing, never silently green, and behavioral coverage is not lost (the suite still runs, where a GPU exists).
- Add `.gitattributes` enforcing LF for text files (binary assets and content-addressed `*.bin` excepted) so `npm run check` passes on a clean checkout on every platform.
- Synchronize `docs/CI_CD.md`, `.agent/STATE.md`, README and the compatibility matrix with the corrected CI topology and the true green-run evidence.
- Independently re-verify the definition-of-100% hard gates against current `main` and record the result in a certification report and defect ledger. Fix any genuine P0/P1 found; do not weaken assertions, inflate timeouts blindly, skip required tests, or narrow behavioral coverage to obtain green.

## Non-goals

- new scientific phenomena or destinations;
- reopening post-M11 optimization decisions without new evidence;
- changing numerical tolerances, quality budgets, parity thresholds or golden tolerances to make a gate pass;
- aesthetic refactors of working subsystems during certification (risk-reduction takes priority);
- establishing software-WebGL2 golden baselines in hosted CI (the goldens are a hardware-WebGPU gate by design).

## Success criteria

- hosted CI on `main` is green across `quality` and `browser-smoke`, with **≥3 consecutive green runs**;
- the full behavioral+parity+golden+Firefox suite passes on a capable local runner with counts/machine recorded in the certification (environment-deferred for hosted CI, never a false PASS);
- no known P0/P1 defect remains open;
- Firefox coverage claimed by CI is coverage CI actually ran;
- visual-golden gate result is stated truthfully (local PASS with evidence, or hosted DEFERRED_ENVIRONMENT — never a false PASS);
- `npm run check` passes on a clean checkout on Linux and Windows;
- repository state, OpenSpec state, README/`.agent` state, CI state and the certification report all agree;
- no unexplained visual/scientific drift was introduced by this change.
