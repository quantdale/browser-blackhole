# Durable project state

Last update: 2026-08-22 — VALIDATION CAMPAIGN complete (baseline `0f0752e`).

## Current phase

**IMPLEMENTATION THROUGH CA2 + NEUTRON STAR IS RUNTIME-VALIDATED ON HARDWARE
WEBGPU.** This campaign executed the bulk-implementation code end to end,
found and fixed 1 Critical + 3 High defects, added regression coverage
(86 unit tests, 13 browser tests), recorded a first performance baseline,
and left every static gate green. Next campaign owns new features
(Stellar Explosion / LUT / Kerr) — explicitly NOT started here.

## Environment actually tested

- OS Windows; Node v22.23.2 / npm 10.9.8 (`npm ci` clean, 0 vulnerabilities).
- Browser: Microsoft Edge headless via Playwright channel msedge.
- Backend: **hardware WebGPU, adapter "amd rdna-2"** (not SwiftShader);
  forced `?backend=webgl2` additionally validated on the ROOT route.
- Internal render size at governor tier 'low': renderScale 0.6.

## Defects found and fixed this campaign

1. **CRITICAL — starfield falloff inverted (CPU+GPU):** `starFalloff` was
   ~0 at the star's own center and 1 at the edge (contradicted its doc).
   The whole sky rendered as background; GPU mirrored the bug. Fixed to
   t*t per contract; statistical unit tests that demanded hit rates ~40x
   above what the parameterization produces (never previously executed)
   were replaced with deterministic cell-enumeration tests of the same
   intent. `bf4ee29`.
2. **HIGH — forced-webgl2 TSL crash ("addToStack" TypeError, black canvas):**
   deeply nested select()/and() IsolateNode chains crash three r185's GLSL
   flow stage during VarNode.build (WebGPU unaffected). starfieldGpu and the
   diagnostic pass are now fully branch-free (flat 0/1 weight arithmetic,
   weight-sum face decomposition). Root route renders gradient+stars on both
   backends; e2e 6/6 restored. `9a152f6`.
3. **HIGH — Schwarzschild shadow rendered as NUMERICAL_FAILURE magenta:**
   (a) horizon coordinate stall (dr/dlambda = f*pr -> 0) exhausted step
   budgets before reaching capture epsilon — added coordinate-stall capture
   (pr<0 AND f<1e-3), default captureEpsilon 0.01M;
   (b) a GPU-only photon-sphere step shrink had no CPU-reference counterpart
   and burned winding-ray budgets as a failure-colored ring around the
   shadow — removed; cpuReference policy used verbatim. `/atlas/black-hole`
   now shows black shadow + photon-ring arcs + edge-on disk band + lensed
   stars on hardware WebGPU. `8dd4ca5`.
4. **HIGH — neutron-star destination never presented frames:** its render()
   was a documented pass-through while sibling destinations issue their own
   `ctx.renderer.render(scene, camera)` after the kernel binds HDR — canvas
   kept the previous destination's frame. Aligned; deep link now renders
   surface + dipole field lines. `fbcc007`.
5. **HIGH — rapid-retarget reporting bug:** director queue drain bypassed
   NavigationController, so activeDestination/URL stayed stale after a
   queued transition won. commitRoute now adopts the resolved selection.
   Found BY the new race test. `2ba84f4`.

## Validation evidence (routes / graphs / physics)

- Runtime-compiled and rendering on hardware WebGPU: schwarzschildIntegrator
  (+ accretionDisk emission graph), deterministic starfield, hyperspace
  transition shader (engaged in every in-app navigation), neutron-star hot-
  spot material + FieldLineService dipole lines, diagnostic destination,
  SharedRendererKernel/SharedPost pipeline, TransitionDirector lifecycle.
- Star-center probe: GPU pixel brightness tracks CPU `sampleStarfieldRadiance`
  ordering on BOTH backends within 1 LSB (146/255 for linear 0.35; clamps at
  255 for 2.32).
- Physics ordering checks: center-of-shadow pixel pure black (CAPTURED not
  failure); disk row asymmetry edge-on 3.4% vs face-on 0.0% (beaming
  direction correct, symmetry exact); photon-ring winding visible without
  failure contamination.
- Reduced motion (`prefers-reduced-motion: reduce`): transition engages and
  completes (crossfade path), 2.3 s total, zero errors.
- Atlas lifecycle: scopes swap per destination (shared-post + director + ONE
  destination scope), pendingPrepares 0 after races/stress, liveScopeCount
  bounded across 20 rapid switches, Back/Forward URL-synchronized, invalid
  route falls back to black-hole.
- DEFERRED (honest gaps): VolumeService/ParticleService dedicated runtime
  harness (no destination exercises them yet); full CPU/GPU numeric ray
  corpus (only classification/ordering spot-checks done); atlas lensing path
  under forced WebGL2 (integrator still contains flat and()/or() nodes —
  root app is branch-free, atlas BH validated on WebGPU only); governor auto
  tier stayed 'low' during probes (hysteresis timing worth a look later).

## Exact commands and results

| Command | Result |
| --- | --- |
| `npm ci` | PASS (0 vulnerabilities) |
| `npm run check` (format/lint/tsc/vitest/build) | PASS — 8 files, 86/86 tests, build ok |
| `E2E_PORT=4176 npx playwright test` | PASS — 13/13 (6 M0 smoke incl. forced backends + 7 atlas-navigation) |
| Manual probes (tmp scripts, removed after use) | reduced-motion, perf baseline, physics ordering, phase-trace race repro |

## Performance baseline (first recorded; hardware WebGPU, 1280x800 viewport)

| Scene | tier/renderScale | internal px | frame median | p95 | fps |
| --- | --- | --- | --- | --- | --- |
| Atlas black-hole | low / 0.6 | 600x480 | 41.7 ms | 55.8 ms | ~24 |
| Atlas neutron-star | low / 0.6 | 600x480 | 7.0 ms | 7.1 ms | ~143 |
| Atlas diagnostic | low / 0.6 | 600x480 | 7.0 ms | 7.1 ms | ~143 |
| hyperspace early frames | low / 0.6 | — | 7.0 ms | 7.0 ms | — |

Black-hole cost is the honest geodesic workload at tier low (256-step
budget); optimization is explicitly deferred. No structural catastrophes
(no second loop, no per-frame recompiles/targets, nested half-res volume
render unused by destinations yet).

## Quality-gate status

- Gate A Repository health: PASS (see commands).
- Gate B Browser health: PASS (13/13 browser tests, hardware WebGPU +
  forced-webgl2 root route).
- Gate C Physics correctness: PARTIAL PASS — classifications and orderings
  validated as above; numeric corpus deferred.
- Gate D Visual correctness: PARTIAL — deterministic screenshots captured
  (artifacts/validate-bh-5.png, validate-ns-2.png, uncommitted); no golden
  framework yet.
- Gate E Performance: baseline recorded (table above).
- Gate F Compatibility: hardware WebGPU + webgl2 root fallback PASS;
  atlas-on-webgl2 DEFERRED_ENVIRONMENT/debt.
- Gate G Release: N/A.

## Next actions

1. Dedicated service runtime harness (ParticleService compute path,
   VolumeService full/half-res march + disposal) — Phase 15 leftovers.
2. CPU/GPU numeric corpus for the integrator using the existing ray-parity
   browser harness pattern (selected-ray classification/min-radius parity).
3. Make the atlas integrator WebGL2-safe (replace remaining flat and()/or())
   and add an atlas-forced-webgl2 spec.
4. Governor auto-tier hysteresis review (stuck at low during probes).
5. THEN new-feature campaigns (Stellar Explosion, LUT/M8, Kerr).
