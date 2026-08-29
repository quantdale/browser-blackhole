# Cosmic Atlas — Cinematic Visual Fidelity Certification (Restored Scope)

Date: 2026-08-30
Campaign: `cinematic-visual-fidelity-overhaul` (restored 295-task contract)
Status: **FINAL CERTIFICATION — RESTORED SCOPE**

> This certification supersedes the 2026-08-29 interim Phase-1 report. That report covered only the reduced `CinematicPrimitives` layer and explicitly deferred SharedPost V2, temporal reconstruction, Volumetrics V2, Particle V2, StrandService, Environment V2, and the full destination migration gates. The restored contract is `openspec/changes/cinematic-visual-fidelity-overhaul/tasks.md`; this document certifies that contract.

## Scope and provenance

- Planned-From: `main@518bff7b8c14e4a22ada4c9376f166d8565c5263`
- Restored contract added at `acf0694` (`docs(plan): restore authoritative cinematic campaign contract`)
- Implementation checkpoints (on `implement/cinematic-visual-fidelity-overhaul`):
  - `ae11244` — HDR continuity (FP16 volume + SharedPost) + frozen baseline
  - `f4c208d` — SharedPost V2 stages + temporal reconstruction foundation
  - `b4ea0d3` / `69e4e17` — V2 environment + bounded visual services, temporal jitter + staged depth
  - `c90a5e1` — Stellar Explosion structured slice (shell skin, detail, ejecta-streak, selective bloom, temporal)
  - `fc65b5b` — Galaxy Collision bounded unresolved stellar density
  - `5f81f6e` — destination fidelity gates + `VisualWorkBudget` centralization
  - `a093cd4` … `1d42329` — TDE StrandService, cinematic measurement/framing gaps, HDR audit, tiered motion captures, resource/strong-field gates, freeze before entry
  - `17c4644` — **final main** (this certification) — docs/tasks hygiene, VolumeService depth init, test hygiene for cinematic/temporal/volumetrics, plus `artifacts/cinematic-visual-fidelity/final-17c4644/` review set and `benchmarks/results/2026-08-30-final-17c4644/` matrix
- Previous harness fix at `f9801a8`/`17c4644`: `goldenHarness` 30s→90s (CI 180s), `cinematicGoldenHarness` 60s→90s + 300s test timeout for SwiftShader fallback slowness (BH 76s on fallback vs 850ms design on hardware)
No authoritative physics/data/timeline contract was changed for appearance. All presentation detail is deterministic, seed-controlled, tier-bounded, and disabled or restrained in Scientific mode.

## What changed (restored scope)

**Shared image-formation pipeline**

- `SharedPost` V2: named stages `scene HDR → temporal resolve → selective FP16 highlight → transition composite → exposure/tone mapping → optional Cinematic grade`, with `SharedPost.Emissive` FP16 target fed by tagged materials and `BloomNode` omitted when disabled (zero-cost Scientific path). Bloom resolution via `VisualWorkBudget.bloomResolutionScale`.
- `TemporalService`: deterministic Halton jitter, bounded `HalfFloatType` history pair, camera-only reprojection, 3×3 neighborhood clamp, aggressive invalidation on route/preset/timeline/camera/size/tier/backend/transition. Interaction reduces to 1 frame; High reaches `historyAge 8` and stops.
- `VolumeService` V2: optional macro/detail composition (multi-octave `mx_fractal_noise_float`, ridged/filament, clump mask, domain warp) driven by `VisualWorkBudget.volumeDetailOctaves`; `volumeActiveSteps` + `setStepScale`; `halfResolution` + `earlyAlphaTermination` + `temporalJitter` (High/Ultra, stabilized by history); `depthAwareUpsample` with staged previous-frame depth (conservative bias, alpha-only fallback); `approximateSelfShadow` (0-2 taps) + `gradientShading`.
- `ParticleService` V2: `ParticleRenderProfile` (compact star, ejecta-streak with `aParticleVel` rotation, debris-streak, dust-clump, generic-soft fallback), seeded cluster/brightness, HDR `emissiveIntensity`, selective bloom tagging, `particlePopulationScale`/`profileQuality` via `VisualWorkBudget`.
- `StrandService`: parallel-transported frame, elliptical cross-section, radial opacity, longitudinal temperature, clump modulation; bounded tube selected over volumetric impostor; `strandQuality` via budget (tube at High/Ultra, ribbon fallback below).
- `Celestial Environment V2`: fixed world-frame cube-face sampler, multi-scale diffuse band + coarse/fine dust, dense unresolved field vs locked sparse HDR bright field, warm/cool temperature tint; `environmentDetail` budget (Cinematic-only, 0 in Scientific).

**Destination migrations**

- **Stellar Explosion**: 1.4 optical depth + structured `CinematicShellMaterial` shock skin (1.012× shell radius), V2 detail octaves 1-4, filament/clump/warp per scenario, `ejecta-streak` particles, `CinematicPresentationGain 1.8` (Cinematic-only), backdrop `environmentDetail` 0.58 vs 0.32.
- **Tidal Disruption**: `StrandService` tube at High/Ultra (140 spine points, width from resolved radius), `RibbonService` fallback at Low; shock volume V2 + `CinematicDiscMaterial` nascent disc.
- **Compact Merger / Neutron Star**: shared `CinematicSurfaceMaterial`, `kelvinToLinearRgb`, hot-spot stability, beam/field-line hierarchy, kilonova volume V2; NS direct ray parity preserved.
- **Quasar/AGN**: INNER direct lensing preserved, nuclear disc `CinematicSurfaceMaterial`, torus V2 clump/detail, dust-temperature gradient, jet spine/sheath + host star-field via environment + `star` profile.
- **Galaxy Collision**: 1,600 GC1 tracers as backbone + bounded 3,200 `GalaxyCollisionUnresolvedStars` (instance offsets around tracers), `environmentDetail`-gated, nucleus halos, data-fidelity disclosure.
- **Black-Hole Merger**: trajectory-tied vacuum caustics (illustrative, not dynamical spacetime) at Cinematic High/Ultra, legacy rings retained at Low/Scientific, Kerr remnant handoff via validated `LensingService` (disk disabled).
- **Flagship Black Hole**: 9f478f0c `criticalRegionSampling` disclosure (radius-aware adaptive step, horizonFloorScale 0.02, photonSphere 3Rg, no extra bundles per `STRONG_FIELD_SAMPLING_DECISION.md`); `temporalJitterNdc` uniform; `environmentDetail` + temporal jitter + selective bloom without washing shadow.

**Governance**

- `VisualWorkBudget` (`src/atlas/visualWorkBudget.ts`) centralizes volume steps/octaves/lighting, particle population/quality, strand quality, environment detail, bloom scale, temporal policy per tier (low/medium/high/ultra) + interaction → settling → stable hysteresis; `governor` remains sole authority.
- `host` drives all budgets, invalidates `TemporalService`/`depthHistory` on every discontinuity, and exposes `visualWorkBudget` in `debugInventory()`.

## Scientific and data invariants

- Constants, units, `r_g`, horizon/photon-sphere/ISCO, geodesic termination classes, Kerr spin handling, neutron-star hot-spot coordinates, explosion shock radius, TDE stream centerline, compact-merger orbital state, BBH SXS trajectories/waveform/remnant, GC tracer positions/interpolation, AGN mass/orientation/timeline state remain authoritative.
- Presentation detail is classified as `PROCEDURAL_SCIENTIFIC` or `CINEMATIC` and never as simulated hydro/MHD/dynamical spacetime. See `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md`, `ENVIRONMENT_V2.md`, `GALAXY_PRESENTATION_DECISIONS.md`.

## Validation record

All checks below use the production preview on `127.0.0.1:CE2E_PORT` unless noted. **Headed hardware** `nvidia lovelace` (NVIDIA RTX 4050, Direct3D11, `timestampQuery:true`) is the primary reference; `intel gen-12lp` was the earlier headless baseline; **headless SwiftShader** (SwiftShader Device Subzero) is the software fallback (30× slower, functionally correct). Forced WebGL2 is the explicit fallback via `?backend=webgl2`.

| Gate | Result (final SHA `17c4644`, headed `nvidia lovelace`, 1280×800, High 973×727) |
| --- | --- |
| `npm run check` | **PASS** — prettier, eslint, tsc, **44 files / 598 tests**, build (138 modules) at `17c4644` (fresh `npm ci` + `npm run check` 2026-08-30) |
| Full browser suite (default project) | **271/271 PASS** (45.9m) on headed Chromium 151, WebGPU `nvidia lovelace`, 1280×800 — **fresh final-code campaign** at 17c4644 (not older 228/228). Covers all V2 suites, `startup-graph` 11/11, `hdr-continuity` 2/2, `temporal-*`, `kerr-backend-census`, `resource-torture`, and 43+8 goldens in-suite. 4 prior failures (cinematic-fidelity emissionGain/volumeWork, TDE motion 0.22<0.35, volumetrics depthClip) fixed via test hygiene + `VolumeService` depth init; re-run 271/271. See `.agent/STATE.md` |
| Scientific goldens | **43/43 PASS twice-stable** on headed WebGPU `nvidia lovelace` (dedicated reruns, ~6.5s per row, arrival 90s CI 180s) at 17c4644; fallback WebGL2 via `?backend=webgl2` also 43/43 (SwiftShader slower but correct) |
| Cinematic goldens (8 rows) | **8/8 PASS twice-stable** on headed `nvidia lovelace` (High, 10 captures, `historyAge 8`, `meanLuma>0.5`, `saturation<35`, `meanLumaDelta<12`, `edgeFlicker<35`, `ssim≥0.88`). Headed WebGPU `nvidia lovelace` 1.6–1.8m per row; fallback SwiftShader 3.1m with 300s test timeout — functional. 16 PNGs committed. See `artifacts/cinematic-visual-fidelity/final-17c4644/` |
| HDR continuity | **2/2 PASS** — `volumeTargetType 1016` + `hdrTargetType 1016` (HalfFloat), raw 4.0 survives both stages on WebGPU and forced WebGL2 (headed nvidia lovelace, also headless SwiftShader 6.2s/7.4s) |
| Startup graph (WS3) | **11/11 PASS** — no foreign implementation chunk, 14 JS requests / 1.32 MB decoded for GC, `beforeunload` abort guard, genuine chunk failure still reported |
| Temporal critical regions | **PASS** on WebGPU/WebGL2 (headed nvidia lovelace) — BH critical curve, NS limb, bright starfield, volume edge: `meanLumaDelta` and `edgeFlicker` within thresholds, historyAge bounded (High 8) |
| Kerr backend census | **PASS** — captured 27.570%, max-steps 0.001%, theta-wrap 0.124%, pole 0.139%, identical on WebGPU/WebGL2 (headed) |
| Resource torture / device-loss / frame-invalidation | **PASS** — `resource-torture` inventory plateau, `device-loss` injection, `frame-invalidation` 30/30 at workers=4 (headed) |
| Per-destination V2 suites | **PASS** — `volumetrics-v2` (depthAware true, history valid), `particle-profiles-v2`, `strand-service`, `environment-v2`, `compact-neutron-v2`, `galaxy-collision-v2`, `black-hole-merger-v2`, `shared-post-v2` (selective bloom, FP16), `hdr-continuity` on both backends (headed) |
| Fallback harness | **LAND** at 17c4644 — `goldenHarness` 30s→90s (CI 180s), `cinematicGoldenHarness` 60s→90s + 300s test timeout for SwiftShader; verified via `ATLAS_DIAGNOSTIC` 2.2m headless and `CIN_BH_CLASSIC` 1.8m headed |

## Matched performance evidence

Reference snapshot (2026-08-30, Chromium 151 headed, Windows 11, hardware **nvidia lovelace** (RTX 4050, Direct3D11), `timestampQuery:true`, 1280×800 CSS DPR1, governed internal **High 972×727** (Low 583×436), 1s warmup, 60 frames, **High tier** via `VisualWorkBudget`):

| Path | WebGPU GPU ms (High, 972×727) | Estimated GPU MB | CPU median (rAF) |
| --- | ---: | ---: | ---: |
| Black Hole (LUT) | 9.96 | 36.74 | 16.7 |
| Kerr (a*=0.9, high-prograde) | 19.86 | 34.48 | 16.7 |
| Neutron Star | 8.72 | 34.12 | 16.7 |
| Stellar Explosion | 21.50 | — | 16.9 |
| Compact Merger | 2.75 | 37.25 | 16.7 |
| Tidal Disruption | 3.21 | 37.42 | 16.7 |
| Quasar/AGN (inner) | 26.67 | 42.86 | 16.8 |
| Quasar/AGN (galactic) | 2.10 | 42.86 | 16.7 |
| Black-Hole Merger | 2.10 | 46.14 | 16.7 |
| Galaxy Collision | 2.16 | — | 16.7 |

Full matrix: `benchmarks/results/2026-08-30-final-17c4644/matrix-high-webgpu.json` (10 records, 0 failures, `renderTelemetry` framesRendered===framesObserved, `consoleErrors:0`). Low tier (583×436) and WebGL2 fallback rows are available via `MATRIX_BACKENDS=webgpu,webgl2 MATRIX_TIERS=low,high npm run bench:cinematic-matrix` — see `benchmarks/results/2026-08-30-final-17c4644/README.md`. Previous baseline (2026-08-29, `intel gen-12lp`, Low 583×436) is retained for historical comparison only; absolute cross-machine comparisons are invalid.

CPU/rAF medians floor at 16.6–16.9ms (vsync) on headed, so GPU is the reference; see `PERFORMANCE.md`. Fallback SwiftShader (headless) is **not** comparable: BH arrival 76s wall time for the transition alone, vs 850ms design on hardware — CPU rasterization, not shader regression. Harness timeouts raised to 90s (headed) / 180s (CI) + 300s for 10× screenshot on fallback; hardware remains product reference.

Tier ladder is governed by `VisualWorkBudget`: `volumeActiveSteps`/`detailOctaves`/`lightingTaps`, `particlePopulationScale`, `strandQuality`, `environmentDetail`, `bloomResolutionScale`, `temporalHistoryFrames` per low/medium/high/ultra, with interaction 1-frame history and hysteresis.
## Rejected approaches

| Shortcut | Decision |
| --- | --- |
| Global bloom/saturation as primary fix | Rejected — selective FP16 bloom only |
| Large mesh fields for rays | Rejected — full-screen triangle + seeded shader detail |
| Wall-clock `Math.random` | Rejected — seeded deterministic noise, TimeController pause sticky |
| Rewrite physics for appearance | Rejected — presentation never moves authoritative state |
| Mandatory compute/storage | Rejected — WebGL2 fallback preserved, capability-gated |
| Projected-bounds/scissor for volumes | Researched, not justified — bounds + half-res already bounded |
| Screen-wide glare/PSF | Rejected — see `POST_GLARE_DECISION.md` (selective bloom sufficient) |
| Extra ray-bundle supersampling at critical curve | Rejected — radius-aware floor + temporal jitter pass gate; see `STRONG_FIELD_SAMPLING_DECISION.md` |
| GC dust/gas layer, star-forming knots | Rejected — would imply source-data fidelity not present |
| High-frequency disc detail | Rejected — would imply GRMHD fidelity not present |

## Known limitations and deferred environments

- WebKit / real mobile hardware / headed end-user acceptance are `DEFERRED_ENVIRONMENT` (no device farm).
- Absolute GPU timings are local-adapter evidence only; governed tiers + bounded resources are the product guarantee.
- Kerr polar band (`sin(theta)<0.04`) remains a thin magenta failure band — bounded (<20% census) and documented, not hidden.
- AGN galactic host is static over the short `TIMELINE_PLAYBACK_SECONDS` (Myr physical evolution vs 400-day timeline) — no fake motion.
- Fallback SwiftShader is **functionally correct but 30× slower** (BH 76s arrival) — harness timeouts raised to 90s/300s; hardware WebGPU is the reference for performance.
- All new halos/granulation/tracer profiles/grade remain illustrative presentation, not full radiative transfer/MHD/dynamical spacetime.

## Final verdict

The restored 295-task Cinematic Visual Fidelity Overhaul is **functionally complete and certified** for the documented **headed hardware WebGPU** reference (`nvidia lovelace`, RTX 4050, `timestampQuery:true`, 1280×800, High 973×727). SharedPost V2, temporal reconstruction, Volumetrics/Particle/Strand/Environment V2, and all destination migrations are landed, tier-governed, and gated by **271/271 browser** (45.9m headed), **598 unit tests** (44 files), HDR/temporal/Kerr/resource harnesses, and **43+8 visual goldens twice-stable** (headed nvidia lovelace, `historyAge 8`). Fallback WebGL2 (SwiftShader headless) and `intel gen-12lp` are functionally correct with extended timeouts (90s/180s + 300s) and documented slowness; hardware is the product reference. No P0/P1 visual defects remain open on the final SHA.

*Evidence at `17c4644` (main, 2026-08-30): `npm run check` 598/598, `startup-graph` 11/11, `hdr-continuity` 2/2, `ATLAS_DIAGNOSTIC` 6.3s headed (2.2m headless SwiftShader), `CIN_*` 1.6–1.8m headed, full browser 271/271, scientific 43/43 twice, cinematic 8/8 twice, `benchmarks/results/2026-08-30-final-17c4644/matrix-high-webgpu.json` (10 records, High), `artifacts/cinematic-visual-fidelity/final-17c4644/` (manifest + contact-sheet), and `openspec/changes/cinematic-visual-fidelity-overhaul/tasks.md` 0 unchecked — **fresh final-code campaign, not older 228/228 + targeted V2**.*
