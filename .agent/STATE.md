# Durable project state

Last update: 2026-08-26 — **M11 PRODUCTION HARDENING IN PROGRESS (WS0+WS1A core landed).**

Campaign: `.agent/EXECUTION_PROMPT.md` (M11 Production Hardening & Release
Candidate, Status ACTIVE, Planned-From `6a51389`). Baseline reconciled: local
`main` fast-forwarded `6a51389` → `3b25cb1` (remote planner commit) at startup;
worktree was clean; no destructive operations.

## Current phase

M11 workstream progress:

| Workstream | Status | Evidence |
| --- | --- | --- |
| WS0 baseline release audit | CORE DONE (ongoing ledger below) | Findings ledger in this file; two High defects found and fixed (see Defects). |
| WS1A M10 observer goldens | **DONE** | 4 new baselines (`OBSERVER_CIRCULAR/FLYBY/FREEFALL`, `KERR_CIRCULAR_OBSERVER`), twice-stable 40/40 twice; see Golden corrections. |
| WS1B moving-observer bench harness | NOT STARTED | next action |
| WS2..WS11 (M11-01..M11-10) | NOT STARTED | browser matrix, mobile/touch, device-loss, leak torture, a11y, provenance, prod build, final bench, docs, release gate |

## WS0/WS1 defect ledger (found -> fixed this campaign)

1. **HIGH — vacuous Kerr/BHM golden baselines (harness defect).**
   `runGoldenExpectation` skipped navigation for any URL starting
   `/atlas/black-hole`, silently swallowing `?preset=...` rows AND the whole
   `black-hole-merger` destination. All 3 KERR_* and 5 BHM_* baselines were
   byte-identical MD5 copies of the DEFAULT black-hole frame — their Gate D
   regression gate was vacuous. FIXED: full destination+preset URL parsing,
   navigation on any difference, defensive post-capture
   destination/preset assertion, and the `#scene` identity guard (foreign
   server on the e2e port now fails loudly). 8 baselines regenerated; the
   other 27 pre-existing baselines stayed byte-identical across the fix.
2. **HIGH — M10 moving-observer GPU photon initialization was physically
   wrong (blank-sky / failure-magenta renders on all four moving presets).**
   The Schwarzschild numerical and LUT backends derived conserved quantities
   from static-emitter DIRECTION formulas applied to a world direction built
   WITHOUT u's spatial drift (missing Wu term; sign-lost L; O(beta) plane
   misorientation). Kerr momentum extraction was already covariant-correct but
   its step budget starved (moving rays need ~2-4x affine path; measured
   census: median ~215 / p95 ~1260 / max ~2600 policy steps).
   FIXED:
   - `observerUniforms.ts` ships `observerLegWu` (world direction of u's
     spatial part);
   - `schwarzschildIntegrator.ts` + `lut/lensingGpu.ts`: moving-observer init
     now covariant — `E = f0*k^t`, `pr = k_r/E`, `b = (r0*|world tangential
     rate|)/E`, world direction `Wu + sum n_a W_a`; legacy camera/static math
     preserved bit-for-bit (all 27 unaffected goldens byte-stable, KERR_*/BHM
     static rows pass against pre-fix baselines);
   - Kerr: `MAX_COMPILE_LOOP_BOUND` decoupled from the ultra tier budget
     (x3 headroom) and the destination scales `maxSteps` x3 (clamped to the
     compile bound) ONLY for active moving observers — static-camera budgets
     unchanged;
   - new Kerr classification debug view (`?kerrstatus`, debugMode>=2) with
     non-finite sub-reasons (theta-wrap red / pole-passage yellow / other
     magenta) — Gate D debug-observability addition;
   - the residual Kerr failure band was identified as the DOCUMENTED
     pole-passage honesty gate (ADR §1.19): near-polar (Lz~0) photons coast
     over the pole where f32 cannot certify accuracy — truthful explicit
     failure, not a defect.
3. **MEDIUM — M10 observer preset framings pointed the observer away from the
   hole.** Camera poses supplied LOOK axes relative to the pose->origin line,
   but the render origin is the WORLDLINE position ((r,0,0) at tau=0); the
   hole sat ~90 deg outside the 60 deg FOV. FIXED: sight-line-corrected poses
   for `observer-circular` [19,2.2,0], `observer-flyby` [48,6,0],
   `observer-freefall` [21,2.5,0], `kerr-circular-observer` [13,1.8,0]
   (documented in preset comments).
4. **MEDIUM — control panel showed stale values after deep-link/preset boot**
   (Observer mode displayed "Camera (legacy)" while the destination state was
   `circular`; same race for every destination control). Root cause: panel
   builds before the arrival transition seeds destination state; the rebuild
   signature was already final. FIXED: one forced rebuild per completed
   transition + observer MODE added to the signature + per-tick value sync
   (`observerSync`) for mode-specific rows.
5. **MEDIUM — dragging any observer slider rebuilt the entire panel
   mid-gesture** (`setObserver` called `markPanelDirty()` per input event).
   FIXED: value changes no longer rebuild; mode changes rebuild via the
   signature; values reflect via per-tick sync.

## M10 release-evidence closure (WS1A)

- 40 golden rows total (36 prior + 4 new M10 observer rows).
- New baselines established AFTER the render fix, verified **twice-stable**
  (two consecutive full-suite runs 40/40, plus a third pass inside the full
  e2e run below).
- KERR_*/BHM_* re-baselines captured BEFORE the render fixes still pass after
  them — static-camera output is unchanged (locked bit-for-bit policy holds).
- `ATLAS_HYPERSPACE_BH_NS` re-baselined by its documented jitter tolerance.
- Numeric gates for the moving-observer fix: `tests/unit/observerPhotonInit.test.ts`
  (5 tests: pixel-photon null constraint; covariant-init EXACT reduction to
  legacy static formulas at 1e-12; angular-momentum identity; Kerr near-null
  constants with prograde/retrograde structure; deterministic injected-constant
  plane traces). Full unit suite 476/476.

## Validation evidence (this checkpoint)

| Gate | Result |
| --- | --- |
| `npm run check` | PASS — prettier clean; eslint clean; tsc clean; vitest **476/476** (32 files); vite build PASS |
| `npm run e2e` (workers=2) | **146/146 PASS** (142 prior + 4 new observer goldens) incl. integrator-parity (webgpu/webgl2 x numerical/lut), kerr-parity 322-corpus, lut-disk-parity, observer-modes suite |
| Visual goldens | 40/40, twice-stable (two consecutive standalone runs + e2e pass) |
| Environment | Windows 11, Node v22.23.2, Playwright `msedge 151` headless, hardware WebGPU (amd rdna-2); e2e port moved off 4173 (`E2E_PORT`) because a FOREIGN app occupied it |

## Known debt / limitations (updated)

1. Kerr moving-observer scenes: residual explicit failure classes are
   TRUTHFUL (pole-passage honesty gate + max-steps at low tiers). Low-tier
   (256x3) traces still fail the p95 tail; the preset recommends ultra.
   Documented in GOLDEN_IMAGES.md and the preset fidelity note.
2. Carried M8/M9/CA8/CA9 debts unchanged (see git history of this file).
3. `frameGpuMs` remains null everywhere (no GPU timestamp queries wired).
4. WS1B (moving-observer benchmark harness) and WS2..WS11 are open (above).

## Critical/High defects remaining

Zero known. (Two High defects found this campaign are fixed and validated.)

## Next actions

1. **WS1B**: extend `scripts/bench-black-hole.mjs` with `--observer=<mode>`
   + deterministic phase, record matched static/circular/flyby/freefall/kerr
   evidence under `benchmarks/results/` (CPU rAF deltas labeled; no GPU claims).
2. WS2 (M11-01): compatibility matrix doc + fallback tests.
3. WS3 (M11-02): mobile/touch/DPR suite.
4. WS4/WS5 (M11-03/04): device-loss + leak torture coverage.
5. WS6..WS11 per EXECUTION_PROMPT; close with Gate I and flip the prompt to
   COMPLETED only when the release condition holds.
