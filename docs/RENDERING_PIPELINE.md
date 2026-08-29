# Rendering pipeline

## 1. Primary render path

Render a single full-screen triangle. For each fragment/pixel:

```text
pixel -> camera ray -> geodesic propagation
      -> captured | disk hit | escaped
      -> physical/emission shading
      -> HDR radiance
      -> destination representation layers (surface/volume/sprite/ribbon)
```

Then run temporal/post-processing stages and tone map for display.

A full-screen triangle avoids the diagonal interpolation seam/extra vertex work of a two-triangle quad and keeps the ray shader's invocation mapping simple.

## 2. Camera ray reconstruction

Pass a compact camera basis or inverse view/projection data to the shader. The shader reconstructs one direction per pixel from NDC coordinates and FOV/aspect. Keep camera position/orientation separate from observer four-velocity once relativistic observer motion is introduced.

Early tests should render a deterministic direction/color diagnostic before any GR integration. This catches coordinate, aspect, handedness, and vertical-flip mistakes cheaply.

## 3. Environment

Escaped rays sample a celestial environment using their final asymptotic direction. Start with a deterministic procedural star field or a properly licensed static environment. The background needs high-frequency structure because gravitational lensing is much easier to perceive when stars/features are present.

Never couple star generation to frame order; deterministic seeds are required for visual regression tests.

## 4. Accretion disk shading

Initial thin-disk shading pipeline:

1. detect equatorial-plane crossing between integration samples;
2. refine intersection position enough to avoid visibly unstable crossings;
3. reject if radius is outside disk bounds;
4. compute local orbital velocity/emitter four-velocity;
5. compute local temperature/emissivity;
6. compute redshift factor `g`;
7. transform spectral/radiance contribution;
8. return/accumulate according to the chosen thin-disk opacity model.

Higher-order disk images should emerge from ray geometry, not be duplicated manually.

## 5. HDR and display transform

Maintain scene radiance in HDR (prefer half-float render targets where supported/appropriate). Display chain:

`physical radiance -> temporal reconstruction -> bloom -> exposure/tone mapping -> output color space`

Bloom is post-processing. It must not alter physics calculations or be necessary for the lensing to exist.

For Cosmic Atlas destinations that are not already full-screen ray images, the
representation layer is shared and deterministic: seeded deep-space context,
structured emissive surfaces, optically thin halos, and bounded disc/jet
geometry consume resolved destination outputs. These layers provide spatial
readability; they do not replace authoritative ray tracing, datasets, or
procedural model equations. Cinematic grading/grain/vignette are an opt-in
display graph in `SharedPost` and are excluded from Scientific/Debug graphs.

Record the exact Three.js color-management/tone-mapping setup in code and visual tests so dependency upgrades do not silently shift golden images.

## 6. TSL/WebGPU strategy

Use Three.js TSL/node APIs for the primary WebGPU renderer so application integration stays inside supported `WebGPURenderer` patterns. Encapsulate complex math into named shader functions/modules rather than one monolithic node graph.

Before using a TSL/WebGPU-only feature, decide fallback behavior:

- same algorithm can compile/run on WebGL2;
- alternate WebGL2 implementation;
- disable feature while preserving core renderer;
- declare browser unsupported only if the base renderer truly cannot operate.

Compute/storage-texture acceleration must not silently become a baseline requirement.

## 7. Numerical Schwarzschild backend

Purpose: trusted production-quality correctness path and reference for later optimization.

Quality controls can include:

- integration step/tolerance;
- max steps;
- escape radius/tolerance;
- disk-intersection refinement;
- internal render scale.

Expose `MAX_STEPS`/numerical failure in debug mode. Do not hide it as black.

## 8. Optimized LUT backend

After numerical validation, implement/precompute mappings inspired by Bruneton's real-time non-rotating black-hole renderer. Prefer generating static tables at build/tool time and shipping validated assets rather than recomputing expensive tables every page load.

Requirements:

- LUT format/version metadata;
- checksum/shape validation;
- coordinate-domain documentation;
- comparison against numerical reference at representative rays and images;
- interpolation-error tests around the critical region;
- graceful fallback if LUT assets fail to load.

## 9. Kerr backend

Kerr should reuse application-level interfaces but may need a materially different shader/integrator. Avoid introducing dynamic branches through every Schwarzschild ray merely to share source code. Share math/utilities where natural; keep compiled hot paths specialized.

## 10. Debug render modes

Plan shader outputs for:

- termination classification;
- step count heatmap;
- minimum radius;
- disk-hit radius;
- frequency-shift factor;
- path/winding indicator;
- environment lookup direction;
- temporal-history weight;
- tile/quality classification later.

These modes are crucial engineering tools and should be deterministic.
