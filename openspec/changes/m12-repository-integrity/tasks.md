# Tasks: M12 Repository Integrity and Evidence Hardening

## 1. Re-baseline after M12-NS

- [ ] 1.1 Confirm `m12-neutron-star-surface-lensing` is closed with evidence or explicitly contained/downgraded per its fallback contract.
- [ ] 1.2 Record current HEAD/tool versions and run `npm ci` plus `npm run check` before integrity edits.
- [ ] 1.3 Read the latest `.agent/STATE.md`, README, dependency docs, CI config, Playwright config, benchmark matrix and package scripts end-to-end.

## 2. Active instruction/control-plane truthfulness

- [ ] 2.1 Verify `.agent/START_HERE.md` routes only to the current campaign/OpenSpec workflow and contains no actionable M0–M11 restart instruction.
- [ ] 2.2 Verify `.agent/EXECUTION_PROMPT.md` reflects the actual remaining dependency order and completed M12-NS state.
- [ ] 2.3 Reconcile `.agent/STATE.md` current-phase heading/status with the active campaign; preserve useful historical evidence below it.
- [ ] 2.4 Search prominent docs for stale `M11`, `in progress`, `next`, `blocked`, `not implemented`, `frameGpuMs`, `CA9`, and neutron-star claims; inspect each hit rather than bulk replacing.
- [ ] 2.5 Update roadmap/backlog/current-state wording only where evidence shows drift.

## 3. Dependency manifest/policy reconciliation

- [ ] 3.1 Inspect the lock-resolved `tsx` version and why the direct manifest currently uses a caret range.
- [ ] 3.2 Unless a documented reason requires a range, change `tsx` to an exact intended version consistent with the repository’s exact-pin policy.
- [ ] 3.3 Reconcile `package-lock.json` through normal npm tooling; do not hand-edit lock integrity fields.
- [ ] 3.4 Update `docs/DEPENDENCIES.md` so every direct dependency/tool covered by the policy is accurately represented.
- [ ] 3.5 Run a clean `npm ci`, `npm ls --depth=0`, `npm run check`, and confirm no unintended package upgrade occurred.

## 4. Hosted CI browser contract

- [ ] 4.1 Inspect `.github/workflows/ci.yml`, `playwright.config.ts`, per-suite capability skips and CI documentation to reconstruct intended hosted coverage.
- [ ] 4.2 Decide explicitly between broad fallback-suite semantics and true smoke-only semantics; record the reason.
- [ ] 4.3 Make workflow job name/comment/command agree with the chosen semantics.
- [ ] 4.4 Update CI/testing docs with what the hosted job proves and what remains local/capable-runner/environment evidence.
- [ ] 4.5 Run the exact chosen CI browser command locally where possible and confirm expected tests/skips.
- [ ] 4.6 Confirm no coverage was silently removed to shorten CI.

## 5. Eliminate known fixed-wait waveform flake

- [ ] 5.1 Locate the black-hole-merger waveform cursor assertion using the fixed ~400 ms wait recorded in durable state.
- [ ] 5.2 Identify the observable state/event/postcondition that actually means cursor synchronization has completed.
- [ ] 5.3 Replace the arbitrary sleep with bounded condition-based waiting/polling and a useful failure message.
- [ ] 5.4 Run the targeted test repeatedly enough to exercise timing variance.
- [ ] 5.5 Run the containing browser suite at normal worker concurrency and verify the original flake does not recur.
- [ ] 5.6 Do not label the flake closed if the replacement merely increases the timeout/sleep.

## 6. Benchmark harness discoverability

- [ ] 6.1 Inventory every maintained `scripts/bench-*.mjs` file and map it to a package script.
- [ ] 6.2 Add `bench:stellar-explosion` for the already-existing stellar-explosion harness.
- [ ] 6.3 Verify the M12-NS neutron-star harness has a consistent `bench:neutron-star` package script.
- [ ] 6.4 Run a representative invocation of every newly exposed/modified benchmark command and verify its record schema/help/error behavior.
- [ ] 6.5 Reconcile `docs/cosmic-atlas/BENCHMARK_MATRIX.md` with actual production destination harnesses and evidence availability.
- [ ] 6.6 If new benchmark evidence is committed, include machine/backend/quality/resolution/timing-source context and no unsupported cross-machine claims.

## 7. User-facing and scientific claim reconciliation

- [ ] 7.1 Update README M11 status to the actual completed post-M11 optimization state.
- [ ] 7.2 Update GPU timing wording to reflect true timestamp support where it exists and retain correct caveats where it does not.
- [ ] 7.3 Verify neutron-star wording exactly matches the final M12-NS implementation/fallback outcome.
- [ ] 7.4 Update CA9 source-status language: public GISS/NTRS source access is available, while production parameters remain source-lock gated until transcribed/validated.
- [ ] 7.5 Verify production destination count/availability and route catalog claims.
- [ ] 7.6 Verify dependency exact-pin claims match the final manifest/lockfile.
- [ ] 7.7 Verify benchmark/performance text never labels CPU/rAF timing as GPU timing.

## 8. No-behavior-drift gate

- [ ] 8.1 Run `npm run check`.
- [ ] 8.2 Run the intended full browser suite for the available environment.
- [ ] 8.3 Run visual goldens; investigate any change because this integrity pass should not alter scientific rendering.
- [ ] 8.4 Inspect `git diff` for broad formatting churn, accidental golden updates, generated junk or unrelated refactors.

## 9. Closure

- [ ] 9.1 Update `.agent/STATE.md` current phase and evidence with M12-NS + M12-RI results.
- [ ] 9.2 Update backlog/roadmap status so CA9 is the next change only if all prerequisites are met.
- [ ] 9.3 Mark OpenSpec tasks from observed evidence and leave environment/source-blocked items unchecked with reasons.
- [ ] 9.4 Commit a detailed integrity-pass report covering each mismatch, exact remediation, commands/gates and remaining limitations.
- [ ] 9.5 Push when authorized and only then allow CA9 source-lock/runtime work to proceed.
