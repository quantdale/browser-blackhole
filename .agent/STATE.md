# Durable project state

Last update: 2026-08-24 (M8 CLOSURE CAMPAIGN) — **M8 IS CLOSED.** All nine
packets complete with measured evidence. Auto default is now the LUT
trajectory backend (`LUT_AUTO_DEFAULT = true` in
`src/atlas/trajectoryPolicy.ts`), flipped only after the pre-registered
decision criterion in `docs/LUT_BACKEND_ADR.md` §11 was met by the paired
measurements in §12 (`benchmarks/results/2026-08-23-m8/`).

## Current phase

**M8 CLOSED (M8-01..09 + validation debt). Next: CA5 Compact Merger
(`docs/cosmic-atlas/WORK_PACKETS.md` CA5-01..17) — the next production
Cosmic Atlas destination. M9 Kerr is explicitly NOT started.**

Commit chain this campaign:
```
82c4dfa feat: make trajectory backend preference canonical (M8-09)
e9c53ac perf: close schwarzschild lut benchmark harness and fix decision criterion
a20a7a9 fix: close m8 lut gpu-path defects, flip measured auto default, extend parity corpora
```

## M8 packet status

| Packet | Status | Evidence |
| --- | --- | --- |
| M8-01..07 | DONE (prior sessions) | see git history; lutEquivalence/lutRuntime/lutSchema/lutPipeline unit gates |
| M8-08 performance | **DONE** | `scripts/bench-black-hole.mjs` rewritten (matched-comparison harness: backend/preset/quality/viewport/render-scale/warmup/frames/channel/label/commit options; quality honored + mismatch warning; full BENCHMARK_MATRIX-shaped record; honest rAF=frame-time labeling). Paired campaign: median −49..−83 % (LUT) on default/face-on/edge-on at two resolutions; photon-ring tie; p95 never regressed; repeats sign-stable. Raw JSON in `benchmarks/results/2026-08-23-m8/`. |
| M8-09 backend policy | **DONE** | `TrajectoryBackendPreference` canonical in `CosmicAtlasStateV1.rendering.trajectoryBackend` (normalize/validate/serialize `tb=`/parse/UI select/debug readout). Precedence: `?trajectory=` dev override (captured once at module construction — route canonicalization rewrites the URL mid-session) > canonical preference > auto gate + readiness. Unavailable LUT falls back with explicit reason in the module debug snapshot (`host.activeDestinationDebugSnapshot()`), never silently. |
| Validation debt | **DONE** | Browser parity corpus extended to BOTH execution paths (webgpu/webgl2 × numerical/lut, 4 rows) with execution-path guards. NEW cross-backend disk/g-factor corpus (`tests/browser/lut-disk-parity.spec.ts`): whole-frame equivalence 0.09/255 mean after the fixes; per-point disk luminance agreement ≤8/255. |

## M8 GPU-path defects found by the new coverage — ALL FIXED (root cause)

Extending browser coverage to the LUT path exposed three real defects in
`lut/lensingGpu.ts` that the CPU-level corpus had deferred (its
terminal-direction tolerance was logged, never asserted):

1. FRAME-ORIGIN: rows/aux are in launch coordinates (φ=0 at the r_ref=64
   inbound crossing) but the pass embeds φ=0 at the observer; the code used
   `psiApsis` directly, rotating every LUT ray by `psiApsis − launchRow`.
   Fixed mapping: folded row `|φ_obs − launchRow|`, exit azimuth
   `launchRow + arcEnd`. Captured-class columns route explicitly to the
   numerical oracle (no launch-frame alignment data in this family).
2. CROSSING SELECTION: the ascending-arc loop re-selected the same crossing
   on every pass (window `>=` with per-pass reset best) → disk emission up to
   4×. Exclusion now by candidate azimuth (folded rows cannot distinguish
   inbound/outbound branch partners that share a row).
3. PHI-STAR RATIO: plane-height zero used `atan(e1.y/−e0.y)` (perpendicular
   angle) instead of `atan(−e0.y/e1.y)` → disk image transplanted ≈90°.

Post-fix: numerical-vs-LUT whole-frame mean delta 0.09/255 (doppler-demo,
forced linear chain); sky terminal-direction agreement ≤ ~1° on both APIs;
BH_CLASSIC golden passes THROUGH the LUT path (auto default).

## M8-08 decision record

Criterion FIXED BEFORE measurement (ADR §11): LUT auto-adoption requires
≥10 % median win on the representative preset, no scene median regression
>5 %, p95 regression ≤10 %, sign-stable repeats per scene, equivalence green.
Outcome (ADR §12): 49–83 % median improvements, photon-ring 0 % tie, all
clauses PASS → `LUT_AUTO_DEFAULT = true` with regression tests
(`tests/unit/trajectoryPolicy.test.ts`, `tests/browser/trajectory-backend.spec.ts`).
Numerical remains explicitly selectable; every fallback is truthful and
surfaced in diagnostics.

## Validation evidence (this campaign, final state)

| Gate | Result |
| --- | --- |
| npm run check | PASS — prettier/eslint/tsc clean, vitest **266/266**, build OK |
| lut:validate | PASS — `npm run lut:validate -- public/luts/schwarzschild-v1-415dea94` (manifest + sha256 OK) |
| Playwright | **53/53 ×2 consecutive** (goldens stable twice, no regeneration; second run required no updates) |
| Parity | integrator corpus 4/4 rows (api × trajectory); cross-backend disk corpus green |
| Benchmarks | paired records committed under `benchmarks/results/2026-08-23-m8/` |

Environment: Windows 11, Node v22.23.2, Edge 151 (msedge channel), hardware
WebGPU (adapter "amd rdna-2", timestampQuery exposed but NOT used — all frame
numbers are rAF CPU-side deltas, quantized to the ~6.94 ms 144 Hz vsync).

## Known debt / limitations (updated)

1. gFactorRelativeErrorMax=0 placeholder in v1 manifests (unchanged).
2. hybridBandHalfWidthX=0 for reachable physics (unchanged).
3. Captured-class LUT columns are routed to the numerical oracle inside the
   LUT material (this family carries no launch-frame alignment data for
   them); making captured columns LUT-resolvable would need a schema
   addition — deferred, numerically harmless.
4. Shipped disk emission presents NO left-right Doppler beaming asymmetry
   (grayscale emission; BH_CLASSIC golden pins the symmetric presentation).
   The g denominator exists in code but the presented model is symmetric —
   documented in lut-disk-parity.spec.ts; changing it is an M4-scoped
   physics/presentation decision, not assumed silently.
5. LUT assets load eagerly whenever the black hole prepares (~2.1 MiB GPU
   textures) regardless of selected backend; backend-conditional loading is
   future optimization.
6. Near-critical terminal directions remain intrinsically sensitive
   (log winding divergence); measured cross-backend sky agreement ≤ ~1° away
   from the critical curve (lutEquivalence angular tolerance remains
   category-specific and now has browser-level backing).

## Next actions

1. CA5-01..03: compact-merger fidelity conventions, nonlinear phase
   timeline, inspiral trajectory/reference + unit corpus
   (`tests/unit/compactMergerPhysics.test.ts`).
2. CA5-04..08: compact surfaces, contact transition, ejecta, anisotropic
   volume/particles, short-GRB jet (reuse ParticleService/VolumeService/
   RibbonService; follow the stellar-explosion module pattern).
3. CA5-09..17: observer-angle response, kilonova evolution, remnant
   presets, scrub/reset determinism, phase-aware resource activation,
   presets/registration (`/atlas/compact-merger`), browser+goldens,
   benchmark (`scripts/bench-compact-merger.mjs`), checkpoint.
