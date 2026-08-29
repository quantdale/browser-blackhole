# Volumetric optimization decisions

## Projected bounds / scissor — deferred with explicit reason

The V2 volume path already performs an analytic ray/bounds test in the
fullscreen fragment graph and keeps proxy geometry frustum-disabled because
the destination updates bounds uniforms and may place the camera inside a
volume. A projected scissor rectangle would require a second CPU-side
projection contract for every box/sphere and a backend-specific scissor
binding. Three.js r185 does not expose a portable per-object scissor seam in
the shared `WebGPURenderer`/forced-WebGL2 path used here.

The campaign therefore keeps the portable analytic miss/early-termination
optimization and defers projected scissor until a pinned API spike can prove
that it preserves camera-inside-volume behavior on both backends. The V2
quality governor bounds active steps, internal resolution, detail octaves and
lighting taps; this decision is not permission for an unbounded full-frame
volume.

## Depth composition — accepted

`SharedPost` stages a previous-frame depth copy in two bounded FP16 targets.
`VolumeService` uses it as a conservative contribution gate and as a
depth-aware bilateral upsample input. Host camera changes invalidate that
staged depth because it is screen-space data; the next destination frame
repopulates it. `tests/browser/volumetric-depth-composition.spec.ts` proves a
foreground compact remnant remains visible over the structured ejecta shell on
WebGPU and forced WebGL2.
