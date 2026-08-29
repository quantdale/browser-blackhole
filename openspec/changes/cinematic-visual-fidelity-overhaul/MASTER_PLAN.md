# Cinematic Visual Fidelity Overhaul — Master Plan

## 1. Intent and boundary

The current app has sound physics and lifecycle foundations but presents many
destinations as flat unlit primitives on black: a star is a uniform disc,
lines are single-pixel strips, particle clouds have no atmospheric depth, and
most scenes have no environment context. The campaign improves the actual
representation architecture rather than applying a global saturation/bloom
coat.

The boundary is explicit:

```text
validated model/data -> resolved presentation inputs -> shared representation
                         (surface / atmosphere / volume / sprite / ribbon)
                         -> shared HDR display transform
```

The representation layer may add physically motivated visual structure such as
limb darkening, temperature-linked color, optically thin halos, seeded
granulation, depth-scaled sprite profiles, and coherent background context.
It may not rewrite the upstream model or imply radiative-transfer accuracy it
does not have.

## 2. Shared architecture

### 2.1 `CinematicPrimitives`

Add a renderer/shared factory owning deterministic, backend-neutral TSL
materials and bounded geometry for:

- a seeded panoramic deep-space backdrop with multiscale dust and sparse
  stars;
- temperature/radiance-aware spherical surfaces with limb response,
  granulation, soft rim emission, and optional phase uniform;
- optically thin atmospheric/halo shells with analytic radial falloff;
- emissive disc/ring materials with radial temperature and azimuthal structure.

Factories return handles exposing only uniform updates, `Object3D`, and
idempotent disposal. They do not own physics state or a second render loop.
All noise is seeded and driven by a model/timeline uniform supplied by the
destination.

### 2.2 Shared service integration

Upgrade the existing shared services where the visual result depends on them:

- `VolumeService`: active march steps must be a real runtime work budget and
  optical-depth normalization must remain independent of pixel scale. The
  quality tier changes executed work, not merely a nominal step uniform.
- `ParticleService`: sprites use a soft radial profile, stable pixel/world
  semantics, explicit static/dynamic activity, and no simulation/upload when
  no visible state can change.
- `RibbonService`: preserve analytic spine geometry but render a soft core plus
  halo representation, with revision-gated updates and conservative bounds.
- `SharedPost`: preserve HDR and tone mapping; cinematic grading, vignette,
  grain, and bloom are display-only and disabled in Scientific/Debug modes.

The shared primitives must compile through the existing Three.js TSL path for
WebGPU and WebGL2. If an effect cannot meet the fallback contract it is
disabled explicitly, not silently approximated by a different physical model.

## 3. Workstream order

### WS0 — evidence and governance

Capture current cinematic screenshots for Stellar Explosion and every
production destination, record backend/status/console/resource snapshots, and
add deterministic visual probes. Keep the existing physics goldens as
non-regression evidence; they intentionally run with bloom disabled.

### WS1 — Stellar Explosion first slice

Use the existing explosion timeline, density field, emission envelope, jet
plan, and ejecta population unchanged. Replace the uniform progenitor with a
shared temperature/radiance surface. Add a shared deep-space context and a
soft optically thin halo around the shell. Ensure the volume remains the
authoritative shell representation, with the new material only exposing its
resolved temperature, clumping, shell radius, jet response, and model time.

Acceptance:

- pre-flash progenitor has a resolved photosphere (not a matte disc);
- flash/breakout/expansion/nebular frames show shell depth, seeded structure,
  and jet asymmetry without becoming a saturated white sphere;
- model time, shell radius, emission trend, GRB mode, and population gates
  remain unchanged;
- paused captures are deterministic and playing captures visibly evolve;
- `stellar-explosion.spec.ts`, explosion unit tests, all SN goldens, forced
  WebGL2, and console gates pass.

### WS2 — shared representation hardening

Validate active-step volume marching with a sample-evaluation counter, static
particle short-circuiting, soft ribbon output, backdrop bounds, and resource
disposal. Keep quality knobs under the global governor and record matched
workload evidence at equal internal resolution.

### WS3 — destination propagation

Apply only the shared primitives and destination-specific resolved uniforms:

- Compact Merger: temperature-separated neutron-star surfaces, tidal ejecta
  depth, kilonova color evolution, jet/flash atmosphere.
- Tidal Disruption: resolved stellar photosphere/deformation, shock volume,
  debris-stream core/halo, and nascent-disk thermal structure.
- Neutron Star: preserve the direct Schwarzschild surface pass; improve only
  field-line/spot presentation and shared background without changing ray
  classification or surface emission equations.
- Quasar/AGN: preserve direct inner GR pass and zone semantics; improve
  thermal disc/corona/torus layering, jets, host context, and static star
  presentation.
- Black-Hole Merger: preserve NR data and Kerr remnant pass; improve
  illustrative marker/glow/trail representation and phase handoff.
- Galaxy Collision: preserve GC1 coordinates and interpolation exactly;
  improve tracer stellar profiles, nucleus/bridge/tail hierarchy, and
  deterministic galactic backdrop.
- Black Hole: preserve the validated strong-field image and apply only
  display/shared non-regression improvements; no metric or ray change.

### WS4 — presentation and UX

Keep Scientific mode restrained and physically legible. Cinematic mode may
enable the shared presentation profile. Debug mode must keep diagnostic colors
and readouts authoritative. Add concise fidelity copy where a layer is
illustrative or cinematic. Keep keyboard/mobile controls and reduced-motion
behavior intact.

### WS5 — certification

Run unit/reference tests, full capable-runner browser suites, forced WebGL2,
twice-stable cinematic captures, resource torture, startup/transition checks,
and the existing performance gates. Document any environment-unavailable
checks as `DEFERRED_ENVIRONMENT`. Produce the final certification document
only when every justified unblocked task has evidence.

## 4. Performance rules

- Prefer analytic/seeded shader structure over large meshes or unbounded
  particles.
- Cap backdrop complexity and use the existing quality tier for noise octaves,
  volume steps, sprite population, and halo layers.
- Do not increase internal resolution as a hidden visual fix.
- Do not alter numerical ray budgets, capture/escape rules, physics tolerances,
  dataset samples, or model constants for aesthetics.
- Record CPU/GPU timing separately and keep idle invalidation behavior intact.

## 5. Definition of done

The representation layer is used coherently by all eight destinations; Stellar
Explosion has passed first; scientific/reference/data tests are unchanged and
green; visual captures show materially richer, destination-specific structure
in both cinematic and restrained modes; deterministic captures are stable;
WebGPU and forced WebGL2 remain functional; resource counts plateau through
navigation/toggle torture; and `docs/VISUAL_FIDELITY_CERTIFICATION.md` is
present and truthful.
