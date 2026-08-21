# Durable project state

Last planning update: 2026-08-22 (implementation campaign: branch consolidation + mass code waves)

## Current phase

**M0/M1 groundwork COMPLETE AND PUSHED. Cosmic Atlas merged and WIRED. Campaign
status: single-branch `main`; M2 GPU geodesics, M3 geometry, M4 disk emission,
CA0 host shell, CA1 transition system, CA2 shared services, and neutron-star
foundations all implemented as CODE. Testing/benchmarking/validation
deliberately DEFERRED to a later campaign.**

## Branch consolidation (this campaign)

- `origin/research/cosmic-atlas-phenomena` was fetched, inspected (4 commits,
  ~16k insertions: docs/cosmic-atlas/** planning plus dormant library code in
  src/atlas/**, src/renderer/shared/**, SharedRendererKernel, capabilities,
  cpuReference, validationVectors), then merged into `main` as `111e886`
  (`git merge --no-ff -X ours`) so current main implementation won shared-root
  conflicts while all atlas docs/code were added.
- Remote branch deleted after merge; `git fetch --all --prune` run. Final
  topology: local = `main` only; remote = `origin/main` only (+ symbolic
  `origin/HEAD`). No work was discarded; uncommitted M1 WIP in the worktree
  was committed FIRST (`e334439`) before merging.

## Implemented this campaign (code only)

Black-hole roadmap:

- `src/physics/constants.ts`, `src/physics/schwarzschild.ts` — geometric-unit
  constants, static tetrad mapping (NUMERICAL_METHODS §2), plane-reduction ray
  initial state (§3), stable classification codes 0–6 (SHADER_CONTRACTS §6),
  RayTraceResult diagnostics shape (NM §19), reference trace wrapper over
  cpuReference (`e2cc733`).
- `src/shaders/starfieldGpu.ts` — TSL port of the deterministic cube-cell-hash
  starfield (bit-exact u32 hash path), environment composition entry point
  (`e39d141`).
- `src/phenomena/black-hole/schwarzschildIntegrator.ts` — full-screen-triangle
  NodeMaterial: camera-ray reconstruction, tetrad init, fixed-step RK4 planar
  Hamiltonian loop (tier-bounded 256/512/1024/2048), capture/escape/failure
  classification with explicit dim-magenta failure output, equatorial disk
  crossing detection + bisection refinement, lensed environment sampling
  (`c064ebb`).
- `src/phenomena/black-hole/accretionDisk.ts` — Shakura-Sunyaev temperature
  profile, emissivity with edge windows, Keplerian emitter Ω/u^t, Bardeen-form
  redshift g=1/(u^t(1−Ωb_z)), blackbody RGB approximation, TSL emission node
  with g³ beaming and seeded turbulence (`4b0572b`).
- Black-hole destination adapter upgraded to drive the real LensingService
  pass per frame (`3acdee2`); deterministic pass kept only as an honest
  fallback flagged via `lensingWired:false`.

Cosmic Atlas (CA0/CA1/CA2):

- `src/atlas/governor.ts` PerformanceGovernor (FPS EMA, tier hysteresis,
  activity modes, forced-tier override), `src/atlas/registry.ts`
  DestinationRegistry, `src/atlas/navigation.ts` NavigationController
  (generation counter, history integration), `src/atlas/host.ts`
  CosmicAtlasHost (HostServices assembly, TransitionDirector wiring, frame
  pump, debug inventory), destinations `diagnosticDestination.ts` +
  `blackHoleDestination.ts` (`988b02d`).
- Neutron Star destination foundations: `src/phenomena/neutron-star/physics.ts`
  (surface redshift, pulse geometry, dipole helpers, flare envelope),
  `presets.ts` (surface/pulsar/magnetar), `neutronStarModule.ts` (full
  PhenomenonModule: hot-spot emission graph, FieldLineService magnetosphere,
  deterministic rotation, flare machine) (`988b02d`).
- Host registry now registers neutron-star alongside black-hole/diagnostic;
  `src/app/atlasApp.ts` boots the atlas shell on `/atlas/*` routes from
  main.ts (legacy M0 app retained at root) (`3acdee2`).
- CA1 transition system (TransitionDirector + hyperspacePass) came in with the
  research branch merge and is wired through the host; debugInventory shape
  mismatch fixed during integration.
- Typing repairs across the merged-but-dormant atlas library (ParticleService,
  Ribbon/Trajectory services, hyperspacePass, SharedPost, ResourceManager,
  ResourceScope, TransitionDirector, types, routes) brought `tsc --noEmit` to
  ZERO errors repo-wide (`1a49b23`).

## Exact commands and results (this campaign)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS (0 errors) — verified repeatedly after each wave |
| `npx prettier --check .` / `--write .` | PASS (repo formatted) |
| `npx eslint .` | PASS (0 findings) |

Per the campaign directive, unit tests, Playwright, benchmarks, goldens, and
CI investigation were NOT executed this session; existing tests were neither
run nor deleted. Nothing here has browser-render evidence yet — the GPU paths
(schwarzschildIntegrator, starfieldGpu, accretionDisk emission node,
hyperspacePass) are static-checked but UNVALIDATED at runtime.

## Known limitations / debt

- Runtime validation of all new TSL graphs pending (next campaign's purpose).
- `HostServices.volumes` is served by the real VolumeService
  (src/renderer/shared/VolumeService.ts, CA2-05: bounded raymarch, half-res
  internal target, early termination, seeded jitter). Runtime-unvalidated like
  all other new TSL graphs.
- `backgroundEquirect` of LensingPassParams unused (procedural environment owns
  the sky until an equirect backend lands).
- SchwarzschildIntegrator has no GPU constraint-residual monitor (§6) —
  non-finite bounded-magnitude proxy covers the failure path.
- capabilities.ts vs app/capability.ts overlap and CameraRig vs
  CameraController duplication remain deliberate parallel paths pending a
  consolidation decision.
- STATE.md filename references to docs/PERFORMANCE.md actually resolve to
  docs/PERFORMANCE_BUDGETS.md (pre-existing stale pointer).

## Quality-gate status

- Gate A Repository health: PASS (format/lint/typecheck only).
- Gates B/C/D/E/F/G: NOT RUN this campaign by design (deferred).

## Next actions

1. Finish CA2: land VolumeService, wire into HostServices (replace fail-loud
   stub), confirm typecheck green, commit/push.
2. Next campaign (validation): run `npm run check`, fix runtime shader issues
   found by browser smoke, then rebuild the golden/e2e suites around the new
   passes.
3. Highest-value code targets after validation: M5 HDR/post UI sections on the
   atlas shell; LUT-backend groundwork (M8); stellar-explosion destination
   (CA4) reusing ParticleService+VolumeService.
