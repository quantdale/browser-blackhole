# Implementation notes — M12-NS

Working notes for the executor; evidence-first. Updated as tasks complete.

## 1.x Baseline and contract freeze (evidence)

- 1.1 Baseline environment (recorded 2026-08-26):
  - planning-base HEAD after pull: `2bc55082c692d4ea01dd856455ed1fdda066de33`
  - Node v22.23.2, npm 10.9.8, Windows 11 (10.0.26200)
  - Playwright browser: system Microsoft Edge (`msedge`) headless channel, hardware WebGPU
    (`amd rdna-2` class), WebGL2 fallback verified through forced-backend suites.
- 1.2 `npm ci` PASS (144 packages, 0 vulnerabilities); `npm run check` PASS
  (prettier clean; eslint clean; tsc clean; vitest **476/476** in 32 files; vite build PASS).
  No pre-existing failures to classify.
- 1.3/1.4 Pre-change browser baseline (one invocation,
  `E2E_PORT=4199 npx playwright test visual-goldens ray-parity integrator-parity --workers=2`):
  **45/45 PASS** —
  - visual goldens 41 rows incl. `NS_SURFACE`, `NS_PULSAR`, `NS_MAGNETAR` (pre-change NS imagery
    = straight-line direct-emission sphere) and every Black Hole/Kerr/observer/LUT-family row;
  - `ray-parity` 1/1; `integrator-parity` 4/4 (webgpu+webgl2 × numerical+lut).
  These are the regression anchors for the black-hole non-regression gate (§6) and the
  expected-to-fail pre-update state of the three NS goldens after the physics change lands.

## Architecture decision (task 1.5)

**Architecture B — neutron-star destination wrapper over existing canonical primitives.**

Reasons (against A "shared event-capable core refactor"):

1. The production GPU loop lives in
   `src/phenomena/black-hole/schwarzschildIntegrator.ts::createLensingMaterial` — a mature,
   validated path whose event policy (capture band, disk crossing, coordinate-stall capture),
   WebGL2 flat-gate idioms, tier budget plumbing and 41 twice-stable golden baselines are locked.
   Extracting a shared core would edit that file; design.md §9 makes any resulting black-hole
   parity/golden drift a blocker. No independently proven defect justifies that risk.
2. Sharing already exists at the correct level:
   - CPU: the canonical RK4/Hamiltonian primitives `planeDerivatives`, `rk4PlaneStep`,
     `stepSizeAt` are EXPORTED from `cpuReference.ts` (M8-03) exactly for reuse; the plane
     reduction/event discipline is documented in NUMERICAL_METHODS §3/§9/§10 and mirrored from
     `src/physics/schwarzschild.ts`.
   - GPU: SHADER_CONTRACTS §5–6 mandate formulation-for-formulation mirroring with stable
     classification codes imported verbatim — a second consumer of the same documented
     convention, not a fork of it.
3. The neutron-star event policy differs fundamentally (opaque material surface terminates the
   ray before horizon/capture logic can ever bind; single-hit shading, no additive disk
   accumulation). Destination-local termination policy inside a small dedicated wrapper is the
   narrower seam.

Concretely:

- `src/phenomena/neutron-star/surfaceRayReference.ts` — pure TypeScript (no `three`), binary64
  reference surface-ray layer importing ONLY the exported canonical primitives above plus local
  plane reduction following `rayInitialStateFromWorld` semantics. NS-local classification union
  `surface-hit | escaped | numerical-failure | invalid-initial-state`; black-hole codes 0..6
  untouched and never renumbered.
- `src/phenomena/neutron-star/surfaceLensingGpu.ts` — TSL fullscreen-triangle material mirroring
  the Schwarzschild integrator structure (same tetrad init, same §9 step policy, same §14 guards,
  same 24-iteration linear-interpolation bisection used by the validated disk-crossing
  refinement) with the NS event policy: first segment bracketing `R_rg` refines to the hit and
  terminates; escape samples the pinned starfield collaborator; failure renders explicit magenta.
- `neutronStarModule.ts` swaps the direct-emission sphere mesh for the pass (field lines stay as
  overlays; render order/depth handling documented at the change site).

## Ultra-compact regime decision (task 1.6)

Control range: sanitizer allows `R` down to `max(8 km, 2 r_g (1 + 1e-3))` with mass up to
3 M_sun ⇒ `R_rg` can reach ≈ 2.003 — i.e. user controls DO expose `2 r_g < R_rg <= 3 r_g`.

Decision: **the numerical integrator supports the full sanctioned range** (option 1 of design.md
§6). Surface-crossing termination is radius-event based and valid for any `R_rg > 2 + margin`;
rays winding near the photon sphere simply consume more steps and terminate on hit/escape/failure
explicitly. Representative multiple-image behavior is covered by a reference test (a just-above-
limb ray wrapping behind the star still terminates `surface-hit` on the far side). The analytic
apparent-limb validation `b_limb = R/sqrt(1 - 2 r_g/R)` is stated and tested ONLY in its regime
of validity `R_rg > 3`. No input clamping is added. Documentation discloses that near-critical
ultra-compact configurations increase step-budget exhaustion (visible, truthful failure pixels),
never silently truncated imagery.

## Units contract (change site)

The destination scene unit is 1 km; the geodesic stack is r_g-native. The module converts once
per frame: camera position km→r_g via `rgKm = gravitationalRadiusKm(massSolar)`;
`surfaceRadiusRg = radiusKm / rgKm`. Hit normals/spot directions are unit vectors (unit-free).
Redshift factor stays `g = sqrt(1 - 2 r_g/R)` computed by the existing physics helper.

## Closure evidence (2026-08-26, final)

- CPU/reference: `src/phenomena/neutron-star/surfaceRayReference.ts` (binary64 oracle, NS codes 11..14; imports `rk4PlaneStep`/`stepSizeAt` from `cpuReference.ts`; analytic limb `b_limb = R/sqrt(1-2r_g/R)` tested R>3 r_g; ultra-compact far-side multiple-image test; deterministic repeats + budget/invalid cases).
- GPU: `src/phenomena/neutron-star/surfaceLensingGpu.ts` (TSL fullscreen pass mirroring `schwarzschildIntegrator.ts`; parity debug encoding `hitNormal*0.5+0.5` / `escapeDir*0.5+0.5`; exports `createNeutronStarSurfaceMaterial`, `nsQualityTierStepBudget`, `NS_RAY_*` codes).
- Rewire: `neutronStarModule.ts` removed direct-emission sphere mesh + color graph; added surface pass (renderOrder -10, depthTest/Write false), per-frame km→r_g camera uniform, debug snapshot surface-ray fields, field-line hide on `?nssurfacedebug=1`.
- Tests: `tests/unit/neutronStarSurfaceRay.test.ts` + `tests/unit/neutronStarPhysics.test.ts` (28 unit tests); `tests/browser/neutron-star.spec.ts` (8 tests, **8/8 PASS**, parity corpus on webgpu+webgl2 incl. center/near-limb hit, near-limb escape, off-axis, high-deflection, failure-color detector).
- `npm run check`: **PASS** (format/lint/typecheck clean; **504 unit tests**; vite build green).
- Black-hole non-regression gate: `integrator-parity` 4/4 + `ray-parity` 1/1 (webgpu+webgl2) **PASS**; shared `schwarzschildIntegrator.ts`/`cpuReference.ts` untouched; Black Hole/Kerr/observer goldens unchanged.
- Visual goldens: regenerated ONLY `NS_SURFACE`, `NS_PULSAR`, `NS_MAGNETAR` via `UPDATE_GOLDENS=1`; full `visual-goldens` suite **40/40 PASS** (run on `E2E_PORT=4199`). Note: a run on default `E2E_PORT=4173` produced an `ERR_CONNECTION_REFUSED` on `CM_REMNANT` only — a port-collision flake (Phase B item: default 4173 collides with a running instance), NOT a golden drift. Re-run on 4199 was clean.
- Benchmark: `scripts/bench-neutron-star.mjs` added (+`bench:neutron-star` package script). Smoke run (`--preset=surface --quality=medium`): backend webgpu, adapter amd rdna-2, frameCpuMs median 20.9 ms, frameGpuMs 19.01 ms (hardware timestamp queries), consoleErrors 0, destination GPU bytes ~149 KB. Paused at phase 0 so the number isolates the surface-ray pass.
- Known limitations (disclosed, not silently weakened): Doppler/aberration from rotating surface, Hartle-Thorne frame dragging, atmosphere/radiative transfer, oblate figure, interior metric/time-of-flight all omitted. Static `g = sqrt(1-2r_g/R)` redshift only. Ultra-compact `R_rg<=3` increases step-budget exhaustion (truthful magenta failure pixels), no input clamping.
- Docs truthfulness: README Neutron Star row now DIRECT with disclosed omissions; PHENOMENA_IMPLEMENTATION §2 implementation-status block; SCIENTIFIC_FIDELITY §6 M12-NS status; BENCHMARK_MATRIX NS-01/NS-02 linked to `bench:neutron-star`.

Phase A is complete and unblocks M12-RI (Phase B).
