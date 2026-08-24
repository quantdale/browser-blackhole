# M9 Kerr benchmark characterization — 2026-08-24

Environment: Windows 11 (10.0.26200), Node v22.23.2, Microsoft Edge 151,
**hardware WebGPU** (`amd rdna-2` adapter), viewport 1280×800 unless noted.
Every record's `trajectoryBackend.effective` is `numerical-kerr` — the
harness ABORTS rather than measuring if the Kerr pass is not active
(scripts/bench-kerr.mjs honesty gate). All numbers are **CPU-side rAF frame
deltas**; `frameGpuMs` is null in every record (no GPU timestamp queries
wired) — never label these as GPU time.

## Records

| File | Preset | spin | Tier | Internal size | median ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `zero-low.json` | kerr-zero-spin | 0 | low | 583×436 | 13.9 | 14.0 | 14.0 |
| `pro-high-low.json` | kerr-high-prograde | +0.9 | low | 583×436 | 14.0 | 27.7 | 34.8 |
| `retro-low.json` | kerr-retrograde | −0.7 | low | 583×436 | 13.9 | 14.0 | 14.1 |
| `pro-medium-native.json` | kerr-high-prograde | +0.9 | medium | 778×581 | 34.8 | 41.7 | 46.9 |
| `pro-ultra-1080p.json` | kerr-high-prograde | +0.9 | ultra | 1600×1007 | 180.8 | 354.7 | 354.9 |

## Honest findings (BH-206 baseline — no optimization performed)

1. **Cost is real, not vsync-masked.** Unlike the Schwarzschild numerical and
   LUT paths on this machine (both vsync-bound ~7 ms), the Kerr numerical path
   measures a genuine ~14 ms median even at the low tier: the full-3D
   five-variable RK4 with pole-aware stepping costs measurably more than the
   planar Schwarzschild reduction.
2. **Spin-dependent tail.** At equal tier/resolution, median cost is spin-
   insensitive (~13.9–14.0 across 0/−0.7/+0.9) but the prograde high-spin tail
   fattens sharply (p95 27.7, p99 34.8): frame-dragged winding rays traverse
   far more steps before escaping/capturing. Retrograde and zero-spin tails
   stay at the vsync floor.
3. **Default-quality headroom.** Medium tier native internal resolution
   averages ~35 ms (<30 fps) — the honest current standing of the first Kerr
   implementation. Per docs/KERR_RESEARCH_PLAN.md §15 this is the expected
   correctness-first baseline; optimization (constants-of-motion form, tile
   classification, adaptive stepping) is future work gated on this telemetry.
4. **1080p ultra is compute-bound** (~181 ms median): 1600×1007 × up to
   2048 RK4 steps of the full Hamiltonian RHS. Recorded as the upper anchor.
5. Numerical-failure statistics are visible per-frame through the debug
   classification path but are not yet aggregated into these records (the
   failure pixels render explicit magenta; aggregating counts into telemetry
   is recorded as follow-up debt in `.agent/STATE.md`).

Reproduce with `npm run bench:kerr -- --label=<name> [--quality=... etc]`.
