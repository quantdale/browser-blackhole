# Durable project state

Last update: 2026-08-23 (later) — M8 CAMPAIGN: captured-ray output semantics in
lut/lensingGpu.ts COMPLETED (finish of interrupted commit 237091c): capture gate
now covers BOTH backends via rayWasCaptured, escape gate mirrors the reference
three-way select. ALL FOUR pre-existing browser failures were ONE root cause
(captured pixels leaked disk light / debug-parity encoding); fixing it turned
the FULL suite green: vitest 250/250, Playwright 43/43. M8-08 benchmark now
UNBLOCKED.

Earlier: packets 01–07 complete; 08 (BENCH) AND 09 (POLICY) infrastructure
wired but measurement was blocked by those browser regressions. Gates green at
3090213 (250/250 unit).

## Current phase

**M8 (Optimized Schwarzschild LUT backend) — packets 01–07 landed;
08–09 infrastructure ready, measurement UNBLOCKED by regression fix.**

Commit chain this campaign:
```
9864585 state: record m8 recovery and m8-03..05 completion evidence
94dbfcc feat: integrate schwarzschild lut gpu sampling path        (M8-06)
e321513 fix: lut material ownership gate and pass selection
3090213 test: add numerical-lut equivalence corpus                 (M8-07)
2dc8485 fix: equivalence test frame-invariant comparison and cleanup
237091c unfinished (interrupted WIP: stall capture + captured-black intent)
```
The two follow-up commits after 237091c complete that WIP (see Validation
evidence): 7ceff4d (fix) + a40de92 (state). LOCAL ONLY — push to origin/main
PENDING: github.com:443 unreachable at commit time (2 connection attempts
failed). Push as first action of next session.

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
| M8-08 performance | **INFRASTRUCTURE READY / MEASUREMENT UNBLOCKED** | Browser regressions RESOLVED (see below); full suite green. LUT_AUTO_DEFAULT=false keeps numerical as production default until measured. |
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

## Pre-existing browser regressions — RESOLVED (root cause fixed)

The 4 Playwright failures that reproduced at 9864585 (BEFORE any M8-06
change) shared ONE root cause: in lut/lensingGpu.ts the output assembly did
not force photon-capture BLACK for captured rays, so accumulated disk light
and/or the uDebugMode parity encoding leaked into captured pixels. This
diverged from schwarzschildIntegrator's documented contract (captured ->
vec3(0), escaped -> radiance-or-parity, other -> failure magenta).

Resolution (completing interrupted commit 237091c):
- Numerical fallback gained the coordinate-stall capture condition
  (pr < 0 AND f = 1 - 2M/r < 1e-3), op-for-op with the reference integrator.
- Capture gate is now rayWasCaptured (set by LUT captured class AND both
  numerical capture conditions); escape gate = LUT-escaped OR numerical
  RAY_ESCAPED; everything else -> NUMERICAL_FAILURE magenta.
- Evidence: tests/browser/integrator-parity.spec.ts webgpu+webgl2 PASS
  ('captured ray shows 188' gone); atlas-webgl2 shadow-darkness test PASS;
  golden BH_CLASSIC PASS; FULL suite 43/43 (was 29 pass / 4 fail / 10 skip).

## Validation evidence

| Gate | Result |
| --- | --- |
| npm run check | PASS at <fix> — prettier/eslint/tsc clean, vitest 250/250, build OK |
| Unit delta | +34 tests this campaign (lutPipeline 6 + lutRuntime 13 + lutEquivalence 9 + repairs) |
| lut:validate shipped family | manifest OK; both assets byte-length + sha256 verified |
| Determinism | two consecutive lut:generate runs → identical dir/hash/bytes |
| Playwright | **43 passed, 0 failed, 0 skipped — FULL SUITE GREEN** (first time since M5+CA4) |

Environment: Windows, Node v22.23.2, Playwright 1.62.1 (bundled browsers).
LUT devDependency: tsx (MIT) for TS CLI execution.

## Known debt / limitations

1. gFactorRelativeErrorMax=0 placeholder in v1 manifests until renderer-
   level measurement becomes possible.
2. hybridBandHalfWidthX=0 for reachable physics (winding law measured);
   band machinery tested via synthetic small-psiMax families.
3. Parity corpus g-factor extension still open (carried from M5 campaign).
4. LUT angular error near criticality is intrinsically large due to
   logarithmic winding divergence — mitigated by hybrid-band routing
   (band width currently 0 because reachable winding stays under budget).

## Next actions

1. Run lut-vs-numerical benchmark (M8-08) — NOW UNBLOCKED with the full
   suite green; flip LUT_AUTO_DEFAULT only if speedup is meaningful.
2. Formalize M8-09 canonical state schema entry for backendPreference.
3. Full Cosmic Atlas regression + goldens ×2 stability (suite currently
   green once; confirm stability with a second consecutive run when
   convenient).
4. Parity corpus g-factor extension (debt item 3).
