# Tasks: Final production-readiness certification

Mark `- [ ]` → `- [x]` only with evidence. A blocked task stays unchecked with a note.

## 0. Baseline (evidence recorded)

- [x] Record git/runtime baseline (`main@7d6d19d`, node v24.3.0 local / node 22 CI, npm 11.4.2).
- [x] `npm ci` clean (196 packages, 0 vulnerabilities).
- [x] Establish that quality gates pass locally: lint ✓, typecheck ✓, `vitest run` 515/515 ✓, build ✓.
- [x] Reproduce and classify the red hosted CI: run `33039618290`, browser job — 68 pass / 69 default-fail / 12 firefox-fail / 46 skip; all failures are Firefox-not-installed or software-WebGL2 starvation (no functional/golden/NaN failures).

## 1. CI root-cause fixes

- [x] Iteration 1: split browser job into `browser-chromium` (sharded, `workers=1`, goldens excluded) + `browser-firefox` (Firefox installed). Fixed the Firefox-not-installed defect; cut Chromium failures via reduced contention. *(superseded by iteration 3 — see below)*
- [x] Iteration 2: root-caused remaining failures as a too-short arrival-poll ceiling for software WebGL2; added centralized `ARRIVAL_TIMEOUT_MS` (CI 180s), 6 shards. Cut failures 65→26 but hosted runner speed variance (measured: same arrival 18s in one hosted run, >180s in another) meant no fixed timeout gives a stable gate. *(superseded)*
- [x] Iteration 3 (final, owner-approved): hosted CI reduced to `quality` + `browser-smoke` (cheap M0 boot/fallback smoke only); the full behavioral+parity+golden suite and Firefox second-engine matrix became a documented local capable-runner gate.
- [x] Validate `.github/workflows/ci.yml` parses (2 jobs: `quality`, `browser-smoke`).
- [x] Push and obtain ≥3 consecutive green runs: commit `79b2da9`, run `33079109595` + 2 re-runs, all `quality` PASS + `browser-smoke` PASS.

## 2. Cross-platform `npm run check`

- [x] Add `.gitattributes` (`* text=auto eol=lf`; `*.png`/`*.bin binary`).
- [x] One-time renormalize touches only 4 CRLF data JSONs; whitespace-ignoring diff empty; 63 data-loader/parity tests pass.
- [x] Confirm `format:check` passes on a clean LF worktree (`git worktree` of HEAD → `prettier --check` → "All matched files use Prettier code style!").

## 2b. Software-WebGL2 investigation (led to the final local-gate architecture)

- [x] Root-caused 6-shard failures as the 30s arrival poll being too short for software WebGL2 (measured local SwiftShader arrivals 3–6s; hosted 2-vCPU >10x slower; dt-clamped transition clock). Spikes to 120s/257s were concurrent-load artifacts on the measuring machine, re-measured clean — no destination is intrinsically excluded.
- [x] Centralized `ARRIVAL_TIMEOUT_MS` (CI 180s / local 30s, env-overridable) applied to every arrival/settle/phase poll across all browser specs; retained for local-machine use even after the hosted architecture changed.
- [x] Firefox: `firefoxUserPrefs` attempted to force software WebGL2; confirmed on hosted CI this does NOT give headless Firefox a GL context on a GPU-less Linux host (`this.gl is null` persisted) — Firefox is a local-only gate.
- [x] Measured hosted-runner speed variance directly (180s ceiling still left ~26/185 timeouts on a second full hosted run) → concluded the full GPU suite cannot be a stable hosted gate at any fixed timeout → final architecture (§1 iteration 3).
- [x] Local validation of the final architecture: typecheck+lint clean; full non-golden Playwright suite (WebGPU) 131/131; goldens 43/43 twice-stable; Firefox 4/4.

## 3. Documentation synchronization

- [x] `docs/CI_CD.md` §2/§16 rewritten to the final `quality` + `browser-smoke` hosted topology, full/parity/goldens/Firefox as documented local capable-runner gate.
- [x] `.agent/STATE.md` — closure record with corrected CI topology + 3 hosted green runs + local-gate evidence.
- [x] README — "Run it locally" usage section; browser-suite commands corrected (Firefox/Chromium install); "Current development continuation point" + "Current status" lines point to `docs/RELEASE_CERTIFICATION.md`.
- [x] `docs/COMPATIBILITY_MATRIX.md` — updated to current counts (515 unit / 131 browser / 43 goldens) and the hosted-smoke-vs-local-gate split, dated 2026-08-27.
- [x] `.agent/START_HERE.md`, `.agent/EXECUTION_PROMPT.md`, `openspec/project.md` — synced to certified state / CI topology.

## 4. Independent hard-gate re-verification (definition of 100%)

- [x] Functional: eight production destinations enter/exit/re-enter clean — full local Playwright suite 131/131 (includes navigation/resource/torture specs for every destination); hosted `browser-smoke` proves boot/fallback/unsupported.
- [x] Scientific fidelity: in-code descriptor labels match README/docs table (NS DIRECT, BBM/GC DATA_DRIVEN, SN/TDE/CM/AGN PROCEDURAL_SCIENTIFIC, BH DIRECT); numerical parity corpuses (integrator/kerr/NS) pass on the local capable runner.
- [x] Visual regression: full 43-golden suite run locally on a capable WebGPU runner, twice-stable (pass 1 + pass 2 both 43/43, exit 0). Hosted = DEFERRED_ENVIRONMENT (hardware-WebGPU baselines; documented, not silently green).
- [x] Resource lifecycle: resource-leak/torture suites pass in the local 131/131 run.
- [x] Production build + deploy config: `npm run build` clean; no source maps (`sourcemap:false`) and no secrets/local paths in `dist/`; SPA deep-link fallback + cache headers documented in `docs/DEPLOYMENT.md`; deep-link boots covered by the local browser suite.
- [x] Security/provenance: `npm audit` 0 vulnerabilities (dev+prod); root LICENSE present (MIT); no committed third-party PDFs/raw datasets; compact checksummed `*.bin` artifacts only; no secrets in bundle.
- [x] Deterministic data artifacts: GC1 + BBH loader/checksum/interpolation unit tests pass (63/63 in the data subset; part of the 515 unit suite).

## 5. Closure

- [x] Author `docs/RELEASE_CERTIFICATION.md` (repo SHA, defect counts P0/P1=0, gate results, 3 CI green-run IDs, limitations, verdict).
- [x] Finalize defect ledger (`ledger.md`) — every finding classified; F-01/F-01a/F-01b/F-02/F-06/F-04 CLOSED, F-03/F-05 FIXED, F-01c CLOSED (not a defect).
- [x] Sync `.agent/EXECUTION_PROMPT.md`, `START_HERE.md`, `STATE.md`, `openspec/project.md` to certified state.
- [x] Final `npm run check` (local, LF-clean) + hosted `quality`+`browser-smoke` verified green (3 consecutive); push.
