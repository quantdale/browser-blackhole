# Architecture and product decisions

This file records planning decisions that implementation agents should treat as defaults until evidence justifies a change. If a decision changes, update this document with the reason, consequences, and migration impact.

## ADR-001 — Browser-first static application

**Decision:** Build the core experience as a client-side browser application deployable as static HTTPS assets.

**Why:** The workload is naturally GPU-local; no server is needed for real-time rendering. Static deployment simplifies iteration and avoids coupling scientific rendering to backend availability.

## ADR-002 — TypeScript + Vite + Three.js

**Decision:** Use TypeScript and Vite with Three.js as the browser/rendering integration layer.

**Why:** Fast development loop, direct browser/GPU access, strong ecosystem, and current Three.js WebGPU/TSL support.

## ADR-003 — WebGPU/TSL primary renderer

**Decision:** Prefer Three.js `WebGPURenderer` and TSL for the primary renderer.

**Why:** Modern GPU access and a path toward shared shader logic/fallbacks while staying inside Three.js-supported abstractions.

**Caveat:** WebGPU/TSL APIs evolve. M0 must pin exact compatible versions and validate the API against current official docs.

## ADR-004 — Full-screen GPU ray renderer

**Decision:** Primary image generation uses a full-screen GPU pass, ideally one full-screen triangle.

**Rejected:** Building the core black-hole image from ordinary Three.js meshes or CPU pixel loops.

**Why:** The physically interesting operation is photon propagation per screen pixel, which maps directly to GPU parallelism.

## ADR-005 — Schwarzschild before Kerr

**Decision:** Build and validate a non-rotating Schwarzschild renderer before introducing spin/Kerr spacetime.

**Why:** Schwarzschild provides a simpler symmetry-rich correctness target and a reference against which the Kerr `spin -> 0` limit can later be tested.

## ADR-006 — Numerical renderer before LUT optimization

**Decision:** First implement a numerical Schwarzschild geodesic renderer; only later add the Bruneton-style precomputed/LUT backend.

**Why:** An independent numerical renderer/reference is required to validate LUT coordinate mappings and interpolation errors. Starting with optimized lookup code would make scientific mistakes harder to isolate.

## ADR-007 — CPU/WASM is reference/precompute, not primary rendering

**Decision:** CPU TypeScript and optional Rust/WASM may solve a small number of high-precision/reference rays or generate data offline, but the real-time image remains GPU-rendered.

## ADR-008 — Fragment/full-screen path before compute

**Decision:** Use the normal full-screen fragment/raster path for per-pixel rays. Add compute only for workloads where it changes the algorithm or data flow.

**Candidate compute workloads:** LUT generation, tile classification, adaptive sampling maps, temporal statistics, compacted queues, or procedural simulations.

## ADR-009 — Thin disk before volumetric radiative transfer

**Decision:** Initial accretion disk is a geometrically thin equatorial emitter intersected along curved photon paths.

**Why:** It reproduces the major lensing signatures at much lower implementation cost and provides clean validation geometry. Finite-thickness/volumetric transfer can be a later extension.

## ADR-010 — Separate physical, observer, rendering, and visual controls

**Decision:** State and UI must visibly distinguish physical/model parameters from numerical quality and post-processing parameters.

**Why:** Bloom, exposure, step count, and render scale are not properties of a black hole. Keeping them separate prevents misleading UX and makes reproducible presets possible.

## ADR-011 — Mass does not mean arbitrary lens strength

**Decision:** Support normalized `r_g` mode and physical-distance mode. Do not map mass directly to a fake distortion multiplier.

**Why:** Schwarzschild solutions in gravitational-radius units are scale invariant.

## ADR-012 — Auto quality is first-class

**Decision:** Runtime quality should adapt using capability detection plus measured frame timing, with conservative DPR/render-scale limits.

**Why:** Ray cost scales strongly with internal pixel count and trajectory complexity. Browser/device labels are poor proxies for actual performance.

## ADR-013 — Temporal refinement comes after deterministic correctness

**Decision:** Build deterministic single-frame rendering first; add accumulation/reprojection only when resets and motion transforms can be tested.

**Why:** Temporal techniques can hide or smear physical/shader errors and complicate visual regression.

## ADR-014 — Workers are evidence-driven

**Decision:** Keep initial rendering on the main thread. Introduce Web Workers/OffscreenCanvas only for measured CPU/UI bottlenecks or expensive reference/precompute jobs.

## ADR-015 — External code requires provenance review

**Decision:** Papers and repositories in `docs/RESEARCH_REFERENCES.md` are references. Before adaptation, record exact source revision, license, reused algorithm/code, and required attribution.

## ADR-016 — Scientific failure must be observable

**Decision:** Rays that hit numerical limits/failure are never silently rendered as captured/horizon pixels. Debug classification and telemetry must expose them.

## ADR-017 — Milestone integration order is authoritative

**Decision:** Research can run ahead in parallel, but production integration follows `docs/ROADMAP.md` unless this ADR set is deliberately revised.

## ADR-018 — Kerr backend: Boyer-Lindquist Hamiltonian for M9 (Kerr-Schild designated for M10 plunge)

**Decision:** The M9 Kerr renderer is a DISTINCT numerical backend — first-order
Boyer-Lindquist null-Hamiltonian RK4 over (r, theta, phi, p_r, p_theta) with
fixed conserved E and L_z, static-observer tetrad initialization, signed
dimensionless spin, and the locked disk-corotating spin convention. Full
convention/provenance authority: `docs/KERR_BACKEND_ADR.md`. CPU oracle:
`src/phenomena/black-hole/kerr/`; GPU: `kerrIntegrator.ts` beside it.

**Why:** exact smooth a->0 correspondence with the validated Schwarzschild
system in identical coordinates (the M9-08 release gate), smallest viable
state, no turning-point sign bookkeeping, and capture termination that never
exercises the BL horizon singularity. Kerr-Schild ingoing coordinates remain
the DESIGNATED migration path if M10 plunge observers require integrating
through the horizon; the tradeoff record lives in KERR_BACKEND_ADR §1.10.

**Consequences:** the LUT backend stays Schwarzschild-only and is truthfully
inapplicable while metric=kerr; coordinate-pole passages carry an explicit f32
limitation with a mirrored CPU/GPU honesty gate (ADR §1.19); the UI exposes
signed spin through the canonical destination-control channel only.
