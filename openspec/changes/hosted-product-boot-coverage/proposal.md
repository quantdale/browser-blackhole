## Why

The product entry in `src/main.ts` sends `/` to `/atlas/black-hole` unless `?legacy=1` is set, or unless `history.replaceState` throws, in which case the legacy app mounts. The hosted browser job runs only `tests/browser/smoke.spec.ts`, and that harness forces `legacy=1`. The only hosted browser gate therefore never mounts the atlas shell. Separately, `src/shaders/diagnostic.ts` imports `DebugViewMode` from `src/app/state.ts`, so a shared shader module depends on the legacy application state module.

## What Changes

- The hosted browser job SHALL prove that the product entry mounted the atlas shell, not only the legacy diagnostic app.
- That proof SHALL stay inside the existing software-WebGL2 stability bound. It SHALL NOT require a lensed frame, a hyperspace transition, or a hardware-WebGPU golden.
- `?legacy=1` SHALL remain available. This change does not remove the legacy shell.
- A shared shader module SHALL NOT import types or values from the legacy application state module. The legacy renderer files that are themselves the legacy shell may keep that import.

## Capabilities

### New Capabilities

- `shared-module-legacy-boundary`: shared modules outside the legacy shell must not depend on legacy application state.

### Modified Capabilities

- `ci-release-readiness`: the hosted browser gate must execute a product-entry boot, not only the legacy smoke it already runs.

## Impact

- `.github/workflows/ci.yml`, a new or extended Playwright smoke, `src/shaders/diagnostic.ts`, and a neutral home for `DebugViewMode`.
- Assumption: full legacy-shell deletion is out of scope. A lensed black-hole arrival is not added to hosted CI.
