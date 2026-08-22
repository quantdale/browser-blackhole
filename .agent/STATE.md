# Durable project state

Last update: 2026-08-22 — GATE-RUN CYCLE: PENDING WORK VALIDATED, ATLAS WEBGL2 DEBT CLOSED
Shell/process spawn works again in-session. All pending gates ran for the
first time on the previously unvalidated working tree; every failure they
surfaced was fixed and re-proven: `npm run check` PASS (124/124 unit tests,
11 files), `E2E_PORT=… npx playwright test` PASS (17/17 browser tests). The
authored-but-unrun governor/service/integrator work is now committed-quality,
and the last deferred Gate F item (atlas under forced WebGL2) is closed.

## Current phase

**POST-GATE CONSOLIDATION COMPLETE.** Everything in the working tree is
validated by executed gates (no more "authored unvalidated" state). Next:
new-feature campaigns (Stellar Explosion, LUT/M8, Kerr) or the CPU/GPU numeric
corpus, both listed under Next actions.

## What this cycle did (exact)

1. RAN THE PENDING GATES (first session with working process spawn):
   - `npm run check`: initially FAILED at format (5 files) then typecheck
     (17 errors across governor/tests/specs); after fixes → PASS.
   - Playwright: initially 14/17 — all three new atlas-webgl2 deep links plus
     the shadow-purity test failed because `?backend=webgl2` was IGNORED on
     atlas routes. After fix → 17/17 PASS.
2. Fixed everything the gates surfaced:
   - governor.ts refresh estimator: guard `noUncheckedIndexedAccess` on the
     frame-duration ring read.
   - types.ts: added `ParticleSystemHandle.getDebugSnapshot(): Record<string,
     unknown>` (impl already had it; interface now documents RENDERING_SERVICES
     §16 contract).
   - governor.test.ts: explicit guards for indexed access under strict flags.
   - particleService.test.ts: object3d geometry access via structural cast;
     disposal-ownership listeners moved to BufferGeometry ('dispose' fires on
     geometry.dispose(), never on Object3D — same correction in volumeService).
     DEFAULT CONFIG BUG: shared makeConfig emitter had no speed, so particles
     never moved — two determinism tests (seed divergence, reset reproducibility)
     were unsatisfiable with all-zero state; default point emitter now carries
     speed: 3 (tests needing stationary particles override explicitly).
   - volumeService.test.ts: import vi; invoke onBeforeRender with the full six-
     argument three.js signature; REAL CONTRACT FIX: the density callback test
     asserted eager per-step calls at construction — wrong, the march Loop body
     is a TSL Fn evaluated only during shader generation on the renderer.
     Test rewritten to pin laziness (creation must NOT invoke user callbacks).
   - Browser specs: single canonical `window.__ATLAS_APP__` typing now lives in
     tests/browser/support/atlasHook.ts (per-spec duplicate global declarations
     caused TS2717); navigation/webgl2 specs side-effect-import it.
3. IMPLEMENTED THE MISSING ATLAS BACKEND OVERRIDE (the debt the new spec was
   guarding against):
   - SharedRendererKernelOptions.forcedBackend: 'webgl2' skips the WebGPU
     attempt entirely; 'webgpu' removes the WebGL fallback on failure.
   - CosmicAtlasHostOptions.forcedBackend forwarded from the app shell;
     atlasApp.ts parses ?backend= via existing readForcedBackend (docs/
     CI_CD.md §6 URL-decision-overrides subsection documents scope; 'unsupported'
     remains root-app terminal UX).
   - CRITICAL DISCOVERY — classic THREE.WebGLRenderer cannot build TSL node
     materials in three r185 at all: even MeshBasicNodeMaterial{colorNode:
     vec4(uv(),1)} dies in WebGLProgram resolveIncludes(undefined) (node system
     never generates GLSL for it; bisected with a minimal in-page repro). The
     kernel's WebGL2 fallback therefore now boots WebGPURenderer pinned with
     forceWebGL:true — same node system on GLSL, one code path for every
     destination (mirrors BlackHoleRenderer's root-route webgl2 decision).
     With that, ALL THREE atlas destinations render correctly under forced
     WebGL2, including the black-hole integrator: dark shadow, no failure
     magenta — validating every flat-0/1-gate conversion in
     schwarzschildIntegrator.ts on real GLSL.
4. Docs updated: docs/cosmic-atlas/ARCHITECTURE.md §6 (renderer/device backend
   policy), docs/CI_CD.md §6 (URL decision overrides). scripts/bench-black-hole.mjs
   prettier fixup included in this campaign's commits.

## Environment actually tested

- OS Windows; Node v22.23.2 / npm 10.9.8.
- Browser: Microsoft Edge headless via Playwright channel msedge.
- Backend: hardware WebGPU, adapter "amd rdna-2"; forced ?backend=webgl2 now
  validated on BOTH the root route AND all three /atlas/* deep links.
- Prior session note about shell/LSP spawn failures (`paths[0] undefined`,
  unquoted profile path) did NOT reproduce this session; bash, vitest,
  tsc, vite build, playwright all executed normally.

## Validation evidence

| Command | Result |
| --- | --- |
| `npx prettier --check .` | PASS |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `npx vitest run` | PASS — 11 files, 124/124 tests |
| `npm run build` | PASS (vite 8, 61 modules; pre-existing INEFFECTIVE_DYNAMIC_IMPORT notice only) |
| `E2E_PORT=4176 npx playwright test` | PASS — 17/17 (6 M0 smoke incl. forced backends + unsupported UX, 7 atlas-navigation, 4 atlas-webgl2) |

Physics spot-evidence carried over from prior cycles (unchanged code paths):
center-of-shadow pure black (CAPTURED, not failure) on WebGPU AND now under
forced WebGL2; disk-row beaming asymmetry edge-on 3.4% vs face-on 0.0%;
photon-ring winding visible; star-center GPU/CPU ordering within 1 LSB on both
backends.

## Quality-gate status

- Gate A Repository health: PASS (commands above).
- Gate B Browser health: PASS (17/17; hardware WebGPU + forced-webgl2 root AND atlas).
- Gate C Physics correctness: PARTIAL PASS — classifications/orderings validated;
  full CPU/GPU numeric ray corpus still deferred (Next actions #1).
- Gate D Visual correctness: PARTIAL — deterministic screenshots exist
  (artifacts/, uncommitted); no golden framework yet.
- Gate E Performance: baseline recorded (see Superseded/current rows below);
  black-hole cost genuinely tier-scaled post-7b9910a (13.9 ms median low tier).
- Gate F Compatibility: PASS — hardware WebGPU + forced-webgl2 everywhere
  (root + all atlas destinations). Previously DEFERRED_ENVIRONMENT; now closed.
- Gate G Release: N/A (M11).

## Performance baseline (hardware WebGPU, 1280x800 viewport)

Current true low-tier black-hole (post 7b9910a live uMaxSteps budget):
median 13.9 ms / p95 20.8 ms at renderScale 0.6 (~600x480 internal).
Other destinations ~7.0 ms median at low tier. Historical high-tier-baked row
(41.7 ms median mislabeled 'low') kept in git history only.

## Defects found and fixed in earlier campaigns (committed)

1. starfield falloff inverted (CPU+GPU) — bf4ee29.
2. forced-webgl2 TSL crash on ROOT route ("addToStack", branch-free rewrite of
   starfieldGpu/diagnostic) — 9a152f6.
3. Schwarzschild NUMERICAL_FAILURE magenta shadow (coordinate-stall capture +
   removed GPU-only photon-sphere shrink) — 8dd4ca5.
4. neutron-star destination never presented frames (render pass-through) — fbcc007.
5. rapid-retarget reporting bug (director queue drain bypassed NavigationController)
   — found BY the race test — 2ba84f6/2ba84f4.
6. baked-at-prepare loop budget ignored live tier (perf cycle) — 7b9910a.

## Governor auto-tier fixes (this campaign, now VALIDATED)

Implemented previously, first-executed this cycle (tests/unit/governor.test.ts,
11 tests): refresh-aware raise bar min(target x 1.15, estimatedRefreshFps - 4)
floored at target x 0.9 from a 120-sample frame-minimum ring with two-sided
15% quantization tolerance; wall-clock STARTUP_GRACE_MS = 3000 suppression
re-armed on forced-tier release / auto-mode entry / active-destination switch;
setActiveDestination(id|null) lifecycle so ONLY the active destination's work
multiplier drives expectations (legacy max-of-registered fallback retained for
hosts that never signal); anti-flap cooldown no longer freezes sustain
accumulators. Still desirable (not blocking): a manual browser probe confirming
auto recovers after a forced downgrade on a vsynced 60 Hz display — headless
cadence makes it flaky as an automated gate.

## Deferred / known gaps (honest)

1. Full CPU/GPU numeric corpus for the integrator (selected-ray classification/
   min-radius/redshift parity beyond spot checks). Harness pattern exists
   (tests/browser/ray-parity.spec.ts).
2. VolumeService/ParticleService GPU compute path is browser-only by design;
   node harnesses cover documented CPU/validation surfaces. No destination
   exercises them yet (CA2-05 foundation).
3. Golden-image regression framework not started (screenshots are manual).
4. Governor auto-recovery probe on real 60 Hz display (above).
5. Half-res volume render path unused by any destination (plumbing tested).

## Next actions

1. CPU/GPU numeric corpus for the integrator using the ray-parity harness
   pattern (classification/min-radius/g-factor parity on selected rays).
2. New-feature campaigns in roadmap order: Stellar Explosion destination work,
   LUT/M8 backend (BH-160..165), Kerr (M9) only after corpus lands.
3. Optional: golden-image tooling (Gate D partial -> pass).

## Session-cycle note (tooling)

Prior session could not spawn processes environment-wide; this session
executed everything (bash/vitest/tsc/build/playwright). If that failure
signature returns, check the unquoted-profile-path issue recorded in git
history of this file.
