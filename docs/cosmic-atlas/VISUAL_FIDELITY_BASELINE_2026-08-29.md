# Cinematic visual-fidelity overhaul — immutable before-state

This is the before-state for the restored campaign contract. It was captured
after the plan-only checkpoint `acf0694db4b1955d9ec3a0caa4615fc4147dd17b`,
before runtime changes for this campaign. The capture directory is intentionally
not overwritten by the capture script unless `BASELINE_OVERWRITE=1` is passed.

## Capture evidence

- Command: `node scripts/capture-visual-baseline.mjs`
- Browser: Microsoft Edge, headless, channel `msedge`
- Backend: hardware WebGPU on this machine; every scene reported `webgpu`
- CSS viewport: 1280×800; device pixel ratio: 1
- Effective internal render size: 972×727 at the pinned high tier / 0.8 scale
- Scenes: all eight production destinations
- Modes: Scientific and Cinematic for every scene
- Per scene: three representative phase frames where applicable, wide/medium/detail
  shot set, and a five-frame phase motion strip
- Console/page errors: 0
- Capture manifest SHA-256: `b5ba241b12334701163e8f7c001491ae4f39ffd29ab0ddee85893355d736d150`
- Local artifact root: `artifacts/cinematic-visual-fidelity/baseline-2026-08-29/`

The ignored artifact root contains 165 PNGs plus `manifest.json`; the manifest
records the exact routes, presets, phases, camera orbit, renderer inventory,
resource scopes, GPU timestamp result, luminance statistics, saturation and
black-crush percentages, and motion-strip metrics. The artifact root is local
evidence on this runner; the tracked document preserves its identity and the
capture recipe without pretending that ignored binaries are present in every
checkout.

## Baseline measurements

The metrics below are display-space screenshot measurements, not linear scene
radiance. `black-crush` is the percentage of pixels with luma ≤ 3/255 and
`saturation` is the percentage with any channel ≥ 250/255. GPU values are the
last resolved render-pass timestamp after the capture sequence; they are not
CPU/rAF timings.

| Destination | GPU ms | Estimated bytes | Cinematic mean luma | p99 luma | Black-crush | 5-frame mean luma delta | Edge-flicker metric |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Black Hole | 55.44 | 12,304,900 | 32.46 | 137.35 | 47.03% | 0.000 | 0.000 |
| Neutron Star | 186.91 | 9,559,336 | 45.08 | 207.14 | 74.54% | 0.000 | 0.000 |
| Stellar Explosion | 62.91 | 13,116,580 | 6.26 | 194.24 | 96.75% | 0.000 | 24.950 |
| Compact Merger | 17.04 | 12,815,524 | 2.37 | 87.88 | 97.85% | 0.000 | 37.930 |
| Tidal Disruption | 60.56 | 12,806,756 | 1.23 | 0.85 | 99.05% | 0.000 | 30.530 |
| Quasar / AGN | 43.32 | 18,724,108 | 1.24 | 39.24 | 95.50% | 0.000 | 11.620 |
| Black-Hole Merger | 514.72 | 22,118,552 | 2.03 | 85.41 | 97.31% | 0.000 | 50.380 |
| Galaxy Collision | 9.90 | 10,248,708 | 2.11 | 87.53 | 97.43% | 0.000 | 60.140 |

The zero mean-luma values for phase strips are not a claim that the scenes are
static; they reflect the sparse subject coverage and display-space quantization
in the selected first phase. The raw manifest retains all phase-specific
statistics. The high edge-flicker values on the sparse scenes are a baseline
signal for the temporal gate, not a release threshold.

## Reviewed defect ledger

| Area | Before-state finding | Evidence / impact |
| --- | --- | --- |
| HDR continuity | Volume half-resolution path is 8-bit despite carrying emissive radiance. | `src/renderer/shared/VolumeService.ts`; values above display white cannot reach SharedPost reliably. |
| Shared post | One whole-image bloom path; no named temporal, selective-emissive, auxiliary-buffer or glare stages. | `src/renderer/shared/SharedPost.ts`; bright unrelated geometry shares the same threshold. |
| Temporal stability | Jitter exists only as a frame-indexed volume offset; no history target, reprojection, clamp or rejection policy. | Volume header and `temporalJitter` config; motion strips expose crawling/unstable sparse content. |
| Volumes | Constant-step emission/absorption only, linear half-resolution upsample, no depth clip, detail library, bilateral upsample or shadow taps. | `VolumeService` disclosure and shader graph; explosion/TDE shots read as smooth blobs. |
| Particles | One generic soft radial billboard profile. | `ParticleService`; ejecta, stars and dust all share the same sprite language. |
| Strands | Flat world-space ribbon plus wider halo strip. | `RibbonService`; TDE shock/stream reads as a 2D strip rather than a tube/medium. |
| Environment | Existing procedural sampler is a single sparse cube-cell starfield; non-fullscreen backdrop is a low-detail seeded sphere. | `src/shaders/starfieldGpu.ts`, `CinematicPrimitives.ts`; most destination frames are black around a tiny subject. |
| Stellar Explosion | Expansion is concentric/smooth with grain-like shell texture; flash and shell lack a selective HDR highlight path. | Baseline `stellar-explosion/cinematic/phase-0_55-wide.png` and motion strip. |
| Tidal Disruption | Debris stream is broad, smooth and ribbon-like; shock is a flat toroidal wash. | Baseline `tidal-disruption/cinematic/phase-0_78-wide.png`. |
| Compact Merger / NS | Compact emitters are still dominated by simple surface/particle presentation; high-cost NS frame has large crushed-black regions. | Baseline phase/shot captures and 186.91 ms GPU NS reading. |
| AGN | Scale zones are present but torus/host/jet hierarchy remains simple and sparse. | Baseline AGN phase captures; 95.50% black-crush at the first cinematic phase. |
| Galaxy Collision | Validated tracers move, but the image remains a sparse point population rather than diffuse interacting galaxies. | Baseline motion strip and 97.43% black-crush at the first phase. |
| BBH | Inspiral remains marker/ring/trail-first; the vacuum constraint is correct but high-quality visual language is schematic. | Baseline BBH motion strip; no matter/fire was added. |
| Flagship BH | Strong-field path is mature, but environment detail and critical-region sampling are not yet V2. | Baseline BH capture plus existing Kerr/observer limitations. |
| Quality/performance | Previous work has a governed tier/work path, but V2-specific volume detail, history, profile and strand budgets do not exist. | Current `governor.ts` and destination snapshots. |
| Validation | Scientific 43-row suite is valuable but forces low tier, bloom off, exposure 1 and linear tone mapping. | `docs/cosmic-atlas/GOLDEN_IMAGES.md`; it cannot certify cinematic HDR/post/temporal quality. |

This ledger is intentionally a Phase-0 artifact. It is not a final
certification and does not mark any of the restored campaign’s implementation
or acceptance tasks complete.
