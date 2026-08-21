# Kerr backend research and implementation plan

Kerr is intentionally deferred until Schwarzschild is validated. This file prevents a future agent from implementing a plausible-looking rotating black hole from incomplete formulas.

## 1. Scope

Target: uncharged rotating Kerr spacetime, dimensionless spin `a* = Jc/(GM^2)`, interactive observer outside/near the hole, equatorial accretion disk, frame-dragging and spin-dependent ISCO.

Not initial scope:
- GRMHD plasma simulation;
- self-consistent disk thickness/magnetic fields;
- charged Kerr-Newman metric;
- gravitational-wave dynamics;
- binary black holes.

## 2. Entry requirements

Before M9 implementation:

- numerical Schwarzschild selected-pixel GPU/reference agreement;
- robust explicit numerical-failure classification;
- disk hit/emission pipeline established;
- performance/temporal infrastructure working;
- test fixture generator and convergence protocol established.

## 3. Research sources

Prefer primary/standard GR references and independently cross-check equations. Record exact sources/equation conventions in a Kerr ADR before code.

At minimum research:

- Kerr metric in Boyer-Lindquist coordinates;
- horizon/ergosphere surfaces;
- null geodesic constants `E`, `L_z`, Carter constant `Q`;
- separated radial/angular potentials;
- Kerr-Schild coordinate representation and conversion;
- observer tetrads/camera initialization;
- equatorial circular geodesics and spin-dependent ISCO;
- numerical behavior near horizon/turning points.

Do not rely on one blog post or another demo's shader as scientific authority.

## 4. Spin convention

Use dimensionless signed `a*` with `|a*| < 1` mathematically for sub-extremal holes. Production presets initially cap near but below extremality, commonly around `0.998`, until the solver validates more extreme conditions.

Clarify whether sign denotes black-hole spin relative to a fixed disk orbital orientation or whether disk is always prograde. UI must not make prograde/retrograde ambiguous.

## 5. Characteristic surfaces

In geometric units with mass `M`, Boyer-Lindquist horizon radii:

`r_± = M ± sqrt(M^2 - a^2)`

where dimensional Kerr parameter `a = a* M`.

The outer ergosurface depends on polar angle and differs from the horizon. Never visualize the ergosphere boundary as the event horizon.

## 6. ISCO validation

For equatorial circular orbits, implement the standard Bardeen-form expression only after source verification. A commonly used dimensionless form defines:

`Z1 = 1 + (1-a*^2)^(1/3)[(1+a*)^(1/3)+(1-a*)^(1/3)]`

`Z2 = sqrt(3a*^2 + Z1^2)`

and chooses the prograde/retrograde sign consistently in the final `r_ISCO/M` expression. Unit tests must recover `r_ISCO=6M` at `a*=0` and known prograde/retrograde reference values.

Do not paste the final sign convention into production until the ADR fixes disk-orbit orientation.

## 7. Coordinate choice

Boyer-Lindquist coordinates are analytically convenient but singular at the horizon. Kerr-Schild coordinates are horizon penetrating and are the preferred numerical research direction for robust near-horizon/plunge rendering.

M9 ADR must compare:

- direct integration in Boyer-Lindquist using conserved quantities;
- first-order Hamiltonian integration;
- Kerr-Schild Cartesian/covariant geodesic integration;
- separated geodesic methods using radial/angular potentials.

Decision criteria: correctness, f32 stability, GPU instruction count, branch behavior, disk event testing, and observer mode extensibility.

## 8. Independent reference implementation

CPU reference should favor clarity/double precision over sharing shader code. It must validate:

- null metric constraint;
- constants of motion conservation where applicable;
- horizon capture;
- radial/angular turning points;
- spin-zero convergence;
- prograde/retrograde trajectories;
- equatorial symmetry cases.

Use at least one independent formulation/reference dataset to avoid testing the GPU against the same algebraic mistake.

## 9. Camera/observer initialization

A local camera direction must be mapped through a physically defined observer tetrad into Kerr coordinates/momentum. Define observer family explicitly (static where possible, ZAMO, circular orbit, freefall, etc.).

Inside the ergosphere a static observer is impossible. Product controls must not allow an unphysical “static” camera there without explicit handling.

## 10. Conserved quantities

Kerr null geodesics admit conserved energy `E`, axial angular momentum `L_z`, and Carter constant `Q`. Regardless of integration formulation, reference diagnostics should compute/monitor these where applicable.

Conservation drift is a powerful numerical-quality signal.

## 11. Disk model

M9 equatorial thin disk should use spin-aware circular orbit formulas and ISCO. The Schwarzschild emissivity/temperature approximation may be reused only where its limitations are explicit.

Requirements:

- prograde and retrograde disk orientation defined;
- inner edge follows chosen ISCO model by default;
- emitter four-velocity normalized;
- redshift invariant still uses `g=(-k·u_obs)/(-k·u_emit)`;
- disk-plane crossing geometry consistent with Kerr coordinate/world embedding.

## 12. Spin-zero convergence

This is the primary regression gate.

For matched observer/disk state and `a*` sequence approaching zero:

- ray classifications converge to Schwarzschild;
- escape direction converges;
- disk hit radii converge;
- redshift converges;
- image difference decreases;
- horizon tends to `r=2M` in compatible coordinate interpretation.

If spin zero does not reproduce Schwarzschild, Kerr is not ready regardless of visual appearance.

## 13. Symmetry/reference tests

Add:

- equatorial reflection cases where expected;
- spin sign reversal combined with azimuth/orbit reversal;
- on-axis observer simplifications;
- known spherical/photon orbit reference values from trusted literature;
- high-spin near-horizon stress.

## 14. Numerical failure policy

Kerr likely increases difficult regions. Preserve specific reasons:

- non-finite;
- constraint/conservation drift;
- max steps;
- turning-point handling failure;
- coordinate/domain failure.

Do not enlarge the shadow to hide failed rays.

## 15. Performance strategy

First Kerr implementation is correctness-first and may be slower. Profile separately from Schwarzschild. Potential later optimizations:

- constants-of-motion/separated equations reducing state work;
- adaptive integration;
- specialized turning-point handling;
- tile/difficulty classification;
- precomputation only after a validated numerical baseline.

Do not force Kerr into the Schwarzschild LUT representation unless research proves a suitable mapping.

## 16. Debug views

Kerr-specific debug candidates:

- spin axis;
- ergosphere/horizon reference overlay (educational, not ray result);
- `L_z/E`;
- Carter constant proxy;
- conservation residual;
- radial/angular turning counts;
- frame-dragging comparison with spin zero.

## 17. Observer plunge compatibility

Coordinate/integrator choice should anticipate M10 horizon-near observer worldlines. A renderer that is stable only for distant exterior cameras may block later goals. This is a strong reason to investigate Kerr-Schild/horizon-penetrating formulations.

## 18. Kerr ADR required fields

Before coding, `docs/DECISIONS.md` or a dedicated ADR records:

- metric signature;
- units;
- coordinates;
- spin convention;
- photon momentum orientation/backward-tracing convention;
- observer tetrad;
- integration state/equations;
- disk orbit convention;
- horizon/event detection;
- reference sources;
- known singularities/limits;
- f32 strategy;
- fallback behavior.

## 19. Completion definition

Kerr is complete only when it is scientifically validated within the project's declared model, exposes correct spin-dependent behavior, degrades explicitly on numerical failure, and has measured performance. A visually asymmetric lens is not sufficient.