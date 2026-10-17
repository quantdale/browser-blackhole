# Proposal — Spatial Atlas Continuous Navigation

> **implementation status: NOT STARTED**
> OpenSpec planning-complete is not implementation-complete. The schema's
> status flag only asserts that the planning artifacts exist; a checkbox
> count of 0 completed tasks means the implementation checklist has never
> been touched. This change has 123 unchecked tasks and no implementation
> code under `src/`; no task, row or section below is representative of
> shipped behavior. Progress is tracked by `openspec list`, never by the
> planning flag.

## Why

The existing Cosmic Atlas has strong individual experiences but navigation still presents them as discrete destinations. A spatial explorer would make the product coherent: users discover an object in context, approach it, and enter the specialized renderer.

## What changes

- add `/atlas/explore`;
- add spatial catalog/reference-frame layer;
- add a spatial camera;
- add markers, labels, search and picking;
- add scale bands and screen-space LOD;
- add target prewarm and continuous handoff;
- add bidirectional local↔atlas travel;
- source-lock real object/event positions;
- retain conceptual hubs for simulations that do not have valid real coordinates;
- later promote Explorer to default landing.

## What does not change

- black-hole equations;
- Kerr implementation;
- neutron-star surface rays;
- scientific data semantics;
- one renderer ownership;
- one heavy destination;
- global quality authority;
- existing direct routes;
- static hosting;
- WebGL2 fallback policy.

## Risks

- large-world precision;
- UX motion sickness;
- target handoff popping;
- label clutter;
- false scientific spatial claims;
- performance regression;
- active performance campaign API drift.

## Mitigations

The master plan specifies explicit precision, reality-class, scale-band, handoff, accessibility, performance and rollout gates.