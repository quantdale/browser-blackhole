# Physics specification

This document fixes conventions so CPU code, GPU shaders, UI labels, tests, and documentation describe the same model.

## 1. Scope

Initial scientific target: null-geodesic ray tracing around a non-charged, non-rotating Schwarzschild black hole plus a simplified emitting accretion disk and distant celestial background.

Later target: Kerr spacetime with dimensionless spin and frame dragging.

The renderer is a visualization, not a substitute for a research-grade GRMHD/radiative-transfer code. Where the disk/emission model is simplified, say so explicitly.

## 2. Units and characteristic radii

Define gravitational radius:

`r_g = GM/c^2`

For Schwarzschild, expressed in `r_g`:

- event horizon: `r_h = 2`
- photon sphere: `r_ph = 3`
- innermost stable circular orbit (prograde/retrograde distinction does not exist for Schwarzschild): `r_ISCO = 6`
- asymptotic critical impact parameter: `b_c = 3 sqrt(3) r_g`

Do not conflate event horizon, photon sphere, critical impact parameter, and observed shadow.

## 3. Schwarzschild metric

In Schwarzschild coordinates:

`ds^2 = -(1 - 2M/r) dt^2 + (1 - 2M/r)^(-1) dr^2 + r^2(dtheta^2 + sin^2(theta) dphi^2)`

when `G=c=1`. If internal code uses `M=1`, document conversions consistently. The UI-facing convention remains `r_g=GM/c^2`.

Because of spherical symmetry, any null geodesic lies in a plane through the center. Implementations may exploit this for the first solver and reference tests.

## 4. Backwards ray tracing

For each pixel:

1. construct a normalized camera-space direction;
2. transform into the black-hole/world frame;
3. derive photon initial conditions/constants of motion in the selected coordinates;
4. integrate backward from observer toward the scene;
5. terminate as captured, disk/emitter hit, or escaped;
6. shade from emitter/background and apply relativistic frequency/intensity transformations.

The camera cannot simply cast a Euclidean ray and distort UVs near a black circle in the scientific renderer.

## 5. Termination classifications

Every production/reference ray should be classifiable as at least:

- `CAPTURED`
- `ESCAPED`
- `DISK_HIT`
- `MAX_STEPS` / `NUMERICAL_FAILURE`

The final category must be visible in debug mode; never silently color numerical failure as the event horizon.

Early termination is valid only with conservative criteria. A ray inside the event horizon is captured. Escape tests must establish that the ray is sufficiently far and moving outward such that further lensing is beneath the chosen tolerance.

## 6. Integration strategy

Start with a simple, auditable integrator and fixed quality settings. After validation, add adaptive step sizing/tolerance near high-curvature regions and disk crossings.

Candidate integrators should be compared using reference rays, not selected only by implementation convenience. RK4 is an acceptable bring-up reference; production may use a more efficient/adaptive method if it preserves error bounds.

Track numerical quantities useful for diagnostics: steps, minimum radius, path angle/winding estimate, termination reason, and error/tolerance where available.

## 7. Accretion disk

M3/M4 start with a geometrically thin disk in the equatorial plane. A ray-disk crossing must be solved along the curved photon trajectory, not by rendering the disk as an ordinary visible Three.js plane.

Scientific Schwarzschild preset:

- inner edge approximately at `6 r_g` unless explicitly demonstrating plunging emission;
- configurable outer edge;
- Keplerian orbital velocity model appropriate to the chosen approximation;
- documented radial emissivity/temperature profile.

A later finite-thickness/volumetric disk requires radiative transfer along the ray and is not a prerequisite for initial production readiness.

## 8. Frequency shift and beaming

Use a clearly defined frequency-shift factor:

`g = nu_observed / nu_emitted = (k_mu u_observer^mu) / (k_mu u_emitter^mu)`

with sign/convention verified in implementation tests.

For specific intensity, Liouville invariance gives `I_nu / nu^3` invariant along the ray, yielding `I_nu,obs = g^3 I_nu,emit` at corresponding frequencies. Frequency-integrated/bolometric transformations introduce an additional factor. Do not apply an arbitrary brightness multiplier and call it Doppler beaming.

At nonzero inclination, approaching disk material should become blueshifted/brighter relative to receding material. Face-on symmetry provides a useful test.

## 9. Spectrum and temperature

A simplified blackbody/Planck spectrum or efficient approximation is sufficient for the initial disk. Separate:

- physical temperature/emissivity model;
- display exposure/tone mapping;
- cinematic color override.

If full spectral rendering is too expensive, document the approximation used to map local temperature and `g` into RGB.

## 10. Mass and scale invariance

Schwarzschild geometry expressed entirely in units of `r_g` is scale invariant. If observer radius, disk radii, and other distances scale with mass, changing mass alone should not arbitrarily change the normalized image.

Provide:

- **Normalized mode:** distances in `r_g`; mass mainly changes converted physical units/timescales.
- **Physical mode:** observer/disk distances may be specified in physical units; changing mass then changes their normalized distance and angular appearance.

This behavior needs a documentation test because a naive "mass = lens strength" slider is scientifically misleading.

## 11. Kerr extension

Do not begin Kerr until Schwarzschild milestone gates pass.

Use dimensionless spin `a* = Jc/(GM^2)` or an equivalent documented convention, with production presets kept away from exact extremality. Kerr introduces axial rather than spherical symmetry, frame dragging, and spin-dependent ISCO.

Kerr-Schild coordinates are the preferred research direction for a robust numerical renderer around/through the horizon. The Kerr backend must satisfy `spin -> 0` convergence tests against the Schwarzschild renderer/reference.
