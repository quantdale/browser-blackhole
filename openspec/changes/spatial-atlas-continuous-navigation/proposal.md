# Proposal — Spatial Atlas Continuous Navigation

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