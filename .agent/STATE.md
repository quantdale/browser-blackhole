# Durable project state

Last update: 2026-08-25 — **M10 RELATIVISTIC OBSERVER MODES COMPLETE.**

M10 ships the cohesive relativistic observer abstraction: view/camera
orientation is presentation-only; the physical observer worldline and
four-velocity drive aberration and frequency physics through the invariant
`g = (-k.u_obs)/(-k.u_emit)` with `nu_obs = 1` by tetrad construction.
Four modes are LIVE for the Cosmic Atlas black-hole destination: `camera`
(legacy bit-stable anchor), `static` (compatibility proof through the new
abstraction), and the three physical modes `circular`, `flyby`, `freefall`
with Kerr support. Boyer-Lindquist is retained; Kerr-Schild is not
implemented — the product terminates the freefall worldline at a declared
stop band instead of rendering through the horizon (OBSERVER_FRAME_ADR §3,
KERR_BACKEND_ADR §3).

CA9 Galaxy Collision engine work (CA9-01/02 locked, CA9-03 core 7/7 analytic
checks) was completed in the preceding session and remains committed on this
branch ahead of origin/main; this M10 campaign built on top of it. The
campaign directive's authoritative file `.agent/EXECUTION_PROMPT.md` was NOT
present in the working tree at startup; the campaign was executed from the
mission text supplied in the prompt, reconciled against the actual
repository state per the audit protocol (§1.4).

## Current phase

**M10 COMPLETE (packets M10-01..M10-09; BH-220..BH-224).**
CA9 remains PARTIAL (see below) and is the next legitimate roadmap
candidate alongside M11 hardening — neither was started during this campaign
per §21.

## M10 packet status

| Packet | Status | Evidence |
| --- | --- | --- |
| M10-01 observer four-velocity interface | DONE | `src/phenomena/black-hole/observer/{types,metric,tetrad,snapshot,observerUniforms}.ts` — universal per-event tetrad `P(x)=x+(x.u)u` + Gram-Schmidt construction from `u` and camera axes (valid inside the Kerr ergosphere); 16-float flat uniforms `U,A1,A2,A3` (+ world dirs) drive every GPU backend coherently. |
| M10-02 static observer | DONE | Valid outside horizon / ergosphere; static tetrad `e_(t)=u_s` + orthogonalized phi-leg reproduces `initKerrRay` conserved `E,L_z,p_r,p_theta` exactly — asserted numerically in `tests/unit/observerFrame.test.ts` (compatibility anchor). GPU legacy path preserved bit-for-bit for `camera`/`static` (goldens unchanged). |
| M10-03 circular observer | DONE | Equatorial timelike circular geodesic [BPT72] eqs 2.16/2.17 generalized to signed `a*`; analytic `Omega = s/(r^{3/2}+s a*)`, `u^t` closed form; existence `r > r_ph(sense)`, stability disclosure via ISCO. Verified `u.mu u^mu = -1`, `spin->0` symmetry, frame-dragging pro/retro branches, `u^t` consistency, `circularUnstable` flag. |
| M10-04 flyby worldline | DONE | Unbound equatorial timelike geodesic with conserved `E = gammaInfinity`, `L_z = gammaInfinity betaInfinity b`; RK4 over shared BL Hamiltonian RHS `kerrRhs` (exact `E,L_z` params, Carter diagnostic). Validates exact `E/L_z`, normalized constraint `|2H+1|/scale`, periastron convergence (coarse vs fine < 5e-3). |
| M10-05 freefall/plunge worldline | DONE | Geodesic drop from rest relative to static observers at `r0`: `E=sqrt(f_s(r0))`, `L_z = g_tphi/ E`, `Q=0`; proper-time `tau` integration with proximity-scaled substeps (`DTAU=0.002`, floor `2e-6`); deterministic replay bit-identical; terminates at declared stop band. |
| M10-06 aberration/frequency transformation | DONE | Aberration is the boosted tetrad decomposition (no screen distortion); frequency `g = 1/(u^t_emit(E - Omega L_z))` with `nu_obs=1` by construction. Dual locked convention: `camera`/`static` keep the legacy distant-astronomer `g` (goldens bit-stable), moving modes measure comoving (shader multiplies legacy `g` by `1/E_ray` when `observerFrequencyComoving`). Liouville `g^3` stays centralized. Validated by flat-space SR recovery in unit tests. |
| M10-07 time/pause controls | DONE | Deterministic proper-time `tau` advanced from `FrameContext.time.dt` gated on `services.time.snapshot().paused`; `timeScale` multiplier; `paused=true` freezes `tau`; worldline `advance(dTau)` shares the same delta; enter/preset/control changes reseed deterministically (`tau=0`); reset/replay verified. |
| M10-08 near-horizon stability/error behavior | DONE | Distinct classes: `static-inside-ergosphere`, `observer-on-axis`, `observer-at-or-inside-horizon`, `no-circular-orbit-below-photon-orbit`, `release-inside-ergosphere` (seed guard), `horizon-approach` terminal (rendering stops at `r_stop = r_+·(1+1e-3)`, truthful message), `non-finite-worldline-state` (constraint drift). Inside-horizon rendering is explicitly NOT claimed. |
| M10-09 observer reference scenarios | DONE | Validated by the 11-test `observerFrame.test.ts` suite plus browser parity (see below). |

Backlog mapping: BH-220 camera/observer separation, BH-221 circular, BH-222 flyby, BH-223 freefall/plunge, BH-224 aberration/Doppler — all satisfied.

## Scientific ADR and Kerr-Schild decision

Observer ADR: `docs/OBSERVER_FRAME_ADR.md` (LOCKED) — metric signature `-+++`, `G=c=1,M=1`, signed `a*` on `+Y`, mode definitions, world-frame convention, photon momentum `k = eps(u + n_a e_(a))` with `eps=1`, tetrad via `P(x)=x+(x.u)u`, dual frequency convention, `tau`-semantics, domain tables, failure/terminal truthfulness.

Kerr-Schild decision: **Boyer-Lindquist retained; ingoing Kerr-Schild NOT implemented.** The §1.10/§1.22 trigger — plunge observers *requiring through-horizon integration* — was NOT met: the shipped freefall contract stops at the declared stop band (explicit `horizon-approach` terminal), worldline integration uses the regular-at-horizon `dr/dtau` form, and photon traces never integrate through `r+`. Costs of KS (8-var Cartesian state, heavier metric work, `r_KS=r_BL+M` breaking exact `a*->0` comparison) outweigh the unexercised benefit. Migration triggers recorded in both ADRs for any future interior-rendering promise. Documented in OBSERVER_FRAME_ADR §3 and KERR_BACKEND_ADR §3.

## CA9 status (carried, not advanced during M10 per §21)

| Packet | Status | Evidence |
| --- | --- | --- |
| CA9-01 source survey/license | DONE | `docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION.md` §1; Zenodo sweeps found no licensed time-series collision dataset; IllustrisTNG/EAGLE/FIRE/GALMER rejected (registration-gated / unreachable / unverifiable); Phantom ICs (13162815 CC-BY-4.0) rejected (ICs only). |
| CA9-02 dataset selection | DONE | CA-ADR-022: regenerate Toomre & Toomre 1972 restricted three-body experiments from published parameters. |
| CA9-03 offline engine | PARTIAL | `tools/cosmic-data/restricted_three_body.py` 7/7 analytic self-checks PASS, byte-stable report `9f84df4a…f0ee8a`, gated by `ca9Integrator.test.ts` (6 tests). REMAINING: transcribe published encounter parameters (requires legitimate paper copy; report stays `placeholder-exercise-config`, test-guarded). |
| CA9-04..CA9-19 | NOT STARTED | — |

## Commit chain this campaign

```
996bad7 research: lock CA9 galaxy-collision source decision and provenance survey
ae8a1f1 state: record CA9 research head
f8c5d79 feat: add deterministic restricted three-body engine with analytic self-checks (CA9-03 core)
1123567 state: record CA9-03 engine checkpoint
e397e87 feat: add observer frame physics core — tetrads, worldlines, SR validation (M10-01)
f540c9f feat: wire physical observer through GPU backends, destination, presets and UI (M10-02..07 core)
692b3cf test: add M10 observer browser suite; truthful seed-failure surfacing; readout/activation decoupling
<pending: docs + closure commit>
```

Baseline reconciled at startup: local `main` 1123567 vs `origin/main` 0139e65. Four CA9 commits were ahead; no `EXECUTION_PROMPT.md` was present; working tree was clean. No valid newer work was reset. Preserved unknown changes policy honored (no `reset --hard` / `clean` / force-push / history rewrite).

## Validation evidence

| Gate | Result |
| --- | --- |
| `npm run check` (format/lint/typecheck/test/build) | PASS — `prettier clean; eslint clean; tsc clean; vitest 471/471; vite build PASS` |
| Unit suite | **471/471** across 31 files — `observerFrame.test.ts` 11/11 incl. static-equivalence anchor, SR aberration/Doppler (flat-limit), BPT circular kinetics, raw-metric normalization, flyby/freefall constraint/Carter/determinism/convergence, near-horizon class distinctions, `beta->0` recovery. |
| `npm run e2e` (Playwright FULL suite, workers=2) | **142/142 PASS** — 136 prior (30 files incl. all physics/Kerr/LUT/golden/torture suites) + **6 new M10 observer-mode browser tests** (`observer-modes.spec.ts`). Direct single-run count (no flake retry). The earlier 6-worker run OOM'd (`Fatal process out of memory: Zone`); re-running at workers=2 passes clean. |
| Visual goldens | **36/36 PASS** twice-stable — run1 and run2 both 36/36. Zero golden files changed; historical goldens remain valid per BH_CLASSIC byte-for-byte regression anchor (GPU `camera`/`static` keep legacy init bit-for-bit by locked policy). |
| CPU↔GPU parity (browser) | `integrator-parity` 36-corpus (webgpu + webgl2, numerical) PASS; `kerr-parity` 322-corpus PASS; `lut-disk-parity` PASS — indistinguishable from CPU reference within documented tolerances. |
| LUT/circular observer | Covered by the same corpora; LUT disk rendering meanAbsDelta 6.441→ re-measured 10.8s pass after M10 gating correction. |
| Browser per-mode proof | `observer-modes.spec.ts`: legacy static boot readout, circular `beta`/`gamma` physical, `properTimeTau` determinism, pause-freeze (`play`/`pause` transport), freefall radius monotone decrease, ergosphere truthfulness, rapid mode switching bounded. |
| Benchmarks | `benchmarks/results/2026-08-25-m10/static-baseline.json` — label `m10-static-baseline`, `commit 692b3cf`, preset `default` (legacy `camera`), `median 7ms` (stable63 7, p90 7, mean 6.96, stdev 0.39); `effectiveRenderSize 778×581`; `lut:loaded schwarzschild-v1-415dea94`; `adapter amd rdna-2, WebGPU, msedge 151.0, Win32`; `frameGpuMs: null` (honestly labeled `rAF frame deltas are CPU-side measurements, not GPU timestamps`). Matched moving-observer tiers deferred — harness extension required (recorded as debt). |
| Device/loss | No device-loss in the 142-pass run; WebGPU `chrome/msedge 151` headless, hardware WebGPU (amd rdna-2). |

Environment exercised: Windows 11 (10.0.26200), Node v22.x, Edge headless (Playwright Desktop Chrome channel `msedge 151.0.0.0`), hardware WebGPU `amd rdna-2`. `frameGpuMs` stays null everywhere (no GPU timestamps; CPU-side rAF deltas honestly labeled — PERFORMANCE.md §benchmark note).

## Known debt / limitations (updated)

1. Carried M8/M9 items unchanged: Kerr perf headroom, pole-passage failure class (reclassified as `NUMERICAL_FAILURE`, CPU/GPU mirrored, never shadow), axis tilt unsupported (config reports `UNSUPPORTED` verbatim).
2. Carried CA8 debt: BBM remnant ~42 ms/frame at pinned medium tier; waveform shows `h22` only; failure-count telemetry into bench records still open; revisit SXS successor `SXS:BBH:2325` if CaltechDATA records gain explicit licenses.
3. Carried CA9 fidelity boundary: restricted three-body — NO disk self-gravity / hydrodynamics / halos / SF — plus the still-open transcription blocker (paper closed-access). Until resolved, no numeric galaxy-sim claims beyond the bibliographic record.
4. **M10 new goldens**: §18 candidates (Circular Observer Aberration/Doppler, Flyby Reference Epoch, Freefall Reference Epoch, optional Kerr Moving Observer) are NOT yet materialized as committed PNG baselines — the four new M10 presets are golden-ready and the `GOLDEN_IMAGES.md` workflow is recorded; committing baselines via `UPDATE_GOLDENS=1` and twice-stability proof remains the next imaging checkpoint. Existing 36 goldens were left byte-identical to preserve the regression anchor.
5. **M10 matched benchmarks**: moving-observer tiers (`circular`, `flyby`, `freefall`, `kerr-circular-observer`) are pending harness support that can drive observer mode as a first-class preset parameter — static baseline is recorded; thermal/phase-hysteresis tuning across render classes remains CA11 scope.
6. M11 hardening, tilted-Kerr, GRMHD and interior-horizon rendering remain explicitly out of scope (campaign §21).

## Critical/High defects remaining

Zero known.

## Next actions

1. **M10 golden imaging** (optional, §18): materialize the four M10 observer presets as GOLDEN_IMAGES rows via `UPDATE_GOLDENS=1`, prove twice-stable, commit baselines + benchmark records.
2. **M10 harness benchmarks**: extend `scripts/bench-black-hole*.mjs` to drive observer mode/phase as a label, record moving-observer tiers honestly (CPU rAF deltas are not GPU timings), and publish under `benchmarks/results/`.
3. **CA9-03 parameter transcription** (USER INPUT NEEDED — library/PDF of Toomre & Toomre 1972 ApJ 178, 623) — transcribe published encounter parameters with page citations, flip `parametersStatus`, add published-parameter anchor tests; then CA9-04 reduction experiments on the landed engine.
4. **M11 production hardening** per ROADMAP order after CA9/M10 goldens/benchmarks are materialized.
