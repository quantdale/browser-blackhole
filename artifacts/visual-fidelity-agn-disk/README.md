# AGN nuclear outer-disk photosphere review set

Not goldens. Do not copy these over `tests/browser/goldens`.

Matched before/after capture for the outer-disk photosphere POC
(`docs/VISUAL_FIDELITY_AGN_DISK.md`). Same script
(`scripts/capture-agn-disk-views.mjs`), same poses, viewport 1280×800,
High tier (forced), timeline phase 0.35 (paused), destination-default
exposure and post settings. `manifest.json` per directory records commit,
backend/adapter and the view list.

- `before/` — baseline `54d071f` (flat additive `RingGeometry` annulus).
- `after/` — `8c94027` + engine-halo glow fix (finite-thickness shell).

Views: `01` default NUCLEAR framing, `02` inclined 60°, `03` near-edge-on
87°, `03b` edge-on close-up 88° at distance 25 (thickness evidence),
`04` surface close-up 75° at distance 25, `05`/`06` scientific mode
(bloom disabled by the scientific grade).

The after-captures were produced on Brave (WebGPU routes to
`nvidia lovelace` on this host; Edge currently routes to the Intel iGPU).
Before/after were captured with identical tooling; see the doc's
environment note.
