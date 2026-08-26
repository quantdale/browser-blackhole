# Deployment, compatibility, and runtime policy

> M11 note: the operative release artifacts are [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)
> (provider-neutral deployment contract) and
> [`docs/COMPATIBILITY_MATRIX.md`](COMPATIBILITY_MATRIX.md) (evidence table).
> This document remains the underlying policy statement; where wording
> differs, the two linked documents win (e.g. device loss is now the locked
> terminal reload-required contract, see `docs/FAILURE_RECOVERY.md` §5).

## 1. Hosting model

The core application should be deployable as static assets over HTTPS. Avoid requiring a backend for rendering. This keeps GPU work local, makes deployment simple, and preserves an offline-capable architecture if a service worker is added later.

## 2. WebGPU capability flow

At startup:

1. determine whether the preferred Three.js WebGPU path is available;
2. request adapter/device through the renderer's supported lifecycle;
3. record optional features/limits needed by advanced paths;
4. initialize a minimal pipeline;
5. expose backend in Debug info;
6. if unavailable/fails, attempt the documented fallback path or show an actionable message.

Never infer support from user agent strings alone.

## 3. Feature tiers

Core renderer should avoid making optional capabilities mandatory. Examples:

- timestamp queries: telemetry enhancement;
- compute/storage features: optimization/advanced path;
- high-quality HDR formats: select best supported format with explicit fallback;
- SharedArrayBuffer: only if a later worker/WASM workload genuinely needs it.

## 4. Cross-origin isolation

If SharedArrayBuffer/WASM threading is introduced, deployment may require COOP/COEP headers and asset compatibility. Do not enable these headers casually; test third-party assets and hosting behavior. Prefer no third-party runtime dependencies/assets that cannot satisfy isolation policy.

## 5. Device loss

WebGPU device loss is a first-class lifecycle event. Renderer code should stop submissions, surface reason where available, and either recreate resources safely or offer a reload/retry path. Tests should simulate/review this path where platform APIs allow.

## 6. Asset strategy

- Keep core textures/LUTs versioned and cacheable.
- Prefer procedural stars initially to reduce asset licensing and loading complexity.
- Add integrity/version metadata for scientific LUT assets.
- Record attribution/license for every non-original environment map or data set.

## 7. Production diagnostics

Debug panel should be removable/collapsible but capable of showing:

- backend;
- renderer/Three.js version;
- quality preset/effective scale;
- CSS/internal dimensions;
- GPU timing if available;
- physics backend;
- LUT version if active;
- device-lost/error state.

Avoid collecting or transmitting hardware identifiers by default.

## 8. Deployment gates

Before release:

- production build served over real HTTPS host;
- cache behavior verified after redeploy;
- no cross-origin asset errors;
- WebGPU and fallback/unsupported messaging checked on target browsers;
- mobile orientation/resize checked;
- source maps/debug artifacts follow intended publication policy;
- security headers do not break shader/assets/workers.
