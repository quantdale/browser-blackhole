# Cosmic Atlas benchmark matrix

## 1. Goals

Benchmarks must expose the dominant cost of each renderer class and detect regressions in destination switching, memory, ray tracing, volumes, compute particles and data interpolation.

## 2. Common metadata

Every run records:

```text
commit SHA
destination + preset
browser/version
OS
renderer backend
adapter/device info if available
viewport CSS size
devicePixelRatio
effective DPR
internal pixel dimensions
quality tier
render scale
target FPS
warmup frames
sample frames
CPU median/p95/p99
GPU median/p95/p99 if timestamp query available
estimated scene-local GPU bytes
particle/tracer count
volume resolution/steps
ray quality/max steps
transition state
notes
```

## 3. Common viewport cases

At minimum:

- 1280x720 DPR 1;
- 1920x1080 DPR 1;
- representative high-DPR mobile CSS viewport using capped internal DPR.

Ultra/4K tests are optional hardware-specific benchmarks, not universal CI gates.

## 4. Destination benchmark scenes

### CA-BENCH-BH-01 — Black-hole typical

Purpose: preserve existing renderer baseline inside Atlas host.

Fixed camera and deterministic disk/star preset.

Metrics:

- frame time;
- ray statistics if available;
- host overhead vs standalone baseline.

Acceptance: Atlas wrapper must not cause material unexplained regression.

### CA-BENCH-NS-01 — Neutron-star surface

- high compactness;
- hot spots visible;
- no magnetosphere particles.

Measures surface ray tracing.
Harness: `npm run bench:neutron-star -- --preset=surface --quality=medium` (M12-NS, same record schema as black-hole harness; reports `frameCpuMs`/`frameGpuMs`, `surfaceRayBackend`, `effectiveRenderSize`, `quality` tier, backend/adapter; paused at phase 0).

### CA-BENCH-NS-02 — Pulsar full

- surface lensing;
- rotating spots;
- field lines;
- beams/particles.

Measures combined cost.
Harness: same `bench:neutron-star` entry with `--preset=pulsar` (or `magnetar` for flare-active workload).

### CA-BENCH-SN-01 — Supernova interactive

- active volume;
- medium particle count;
- camera motion.

Measure volume and particle cost under INTERACTING mode.

### CA-BENCH-SN-02 — Supernova stable

Same preset stationary after refinement.

Measures stable-state visual quality cost.

### CA-BENCH-CM-01 — Compact merger contact

Most expensive phase:

- both compact objects;
- ejecta;
- volume;
- jet-ready structures.

### CA-BENCH-CM-02 — Kilonova late

Tests expanding volume/particles without inspiral overhead.

### CA-BENCH-BBM-01 — Binary black-hole merger

- reference data playback;
- waveform UI;
- standard illustrative lensing.

### CA-BENCH-TDE-01 — Peak debris

- black-hole lensing;
- maximum stream ribbon;
- ejecta particles;
- shock volume.

### CA-BENCH-AGN-01 — Inner scale

- full central GR;
- corona;
- inner jet.

### CA-BENCH-AGN-02 — Galactic scale

- host galaxy;
- extended jet;
- central proxy.

Checks that distance LOD actually removes unnecessary inner cost.

### CA-BENCH-GAL-01 — Galaxy collision peak

- maximum launch-quality tracer count;
- keyframe interpolation;
- tidal tails;
- gas/starburst overlays.

### CA-BENCH-TRANSITION-01 — preloaded travel

A -> B with target module/assets already prepared.

Measure:

- transition frame p95;
- max main-thread task;
- peak resource estimate;
- swap hitch.

### CA-BENCH-TRANSITION-02 — streaming travel

Target essential assets not cached.

Measure responsiveness while preparing and absence of transition mid-stall.

## 5. Navigation leak benchmark

Mandatory automated tour:

```text
Black Hole
→ Neutron Star
→ Stellar Explosion
→ Compact Merger
→ TDE
→ Quasar
→ Galaxy Collision
→ Black Hole
```

Repeat at least 3 cycles in CI/local smoke, more in soak testing.

Capture after each disposal:

- ResourceScope counts;
- estimated destination GPU bytes;
- Worker count;
- listener/subscription count;
- active fetch count;
- Three.js renderer memory counters where meaningful.

Failure condition:

Monotonic unbounded growth not explained by a documented bounded cache.

## 6. Long-run thermal/quality test

Manual/device-lab benchmark:

- run representative heavy destination for 10–20 minutes;
- interact periodically;
- record render scale and frame timing trend;
- observe thermal throttling behavior where device exposes it indirectly through frame time;
- verify quality governor degrades gracefully rather than oscillating.

## 7. Performance regression thresholds

Initial policy after baselines exist:

- > 10% median regression: investigate;
- > 15% p95 regression: block unless justified by a measured quality/correctness gain;
- substantial memory growth: block until explained;
- transition p95 > target budget: investigate swap/compile/upload causes.

Thresholds can be refined after real hardware data.

## 8. Benchmark integrity

Never compare runs with different:

- internal resolution;
- quality tier;
- particle count;
- volume steps;
- destination phase;
- browser backend;

without explicitly normalizing or explaining the difference.

## 9. Recorded results — Stellar Explosion (CA4, M5+CA4 campaign)

Hardware: amd rdna-2 (hardware WebGPU), Microsoft Edge headless, Windows.
Viewport 1280x800 (canvas region ~960x800 CSS after product panel), DPR 1,
warmup 9 s, 600 samples via scripts/bench-stellar-explosion.mjs (timeline
paused at the listed normalized phase; tier pinned explicitly and canvas
re-sized after the pin).

| label             | preset           | phase | tier   | internal px | median ms | p95 ms |
| ----------------- | ---------------- | ----- | ------ | ----------- | --------- | ------ |
| sn-low-progenitor | core-collapse    | 0.03  | low    | 583x436     | 7.0       | 7.1    |
| sn-low-flash      | core-collapse    | 0.24  | low    | 583x436     | 7.0       | 13.8   |
| sn-low-expansion  | core-collapse    | 0.55  | low    | 583x436     | 7.0       | 7.1    |
| sn-low-hypernova  | hypernova        | 0.55  | low    | 583x436     | 7.0       | 7.1    |
| sn-low-grb        | long-grb-on-axis | 0.42  | low    | 583x436     | 7.0       | 13.9   |
| sn-med-progenitor | core-collapse    | 0.03  | medium | 768x640     | 7.0       | 7.1    |
| sn-med-flash      | core-collapse    | 0.24  | medium | 768x640     | 7.0       | 13.8   |
| sn-med-expansion  | core-collapse    | 0.55  | medium | 768x640     | 7.0       | 7.1    |
| sn-med-hypernova  | hypernova        | 0.55  | medium | 768x640     | 7.0       | 7.1    |
| sn-med-grb        | long-grb-on-axis | 0.42  | medium | 768x640     | 13.9      | 20.9   |
| sn-high-expansion | core-collapse    | 0.55  | high   | 960x800     | 7.0       | 7.1    |
| sn-high-grb       | long-grb-on-axis | 0.42  | high   | 960x800     | 20.8      | 27.8   |

Reading: most phases are vsync-idle (~7 ms submission wall time); the GRB jet
phase is the heaviest workload (half-res volume + jet factor + full particle
population) yet stays far inside the 33.3 ms/30 Hz Medium budget and clears
16.7 ms/60 Hz median at Medium; High remains above 30 FPS p95.

Methodology note (defect found while measuring): pinning a tier changes
`governor.renderScale` but nothing re-applies canvas sizing — the first
medium run silently measured Low-resolution frames (583x436). The harness now
calls `host.handleResize(...)` immediately after the pin; the same re-apply is
required by any deterministic capture flow (see GOLDEN_IMAGES.md).
