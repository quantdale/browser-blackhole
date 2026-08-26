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

| Engine / backend | Status | What is exercised | Evidence | Date |
| --- | --- | --- | --- | --- |
| Chromium-family (msedge 151) + hardware WebGPU (amd rdna-2, Windows 11) | SUPPORTED — primary path | Full app: all destinations, observer modes, parity corpora, goldens | `npm run check` (476/476 unit), `npm run e2e` (146/146 @ workers=2), goldens 40/40 twice-stable | 2026-08-26 |
| Chromium-family (msedge 151) + forced WebGL2 | SUPPORTED — fallback | Black-hole, neutron-star, diagnostic deep links boot on webgl2 with truthful backend reporting, live frames, clean console; shadow not failure-magenta; stellar-explosion webgl2 variants | `tests/browser/atlas-webgl2.spec.ts`, `smoke.spec.ts` (forced webgl2), `stellar-explosion.spec.ts` (+webgl2 variants) | 2026-08-26 |
| Chromium-family + unsupported backend override | SUPPORTED — terminal UX | `?backend=unsupported` reaches the terminal unsupported state with visible explained status (never a blank canvas) | `smoke.spec.ts` "forced unsupported shows terminal unsupported UX" | 2026-08-26 |
| Firefox 153 (Playwright, headless, software WebGL2) | SUPPORTED — fallback logic verified | Root experience boots READY on the WebGL2 fallback with live frames; atlas shell boots, arrives (slow under software rendering — correctness asserted, never speed), reload restores a valid state; console/page channels clean | `npx playwright test --project=firefox` (4/4) | 2026-08-26 |
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
