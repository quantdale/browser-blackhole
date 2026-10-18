## Context

See `proposal.md`. `traceReferenceRay` wraps `integratePhoton`, maps capture/escape/max-steps, and leaves disk-hit unset. Nothing in `src/` or `tests/` calls it. The GPU Schwarzschild pass classifies disk crossings on its own path.

## Goals / Non-Goals

**Goals:**

- Stop exporting a function that can be read as a disk-hit oracle.
- Keep disk-hit classification on the integrator that already performs it.
- Add a test that fails if a parity or production module imports the retired wrapper for that purpose.

**Non-Goals:**

- Implementing crossing refinement in the wrapper.
- Changing GPU disk detection, goldens, or `integratePhoton`.

## Decisions

### D1 — Unexport, do not reimplement

Remove `traceReferenceRay` from the public export. If an in-file caller appears during implementation, keep a private function whose result type has no disk-hit success channel. Do not add a disk-crossing solver.

**Alternatives rejected.** (a) Implement crossing refinement so the export becomes true — a second integrator with zero callers, and a behavior change this finding did not justify. (b) Leave the export and add a comment — the comment is how the current function already admits the gap, and it is still exported.

### D2 — The existing integrator stays the authority

No production path is switched. The test is a dependency lock: parity and production modules must not import the retired name as a disk-hit source.

## Risks / Trade-offs

- **[External import]** An out-of-tree caller of the export would break. → Mitigation: in-repo search found no caller. The task records that search again before the unexport.
