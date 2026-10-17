## 1. Confirm there is no caller

- [x] 1.1 Search `src/` and `tests/` for `traceReferenceRay`. Record every hit. Stop if a production or parity caller exists and report it instead of unexporting. — definition only: `src/physics/schwarzschild.ts:535` (plus a header-comment mention at :35). AFT search found similarly-named functions (`traceSurfaceRay`, `traceSchwarzschildPlane`) but ZERO callers of `traceReferenceRay` in `src/` and zero hits in `tests/`. Clear to retire.

## 2. Retire the misleading export

- [x] 2.1 Remove `traceReferenceRay` from the public export of `src/physics/schwarzschild.ts`. — no in-file caller existed (D1's private-fallback shape not needed), so the wrapper, its `TraceReferenceRayOptions` alias and its `wrapToPi` helper were deleted outright; imports of `integratePhoton`/`DEFAULT_PHOTON_INTEGRATION_OPTIONS`/`PhotonIntegrationOptions` dropped with it. `tsc --noEmit` clean; the module keeps exporting the classification codes its three integrator importers use.
- [x] 2.2 Do not add a disk-crossing solver. Do not change `integratePhoton` or the GPU disk-hit path. — `cpuReference.ts`, `schwarzschildIntegrator.ts`, `kerrIntegrator.ts` untouched.
- [x] 2.3 Add a unit test that fails if a parity or production module imports the retired name as a disk-hit source. — `tests/unit/schwarzschildCore.test.ts`: a `src/**` + `tests/**` source scan fails on any `\btraceReferenceRay\b` occurrence outside the lock file itself, with a message naming D1 and the disk-hit authority integrators. Created alongside a coverage floor over the remaining public helpers (codes 0–6, `isNumericalFailure`, `classificationName`, `classifyRadiusEvent`, `staticTetradMap`, `rayInitialStateFromWorld`) — no existing unit file covered the module.

## 3. Gate

- [x] 3.1 Run the new unit test and the Schwarzschild unit file that covers the remaining public helpers. — one file does both: `npx vitest run tests/unit/schwarzschildCore.test.ts` → **7/7 passed** (0.44s).
- [x] 3.2 Run `openspec validate --change reference-ray-oracle-honesty --strict`. — `openspec validate reference-ray-oracle-honesty --type change --strict`: **valid**.
