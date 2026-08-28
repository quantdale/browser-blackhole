# WS0 / tasks.md §0 — whole-atlas performance baseline

Campaign: `openspec/changes/whole-atlas-performance-optimization`
Recorded: 2026-08-28
Commit: `90b107ec63ebb988bb2145048383187c50ccef2f`
Working tree: clean at capture (`git status --short` empty)

## Environment

| Field | Value |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200 (win32) |
| Node / npm | v24.3.0 / 11.4.2 |
| three | 0.185.1 |
| Vite / Playwright / TypeScript / Vitest | 8.2.2 / 1.62.1 / 5.9.3 / 4.1.11 |
| Browser | Playwright `msedge` 151.0.0.0, headless |
| Adapter | **intel gen-12lp** (integrated), `timestampQuery: true`, storage buffers, float render targets, maxTextureSize 8192 |
| devicePixelRatio | 1 |
| Viewport (CSS) | 1280x800 |
| Warmup / sample | 9000 ms / 600 frames per row (some harnesses 400/480) |

**Adapter caveat, and it is not a formality.** Every previously committed
campaign number in `docs/PERFORMANCE.md` and `docs/BENCHMARK_MATRIX.md` was
recorded on an `amd rdna-2` adapter. Nothing below may be compared against
those. This is a fresh baseline for this machine, to be differenced only
against future runs on this machine.

## Why this baseline is trustworthy where the previous harness was not

WS1 (frame invalidation) landed after the bench harnesses were written. Every
harness pauses the timeline before sampling — which, post-WS1, is a scene that
legitimately renders nothing. Measured directly: with the fix removed, a
harness reports `framesRendered: 0`, `framesSkipped: 601`,
`destinationDrawn: false` and STILL prints `medianMs: 6.1`, the same value as
a correct run. The old record shape could not distinguish the two.

Every row below therefore carries `renderTelemetry` proving the sampled
window actually rendered, and every row reads **frames rendered == frames
observed**. A harness that renders nothing now exits non-zero with an
explicit refusal instead of emitting a plausible number.

## Matrix — all eight production destinations plus the Kerr characterization

| harness | preset | backend | tier | scale | internal | cpu p50 ms | cpu p95 ms | GPU ms | frames rendered | draw calls | programs | targets | info bytes | scope bytes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| black-hole-merger-webgl2 | sxs-bbh-0001-inspiral | webgl2 | low | 0.6 | 583x436 | 6.1 | 6.2 | 1.11 | 401/401 | 28 | 26 | 13 | 7154088 | 14665884 |
| black-hole-merger-webgpu | sxs-bbh-0001-inspiral | webgpu | low | 0.6 | 583x436 | 6.1 | 6.2 | 0.39 | 402/402 | 28 | 26 | 13 | 7166229 | 14665884 |
| black-hole-webgl2 | default | webgl2 | medium | 0.8 | 778x581 | 24.4 | 30.5 | 22.57 | 604/604 | 15 | 20 | 13 | 16248386 | 7287208 |
| black-hole-webgpu | default | webgpu | medium | 0.8 | 778x581 | 24.3 | 48.5 | 20.12 | 604/604 | 15 | 20 | 13 | 16249123 | 7287208 |
| compact-merger-webgl2 | equal-mass-nsns | webgl2 | medium | 0.8 | 778x581 | 6.1 | 6.2 | 2.28 | 482/482 | 18 | 31 | 14 | 14658867 | 7737416 |
| compact-merger-webgpu | equal-mass-nsns | webgpu | medium | 0.8 | 778x581 | 6.1 | 6.2 | 2.03 | 482/482 | 18 | 31 | 14 | 14868080 | 7737416 |
| galaxy-collision-webgl2 | bridge-tail | webgl2 | medium | 0.8 | 768x640 | 6.1 | 6.2 | 2.78 | 602/602 | 16 | 20 | 13 | 15326754 | - |
| galaxy-collision-webgpu | bridge-tail | webgpu | medium | 0.8 | 768x640 | 6.1 | 6.2 | 0.39 | 601/601 | 16 | 20 | 13 | 15321503 | - |
| kerr-webgl2 | kerr-high-prograde | webgl2 | medium | 0.8 | 778x581 | 103 | 109.1 | 93.11 | 604/604 | 3 | 10 | 2 | 10798878 | 4918696 |
| kerr-webgpu | kerr-high-prograde | webgpu | medium | 0.8 | 778x581 | 206.1 | 406.1 | 192.35 | 605/605 | 3 | 10 | 2 | 10804979 | 4918696 |
| neutron-star-webgl2 | surface | webgl2 | medium | 0.8 | 778x581 | 30.3 | 36.4 | 26.4 | 484/484 | 4 | 12 | 2 | 10913112 | 4541644 |
| neutron-star-webgpu | surface | webgpu | medium | 0.8 | 778x581 | 54.4 | 103 | 50.66 | 485/485 | 4 | 12 | 2 | 10915115 | 4541644 |
| quasar-agn-webgl2 | quasar-reference | webgl2 | low | 0.6 | 583x436 | 6.1 | 6.2 | 1.44 | 402/402 | 26 | 27 | 14 | 7175245 | 11294992 |
| quasar-agn-webgpu | quasar-reference | webgpu | low | 0.6 | 583x436 | 6.1 | 6.2 | 1.38 | 402/402 | 26 | 27 | 14 | 7171681 | 11294992 |
| stellar-explosion-webgl2 | core-collapse | webgl2 | medium | 0.8 | 768x640 | 6.1 | 6.3 | 4 | 605/605 | 17 | 26 | 14 | 16474402 | - |
| stellar-explosion-webgpu | core-collapse | webgpu | medium | 0.8 | 768x640 | 6.1 | 6.2 | 3.6 | 602/602 | 17 | 26 | 14 | 16530987 | - |
| tidal-disruption-webgl2 | solar-canonical | webgl2 | medium | 0.8 | 778x581 | 6.1 | 6.2 | 2.56 | 482/482 | 22 | 31 | 14 | 14672367 | 7750152 |
| tidal-disruption-webgpu | solar-canonical | webgpu | medium | 0.8 | 778x581 | 6.1 | 6.2 | 2.29 | 483/483 | 22 | 31 | 14 | 14886646 | 7750152 |

Raw records: one JSON per row in this directory, `schemaVersion: 2`.

## How to read the columns

- **GPU ms** — hardware timestamp queries (three `trackTimestamp`): the summed
  render-pass time of the final resolved frame. A single frame, not a
  distribution.
- **cpu p50/p95 ms** — rAF deltas on the CPU side. These **floor at ~6.1 ms**
  on this host: every cheap destination reports exactly 6.1/6.2, which is the
  frame-scheduling interval, not render cost. Read the GPU column alone for
  those rows. Above the floor the two agree closely (kerr 206 CPU vs 192 GPU;
  neutron star 54 vs 51; black hole 24 vs 20), which is what makes the heavy
  rows credible: two independent accountings, no calibration between them.
- **info bytes** vs **scope bytes** — `renderer.info.memory.total` versus the
  repository's own `ResourceManager` estimate. They measure different things
  (the former includes shared post/transition targets attributed to the
  renderer, the latter is per-scope ownership) and are deliberately both
  recorded rather than reconciled.
- Two harnesses (galaxy-collision, stellar-explosion) do not emit the
  ResourceManager total; that is a harness gap, recorded as `-` rather than
  filled in.

## Findings that should steer the campaign

**1. Kerr dominates everything, by two orders of magnitude.** At medium tier
and 0.8 render scale, `kerr-high-prograde` costs 192 ms GPU per frame while
six of the nine rows sit between 0.4 and 4 ms. This confirms the MASTER_PLAN's
ordering: §14 (Kerr) is the primary GPU program, and no amount of work on the
cheap destinations changes the product's worst case.

**2. Neutron star is the unexpected second-heaviest** at 51 ms GPU — more than
twice the full numerical Schwarzschild black hole (20 ms). The plan treats
neutron star as a minor destination (§15, mostly caching and early
termination). This baseline says it deserves attention closer to the
strong-field destinations.

**3. WebGL2 is roughly TWICE AS FAST as WebGPU on the two heaviest
full-screen shaders on this adapter** — kerr 93 vs 192 ms, neutron star 26 vs
51 ms — while the cheap destinations are within noise of each other. Both the
CPU and GPU columns agree on this independently, so it is unlikely to be a
timestamp-semantics artifact between backends.

This is a single integrated adapter and one browser, so it is a lead, not a
conclusion. But it is a large, reproducible, backend-attributable gap on the
exact code paths the campaign is about, and it should be characterized before
any Kerr shader micro-optimization is attempted: if the WebGPU pipeline is
leaving a 2x on the table for structural reasons, that is a bigger win than
the integrator work, and optimizing the shader first would be optimizing the
wrong layer.

## Not recorded here (explicitly, rather than silently)

- **Cold vs warm navigation timing per destination** — not implemented in the
  harnesses.
- **First-interactive timing** — deliberately omitted; see the WS3 artifact
  (`../2026-08-28-ws3-startup/SUMMARY.md`) for why browser timing on this host
  is treated as the weakest evidence class. Bundle/chunk bytes are recorded
  there and are deterministic.
- **Per-quality-tier sweeps** — every row is the harness default (medium, or
  low where the governor pinned low); no low/high/ultra ladder.
- **Distributions of GPU time** — the timestamp path reports one resolved
  frame, not percentiles.
- **A second machine.** Everything here is one adapter.
