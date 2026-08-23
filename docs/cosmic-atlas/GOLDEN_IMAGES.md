# Golden images — Gate D visual regression

Deterministic screenshot baselines for Cosmic Atlas destinations. The suite
lives in `tests/browser/visual-goldens.spec.ts`; the harness and spec table
live in `tests/browser/support/goldenHarness.ts`; committed baselines live in
`tests/browser/goldens/*.png`.

## Why this exists

Gate D requires that future destinations, shader changes, post-processing
work and lifecycle refactors cannot silently regress the rendered output of
existing scenes (docs/cosmic-atlas/VALIDATION_TESTING.md §13,
`.agent/QUALITY_GATES.md` Gate D). A golden failure is an alarm bell that
demands investigation — it is never a formatting problem to silence.

## Determinism contract

Every golden capture fixes ALL of these axes before shooting:

| Axis | Fix |
| --- | --- |
| Viewport | 1280x800 (playwright.config.ts `use.viewport`) |
| Screenshot region | `#viewport` element only (no UI chrome) |
| Backend | whatever the machine selects, or `?backend=webgl2` override rows |
| Quality tier | `host.governor.setForcedTier('low')` + explicit `host.handleResize(w, h)` re-apply (nothing else re-fires sizing after a tier pin) |
| Timeline | `host.time.pause()` + `host.time.scrubTo(0)` (except the transition golden) |
| Display chain | `post.setExposure(1)`, `post.setBloom(false, 0)`, `post.setToneMapping('linear')` — same forcing as integrator-parity.spec.ts |
| Camera | destination arrival preset; capture waits for the eased camera to settle (< 1e-4 position delta) — never a fixed wait |

The comparison itself is perceptual-tolerant, not pixel-exact: GPU scheduling
and sub-frame timing make exact equality brittle even on one machine.

## Tolerances

Metrics computed over RGB (alpha ignored):

- `meanAbsDelta` — mean per-pixel channel delta, 0..255 scale;
- `pctPixelsBeyond` — percentage of pixels whose max-channel delta exceeds
  `perChannelThreshold`;
- `maxChannelDelta` — reported for diagnostics, not gated.

A golden passes iff `meanAbsDelta <= tolerance.meanAbsDelta` AND
`pctPixelsBeyond <= tolerance.pctPixelsBeyond`.

## Current goldens

| Name | Route | What regression it catches | Tolerances (mean / beyond% / thr) | Backend expectations |
| --- | --- | --- | --- | --- |
| ATLAS_DIAGNOSTIC | `/atlas/diagnostic` | Atlas boot/compositing regressions; deterministic gradient must stay exact | 2 / 0.5 / 24 | identical on WebGPU and forced WebGL2 (flat pass is backend-free) |
| BH_CLASSIC | `/atlas/black-hole` | Gross Schwarzschild lensing/disk regressions: shadow loss, disk disappearance, inverted beaming, broken HDR chain | 6 / 2 / 32 | hardware WebGPU baseline; WebGL2 rows may be added separately if the two APIs diverge visually |
| NS_SURFACE | `/atlas/neutron-star` | Surface emission / hot-spot / field-line regressions | 6 / 2 / 32 | hardware WebGPU baseline |
| NS_PULSAR | `/atlas/neutron-star?preset=pulsar` | Pulse geometry at phase 0 (spot placement, beam orientation) | 6 / 2 / 32 | hardware WebGPU baseline |
| NS_MAGNETAR | `/atlas/neutron-star?preset=magnetar` | Flare envelope value and tint at fixed flarePhase | 6 / 2 / 32 | hardware WebGPU baseline |
| ATLAS_HYPERSPACE_BH_NS | `/atlas/black-hole` -> navigate neutron-star | Transition system renders AT ALL: streak field present, scene handoff not black, no stuck transition | 25 / 48 / 35 | generous by design: captured frame depends on transition timing jitter |
| SN_PROGENITOR | `/atlas/stellar-explosion?preset=core-collapse` @ phase 0.03 | Missing progenitor surface, tint/gain regression, preset/camera breakage | 4 / 32 / 1.5% | stable (jitter off) |
| SN_FLASH | same @ phase 0.24 | Emissivity-evolution + volume-ignition regressions at the hot flash peak | 6 / 40 / 2.5% | stable |
| SN_EXPANSION | same @ phase 0.55 | Lost volume / broken particle population / gross morphology drift during expansion | 6 / 40 / 3% | stable |
| SN_HYPERNOVA | `?preset=hypernova` @ phase 0.55 | Hypernova structural-state regressions (must stay distinct from core-collapse) | 6 / 40 / 3% | stable |
| SN_GRB_ON | `?preset=long-grb-on-axis` @ phase 0.42 | Lost jet, beaming-response regressions on-axis | 8 / 48 / 4% | stable |
| SN_GRB_OFF | `?preset=long-grb-off-axis` @ phase 0.42 | Off-axis geometric response flattening into a brightness multiplier | 8 / 48 / 4% | stable |
| CM_INSPIRAL | `/atlas/compact-merger?preset=equal-mass-nsns` @ phase 0.05 | Binary inspiral: star/trail loss, orbit-phase regressions, sky breakage | 6 / 2 / 32 | stable (volume/particles dormant) |
| CM_MERGER | `?preset=equal-mass-nsns` @ phase 0.37 | Merger flash envelope + ejecta volume ignition | 8 / 48 / 4% | stable |
| CM_KILONOVA | `?preset=equal-mass-nsns` @ phase 0.7 | Kilonova shell radius/temperature trend + remnant | 8 / 48 / 5% | stable |
| CM_GRB_ON | `?preset=short-grb-on-axis` @ phase 0.54 | Short-GRB jet on-axis (saturated response) lost or dimmed | 8 / 48 / 5% | stable |
| CM_GRB_OFF | `?preset=short-grb-off-axis` @ phase 0.54 | Off-axis bipolar geometry flattening into a brightness multiplier | 8 / 48 / 5% | stable |
| CM_REMNANT | `?preset=kilonova-focus` @ phase 0.9 | Afterglow + prompt-BH remnant scenario + late-timeline resources | 8 / 48 / 5% | stable |

## Update procedure

```bash
# one-time establishment or reviewed regeneration:
UPDATE_GOLDENS=1 npx playwright test visual-goldens
# verification (must PASS):
npx playwright test visual-goldens
```

Rules:

1. NEVER widen a tolerance or regenerate a golden just to make a failing test
   pass. Updates are explicit reviewed acts with a reason recorded here.
2. A physics change requires physical validation (Gate C) even if goldens are
   updated — a golden green light does not certify correctness.
3. When adding a golden row, document why it exists, what regression it
   catches, and its tolerance rationale in both the harness comment block and
   the table above.
4. Keep WebGPU and forced-WebGL2 baselines separate (`_GL2` suffix rows) only
   if the backends demonstrably diverge beyond shared tolerances.

## Known nondeterminism sources

- Governor auto-tier drift: neutralized by tier pinning + resize re-apply.
- Rotation/flare animation: neutralized by pausing the clock BEFORE the
  destination is entered (boot on the default route → `time.pause()` +
  `scrubTo(0)` → navigate). Destinations seed their clock from preset state at
  `enter()` and integrate frame dt only while playing, so they arrive frozen
  at phase 0 regardless of machine load. Post-arrival pause alone is NOT
  deterministic (pre-pause accumulation varies) and was removed as unsound.
- Bloom/exposure presentation: neutralized by the forced linear chain.
- Transition frame timing: NOT fully neutralizable — the hyperspace golden
  therefore carries deliberately loose tolerances.
