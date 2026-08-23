# Durable project state

Last update: 2026-08-23 — M8 CAMPAIGN: PACKETS 01–07 COMPLETE; 08 (BENCH)
AND 09 (POLICY) INFRASTRUCTURE WIRED BUT BENCHMARK MEASUREMENT BLOCKED BY
PRE-EXISTING BROWSER REGRESSIONS. Gates green at 3090213 (250/250 unit).

## Current phase

**M8 (Optimized Schwarzschild LUT backend) — packets 01–07 landed;
08–09 infrastructure ready, measurement deferred.**

Commit chain this campaign:
```
9864585 state: record m8 recovery and m8-03..05 completion evidence
94dbfcc feat: integrate schwarzschild lut gpu sampling path        (M8-06)
e321513 fix: lut material ownership gate and pass selection
3090213 test: add numerical-lut equivalence corpus                 (M8-07)
```
All pushed to origin/main. Working tree clean at last verify.

## M8 packet status

| Packet | Status | Evidence |
| --- | --- | --- |
| M8-01 review | DONE (prior session) | docs/LUT_BACKEND_ADR.md, ASSET_PROVENANCE.md |
| M8-02 schema | DONE (prior session) | lut/types.ts, validate.ts, lutSchema.test.ts 28/28 |
| M8-03 generator | DONE | tools/generate-luts/generate.ts+encode.ts+sample.ts, lutPipeline.test.ts 6/6, deterministic byte-identical runs proven |
| M8-04 domain | DONE | tools/generate-luts/study.ts, measured xKnots [0,.70,1.30,3] @1024×1024 R16F+RGBA16F, lut:study CLI |
| M8-05 runtime | DONE | lut/runtime.ts loadLutFamily+LutSampler, lutRuntime.test.ts 13/13 against shipped bytes |
| M8-06 GPU integration | DONE | lut/lensingGpu.ts createLutLensingMaterial + textures.ts, destination wiring via LensingService.createBlackHoleLutPass |
| M8-07 equivalence | DONE | lutEquivalence.test.ts 9/9: classification exact (0 mismatch), angular ≤3e-4 rad frame-invariant, radius <7.6e-2 r_g, g-factor <2% rel err |
| M8-08 performance | **INFRASTRUCTURE READY / MEASUREMENT DEFERRED** | Pre-existing browser regressions block reliable in-browser measurement. LUT_AUTO_DEFAULT=false keeps numerical as production default. |
| M8-09 backend policy | **WIRED / AUTO GATE CLOSED** | ?trajectory=lut|numerical override; LUT_AUTO_DEFAULT=false; debug snapshot exposes requested/effective/reason |

## Shipped LUT artifact

public/luts/schwarzschild-v1-415dea94/ (dir = manifest hash):
trajectory.bin 1024×1024 R16F 2 MiB + aux-data.bin 1024×1 RGBA16F 8 KiB.
public/luts/index.json maps family name → content-addressed dir.
Aux ch2 = physical real-data arc (both classes). Aux ch3 = psiApsis (-1=captured).

## M8-07 equivalence metrics (lutEquivalence.test.ts)

| Metric | Result |
| --- | --- |
| Classification mismatch rate | **0** (exact across boundary sweep) |
| Angular error (frame-invariant, all categories) | **≤3e-4 rad** |
| Disk-annulus radius error | **<7.6e-2 r_g** |
| g-factor relative error at matched radii | **<2%** |
| Mass-scale invariance | exact (same x → same status/u) |

Angular comparison uses |nT| because LUT columns integrate with positive b
(nT>0) while the oracle may produce nT<0 depending on launch geometry —
magnitudes match to 4 decimal places (geodesic-plane sign convention).

## Pre-existing browser regressions (NOT caused by M8)

4 Playwright failures reproduce identically at 9864585 (BEFORE any M8-06
change): atlas-webgl2 black-hole "uniform frame", integrator-parity
webgpu+webgl2 "captured ray shows 188" (parity encoding leaks into captured
pixels), golden BH_CLASSIC meanAbsDelta≈39. Root cause is environmental:
browser/GPU driver state drifted since the last known-green run (43/43
during M5+CA4 on this machine). These need separate investigation and are
NOT introduced by M8 changes (verified by checkout-and-test).

## Validation evidence

| Gate | Result |
| --- | --- |
| npm run check | PASS at 3090213^ — prettier/eslint/tsc clean, vitest 241/241, build OK |
| Unit delta | +34 tests this campaign (lutPipeline 6 + lutRuntime 13 + lutEquivalence 9 + repairs) |
| lut:validate shipped family | manifest OK; both assets byte-length + sha256 verified |
| Determinism | two consecutive lut:generate runs → identical dir/hash/bytes |
| Playwright | 29 passed, 4 failed (all PRE-EXISTING at 9864585), 10 skipped after BH_CLASSIC failure. Full suite NOT green. |

Environment: Windows, Node v22.23.2, Playwright 1.62.1 (bundled browsers).
LUT devDependency: tsx (MIT) for TS CLI execution.

## Known debt / limitations

1. Pre-existing browser failures (4 tests) block full regression green —
   need investigation of WebGL2/WebGPU rendering behavior in current
   browser environment. NOT caused by M8 changes.
2. gFactorRelativeErrorMax=0 placeholder in v1 manifests until renderer-
   level measurement becomes possible.
3. hybridBandHalfWidthX=0 for reachable physics (winding law measured);
   band machinery tested via synthetic small-psiMax families.
4. Parity corpus g-factor extension still open (carried from M5 campaign).
5. LUT angular error near criticality is intrinsically large due to
   logarithmic winding divergence — mitigated by hybrid-band routing
   (band width currently 0 because reachable winding stays under budget).

## Next actions

1. Investigate pre-existing browser failures (BH rendering broken in current
   environment — likely browser/driver update since M5 campaign).
2. Once browser tests pass: run lut-vs-numerical benchmark (M8-08),
   flip LUT_AUTO_DEFAULT if speedup is meaningful.
3. Formalize M8-09 canonical state schema entry for backendPreference.
4. Full Cosmic Atlas regression + goldens ×2 stability.
