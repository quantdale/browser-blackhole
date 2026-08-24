# Research and implementation references

These are design inputs, not code to copy blindly. Before adapting external source, verify the exact repository/file license and preserve required notices/attribution.

## Primary black-hole rendering research

### Eric Bruneton — Real-time High-Quality Rendering of Non-Rotating Black Holes

- Paper: https://arxiv.org/abs/2010.08735
- Reference implementation: https://github.com/ebruneton/black_hole_shader

Why it matters: demonstrates a real-time Schwarzschild approach based on precomputed beam/ray mappings and lookup textures rather than performing a long numerical integration independently for every pixel every frame. This is the primary reference for milestone M8.

Do not begin by porting it verbatim. First build the numerical Schwarzschild reference/production path so LUT errors and coordinate mappings can be validated independently.

### Oseiskar — browser/GLSL black-hole renderer

- Project: https://github.com/oseiskar/black-hole
- Demo/readme lineage: https://oseiskar.github.io/black-hole/

Why it matters: useful prior art for numerical Schwarzschild geodesics in a browser/GLSL setting and for understanding practical shader formulations.

### dgreenheck — WebGPU Black Hole

- Repository: https://github.com/dgreenheck/webgpu-black-hole

Why it matters: modern Three.js/WebGPU/TSL prior art including raymarched Schwarzschild lensing, accretion disk rendering, procedural structure, and browser controls. Inspect architecture and performance ideas; do not assume its physics/quality tradeoffs are identical to this project.

## Three.js / WebGPU official references

- WebGPURenderer guide: https://threejs.org/manual/en/webgpurenderer.html
- TSL documentation: https://threejs.org/docs/TSL.html
- OrbitControls: https://threejs.org/docs/pages/OrbitControls.html
- WebGPU post-processing: https://threejs.org/manual/en/webgpu-postprocessing.html
- Three.js examples index: https://threejs.org/examples/

At M0, verify current APIs against the installed pinned Three.js release because WebGPU/TSL APIs evolve.

## Browser platform references

- MDN WebGPU API: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- GPUQuerySet/timestamp-query reference: https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet
- OffscreenCanvas context: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/getContext
- SharedArrayBuffer: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- Cross-Origin-Embedder-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy
- Current WebGPU compatibility overview: https://caniuse.com/webgpu

Compatibility changes over time; implementation agents must re-check current browser support rather than freezing planning-time percentages into product behavior.

## Astrophysical/visual references

- NASA black-hole anatomy: https://science.nasa.gov/universe/black-holes/anatomy/
- NASA black-hole accretion-disk visualization: https://svs.gsfc.nasa.gov/13326/
- NASA black-hole plunge visualization: https://svs.gsfc.nasa.gov/14585/

Use these for qualitative expectations around lensing, apparent disk warping, Doppler brightening, the distinction between horizon and shadow, and later observer-motion demonstrations.

## Kerr research direction

The M9 focused literature review is COMPLETE; its locked output lives in
`docs/KERR_BACKEND_ADR.md` (conventions, formulation tradeoff, validation
contract). Primary/standard sources verified during M9-01:

- **Bardeen, Press & Teukolsky 1972**, "Rotating Black Holes: Locally
  Nonrotating Frames, Energy Extraction, and Scalar Synchrotron Radiation",
  ApJ 178, 347 — circular equatorial geodesics (Omega eq. 2.16, existence
  boundary eq. 2.17), photon orbits (eq. 2.18), marginally bound orbit
  (eq. 2.19), ISCO Z1/Z2 form (eq. 2.20), prograde/retrograde sign
  convention. Implemented in `src/phenomena/black-hole/kerr/characteristics.ts`.
- **S. Chandrasekhar**, "The Mathematical Theory of Black Holes" (1983),
  Ch. III — Boyer-Lindquist metric/inverse metric, separated null geodesic
  potentials, Carter constant.
- **Misner, Thorne & Wheeler**, "Gravitation" (1973), §33 — BL coordinates,
  horizons, ergosurface, frame dragging.
- **Fujita, Sago & Nakano**, arXiv:1707.09309, Table 1 — independent numeric
  ISCO vectors (chi = 0.5/0.9/1.0 pro/retro) used as test fixtures.
- Static-observer tetrad orthogonalization in the t-phi plane (the naive
  `d/dphi/sqrt(g_phiphi)` leg is NOT orthogonal to the timelike leg when
  g_tphi != 0): derived and recorded in KERR_BACKEND_ADR §1.8 with the
  machine-null init test as the falsifier.

Do not lock a Kerr equation implementation solely from a blog or visualization repository.

## Reference-review checklist

For every external implementation considered for adaptation:

1. identify exact commit/version;
2. record license;
3. identify algorithms/formulas actually being reused;
4. map its units/coordinates/sign conventions to `docs/PHYSICS.md`;
5. reproduce a small result independently;
6. add tests before production integration;
7. preserve required notices.
