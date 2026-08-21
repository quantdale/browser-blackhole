# Product specification

## 1. Product statement

Build a browser-based interactive black-hole visualizer that lets a user orbit and move the observer, manipulate physically meaningful black-hole/accretion-disk parameters, inspect relativistic effects, and trade rendering quality for performance in real time.

The intended result is not a particle-screen toy. It should be useful as:

- an interactive graphics experience;
- an educational visualization of gravitational lensing and relativistic disk appearance;
- a GPU/WebGPU technical showcase;
- a platform that can later support Kerr spacetime and observer trajectories.

## 2. Core user experience

On load, the user sees a black hole against a star field with a luminous accretion disk. Dragging or touch-orbiting changes viewpoint continuously; wheel/pinch changes observer distance where the selected observer mode allows it. Controls update the image live.

The default preset should communicate, without labels being required to understand the image:

- a central black-hole shadow;
- strong background gravitational lensing;
- an accretion disk whose far side/underside is visibly lensed;
- a photon-ring/critical-curve region at sufficient quality;
- brightness/color asymmetry for an inclined rotating disk;
- stable motion and a responsive camera.

## 3. Control groups

### Black hole

- spacetime: Schwarzschild, later Kerr;
- mass `M` in selectable physical units;
- dimensionless spin `a*` only when Kerr exists;
- spin-axis orientation later.

Mass must not become an arbitrary "distortion strength" knob. In normalized mode, geometry expressed in `r_g` remains scale invariant. In physical-distance mode, fixed physical camera/disk distances make changing mass visibly alter angular scale.

### Observer

- coordinate/display mode: normalized vs physical;
- distance;
- inclination/orientation;
- field of view;
- Free/Orbit camera initially;
- later Static, Circular Orbit, Flyby, Free Fall, and Plunge observer modes;
- simulation time scale/pause where meaningful.

### Accretion disk

- enabled;
- inner/outer radius;
- temperature/accretion model preset;
- emissivity/intensity control;
- thickness only when a volumetric model exists;
- turbulence amount/scale;
- animation speed for visual evolution;
- scientific preset that anchors inner radius to the appropriate ISCO when applicable.

### Relativity

Toggles primarily exist for education/debug comparison, not because they are physically independent in the full model:

- gravitational lensing;
- gravitational redshift;
- Doppler shift;
- relativistic beaming;
- higher-order disk images when supported;
- later aberration from observer motion.

### Visual

- exposure;
- bloom;
- star/background brightness;
- optional cinematic color treatment.

### Rendering

- Auto/Low/Medium/High/Ultra;
- internal render scale;
- integration quality/tolerance or step budget;
- temporal accumulation/TAA;
- debug visualizations;
- compact performance telemetry.

## 4. Modes

### Scientific

Prioritize documented physics conventions, physically motivated disk parameters, restrained post-processing, units, and inspectable values.

### Cinematic

May increase bloom, background contrast, disk visibility, and stylization, but must not silently claim those settings are physical.

### Debug

Expose renderer/physics diagnostics such as capture/escape classification, step count, disk-hit count, redshift factor, impact parameter, winding/higher-order image indicators, render scale, and GPU timing.

## 5. Quality adaptation

Default rendering mode is Auto. The application should choose a conservative starting tier based on API capabilities and a short workload benchmark rather than device-name heuristics. During camera movement, quality may drop to protect interaction latency. When stable, it may raise resolution/samples and temporally converge.

## 6. Accessibility and usability

- Every slider/select has a visible label, value, and unit where applicable.
- Keyboard users can operate controls.
- Pointer/touch controls do not require precision clicking.
- Reduced-motion preference should disable nonessential UI animation; simulation animation remains user-controllable.
- Error states explain missing WebGPU/fallback support.
- An Info/Physics panel should explain what is physical versus artistic.

## 7. Out of scope for the initial product

- full magnetohydrodynamic accretion simulation;
- N-body gravity;
- production astrophysical radiative-transfer accuracy across arbitrary plasmas;
- gravitational-wave simulation;
- server-side rendering farm;
- VR/AR;
- multiplayer;
- arbitrary metric editor.

These can be researched later but must not block the core interactive renderer.
