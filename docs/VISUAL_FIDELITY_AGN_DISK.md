# Visual fidelity — AGN nuclear outer-disk photosphere POC

Date: 2026-10-18
Branch: `visual-fidelity/agn-nuclear-disk-photosphere`
Verified base: `54d071f` (jet close-out; `git merge-base --is-ancestor` checked)
Implementation: `8c94027` (+ focused follow-up commit for the engine-halo depth fix)

This is one validated visual-fidelity vertical slice. It does not make the
atlas photorealistic, does not reopen the completed hardening or jet
campaigns, and does not implement `spatial-atlas-continuous-navigation`.

## 1. Original defect and root cause

Confirmed on the baseline tree (`54d071f`) with matched captures
(`artifacts/visual-fidelity-agn-disk/before/`):

- The NUCLEAR outer disk (200–8000 r_g) was a zero-thickness
  `RingGeometry` with additive blending and `depthWrite = false`. At the
  close-up review camera it read as a flat translucent plate with hard
  radial sine spokes; at default framing it was an invisible-to-smudgy veil
  inside the torus funnel. Class: geometry/representation + emission.
- Root cause: no finite thickness (no parallax, no rims, no self-occlusion),
  additive compositing with brightness-scaled alpha (a translucent veil
  look), and pattern amplitudes (0.32/0.14 on base 0.62) that only looked
  acceptable at the wide default framing where the disk is ~100 px.

Hypotheses rejected: the flatness was not caused by bloom (Scientific mode,
bloom off, showed the same veil) and not by hardware (RTX-class adapter).

## 2. Why a thin photosphere and not a full volume

A VolumeService march was considered and rejected for this subject: the
disk is optically thick, so a true volume would pay full march cost to
integrate to near-opaque alpha — the worst case for a volume. A closed
annular SHELL (top + bottom + inner/outer rims, flared H/R ≤ 0.04) gives
real perspective, parallax and self-occlusion at ~6 k vertices / ~11 k
triangles in one draw call, with no new engine and no new postprocess.

## 3. Implementation

`src/phenomena/quasar-agn/outerDiskPhotosphere.ts` builds and shades the
shell; `quasarAgnModule.ts#buildOuterDisk` wires it to the existing
uniforms. Composition: normal alpha blending with depth writes +
`alphaTest = 0.5`, so alpha and depth writes stay coherent (a fading alpha
cannot write depth without cutting the background — that produced a hard
dark band in the first iteration and is documented in the module header).

Preserved exactly (tests lock each):

- radial boundaries 200–8000 r_g and `ZONE_UNIT_RG.nuclear` conversion;
- the warm-inner → violet-outer colour law and the smoothstep parameterization;
- continuum variability response (pure multiplicative `uContinuum`);
- Keplerian differential rotation: Omega(r) = uOmegaScale·(r/r_g)^(-3/2),
  2-arm wave + 5× fine harmonic with the same time dependence;
- deterministic timeline behaviour (pure function of the time-days uniform;
  scrub replay verified in the browser spec);
- INNER/NUCLEAR/GALACTIC exclusivity (`diskWork.zoneVisible` gated by the
  zone machine; hidden zones draw no disk work);
- WebGPU and forced WebGL2 (same TSL graph).

Disclosed representation-layer approximations (PROCEDURAL_SCIENTIFIC,
`OUTER_DISK_PHOTOSPHERE_DISCLOSURE`):

- the flared scale height is an explicitly illustrative thickness
  approximation, **not** a solved vertical disk model, not GRMHD, not
  radiative transfer;
- bottom/rim dimming (0.7/0.85/0.8 vs top 1.0) is illustrative limb
  darkening;
- two-octave deterministic value noise on a cylinder sheared at the LOCAL
  Keplerian rate (features orbit differentially; no screen-space noise, no
  per-frame randomness).

Deliberate deviations from the old annulus (all documented at the code
site):

1. **Pattern contrast retuned** (base 0.72, wave 0.2, fine 0.04) — the
   motion law is unchanged; the old amplitudes read as hard spokes on the
   resolved surface and saturated to white under the old 1.5 display gain.
2. **Emissive gain 0.55** — peaks no longer clip to white.
3. **Soft inner fade only; defined outer photospheric boundary** — required
   for alpha/depth coherence (see module header).
4. **Engine halo keeps its pre-change no-depth-test glow semantics** (focused
   follow-up commit): the halo is an illustrative presentation glow and a
   selective-bloom source; with depth testing against the new shell its
   visible core shrank to the hemisphere above the plane and the engine
   read as missing at unsettled frames (surfaced as flake in
   `quasar-agn.spec.ts`). The shell's self-occlusion is unaffected.

## 4. Visual evidence

Curated review set: `artifacts/visual-fidelity-agn-disk/` (before/ + after/,
same script, same poses, phase 0.35, High, 1280×800, identical exposure and
post settings; `manifest.json` records backend/adapter/commit). Views:
default, inclined 60°, near-edge-on 87°, edge-on close-up 88°/25 units,
surface close-up 75°/25 units, and scientific (bloom off).

Reviewed visually, not only by metrics:

- before close-up: flat plate, hard sine spokes, zero thickness;
- after close-up: coherent thin shell — warm inner region, violet skirt,
  subtle sheared mottling, defined outer photospheric edge, visible far-rim
  occlusion; no hoop, no spokes, no black band;
- after edge-on close-up: actual finite thickness reads clearly; the shell
  is geometrically thin (not a torus/cylinder/fog bank);
- scientific default: the shell communicates spatial depth with bloom
  disabled.

Two rejected intermediate iterations are recorded in the commit history and
this file's earlier sections' spirit: (a) detached rim hoop + blown-white
surface + residual spokes, (b) hard dark band from low-alpha depth writes.

## 5. Matched performance

Method: `scripts/bench-agn-disk.mjs` — real GPU timestamps
(`host.flushGpuTimestamps()` after a forced frame), CPU frame wall time
reported separately and never labelled GPU time; zero-render samples
rejected (count 0 in every run); dynamic resolution pinned
(`setForcedTier('high')`, renderScale recorded 1 → 1 in every run);
adapter matched and retried (`--expect-adapter`), Brave → `nvidia lovelace`
(RTX 4050 Laptop, driver 610.62), internal 972×727, phase 0.35, timeline
paused, 2×60 GPU samples pooled per row.

| Config | Before `54d071f` | After `8c94027` | Verdict |
| --- | --- | --- | --- |
| WebGPU High, cinematic | 16.91 median / 17.24 p95 ms | 16.97 / 17.30 (16.84 / 17.17 after halo fix) | no measurable change |
| Forced WebGL2 High, cinematic | medians 22.01 / 22.22 / 22.41; p95 25.6–26.2 | medians 23.01 / 22.56 / 22.85; p95 25.3–26.0 | +2–3% median at the investigation threshold; tails equal |
| WebGPU High, scientific | 8.59 / 8.78 | 8.59 / 8.78 | identical |

CPU frame cost ~1.5–2.1 ms in every run (no change). Both trees show
shared-GPU outlier frames (max 55–77 ms; this host runs other GPU clients
during measurement), which dominate tail variance on both sides.

Investigation note (WebGL2 +2–3% median): repeat runs on both trees show
the shift consistently but small; the plausible cost is the `alphaTest`
discard path (can disable early-Z for the shell draw on ANGLE/D3D11) plus
changed volume depth-clip pixel counts. p95 is unchanged and WebGPU shows
zero delta, so the slice is accepted with this limit recorded; profiling
the discard path is a listed follow-up. The earlier ~41.8 ms NUCLEAR
CINEMATIC figure from the jet campaign is superseded by this matched pair —
the fresh baseline on the same scenario measures 16.9 ms; the old number
came from a different harness moment and the jet docs already recorded
multi-tens-of-ms run-to-run spread.

Environment note: Microsoft Edge on this host currently routes Chromium to
the Intel iGPU (`intel gen-12lp`) where earlier sessions got
`nvidia lovelace`; the matched pair therefore runs on Brave (which routes
WebGPU to the dGPU and WebGL2 via `ANGLE (NVIDIA, ...)` — verified
directly). Edge/iGPU absolute numbers are not comparable and are excluded.

## 6. Tests and gates

| Gate | Result |
| --- | --- |
| `npm ci` + `npm run check` | PASS — 73 files / 813 unit tests, build + all script gates |
| `tests/unit/outerDiskPhotosphere.test.ts` | PASS — 17 tests: geometry bounds/ordering, finite normals/indices, all four surfaces, preserved laws, determinism, seed-invariant geometry, disclosure honesty |
| AGN unit pack (disk + jets + physics) | PASS — 38/38 (jet/beaming tests preserved) |
| `tests/browser/quasar-agn-disk-photosphere.spec.ts` | PASS 2/2 — WebGPU + forced WebGL2: shell contract, thickness < 8% rOut, zone exclusivity, continuum response, scrub replay, frozen-frame stability, no console errors |
| AGN browser group ×2 | PASS 20/20 both runs |
| Full Playwright suite | 315/316 +1 skip, then 314/316 +1 skip — see flake A/B below |
| Firefox matrix | PASS 4/4 in both full runs |
| Scientific goldens (43) | **PASS unmodified** — AGN_NUCLEAR and AGN_BLAZAR_VIEW stay within the 6 / 2% tolerance despite the intentional disk change; zero goldens regenerated |
| Cinematic goldens (8) | PASS at harness tolerance; not regenerated |
| Golden integrity | working tree clean of golden writes after every run |

Flake A/B (the only full-suite failures): `galaxy-collision` leave/re-enter,
`quasar-agn` "nuclear view evolves", and both TDE timeline tests fail under
the parallel suite as 60 s test timeouts inside `waitForFrames` (rAF
starvation on this loaded host); each passes in isolation. The **baseline
`54d071f` full suite under identical conditions flakes worse** — 310/316,
the same family plus `resource-leak` churn and `shared-post` rebuild
discipline — so the failures are environmental, not introduced by this
slice.

## 7. Phase 5 — optional cinematic-only atmosphere: REJECTED

Considered and rejected after the photosphere worked: (1) the shell carries
the depth in both experience modes already; (2) a mode-dependent emissive
fork would present the same physics object differently per mode with no
measured need; (3) a shallow haze would require volume work or enlarged
bounds whose GPU cost the measurements do not justify; (4) it would churn
cinematic goldens for presentation-only gain. No cinematic-only term is
implemented; the disk is mode-independent (scientific/cinematic separation
test locks the shared laws).

## 8. Known limitations and remaining defects

1. WebGL2 median +2–3% (discard path) — profiled follow-up listed below.
2. Surface detail is subtle at default framing (the disk is ~100 px wide
   there); the structure reads at moderate/close range as intended.
3. The inner "eye" (halo + inner rim interplay) is slightly odd at extreme
   close-up; acceptable at review cameras.
4. The colour law's warm→violet transition is preserved verbatim and is
   quite abrupt in the middle of the disk; a smoothed law would be a
   (separately reviewed) emission-model change.
5. Load-flaky frame-advance tests on this host (verification-lane item).

## 9. Prioritized next-stage plan

1. Verification lane: harden `waitForFrames`-based tests against rAF
   starvation (bounded wall-clock waits), or run the suite with reduced
   parallelism on loaded hosts.
2. Black-hole destination (flagship) disk fine structure: build on the
   cinematic disk-atmosphere factor from the jet campaign with measured
   evidence, gated CINEMATIC-only.
3. Profile the WebGL2 `alphaTest` discard path for the shell (potential
   `alphaToCoverage`/edge-clip alternative).
4. Kerr magenta polar band remains a numerical-lane item, not lookdev.
5. Nuclear torus boundary: the torus funnel/disk junction still reads
   soft; a matched slice could reconcile the sublimation-rim geometry.
