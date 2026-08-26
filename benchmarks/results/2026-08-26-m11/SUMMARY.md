# M11 benchmark summary — 2026-08-26 (release candidate)

Commit: `2156d46` tree state (implementation identical through `60da148` —
later commits touch docs/tests only, no render-path code). Environment:
Windows 11, Node v22.23.2, headless `msedge 151.0`, hardware WebGPU
(`amd rdna-2` adapter, WebGPU API), viewport 1280×800, pinned medium tier,
`render-scale=1` → internal 972×727, 600 steady-state rAF frames after ≥9 s
pipeline warmup, transport PAUSED (deterministic tau = 0 epoch for every
moving-observer row via the harness's camera round-trip reseed).

**Measurement honesty:** every frame time is a CPU-side rAF wall delta around
the orchestrated frame (update + render + present). `frameGpuMs` is `null` in
all records — this machine/browser exposes no GPU timestamp queries and none
were inferred. Records embed adapter, browser version, tier, internal size,
resource-scope memory estimates, and console-error counts (0 everywhere).

## Matched moving-observer series (`benchmarks/results/2026-08-26-m11/`)

First-class observer selection through the canonical control channel
(`--observer=...`, M11 WS1B harness extension). Same viewport/internal size/
tier across the Schwarzschild rows; the Kerr row runs its own backend class
(numerical Kerr, scaled moving-observer step budget).

| Scenario (record) | Backend | Observer state | CPU frame ms median | p95 | p99 |
| --- | --- | --- | --- | --- | --- |
| `lut-camera` (legacy static anchor) | lut | camera, r≈16.2, beta 0 | 13.9 | 20.8 | 20.9 |
| `lut-circular-r12` | lut | circular r=12, beta 0.316 | 7.0 | 13.9 | 14.0 |
| `lut-flyby` | lut | flyby b=8 β∞=0.6, r=40 | 20.9 | 27.9 | 41.7 |
| `lut-freefall` | lut | freefall r0=14 | 7.0 | 7.1 | 7.3 |
| `kerr-circular-r8` | numerical-kerr | circular r=8 prograde, β 0.396 | 76.5 | 83.6 | 153.1 |

Reading (honest, no spin):

- The moving-observer rows are NOT slower than the static anchor per se —
  the circular/freefall rows are FASTER because their observers sit
  inside/above the disk annulus where fewer rays resolve disk crossings;
  scene content, not observer mode, dominates LUT-path cost. The flyby row
  is slower because its view crosses the full disk.
- The Kerr moving-observer row carries the expected premium: full numerical
  Kerr integration with the ×3 moving-observer step budget (M11). ~76 ms
  median at medium tier on this adapter — a premium scientific scene, not a
  regression; its preset recommends ultra quality and the tier ladder still
  applies.

## Regression audit vs prior records

- M10 static baseline (`2026-08-25-m10/static-baseline.json`, governor-managed
  0.8 scale → 778×581, median 7 ms) is NOT directly comparable to this
  series (different pinned scale); the like-for-like anchor here is
  `lut-camera` at the pinned 972×727. No render-path performance change
  shipped for static/camera scenes in M11: the covariant moving-observer
  init is gated behind `observerActive`, the Kerr loop-bound increase is
  compile-time only, and the ×3 step budget applies only to active moving
  observers (static-camera Kerr budgets unchanged).
- Prior per-milestone records (M8 numerical/LUT, M9 Kerr, CA5–CA8) remain
  the historical baselines for those paths; no M11 change altered their
  measurement semantics.

## Caveats

- Single machine, single browser, desktop GPU only. No mobile-device,
  cross-vendor-GPU, or thermal claims are made
  (`docs/COMPATIBILITY_MATRIX.md` records the untested combinations).
- Headless-run absolute numbers sit below interactive-desktop numbers
  (no compositor overhead); treat deltas within a series as meaningful and
  absolute values as environment-specific.
