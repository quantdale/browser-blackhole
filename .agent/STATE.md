# Durable project state

Last planning update: 2026-08-21 (M0 checkpoint)

## Current phase

**M0 IMPLEMENTATION COMPLETE — checkpoint committed; M1 not started.**

M0 work packets M0-01 through M0-09 are implemented and gated. M0-10 evidence is
recorded here; the M0 completion rule (below) is satisfied in the local
supported environment. Kerr/physics milestones remain untouched.

## Locked architectural direction

- Browser-first interactive relativistic black-hole renderer.
- TypeScript + Vite + Three.js.
- Three.js `WebGPURenderer` and TSL as primary rendering stack.
- Full-screen GPU ray rendering; Three.js is not used to fake lensing with geometry.
- Schwarzschild first, Kerr later.
- Numerical Schwarzschild integration is the first correctness renderer.
- Precomputed/LUT Schwarzschild rendering is a later optimization backend, not the starting point.
- Fragment/full-screen rendering is the primary ray path; compute is introduced only where it improves the algorithm.
- CPU/reference solver is double-precision validation/precomputation, not main image rendering.
- Schwarzschild production/reference conventions are specified in `docs/NUMERICAL_METHODS.md`.
- Canonical state/invalidation and GPU contracts are specified before UI implementation.
- Scientific controls and cinematic/rendering controls remain separate.
- Auto quality, DPR caps, telemetry, dynamic resolution, and temporal refinement are first-class features.
- Numerical failures remain explicit and are never merged into the physical shadow.
- External code/assets/data require provenance/license review.

## Completed packets / backlog IDs

- `M0-01` — exact toolchain versions pinned, lockfile created (commit `6e65596`).
- `M0-02` — strict Vite/TypeScript source skeleton (`src/app`, `src/camera`, `src/renderer`, `src/shaders`, `src/ui`).
- `M0-03` — capability snapshot + backend decision + truthful actual-backend readback (`src/app/capability.ts`, `src/renderer/BlackHoleRenderer.ts`).
- `M0-04` — deterministic full-screen diagnostic TSL pass with CPU-mirrored ray contract (`src/shaders/diagnostic.ts`, `src/shaders/cameraRayMath.ts`).
- `M0-05` — camera abstraction: PerspectiveCamera + OrbitControls + canonical basis export (`src/camera/CameraController.ts`).
- `M0-06` — resize/internal-resolution/DPR policy hook (`src/renderer/ResizeController.ts`, `src/renderer/renderSize.ts`).
- `M0-07` — schema-v1 canonical state, presets, invalidation classification (`src/app/state.ts`, `src/app/presets.ts`).
- `M0-08` — Vitest + Playwright + npm scripts + GitHub Actions CI baseline (`.github/workflows/ci.yml`, `tests/unit`, `tests/browser`).
- `M0-09` — visible initialization/unsupported/error UX + status/control panels (`src/ui/statusPanel.ts`, `src/ui/controlPanel.ts`, `src/app/runtimeStatus.ts`).
- `M0-10` — this STATE.md update, recorded commands/results/environment, screenshot artifact.
  Checkpoint commit for M0-02..M0-09 implementation: `fa96e769c829bf0dc3d3ff67ef54f9b40dafaa39`.

## Exact commands and results (this cycle)

| Command | Result |
| --- | --- |
| `npm run check` (format:check → lint → tsc --noEmit → vitest run → build) | PASS (40/40 unit tests, clean build) |
| `npm run e2e` (Playwright, 3 smoke tests) | 3 passed (~13 s) |

Browser smoke coverage: boot to ready/fallback with valid canvas + clean console;
camera drag/wheel without uncaught errors while rendering continues; portrait/
landscape resize keeps aspect within tolerance without errors.

## Environment actually tested

- OS: Windows (local workstation), Node v22.23.2.
- Browser: Microsoft Edge 151.0.4129.93, headless, via Playwright channel `msedge`.
- Backend: WebGPU active (adapter via Dawn); WebGL2 fallback path compiled but not exercised in this environment.
- Internal render size at 1280×800 viewport: 1000 × 800 (DPR 1).

## Artifacts

- `artifacts/m0-diagnostic.png` — deterministic diagnostic gradient frame
  (red increases left→right, green increases toward top, blue encodes camera-ray
  depth axis), captured by the boot smoke test.

## Bugs found and fixed this cycle

1. **Empty-scene render (root cause of all-black frames):**
   `BlackHoleRenderer.init()` re-added `pass.mesh` to a second renderer-owned
   `Scene`; three.js objects have exactly one parent, so the mesh was silently
   detached from `pass.scene` and every frame rendered an empty scene (clear
   color). Symptom: "Ready" status, ~149 FPS, zero console errors, uniform black
   screenshots. Fix: removed the redundant scene; only `pass.scene` is rendered.
2. **Dead status wiring:** `controlPanel.update()` existed but was never
   subscribed, so Backend/Internal-size readouts stayed at "—". Fix: App
   subscribes panel readouts to `StatusStore`.

## Quality-gate status

- Gate A Repository health: PASS (`npm run check` locally).
- Gate B Browser health: PASS (3/3 Playwright smokes, WebGPU backend).
- Gate C Physics correctness: NOT YET APPLICABLE until M2.
- Gate D Visual correctness: diagnostic-gradient assertions pass; physics visuals N/A until M1+.
- Gate E Performance: budgets defined; no benchmark run yet (renderer exists as of this cycle).
- Gate F Compatibility: PARTIAL — local Edge/Windows verified; CI matrix pending first GitHub Actions run.
- Gate G Release: NOT YET APPLICABLE.

## Known limitations / debt

- LOW: WebGL2 fallback (`forceWebGL`) path is implemented but never exercised
  end-to-end here because WebGPU is always available locally; needs a forced
  fallback test hook or CI runner without WebGPU.
- LOW: FPS EMA first-sample assumes 16.7 ms, so the first reported value spikes;
  cosmetic only.
- LOW: CI workflow (.github/workflows/ci.yml) has not yet run on GitHub; Gate F
  stays PARTIAL until observed green.
- INFO: branch is ahead of `origin/main`; push intentionally deferred pending
  user confirmation.

## Deferred environment gates

- GitHub Actions CI execution (Gate F).
- A WebGPU-less environment run to prove the terminal unsupported UX.

## Next actions

1. Push `main` / open PR after user confirmation, then verify GitHub Actions CI green.
2. Add a forced-fallback test path (e.g., env/test hook that decides `webgl2`)
   to exercise the WebGL2 backend and unsupported UX under automation.
3. Start M1-01 camera-ray reconstruction: unit tests for center/corners/edges,
   odd/even resolutions, portrait/landscape, plus CPU-vs-GPU selected-pixel parity.
4. Record a first performance baseline (CPU frame time, internal dimensions) per
   docs/PERFORMANCE.md once M1 rendering lands.

## Completion rule for M0 (satisfied)

A clean checkout can install exact dependencies, run deterministic quality
commands, build, launch, render the deterministic diagnostic scene, operate
camera/resize safely, expose actual backend status, and pass browser smoke in
the available supported target environment without uncaught errors — verified
this cycle on Windows/Edge-headless/WebGPU.
