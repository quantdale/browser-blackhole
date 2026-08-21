# AGENTS.md — autonomous implementation contract

This repository is designed so a capable coding agent can resume work without chat history. This file is the operating contract.

## Required reading before editing

Read, in this order:

1. `.agent/STATE.md`
2. `docs/PRODUCT_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PHYSICS.md`
5. `docs/RENDERING_PIPELINE.md`
6. `docs/PERFORMANCE.md`
7. `docs/TESTING.md`
8. `docs/ROADMAP.md`
9. `docs/BACKLOG.md`
10. `docs/RESEARCH_REFERENCES.md`

If an implementation decision conflicts with these documents, stop and either update the decision documentation with a defensible reason or choose the documented design. Do not silently drift.

## Autonomous execution loop

For every work cycle:

1. Inspect repository status, current branch, recent commits, `.agent/STATE.md`, and relevant tests.
2. Select the highest-priority unblocked item from the current roadmap milestone.
3. Write or update a failing/diagnostic test when the work has a correctness criterion that can be automated.
4. Implement the smallest coherent vertical slice that advances the milestone.
5. Run the narrow tests first, then the milestone gate commands.
6. Inspect browser console and renderer/device-loss errors; a visually plausible frame is not sufficient proof.
7. Update docs when interfaces, conventions, or architecture change.
8. Update `.agent/STATE.md` with exact completed work, current blockers, evidence, and next action.
9. Commit a coherent checkpoint. Never hide unrelated changes in the same commit.

## Development principles

### Physics

- Use geometric/natural units internally where appropriate, with an explicit conversion layer for user-facing units.
- For Schwarzschild, use `r_g = GM/c^2`; horizon `r=2 r_g`, photon sphere `r=3 r_g`, Schwarzschild ISCO `r=6 r_g`.
- Backwards ray tracing from camera to emitter/background is the default rendering formulation.
- Treat the apparent shadow as a photon-capture/lensing effect, not a mesh radius.
- Keep redshift definitions explicit. If `g = nu_obs/nu_emit`, specific intensity transforms as `I_nu,obs = g^3 I_nu,emit`; bolometric intensity has a different power. Do not mix formulations.
- Validate GPU approximations against analytic cases and/or a higher-precision CPU reference.

### Rendering

- Primary image generation is a full-screen GPU pass (prefer a single full-screen triangle).
- Three.js manages renderer lifecycle, camera/control state, textures, post-processing, and browser integration.
- Do not create large mesh fields to imitate curved rays.
- TSL/WebGPU is the preferred primary path. Keep fallback behavior explicit and tested.
- Compute shaders are optional accelerators for algorithms that benefit from compute; they are not a requirement for primary per-pixel ray rendering.

### Performance

- Never optimize from intuition alone. Capture CPU frame time, GPU time where available, internal render dimensions, quality settings, iteration counts, and device/browser information.
- Prefer early ray termination, adaptive integration, dynamic resolution, temporal accumulation, LUTs, and workload classification before micro-optimizing syntax.
- Cap internal pixel density; never blindly trace at unrestricted `devicePixelRatio`.
- Performance changes must preserve physics/visual regression gates.

### UX

- Keep Physical, Observer, Disk, Relativity, Visual, and Rendering controls distinct.
- Provide safe presets and an Auto quality mode.
- The application must remain keyboard-accessible for controls and usable without devtools.
- Do not expose a control that has no defined physical or visual semantics.

## Parallel/sub-agent policy

Parallel work is encouraged only across genuinely independent boundaries. The orchestrating agent owns integration and final validation. See `docs/PARALLEL_WORK.md`.

Never allow two workers to rewrite the same central shader/module concurrently without an explicit ownership boundary. Physics formulas, coordinate conventions, shader interfaces, shared state schemas, and dependency changes are integration-sensitive and should have one owner at a time.

## Branch and Git safety

- Inspect current state before changing files.
- Do not force-push, rewrite shared history, delete branches, or discard unknown work.
- Keep commits focused and descriptive.
- Do not commit generated caches, browser profiles, benchmark dumps, or local secrets.
- If CI or browser tests fail, record the exact failure rather than declaring the milestone complete.

## Definition of done

A task is not done because it renders one attractive screenshot. It is done when its documented acceptance criteria pass, regressions are checked, and durable state is updated.
