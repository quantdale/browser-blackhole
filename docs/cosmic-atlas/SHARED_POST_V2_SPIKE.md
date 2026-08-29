# SharedPost V2 architecture spike

Status: **SPIKE ACCEPTED — HYBRID ARCHITECTURE SELECTED**

This note records the implementation decision for the restored Cinematic
Visual Fidelity Overhaul. It is deliberately separate from the old interim
certification. The exact installed dependency is Three.js `0.185.1` (r185).

## Pinned API findings

The source shipped in `node_modules/three` was inspected directly:

- `three/src/renderers/common/RenderPipeline.js` exports `RenderPipeline`.
  It owns a fullscreen `QuadMesh`, has an `outputNode`, `needsUpdate`,
  `outputColorTransform`, and a synchronous `render()` method. Its own source
  says it is for `WebGPURenderer`; the forced WebGL2 path still uses the
  `WebGPURenderer` class with `WebGLBackend`, so it must be exercised rather
  than assumed equivalent.
- `three/src/nodes/display/PassNode.js` provides `pass(scene, camera)`,
  `getTextureNode(name)`, `getPreviousTextureNode(name)`, `toggleTexture`,
  `setResolutionScale`, `setMRT`, and depth-node accessors. Pass targets are
  allocated by the node and are not a natural fit for the existing
  ResourceScope-owned destination target lifecycle without an adapter.
- `three/src/nodes/core/MRTNode.js` maps named outputs to target textures by
  texture name. `RenderTarget({ count: 2 })` is therefore required for a
  `radiance`/`emissive` pair, with names assigned before graph compilation.
- `three/examples/jsm/tsl/display/BloomNode.js` accepts any texture node, uses
  FP16 bright/blur targets, has `setResolutionScale`, and its documented
  selective path is a named MRT `emissive` attachment. Its source also warns
  that the default is whole-image threshold bloom.
- `WebGPUPipelineUtils` and the WebGL fallback state both warn that MRT
  per-attachment blending is not fully supported in compatibility mode; the
  material blend state may apply to all attachments. This matters for the
  existing transparent volume/particle/ribbon layers.
- `Renderer.readRenderTargetPixelsAsync` is available on the common renderer
  and returns the backend-appropriate typed array. FP16 readbacks are raw
  half-float words on both tested implementations.

## Executed spike

`SharedPost.runArchitectureSpikeForTest()` is exercised by
`tests/browser/shared-post-spike.spec.ts` for `backend=webgpu` and
`backend=webgl2`. It reports:

1. a scratch RenderPipeline copy of the current HDR target and a raw-pixel
   comparison against the source;
2. a two-attachment named MRT material (`output` and `emissive`) and raw
   readback from both attachments;
3. the backend/API and any warning/error result.

The test is a diagnostic/architecture probe, not a production frame path.

Observed on both tested backends:

- RenderPipeline: `pass`; source and scratch raw FP16 center words matched
  exactly as `[15066, 13629, 12578, 15360]`.
- Named MRT: `pass`; texture names were `output`/`emissive`, raw output was
  `[16384, 16384, 16384, 15360]` (2.0) and raw emissive was
  `[17408, 17408, 17408, 15360]` (4.0).
- MRT target type: `HalfFloatType` (`1016`); scratch accounting was
  `5,659,032` bytes for the 973×727 copy plus the two-attachment probe.
- The same results were produced by the WebGPU backend and the forced WebGL2
  backend. No non-MRT console/page error was recorded.

## Decision

The accepted production architecture is **hybrid custom fullscreen + explicit
selective auxiliary target**:

1. retain the existing SharedPost target and renderer lifecycle so destination
   rendering, transition snapshots, ResourceScope ownership, and the forced
   WebGL2 path remain stable;
2. split presentation into named stages (scene HDR → temporal resolve →
   selective highlight extraction/bloom → transition composite → display
   transform → optional grade);
3. render objects/materials explicitly marked as emissive into a separate
   FP16 auxiliary target before presentation, and feed that target to BloomNode
   instead of thresholding the whole image;
4. keep a measured legacy whole-image threshold fallback only for legacy direct
   ray passes that have no authored highlight mask; it is reported in the
   debug stage snapshot and is not the selective path;
5. keep MRT as an isolated capability/prototype path until its transparent
   blending behavior is proven for every required material. Scientific output
   and correctness do not depend on MRT.

This is not a rejection of MRT as a Three.js capability. It is a deliberate
compatibility choice: the auxiliary target gives selective highlights with
explicit ownership and predictable WebGL2 behavior, while retaining the
option to move stable opaque materials to MRT after evidence warrants it.

## Acceptance evidence

- RenderPipeline source/current-pixel result: PASS on both backends; exact raw
  center-word equality above.
- Named MRT WebGPU result: PASS.
- Named MRT forced-WebGL2 result: PASS.
- Transparent-volume/particle/ribbon compatibility: the MRT probe is kept
  diagnostic because r185’s compatibility backend warns that per-attachment
  blending is not fully supported. The production selective target uses a
  separate tagged-object pass and is covered by
  `tests/browser/shared-post-v2.spec.ts` on both backends.
- Scratch target/resource cost: bounded and disposed by the probe; the
  production target is ResourceScope-owned and reused across frames.
- Final production stage order and selective-source state: PASS in
  `tests/browser/shared-post-v2.spec.ts` on WebGPU/WebGL2; the temporal stage
  is an explicit `off` placeholder until VF3 is implemented.
