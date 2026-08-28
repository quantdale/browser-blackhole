# Spatial Atlas Continuous Navigation — Design Contract

## 1. Problem

The existing Cosmic Atlas is scientifically and architecturally mature but navigation is destination-menu driven. The new product must make the atlas itself spatial, explorable and continuous.

## 2. Design goals

1. Preserve current destination renderers.
2. Preserve one renderer and one heavy destination.
3. Add real/meaningful spatial context.
4. Support orders-of-magnitude navigation without f32 jitter.
5. Use semantic zoom.
6. Make discovery possible in black space.
7. Seamlessly hand off to local scientific renderers.
8. Preserve static-hosting and WebGL2 fallback.
9. Preserve scientific honesty.
10. Keep Explorer cheap.

## 3. Locked decisions

### D-01: Explorer is a lightweight destination

`/atlas/explore`.

### D-02: Spatial and local camera controllers are separate

No astronomical widening of existing `CameraRig`.

### D-03: ICRF is catalog-level inertial frame

Other frames require explicit adapters.

### D-04: authoritative coordinates use CPU binary64

GPU receives focus-relative normalized f32.

### D-05: high/low encoding is optional, evidence-triggered

### D-06: semantic scale bands

Solar / stellar / galactic / extragalactic / local handoff.

### D-07: screen-space LOD with hysteresis

### D-08: marker and physical size are separate

### D-09: real vs historical vs reference vs conceptual are separate reality classes

### D-10: TransitionDirector evolves, not replaced

Adds `hyperspace | crossfade | continuous-handoff`.

### D-11: no initial global renderer depth-mode change

### D-12: catalog data is offline-built and source-locked

### D-13: all existing direct destination routes remain supported

### D-14: root does not switch to Explorer until SA12 certification

## 4. State ownership

Global spatial state belongs to a namespaced `SpatialStateV1` and is normalized at one boundary.

No UI writes GPU uniforms.

## 5. Error behavior

Spatial failures fail back to Explorer or a truthful status view; no blank canvas and no fabricated position.

## 6. Compatibility

All baseline Explorer functionality must work without WebGPU compute.

## 7. Performance

Explorer uses one or a few batched/instanced passes, bounded DOM labels, global quality control, and on-demand rendering.

## 8. Scientific policy

A linked destination may be:

- exact/representative object;
- representative model;
- related concept.

The UI must say which.

## 9. Migration

Beta route first, default landing last.