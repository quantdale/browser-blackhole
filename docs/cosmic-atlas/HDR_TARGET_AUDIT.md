# HDR target audit

Audit checkpoint: `5f81f6e` plus `69e4e17` renderer work, Three.js `0.185.1`.
All targets below are linear `NoColorSpace` storage unless explicitly noted.

| Target / texture | Owner | Format | Classification | Rationale |
| --- | --- | --- | --- | --- |
| `SharedPost.HDR` | SharedPost scope | RGBA16F | HDR-required | Destination radiance, volume composites, particles, and emissive surfaces can exceed display white. |
| `SharedPost.Emissive` | SharedPost scope | RGBA16F | HDR-required | Selective bloom input must preserve authored highlight radiance above 1. |
| `SharedPost.Snapshot` | SharedPost scope | RGBA16F | HDR-required | Transition handoff captures the pre-display outgoing image. |
| `SharedPost.Temporal.Read/Write` | TemporalService / SharedPost scope | RGBA16F | HDR-required | History resolve must clamp/blend scene radiance before tone mapping. |
| `SharedPost.Depth.Read/Write` | SharedPost scope | RGBA16F depth copy | HDR-safe auxiliary | Previous-frame normalized depth is copied into color storage to avoid same-attachment sampling hazards. |
| `VolumeService` half-resolution target | VolumeService handle | RGBA16F by default; RGBA8 only with explicit `hdrIntermediate:false` | HDR-required by default | Emission/radiance is accumulated before SharedPost; the HDR probe proves 4.0 survives. |
| r185 MRT spike attachments | Test scratch | two RGBA16F attachments | HDR-required prototype | Named `output`/`emissive` readback validates the API; not a production allocation. |
| LUT trajectory/aux textures | LUT resource scope | shipped LUT formats | LDR/data-safe | Classification/auxiliary trajectory data, not emissive radiance. |

The audit distinguishes a render target's color format from a physical model's
units. Half-float storage prevents transport clamping; it does not make the
underlying procedural emission radiometric or claim a full transfer solver.

Evidence:

- `tests/browser/hdr-continuity.spec.ts` reads raw half-float samples and
  observes 1.0 versus 4.0 through the volume intermediate and SharedPost on
  WebGPU and forced WebGL2.
- `tests/browser/shared-post-spike.spec.ts` reads named MRT output/emissive
  attachments at 2.0 and 4.0 on both backends.
- `tests/browser/volumetrics-v2.spec.ts` reports the staged depth pair and
  `depthClipActive` after the first-frame handoff.

Estimated color-storage increase versus an RGBA8-only design is four bytes per
pixel per FP16 RGBA target. SharedPost's tracked byte estimates use 8 bytes per
pixel for FP16 color, plus 4 bytes per pixel for depth where attached. The
temporal pair and staged-depth pair are intentionally bounded and reused; they
are not allocated per frame.
