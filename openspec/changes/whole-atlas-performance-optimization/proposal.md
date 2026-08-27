# Proposal: Whole-Atlas performance optimization

Change ID: whole-atlas-performance-optimization
Priority: HIGH
Planned-From: main@e2fadde55a39834e2438d56a568f18788b7c7ced
Planned-At: 2026-08-27
Target-Branch: main

## Why

Cosmic Atlas is production-certified, but its performance profile is highly uneven. Most non-black-hole destinations are already inexpensive on the campaign GPU, while strong-field full-screen ray tracing can consume tens to hundreds of milliseconds per frame. Hosted software WebGL2 has demonstrated pathological seconds-per-frame behavior for heavy TSL/Kerr paths.

A repository-wide runtime audit also found work that can be removed without changing pixels:

- stationary/paused frames still flow through the continuous frame pipeline;
- an incoming destination can render beneath a fully opaque transition interval;
- the flagship black-hole prepares numerical Schwarzschild, LUT Schwarzschild and numerical Kerr passes together although exactly one is rendered;
- VolumeService runtime quality changes sample spacing but do not change its compile-time march-loop bound;
- AGN static particle fields are updated every visible GALACTIC frame;
- black-hole merger prepares an invisible Kerr remnant during inspiral;
- galaxy collision interpolates and uploads its entire tracer field on every update, even when phase is unchanged, and allocates small scratch arrays per call;
- heavy black-hole and neutron-star implementations are imported during registry startup instead of following the lightweight descriptor pattern used by Galaxy Collision.

The project should first eliminate these classes of waste, then tackle the scientifically hard Kerr/Schwarzschild work with measured equal-fidelity algorithmic optimization.

## What changes

This OpenSpec defines a multi-campaign optimization program covering:

- performance telemetry and benchmark discipline;
- render invalidation/on-demand stationary frames;
- page-visibility behavior;
- transition occlusion and shader precompile;
- startup/code-splitting and destination lazy loading;
- active-only black-hole lensing pass lifecycle;
- volume runtime step budgets and ROI/culling;
- particle/static-system activity semantics;
- ribbon/buffer update revisioning;
- post/bloom cost;
- workload-aware global governor knobs;
- Schwarzschild numerical/LUT optimization;
- Kerr integrator optimization;
- neutron-star surface lensing;
- stellar explosion;
- compact merger;
- tidal disruption;
- quasar/AGN;
- black-hole merger;
- galaxy collision;
- WebGL2 fallback;
- resource/memory certification;
- worker/OffscreenCanvas research only where measured.

The authoritative implementation sequencing and detailed requirements live in MASTER_PLAN.md.

## Non-goals

- redesigning the visuals;
- adding new astrophysical destinations;
- weakening scientific tests, failure policy, parity tolerances or golden thresholds to obtain a speedup;
- silently replacing explicit numerical backends with different backend semantics;
- making WebGPU mandatory;
- migrating the entire renderer to a worker before profiling proves main-thread submission is a bottleneck;
- replacing the explicit ResourceScope lifecycle with garbage-collection assumptions;
- optimizing already-cheap destinations through risky approximation merely to improve benchmark numbers.

## Success criteria

- reproducible before/after evidence exists for all eight production destinations;
- stationary paused scenes stop issuing continuous destination draws;
- guaranteed-occluded transition windows stop rendering hidden destination pixels;
- black-hole first arrival constructs only the active strong-field pass;
- volume tier changes reduce actual march evaluations;
- static/zero-population particles do not simulate unnecessarily;
- galaxy collision skips unchanged interpolation/uploads;
- black-hole and neutron-star heavy implementation modules are loaded on demand;
- Kerr has a meaningful equal-fidelity improvement or rejected prototypes are documented with honest evidence;
- all visual/scientific/lifecycle gates remain green;
- no unbounded memory/program growth is introduced;
- forced WebGL2 remains supported;
- final performance certification documents remaining limitations rather than claiming universal 60 FPS.
