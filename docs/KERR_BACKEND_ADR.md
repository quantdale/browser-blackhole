# Kerr backend ADR — conventions, formulation, and validation contract (M9)

Status: LOCKED for M9. Any change to a locked item requires updating this file,
the CPU reference (`src/phenomena/black-hole/kerr/`), the GPU backend, and the
tests together (EXECUTION_PROTOCOL §6 scientific change protocol).

Spec sources cross-checked during M9-01 (primary/standard GR references; no
visualization repository or third-party shader was used as authority):

- [BPT72] J.M. Bardeen, W.H. Press, S.A. Teukolsky, "Rotating Black Holes:
  Locally Nonrotating Frames, Energy Extraction, and Scalar Synchrotron
  Radiation", Astrophys. J. 178, 347 (1972). Orbital formulas used: circular
  geodesic Omega (eq. 2.16), circular-orbit existence condition (eq. 2.17),
  equatorial photon orbit r_ph (eq. 2.18), marginally bound orbit (eq. 2.19),
  marginally stable orbit / ISCO Z1/Z2 form (eq. 2.20), upper/lower sign =
  direct(prograde)/retrograde convention.
- [MTBH] S. Chandrasekhar, "The Mathematical Theory of Black Holes" (1983),
  Ch. III: Boyer-Lindquist metric/inverse metric, first-order separated null
  geodesic system, radial potential R(r), angular potential Theta(theta),
  Carter constant.
- [MTW] Misner, Thorne, Wheeler, "Gravitation" (1973), §33: Boyer-Lindquist
  coordinates, horizons, ergosphere.
- Independent numeric cross-checks: Fujita/Sago/Nakano arXiv:1707.09309
  Table 1 (ISCO radii/frequencies for chi = 0.5, 0.9, 1.0 pro/retro), and the
  published Kerr-calculator BPT restatement (duetosymmetry.com tool page,
  formula identity only). Metric and inverse-metric tables additionally
  compared against the Scholarpedia black-hole-gravity table and V. Ferrari's
  "The Kerr solution" lecture notes (Roma) — all sources agree on every
  component implemented here.
- Numeric self-consistency proofs (implemented as automated tests, see
  docs/TESTING.md §Kerr): null-constraint preservation, E/L_z conservation
  (exact parameters), Carter-constant drift, Hamiltonian-gradient
  finite-difference agreement, u^mu u_mu = -1 normalization of the emitter
  four-velocity against the raw metric, and a->0 limits against the validated
  Schwarzschild reference values. These make the formulas below
  independently falsifiable without trusting any single derivation chain.

## 1. Locked conventions

### 1.1 Metric signature

Signature `(-, +, +, +)` — matching docs/NUMERICAL_METHODS.md §3 (Schwarzschild
`ds^2 = -(1-2M/r)dt^2 + ...`) and keeping the existing null-Hamiltonian
convention (`H = 1/2 g^{mu nu} p_mu p_nu = 0` for photons).

### 1.2 Units

Geometric units `G = c = 1`; lengths measured in `r_g = GM/c^2`. The mass
parameter is therefore `M = 1` internally (identical to the Schwarzschild core;
docs/NUMERICAL_METHODS.md §1). UI-facing units remain `r_g`.

### 1.3 Spin parameter

Dimensionless signed spin `a* = Jc/(GM^2)` (state field `blackHole.spin`,
already clamped to [-0.998, +0.998] by src/app/state.ts STATE_RANGES.absSpin).
The dimensional/geometric Kerr parameter is `a = a* * M` in geometric units,
i.e. numerically `a = a*` at `M = 1`. Sub-extremal: `|a*| < 1` mathematically;
production domain `|a*| <= 0.998` (validated safe boundary; see §14).

### 1.4 Spin axis / world frame

World frame per docs/WORLD_FRAME.md (right-handed, Y-up). The Kerr symmetry
axis coincides with world `+Y` (the disk normal). M9 SCOPE LIMIT: only the
canonical axis-aligned spin axis `[0, 1, 0]` is supported. The canonical state
field `blackHole.spinAxis` is retained as metadata; a non-default axis selects
an explicitly UNSUPPORTED/degraded backend status (never a silently rotated
approximation). Extending to tilted axes requires rotating the ray initial
data into the spin frame and is deferred (recorded in .agent/STATE.md).

Boyer-Lindquist <-> world mapping (locked):

    theta = polar angle from +Y          (world y = r cos(theta))
    phi_w = azimuth about +Y             (x = r sin(theta) cos(phi_w),
                                          z = r sin(theta) sin(phi_w))

so BL phi increases from +X toward +Z — the same right-handed azimuth sense as
the WORLD_FRAME sky convention. The equatorial plane is the world XZ plane
(cos(theta) = 0 <=> y = 0).

### 1.5 Sign of spin; meaning of +/-; prograde/retrograde

Positive `a*`: black-hole angular momentum parallel to `+Y`. Positive `a*`
drags inertial frames in the `+phi_w` direction (counterclockwise seen from
+Y): the ZAMO rate `omega = -g_tphi/g_phiphi > 0` at positive `a` with the
metric signature of §1.1.

LOCKED DEFINITION: the thin disk ALWAYS orbits with `Omega_disk > 0`
(counterclockwise about +Y), inherited unchanged from the Schwarzschild
pipeline (schwarzschildIntegrator.ts header: emitters PROGRADE around world
+Y). "Prograde/retrograde" therefore describes the orbit RELATIVE TO THE SPIN:
positive spin => prograde disk (ISCO shrinks below 6M), negative spin =>
retrograde disk (ISCO grows above 6M). Flipping the spin sign transforms the
physics; it never mirrors or reorients the disk geometry. This keeps the
Schwarzschild preset family and every existing URL/preset byte-compatible.

Formal consequence used by tests: under `a* -> -a*`, a trajectory and its
mirror with `(phi_w -> -phi_w, L_z -> -L_z)` swap roles (spin-sign +
azimuth-reversal symmetry, §13 test list).

### 1.6 Backwards-ray momentum orientation

Identical philosophy to the validated Schwarzschild path: the shader/CPU
integrates the photon momentum `k` FROM the camera INTO the scene ("backward"
ray tracing). `k` is treated as the past-directed photon; its conserved
`E = -k_t` and `L_z = k_phi` are those of the traced momentum. Every physical
observable is built from sign-invariant combinations:

    g = nu_obs / nu_emit = (-k.u_obs) / (-k.u_emit)

is unchanged under `k -> -k` (both contractions flip sign together), so no
per-formula sign patches exist; centralization stays in one place per backend
(NM §16 rule). Positivity gates: `-k.u_emit > 0` is enforced numerically
exactly like the existing `dopplerDenom > 0` gate.

### 1.7 Production coordinate system

Boyer-Lindquist `(t, r, theta, phi)` with the §1.4 world mapping. `t` is NOT
integrated (image geometry is conformally invariant along the null path for a
stationary spacetime; no time-dependent scene element exists in M9).

### 1.8 Observer tetrad (ray initialization)

STATIC observers in Boyer-Lindquist coordinates, valid outside the
ergosphere (`r > M + sqrt(M^2 - a^2 cos^2 theta)`). Because `g_tphi != 0`,
the azimuthal leg must be ORTHOGONALIZED against the timelike leg
(Gram-Schmidt in the t-phi plane); with `f_s = -g_tt = (Sigma - 2Mr)/Sigma`:

    e_(t)  = u_s          = (1/sqrt(f_s)) d/dt            [-g_tt = f_s]
    e_(r)  = (Delta/Sigma)^(1/2) d/dr
    e_(th) = (1/Sigma)^(1/2) d/dtheta
    e_(ph) = sqrt(f_s/(Delta))/sin(theta) * [d/dphi - (g_tphi/g_tt) d/dt]

with `Sigma = r^2 + a^2 cos^2theta`, `Delta = r^2 - 2Mr + a^2`. The naive
`e_(ph) = d/dphi / sqrt(g_phiphi)` is NOT orthogonal to `e_(t)` when
`g_tphi != 0` and produces O(a) null-constraint violation at ray birth —
caught by the machine-precision init-null test, corrected here.
(M9-01 research correction; recorded per EXECUTION_PROTOCOL §6.)

A local unit direction `n = (n_r, n_th, n_ph)` (toward the scene) with local
energy scale `epsilon = 1` gives the EXACT covariant integration data:

    p_r    = epsilon (Sigma/Delta)^(1/2) n_r
    p_theta= epsilon Sigma^(1/2) n_th
    E      = epsilon sqrt(f_s)
    L_z    = epsilon [ n_ph sin(theta) sqrt(Delta/f_s) + g_tphi/sqrt(f_s) ]

These satisfy the null constraint to machine precision BY CONSTRUCTION
(the decomposition is orthonormal), which is asserted as an automated limit
test. Schwarzschild limit check (a=0): `p_r -> n_r/sqrt(f)`, `E -> sqrt(f)`,
`L_z -> r sin(theta) n_ph` — exactly the validated cpuReference tetrad
mapping (NM §2/§7). The inverse projection used for terminal escape
directions follows from the same tetrad with affine scale `kappa = E/
sqrt(f_s)` and is implemented next to the reference solver.

Camera positions at/below the ergosphere, at non-finite radii, or with
degenerate direction route to `INVALID_INITIAL_STATE` (truthful failure; the
UI never offers a "static observer" inside the ergosphere — KERR_RESEARCH_PLAN
§9).

### 1.9 Horizon and ergosphere

    Outer/inner event horizons:  r_+- = M +- sqrt(M^2 - a^2)
    Outer ergosurface:           r_E(theta) = M + sqrt(M^2 - a^2 cos^2 theta)

They coincide only on the rotation axis (cos theta = +-1) and at a = 0; the
renderer must never draw the ergosurface as the shadow/horizon. Centralized in
one helper module consumed by CPU tests, debug overlays, and destination
defaults — never reimplemented per layer.

### 1.10 Null geodesic state and integration formulation

DECISION: first-order Kerr Hamiltonian in Boyer-Lindquist coordinates, RK4
integrated over the reduced state

    state  x = (r, theta, phi, p_r, p_theta)
    fixed parameters: E, L_z (from the §1.8 initialization), a = a*M

with `p_t = -E`, `p_phi = L_z` and

    H(x) = 1/2 g^{mu nu} p_mu p_nu ,  H = 0 on null rays

using the inverse metric (locked, verified against [MTBH]/Ferrari/Scholarpedia
tables):

    g^tt   = -A / (Sigma Delta)
    g^tphi = -2 M a r / (Sigma Delta)
    g^rr   = Delta / Sigma
    g^thth = 1 / Sigma
    g^phphi= (Delta - a^2 sin^2theta) / (Sigma Delta sin^2theta)

Hamilton's equations give the production RHS:

    dr/dl     =  dH/dp_r      =  Delta p_r / Sigma
    dtheta/dl =  dH/dp_theta  =  p_theta / Sigma
    dphi/dl   =  dH/dL_z
    dt/dl     =  dH/d(-E)                       (not integrated; see §1.7)
    dp_r/dl     = -dH/dr    (closed-form derivative, finite-difference tested)
    dp_theta/dl = -dH/dtheta (closed-form derivative, finite-difference tested)

CANDIDATES COMPARED (required by KERR_RESEARCH_PLAN §7):

1. **Separated first-order potentials** (`Sigma dr/dl = +-sqrt(R(r))`,
   `Sigma dtheta/dl = +-sqrt(Theta(theta))` with
   `R = [E(r^2+a^2) - a L_z]^2 - Delta[r^2 + (L_z - aE)^2 + Q]`,
   `Theta = Q - cos^2theta[a^2(0-E^2) + L_z^2/sin^2theta]`):
   REJECTED for production. Requires explicit turning-point sign flipping
   exactly where `R`/`Theta` cross zero — branch-heavy and ill-conditioned in
   f32 precisely near the photon ring/critical region that dominates image
   quality; double root bookkeeping doubles the failure taxonomy.
2. **First-order Hamiltonian, Boyer-Lindquist (SELECTED)**: momenta pass
   through turning points smoothly (no sign logic), smallest evolving state of
   the viable candidates (5 vars), cheapest per-step instruction count, and an
   EXACT smooth a->0 correspondence with the validated Schwarzschild
   (t,r,phi)-plane system: same radial coordinate, same ISCO/horizon numbers,
   same disk-hit-radius observables — the M9-08 convergence gate compares
   observables in IDENTICAL coordinates with no conversion layer.
3. **Second-order orbit ODEs** (d²u/dphi² form generalized to Kerr): REJECTED
   — loses the clean event classification and breaks down off-equatorial.
4. **Kerr-Schild (horizon-penetrating)**: genuinely superior ONLY where rays
   must be integrated THROUGH the horizon (M10 free-fall/plunge observers) or
   arbitrarily close to r+. M9 terminates every captured ray in a finite band
   above r+ (§1.12), so the KS advantage is never exercised by M9 workloads,
   while its costs ARE: 8-var Cartesian state, heavier per-step metric work,
   and an r_KS = r_BL + M radial offset at a = 0 that would force a
   coordinate-conversion layer into every spin-zero convergence comparison.
   DECISION: Boyer-Lindquist for M9; Kerr-Schild ingoing is the DESIGNATED
   migration path if M10 plunge observers require horizon-crossing
   integration. Conversion record for that future migration:
   r_KS = r_BL for ingoing KS with t_KS = t_BL + T(r,r+), dphi shift
   analogous (standard ingoing-KS transformation; to be re-derived and tested
   at migration time, not guessed now).

Why not Kerr-Schild merely because the plan mentions it: the planning
document lists it as the preferred RESEARCH DIRECTION for robustness near/through
the horizon; the evidence-gated tradeoff above shows M9's deliverable
(backwards-traced images with conservative capture termination) does not enter
that regime, while BL maximizes correctness-comparability with the validated
Schwarzschild oracle and minimizes f32/GPU risk. This reasoning is recorded so
M10 can revisit with plunge-observer requirements in hand.

### 1.11 Turning-point policy

No explicit handling REQUIRED by the selected formulation: radial/angular
turning points are ordinary zeros of dr/dlambda / dtheta/dlambda crossed
smoothly by the Hamiltonian flow. Radial/angular TURN COUNTS remain first-class
diagnostics (sign-change counts of dr/dlambda and dtheta/dlambda) for tests
and debug views. There is no "turning-point failure" classification in the
Kerr backend (unlike the separated formulation where it would exist).

### 1.12 Capture / horizon event policy

Two conditions, mirroring the validated Schwarzschild coordinate-stall
resolution (schwarzschildIntegrator.ts capture block):

1. `r <= r+ + captureEpsilon*M` (explicit band, cpuReference-parity), or
2. infalling (`p_r < 0`) AND `Delta/(r^2 + a^2) < 1e-3` — the BL analog of the
   Schwarzschild `f < 1e-3` stall fix: `dr/dlambda = Delta p_r/Sigma` stalls
   linearly in `r - r+`, so a bounded-step ray could exhaust its budget in the
   last ~1e-3 band. Geometrically the ray is then already inside the photon-
   capture region; introduced shadow-boundary error is orders below a pixel.

Captured rays terminate immediately; BL time/phi logarithmic divergence at the
horizon is NEVER integrated through (this is what makes the BL choice safe —
see §1.10).

### 1.13 Numerical-failure taxonomy

Distinct outcome codes (debug-visible; never merged into capture/shadow):

- `CAPTURED` — §1.12 conditions.
- `ESCAPED` — `r > escapeRadius` AND outward (`p_r > 0`), conservative.
- `DISK_HIT(s)` — equatorial-plane crossing events (see §1.14); integration
  CONTINUES after each accepted crossing (higher-order images, additive).
- `NON_FINITE` — any state variable fails the bounded-magnitude proxy
  (`|x| >= 1e30` or NaN; SHADER_CONTRACTS §14 idiom).
- `CONSTRAINT_DRIFT` — normalized null residual `2H/max(terms, eps)`
  exceeding threshold (CPU: 1e-4 like cpuReference; GPU: monitored proxy).
- `CARTER_DRIFT` (CPU reference diagnostics only) — relative drift of the
  §1.15 Carter diagnostic beyond threshold; powerful integrator-quality
  signal, reported per trace.
- `MAX_STEPS` — budget exhaustion (uniform-controlled tier budget within the
  compile-time loop bound).
- `INVALID_INITIAL_STATE` — §1.8 violations (camera inside ergosphere/
  horizon, degenerate direction), plus disk-model parameter violations.

The compact external union exposes `captured | escaped | numerical-failure`
aggregation ONLY alongside an inspectable detailed reason (same policy as the
Schwarzschild reference's documented 'max-steps' aliasing rule, extended to
keep reasons distinct).

### 1.14 Disk-plane crossing convention

Disk = world XZ plane (cos theta = 0), detected on the CURVED trajectory by
signed-height (`y`) sign change between consecutive embedded segment endpoints
— never a Euclidean camera-ray test (NM §10.2 parity). Segment refinement:
fixed-count bisection over the segment parameter with LINEAR interpolation of
the planar state `(r, theta, phi)`, re-embedded per probe (identical disclosed
approximation class as the Schwarzschild pass). Acceptance: refined radius
within `[diskInner, diskOuter]`. Multiple accepted crossings accumulate
additively (higher-order images preserved).

### 1.15 Conserved quantities and diagnostics

Exact parameters (never drift): `E`, `L_z` (held fixed by the formulation).
Monitored diagnostics:

- Null constraint: `R_H = |2H| / max(A E^2/(Sigma Delta), |4 Mar E L_z|/(Sigma
  Delta), (Delta - a^2 s^2)L_z^2/(Sigma Delta s^2), Delta p_r^2/Sigma,
  p_th^2/Sigma, eps)` — max and terminal values per trace.
- Carter constant (null, diagnostic form derived from `p_theta^2 = Theta`):
  `Q = p_theta^2 - a^2 E^2 cos^2theta + L_z^2 cos^2theta / sin^2theta`;
  equivalently `K = Q + (L_z - aE)^2`. Constant along exact solutions; drift
  is the CARTER_DRIFT signal. Equatorial rays have `Q = 0` identically (test).
  Schwarzschild limit: `Q -> L^2 - L_z^2 >= 0` (test).
- Derived invariants: `b_z = L_z/E`; radial/angular turn counts; minimum
  radius; step count.

### 1.16 Circular equatorial emitter model (disk)

Prograde-around-+Y disk per §1.5. For a circular equatorial geodesic at
radius r (units M = 1), with the UPPER sign for prograde-relative-to-positive-
spin and LOWER for retrograde ([BPT72] eqs. 2.16/2.17; sign resolved from the
SIGNED a* so that the disk orientation stays fixed per §1.5):

    Omega = sign / (r^{3/2} + a* )          with sign = +1 when the orbit is
                                            prograde relative to +Y (always,
                                            for the disk) — i.e. the DISK uses
                                            Omega = +1/(r^{3/2} + a*)
    u^t   = (r^{3/2} + a*) / sqrt(r^3 - 3r^2 + 2 a* r^{3/2})
    u^phi = Omega u^t

(The disk always corotates with +Y, so only the "+" branch is used for disk
emitters; negative a* enters through `a*` itself, automatically pushing the
existence boundary `r^3 - 3r^2 + 2a* r^{3/2} > 0` outward — the retrograde
photon orbit.) Existence/validity: `r > r_ph(|a*|, disk-sense)` where

    r_ph = 2[1 + cos(2/3 arccos(-a_eff))],  a_eff = a* for the +Y-corotating
    disk sense evaluated with signed a*  ([BPT72] eq. 2.18)

Below that, `u^t` reports "no orbit" (= 0) exactly like the existing
`emitterUt` contract. Normalization `u.mu u^mu = -1` is asserted against the
raw metric in tests (independent derivation check).

Spin-dependent ISCO ([BPT72] eq. 2.20, signs resolved per §1.5):

    Z1 = 1 + (1-a*^2)^(1/3)[(1+a*)^(1/3) + (1-a*)^(1/3)]
    Z2 = sqrt(3a*^2 + Z1^2)
    r_isco(a*) = 3 + Z2 - sqrt((3 - Z1)(3 + Z1 + 2Z2))     [prograde w.r.t. spin]

with the single-sign form above VALID FOR SIGNED a*: substituting a* < 0
yields the retrograde branch (r_isco(-a*) = retrograde radius of |a*|),
because the disk sense is fixed while the spin flips. Reference vectors:
r_isco(0) = 6 exactly; a*=+0.5 -> 4.233002531; a*=-0.5 -> 7.554584713;
a*=+0.9 -> 2.320883043; a*=-0.9 -> 8.717352279; a*=+0.998 -> ~1.237;
monotone decreasing in a* on the supported domain.

Frequency ratio for the emitter (same invariant structure as the validated
Schwarzschild pipeline, derived from `-k.u` with `u^phi = Omega u^t`):

    g = 1 / ( u^t (1 - Omega b_z) ),    b_z = L_z/E of the traced ray,

gated positive exactly like the existing `dopplerDenom` gate; the shared
emission node applies the Liouville g^3 transform internally (NM §17) — the
backend passes RAW g, never re-multiplies. At a*=0 this reduces to
`1/(u^t(1 - Omega b_z))` with `Omega = r^{-3/2}`, `u^t = 1/sqrt(1-3/r)` — the
exact Schwarzschild formulas of accretionDisk.ts.

### 1.17 Redshift invariant

`g = (-k.u_obs)/(-k.u_emit)` throughout (NM §16); specific-intensity transform
`I_obs = g^3 I_emit` applied once inside the shared emission node. No bolometric
mixing. Static-observer pure gravitational redshift retains its Schwarzschild
analytic test; Kerr adds the circular-emitter consistency checks of §1.16.

### 1.18 f64 CPU-reference strategy

Separate readable module tree `src/phenomena/black-hole/kerr/` (binary64,
RK4, clarity outranks speed; mirrors cpuReference philosophy). Only genuinely
metric-independent helpers may be imported from cpuReference.ts; NO shared
Kerr formula duplication outside the kerr module. Structured per-trace
diagnostics per §1.13/§1.15 including path samples for offline investigation.

### 1.19 f32 GPU strategy

TSL/WebGPU material `src/phenomena/black-hole/kerr/kerrIntegrator.ts` mirroring
the proven schwarzschildIntegrator architecture: fullscreen triangle, compile-
bounded Loop (max-tier bound) + live `uMaxSteps` uniform (no recompile on tier
change — M8 lesson), flat-gate WebGL2-safe conditionals (no and()/or()
IsolateNode chains), bounded-magnitude NaN proxies, DENOM_FLOOR-guarded
divisions (incl. `sin^2theta` floor for the pole), RK4 over the §1.10 RHS,
numerical failures rendered explicit dim magenta (never black/shadow),
debug parity encoding identical in shape to the Schwarzschild one
(`escaped -> dir*0.5+0.5`, captured -> black, failure -> magenta).

### 1.20 Near-horizon / near-critical limitations (declared)

- Rays are never integrated inside the §1.12 band: BL coordinates do not cover
  the horizon interior; no through-horizon physics is claimed (M10 concern).
- Near-critical impact-parameter rays amplify f32 trajectory error
  logarithmically (winding growth) exactly as in Schwarzschild; classification
  sensitivity there is handled by corpus design (rays deliberately away from
  the boundary; tolerances conditioned on winding), not hidden.
- **Coordinate-pole passages (M9 parity finding):** full-3D BL trajectories
  that graze the symmetry axis enter the 1/sin^3(theta) stiffness region of
  dH/dtheta. Both solvers shrink steps with |sin(theta)| (floor 0.02), and an
  ESCAPED ray whose closest approach drops |sin(theta)| below 0.04 is
  RECLASSIFIED as an explicit numerical failure rather than presented with a
  possibly-wrong direction (f32 cannot meet the accuracy budget there;
  captured infall stays robust and unaffected). CPU oracle and GPU implement
  the identical rule so parity corpora skip exactly the same rows.
- Static observers do not exist inside the ergosphere; cameras there are
  INVALID_INITIAL_STATE until M10 introduces physically valid observer families.
- High-|a*| prograde disks put the inner edge close to r_ph where `u^t` grows
  sharply; emitter validity gating follows §1.16 (no orbit -> invisible
  emitter contribution, never a fabricated bright ring).

### 1.21 Supported spin domain and fallback/degradation

Production domain `a* in [-0.998, +0.998]` (state clamp). Backend routing:
metric = 'kerr' ALWAYS executes the numerical Kerr backend (the Schwarzschild
LUT is a Schwarzschild optimization and is truthfully disabled/not applicable);
debug snapshot reports effectiveBackend 'kerr'. If Kerr pass construction
fails on a backend, the destination reports the degraded state truthfully
(fallback pattern + explicit reason) — never silently renders Schwarzschild
while the UI says Kerr. WebGL2 fallback support is determined by EXECUTION
(not compilation) during M9 validation and recorded in .agent/STATE.md; if it
cannot operate correctly, an explicit capability/degradation message is shown
while the rest of the app remains usable.

### 1.22 Implications for later M10 observer modes

- The static-observer tetrad of §1.8 is the M9-only observer family; M10 adds
  ZAMO/circular/freefall tetrads — the init module isolates tetrad construction
  behind one function to keep that extension additive.
- Plunge/freefall observers REQUIRE integrating across r+: that is the trigger
  to migrate to ingoing Kerr-Schild (§1.10 decision record), not a patch to BL.
- Aberration/redshift machinery stays centralized so new observers reuse the
  invariant `g` contract unchanged.

## 2. Conventions NOT changed

Everything in docs/WORLD_FRAME.md, docs/NUMERICAL_METHODS.md (Schwarzschild
sections), docs/SHADER_CONTRACTS.md §6 codes and §12 debug enum, and the
existing intensity-transform chain is inherited verbatim. New debug quantities
(L_z/E display, Carter proxy, turn counts, frame-dragging comparison) EXTEND
the enum via the documented extension procedure rather than renumbering.
