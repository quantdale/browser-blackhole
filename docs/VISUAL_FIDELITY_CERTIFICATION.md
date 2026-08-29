# Cosmic Atlas — Cinematic Visual Fidelity Certification

Date: 2026-08-29  
Campaign: `cinematic-visual-fidelity-overhaul`  
Status: **CERTIFIED for the exercised environments**

## Scope and provenance

The campaign was planned from `main@518bff7b8c14e4a22ada4c9376f166d8565c5263`.
The requested OpenSpec directory was absent at that revision, so the scoped
contract was created at
`openspec/changes/cinematic-visual-fidelity-overhaul/` before implementation.

The final application implementation checkpoint is
`2fc1b5d` (`fix(visual): separate system framing from viewer takeover`). The
coherent implementation checkpoints are:

- `2d52085` — deterministic shared cinematic representation layer and the
  Stellar Explosion vertical slice;
- `0c8a3a9` — propagation across the remaining destinations and visual gates;
- `2fc1b5d` — system/user camera-source separation, raw Kerr census setup, and
  synchronized architecture/fidelity documentation.

This document and the completed OpenSpec checklist are the final documentation
checkpoint. The code SHA above is the final SHA under test; the documentation
commit does not alter application code or rendered output.

## What changed

The overhaul adds a shared, backend-neutral representation layer in
`src/renderer/shared/CinematicPrimitives.ts`:

- seeded inside-facing deep-space context with bounded stars and dust;
- temperature/radiance-aware spherical surfaces with limb response and seeded
  granulation;
- optically thin atmosphere/halo shells;
- structured annuli/discs and finite jet cones.

The primitives consume resolved destination values and model time. They do not
own physics state, create a second clock, or replace a validated ray/data path.
Detail is selected by the existing global quality tier and every new object is
owned by the destination `ResourceScope`.

Shared services were hardened where representation quality depended on them:

- `VolumeService` now executes a real active-step work budget while retaining
  normalized optical depth and early termination;
- `ParticleService` has explicit static/dynamic activity and skips simulation
  and population work when state cannot change or no population is visible;
- `RibbonService` keeps its analytic spine and adds a bounded soft halo with
  revision-gated buffer updates;
- `SharedPost` has an opt-in Cinematic finishing graph. Scientific and Debug
  modes retain the restrained diagnostic display chain;
- `CameraRig`/`AutoFramer` distinguish viewer takeover from system, host, and
  transition writes, preserving deterministic scene framing.

The shared layer was propagated to Compact Merger, Tidal Disruption, Neutron
Star, Quasar/AGN, Black-Hole Merger, and Galaxy Collision. Black Hole/Kerr
authoritative ray paths were left intact and passed their non-regression gates.

## Scientific and data invariants

The campaign did not change model constants, units, timeline equations,
termination classifications, numerical-relativity records, Galaxy Collision
coordinates/interpolation, or the direct black-hole/neutron-star ray
interfaces. The bounded neutron-star granulation is presentation applied to
resolved surface shading; direct surface hit/escape and redshift behavior stay
covered by the existing reference tests.

The following boundaries remain explicit in the product documentation:

- stellar explosions and TDEs are reduced/procedural event models, not live
  hydrodynamics or SPH/GRMHD;
- AGN large-scale structures and BBH marker/trail layers are illustrative or
  data-driven as documented;
- the live BBH lensing visualization is not a ray trace of the full dynamical
  spacetime;
- cinematic grade, vignette, grain, halos, and tracer profiles are display
  representations, not new physical observables.

## Validation record

All checks below used the production preview on `127.0.0.1:4299` unless a
command says otherwise.

| Gate | Result |
| --- | --- |
| `npm run check` | **PASS** — formatting, lint, typecheck, 40 Vitest files / 580 tests, and production build |
| Default browser campaign, `npx playwright test --project=default --workers=1` | **228/228 PASS** in 24.2 minutes |
| Visual goldens in the full default campaign | **43/43 PASS** |
| Dedicated final-code visual-golden rerun | **43/43 PASS** in 4.6 minutes |
| Dedicated cinematic representation probe | **2/2 PASS** inside the full campaign |
| Firefox compatibility project, `npx playwright test --project=firefox --workers=1` | **4/4 PASS** |
| Startup graph and dynamic destination loading | **11/11 PASS**; Galaxy Collision probe observed 14 JS requests / 1,339,856 decoded bytes |
| Forced WebGL2 paths | **PASS** across atlas smoke, Stellar Explosion, Neutron Star, Galaxy Collision, Kerr parity/census, and integrator corpus rows |
| Resource/navigation/device-loss/accessibility gates | **PASS** in the full 228-test campaign |

The mandatory dependency gate was Stellar Explosion. Its full-quality slice
passed before propagation and again in the final campaign: normal and forced
WebGL2 presets, deterministic reset, timeline motion, GRB on/off-axis geometry,
transition integration, resource stress, anti-saturation, and normalized
render-side optical depth all passed with clean console/page-error channels.

The reviewed visual rows include the SN progenitor/flash/expansion/hypernova/
GRB states, CM inspiral/merger/kilonova/remnant states, all TDE stages, direct
NS surface/pulsar/magnetar states, AGN inner/nuclear/radio/blazar states, BBH
orbit/flash states, and GC encounter/bridge/post-encounter states. The
regenerated images are stored under
[`tests/browser/goldens/`](../tests/browser/goldens/); the deliberate baseline
reason and linear raw-radiance harness policy are recorded in
[`docs/cosmic-atlas/GOLDEN_IMAGES.md`](cosmic-atlas/GOLDEN_IMAGES.md).

## Matched performance evidence

This is a local comparative snapshot, not a universal device guarantee. It
was captured after the representation propagation checkpoint with Microsoft
Edge 151 on Windows 11, using the application-reported hardware WebGPU
adapter `intel gen-12lp` with timestamp queries available, and the same browser
with the explicit WebGL2 backend override. The benchmark used low quality, a
1280x800 CSS viewport at DPR 1, governed internal dimensions of 583x436 (SN and
GC reported 576x480), a 2-second warmup, and 60 analyzed frames.

The GPU columns are timestamp-query measurements of the resolved frame. The
CPU column is intentionally reported separately: CPU/rAF medians were
16.6–16.8 ms across these rows and are near the compositor/vsync floor on this
machine, so they are not used as a proxy for GPU cost.

| Path | WebGPU GPU ms | WebGL2 GPU ms | Estimated GPU MB |
| --- | ---: | ---: | ---: |
| Black Hole LUT | 2.88 | 0.85 | 4.91 |
| Kerr | 4.98 | 7.03 | 2.54 |
| Neutron Star | 1.70 | 1.92 | 2.17 |
| Stellar Explosion | 1.97 | 2.16 | — |
| Compact Merger | 0.46 | 0.94 | 5.42 |
| Tidal Disruption | 1.11 | 1.40 | 5.41 |
| Quasar/AGN | 1.97 | 2.98 | 11.33 |
| Black-Hole Merger | 0.33 | 0.49 | 14.73 |
| Galaxy Collision | 0.33 | 0.81 | 5.75 |

All benchmark windows recorded zero console errors. These numbers are useful
for matched A/B regression and workload governance only; adapter, browser,
driver, thermal, and compositor changes require a fresh capture.

## Rejected approaches

| Experiment/shortcut | Decision and reason |
| --- | --- |
| Global bloom, saturation, or contrast as the primary fix | Rejected. It does not add spatial representation, hides diagnostic radiance behavior, and cannot repair flat surfaces or black context. Kept only as an opt-in display choice. |
| Large mesh fields for curved rays or star context | Rejected. It violates the full-screen/shared representation architecture and introduces avoidable geometry and lifecycle cost. Seeded shader structure and bounded primitives provide the context. |
| Wall-clock shader animation or `Math.random` | Rejected. It breaks deterministic paused captures and visual regression. All new noise is seeded and driven by model/timeline uniforms. |
| Changing authoritative physics/data for appearance | Rejected. Model equations, datasets, ray classifications, and timeline semantics remain upstream of the representation layer. |
| Making compute/storage shaders a baseline requirement | Rejected. The same TSL representation path compiles through WebGPU and the existing forced-WebGL2 fallback; optional accelerators remain capability-gated. |

## Known limitations and deferred environments

- WebKit, real mobile hardware, and headed end-user browser acceptance remain
  `DEFERRED_ENVIRONMENT`; no result here should be read as their certification.
- Absolute timing and memory values are valid only for the recorded local
  adapter/browser configuration. The product uses governed tiers and bounded
  resources rather than promising a fixed FPS on every device.
- The pre-existing Kerr polar numerical-failure band can paint a thin magenta
  region near the spin axis. It is bounded and documented by the existing Kerr
  policy; this campaign did not hide it or rewrite the integrator.
- The AGN galactic-scale host is intentionally static over the short playback
  window because its physical evolution is far slower than the product
  timeline; no false motion was introduced.
- The new halos, granulation, tracer profiles, and post grade remain
  illustrative presentation layers. They do not claim full radiative transfer,
  relativistic radiation transport, MHD, or dynamical-spacetime fidelity.

## Verdict

The Cinematic Visual Fidelity Overhaul is complete for the exercised
Chromium/WebGPU, Chromium/forced-WebGL2, and Firefox fallback environments.
The entire Cosmic Atlas now has a shared deterministic representation
architecture with destination-specific resolved inputs, preserved scientific
contracts, bounded quality/resource behavior, clean browser/device-loss
validation, and twice-stable visual evidence. The separate whole-atlas
performance campaign remains paused at its own documented next task.
