# Durable project state

Last update: 2026-08-23 — M8 RECOVERY CAMPAIGN: M8-01..05 COMPLETE ON MAIN;
M8-06..09 REMAIN. Gates green at commit 5c47d74 (241/241 unit).

## Current phase

**M8 (Optimized Schwarzschild LUT backend) — packets 01–05 landed and
validated; 06–09 pending.** `main` history this campaign:

```
41ead9e unfinished progress            (interrupted M8-03, 7 failing tests)
2442d66 fix: recover interrupted m8 lut generator
51531e6 feat: complete deterministic schwarzschild lut generation   (M8-03)
37fb785 perf: select measured lut domain and encoding               (M8-04)
5c47d74 feat: add validated schwarzschild lut runtime sampler       (M8-05)
```

Push state: 2442d66..37fb785 pushed to origin/main; **5c47d74 local-only at
last attempt — GitHub returned connection failures twice (100% packet loss,
transient; same outage self-recovered earlier this session). FIRST ACTION of
next session: `git push origin main`, then verify `origin/main == 5c47d74`.

## What this campaign did (recovery audit → repair → complete)

1. RECOVERY AUDIT of 41ead9e (7 failing tests in lutGenerate.test.ts).
   Defect classification, all root-caused before any edit:
   - TEST construction bugs ×3: f16 overflow roundtrip assertion (65520→Inf
     decodes as Inf BY DESIGN); "tie" built between non-adjacent f16 values
     (their average IS the representable midpoint 0x3883); rg32f test
     demanding f64-exact roundtrip through documented Math.fround storage.
     Implementation was CORRECT in all three — tests repaired, not loosened
     (RNE tie test now covers BOTH adjacent-pair directions).
   - SAMPLER bugs ×3 (real): terminal escape direction evaluated at post-
     step overshoot instead of interpolated crossing radius; captured-class
     mirror used nearest-strided-sample (~30× error vs interpolated exact
     crossing); rMin recorded post-step. All fixed; oracle comparisons
     re-framed onto matched settings + dense stride + shared-crossing
     frames (the old far-stop comparison mixed tetrad frames ~0.03 rad
     apart — frame rotation, not physics).
   - MEASURED winding law recorded: outArc ≈ ~(1/2)ln(1/(x−1)); x=1.001 →
     4.65 rad. A 16-rad cap NEVER truncates numerically reachable columns;
     truncation semantics now tested via explicit small psiMax budgets.
2. M8-03 COMPLETE (51531e6): tools/generate-luts/generate.ts +
   validate.ts; npm scripts lut:generate / lut:validate / lut:study;
   deterministic pipeline (byte-identical assets+manifest across runs,
   proven at CLI level); manifest-hash content-addressed directories
   (<family>-<hash8>); measured validation block baked into manifests
   (classification exact rate=0; terminal-direction max 1.2e-4 rad);
   gFactor field honestly 0-with-note until M8-07 measures it.
   Windows landmine found live: asset named aux.bin cannot exist on Win32
   (reserved DOS device AUX) — renamed aux-data.bin BEFORE first push.
3. M8-04 COMPLETE (37fb785): lut:study sweeps axis mappings × widths ×
   heights with OFF-GRID oracle-compared columns (on-grid evaluation hides
   exactly the cross-column filtering error being measured). FROZEN:
   xKnots [0, 0.70, 1.30, 3] @ 1024×1024 psiMax=16, R16F+RGBA16F.
   radiusErrMax 3.05e-2 r_g / rms 1.18e-2 / angular ≤5.4e-5 rad @ 2 MiB.
   Tight critical band WORST (starves 0.85–0.95 where lensed disk hits
   live); ψ-height not the bottleneck; r16f quantization inside budget at
   half of r32f memory. ADR §6 rewritten with these numbers.
4. M8-05 COMPLETE (5c47d74): STORAGE CONTRACT FIX — per-column spans made
   v-filtering meaningless; generator now resamples every column onto one
   shared span (4.722 rad shipped), clamp-extending short columns with
   terminal radius; manifest domain.storedSpanRg validated & REQUIRED by
   runtime. src/phenomena/black-hole/lut/runtime.ts: loadLutFamily
   (schema + byteLength + SHA-256 verification, structured rejection
   taxonomy incl. missing-stored-span for pre-M8-05 families);
   LutSampler (ANALYTIC classification via b⇔b_c — never interpolated;
   exact fallback taxonomy x-out-of-domain-low/high + hybrid-band-winding;
   texel-center bilinear both axes; launch-row solve on folded monotone
   arc; withinRealData separating boundary values from clamp padding;
   truthful diagnostics incl. WebGL2 filterability). formatWebGL2Status:
   half-float core-filterable; 32F gated behind OES_texture_float_linear.
   13 runtime tests run against the SHIPPED family bytes (checksum tamper,
   truncation, schema, stored-span rejections; boundary sweep; roundtrip
   worst <7.6e-2 r_g matching M8-04 budget).

## Shipped LUT artifact (committed, provenance-complete)

public/luts/schwarzschild-v1-4a91cf34/ (dir name = manifest hash):
trajectory.bin 1024×1024 R16F 2 MiB + aux-data.bin 1024×1 RGBA16F 8 KiB
+ manifest.json (generatorCommit, source-commit generatedAt, SHA-256 per
asset, validation summary, hybridBandHalfWidthX=0, provenance block).
Regenerate: npm run lut:generate; verify: npm run lut:validate -- <dir>;
re-measure domain: npm run lut:study [-- --quick].

## Validation evidence (this campaign, cumulative)

| Gate | Result |
| --- | --- |
| npm run check | PASS at 5c47d74 — prettier/eslint/tsc clean, vitest **241/241** (18 files), vite build OK |
| Unit delta | +26 tests this campaign (lutGenerate repairs + lutPipeline 6 + lutRuntime 13) |
| Determinism | two consecutive lut:generate runs → identical dir/hash/bytes |
| lut:validate on shipped family | manifest OK; both assets byte-length + sha256 verified |
| Playwright | NOT RUN this session — DEFERRED_ENVIRONMENT (browser gates untouched by lut modules so far; no src/renderer or destination files modified since last known-green browser campaign except NONE — verifiable via git diff 41ead9e..HEAD --stat: changes confined to tools/, src/phenomena/black-hole/lut/, tests/unit/, docs/, public/luts/) |

Environment: Windows, Node v22.23.2 (tsx CLI runner added as devDep, MIT).

## Remaining M8 packets (exact next actions)

- **M8-06 Disk/environment integration**: TSL LUT sampling pass under
  src/phenomena/black-hole/lut/ (GPU textures from family bytes:
  RedFormat+HalfFloatType=R16F, RGBAFormat+HalfFloatType=RGBA16F; DataTexture
  upload; fragment path mirrors numerical integrator EXCEPT trajectory:
  b analytic → resolveRay branch → launchRow solve → disk-crossing
  candidates equally spaced in ψ (ADR §7 sinusoid zeros) → terminal
  direction; fallback pixels route to the EXISTING RK4 loop inline with
  debug-visible reason). Reuse camera/basis/disk/emission/starfield/HDR/
  governor verbatim — NO second shading model.
- **M8-07 Equivalence corpus**: selected-ray + image comparisons
  numerical-vs-LUT across mission §9 list; goldens only after
  investigation, never auto-updated.
- **M8-08 Performance report**: bench harness A/B identical settings;
  meaningful-win-or-don't-ship rule (SPEC §14).
- **M8-09 Auto policy**: rendering.backendPreference already exists in
  AppState schema ('auto'|'numerical'|'lut'); wire selection + truthful
  fallback reason surfacing in Debug mode.
- Then Cosmic Atlas regression sweep (mission §13) + full playwright.

## Deferred / known gaps (honest)

1. Playwright/browser suite not executed this session (DEFERRED_ENVIRONMENT,
   network outage window also hit pushes — see top). No app-runtime code
   paths were touched by M8-03..05 commits (diff-scoped to tooling/lut/tests/
   docs/assets), so prior browser evidence stands for the atlas shell.
2. Steep outer rim (r>~16): dr/dψ>100 makes pointwise comparisons
   coordinate-sensitive; disk-hit metrics slope-guard it; visual verdict
   owned by M8-07 images.
3. gFactorRelativeErrorMax=0 placeholder in v1 manifests until M8-07
   measures the renderer-level quantity.
4. hybridBandHalfWidthX=0 for reachable physics (winding law measured);
   band machinery stays live-tested via synthetic small-psiMax families.
5. Parity corpus g-factor extension still open (carried from M5 campaign).

## Next actions

1. git push origin main; verify remote == 5c47d74.
2. M8-06 TSL integration slice (texture upload + sampling node + fallback
   routing), keeping numerical path byte-identical as default.
3. npx playwright test after any file touching destinations/renderer.
