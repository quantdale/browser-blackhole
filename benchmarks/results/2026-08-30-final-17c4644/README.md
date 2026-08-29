# Final Benchmark Matrix — 17c4644 (2026-08-30)

Commit: `17c4644c78947b1f3398ee0534c1f943f181de27` (main, clean)
Date: 2026-08-30
Browser: Chromium 151.0.7922.34 (headed, nvidia lovelace WebGPU primary)
Viewport: 1280×800 CSS, internal High 973×727 / Low 583×436 (governed), DPR 1
Warmup: 1000ms, Frames: 60, Channel: msedge (benchmark harnesses use `chromium` with `channel: msedge` where available)

This directory contains the final `matrix.json` produced at `17c4644`:

```bash
MATRIX_BACKENDS=webgpu,webgl2 MATRIX_TIERS=low,high npm run bench:cinematic-matrix
# 40 records, 0 failures, 283s, output artifacts/cinematic-visual-fidelity/benchmark-17c4644c78947b1f3398ee0534c1f943f181de27/matrix.json
# copied to benchmarks/results/2026-08-30-final-17c4644/matrix.json for durable audit
```

And per-destination raw records where applicable (e.g., `inspiral-high-cinematic-webgpu-high-black-hole-merger.json`).

Each persisted record includes (per the hygiene pass):

- SHA (`17c4644`), date (`2026-08-30T19:48:21.859Z`), browser (`msedge` 151), GPU/adapter (`nvidia lovelace` headed, `timestampQuery:true`), backend (`webgpu`/`webgl2`), quality tier (`low`/`high`)
- CSS viewport (`1280×800`), internal resolution/render scale (`effectiveRenderSize` 972×727 High, 583×436 Low, `internalScale` 0.75/0.45), warmup (`1000ms`), frame count (`frames:60`, `framesObserved:61`, `framesRendered:61`, `renderTelemetry`)
- GPU timing (`frameGpuMs.lastResolvedFrame` where available, e.g., Black Hole High 9.96ms) and CPU/rAF timing (`frameCpuMs.median:16.7`, `medianMs`) separately
- estimated memory/resources (`memory.estimatedGpuBytesTotal: 36.74MB`, `rendererInfo` drawCalls/triangles/programs, `renderTelemetry`, `consoleErrors:0`)

Do not overwrite unrelated historical benchmark data under `benchmarks/results/2026-08-*/`.

## Captured matrix (High tier, WebGPU, nvidia lovelace, 972×727, 60 frames)

| Path | WebGPU GPU ms | Estimated GPU MB | CPU median |
|------|--------------|----------------|------------|
| Black Hole (LUT) | 9.96 | 36.74 | 16.7 |
| Kerr (a*=0.9) | 19.86 | 34.48 | 16.7 |
| Neutron Star | 8.72 | 34.12 | 16.7 |
| Stellar Explosion | 21.50 | — | 16.9 |
| Compact Merger | 2.75 | 37.25 | 16.7 |
| Tidal Disruption | 3.21 | 37.42 | 16.7 |
| Quasar/AGN (inner) | 26.67 | 42.86 | 16.8 |
| Quasar/AGN (galactic) | 2.10 | 42.86 | 16.7 |
| Black-Hole Merger | 2.10 | 46.14 | 16.7 |
| Galaxy Collision | 2.16 | — | 16.7 |

Low tier (583×436) rows are also in `matrix.json` (see `requestedTiers: low,high`), and WebGL2 fallback rows are present (same workloads, `requestedBackends: webgpu,webgl2`). See `matrix.json` for full 40-record detail (10 workloads × 2 tiers × 2 backends) and `docs/VISUAL_FIDELITY_CERTIFICATION.md` for the tier ladder discussion.
## Reference (previous hardware, intel gen-12lp, 2026-08-29, for comparison only)

| Path | WebGPU GPU ms | WebGL2 GPU ms | Estimated GPU MB |
|------|--------------|--------------|----------------|
| Black Hole LUT | 2.88 | 0.85 | 4.91 |
| Kerr | 4.98 | 7.03 | 2.54 |
| Neutron Star | 1.70 | 1.92 | 2.17 |
| Stellar Explosion | 1.97 | 2.16 | — |
| Compact Merger | 0.46 | 0.94 | 5.42 |
| Tidal Disruption | 1.11 | 1.40 | 5.41 |
| Quasar/AGN | 1.97 | 2.98 | 11.33 |
| Black-Hole Merger | 0.33 | 0.49 | 14.73 |
| Galaxy Collision | 0.33 | 0.81 | 5.75 |

CPU/rAF medians floor at ~16.6ms (vsync) on headed; GPU is reference. Fallback SwiftShader is 30× slower and not comparable.

## How to reproduce

```bash
MATRIX_BACKENDS=webgpu MATRIX_TIERS=low,medium,high,ultra npm run bench:cinematic-matrix
# output: artifacts/cinematic-visual-fidelity/benchmark-17c4644/matrix.json (default)
# copy to benchmarks/results/2026-08-30-final-17c4644/matrix.json for durable audit
```
