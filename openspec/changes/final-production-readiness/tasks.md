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
- [x] Confirm `format:check` passes on a clean LF worktree (`git worktree` of HEAD → `prettier --check` → "All matched files use Prettier code style!").

## 2b. Software-WebGL2 arrival ceilings (discovered after first fix)

- [x] Root-caused all 6-shard failures as the 30s arrival poll being too short for software WebGL2 (measured local SwiftShader arrivals 3–6s; hosted 2-vCPU >10x slower; dt-clamped transition clock). Spikes to 120s/257s were concurrent-load artifacts, re-measured clean — no destination routed out.
- [x] Centralized `ARRIVAL_TIMEOUT_MS` (CI 180s / local 30s) applied to every arrival/settle/phase poll across all browser specs; per-test timeout 300s (600s heavy); chromium shards 4→6.
- [x] Firefox: `firefoxUserPrefs` force software WebGL2 (headless Firefox has no GL context on a GPU-less runner by default).
- [x] Local validation: typecheck+lint clean; full non-golden Playwright suite (WebGPU) 131 passed / 0 failed.

## 3. Documentation synchronization

- [x] `docs/CI_CD.md` §2/§7/§16 rewritten to the split-job topology, workers=1 rationale, goldens as local gate; shard count N/6.
- [ ] `.agent/STATE.md` — record corrected CI topology + green-run evidence. *(closure)*
- [x] README — "Run it locally" usage section added; browser-suite commands corrected (Firefox/Chromium install); fidelity disclaimer + deploy note. *(status line synced at closure once CI green)*
- [ ] `docs/COMPATIBILITY_MATRIX.md` — state only executed evidence (Chromium WebGL2 fallback hosted; Firefox compatibility hosted; WebGPU/goldens local). *(closure)*

## 4. Independent hard-gate re-verification (definition of 100%)

- [ ] Functional: eight production destinations enter/exit/re-enter clean (browser suite green covers this). *(pending hosted green)*
- [x] Scientific fidelity: in-code descriptor labels match README/docs table (NS DIRECT, BBM/GC DATA_DRIVEN, SN/TDE/CM/AGN PROCEDURAL_SCIENTIFIC, BH DIRECT); numerical parity corpuses (integrator/kerr/NS) retained in hosted CI.
- [x] Visual regression: full 43-golden suite run locally on a capable WebGPU runner, twice-stable (pass 1 + pass 2 both 43/43, exit 0). Hosted = DEFERRED_ENVIRONMENT (hardware-WebGPU baselines).
- [ ] Resource lifecycle: resource-leak/torture suites green under the browser job. *(pending hosted green; passed locally)*
- [x] Production build + deploy config: `npm run build` clean; no source maps (`sourcemap:false`) and no secrets/local paths in `dist/`; SPA deep-link fallback + cache headers documented in `docs/DEPLOYMENT.md`; deep-link boots covered by browser suite.
- [x] Security/provenance: `npm audit` 0 vulnerabilities (dev+prod); root LICENSE present (MIT); no committed third-party PDFs/raw datasets; compact checksummed `*.bin` artifacts only; no secrets in bundle.
- [x] Deterministic data artifacts: GC1 + BBH loader/checksum/interpolation unit tests pass (63/63 in the data subset; part of the 515 unit suite).

## 5. Closure

- [ ] Author `docs/RELEASE_CERTIFICATION.md` (repo SHA, defect counts P0/P1=0, gate results, CI green-run list, limitations).
- [ ] Finalize defect ledger (`ledger.md`) with every finding classified and closed/accepted.
- [ ] Sync `.agent/EXECUTION_PROMPT.md`, `START_HERE.md`, `STATE.md`, `openspec/project.md`, `docs/cosmic-atlas/ROADMAP.md` to certified state.
- [ ] Final `npm run check` + full available browser gate; push; verify green.
