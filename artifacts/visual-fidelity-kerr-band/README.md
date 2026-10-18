# Kerr magenta-band review set

Not goldens. Do not copy these over `tests/browser/goldens`.

Evidence for `docs/VISUAL_FIDELITY_KERR_MAGENTA_BAND.md`. Produced by
`scripts/diag-kerr-band.mjs`, `scripts/probe-kerr-band-pixels.mjs`,
`scripts/probe-kerr-presentation.mjs`, `scripts/probe-kerr-cpu-rays.ts` and
`scripts/probe-kerr-f32-divergence.ts`.

Conditions: Brave (Chromium), WebGPU `nvidia lovelace` (RTX 4050 Laptop,
driver 610.62) unless noted; preset `kerr-high-prograde` (a* = +0.9); viewport
1280×800 CSS; internal **972×727** with `setRenderScaleOverride(1)`;
timeline paused at `scrubTo(0.5)`; tier forced; bloom off, exposure 1,
`linear` tone map for the census rows.

## baseline/

- `normal.png` — the physical view at internal resolution, with failure-magenta
  pixels highlighted green. The two polar columns are the band.
- `status.png` — the `?kerrstatus` classification view, failures highlighted.
- `mask-overlay.png` — **the registration proof.** Red = failure status,
  green = physical magenta, **white = agreement**. Almost entirely white.
- `mask-physical-magenta.png`, `mask-status-failure.png`,
  `mask-status-pole.png`, `mask-status-wrap.png`, `mask-status-maxsteps.png`
  — per-class masks.
- `*.json` — machine-readable censuses and the registered contingency table for
  four configurations (WebGPU High/Medium, forced WebGL2 Medium, cinematic).

## diagnostics/

- `pixel-probe.json` — exact-RGB histograms in both views. This is what proved
  the magenta is `80,0,80` = linear (0.08, 0, 0.08) and the status colour at
  those coordinates is pole yellow `(1.0, 0.9, 0.2)` rendered as `255,243,124`.
- `presentation-amplification.json` — bloom/exposure/tone-map sweep; tinted/core
  spread **1.004×**, i.e. presentation is not responsible for the band.
- `cpu-probe-rays.json` — live-camera rays through the binary64 oracle with full
  diagnostics (min|sin θ|, steps, null residual, Carter drift, turns).
- `f32-divergence.json` — production-faithful f32 emulation versus the ungated
  f64 oracle; the committed table behind doc §6.

Headline numbers: magenta **1.1274%** of frame (High) / **1.1709%** (Medium);
**99.69%** of magenta explained by failures; **IoU 0.9969**; **100%** of
failures displayed as magenta; failure census **pole 1.1231%**, theta-wrap
0.0008%, max-steps 0%.

Regenerate with:

```bash
node scripts/diag-kerr-band.mjs --out=artifacts/visual-fidelity-kerr-band/baseline --backend=webgpu --tier=high --label=webgpu-high-scientific
node scripts/probe-kerr-band-pixels.mjs
node scripts/probe-kerr-presentation.mjs
npx tsx scripts/probe-kerr-cpu-rays.ts
npx tsx scripts/probe-kerr-f32-divergence.ts
```
