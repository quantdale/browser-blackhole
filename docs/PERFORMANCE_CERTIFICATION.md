# Whole-Atlas Performance Certification

Status: **IN PROGRESS — final certification run in this session.**
Campaign: `openspec/changes/whole-atlas-performance-optimization/`
Starting SHA (this campaign session): `bed06ab` → current `c334420` + pending
final-gate commits.

This document is the campaign's §24 artifact. It records what was optimized,
the matched before/after evidence, the checks that passed on this machine, and
the items that were explicitly rejected or deferred. It never claims a timing
number whose measurement conditions are not stated.

---

## 1. Environment

| Item | Value |
| --- | --- |
| Machine | Windows 11 (local capable runner) |
| Node / npm | v24.3.0 / 11.4.2 |
| Browser (browser gates) | Playwright Chromium 151 headed, `PLAYWRIGHT_BROWSER_CHANNEL=chromium` |
| Fallback browser gate | Firefox (WebGL2 fallback), Playwright project `firefox` |
| GPU adapter (headed) | `nvidia lovelace` (NVIDIA GeForce RTX 4050 Laptop GPU) |
| GPU adapter (headless CI-like) | SwiftShader (software) |
| Backends | WebGPU primary; forced `?backend=webgl2` fallback on the same adapter |
| Viewport | 1280×800 CSS, DPR 1; governed internal sizes (e.g. High 973×727) |
| Timestamp queries | `timestampQuery: true` on the hardware adapter |

CPU rAF deltas on this host floor at the compositor interval (~16.7 ms), so CPU
timings are informative only for expensive scenes. GPU timestamp values are the
reference where available; they are labelled as such.

## 2. Invariants preserved

- Scientific/reference/parity tolerances were not weakened.
- Golden baselines were not regenerated.
- WebGPU stayed preferred; the forced-WebGL2 path stayed functional.
- One renderer ownership authority, ResourceScope lifecycle discipline, and
  one global governor/work-budget authority were preserved.
- DATA_DRIVEN semantics for Black-Hole Merger / Galaxy Collision and
  PROCEDURAL_SCIENTIFIC models are unchanged.
- No runtime network scientific-data dependency was introduced.

## 3. Workstreams and evidence

### WS0 — measurement foundation (tasks.md §0/§1)

- Typed runtime telemetry in `debugInventory().runtime`: drawing-buffer size
  (floor-matched to `canvas.width`), transition phase/occlusion, live volume
  march config, particle population/activity, active lensing pass kind and the
  LIVE `uniforms.maxSteps` budget. Compute timestamp pool resolved async on the
  existing bounded cadence (`gpuComputeMs`).
- New scenario harness `scripts/bench-scenarios.mjs` records, per destination
  and backend: cold/warm navigation, stationary IDLE (rAF-counted zero-render
  proof) and COST (forced continuous render), active timeline, camera
  interaction, settling, transition out/in, and a low/medium/high/ultra ladder.
- Evidence: unit tests (`frameTelemetry`, service aggregates) and browser
  `frame-invalidation` runtime rows; see §4 for the matrix.

### WS1 — frame invalidation / on-demand rendering (tasks.md §2)

- Implementation predates this session and is now fully evidenced: a paused,
  settled scene issues zero orchestrated frames across 30 rAF ticks, measured
  against an independently patched `kernel.renderFrame` counter; every
  reason (control/resize/quality/visibility/destination) wakes at least one
  frame and returns to sleep. `frame-invalidation.spec.ts` 13/13.
- The scenario matrix records `renderFrameCalls: 0` for the stationary idle
  window on all 16 destination × backend combinations (table in §4).

### WS2 — visibility lifecycle (tasks.md §3)

- Hidden documents stop the only non-rAF timer (deep-link control poller) and
  freeze hidden time explicitly (`TimeController.markHidden`); resume advances
  by exactly one ordinary frame dt, re-seeds governor timing
  (`PerformanceGovernor.resetTiming`) and issues a one-shot render wake.
- Evidence: `timeController` (4 new), `governor` (3 new) unit tests; browser
  hide/resume row with a real `document.hidden` override.

### WS3 — transition occlusion and warmup (tasks.md §4)

- Destination DRAW is suppressed only in the mathematically opaque hyperspace
  phase; `destination.update()` still advances lifecycle state.
- Draw-count assertion: the suppressed frame disables `renderer.info.autoReset`
  and accumulates counts across passes; it draws strictly fewer calls than the
  same scene drawn normally.
- **Rejected on evidence:** the `compileAsync` occlusion warmup was implemented
  and then REMOVED. three's `compileAsync` re-creates node-material pipelines
  with a different first-render result: with it enabled, `golden: GC_ENCOUNTER`
  failed (meanAbsDelta 3.89, 5.2% pixels beyond threshold; the nuclei
  sprite/halo compositing changed). Removing only the warmup restored the
  baseline exactly (meanAbsDelta 0.145, 0 beyond threshold) while keeping the
  draw suppression. The warmup is not shipped.

### WS4 — startup/code splitting (tasks.md §5)

- Landed in the prior session; unchanged here. Destination code in a boot graph
  164,588 → 37,315 decoded bytes (−77.3%); total boot JS −8.8%.
  Reserved for timing: first-interactive timing is `DEFERRED_ENVIRONMENT`.

### WS4b — black-hole active-pass lifecycle (tasks.md §6)

- The eager numerical + LUT + Kerr tuple is gone. `BlackHoleModule` resolves
  the single arrival pass, creates it lazily in a per-pass child
  ResourceScope, keeps a bounded two-entry resident cache, and swaps activation
  atomically. A failed alternate keeps the visible pass with
  `alternate-pass-creation-failed`.
- Resident pass count on a default (LUT) arrival: **3 → 1** (browser
  `trajectory-backend` row asserts kinds/count; switch-back reuses the cached
  alternate instead of creating a third).
- BH/KERR/observer goldens: **10/10 PASS unchanged** (see §5).
- **Finding (contained):** the LUT material renders a black frame under forced
  WebGL2 on this ANGLE/nvidia stack even with a core-filterable RGBA16F
  family. It was isolated by rendering the LUT pass ALONE in both the
  pre-lifecycle and lifecycle builds (black in both); the pre-lifecycle eager
  scene had masked it. LUT acceleration is now WebGPU-only
  (`lut-webgl2-unsupported`); forced WebGL2 boots the numerical reference and
  the `atlas-webgl2` rows pass with live non-uniform frames.

### WS5 — VolumeService (tasks.md §7)

- Runtime active-step budget with a compile-time loop bound plus a uniform
  guard; `dt = span / activeSteps` over the analytic ray interval; early-alpha
  `Break` preserved; `rendererSizeScratch` reused.
- Conservative frustum culling enabled on the visible proxy (authored bounding
  sphere; camera-inside kept). Unit tests pin off-frustum cull, intersecting
  keep, and inside-camera keep.
- Tier evidence: one TDE volume records `activeSteps` 97 (high) vs 55 (low) for
  `baseMaxSteps` 110; an invisible phase-gated volume records
  `visibleVolumes: 0`, `internalWidth: 0` (no march executed).
- Projected scissor/ROI: rejected (recorded in `tasks.md`).

### WS6 — particles, ribbons, dynamic buffers (tasks.md §8/§9)

- Particle CPU fallback advances only the active prefix and uploads partial
  attribute ranges; growth respawns the newly drawn tail deterministically.
  Static systems never upload after initialization; zero population never
  simulates. AGN host/knot systems are static with one population-scale writer.
- Ribbon/strand `setSpine` early-outs on a value-identical spine (no rebuild,
  no upload) and maintains conservative rebuild-time bounds; culling enabled.
  Unit tests assert `BufferAttribute.version` stability and bounding
  containment.

### WS7 — SharedPost / Governor (tasks.md §10/§11)

- `bloomResolutionScale` plumbing applies per frame (live 0.65); the
  highlight-source pass is separately timed while the blur/composite is fused
  into the single presentation pass (recorded limitation).
- Governor hysteresis, startup-grace spike rejection, settled recovery and
  visibility resume reset are pinned by unit tests; a new tier-churn torture
  test covers rapid forced pins. GPU-vs-CPU overload classification is
  explicitly rejected for lack of a validated model.

### WS8/WS9 — backend-specific (tasks.md §12–§21)

- Black-hole merger creates the Kerr remnant lazily (inspiral=false →
  merger=true → remnant=true) and prewarms the hidden pipeline during the
  merger flash.
- The remaining numerical research rows (adaptive Kerr integration, step
  censuses beyond the terminal-class census, tile classifiers, scissor ROI,
  AGN zone lazy build) are recorded per-row in `tasks.md` with their status and
  reason; no unvalidated optimization was shipped.

## 4. Scenario matrix (tasks.md §0)

Artifact: `benchmarks/results/2026-09-10-scenarios/matrix.json`
Schema 2, commit `68aaab9`, headed Chromium, `nvidia lovelace`, 1280×800.
16 records (8 destinations × WebGPU + forced WebGL2), **0 failures**, every
sampled window carrying `renderTelemetry` with a zero-render refusal.

Navigation (wall ms, CPU-side; not a GPU claim):

| Destination | cold WebGPU | warm WebGPU | cold WebGL2 | warm WebGL2 |
| --- | ---: | ---: | ---: | ---: |
| black-hole | 3285 | 2376 | 27430 | 2416 |
| neutron-star | 2745 | 2361 | 2502 | 2443 |
| stellar-explosion | 2769 | 2380 | 2662 | 2416 |
| compact-merger | 2993 | 2387 | 2934 | 2426 |
| tidal-disruption | 3051 | 2373 | 2840 | 2523 |
| quasar-agn | 4558 | 3204 | 7142 | 4931 |
| black-hole-merger | 2987 | 2363 | 2712 | 2434 |
| galaxy-collision | 2710 | 2362 | 2977 | 2432 |

Observations:

- **Idle work elimination**: `renderFrameCalls: 0` for the paused, settled idle
  window on every one of the 16 rows (30 rAF ticks each).
- CPU frame medians are all 16.7 ms — the compositor floor. GPU-reference
  per-frame values (forced continuous render, harness default tier) are
  0.59–5.31 ms on WebGPU and 8.29–12.05 ms on forced WebGL2 on this adapter.
- The one outlier is the first WebGPU→WebGL2 cold boot of black-hole
  (27.4 s): the first ANGLE/WebGL2 pipeline for the numerical Schwarzschild
  pass; warm revisits are ~2.4 s. It is a cold-compile cost, not steady state.
- One record carries an empty adapter name (`quasar-agn` webgl2): the async
  adapter-name probe had not resolved at record time. Backend identity is still
  recorded; noted rather than hidden.

## 5. Golden and reference gates

- BH/KERR/observer scientific goldens: **10/10 PASS unchanged** after the
  active-pass refactor (`ATLAS_DIAGNOSTIC`, `BH_CLASSIC`,
  `ATLAS_HYPERSPACE_BH_NS`, `KERR_ZERO_SPIN/HIGH_PROGRADE/RETROGRADE`,
  `OBSERVER_CIRCULAR/FLYBY/FREEFALL`, `KERR_CIRCULAR_OBSERVER`).
- Full scientific golden suite (43 rows) twice: **_PENDING this session_**.
- Cinematic golden suite (8 rows) twice: **_PENDING this session_**.
- LUT parity / integrator parity / ray parity / Kerr census: **_PENDING this
  session_** (last certified at `17c4644`).

## 6. Deferred and rejected (recorded, not hidden)

| Item | Status | Reason |
| --- | --- | --- |
| First-interactive timing | DEFERRED_ENVIRONMENT | Browser timing on this machine is not deterministic; byte counts are. |
| Per-pass GPU attribution beyond the two three.js pools | Rejected | Public `resolveTimestampsAsync` exposes only `render`/`compute`. |
| Hyperspace lower resolution scale | Rejected | Acceptance requires perceptual captures across target displays; not certifiable here, and the effect only runs in the already-suppressed window. |
| Projected scissor/ROI for volumes | Rejected | Needs a projected-AABB pass + viewport save/restore while the composite still reads full-screen UV; no measured decision justifies it. |
| Separate bloom blur/composite timing | Rejected | Fused into the single presentation pass; splitting adds a pass purely for instrumentation. |
| GPU-vs-CPU overload classification | Rejected | `gpuFrameMs` resolves on a bounded async cadence; no validated per-frame model, and a second decision path risks churn. |
| Kerr adaptive integration / constants-of-motion / tile classifier | Not attempted | Requires an equal-error parity study with the reference corpus; shipping without it violates the campaign's parity rule. |
| Schwarzschild GPU step census | Not attempted | The CPU reference + ray-parity corpus bound classification; duplicating the Kerr status view was not justified. |
| AGN zone lazy build / disposal policy | Not attempted | No memory evidence that all-zone residency is a problem; zone switch latency would be spent instead. |
| WebKit / real-device validation | DEFERRED_ENVIRONMENT | Not available on this runner. |

## 7. Reproduction

```bash
# deterministic quality gate
npm run check

# scenario matrix (all destinations, both backends)
node scripts/bench-scenarios.mjs --backends=webgpu,webgl2 \
  --channel=chromium --headed=1 --port=4620 \
  --out=benchmarks/results/<date>-scenarios/matrix.json

# focused browser gates (headed, hardware)
E2E_PORT=4299 PLAYWRIGHT_BROWSER_CHANNEL=chromium \
  npx playwright test tests/browser/frame-invalidation.spec.ts --project=default --headed
```

## 8. Residual risk

- The scenario matrix is a baseline of transition/navigation/steady-state work,
  not a cross-machine performance claim; adapters and refresh rates differ.
- Golden coverage is exact for the committed baselines; tolerance-based rows
  remain tolerance-based (documented in `docs/cosmic-atlas/GOLDEN_IMAGES.md`).
- The TDE idle defect fixed here (unconditional `CameraRig` dirtying) is the
  class of issue the scenario matrix exists to catch; any new destination that
  re-asserts system framing every frame will be caught by the idle rows.
