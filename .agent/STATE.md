# Durable project state

Last update: 2026-08-26 — **M11 PRODUCTION HARDENING & RELEASE CANDIDATE COMPLETE.**

Campaign: `.agent/EXECUTION_PROMPT.md` (M11, Planned-From `6a51389`) executed
to its completion gate and marked COMPLETED. Baseline reconciled at startup:
local `main` fast-forwarded `6a51389` → `3b25cb1` (remote planner commit);
worktree clean; no destructive operations at any point.

## Current phase

**M11 COMPLETE — release candidate.** Packet status:

| Packet | Status | Evidence |
| --- | --- | --- |
| M11-01 browser/fallback matrix | DONE | `docs/COMPATIBILITY_MATRIX.md` + `tests/browser/compatibility-matrix.spec.ts` (4/4 Chromium, 4/4 Firefox 153 headless WebGL2 fallback, serial); WebKit + real devices `DEFERRED_ENVIRONMENT` with reasons. |
| M11-02 mobile/touch/DPR | DONE | `tests/browser/mobile-touch.spec.ts` 5/5 (portrait DPR-3 pixel cap, orientation flip, tiny-viewport recovery, mobile-layout drag without scroll trapping, no-hover panel operability). Emulated only — no device performance claims. |
| M11-03 device-loss recovery | DONE | Locked terminal reload-required contract implemented (`isFatalDeviceLoss`, `onFatal`, truthful `GPU_DEVICE_LOST` status line, frame submission stop) + `tests/browser/device-loss.spec.ts` 3/3 via production-path fault injection (`simulateDeviceLossForTest`). `docs/FAILURE_RECOVERY.md` §5 records the decision + rationale. |
| M11-04 resource-leak torture | DONE | `tests/browser/resource-leak.spec.ts` 3/3: 12 cross-destination cycles return to scope/GPU-byte baselines; observer churn bounded; resize storm live+bounded (debug-inventory counters, no new telemetry). |
| M11-05 accessibility | DONE | `tests/browser/accessibility.spec.ts` 4/4: keyboard core flow (nav → mode switch → panel → observer select), canvas text companion, labeled range inputs with text readouts + arrow-key operation, post-switch focus never stranded in disposed nodes. |
| M11-06 assets/provenance/licenses | DONE | `docs/ASSET_PROVENANCE.md` §18 dated audit: PASS. **Missing root LICENSE added (MIT)**; three@0.185.1 sole runtime dep (MIT); bundle scanned clean of machine paths/keys; CA9 source status truthfully blocked. |
| M11-07 production build/deployment | DONE | `npm ci` fresh-lockfile proof (144 pkgs, 0 vulnerabilities) + full `npm run check` green; `docs/DEPLOYMENT.md` provider-neutral contract (SPA fallback, HTTPS, cache policy, no secrets, CSP, no COOP/COEP); the whole e2e suite runs on the production preview build. |
| M11-08 final benchmark report | DONE | `benchmarks/results/2026-08-26-m11/` — first-class `--observer` harness + matched 5-scenario series + `SUMMARY.md` (honest CPU-rAF labeling, frameGpuMs=null, single-machine caveats, regression audit vs M10 baseline). |
| M11-09 user-facing docs | DONE | README status/truthfulness refresh (M10 observer modes + stop-band limitation + Kerr presets + new suites + timing wording); `docs/FAILURE_RECOVERY.md` §5 rewritten to the locked contract; `docs/OBSERVABILITY_DIAGNOSTICS.md` §8.1 documents `?lutdebug`/`?kerrstatus` classification views. |
| M11-10 release-candidate full gate | DONE | Final cumulative run (below). |

M10 release-evidence debts closed: observer goldens materialized + twice-stable;
matched moving-observer benchmarks recorded.

## High defects found and fixed (all validated)

1. **Vacuous Kerr/BHM golden baselines** — harness `startsWith('/atlas/black-hole')`
   navigation skip swallowed `?preset=` rows AND `black-hole-merger`; 8
   baselines were byte-identical default-view captures (MD5-verified). Fixed
   (full URL parsing + post-capture destination/preset assertion + `#scene`
   identity guard); 8 re-baselined; the other 27 pre-existing baselines
   byte-identical across the fix.
2. **M10 moving-observer GPU init physically wrong** — static-emitter
   direction formulas without u's spatial drift → empty-sky (Schwarzschild
   numerical+LUT) / failure-magenta (Kerr) renders on all four moving
   presets. Fixed covariantly (`E=-k_t`, `pr=k_r/E`, `b=L/E`,
   `Wu + Σn_a W_a`, new `observerLegWu` uniform) with binary64 mirror
   (`observer/photonInit.ts`) + 5 unit gates (static-formula reduction exact
   to 1e-12); Kerr step budget scaled ×3 for moving observers only
   (compile bound decoupled from the tier ladder; measured census median
   ~215 / p95 ~1260 / max ~2600 steps). Residual Kerr failure band =
   DOCUMENTED pole-passage honesty gate (near-polar Lz≈0 photons) — now
   visible per-reason via `?kerrstatus`.
3. **Device loss had no user-visible path** — `GPU_DEVICE_LOST` copy existed
   but was unreachable; loss left a misleading READY. Fixed with the locked
   terminal reload-required contract.
4. **Observer preset framings** pointed the observer ~90° away from the hole
   (hole outside the FOV) — sight-line-corrected poses.
5. **Control-panel staleness/mid-drag rebuilds** — deep-link boots showed
   stale values forever; slider drags rebuilt the panel per input event.
   Fixed (one rebuild per completed transition, mode in signature, per-tick
   value sync).
6. **Missing root LICENSE** (package.json declared MIT, no file).

## Final cumulative validation (release gate)

| Gate | Result |
| --- | --- |
| `npm ci` fresh lockfile | PASS — 144 packages, 0 vulnerabilities |
| `npm run check` | PASS — prettier clean; eslint clean; tsc clean; vitest **476/476** (32 files); vite build PASS |
| `npm run e2e` (workers=2, production preview) | **169/169 PASS** — 165 default-project (all destination suites, parity corpora ×4 backends, 40 goldens, observer modes, compatibility matrix, mobile-touch, device-loss, resource-leak, accessibility) + 4 firefox-project matrix tests |
| Visual goldens | 40/40, twice-stable (two standalone runs + the final e2e) |
| Environment | Windows 11 (10.0.26200), Node v22.23.2, Playwright `msedge 151` headless + Firefox 153 headless, hardware WebGPU `amd rdna-2`; e2e on `E2E_PORT=4199` (4173 occupied by a foreign app) |

## Known limitations / deferred (truthful)

- WebKit: `DEFERRED_ENVIRONMENT` (Playwright ships no Windows WebKit builds).
- Real mobile devices: `DEFERRED_ENVIRONMENT` (emulated viewport/touch only;
  no device GPU/performance claims).
- Kerr moving-observer scenes: residual explicit failures are the documented
  pole-passage honesty gate + max-steps at low tiers (preset recommends
  ultra); disclosed in GOLDEN_IMAGES.md and the preset fidelity note.
- `frameGpuMs` null everywhere (no GPU timestamp queries wired).
- Hosted CI: `.github/workflows/ci.yml` runs format/lint/typecheck/unit/build
  + a WebGL2-fallback smoke job; hosted runners provide no representative
  WebGPU, so the full browser/golden evidence is local-run (recorded
  honestly; not silently claimed as CI-passed).
- Carried debts unchanged: CA9 Toomre & Toomre transcription blocked on the
  paper source; CA8 remnant perf note; Kerr perf headroom.

## Critical/High defects remaining

Zero known.

## Commit chain this campaign

```
3b25cb1 docs(agent): plan M11 production hardening and release-candidate campaign
7855f67 fix: correct M10 moving-observer GPU photon initialization, preset sight lines, and observer panel sync
13f3adb test: golden harness destination/preset guard, corrected Kerr/BHM baselines, M10 observer goldens
2156d46 state: record M11 WS0/WS1A defect ledger, moving-observer render fix evidence, and next workstreams
422b13d bench: first-class moving-observer selection in the black-hole benchmark harness (M11 WS1B)
1ee1606 test: M11-01 compatibility matrix with engine-agnostic fallback suite (Chromium + Firefox)
75fd95b test: M11-02 mobile/touch/DPR hardening suite (device-emulated)
6c21a54 fix: explicit terminal device-loss state with production-path fault injection (M11-03)
662b8bc test: M11-04 quantitative resource-ownership torture across destinations
afe16a9 test: M11-05 accessibility suite - keyboard core flow and text-first state
1862937 fix: add missing MIT LICENSE text and record the M11 license/provenance audit (M11-06)
60da148 docs: provider-neutral deployment contract (M11-07)
0471db5 docs: M11 final benchmark summary, device-loss contract reconciliation, README truthfulness (M11-08/09)
55a1bc5 release: M11 production hardening release candidate - full campaign closure
b94d129 fix: complete the pushed tree - hook type surface, formatting, and deep-audit doc notes
<pending: state commit recording this chain; it is the campaign tip>
```

Final pushed `origin/main` at the time of this state update: `b94d129`
(closure commit `55a1bc5` + the tree-completion follow-up `b94d129` that
carries the hook type surface the committed specs typecheck against, plus
the deep-audit doc notes).

## Next actions

1. Planner pass selects the next campaign (CA9 remains blocked on the Toomre
   & Toomre source; no M12 exists — stop rather than manufacture work).
2. If a deployment target is chosen, verify the DEPLOYMENT.md checklist on
   the real host (HTTPS/WebGPU secure context, SPA fallback, cache headers).
