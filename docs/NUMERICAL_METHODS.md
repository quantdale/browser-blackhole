# Numerical methods specification

This document fixes the numerical strategy for the Schwarzschild correctness renderer and reference solver. It is deliberately explicit so multiple agents do not implement incompatible geodesic conventions.

## 1. Coordinate and unit conventions

Core geometry uses geometric units `G = c = 1` and measures length in `r_g = GM/c^2`. Therefore the Schwarzschild mass parameter is `M = 1`, the horizon is at `r = 2`, photon sphere at `r = 3`, and Schwarzschild ISCO at `r = 6`.

UI conversions to SI/astronomical units occur outside the integrator.

The production Schwarzschild solver should exploit spherical symmetry by tracing each photon in its own geodesic plane. This avoids coordinate-pole pathologies and reduces the numerical state while still allowing the 2D trajectory to be embedded back into world 3D for disk intersections.

## 2. Static-observer tetrad

For `f(r) = 1 - 2M/r`, a static observer outside the horizon can use the orthonormal basis associated with Schwarzschild coordinates:

- `e_(t) = f^-1/2 ∂_t`
- `e_(r) = f^1/2 ∂_r`
- `e_(theta) = r^-1 ∂_theta`
- `e_(phi) = (r sin(theta))^-1 ∂_phi`

A local photon direction `n = (n_r, n_theta, n_phi)` satisfies `|n| = 1`. Choose local photon energy scale `k^(t)=1` because affine scaling does not change the null trajectory.

Coordinate components then satisfy:

- `k^t = 1/sqrt(f)`
- `k^r = sqrt(f) n_r`
- `k^theta = n_theta/r`
- `k^phi = n_phi/(r sin(theta))`

The associated conserved energy for this arbitrary local normalization is `E = f k^t = sqrt(f)`.

The total angular momentum magnitude for the geodesic plane can be represented as `L = r sqrt(n_theta^2 + n_phi^2)`. Thus the impact parameter is:

`b = L/E = r sqrt(1 - n_r^2) / sqrt(f)`.

Tests must verify this mapping at several observer radii and ray angles.

## 3. Geodesic-plane construction

Inputs:

- black-hole center `C`;
- observer world position `O`;
- initial local/world spatial direction `D` after applying the observer tetrad mapping.

Construct a stable plane basis:

1. `e0 = normalize(O - C)`;
2. remove the radial component from `D` to obtain tangent `T`;
3. if `|T|` is above epsilon, `e1 = normalize(T)`;
4. plane normal `N = normalize(cross(e0, e1))`;
5. world position along trajectory can be reconstructed as `C + r * (cos(phi) e0 + sin(phi) e1)` for the chosen orientation.

For nearly radial rays, angular momentum approaches zero. Handle this as a dedicated stable radial path rather than normalizing a near-zero tangent vector.

The exact sign of `phi` and tangent basis must be fixed by camera-ray tests and shared by CPU/GPU code.

## 4. Hamiltonian Schwarzschild state

In the geodesic plane, use coordinates `(t, r, phi)` with conjugate momenta. With `p_t = -E` and `p_phi = L`, the null Hamiltonian is

`H = 1/2 [ -E^2/f + f p_r^2 + L^2/r^2 ] = 0`.

A convenient first-order system is:

- `dr/dlambda = f p_r`
- `dphi/dlambda = L/r^2`
- `dp_r/dlambda = -0.5 * E^2 * f'/f^2 - 0.5 * f' * p_r^2 + L^2/r^3`

where `f' = 2M/r^2`.

`t(lambda)` is not required for static Schwarzschild image geometry, but later time-dependent emitter/observer work may integrate `dt/dlambda = E/f`.

Because multiplying all photon momenta by a constant only rescales affine parameter, the implementation may normalize `E=1` after deriving `b=L/E`; if it does, normalize `p_r` consistently and test the null constraint.

## 5. Alternative orbit-equation reference

For independent validation, the planar null orbit can be expressed with `u = 1/r` as

`d^2u/dphi^2 + u = 3 M u^2`.

This is useful as a second CPU/reference formulation because it has a different implementation shape than the Hamiltonian solver. Do not use it alone for rays with negligible angular momentum or as the only disk-crossing implementation.

## 6. Null-constraint monitor

Evaluate the Hamiltonian constraint during reference integration. Define a normalized residual such as

`R_H = |2H| / max(E^2/f, f p_r^2 + L^2/r^2, epsilon)`.

Record maximum and terminal residual for fixture generation. GPU debug mode may use a cheaper equivalent. Persistent constraint growth is numerical failure even if the resulting pixel looks plausible.

## 7. Initial radial momentum

From the local static tetrad, covariant `p_r = g_rr k^r = n_r/sqrt(f)` for the initial arbitrary local energy normalization. If the solver rescales to `E=1`, use the corresponding scaled `p_r/E`.

Add tests for inward, outward, tangential, and nearly radial rays. Incorrect sign here produces believable but mirrored/catastrophically wrong lensing.

## 8. Integrators

### 8.1 Reference baseline

Start with classical RK4 over the first-order state. It is easy to audit and produces a trustworthy baseline when step size is sufficiently small.

Reference fixtures should be generated at progressively tighter steps until the quantity of interest converges. Store convergence evidence with the fixture generator.

### 8.2 GPU bring-up

The first GPU renderer may use fixed-step RK4 or another explicitly documented method. Fixed-step simplicity is preferable until CPU/GPU agreement exists.

### 8.3 Adaptive production path

After M2 correctness, adaptive stepping may use an embedded Runge-Kutta pair or a curvature/radius heuristic validated against the reference solver. If the GPU method is heuristic rather than formally error-controlled, do not label the UI parameter as a mathematical error tolerance; call it a quality/step control and document measured error bounds.

## 9. Step-size policy

The solver needs high resolution near:

- `r ≈ 3` photon sphere;
- radial turning points where `dr/dlambda` changes sign;
- disk-plane crossings;
- high winding trajectories near the critical impact parameter.

A conservative heuristic may scale step size with radius and radial/tangential state, but must honor global `minStep`/`maxStep` and a maximum number of steps.

Never make a large step across the horizon or disk plane without segment event detection.

## 10. Event detection

### 10.1 Horizon capture

If a segment enters `r <= 2 + captureEpsilon`, classify as `CAPTURED`. Schwarzschild coordinates become singular at the horizon; the image renderer has no need to integrate further for a backward ray known to enter the black hole.

### 10.2 Disk crossing

The thin disk is the world equatorial plane relative to the configured black-hole spin/disk axis. For each integration segment endpoints `x0`, `x1`, evaluate signed disk-plane height `h0`, `h1`.

A sign change or sufficiently small endpoint value creates a candidate crossing. Refine the crossing along the curved segment using interpolation/substepping until spatial/radial error meets the disk-intersection tolerance. Accept only when radius lies between disk inner and outer edges.

Do not simply test the Euclidean ray from the camera against the disk plane.

### 10.3 Escape

Escape must be conservative. A candidate condition is `r > escapeRadius`, outward radial momentum, and estimated remaining weak-field deflection below the configured angular tolerance. Initial versions may choose a deliberately large `escapeRadius`. Performance optimization may tighten it only against reference comparisons.

### 10.4 Max steps / invalid values

If maximum steps are exhausted, any state becomes non-finite, or the integrator violates configured numerical bounds, classify `NUMERICAL_FAILURE`. Do not alias it to `CAPTURED` or `ESCAPED`.

## 11. Critical impact parameter

For a Schwarzschild hole at infinity the critical impact parameter is

`b_c = 3 sqrt(3) M ≈ 5.196152422706632 M`.

Reference tests should trace rays with impact parameters on both sides of `b_c`, plus a sequence approaching it. Behavior becomes increasingly sensitive and winding count grows near criticality. Tests must use tolerances appropriate to this conditioning rather than expecting identical step counts.

## 12. Weak-field check

For large impact parameter, the leading deflection angle is approximately

`alpha ≈ 4M/b`.

Use this as a sanity test at sufficiently large `b`, not as the production lensing equation near the black hole.

## 13. Radial null rays

For `L≈0`, the trajectory is radial. This is a useful special-case validation of capture/escape and sign conventions. Avoid dividing by `L`, impact parameter, or constructing a tangent basis from near-zero angular momentum.

## 14. World-space disk orientation

Define disk normal in canonical black-hole state. For Schwarzschild the spacetime is spherically symmetric, so disk orientation is a scene convention; for Kerr it becomes physically tied to the spin axis if using an equatorial disk.

The geodesic-plane trajectory is re-embedded into world space at every event-test sample so crossing logic remains independent of camera orientation.

## 15. Circular Schwarzschild emitter

For an equatorial circular geodesic at radius `r > 3M`:

`Omega = sqrt(M/r^3)`

and

`u^t = 1/sqrt(1 - 3M/r)`,
`u^phi = Omega u^t`.

The production thin-disk preset uses stable circular orbits from `r >= 6M` unless a separate plunging-region model is intentionally enabled.

## 16. Frequency shift

Use invariant photon-observer contraction:

`nu = -k_mu u^mu`.

Therefore

`g = nu_obs / nu_emit = (-k·u_obs) / (-k·u_emit)`.

Sign conventions must be enforced such that both measured frequencies are positive for future-directed photons/observers in the chosen tracing convention. Backward ray tracing may store a momentum with reversed orientation; centralize any sign conversion instead of patching individual formulas.

For a static observer at finite Schwarzschild radius, validate pure gravitational shift with a static emitter before adding orbital Doppler effects.

## 17. Intensity transformation

Liouville invariance gives `I_nu/nu^3` constant along collisionless propagation, so at corresponding frequencies:

`I_nu,obs = g^3 I_nu,emit`.

For bolometric intensity under the corresponding assumptions, the integrated transformation introduces another power of `g`. The renderer must name which radiometric quantity it stores. Do not mix `g^3` and `g^4` ad hoc to make the disk brighter.

## 18. Precision strategy

Reference CPU calculations should use JavaScript `Number` (IEEE-754 double). GPU production is expected to use f32. This mismatch is intentional: CPU provides a higher-precision reference.

When an f32 trajectory becomes ill-conditioned near the critical curve, acceptable options are:

- more conservative quality settings;
- specialized critical-region method;
- LUT backend;
- explicit numerical-failure visualization.

Do not silently claim f64-level accuracy from an f32 shader.

## 19. Required per-ray diagnostics

Reference solver structure should return at least:

```ts
interface RayTraceResult {
  classification: 'CAPTURED' | 'ESCAPED' | 'DISK_HIT' | 'NUMERICAL_FAILURE';
  steps: number;
  minRadius: number;
  finalRadius: number;
  windingRadians: number;
  maxConstraintResidual: number;
  diskHit?: {
    worldPosition: [number, number, number];
    radius: number;
    affineParameter: number;
  };
  escapeDirection?: [number, number, number];
}
```

GPU debug output may encode a subset into multiple render targets or selected-pixel readback.

## 20. Convergence protocol

Before accepting any numerical fixture:

1. run at baseline step/tolerance;
2. rerun at 1/2 step size or materially tighter tolerance;
3. rerun again;
4. verify the target observable converges;
5. store the tight result as reference and a looser production tolerance separately.

Reference values without convergence evidence are not authoritative.