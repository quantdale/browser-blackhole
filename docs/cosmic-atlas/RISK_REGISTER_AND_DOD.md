# Risk register and Definition of Done

## 1. Purpose

Cosmic Atlas combines scientific rendering, large GPU workloads, async streaming, many scene lifecycles and public scientific claims. The project needs explicit risks and a strict completion definition.

## 2. Highest risks

### R1 — Feature sprawl

Risk: every astronomy term becomes a separate destination, creating duplicated code and unfinished demos.

Mitigation:

- taxonomy gate;
- ADR required for new top-level destination;
- prefer presets/variants;
- launch set capped at eight primary destinations.

### R2 — Scientific overclaim

Risk: procedural art presented as exact astrophysical simulation.

Mitigation:

- fidelity classes;
- About/Fidelity UI;
- source/approximation documentation;
- validation invariants;
- review scientific language.

### R3 — GPU memory leaks during travel

Risk: each teleport leaves textures/buffers/workers/listeners resident.

Mitigation:

- ResourceScope;
- navigation leak tour;
- one heavy destination active;
- debug resource inventory;
- bounded caches.

### R4 — Transition stutter

Risk: shader compilation, texture upload or binary decode occurs at visible swap moment.

Mitigation:

- `prepare()`;
- minimum-ready threshold;
- pipeline warm-up;
- occlusion swap;
- progressive allocation;
- transition benchmark.

### R5 — Mobile thermal collapse

Risk: scene launches at native DPR/high quality then throttles severely.

Mitigation:

- conservative benchmark-based initial tier;
- capped DPR;
- 30 FPS target option;
- dynamic resolution;
- hidden-tab suspension;
- Battery Saver quality.

### R6 — Shared-service abstraction damages Black Hole

Risk: extracting common renderer APIs weakens existing scientific contracts.

Mitigation:

- Black Hole adapter first;
- existing regression tests authoritative;
- shared services adapt around black-hole requirements;
- no physics rewrite merely for uniformity.

### R7 — Dataset licensing/provenance

Risk: public scientific dataset or visual asset used without compatible license/attribution.

Mitigation:

- source manifests;
- legal/provenance review before committing derived artifacts;
- reproducible fetch pipeline;
- do not assume public webpage means unrestricted data license.

### R8 — Giant runtime assets

Risk: galaxy/NR/volume data makes page unusable.

Mitigation:

- offline reduction;
- binary formats;
- LOD chunks;
- lazy load;
- no raw terabyte/gigabyte research output.

### R9 — Shader variant explosion

Risk: every destination/preset generates unique compile variants, causing startup/travel hitches.

Mitigation:

- stable runtime uniforms for continuous controls;
- limited compile-time feature flags;
- variant inventory/benchmark;
- warm essential variants only.

### R10 — Async route races

Risk: rapidly selected stale destination activates after newer target.

Mitigation:

- generation token;
- abort signals;
- stale prepared scope disposal;
- race E2E tests.

### R11 — Inconsistent units across scales

Risk: `r_g`, km, AU, pc, kpc and time scales drift across modules.

Mitigation:

- centralized unit utilities;
- destination model contracts;
- explicit coordinate frames/manifests;
- conversion tests.

### R12 — Data-driven interpolation misrepresented as simulation

Risk: interpolated galaxy/BBH keyframes described as live solved dynamics.

Mitigation:

- fidelity badge;
- source manifest;
- interpolation docs;
- UI wording: data-driven visualization.

## 3. Severity

- Critical — corrupt scientific core, security/privacy issue, app unusable, destructive state/data failure.
- High — major destination incorrect/unusable, severe leak/performance failure, false scientific claim.
- Medium — limited correctness/UX/performance defect with workaround.
- Low — cosmetic/nonblocking improvement.

No Critical/High issue is silently deferred into release.

## 4. Shared platform Definition of Done

A shared Atlas infrastructure packet is done only when:

- contract documented;
- implementation typed;
- deterministic unit/integration tests pass;
- failure path exists;
- disposal ownership clear;
- debug observability exists for significant resources;
- no existing black-hole regression;
- browser smoke passes where relevant.

## 5. Destination Definition of Done

A destination is **not done** until all applicable items pass.

### Scientific scope

- fidelity class declared;
- equations/data/model described;
- physical vs illustrative portions separated;
- units/coordinates documented;
- references recorded;
- known scientific uncertainty disclosed.

### Implementation

- lifecycle implemented;
- target can prepare/abort safely;
- deterministic state/preset;
- all GPU/CPU resources owned;
- Low/Medium/High quality modes;
- no unsupported hidden coupling to another destination.

### Validation

- physical/model invariants;
- independent/reference comparison where DIRECT/DATA_DRIVEN;
- visual goldens;
- timeline reset/scrub tests;
- non-finite/invalid-state tests.

### Atlas integration

- transition in/out;
- reduced-motion path;
- deep-link route;
- cancellation race;
- repeated dispose;
- device-loss behavior.

### Performance

- benchmark scene recorded;
- target device tier behavior documented;
- resource estimate;
- dynamic quality responds;
- no unexplained regression to host.

### Product

- controls have units/category/help text;
- Fidelity/About content;
- source attribution;
- responsive layout;
- keyboard/touch smoke as applicable.

## 6. What does not count as Done

None of these alone are sufficient:

- "It looks amazing."
- "The shader compiles."
- "It gets 60 FPS" without resolution/settings/hardware.
- "NASA has a similar picture."
- "The particles move like a merger."
- "The app does not crash after one transition."
- "WebGPU works on my GPU."
- "The dataset is public."
- "The visual regression was updated."

## 7. Release Definition of Done

Cosmic Atlas launch is done only when:

- all exposed launch destinations pass destination DoD or are explicitly beta;
- full navigation leak/soak passes;
- reduced-motion/accessibility audit passes;
- browser/fallback behavior documented;
- data/asset provenance audit complete;
- no Critical/High defect open;
- production benchmark report exists;
- unsupported hardware receives useful UX;
- static deployment/caching works for large assets;
- fresh-agent durable handoff reflects exact current state.