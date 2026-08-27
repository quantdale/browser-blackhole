# Release certification — Browser Blackhole

Change: `openspec/changes/final-production-readiness`.
Certified: 2026-08-27.

This report records the evidence for the final production-readiness campaign. It
supersedes any earlier "campaign complete" claim that predated a green hosted CI.

## Repository

- Branch: `main`
- CI-fix-complete commit: `79b2da9` (architecture: hosted `quality` + `browser-smoke`)
- Certification/doc-closure commit: `<FINAL_SHA>` (this commit)
- Working tree: clean at certification
- Runtime: Node 22 (CI) / v24.3.0 (local dev); npm 11.4.2
- Dependencies: exact-pinned in `package.json` + `package-lock.json`; `npm ci` reproduces the lockfile; `npm audit` 0 vulnerabilities (dev + prod)

## Defects (ledger: `openspec/changes/final-production-readiness/ledger.md`)

- P0: **0**
- P1: **0** (F-01a/F-01b resolved by the local-gate CI architecture — no P1 remains in shipped code paths)
- P2: 0 open (F-02 goldens and F-06 Firefox resolved as documented local capable-runner gates)
- P3: 0 open (F-03 `.gitattributes` fixed; F-05 stale comment fixed; F-04 closed by this report)
- Accepted limitations: hosted CI cannot run the GPU-heavy browser suite (see Compatibility); it is a local capable-runner gate with recorded evidence.

Hard requirement met: **P0 = 0, P1 = 0.**

## Quality gates (local, capable WebGPU runner — msedge + AMD RDNA-2, Windows 11)

| Gate | Result |
| --- | --- |
| `npm run format:check` | PASS (verified on an LF worktree; CRLF-safe via `.gitattributes`) |
| `npm run lint` (eslint) | PASS |
| `npm run typecheck` (tsc) | PASS |
| `npm run test` (vitest) | PASS — 515/515 across 35 files |
| `npm run build` (tsc + vite) | PASS — no source maps, largest chunk `three.webgpu` 1.03 MB (283 KB gzip) |
| Full non-golden Playwright suite | PASS — 131/131 |
| Visual goldens (`visual-goldens.spec.ts`) | PASS — 43/43, twice-stable (pass 1 + pass 2, both exit 0) |
| Firefox second-engine matrix (`--project=firefox`) | PASS — 4/4 (local capable machine) |
| `npm audit` | PASS — 0 vulnerabilities |

## CI (hosted GitHub Actions)

Topology: `quality` (format/lint/typecheck/unit/build) + `browser-smoke`
(Chromium, WebGL2 fallback; `smoke.spec.ts` boot/fallback/unsupported).

Consecutive green runs on `main`, commit `79b2da9` (flaky-risk gate = `browser-smoke`):

1. run `33079109595` (first push) — `quality` PASS, `browser-smoke` PASS
2. run `33079109595` (re-run 1) — `quality` PASS, `browser-smoke` PASS
3. run `33079109595` (re-run 2) — `quality` PASS, `browser-smoke` PASS

All three runs executed the identical `79b2da9` tree (GitHub re-run replays the
same commit's workflow, isolating run-to-run stability from code changes).

## Production build & deployment

- Clean `npm ci && npm run build` from lockfile succeeds.
- `dist/` contains no source maps (`sourcemap: false`) and no secrets/machine-local paths.
- SPA deep-link fallback, `index.html` no-cache, and asset caching are documented in `docs/DEPLOYMENT.md`; deep-link boots are exercised by the browser suite; `npm run preview` serves `dist/` with SPA fallback.
- No runtime backend/API key/secret required.

## Performance

Per-destination benchmark harnesses (`npm run bench:*`) report CPU/rAF frame time and, where the WebGPU backend exposes timestamp queries, true GPU pass time (`frameGpuMs` with `gpuTimingNote`). Benchmarks are run on known local hardware, never authoritative on shared hosted runners (`docs/BENCHMARK_MATRIX.md`). No unbounded resource growth: the resource-leak/torture suites pass on the capable runner.

## Scientific fidelity (labels match implementation)

| Destination | Class | Notes |
| --- | --- | --- |
| Black Hole (+ Kerr presets) | DIRECT | Numerical Schwarzschild/Kerr backwards ray tracing; LUT auto-default; CPU/GPU parity corpora |
| Neutron Star | DIRECT | Direct Schwarzschild surface ray tracing to the material surface; disclosed omissions |
| Stellar Explosion | PROCEDURAL_SCIENTIFIC | Reduced core-collapse/hypernova/GRB models |
| Compact Merger | PROCEDURAL_SCIENTIFIC | Closed-form inspiral (DIRECT reduced) + procedural post-merger |
| Tidal Disruption | PROCEDURAL_SCIENTIFIC | Closed-form Kepler + reduced debris/shock model |
| Quasar / AGN | PROCEDURAL_SCIENTIFIC | Per-zone mixed fidelity, disclosed |
| Black-Hole Merger | DATA_DRIVEN | Source-locked SXS NR playback; illustrative lensing labeled |
| Galaxy Collision | DATA_DRIVEN | Source-locked Toomre & Toomre restricted three-body; offline checksummed artifact |

In-code descriptor labels were verified against the README/docs tables; numerical CPU/GPU parity corpora (Schwarzschild, Kerr, neutron-star surface) pass on the capable runner. No production claim exceeds the model actually running.

## Compatibility (only what was actually exercised)

- Chromium + hardware WebGPU (Windows 11, AMD RDNA-2): SUPPORTED (primary) — local.
- Chromium + forced WebGL2: SUPPORTED (fallback) — hosted `browser-smoke` + local.
- Chromium + unsupported override: SUPPORTED (terminal UX) — hosted + local.
- Firefox headless: fallback logic verified on a capable local machine (headless Firefox on a GPU-less host has no GL context — DEFERRED for hosted CI).
- WebKit, real mobile devices: DEFERRED_ENVIRONMENT (unavailable) — see `docs/COMPATIBILITY_MATRIX.md`.

## Provenance / licensing

Root MIT `LICENSE`; no committed third-party paper PDFs or raw datasets; only compact SHA-256-checksummed `*.bin` artifacts with documented reproduction (`docs/ASSET_PROVENANCE.md`, `docs/cosmic-atlas/DATA_SOURCES_*`).

## User acceptance

The full behavioral suite (navigation, presets, timeline, observer modes, resize, device-loss, accessibility, mobile/touch, resource-leak torture across all eight destinations) passes on the capable runner; goldens confirm the rendered output. No developer-only junk is shown by default (debug controls gated behind Debug mode).

## Release verdict

**`PRODUCTION READY`**

- Hosted CI: `quality` + `browser-smoke` green on 3 consecutive runs of commit `79b2da9` (run `33079109595`, run and 2 re-runs).
- Defects: P0 = 0, P1 = 0 (ledger: `openspec/changes/final-production-readiness/ledger.md`).
- Local capable-runner evidence: 515/515 unit, 131/131 non-golden browser, 43/43 goldens twice-stable, 4/4 Firefox, `npm audit` 0 vulnerabilities.
- Every environment-limited gate (full GPU suite, goldens, Firefox, WebKit, real mobile devices) is recorded as local-capable-runner evidence or DEFERRED_ENVIRONMENT — never claimed as hosted-CI PASS.
- Repository/OpenSpec/README/`.agent` state agree with this report as of commit `<FINAL_SHA>`.
