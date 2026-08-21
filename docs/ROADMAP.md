# Implementation roadmap

Milestones are sequential at the integration level even when individual work packets can run in parallel. Every milestone must leave a runnable checkpoint.

## M0 — Repository and rendering foundation

### Deliver

- Vite + TypeScript application;
- exact pinned dependencies + lockfile;
- Three.js `WebGPURenderer` initialization and explicit capability/fallback handling;
- full-screen triangle TSL diagnostic shader;
- PerspectiveCamera + OrbitControls;
- resize/internal-resolution plumbing;
- deterministic app state/preset skeleton;
- basic control panel shell;
- Vitest + Playwright baseline;
- format/lint/typecheck/test/build scripts;
- CI for non-GPU gates and browser smoke where viable.

### Exit gate

Fresh checkout installs, checks, builds, opens, renders the expected diagnostic frame, supports camera interaction, and has no uncaught console error.

## M1 — Camera rays and deterministic celestial background

### Deliver

- correct per-pixel camera-ray reconstruction;
- deterministic procedural star/environment implementation;
- backend/debug overlay;
- first visual golden tests.

### Exit gate

Ray direction tests and fixed-camera visual baseline pass across resize/aspect cases.

## M2 — Reference physics and Schwarzschild geodesic core

### Deliver

- canonical units/constants;
- CPU reference solver and fixtures;
- numerical GPU Schwarzschild ray integration;
- captured/escaped/max-step classification;
- debug heatmaps;
- lensing of star field.

### Exit gate

Representative GPU rays agree with reference within documented tolerance; critical/weak-field/symmetry tests pass; no numerical failures are hidden as black-hole pixels.

## M3 — Thin accretion disk geometry

### Deliver

- curved-ray equatorial disk crossing;
- configurable inner/outer radii;
- deterministic disk emissivity texture/noise seed;
- higher-order disk images produced naturally by lensing;
- disk-hit diagnostics.

### Exit gate

Disk intersection converges under tighter numerical tolerance; face-on/edge-on visual references pass.

## M4 — Relativistic disk emission

### Deliver

- orbital emitter velocity model;
- gravitational + kinematic frequency shift;
- physically motivated emissivity/temperature profile;
- blackbody/RGB approximation with documentation;
- approaching/receding Doppler contrast;
- normalized vs physical mass/distance modes.

### Exit gate

Frequency-shift reference tests and face-on/inclined symmetry-ordering tests pass. Mass behavior is scientifically consistent.

## M5 — HDR visual pipeline and product UI

### Deliver

- HDR intermediate output;
- exposure/tone mapping;
- bloom;
- Scientific/Cinematic/Debug modes;
- full structured control panel;
- production presets;
- responsive desktop/mobile layout and accessibility pass.

### Exit gate

Scientific output is independent of cinematic post-process toggles; deterministic visual suite passes within documented thresholds.

## M6 — Measured real-time optimization

### Deliver

- CPU/GPU telemetry;
- early-termination tuning;
- adaptive integration;
- internal DPR cap;
- dynamic resolution/Auto quality with hysteresis;
- movement/stationary quality strategy;
- benchmark harness/results format.

### Exit gate

Before/after benchmark evidence exists. Auto mode responds to frame budget without oscillation or physics regression.

## M7 — Temporal refinement

### Deliver

- temporal jitter/accumulation;
- robust history invalidation;
- optional reprojection if motion data is correct;
- ghosting rejection/variance clamp as needed;
- stationary progressive refinement.

### Exit gate

Stationary output converges measurably while camera/state changes do not leave unacceptable ghost trails or stale physics.

## M8 — Optimized Schwarzschild LUT backend

### Deliver

- reviewed interpretation of Bruneton/paper method;
- offline/versioned LUT generator or adapted equivalent with license provenance;
- validated LUT assets;
- optimized renderer backend;
- numerical-vs-LUT ray/image comparison tooling.

### Exit gate

LUT renderer meets documented error limits on representative rays/images and shows a meaningful measured performance win.

## M9 — Kerr spacetime

### Deliver

- documented Kerr coordinate/convention choice, preferably Kerr-Schild research path;
- dimensionless spin control;
- numerical Kerr geodesic renderer;
- frame-dragging/spin-dependent disk behavior;
- spin-dependent ISCO;
- Kerr presets/debug views.

### Exit gate

`spin -> 0` converges to Schwarzschild within tolerance; prograde/retrograde reference cases behave correctly; numerical failure rate is bounded and visible.

## M10 — Relativistic observer modes

### Deliver

- static observer model;
- circular orbit;
- flyby;
- free fall/plunge;
- observer four-velocity effects and aberration;
- pause/time controls where appropriate.

### Exit gate

Observer motion affects apparent scene through documented relativistic transformations rather than camera animation alone.

## M11 — Production hardening and release

### Deliver

- cross-browser compatibility/fallback matrix;
- mobile/touch hardening;
- robust error/device-loss UX;
- asset/provenance/license audit;
- documentation/About/physics explanations;
- benchmark report across representative hardware;
- optimized production bundle/deployment configuration.

### Exit gate

All cumulative quality gates in `.agent/QUALITY_GATES.md` pass or have explicitly documented, user-visible limitations.

## Milestone discipline

Do not skip M2 correctness to chase M5 visuals. Do not begin M9 Kerr because it is exciting while Schwarzschild still has numerical/fallback problems. A milestone may research later work in parallel, but integration order remains authoritative.
