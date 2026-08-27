# Final production-readiness — defect ledger

Baseline: `main@7d6d19ddcb85bd8c963c40ed9ea9feabac9a7dbd` (2026-08-27).
Severity: P0 catastrophic · P1 major (crash/correctness/false-science/release-blocking) · P2 significant · P3 polish/low-risk.

Hard gate: P0 = 0 and P1 = 0 before release.

| ID | Sev | Subsystem | Summary | Root cause | Fix | Validation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | P1 | CI / Playwright | Hosted `main` CI red on every push; browser job fully failing (release-blocking: docs claim complete while CI red). | Two independent mechanisms — see F-01a / F-01b. | See F-01a / F-01b. | Hosted runs after fix (≥3 green). | OPEN → fix pushed, awaiting hosted green |
| F-01a | P1 | CI / Firefox | All 12 `[firefox]` tests fail at launch (`Executable doesn't exist`). | CI installs only Chromium but ran bare `npx playwright test`, which runs *all* projects incl. `firefox`. | Dedicated `browser-firefox` job installs Firefox and runs `--project=firefox`; Chromium job scoped to `--project=default`. | `--list` shows firefox=4; hosted run green. | FIXED (code) — hosted pending |
| F-01b | P1 | CI / rendering | ~half the `default` suite times out nondeterministically (66 × `arrived`→`transitioning` 30s poll; parity 120s). | 2 Playwright workers on a 2-vCPU runner, software WebGL2 (SwiftShader); rAF-driven arrival clock starves; 68 tests passed same run. | `--workers=1` (remove contention) + shard ×4 across independent runners (restore wall-clock). | `--list` counts; hosted run green. | FIXED (code) — hosted pending |
| F-02 | P2 | CI / visual goldens | 42 goldens never executed on hosted CI (cascade-skip behind first golden's timeout); would fail if forced (hardware-WebGPU baselines vs software WebGL2). | Bare `npx playwright test` included the golden suite in a hosted env that cannot match its baselines; serial-describe cascaded the skip. | Exclude goldens from hosted job (`--grep-invert "golden:"`); run as documented local capable-runner gate; record DEFERRED_ENVIRONMENT for hosted. | `--list` 138 vs 43; local golden run evidence. | FIXED (code) — local run pending |
| F-03 | P3 | tooling / DX | `npm run check` fails on a clean Windows checkout (`format:check`). | `core.autocrlf=true` → CRLF working tree; Prettier `endOfLine:"lf"`; no `.gitattributes`. Invisible to Linux CI. | Add `.gitattributes` (`* text=auto eol=lf`; `*.png`/`*.bin binary`); one-time renormalize (4 data JSONs, whitespace-only). | Whitespace-ignoring diff empty; 63 data tests pass; clean LF worktree `format:check`. | FIXED (code) — worktree check pending |
| F-04 | P3 | docs | Control-plane docs marked "campaign complete" while `main` CI red — repository/CI/release state disagree. | Prior campaign closure did not gate on hosted CI going green. | Certification report + doc sync gate completion on hosted green (this change). | Certification report cites green runs. | OPEN — closes at certification |

## Audit sweep status

Full-repository audit (TODO/FIXME/stub/mock/skip/hardcoded/etc.) and independent hard-gate re-verification are tracked in `tasks.md` §4. New findings are appended here with an ID and classified before any are marked closed. No P0 found to date.

## Notes on what was explicitly NOT changed

- No numerical tolerance, quality budget, parity threshold or golden tolerance was weakened.
- No test was skipped or deleted to obtain green; behavioral coverage is unchanged (goldens re-routed, not removed).
- No black-hole stable-ray classification code was renumbered.
- No timeout was inflated to mask starvation (concurrency was reduced instead).
