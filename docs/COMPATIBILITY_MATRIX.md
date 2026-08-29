# Compatibility matrix — M11-01 (Gate F)

Status of the browser/backend compatibility evidence for the release
candidate. This document distinguishes three things explicitly:

1. **Renderer feature support** — what the application can actually do on a
   backend (WebGPU preferred, WebGL2 fallback for features that genuinely
   support it).
2. **Browser-engine execution of the surrounding UI/fallback logic** — whether
   a non-Chromium engine boots to a truthful READY/fallback/unsupported state
   with clean console and live frames.
3. **Untested hardware/device combinations** — everything not in the evidence
   table below is untested; no claim is made for it.

Rules: a row's status must be backed by a named automated suite (command
listed) run in the listed environment, or be marked `DEFERRED_ENVIRONMENT`
with the reason. User-agent emulation alone never certifies a backend.

## Evidence table

Hosted-CI note (2026-08-27): the GPU-less hosted runner runs only the `quality`
gate and the cheap backend-agnostic `browser-smoke` (`smoke.spec.ts`). Every row
below marked "local capable runner" is exercised on a WebGPU-capable machine
(`npm run e2e`, `--project=firefox`), not hosted CI — hosted runners cannot
stably render the heavy scenes (see `docs/CI_CD.md` §2/§16). Results here are
that local evidence.

| Engine / backend | Status | What is exercised | Evidence | Date |
| --- | --- | --- | --- | --- |
| Chromium-family (msedge) + hardware WebGPU (amd rdna-2, Windows 11) — local capable runner | SUPPORTED — primary path | Full app: all 8 destinations, observer modes, parity corpora, goldens | `npm run check` (515/515 unit), full non-golden Playwright suite 131/131, goldens 43/43 twice-stable | 2026-08-27 |

## Cinematic Visual Fidelity V2 certification (2026-08-30 — restored scope)

The current campaign was validated on Microsoft Edge headless 151 with the
local hardware WebGPU adapter `intel gen-12lp` and Three.js `0.185.1`. The
software WebGL2 fallback (SwiftShader) on the same host is **functionally
correct but ~30× slower** for the heaviest scenes: black-hole arriving
measured **76s wall time** on SwiftShader vs 850ms design and 2.8ms GPU on
hardware. Harness timeouts were therefore raised to **90s (CI 180s)** for
`goldenHarness`/`cinematicGoldenHarness` arrival and **300s** for 10× screenshot
readback on fallback; hardware is the product reference for performance.

| Capability | WebGPU | forced WebGL2 | Classification |
| --- | --- | --- | --- |
| Shared HDR / FP16 volume intermediate | PASS | PASS | Tier A equivalent path |
| SharedPost V2 selective FP16 bloom | PASS | PASS | Tier A TSL/custom hybrid |
| Temporal history/jitter/reprojection | PASS | PASS (slower, bounded) | Tier A; `historyAge 8` on High, `meanLumaDelta<12` |
| Volumetrics V2 detail/depth composite | PASS | PASS | Tier A; `depthClipActive:true` on both, lower budget by tier |
| Particle profiles | PASS with compute where available | PASS with CPU/vertex fallback | Tier B equivalent |
| TDE StrandService | PASS | PASS | Tier B same tube/core, explicit fallback at Low |
| Celestial Environment V2 | PASS | PASS | Tier A procedural path |
| optional glare/PSF kernel | deliberately disabled | deliberately disabled | rejected; see `cosmic-atlas/POST_GLARE_DECISION.md` |

The forced-WebGL2 rows select `debugInventory().backend.api === 'webgl2'`;
they do not silently pass because WebGPU remained active. The current suite
covers every production destination for the V2 feature rows, device-loss
injection, and resource teardown.

Fallback slowness evidence (2026-08-30, same host, fallback SwiftShader):
`ATLAS_DIAGNOSTIC` 2.2m PASS with 90s arrival; `CIN_BH_CLASSIC` 76s arrival + 3.1m
screenshot loop (300s timeout) — functional; `hdr-continuity` 2/2 in 6-7s proves
correctness without 10× readback. Hardware `intel gen-12lp` remains the 43/43
and 8/8 reference (4.6m and 2/2 probe).

Firefox/other-engine fallback behavior is covered by the engine-agnostic
compatibility tests where the environment supplies a renderer. WebKit,
physical-device/browser diversity, and long thermal runs remain
`DEFERRED_ENVIRONMENT`; no universal performance claim is made for them.
| Chromium-family + forced WebGL2 (hosted CI + local) | SUPPORTED — fallback | Root/diagnostic boot on webgl2 with truthful backend reporting, live diagnostic frame, clean console; unsupported terminal UX; (local) black-hole/neutron-star/stellar webgl2 variants, shadow not failure-magenta | Hosted `browser-smoke` (`smoke.spec.ts` forced-webgl2 + unsupported); local `atlas-webgl2.spec.ts`, `stellar-explosion.spec.ts` | 2026-08-27 |
| Chromium-family + unsupported backend override (hosted CI + local) | SUPPORTED — terminal UX | `?backend=unsupported` reaches the terminal unsupported state with visible explained status (never a blank canvas) | `smoke.spec.ts` "forced unsupported shows terminal unsupported UX" (hosted `browser-smoke`) | 2026-08-27 |
| Firefox (Playwright, headless) — local capable runner | SUPPORTED — fallback logic verified (local) | Root experience boots READY on the WebGL2 fallback with live frames; atlas shell boots/arrives; reload restores a valid state; console/page channels clean. NOTE: headless Firefox on a GPU-less host (e.g. hosted CI) has no usable GL context and correctly reaches the terminal no-backend state — so this row is verified on a machine with a real GL stack, never hosted CI. | `npx playwright test --project=firefox` (4/4) on a capable local machine | 2026-08-27 |
| WebKit | DEFERRED_ENVIRONMENT | Playwright does not ship WebKit builds for Windows; no local or CI WebKit available | — | 2026-08-26 |
| Real mobile devices (touch GPUs, mobile browsers) | DEFERRED_ENVIRONMENT | No device farm available. Emulated viewport/touch/DPR coverage exists (`tests/browser/mobile-touch.spec.ts`, M11-02) but it executes on the desktop GPU stack and makes NO mobile performance claim | — | 2026-08-26 |
| Hidden/background tab throttling | COVERED (desktop) | Hidden/resume does not duplicate the frame loop | lifecycle/torture suites (M6+) | 2026-08-26 |
| OffscreenCanvas / Worker / SharedArrayBuffer | NOT APPLICABLE | Feature not used by the application | — | — |

## Firefox row notes

Firefox runs with the Playwright project defined in `playwright.config.ts`
(`compatibility-matrix.spec.ts` only, serial workers). Headless Firefox has
no WebGPU, so the suite asserts READY on the WebGL2 fallback — never a
specific backend beyond what the engine truthfully reports, never a blank
canvas, never an uncaught error. Measured behavior (2026-08-26): the boot
arrival transition takes multiple seconds under software WebGL2 and slows
further under parallel workers (the project therefore runs serially); the
correctness gates (truthful state, live frames, clean console, reload
resilience) all pass. A pass certifies the FALLBACK LOGIC on a second
engine; it does NOT certify WebGPU or performance parity.

## Backend capability semantics (locked)

- WebGPU is preferred; the WebGL2 fallback exists only for features that
  genuinely support it (Schwarzschild numerical/LUT passes, atlas shell).
  Kerr runs numerical-only and reports `lut-inapplicable-while-kerr-active`
  truthfully.
- WebGPU-only features (compute/storage-gated paths) are capability-gated and
  disabled — never emulated — on WebGL2.
- Failed asset/version integrity produces a bounded useful state, never
  silent scientific corruption (Gate G).
- No telemetry leaves the browser in any backend state (product boundary).

## Reproducing

```bash
npm run e2e                       # full suite (Chromium channel per config)
npx playwright test --project=firefox compatibility-matrix   # engine row
```
