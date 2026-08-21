# Canonical world/environment frame

This document is the single authority for world-frame conventions. The
executable definitions live in `src/physics/worldFrame.ts`; no module may
independently reinterpret axes, the disk normal, or the sky mapping.

## 1. Chosen conventions (docs were silent)

`docs/PHYSICS.md`, `docs/NUMERICAL_METHODS.md`, and
`docs/SHADER_CONTRACTS.md` fix units, integrator conventions, and shader
interfaces but do not fix world handedness or axes.
`docs/NUMERICAL_METHODS.md` section 14 explicitly leaves Schwarzschild
disk orientation as a scene convention. We therefore adopt the standard
right-handed Y-up convention used by Three.js and most DCC tools:

- **Handedness:** right-handed (`cross(X, Y) = Z`).
- **Axes:** `+Y` world up; `+X` right; `+Z` toward the default viewer
  side. The equatorial plane is XZ.
- **Black-hole center:** exactly the world origin `(0, 0, 0)`, in `r_g`
  units per `docs/NUMERICAL_METHODS.md` section 1.
- **Default disk normal:** `+Y`. For Schwarzschild this is a pure scene
  convention (spherical symmetry); for Kerr it must coincide with the
  spin axis.
- **Sky orientation:** polar angle `theta` measured from `+Y` (north
  pole), azimuth `phi` measured around `+Y` starting at `+X` and
  increasing toward `+Z` (right-handed rotation about `+Y`), range
  `(-PI, PI]`. Poles are degenerate in azimuth and pinned to `phi = 0`.

Rationale: right-handed Y-up matches the existing camera contract
(`forward = -Z` for an identity orientation, see
`tests/unit/camera.test.ts`) and avoids any sign flip when camera basis
vectors are consumed as world vectors.

## 2. Diagram

```text
            +Y  (world up / default disk normal / sky north pole)
             |
             |
             |
             o----------- +X  (right / sky azimuth zero)
            /  black-hole center = origin (0,0,0)
           /
         +Z  (toward default viewer side)

  Right-handed: cross(+X, +Y) = +Z

  Sky mapping (environment sampling):
    direction = (sin(theta) cos(phi), cos(theta), sin(theta) sin(phi))
    theta: 0..PI from +Y down to -Y
    phi:   -PI..PI around +Y, 0 at +X, increasing toward +Z

  Thin disk (M3): lies in the XZ plane, normal +Y,
  inner edge ~6 r_g (Schwarzschild preset).
```

## 3. Rules for consumers

- Camera bases (`right/up/forward` from `CameraController`) are world
  vectors in this frame; do not flip or permute components.
- Environment sampling (`sampleEnvironment`,
  `docs/SHADER_CONTRACTS.md` section 9) receives escaped directions in
  this frame and maps them via `directionToSky`.
- Disk geometry (`DiskGpuParams.normal`) defaults to
  `DEFAULT_DISK_NORMAL`; a Kerr equatorial disk must set it equal to
  the spin axis.
- Any change here requires updating `src/physics/worldFrame.ts`, its
  pinning tests in `tests/unit/worldFrame.test.ts`, and this document
  together.
