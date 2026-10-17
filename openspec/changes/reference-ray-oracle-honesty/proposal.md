## Why

`traceReferenceRay` in `src/physics/schwarzschild.ts` leaves disk-hit classification unset and states that crossing refinement is not implemented. A search of `src/` and `tests/` finds no caller. The GPU Schwarzschild pass does detect disk crossings. The exported wrapper can be mistaken for the reference oracle while omitting the event the production pass classifies.

## What Changes

- The repository SHALL NOT export a reference-ray wrapper that can be read as classifying disk crossings it does not compute.
- Production parity SHALL keep using the integrator that already classifies crossings. This change SHALL NOT add a second disk-crossing integrator.
- A test SHALL fail if a parity or production path starts importing the retired wrapper as a disk-hit oracle.

## Capabilities

### New Capabilities

- `reference-ray-oracle`: the contract for what an exported Schwarzschild reference trace may claim, and which integrator remains the disk-hit authority.

### Modified Capabilities

## Impact

- `src/physics/schwarzschild.ts` public surface, and a unit test that the retired wrapper is not a disk-hit oracle.
- Assumption: delete or narrow the export. Do not implement crossing refinement in the dead wrapper. No visual change.
