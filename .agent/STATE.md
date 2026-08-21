# Durable project state

Last planning update: 2026-08-21 (follow-up cycle pushed; CI green)

## Current phase

**M0 COMPLETE. Follow-up cycle (backend override + M1-01 groundwork) COMMITTED,
PUSHED, AND GREEN ON GITHUB ACTIONS. Next: M1-02 starfield.**

M0 packets M0-01..M0-09 are implemented, gated, and committed (`fa96e76`,
`61de188`). The follow-up cycle implemented the recorded next actions (forced-
fallback test path, M1-01 camera-ray parity groundwork), fixed one real shader
bug found by the new parity test, and is pushed as `48e28f1`, `c51bf31`,
`1fc44a7`. GitHub Actions CI run #2 passed on `1fc44a7` — first real Gate F
evidence. Kerr/physics milestones remain untouched.

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
- Follow-up (commit `48e28f1`): forced-backend override `?backend=webgpu|webgl2|unsupported`
  (`src/app/testHooks.ts`, `src/app/App.ts`, terminal-state test hooks,
  `tests/unit/backendOverride.test.ts`, two new smokes in `tests/browser/smoke.spec.ts`,
  `E2E_PORT` support in `playwright.config.ts`) — exercises WebGL2 fallback and
  unsupported UX on capable machines per docs/CI_CD.md §6.
- Follow-up (commit `c51bf31`): M1-01 groundwork — `pixelToNdc` shared pixel-center
  convention (`src/shaders/cameraRayMath.ts`), edge/corner/aspect/pixelToNdc unit
  cases (`tests/unit/camera.test.ts`), CPU-vs-GPU selected-pixel parity spec
  (`tests/browser/ray-parity.spec.ts`) with shared harness
  (`tests/browser/support/appHarness.ts`), and the diagnostic scalar-uniform fix.

## Exact commands and results (this cycle)

| Command | Result |
| --- | --- |
| `npm run check` (format:check → lint → tsc --noEmit → vitest run → build) | PASS (52/52 unit tests, clean build) — re-verified independently this cycle |
| `npm run e2e` (Playwright, 6 tests) | 6 passed (~47 s) via `E2E_PORT=4174 npm run e2e` — re-verified independently this cycle |

Browser coverage now additionally: forced `?backend=webgl2` renders the
diagnostic gradient; forced `?backend=unsupported` shows terminal unsupported
UX; M1-01 CPU-vs-GPU parity at 10 sampled NDC points within ±4/255 after sRGB
encoding (ran against the real WebGPU backend, not a fallback skip).

Local note: port 4173 is occupied by an unrelated dev server on this
workstation; e2e must run with `E2E_PORT=<free port>` until it is stopped.

Push and CI: `git push origin main` (`61de188..1fc44a7`) → GitHub Actions CI
run #2 (https://github.com/quantdale/browser-blackhole/actions/runs/32485658899)
on ubuntu-latest / bundled Chromium / SwiftShader: **success** — quality job and
browser job both green, including the forced-backend smokes and ray-parity.

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
3. **Scalar TSL uniforms snapshotted (found by the new M1-01 parity test):**
   `createDiagnosticPass` built scalar uniforms as
   `uniform(uniforms.tanHalfFovY.value)`, snapshotting the number `1`; per-frame
   writes to the block's `.value` never reached the shader, so the GPU rendered
   with `tanHalfFovY=1, aspect=1` regardless of camera. Fix: create uniform
   nodes first and expose the nodes themselves as block fields. Vector3
   uniforms were unaffected (passed by reference).

## Quality-gate status

- Gate A Repository health: PASS (`npm run check` locally).
- Gate B Browser health: PASS (6/6 Playwright tests incl. forced-webgl2,
  forced-unsupported, and M1-01 CPU-vs-GPU ray parity; WebGPU backend).
- Gate C Physics correctness: NOT YET APPLICABLE until M2.
- Gate D Visual correctness: diagnostic-gradient and CPU-vs-GPU parity
  assertions pass; physics visuals N/A until M1+.
- Gate E Performance: budgets defined; no benchmark run yet (renderer exists as of this cycle).
- Gate F Compatibility: PASS on first evidence — local Edge/Windows verified;
  GitHub Actions run #2 green on ubuntu-latest (bundled Chromium, SwiftShader
  WebGL2), including forced-backend and parity tests. Broader matrix still open.
- Gate G Release: NOT YET APPLICABLE.

## Known limitations / debt

- RESOLVED this cycle: WebGL2 fallback and unsupported UX are now exercisable
  end-to-end via the forced-backend override (`?backend=`) and covered by
  browser tests on the local WebGPU-capable machine.
- LOW: FPS EMA first-sample assumes 16.7 ms, so the first reported value spikes;
  cosmetic only.
- INFO: local workstation has a foreign dev server on port 4173; use
  `E2E_PORT` for local e2e runs.
- RESOLVED: SwiftShader tolerance risk from the pre-push CI audit did not
  materialize — run #2 passed the ±4/255 parity and zero-console-error
  assertions on ubuntu-latest. Revisit only if a future runner/dependency bump
  flakes.

## Deferred environment gates

- A real WebGPU-less environment run (the `?backend=unsupported` override
  covers the UX path, but a genuinely probe-less machine is stronger evidence).
- Broader browser/OS compatibility matrix beyond local Edge/Windows and
  ubuntu-latest Chromium.

## Next actions

1. Continue M1: deterministic procedural star/environment backend (M1-02),
   backend/debug overlay, first visual golden tests per docs/ROADMAP.md.
2. Record a first performance baseline (CPU frame time, internal dimensions) per
   docs/PERFORMANCE.md once M1 rendering lands.

## Completion rule for M0 (satisfied)

A clean checkout can install exact dependencies, run deterministic quality
commands, build, launch, render the deterministic diagnostic scene, operate
camera/resize safely, expose actual backend status, and pass browser smoke in
the available supported target environment without uncaught errors — verified
this cycle on Windows/Edge-headless/WebGPU.
