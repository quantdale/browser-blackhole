# Cosmic Atlas architecture decisions

These decisions are locked for the planning branch unless replaced by an explicit ADR with rationale and migration impact.

## CA-ADR-001 — One application, not independent pages

Cosmic Atlas uses one application/runtime and one renderer lifecycle. Destinations are modules, not separate Three.js apps.

Reason:

- avoids repeated device/canvas creation;
- makes transitions possible without blank reloads;
- centralizes quality control and capability handling;
- prevents duplicated particle/volume/lensing stacks.

## CA-ADR-002 — One fully active heavy destination

Only one heavy destination receives full simulation/render budget at a time.

The outgoing scene may remain as a frozen texture/low-cost state during transition. The target may prefetch CPU/network assets before activation.

Reason: bounded GPU memory and thermal behavior.

## CA-ADR-003 — Phenomenon module lifecycle is mandatory

Every destination implements equivalent lifecycle operations:

- `prepare()`
- `enter()`
- `update()`
- `render()`
- `exit()`
- `dispose()`

`prepare()` may load assets and compile/warm pipelines without becoming the active scene.

## CA-ADR-004 — Hyperspace doubles as a loading boundary

The cinematic transition intentionally occludes enough of the outgoing scene to permit target resource finalization and old-resource release.

The transition must still remain smooth if preparation is already complete.

## CA-ADR-005 — Reduced motion bypasses vestibular effects

When `prefers-reduced-motion: reduce` is active, hyperspace radial acceleration/streak motion is replaced by a short crossfade/soft dissolve while the same loading lifecycle occurs.

## CA-ADR-006 — Fidelity must be declared

Every destination/preset declares:

- `DIRECT`
- `DATA_DRIVEN`
- `PROCEDURAL_SCIENTIFIC`
- `CINEMATIC`

The UI/About panel exposes the distinction in plain language.

## CA-ADR-007 — Do not run HPC-class physics live in browser

Full numerical relativity, high-resolution hydrodynamics/MHD, and large scientific N-body simulations are not production browser requirements.

Use reduced equations, validated precomputed data, or clearly labeled procedural approximations.

## CA-ADR-008 — WebGPU primary, graceful fallback

Three.js `WebGPURenderer` remains the preferred backend. WebGPU-only compute/storage optimizations must have an explicit fallback or destination capability policy.

No blank canvas on unsupported hardware.

## CA-ADR-009 — Fragment vs compute follows workload shape

Fragment/full-screen passes are preferred for per-pixel lensing, ray marching, post-processing and transition effects.

Compute is preferred for persistent particle/tracer simulation, field sampling, culling/compaction, and data transforms when it changes the algorithm beneficially.

Do not introduce compute just to claim WebGPU usage.

## CA-ADR-010 — GPU-resident large particle state

Large particle/tracer systems remain in GPU buffers whenever practical.

Avoid per-frame JavaScript updates for hundreds of thousands of particles.

## CA-ADR-011 — Scientific data uses manifests and binary payloads

Large trajectories, fields and particle datasets use versioned binary payloads plus small metadata manifests.

Do not ship huge arrays as verbose JSON.

## CA-ADR-012 — Static hosting remains the default product architecture

No server/database is required for launch.

Offline preprocessing may use Python/Rust/scientific tools. Runtime assets are deployed as static versioned files/CDN objects.

Add a backend only when a real product requirement exists.

## CA-ADR-013 — Black-hole renderer remains scientifically independent

Cosmic Atlas may wrap/reuse the existing black-hole renderer but may not simplify its physics merely to match shared destination abstractions.

Shared abstractions adapt to the strongest correctness requirements.

## CA-ADR-014 — Deterministic presets are first-class

Every destination must provide deterministic validation presets with fixed seed, timeline phase, camera, quality and assets.

Visual regression and benchmark scenes depend on this.

## CA-ADR-015 — Quality governor is global

Frame budget, dynamic resolution, interaction/settling/stable states, and device-tier policy are managed centrally.

Destinations expose quality knobs but do not independently fight the global controller.

## CA-ADR-016 — Resource scopes are explicit

Each destination owns a resource scope tracking:

- textures;
- render targets;
- GPU buffers;
- materials/pipelines;
- workers;
- abort controllers;
- subscriptions;
- event listeners;
- timers.

`dispose()` must make scope inventory return to zero except explicitly shared caches.

## CA-ADR-017 — Approximate binary-BH lensing must be labeled

If Black-Hole Merger initially visualizes two moving local lens approximations rather than ray tracing a dynamical numerical-relativity spacetime, UI/documentation must say so.

## CA-ADR-018 — Galaxy dynamics are data-driven first

Production Galaxy Collision does not begin with all-pairs browser gravity.

Use reduced/precomputed scientific trajectory or flow data and GPU visual tracers.

## CA-ADR-019 — Volumetrics default to procedural/compact representations

Do not casually introduce giant dense 3D textures. Prefer analytic shells, sparse/compact data, procedural density and half/quarter-resolution volume passes until a real scientific volume justifies its memory cost.

## CA-ADR-020 — Transition visuals are not scientific

Hyperspace/interstellar travel is explicitly a cinematic navigation effect and must never be described as a relativistically correct faster-than-light model.

## CA-ADR-021 — Black-Hole Merger pins SXS:BBH:0001 Zenodo record 13166927 (CC-BY-4.0)

The CA8 data-driven destination reduces the pinned Zenodo record of
SXS:BBH:0001 (Lev5; explicit record-level CC-BY-4.0 license; per-file MD5
checksums published by the record API). Full provenance, survey and the
gauge-dependence boundary live in docs/cosmic-atlas/DATA_SOURCES_BBH_MERGER.md.

Reasons:

- redistribution of derived reduced artifacts requires an explicit grant;
  the pinned record is the variant that provides one (CC-BY-4.0), while the
  v3.0 CaltechDATA records expose no machine-readable license field;
- per-file checksums make offline acquisition reproducible (Gate G /
  DATA_PIPELINE §14);
- equal-mass non-spinning is the canonical first production contract.

Consequences:

- attribution obligations (Mroue:2013xna et al.) ride in the manifest, this
  doc set and the destination About panel;
- RPDMB decoding uses the official MIT `sxs` package as OFFLINE tooling
  only — no SXS/sxs code or dependency enters the runtime bundle;
- NR coordinate trajectories are consumed as gauge-dependent coordinate
  paths and must be labeled as such (never invariant observables).