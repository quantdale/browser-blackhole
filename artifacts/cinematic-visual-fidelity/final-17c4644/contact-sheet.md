# Final Cinematic Contact Sheet — 17c4644 (2026-08-30)

**Commit:** `17c4644c78947b1f3398ee0534c1f943f181de27` (main, clean)
**Browser:** Chromium 151.0.7922.34 (Playwright bundled chromium-1234, channel msedge 151.0.4129.107)
**GPU (headed hardware):** nvidia lovelace (NVIDIA GeForce RTX 4050 Laptop GPU, Direct3D11) — `timestampQuery:true`, `storageBuffers:true`
**GPU (headless fallback):** SwiftShader Device (Subzero) — software, ~30× slower (documented)
**Backend:** WebGPU primary (`api:webgpu, adapterName:nvidia lovelace`), WebGL2 fallback via `?backend=webgl2`
**Viewport:** 1280×800 CSS, internal High 973×727 (Low 583×436), DPR 1
**Tier:** High for cinematic goldens (10 captures, historyAge 8, `meanLuma>0.5`, `saturation<35`, `meanLumaDelta<12`, `edgeFlicker<35`)
**Harness:** `tests/browser/support/cinematicGoldenHarness.ts` with Halton jitter, camera-only reprojection, 3×3 clamp

All eight destinations are produced by the V2 pipeline: SharedPost V2 (selective FP16 Emissive + BloomNode), Temporal reconstruction (bounded HalfFloat history), Volumetrics V2 (macro/detail, staged depth bilateral), Particle V2 (compact star / ejecta-streak / debris-streak / dust-clump), StrandService (transported tube), Environment V2 (world-frame cube sampler).

## Eight cinematic goldens (WebGPU primary)

| # | Destination | Cinematic Golden | WebGL2 Fallback | URL (phase) | Camera | Notes |
|---|-------------|------------------|-----------------|-------------|--------|-------|
| 1 | Flagship BH | `tests/browser/cinematic-goldens/CIN_BH_CLASSIC.png` | `CIN_BH_CLASSIC_WEBGL2.png` | `/atlas/black-hole?preset=classic` @0.2 | auto-framed | Schwarzschild shadow, critical curve, V2 lensed environment (photon sphere 3Rg, horizonFloorScale 0.02) |
| 2 | Neutron Star | `CIN_NS_SURFACE.png` | `CIN_NS_SURFACE_WEBGL2.png` | `/atlas/neutron-star?preset=surface` @0.5 | auto-framed | Limb/hot-spot surface ray, lensed field |
| 3 | Stellar Explosion | `CIN_SN_EXPANSION.png` | `CIN_SN_EXPANSION_WEBGL2.png` | `/atlas/stellar-explosion?preset=core-collapse` @0.55 | auto-framed | Structured shock skin (1.012×), filament/clump/warp, ejecta-streak, CinematicPresentationGain 1.8 |
| 4 | Tidal Disruption | `CIN_TDE_DEBRIS.png` | `CIN_TDE_DEBRIS_WEBGL2.png` | `/atlas/tidal-disruption?preset=solar-canonical` @0.42 | distance 600, target [-3150,0,-1150] | Transported tube (140 spine points) + V2 shock + disc |
| 5 | Compact Merger | `CIN_CM_KILONOVA.png` | `CIN_CM_KILONOVA_WEBGL2.png` | `/atlas/compact-merger?preset=equal-mass-nsns` @0.7 | auto-framed | Kilonova V2 volume, CinematicSurfaceMaterial |
| 6 | Quasar/AGN | `CIN_AGN_NUCLEAR.png` | `CIN_AGN_NUCLEAR_WEBGL2.png` | `/atlas/quasar-agn?preset=quasar-reference` @0.5 | auto-framed | Nuclear torus V2, jet spine/sheath, host via Environment V2 |
| 7 | BH Merger | `CIN_BBH_INSPIRAL.png` | `CIN_BBH_INSPIRAL_WEBGL2.png` | `/atlas/black-hole-merger?preset=sxs-bbh-0001-inspiral` @0.05 | auto-framed | Vacuum caustics (illustrative, not dynamical spacetime), Kerr census |
| 8 | Galaxy Collision | `CIN_GALAXY_BRIDGE.png` | `CIN_GALAXY_BRIDGE_WEBGL2.png` | `/atlas/galaxy-collision?preset=bridge-tail` @0.5 | auto-framed | 1,600 GC1 tracers + 3,200 bounded stars, environmentDetail gated |

## Scientific goldens (43 rows, linear HDR, bloom off)

Scientific baselines live under `tests/browser/goldens/` and are force-linear (exposure 1, bloom OFF, NoColorSpace). They share the same arrival/time/camera determinism as cinematic but pin Scientific mode. Example pairs:

- **BH:** `BH_CLASSIC.png` (scientific, linear) vs `CIN_BH_CLASSIC.png` (cinematic, selective bloom, temporal jitter, environmentDetail)
- **Stellar:** `SN_EXPANSION.png` vs `CIN_SN_EXPANSION.png` (structured shell + V2 detail only in cinematic)
- **GC:** `GC_BRIDGE_TAIL.png` vs `CIN_GALAXY_BRIDGE.png` (tracer backbone + bounded stars only in cinematic high)

Full scientific list (43): `ATLAS_DIAGNOSTIC`, `ATLAS_HYPERSPACE_BH_NS`, `BH_CLASSIC`, `NS_SURFACE`, `NS_PULSAR`, `NS_MAGNETAR`, `SN_PROGENITOR`, `SN_FLASH`, `SN_EXPANSION`, `SN_HYPERNOVA`, `SN_GRB_ON/OFF`, `CM_INSPIRAL/MERGER/KILONOVA/GRB_ON/OFF/REMNANT`, `TDE_APPROACH/DEFORMATION/DEBRIS/WINDING/SHOCK/NASCENT_DISK`, `KERR_ZERO_SPIN/HIGH_PROGRADE/RETROGRADE`, `AGN_INNER_ENGINE/NUCLEAR/RADIO_GALAXY/BLAZAR_VIEW`, `BHM_INSPIRAL/NEAR_MERGER/MERGER_FLASH/RINGDOWN/REMNANT`, `OBSERVER_CIRCULAR/FLYBY/FREEFALL`, `KERR_CIRCULAR_OBSERVER`, `GC_ENCOUNTER/BRIDGE_TAIL/POST_ENCOUNTER`.

## Metrics (headed WebGPU, nvidia lovelace, High)

Example: `CIN_BH_CLASSIC` 973×727, meanLuma 25.65, stdev 34.9, saturation 0.00014%, blackCrush 50.6%, temporal meanLumaDelta 0.148, edgeFlicker 10.15% (thresholds: meanLuma>0.5, saturation<35, meanLumaDelta<12, edgeFlicker<35). All eight rows carry per-row `ssim` ≥0.88 and `historyAge` 8.

## Timeline / motion

Deterministic phase strips and `measurePresentedMotion` probes are recorded via `tests/browser/support/appHarness.ts` (`captures:5, framesBetween:60` for TDE after fix). TDE, SN, GC, CM, AGN, BBH all report `meanLumaDelta` 0.2–3.5 while playing, vs 0.00 when frozen (pre-fix). The cinematic harness's 10-frame temporal block also records `meanLumaDelta` + `edgeFlicker` per golden (see `manifest.json` metrics).

## How to reproduce

```bash
npm ci
npm run check  # 44 files / 598 tests, build 138 modules — at 17c4644
E2E_PORT=4299 npx playwright test --project=default --workers=1 --headed --reporter=list  # full 271, nvidia lovelace WebGPU, 1280x800
E2E_PORT=4300 npx playwright test tests/browser/visual-goldens.spec.ts --project=default --workers=1 --headed  # 43/43 twice
E2E_PORT=4301 npx playwright test tests/browser/cinematic-goldens.spec.ts --project=default --workers=1 --headed  # 8/8
npm run bench:cinematic-matrix  # matrix.json under benchmarks/results/2026-08-30-final-17c4644
```

Artifact root: `artifacts/cinematic-visual-fidelity/final-17c4644/` (tracked via `.gitignore` negation). Raw frame sequences are omitted; only this contact sheet + `manifest.json` + per-row goldens under `tests/browser/cinematic-goldens/` are committed for audit.
