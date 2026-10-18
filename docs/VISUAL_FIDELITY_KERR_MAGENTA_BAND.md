# Visual fidelity — Kerr magenta-band diagnosis

Date: 2026-10-18
Branch: `visual-fidelity/kerr-magenta-band-diagnostics`
Base: `1b01b7e` (AGN disk photosphere close-out; `54d071f` is its ancestor)

**Outcome: B — DIAGNOSED, SOLVER LIMITATION.** No production rendering code was
changed. The magenta band is not a presentation defect and not a recolouring
bug: it is the pole-passage honesty gate correctly refusing to present f32
geodesics it cannot resolve. What this campaign produced is proof, quantification,
and a regression lock so the disclosed artifact cannot silently drift.

## 1. Environment

| Item | Value |
| --- | --- |
| Browser | Brave (Chromium 151), headless |
| Backends | WebGPU `nvidia lovelace` (RTX 4050 Laptop, driver 610.62); forced WebGL2 via `ANGLE (NVIDIA, ...)` |
| Viewport / internal | 1280×800 CSS → 972×727 internal at High and Medium with `setRenderScaleOverride(1)` |
| Preset | `kerr-high-prograde` (a* = +0.9) |
| Determinism | timeline paused, `scrubTo(0.5)`, forced tier, render scale pinned 1, bloom off, exposure 1, `linear` tone map (Scientific) |
| Note | Microsoft Edge on this host currently routes Chromium to the Intel iGPU, so all measurements use Brave to hold the dGPU fixed |

## 2. The defect and how it was reproduced

`scripts/diag-kerr-band.mjs` renders the same frozen scene twice — the physical
view and the `?kerrstatus` classification view — and reads both at **internal
drawing-buffer resolution** (no CSS upscale blending), then builds a registered
per-pixel contingency table.

## 3. Code path that produces the colour

`src/phenomena/black-hole/kerr/kerrIntegrator.ts`:

- `NUMERICAL_FAILURE_RGB = [0.08, 0, 0.08]` (linear) is emitted by the output
  assembly for every terminal status that is neither `RAY_CAPTURED` (black) nor
  `RAY_ESCAPED` (radiance). Same constant in `lut/lensingGpu.ts`.
- The pole-passage gate reclassifies an **escaped** ray to `RAY_NON_FINITE` when
  `minSinTheta < 0.04`, setting the debug sub-flag `dbgPole`.
- `?kerrstatus` (`uDebugMode ≥ 2`) paints the classes: escaped cyan
  `(0,0.7,1)`, captured black, max-steps orange `(1,0.45,0)`, theta-wrap red
  `(1,0.05,0.05)`, **pole yellow `(1,0.9,0.2)`**, other/NaN magenta
  `(1,0.2,1)`, invalid-initial-state `(0.35,0,0.35)` — all linear.
- The shipped display path applies tone mapping then a LINEAR → sRGB encode, so
  linear 0.2 arrives at 124, not 51. **An early version of this campaign's own
  classifier used `b < 90` for pole yellow and therefore filed 1.12% of the
  frame under "unclassified".** The probe that caught it is
  `scripts/probe-kerr-band-pixels.mjs`; this is recorded because it is the exact
  kind of mistake that would have produced a false "the band is not failures"
  headline.

## 4. Hypotheses and falsification

| # | Hypothesis | Verdict |
| --- | --- | --- |
| A | Band = numerically failed rays | **CONFIRMED** — IoU 0.9969, 99.69% of magenta explained by failures |
| B | Valid rays wrongly coloured magenta | **REFUTED** — at the exact magenta coordinates the status view emits pole yellow, and the physical view emits exactly `80,0,80` = linear (0.08,0,0.08) |
| C | A small failure region enlarged by bloom/temporal/tone mapping | **REFUTED** — spread `tinted/core = 1.004×` in all four presentation configurations (bloom off/on, ACES, shipped cinematic) |
| D | GENUINE BL / f32 limit | **CONFIRMED** — see §6 |

## 5. Magenta/status overlap (Phase 3 gate)

WebGPU High, 972×727 (706,644 px), Scientific, bloom off:

| Metric | Value |
| --- | --- |
| Physical magenta | 7,967 px = **1.1274%** |
| Numerical-failure status pixels | 7,967 px = 1.1274% |
| Both (intersection) | 7,942 px |
| Magenta only | 25 px (0.31% of magenta) |
| Failure only | 0 px |
| **IoU** | **0.9969** |
| Fraction of magenta explained by failures | **99.69%** |
| Fraction of failures shown magenta | **100%** |

Failure census: **pole 1.1231%**, theta-wrap 0.0008%, max-steps 0%, other
magenta 0%, invalid-initial 0%, blend/unclassified 0.0306%.

The exact-colour probe is decisive: physical magenta is `80,0,80` for 7,926 of
7,967 pixels, and the status view at those coordinates is `255,243,124` for
7,881 of them — the sRGB image of pole-passage yellow `(1.0, 0.9, 0.2)`.

## 6. Numerical root cause (Phase 4)

The live camera basis was read with the same helper the parity suite uses and
rays were rebuilt with the shared `cameraRayMath`, so CPU rays ARE GPU rays.

**Finding 1 — these are strong-field axis passages, not far-field asymptotes.**
Walking the reference's path samples: `min|sin θ|` occurs at r ≈ 1.6–9.6 r_g,
and every gated ray has `radial turns ≥ 1` and `angular turns ≥ 1`. The ray
passes over the hole, turns through the strong field close to the axis, and
escapes.

**Finding 2 — in binary64 these rays are excellently conditioned.**

- 16× step refinement (0.005 → 0.000625): terminal direction moves **0.000°**;
  `min|sin θ|` is stable to 1e-3.
- Conserved quantities on band-family rays: null residual ≲ 1e-12, Carter drift
  ≲ 1e-12.
- Input-perturbation sensitivity at f32 scale (1e-7 … 1e-5): **0.000–0.084°**.

**Finding 3 — in f32 they are not.** Faithful emulation of the production
integrator (same RK4, same step policy, same near-horizon half-step guard,
state rounded to float32 after every stage) gives, versus the binary64 oracle:

| Ray (min\|sin θ\|) | f64 | f32 emulation | Direction error |
| --- | --- | --- | --- |
| 0.0303 | escaped | escaped | **55.41°** |
| 0.0285 | escaped | escaped | **20.57°** |
| 0.0269 | escaped | escaped | **3.75°** |
| 0.0255 | escaped | escaped | **35.72°** |
| 0.0381 | captured | non-finite / r → −∞ | not presentable |
| 0.0325 | captured | non-finite / r → −∞ | not presentable |

An early screen-direction sweep (camera-ray perturbations through a
reconstructed basis) gave 3.75°–55.41° for four gated rays. The reproducible
committed evidence is `scripts/probe-kerr-f32-divergence.ts`, which uses an
explicit axis-offset ray family so the result does not depend on how a camera
basis happened to be rebuilt:

| offset (r_g) | f64 | min\|sin θ\| (f64) | gated | f32 emulation | direction error |
| --- | --- | --- | --- | --- | --- |
| 1–4 | captured | 0.035–0.732 | no | captured | — (classification matches) |
| 5 | numerical-failure | 0.0289 | **yes** | escaped | **29.56°** |
| 6 | numerical-failure | 0.0247 | **yes** | escaped | **53.33°** |
| 8 | numerical-failure | 0.0196 | **yes** | escaped | **136.65°** |
| 12 | numerical-failure | 0.0149 | **yes** | escaped | **159.47°** |

Every gated ray carries a null-residual of 1e-13–1e-14 in f64 (the geodesic is
fine) yet the f32 emulation reports a **29°–159° wrong sky direction** — and in
the screen-direction sweep several inside-gate rays did not survive f32 at all
(non-finite, r → −∞). The divergence grows monotonically as the axis approach
deepens, which is the expected `1/sin²θ` behaviour and is not a coincidence of
one sample.

The earlier emulation run also showed captured rays going non-finite. That was
a **harness** defect (missing the production near-horizon half-step guard), not
a solver finding; the committed probe mirrors the guard and the captured rays now
track f64 exactly. Recording it matters: an unguarded emulation overstates the
problem and would have been the wrong basis for a threshold argument.

An input-perturbation-only test showed sub-0.1° sensitivity and briefly suggested
the gate might be over-conservative. That test was inadequate: it does not
accumulate rounding over thousands of RK4 stages. The step-rounding emulation is
the honest measurement, and it reverses the conclusion. This reversal is
recorded deliberately — it is the difference between "the gate looks too strict"
and "the gate is the only reason the image is not lying".

**Verdict: the 0.04 threshold is scientifically correct and must not be lowered.**
Lowering it would render 29°–159° wrong sky directions as if they were physical.

## 7. Controlled experiments (Phase 5)

- **Pole threshold:** diagnostic-only. Oracle sweeps confirm gated ⟺ escaped and
  sub-threshold; captured rays legitimately sit below the threshold (only escaped
  rays are reclassified, per ADR §1.19). Production threshold unchanged (0.04).
- **Tier:** Medium 1.1709% magenta / 0.998% pole; High 1.1274% / 1.1231%.
  Band position and classification are tier-stable, so this is a ray-population
  property, not a sampling artefact.
- **Timeline phase:** constant **0.998% pole across phases 0.0–0.85** with the
  camera held — the band is a static geometric property of the framing.
- **Backends:** WebGPU 1.1709% vs forced WebGL2 1.1707% magenta (Medium),
  pole 0.998% vs 0.9978%, IoU 1.0 — backend-identical classification.
- **Presentation:** core 1.1274% in every configuration; tinted/core spread
  1.004×. Bloom, ACES and exposure contribute **0.4%** of spatial extent.
- **LUT:** N/A for this path. The failure colour is emitted directly from the
  terminal-status select in the numerical pass; no LUT or texture participates
  (the diagnostic snapshot also reports `lutFallbackReason:
  lut-inapplicable-while-kerr-active`).

## 8. Why no production change was made

Every non-solver "fix" available is prohibited and would be dishonest:

- recolouring failures, or replacing them with black, would hide real numerical
  failures and re-create the exact bug the ADR §1.19 note exists to prevent
  ("numerical failure must not masquerade as the capture shadow");
- reclassifying failures as escaped would present 4°–55° wrong directions as
  physics;
- lowering the threshold is refuted by §6;
- suppressing the indicator in Scientific mode would be a fidelity regression;
- the presentation pipeline is already proven innocent (1.004×).

The remaining honest options are solver-level (coordinate-regular formulations,
dedicated pole handling, or a higher-precision path for near-axis rays). Those
are out of scope by charter and are scoped as a follow-up in §11.

## 9. What was added instead (no behaviour change)

- `scripts/diag-kerr-band.mjs` — deterministic dual-view capture + registered
  contingency + per-class masks. Classifies documented colours by transforming
  the shader's LINEAR constants through the shipped display chain, which is the
  bug that made the first census wrong.
- `scripts/probe-kerr-band-pixels.mjs` — exact-RGB histogram at magenta
  coordinates, in both views. This is what identified pole yellow.
- `scripts/probe-kerr-presentation.mjs` — bloom/exposure/tone-map amplification
  sweep (core vs tinted spread).
- `scripts/probe-kerr-cpu-rays.ts` — live-camera ray sampling through the
  binary64 oracle with a `poleFailureSin` sweep and full diagnostics.
- `scripts/probe-kerr-f32-divergence.ts` — production-faithful f32 step-rounding
  emulation against the ungated binary64 oracle, over an explicit axis-offset ray
  family. This is the committed evidence for the §6 table.
- `tests/unit/kerrPolarBandDiagnosis.test.ts` — 7 tests locking: gate fires only
  on sub-threshold escaped rays; captured rays keep capture even below the
  threshold; failures never carry a terminal direction; binary64 convergence to
  < 0.05° under 16× refinement; clean conserved quantities; and the f32
  emulation showing inside-gate rays are unresolvable while outside-gate rays
  track the oracle.

## 10. Tests and golden integrity

| Gate | Result |
| --- | --- |
| `npm run check` | PASS — 74 files / 820 unit tests + all script gates |
| `tests/unit/kerrPolarBandDiagnosis.test.ts` | PASS 7/7 |
| `kerr-backend-census` | PASS — WebGPU/WebGL2 class split unchanged |
| `kerr-parity` (webgpu + webgl2) | PASS — selected rays still agree with the binary64 oracle |
| `kerr-integration` | PASS |
| Full Playwright suite | see `.agent/STATE.md` for the recorded run |
| Goldens | **zero regenerated**; `KERR_HIGH_PROGRADE` and all others untouched |
| Production source files changed | **none** |

Because no production code changed, the performance acceptance gate is
vacuous: GPU cost is bit-identical by construction. No benchmark claim is made
or needed, and none is inferred from CPU timing.

## 11. Remaining limitation and next campaign

**Confirmed limitation (disclosed, not hidden):** rays that turn through the
strong field within `sin θ < 0.04` of the symmetry axis cannot be integrated
accurately in the f32 Boyer–Lindquist formulation. They are rendered as an
explicit dim-magenta failure and cover **~1.0–1.13% of frame** in the
`kerr-high-prograde` framing. This is the honest error bar of the current solver.

Recommended next campaign (`kerr-near-axis-solver`):

1. **Coordinate-regular formulation.** Kerr–Schild or a horizon/axis-regular
   Cartesian variant removes the `1/sin²θ` stiffness that makes BL unusable near
   the axis. Highest expected payoff; also fixes the residual theta-wrap class.
2. **Dedicated near-axis branch.** For rays whose impact parameter predicts
   `min|sin θ| < 0.05`, integrate in a rotated frame where the axis approach is
   equatorial, then rotate the terminal direction back. Cheaper than a full
   coordinate change and testable against the existing binary64 oracle.
3. **Selective f64 / double-single emulation** on the near-axis subset only, with
   a measured GPU budget (the affected population is ~1% of pixels, so a 2–4×
   per-ray cost there is ~2–4% of frame cost — the acceptance gate would be
   median GPU ≤ +3%, so this must be measured, not assumed).
4. Re-baseline `kerr-backend-census` numbers once a solver change lands; the
   census currently guards backend agreement, not absolute failure rates.

Any solver work must keep the pole gate's *spirit*: never present an unresolved
direction as physical. If a new formulation genuinely resolves these rays, the
gate should be re-derived against it (with the oracle), not simply deleted.

## 12. Documentation corrections made

`docs/VISUAL_FIDELITY_CERTIFICATION.md` described the band as "thin … bounded
(<20% census)". The measured value at this framing is 1.0–1.13% of frame, which
is thin in area but visually prominent because it sits on the two symmetry-axis
columns. The certification annotation now carries the measured figure and a
pointer here, so "thin" is quantitative rather than reassuring.
