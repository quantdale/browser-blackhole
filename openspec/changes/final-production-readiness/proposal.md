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

- Split the hosted browser job into a **Chromium behavioral+parity** job (serial `--workers=1`, sharded across independent runners, visual goldens excluded) and a **Firefox compatibility-matrix** job (Firefox installed, `--project=firefox`), so declared coverage actually executes and neither engine starves.
- Route the **visual-golden** suite to a local capable runner as designed: its baselines are hardware-WebGPU captures and cannot be pixel-matched on hosted software WebGL2. Record this as an explicit environment-deferred gate, never silently green.
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

- hosted CI on `main` is green across `quality`, `browser-chromium` (all shards) and `browser-firefox`, with **≥3 consecutive full green runs** on the flaky-risk browser jobs;
- no known P0/P1 defect remains open;
- Firefox coverage claimed by CI is coverage CI actually ran;
- visual-golden gate result is stated truthfully (local PASS with evidence, or hosted DEFERRED_ENVIRONMENT — never a false PASS);
- `npm run check` passes on a clean checkout on Linux and Windows;
- repository state, OpenSpec state, README/`.agent` state, CI state and the certification report all agree;
- no unexplained visual/scientific drift was introduced by this change.
