# Cosmic Atlas work packets

Packets are sized for autonomous-agent execution. IDs remain stable in commits/checkpoints.

## CA0 — Host/lifecycle

### CA0-01 — Inventory integration surface

Inspect current application/renderer/state boundaries and identify the smallest adapter required to host Black Hole as a destination.

Evidence: architecture note listing owned/shared modules and zero duplicated renderer creation.

### CA0-02 — Destination descriptor/registry

Implement descriptor schema, route IDs, default presets, lazy loaders and validation.

Tests: duplicate IDs/routes rejected; invalid presets rejected.

### CA0-03 — Module lifecycle contract

Implement prepare/enter/update/render/exit/dispose interfaces and lifecycle coordinator.

Tests: legal/illegal transition ordering.

### CA0-04 — ResourceScope

Track textures, buffers, render targets, materials, workers, listeners, timers, fetches and estimated bytes.

Tests: every class disposes.

### CA0-05 — Black Hole adapter

Wrap existing renderer without changing scientific behavior.

Evidence: existing black-hole regression gates.

### CA0-06 — Diagnostic destination

Create lightweight deterministic destination exercising lifecycle and UI only.

### CA0-07 — Routes and deep links

Implement `/atlas/<id>` plus preset parsing/validation.

### CA0-08 — Repeated navigation test

Automate at least 20 Black Hole ↔ Diagnostic switches and assert bounded resources.

### CA0-09 — Atlas debug inventory

Expose active destination, renderer generation, resource counts and pending prepares.

### CA0-10 — CA0 checkpoint

Run cumulative gates, update docs/state and benchmark host overhead.

## CA1 — Transition/streaming

### CA1-01 — Transition state schema
### CA1-02 — Target generation/cancellation token
### CA1-03 — Minimum-ready preparation contract
### CA1-04 — Full-screen hyperspace shader
### CA1-05 — Outgoing scene texture/freeze strategy
### CA1-06 — TRANSITION quality policy
### CA1-07 — Occlusion resource handoff
### CA1-08 — Arrival camera/quality ramp
### CA1-09 — Reduced-motion crossfade
### CA1-10 — Slow-load status
### CA1-11 — Browser back/forward integration
### CA1-12 — Race and cancellation tests
### CA1-13 — Transition benchmark
### CA1-14 — CA1 checkpoint

## CA2 — Shared renderer services

### CA2-01 — Service ownership/frame-graph design
### CA2-02 — GPU ParticleService baseline
### CA2-03 — Compute particle update path
### CA2-04 — particle fallback/low-tier path
### CA2-05 — VolumeService bounding march
### CA2-06 — half-resolution volume target
### CA2-07 — temporal/depth-aware volume composite
### CA2-08 — RibbonService
### CA2-09 — TrajectoryService analytic/spline/data paths
### CA2-10 — FieldLineService
### CA2-11 — shared binary loader/manifests
### CA2-12 — deterministic seed/time API
### CA2-13 — synthetic service benchmarks
### CA2-14 — disposal stress suite
### CA2-15 — CA2 checkpoint

## CA3 — Neutron Star

### CA3-01 — physics conventions
Define mass/radius units, exterior metric assumption, surface observer model and rotation limitations.

### CA3-02 — CPU/reference surface rays
### CA3-03 — GPU surface intersection
### CA3-04 — gravitational redshift
### CA3-05 — surface emission/hot-spot map
### CA3-06 — deterministic rotation/time
### CA3-07 — pulse observer geometry
### CA3-08 — pulse plot/readout
### CA3-09 — dipole field-line visualization
### CA3-10 — pulsar beam visualization
### CA3-11 — magnetar preset
### CA3-12 — magnetar flare state machine
### CA3-13 — scientific validation corpus
### CA3-14 — visual goldens
### CA3-15 — quality tiers/benchmark
### CA3-16 — Atlas transition/disposal validation
### CA3-17 — CA3 checkpoint

## CA4 — Stellar Explosion

### CA4-01 — model/fidelity spec
### CA4-02 — progenitor star state
### CA4-03 — explosion timeline/state machine
### CA4-04 — analytic expanding shock shell
### CA4-05 — procedural volume density
### CA4-06 — ejecta particle initialization
### CA4-07 — GPU particle evolution
### CA4-08 — emissivity/temperature model
### CA4-09 — anisotropy/clumping controls
### CA4-10 — hypernova preset
### CA4-11 — bipolar long-GRB jet
### CA4-12 — viewing-angle behavior
### CA4-13 — half-res volume optimization
### CA4-14 — deterministic invariant tests
### CA4-15 — goldens/benchmark
### CA4-16 — transition/disposal validation
### CA4-17 — CA4 checkpoint

## CA5 — Compact Merger

### CA5-01 — event/fidelity conventions
### CA5-02 — nonlinear phase timeline
### CA5-03 — inspiral trajectory/reference
### CA5-04 — compact-star render integration
### CA5-05 — contact transition
### CA5-06 — merger ejecta initialization
### CA5-07 — anisotropic volume/particle ejecta
### CA5-08 — short-GRB jet
### CA5-09 — observer-angle response
### CA5-10 — kilonova emission evolution
### CA5-11 — remnant presets
### CA5-12 — scrub/reset determinism
### CA5-13 — phase-aware resource activation
### CA5-14 — validation corpus
### CA5-15 — benchmark/goldens
### CA5-16 — transition/disposal
### CA5-17 — CA5 checkpoint

## CA6 — Tidal Disruption

### CA6-01 — scientific scope/presets
### CA6-02 — encounter trajectory
### CA6-03 — stellar deformation model
### CA6-04 — disruption criterion/proxy
### CA6-05 — debris particle spawn
### CA6-06 — debris ribbon/stream
### CA6-07 — bound/unbound proxy
### CA6-08 — winding/self-intersection
### CA6-09 — shock emissivity volume
### CA6-10 — nascent disk transition
### CA6-11 — black-hole distance/phase LOD
### CA6-12 — timeline reset/scrub
### CA6-13 — validation/goldens
### CA6-14 — benchmark/disposal
### CA6-15 — CA6 checkpoint

## CA7 — Quasar / AGN

### CA7-01 — scale/unit architecture
### CA7-02 — scale-zone state machine
### CA7-03 — central BH adapter
### CA7-04 — outer disk transition
### CA7-05 — corona volume
### CA7-06 — dusty torus
### CA7-07 — inner jet
### CA7-08 — extended jet LOD
### CA7-09 — host galaxy
### CA7-10 — blazar observer preset
### CA7-11 — camera-scale transitions
### CA7-12 — double-render/cost guards
### CA7-13 — validation/goldens
### CA7-14 — benchmark
### CA7-15 — CA7 checkpoint

## CA8 — Black-Hole Merger

### CA8-01 — source survey/license decision
### CA8-02 — reference event selection
### CA8-03 — offline fetch tool
### CA8-04 — physical metadata extraction
### CA8-05 — trajectory representation decision
### CA8-06 — waveform extraction
### CA8-07 — resampling/error report
### CA8-08 — binary runtime schema
### CA8-09 — manifest/checksum
### CA8-10 — browser loader
### CA8-11 — inspiral playback
### CA8-12 — merger/ringdown state
### CA8-13 — waveform UI synchronization
### CA8-14 — remnant state
### CA8-15 — illustrative lensing implementation
### CA8-16 — fidelity disclosure UI
### CA8-17 — source-vs-runtime validation
### CA8-18 — benchmark/goldens
### CA8-19 — transition/disposal
### CA8-20 — CA8 checkpoint

## CA9 — Galaxy Collision

### CA9-01 — scientific dataset survey/license
### CA9-02 — dataset selection
### CA9-03 — offline fetch/normalization
### CA9-04 — reduction representation experiment
### CA9-05 — center/trajectory validation
### CA9-06 — keyframe/flow binary schema
### CA9-07 — runtime loader
### CA9-08 — GPU tracer buffers
### CA9-09 — interpolation compute pass
### CA9-10 — disk/bulge star populations
### CA9-11 — gas/dust population
### CA9-12 — tidal-tail rendering
### CA9-13 — starburst proxy
### CA9-14 — nonlinear time control
### CA9-15 — quality tracer subsampling
### CA9-16 — morphology validation/goldens
### CA9-17 — benchmark/memory
### CA9-18 — transition/disposal
### CA9-19 — CA9 checkpoint

## CA10 — Expansion/lab

### Stellar Merger

CA10-SM-01 scope/research
CA10-SM-02 contact/deformation
CA10-SM-03 merger/ejecta
CA10-SM-04 luminous-red-nova-like emission
CA10-SM-05 validation/fidelity

### Solar Activity

CA10-SA-01 scope/research
CA10-SA-02 procedural solar surface
CA10-SA-03 corona
CA10-SA-04 field lines
CA10-SA-05 flare event
CA10-SA-06 CME
CA10-SA-07 validation/non-MHD disclosure

### Lensing Lab

CA10-LL-01 thin-lens equations
CA10-LL-02 point-mass reference solver
CA10-LL-03 GPU mapping
CA10-LL-04 Einstein ring alignment
CA10-LL-05 arcs/multiple images
CA10-LL-06 educational overlays
CA10-LL-07 reference tests

## CA11 — Hardening

### CA11-01 — full navigation leak tour
### CA11-02 — device-loss recovery across destinations
### CA11-03 — cache/eviction tuning
### CA11-04 — shader variant audit
### CA11-05 — browser/fallback matrix
### CA11-06 — mobile/touch pass
### CA11-07 — reduced-motion/accessibility audit
### CA11-08 — long-run thermal tests
### CA11-09 — all-destination benchmark report
### CA11-10 — provenance/license audit
### CA11-11 — Critical/High defect closure
### CA11-12 — CA11 checkpoint

## CA12 — Release integration

### CA12-01 — production destination selector
### CA12-02 — About/Fidelity UI
### CA12-03 — source/reference links
### CA12-04 — deployment/cache configuration
### CA12-05 — unsupported-browser UX
### CA12-06 — release smoke tour
### CA12-07 — hidden/beta destination policy
### CA12-08 — final docs/state handoff
### CA12-09 — release checkpoint

## Packet discipline

A packet ends with:

- code/data/docs change;
- test/evidence;
- no unowned resource leaks;
- updated relevant state if architecture changed.

If a packet reveals a fundamental scientific uncertainty, stop implementation for that claim, document it, and downgrade fidelity or select a better-supported model rather than fabricating certainty.