# Design: M12 Repository Integrity and Evidence Hardening

## 1. Principle

This is a truthfulness/evidence pass, not a cleanup excuse. Every edit must resolve an observed mismatch or make a gate more deterministic. Do not perform unrelated formatting or architecture churn.

## 2. Documentation/control-plane reconciliation

Treat these sources as different layers:

- `.agent/START_HERE.md` — current executor router;
- `.agent/EXECUTION_PROMPT.md` — current campaign overlay;
- OpenSpec change folders — requirement/task contracts;
- `.agent/STATE.md` — durable latest validated state plus history;
- `README.md` — user-facing current capabilities;
- roadmap/backlog — planned/completed work history.

The active router/prompt MUST never direct a fresh agent into a completed historical milestone. Historical campaign detail may remain, but must be labeled historical and must not masquerade as the next action.

At closure, scan prominent status strings such as `in progress`, `next`, `blocked`, `not implemented`, `frameGpuMs`, `M11`, `CA9`, and neutron-star fidelity language across docs and code comments. Do not blindly replace terms; verify each against implementation/evidence.

## 3. Dependency reproducibility

The audit found `docs/DEPENDENCIES.md` claiming exact direct pins while `package.json` contains `tsx: ^4.23.12`.

Preferred remediation:

1. pin `tsx` to the currently lock-resolved intended version;
2. run `npm install --package-lock-only` or the repository-approved equivalent only if necessary to reconcile lock metadata;
3. run `npm ci` from a clean state to prove reproducibility;
4. update the dependency table/policy text to include the direct tool dependency and match reality.

Do not weaken the exact-pin policy merely to avoid changing one manifest line unless a documented ecosystem reason requires ranges.

## 4. Hosted CI browser contract

Current CI prose/name suggests a smoke/fallback job while the command is broad `npx playwright test`.

First inspect capability skips, Playwright projects and historical CI intent. Choose one explicit contract:

### Option A — broad fallback suite

Use when the command is intentionally meant to run all tests that are meaningful under hosted Chromium/WebGL2 fallback.

- rename/comment the job accordingly;
- keep the broad command;
- document expected skips/environment limits.

### Option B — smoke-only hosted job

Use only if repository policy intentionally reserves full GPU/browser evidence for capable/local runners.

- invoke explicit smoke specs/project/tag;
- document what is and is not covered;
- retain full-suite commands in release/local quality gates.

The task is to eliminate ambiguity, not to optimize minutes. Coverage MUST NOT be silently reduced.

## 5. Deterministic waveform synchronization

The durable state records a black-hole-merger waveform cursor sync flake and a fixed ~400 ms wait.

Find the exact assertion and identify the state transition the sleep is approximating. Replace the delay with an observable postcondition, for example:

- `expect.poll` on timeline/cursor state;
- DOM attribute/text/value reflecting the target phase;
- requestAnimationFrame count plus explicit stable state only if the behavior is frame-driven and no better state exists;
- an existing test/debug hook exposing deterministic timeline state.

The replacement must have a bounded timeout and useful failure message. Do not add a longer sleep.

Stress the fixed test repeatedly and within the normal multi-worker suite before calling the flake closed.

## 6. Benchmark discoverability/evidence

Create a consistent package-script surface for maintained benchmark harnesses. At audit base:

- `scripts/bench-stellar-explosion.mjs` exists but lacks a package script;
- M12-NS is expected to add the missing neutron-star harness;
- other production destinations already have scripts.

Use predictable names, e.g. `bench:stellar-explosion`, `bench:neutron-star`, preserving existing names.

Then reconcile `docs/cosmic-atlas/BENCHMARK_MATRIX.md` with actual harness availability and committed evidence. A benchmark matrix row may state an environment-dependent gate, but must not imply a committed measurement that does not exist.

Do not fabricate cross-machine comparisons. If collecting new records, use the established benchmark metadata and same-machine caveats.

## 7. Public/status claim audit

At minimum reconcile:

- M11 status (completed vs “in progress” historical wording);
- actual GPU timestamp timing support after BH-121;
- neutron-star surface-ray fidelity after M12-NS;
- CA9 source status (public primary-source scan now discoverable, but exact production parameter transcription still required);
- production destination count/availability;
- dependency exact-pin statement;
- any benchmark statement that confuses CPU/rAF and GPU timing.

A public statement is acceptable only if code/tests/data evidence support it. Prefer precise limitations over marketing language.

## 8. OpenSpec/durable-state closure

After both M12 changes are complete:

- update `.agent/STATE.md` with the final current phase and evidence;
- update backlog/roadmap status where the repository uses them as durable history;
- mark the OpenSpec task checkboxes accurately;
- leave CA9 as the next active change only if M12 gates pass and its source-lock prerequisites remain viable.

Do not delete historical campaign records merely to make the repo look clean.

## 9. Validation

Required minimum:

```bash
npm ci
npm run check
npm run e2e
```

Additionally:

- rerun the waveform sync test repeatedly and under normal worker load;
- run CI-equivalent browser command locally where possible;
- execute benchmark harness `--help`/smoke or representative runs for modified package scripts;
- inspect `npm ls --depth=0` and manifest/lock consistency after dependency edits;
- search/inspect stale high-value status strings after docs reconciliation.

No scientific/rendering golden change is expected from this integrity pass. Any unexpected visual change must be investigated as a regression rather than accepted as cleanup fallout.
