# Performance and hardware-utilization plan

## 1. Core principle

The workload is massively data parallel: screen pixels/rays are mostly independent. The GPU therefore performs per-pixel geodesic and shading work. The CPU orchestrates UI, state, camera, resource lifecycle, and occasional reference/precomputation jobs.

Never implement the real-time image by iterating over pixels in JavaScript or CPU WASM.

## 2. Performance observability first

Before substantial optimization, record:

- browser/Three.js/backend;
- adapter information when exposed without relying on unstable identifiers;
- canvas CSS dimensions;
- internal render dimensions and effective DPR;
- CPU frame time;
- GPU pass time when timestamp queries/features are available;
- quality preset and effective render scale;
- max/integration quality settings;
- average/P95/P99 step count when instrumentation is feasible;
- fraction captured/escaped/disk-hit/max-step;
- temporal sample/history state.

Telemetry is local/debug by default. No analytics service is required.

## 3. Optimization order

Apply in this order unless profiling disproves it:

1. eliminate obviously unnecessary work and allocations;
2. early ray termination;
3. sane internal resolution/DPR limits;
4. adaptive integration/step sizing;
5. reduce hot-path branch divergence and expensive repeated math;
6. dynamic resolution/interaction quality scaling;
7. temporal accumulation/reprojection;
8. LUT/precomputation for Schwarzschild;
9. optional tile/workload classification/compute passes;
10. workers/off-main-thread rendering only for measured CPU bottlenecks.

## 4. Early termination

Terminate rays when confidently:

- captured by the horizon;
- escaped past a configurable radius and moving outward with residual deflection below tolerance;
- an opaque thin-disk hit has resolved final radiance;
- accumulated opacity in a later volume is effectively saturated.

Track `MAX_STEPS` separately so lowering budgets cannot masquerade as successful capture.

## 5. Adaptive numerical work

Far from the black hole, curvature is weak; near the photon sphere/critical curve and disk crossings, accuracy demands smaller steps. Step/tolerance policy should use quantities connected to integration error/curvature rather than a visual-distance hack alone.

Benchmark numerical error as well as frame time. Regions near critical trajectories are especially sensitive and can diverge strongly between neighboring pixels.

## 6. Branch divergence

Neighboring GPU lanes can terminate very differently near the shadow/critical ring. Mitigations include:

- simple common hot paths;
- early but conservative exits;
- bounded loops;
- specialized backends/passes where justified;
- LUTs that replace variable-length geodesic integration in Schwarzschild;
- later coarse tile classification.

Do not contort readable physics code solely to remove a branch without profiler evidence.

## 7. Dynamic resolution

Never blindly render at browser `devicePixelRatio`, especially on high-density mobile displays.

Auto mode should maintain an internal render-scale range. During active camera manipulation, lower scale/quality rapidly enough to preserve interaction. During stable frames, restore scale gradually and allow temporal refinement.

Use hysteresis and smoothed timing so quality does not oscillate every frame.

Target frame-time classes are goals, not universal promises:

- interactive desktop target: around 16.7 ms/frame when feasible;
- degraded but usable interaction: around 33 ms/frame;
- if above budget persistently, reduce internal work before dropping into a stalled UI.

## 8. Temporal rendering

Once deterministic single-frame rendering is correct:

- jitter samples/subpixels;
- accumulate stable history;
- reset history on material physics/state discontinuities;
- reproject history for camera motion only after motion vectors/camera transforms are correct;
- reject/clamp stale history to prevent ghosting around the disk/critical ring.

A stationary camera may converge toward a higher-quality image than moving interaction. This is a feature, not a requirement for early milestones.

## 9. LUT/precomputation

For Schwarzschild, precomputed ray/beam mappings can turn expensive per-pixel numerical propagation into a bounded number of texture lookups plus scene intersection/shading. This is likely the strongest end-state optimization for the non-rotating backend.

Treat LUT generation as a versioned offline tool and validate it against the numerical solver.

## 10. Compute shaders

Primary per-pixel image generation already maps naturally to fragment/full-screen execution. Introduce compute for workloads where it changes the algorithm, for example:

- LUT generation;
- tile classification;
- adaptive sampling maps;
- particle/turbulence simulation;
- temporal statistics;
- compacted work queues, if later profiling justifies complexity.

## 11. Workers and OffscreenCanvas

Workers are useful for CPU reference calculations and preprocessing. OffscreenCanvas/render-worker architecture is optional. Moving command submission to a worker does not make a GPU-heavy shader faster by itself, so defer it until main-thread profiling shows a real problem.

## 12. Quality presets

Quality presets specify intent; Auto can override within safe bounds.

Suggested dimensions of quality:

- render scale;
- max steps/tolerance;
- intersection refinement;
- temporal sampling;
- bloom/post-process quality;
- background detail;
- Kerr integrator quality (live tier budget through uMaxSteps, same mechanism as the Schwarzschild pass).

Do not hardcode device names. Capability detection plus a short representative benchmark should pick the initial tier.

## 13. Kerr numerical backend characterization (M9-10 baseline)

First Kerr implementation is correctness-first; measured standing on the M9
campaign machine (hardware WebGPU, amd rdna-2, Edge 151 — full records under
`benchmarks/results/2026-08-24-m9-kerr/`, harness `scripts/bench-kerr.mjs`
with an active-backend honesty gate):

| Condition | Internal size | median | p95 |
| --- | --- | --- | --- |
| a*=0 / −0.7 / +0.9, low tier | 583×436 | ~13.9–14 ms | 14–27.7 ms |
| a*=+0.9, medium native | 778×581 | 34.8 ms | 41.7 ms |
| a*=+0.9, ultra 1920×1080 css | 1600×1007 | 180.8 ms | 354.7 ms |

Honest readings: median cost is spin-insensitive but the prograde high-spin
TAIL fattens sharply (frame-dragged winding rays traverse many more steps);
the Schwarzschild numerical/LUT paths remain vsync-bound (~7 ms) on the same
machine, so the Kerr path's extra cost is real and visible at default tiers.
All numbers are CPU-side rAF deltas (`frameGpuMs: null` — no GPU timestamps).
No optimization was performed in M9 beyond establishing this telemetry
(BH-206 gate: optimize only against trustworthy failure/error telemetry).

## 14. GPU-timestamp characterization and first optimization pass (2026-08-26 campaign)

BH-121 landed: `SharedRendererKernel` constructs the renderer with
`trackTimestamp: true` (three.js self-gates on device `timestamp-query`
support) and resolves the shared render pool on a bounded 90-frame cadence.
`kernel.gpuFrameMs` exposes the LAST resolved frame's summed render-pass
time — a real GPU measurement, never inferred from CPU deltas; surfaced via
debugInventory and both benchmark harnesses
(`frameGpuMs.lastResolvedFrame`). Measured overhead of enabling timestamps:
none (interleaved same-day A/B against the pre-change commit was identical
within noise).

First honest per-backend GPU readings on the same machine/adapter (headless
msedge, pinned medium tier, `render-scale=1`, internal 972×727; rAF medians
from matched runs the same day):

| Backend / scene | CPU rAF median | GPU render-pass ms |
| --- | ---: | ---: |
| Schwarzschild LUT (`default`) | ~13.8 ms | ~10.2 ms |
| Schwarzschild numerical | 41.7 ms | 40.7 ms |
| Kerr static `a*=+0.9` | ~132 ms | ~129 ms |
| CA destinations (all others) | ~7 ms (vsync) | 0.5–0.8 ms |

Corrections to earlier wording this supersedes: the "numerical path is
vsync-bound (~7 ms)" reading described an earlier era/smaller internal size;
at the current default viewport it measures ~40 ms GPU. Every non-black-hole
CA destination is idle-cheap (sub-millisecond GPU). The Kerr numerical
backend is fully GPU-bound and dominates application frame cost; its cost is
mandated integration fidelity at the validated step budgets, so the shipped
mitigations remain the Auto tier ladder + preset fidelity notes.

Measurement-methodology warning recorded with this data: same-commit reruns
of `bench-kerr.mjs` on one day spanned ~97–160 ms medians (bimodal machine
state), and headless rAF deltas quantize to ~7 ms compositing quanta. Any
before/after performance claim from this environment MUST use interleaved
A/B runs; single-run cross-session comparisons are not valid evidence.

Kerr hot-loop optimization landed in the same campaign (see `.agent/STATE.md`):
pure common-subexpression elimination inside the RK4 stage evaluation (shared
per-stage metric block, hoisted conserved-product nodes, carried segment-start
height). Provably identical trajectories (term-for-term operation order);
kerr/integrator/ray parity corpora and all 40 goldens unchanged. Its frame-time
effect sits below this environment's quantized measurement floor; it is kept as
strictly-less-work with zero drift risk.
