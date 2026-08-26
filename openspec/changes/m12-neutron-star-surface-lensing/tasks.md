# Tasks: M12 Neutron-Star Surface Lensing Fidelity Closure

Only check a task when its evidence exists in the working tree, logs, tests, committed benchmark record, or closure documentation.

## 1. Baseline and contract freeze

- [ ] 1.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, OS/browser/GPU context used for validation.
- [ ] 1.2 Run `npm ci` and `npm run check`; classify any pre-existing failure before editing.
- [ ] 1.3 Run the existing neutron-star goldens and relevant navigation/fallback suites to capture the pre-change baseline.
- [ ] 1.4 Run existing Schwarzschild ray/integrator parity and Black Hole goldens before touching shared ray code.
- [ ] 1.5 Read the complete neutron-star implementation/spec/fidelity documents plus the canonical Schwarzschild CPU/GPU paths and write a short implementation note identifying the chosen reuse architecture (A shared event core or B destination wrapper).
- [ ] 1.6 Confirm the supported neutron-star radius/compactness control range and explicitly decide how `2 r_g < R <= 3 r_g` is handled; document the decision before coding the renderer.

## 2. CPU/reference surface-ray semantics

- [ ] 2.1 Define a neutron-star-local ray result/classification contract without renumbering black-hole stable codes 0..6.
- [ ] 2.2 Implement or expose canonical backwards Schwarzschild ray initialization for the neutron-star reference path.
- [ ] 2.3 Implement material-surface crossing detection at `R/r_g > 2` that terminates before any would-be horizon capture.
- [ ] 2.4 Refine a bracketed surface crossing to a stable hit radius/position and return finite hit coordinates/normal.
- [ ] 2.5 Preserve canonical escape semantics and return a usable escape direction/background sample contract.
- [ ] 2.6 Preserve diagnosable invalid/non-finite/max-step outcomes; do not map numerical failure to success.
- [ ] 2.7 Add deterministic repeat tests for identical reference inputs.
- [ ] 2.8 Add radial-hit, off-axis-hit, clear-escape, near-limb, invalid-radius and numerical-budget reference tests.
- [ ] 2.9 Add an analytic apparent-limb test for at least one `R > 3 r_g` case using `b_limb = R / sqrt(1 - 2 r_g/R)` and state the tolerance/regime explicitly.
- [ ] 2.10 Add/expand unit tests for existing neutron-star compactness, redshift, spin, pulse, light-cylinder and dipole helpers so the destination finally has a dedicated physics regression suite.

## 3. Production GPU/TSL surface path

- [ ] 3.1 Implement the GPU/TSL Schwarzschild surface-ray path with the same launch convention as the CPU/reference model.
- [ ] 3.2 Implement/refine GPU material-surface termination using the same radius/event semantics as the reference path.
- [ ] 3.3 Reconstruct the geodesic surface hit location/normal in the correct world/local frame.
- [ ] 3.4 Shade surface emission and hot spots from the **geodesic hit coordinate**, not the old straight-line sphere fragment.
- [ ] 3.5 Apply static gravitational redshift consistently with `g = nu_obs/nu_emit = sqrt(1 - 2 r_g/R)` and retain explicit omission of Doppler/aberration/frame dragging.
- [ ] 3.6 Sample the existing celestial/background field for escaped rays.
- [ ] 3.7 Surface numerical failures through an existing or neutron-star-local debug/status path instead of silently painting normal output.
- [ ] 3.8 Ensure procedural field lines/beams/flares remain overlays with unchanged fidelity labels unless intentionally modified.
- [ ] 3.9 Verify resource creation/disposal uses the existing destination scope/resource contracts and adds no unbounded per-navigation allocation.

## 4. CPU/GPU parity and observability

- [ ] 4.1 Add a deterministic neutron-star surface-ray probe/debug mechanism available to tests without normal-frame CPU readback overhead.
- [ ] 4.2 Compare CPU/GPU classifications for center hit, near-limb hit, near-limb escape, off-axis hit and high-deflection supported ray.
- [ ] 4.3 Compare refined hit position/radius (or an equivalent invariant) within a documented numeric tolerance.
- [ ] 4.4 Add failure diagnostics for disagreement that report input ray, mass/radius, CPU result and GPU result.
- [ ] 4.5 Repeat the parity corpus across supported WebGPU/WebGL2 behavior; if a backend cannot run the direct path, verify the fallback is explicit and truthful.

## 5. Dedicated browser coverage

- [ ] 5.1 Add `tests/browser/neutron-star.spec.ts` or equivalent dedicated destination suite.
- [ ] 5.2 Verify direct route boot and all production presets reach stable, finite, non-transitioning state.
- [ ] 5.3 Verify pause/scrub-before-navigation determinism for the rotating destination.
- [ ] 5.4 Verify surface-ray debug/probe state reports valid hit/escape results in-browser.
- [ ] 5.5 Verify preset switching and repeated leave/re-enter cycles do not leak destination resources.
- [ ] 5.6 Verify resize and forced quality-tier changes keep canvas/internal sizing and ray state valid.
- [ ] 5.7 Verify no uncaught page errors/console errors for representative neutron-star flows.
- [ ] 5.8 Run relevant global accessibility, resource-leak, navigation and fallback suites after the destination-specific suite is green.

## 6. Black-hole non-regression gate

- [ ] 6.1 Run unit Schwarzschild/reference tests after any shared-core changes.
- [ ] 6.2 Run `tests/browser/ray-parity.spec.ts` and `tests/browser/integrator-parity.spec.ts` on all relevant backends.
- [ ] 6.3 Run LUT/disk parity if shared code touched LUT/disk paths.
- [ ] 6.4 Run Kerr parity/integration if the refactor reaches Kerr/shared observer initialization.
- [ ] 6.5 Run all Black Hole/Kerr/observer visual goldens before accepting the neutron-star renderer change.
- [ ] 6.6 Treat unexplained black-hole parity/golden drift as a blocker; do not regenerate black-hole baselines to absorb it.

## 7. Neutron-star visual validation

- [ ] 7.1 Run the old neutron-star goldens without update and save/report the expected physical diff metrics.
- [ ] 7.2 Inspect the new apparent limb, surface morphology and hot-spot mapping for consistency with reference/parity evidence.
- [ ] 7.3 Regenerate **only** `NS_SURFACE`, `NS_PULSAR`, and `NS_MAGNETAR` baselines through the explicit reviewed golden workflow.
- [ ] 7.4 Run the complete visual-golden suite twice independently with no unreviewed drift.

## 8. Performance evidence

- [ ] 8.1 Add a neutron-star benchmark harness following existing Cosmic Atlas benchmark record conventions.
- [ ] 8.2 Add a discoverable package script for the harness.
- [ ] 8.3 Capture same-machine before/after evidence for representative presets/quality tiers, clearly distinguishing CPU/rAF and true GPU timing.
- [ ] 8.4 Verify the direct path remains within the documented destination budget or record a justified quality-tier strategy with no hidden fidelity downgrade.
- [ ] 8.5 Record resource-count/byte behavior where existing diagnostics expose it.

## 9. Documentation and truthfulness

- [ ] 9.1 Update `README.md` so “compact-surface ray tracing” is true in the shipped implementation and list the remaining approximations.
- [ ] 9.2 Update `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md` implementation status and validation evidence.
- [ ] 9.3 Update `docs/cosmic-atlas/SCIENTIFIC_FIDELITY.md` with the precise DIRECT/procedural boundary.
- [ ] 9.4 Update benchmark/testing/diagnostic docs for the new harness/probes.
- [ ] 9.5 Update relevant roadmap/backlog/state records with actual pass/fail/deferred evidence; do not mark environment-deferred items PASS.

## 10. Closure gate

- [ ] 10.1 Run `npm run check` from a clean dependency state.
- [ ] 10.2 Run the full intended Playwright suite for the available environment.
- [ ] 10.3 Run all change-specific parity and visual gates and preserve logs/summary evidence.
- [ ] 10.4 Inspect `git diff` for temporary probes, downloaded papers/data, machine paths, secrets and accidental golden churn.
- [ ] 10.5 Update this checklist and closure/state docs only from observed evidence.
- [ ] 10.6 Commit with a detailed M12-NS report including baseline SHA, implementation summary, tests/gates, benchmark context, known limitations and any environment-deferred validation.
- [ ] 10.7 Push the completed change when authorized; only then unblock M12-RI.
