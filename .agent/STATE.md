# Durable project state

Last update: 2026-08-24 (CA5 CAMPAIGN) — **M8 CLOSED (prior checkpoint) AND
CA5 COMPACT MERGER IMPLEMENTED END-TO-END.** Compact Merger is the fourth
production Cosmic Atlas destination: registered, deep-linkable at
`/atlas/compact-merger`, five production presets, phase timeline, controls,
browser suite, six visual goldens (twice-stable), and a phase-aware
benchmark. All cumulative gates green.

## Current phase

**CA5 COMPLETE. Next: CA6 Tidal Disruption (`docs/cosmic-atlas/WORK_PACKETS.md`
CA6-01..15) — NOT started. M9 Kerr remains explicitly out of scope until its
own focused campaign.**

Commit chain this campaign (after the M8 closure commits 82c4dfa/e9c53ac/
a20a7a9/b4c41b5):
```
034b21b feat: add compact merger reduced physics core and destination module
b388ea5 feat: register compact merger atlas product experience with validation and goldens
<pending> chore: remove stray temp asset; finalize ca5 state
```

## CA5 packet status

| Packet | Status | Evidence |
| --- | --- | --- |
| CA5-01 conventions | DONE | `src/phenomena/compact-merger/types.ts` (fidelity disclosure, unit discipline, scenario taxonomy; no NS-BH preset) |
| CA5-02 timeline | DONE | `timeline.ts`: INSPIRAL→CONTACT→MERGER→JET→KILONOVA→AFTERGLOW, nonlinear log-compressed segments anchored at the model's deterministic contact time; exact round-trip tested |
| CA5-03 inspiral | DONE | `inspiral.ts`: closed-form quadrupole decay a(t)=(a0⁴−4Kt)^¼, Kepler ω, closed-form phase, COM positions; invariants tested (decreasing a, increasing ω, equal-mass symmetry, m1r1=m2r2, deterministic t_contact ≈0.76 s physical for canonical masses) |
| CA5-04 compact surfaces | DONE | destination-local bounded emissive spheres (reuse decision documented: NS surface tracer is CA3 physics, not reused as CA5 presentation) + RibbonService orbit trails from the closed-form model |
| CA5-05 contact transition | DONE | converging stars → cross-fade → disclosed flash envelope → remnant/ejecta initialization from the model (no instantaneous hide/show) |
| CA5-06 ejecta init | DONE | `ejecta.ts`: presentation-compressed homologous law (disclosed), seeded ParticleService plan |
| CA5-07 anisotropic ejecta | DONE | two-component direction weight/anisotropy (pure in direction — observer-independent), VolumeService shell + particles |
| CA5-08 short-GRB jet | DONE | `jet.ts` + bounded emissive bipolar geometry (RibbonService evaluated, rejected: no per-frame gain API — documented); front capped by ejecta envelope |
| CA5-09 viewing angle | DONE | inverse standard-beaming response, monotone non-increasing, bounded, finite at extrema; on-axis 1.0 vs 68°-off-axis 0.04; canonical control (host.setDestinationControl → module normalizer) |
| CA5-10 kilonova | DONE | `emission.ts`: arctan-rise × power-law-fall luminosity + diffusive cooling temperature → bounded linear-RGB tint; monotonicity tested |
| CA5-11 remnants | DONE | three scenarios (massive-ns / prompt-bh / delayed-collapse), deterministic, no predictive mass mapping claimed |
| CA5-12 scrub/reset | DONE | all model quantities closed-form in t; browser test reproduces identical state after rewind/play |
| CA5-13 phase resources | DONE | volume hidden + particles 0 during inspiral; jet geometry only during jet phase (fade in kilonova); trails inspiral-only; single global governor tiers |
| CA5-14 validation corpus | DONE | `tests/unit/compactMergerPhysics.test.ts` (35 tests) + `tests/browser/compact-merger.spec.ts` (12 tests) |
| CA5-15 benchmark/goldens | DONE | `scripts/bench-compact-merger.mjs` (+`bench:compact-merger`); per-phase records in `benchmarks/results/2026-08-24-ca5/`; 6 goldens twice-stable |
| CA5-16 transition/disposal | DONE | hyperspace in/out spec; 16-switch heavy torture (BH→CM→SN→NS ×4) bounded; rewind/play cycles bounded |
| CA5-17 checkpoint | DONE | this state file + docs |

## Compact Merger scientific fidelity (disclosed)

- inspiral trajectory: DIRECT reduced model (quadrupole-order GR decay law,
  closed form; physical ~1 s contact timescale for canonical masses — not an
  invented timeline).
- post-contact: PROCEDURAL_SCIENTIFIC reduced models with explicit
  disclosures — presentation-compressed ejecta expansion (physical 0.2c over
  a day is unframable next to a 24 km binary; the compression is stated at
  the law and in preset fidelity notes), arctan×power-law kilonova light
  curve, kinematic jet front capped by the ejecta envelope, scenario-based
  remnants.
- NOT claimed: numerical relativity, hydrodynamics/GRMHD, radiative
  transfer, predictive remnant mapping. NS-BH deliberately absent.

## CA5 benchmark evidence (benchmarks/results/2026-08-24-ca5/)

Edge 151 / WebGPU / amd rdna-2, medium tier, 778×581 internal, 480 frames
after 9 s warm-up. ALL phases measure ~7 ms median / ~7.1 ms p95 — the
144 Hz vsync interval: the destination renders comfortably inside one frame
everywhere, so per-phase cost differences sit below the vsync floor at this
tier/resolution. The PHASE-AWARE evidence is in the recorded resource
state per record: inspiral volumeVisible=false populationScale=0;
non-GRB jet phase jetVisible=false (no jet cost without the scenario);
GRB preset at 0.52 jetVisible=true front≈4.8 units. Heavier tiers/resolutions
are future characterization work.

## Validation evidence (final state)

| Gate | Result |
| --- | --- |
| npm run check | PASS — prettier/eslint/tsc clean, vitest **301/301**, build OK |
| Playwright full suite | **71/71 PASS** (12 CA5 specs + 6 new goldens included) |
| Goldens | 18/18, established then verified (twice-stable, no regeneration) |
| lut:validate | PASS (family schwarzschild-v1-415dea94) |
| Cross-destination torture | BH→CM→SN→NS ×4 (16 heavy switches) bounded, 0 pending prepares |

Environment: Windows 11, Node v22.23.2, Edge 151 (msedge), hardware WebGPU
(amd rdna-2); forced-WebGL2 paths covered by the standing atlas-webgl2 suite.

## Known debt / limitations (updated)

1. (M8 items 1/2/3/5/6 from the previous checkpoint remain; item 4 unchanged:
   the shipped disk emission presents no left-right Doppler asymmetry —
   golden-pinned baseline.)
2. CA5: jet lobes read modestly against the merger core glow at the pinned
   goldens (visual polish opportunity, model semantics correct and tested).
3. CA5: per-phase frame-cost characterization is vsync-bound at medium tier;
   low/high/ultra + higher resolutions not yet characterized.
4. CA5: kilonova volume march samples the shell coarsely at low tier
   (constant-step march through large bounds; half-res path active).
5. Compact-merger destination controls (viewing angle / remnant / jet) are
   live via the new canonical `setDestinationControl` channel but are not yet
   persisted into share links beyond `serializeShareState` (route-level).

## Next actions

1. CA6-01..04: Tidal Disruption scientific scope/presets, encounter
   trajectory, stellar deformation reduced model, disruption criterion +
   deterministic reference tests (stretch scope only — see mission §32).
2. CA5 polish (opportunistic): jet readability against the merger core;
   low/high/ultra phase benchmarks.
3. M9 Kerr: dedicated campaign after CA6 groundwork (do not start casually).


Commit chain this campaign:
```
82c4dfa feat: make trajectory backend preference canonical (M8-09)
e9c53ac perf: close schwarzschild lut benchmark harness and fix decision criterion
a20a7a9 fix: close m8 lut gpu-path defects, flip measured auto default, extend parity corpora
```

## M8 closure record (previous checkpoint, retained)

The M8 packet table, GPU-path defect record, decision criterion/outcome and
validation evidence below are the CLOSED M8 checkpoint record (commits
82c4dfa / e9c53ac / a20a7a9 / b4c41b5). Full detail also lives in
docs/LUT_BACKEND_ADR.md §11/§12.

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

See the CURRENT phase section at the top of this file (CA6 groundwork /
CA5 polish / M9 deferred).
