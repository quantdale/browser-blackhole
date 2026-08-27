# Tasks: Final production-readiness certification

Mark `- [ ]` → `- [x]` only with evidence. A blocked task stays unchecked with a note.

## 0. Baseline (evidence recorded)

- [x] Record git/runtime baseline (`main@7d6d19d`, node v24.3.0 local / node 22 CI, npm 11.4.2).
- [x] `npm ci` clean (196 packages, 0 vulnerabilities).
- [x] Establish that quality gates pass locally: lint ✓, typecheck ✓, `vitest run` 515/515 ✓, build ✓.
- [x] Reproduce and classify the red hosted CI: run `33039618290`, browser job — 68 pass / 69 default-fail / 12 firefox-fail / 46 skip; all failures are Firefox-not-installed or software-WebGL2 starvation (no functional/golden/NaN failures).

## 1. CI root-cause fixes

- [x] Split browser job: `browser-chromium` (`--project=default --workers=1 --grep-invert "golden:" --shard=N/4`, matrix 1..4, `fail-fast:false`) + `browser-firefox` (install firefox, `--project=firefox`).
- [x] Verify command selection locally via `--list`: default 181, default-minus-goldens 138, goldens 43, firefox 4, shard 1/4 = 35.
- [x] Validate `.github/workflows/ci.yml` parses (3 jobs, matrix [1,2,3,4]).
- [ ] Push and obtain ≥3 consecutive green runs on `browser-chromium` (all shards) + `browser-firefox`. *(hosted validation — pending observation)*

## 2. Cross-platform `npm run check`

- [x] Add `.gitattributes` (`* text=auto eol=lf`; `*.png`/`*.bin binary`).
- [x] One-time renormalize touches only 4 CRLF data JSONs; whitespace-ignoring diff empty; 63 data-loader/parity tests pass.
- [ ] Confirm `format:check` passes on a clean LF worktree. *(worktree verification)*

## 3. Documentation synchronization

- [x] `docs/CI_CD.md` §2/§7/§16 rewritten to the split-job topology, workers=1 rationale, goldens as local gate.
- [ ] `.agent/STATE.md` — record corrected CI topology + green-run evidence.
- [ ] README — CI/status/badge and supported-browser claims match reality.
- [ ] `docs/COMPATIBILITY_MATRIX.md` — state only executed evidence (Chromium WebGL2 fallback hosted; Firefox compatibility hosted; WebGPU/goldens local).

## 4. Independent hard-gate re-verification (definition of 100%)

- [ ] Functional: eight production destinations enter/exit/re-enter clean (browser suite green covers this).
- [ ] Scientific fidelity: labels match implementation (spot-check NS DIRECT, GC DATA_DRIVEN, BH DIRECT/LUT); no claim exceeds the running model.
- [ ] Visual regression: goldens run locally, reviewed, twice-stable (or DEFERRED_ENVIRONMENT recorded truthfully).
- [ ] Resource lifecycle: resource-leak/torture suites green under the browser job.
- [ ] Production build + deploy config: clean build served, deep links, asset paths, no secrets/local paths in bundle.
- [ ] Security/provenance: `npm audit` clean; LICENSE present; no committed third-party paper PDFs/datasets without rights; no secrets in bundle.
- [ ] Deterministic data artifacts: GC1 + BBH checksum/regeneration self-checks pass.

## 5. Closure

- [ ] Author `docs/RELEASE_CERTIFICATION.md` (repo SHA, defect counts P0/P1=0, gate results, CI green-run list, limitations).
- [ ] Finalize defect ledger (`ledger.md`) with every finding classified and closed/accepted.
- [ ] Sync `.agent/EXECUTION_PROMPT.md`, `START_HERE.md`, `STATE.md`, `openspec/project.md`, `docs/cosmic-atlas/ROADMAP.md` to certified state.
- [ ] Final `npm run check` + full available browser gate; push; verify green.
