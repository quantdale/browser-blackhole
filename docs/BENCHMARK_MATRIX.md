# Benchmark matrix and reporting format

This document defines reproducible performance experiments. It prevents vague claims such as “60 FPS on my PC” from becoming design evidence.

## 1. Benchmark record

Every stored result must include:

```json
{
  "schemaVersion": 1,
  "date": "ISO-8601",
  "commit": "git sha",
  "browser": {"name": "", "version": ""},
  "os": "",
  "adapter": {"vendor": "", "architecture": "", "device": "", "description": ""},
  "backend": "webgpu",
  "viewportCss": [1280, 720],
  "devicePixelRatio": 1,
  "effectiveRenderSize": [1280, 720],
  "preset": "BENCH_TYPICAL",
  "quality": {},
  "warmupFrames": 120,
  "sampleFrames": 600,
  "frameCpuMs": {},
  "frameGpuMs": {},
  "notes": ""
}
```

Adapter metadata may be unavailable/reduced for privacy/platform reasons. Record what the API exposes; do not fingerprint beyond project debugging needs.

## 2. Scene presets

### BENCH_EASY

- Schwarzschild;
- disk disabled;
- observer relatively far;
- star background;
- view avoids maximizing photon-ring screen area;
- no bloom for raw geodesic baseline.

Purpose: lower bound and environment/escape throughput.

### BENCH_TYPICAL

- Schwarzschild;
- inclined thin disk;
- scientifically representative hero framing;
- Doppler/redshift enabled;
- normal HDR pipeline;
- Auto-temporal state controlled/frozen for repeatability.

Purpose: default product workload.

### BENCH_CRITICAL

- camera framing places a large strong-field/photon-ring region on screen;
- disk present;
- high winding rays represented.

Purpose: divergence and max-step stress.

### BENCH_DISK_GRAZE

- geometry chosen to produce many disk crossing refinements/grazing candidates.

Purpose: event detection cost.

### BENCH_POST

- simple ray geometry;
- bloom/temporal/post chain enabled at representative high quality.

Purpose: isolate non-geodesic GPU cost.

### BENCH_LUT

Same visual state as numerical benchmark but optimized LUT backend.

Purpose: apples-to-apples backend comparison.

### BENCH_KERR

Added only after M9; includes moderate/high-spin cases.

## 3. Resolution matrix

Minimum release profiling resolutions:

- 640x360 internal;
- 960x540;
- 1280x720;
- 1600x900;
- 1920x1080;
- one portrait/mobile internal size.

Higher resolutions may be sampled on appropriate hardware. Do not require 4K real-time ray tracing as baseline product success.

## 4. Device classes

Collect evidence across representative classes when available:

- modern integrated laptop GPU;
- midrange discrete GPU;
- high-end discrete GPU;
- modern mobile/tablet GPU through a supported browser;
- software/virtualized environment only for functional fallback, not performance claims.

Do not encode specific vendor models as permanent product tiers.

## 5. Browser/backend matrix

Performance primary:

- Chromium-family WebGPU implementation.

Functional comparison where practical:

- forced WebGL2 through `WebGPURenderer` fallback;
- Safari WebGPU on supported hardware;
- Firefox WebGPU when browser/platform support is available and stable enough for release testing.

Record exact version. Browser GPU implementations evolve materially.

## 6. Sampling statistics

For frame times report:

- min only for diagnostics, never headline;
- median;
- p90;
- p95;
- p99;
- max separately, with note about compilation/OS spikes;
- standard deviation or MAD when useful.

For FPS, derive from frame time for readability but preserve frame-time percentiles.

## 7. Warm-up protocol

Before collection:

- load all benchmark assets;
- compile shader/pipelines by rendering representative frames;
- wait for dynamic quality to be disabled or stabilized per test;
- discard a fixed warmup window;
- confirm tab is visible and viewport stable.

## 8. Auto-mode experiments

Auto quality needs separate dynamic tests rather than fixed-setting benchmarks.

Scenarios:

1. start underpowered: verify scale decreases and stabilizes;
2. start with spare budget: verify gradual increase;
3. alternate easy/critical camera views: verify no oscillation;
4. sustained thermal slowdown: verify graceful adaptation;
5. resize large/small: verify correct scale recovery;
6. camera move then stop: verify moving -> settling -> stationary transitions.

Metrics include time to stabilize, number of scale changes, minimum/maximum scale, frame-time overshoot, and temporal reset count.

## 9. Numerical efficiency experiments

For a selected ray corpus compare integrators/step policies by:

- integration evaluations;
- wall/GPU time proxy where measurable;
- classification correctness;
- minimum-radius error;
- escape-direction angular error;
- disk-hit error;
- failure rate.

Do not rank methods only by steps because one step may require different numbers of derivative evaluations.

## 10. LUT comparison

For each paired preset:

- numerical reference render at high quality;
- production numerical render;
- LUT render;
- pixel/perceptual diff;
- selected-ray geometry error;
- median/p95 GPU time;
- memory footprint and LUT sampling cost.

The LUT backend is accepted only if it provides a meaningful performance/quality tradeoff.

## 11. Result storage

Suggested structure after harness exists:

```text
benchmarks/
  README.md
  schema.json
  baselines/
    webgpu/
  results/
    2026-...json
  reports/
    milestone-m6.md
```

Large raw traces/screenshots should use an appropriate artifact mechanism rather than bloating Git history.

## 12. Regression comparison

A comparison script should reject mismatched benchmark metadata unless explicitly overridden. It should surface changes in:

- internal resolution;
- backend;
- preset revision;
- quality parameters;
- browser major version;
- GPU/adapter;
- sample count.

Only comparable runs produce a percentage regression claim.

## 13. Release report

M11 report summarizes:

- tested environments;
- default/Auto performance;
- highest stable scientific quality per class;
- known browser/backend limitations;
- LUT vs numerical tradeoff;
- mobile behavior;
- startup timing;
- memory observations;
- unresolved performance debt.