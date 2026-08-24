# CA7 Quasar/AGN benchmark characterization — 2026-08-24

Environment: Windows 11, Node v22.23.2, Microsoft Edge 151, **hardware
WebGPU** (`amd rdna-2`). Every record's `zone.active` matches the requested
zone and `doubleRenderGuard` is 'ok' — the harness aborts otherwise
(scripts/bench-quasar-agn.mjs honesty gate). All numbers are CPU-side rAF
frame deltas; `frameGpuMs` is null in every record (no GPU timestamps).

## Records (low tier unless noted; internal 583×436 via render-scale 0.6)

| File | Zone | GR pass active | median ms | p95 ms |
| --- | --- | --- | --- | --- |
| `inner-low.json` | inner | YES | 7.0 | 7.0 |
| `inner-medium.json` | inner (medium tier) | YES | 7.0 | 7.1 |
| `nuclear-low.json` | nuclear | no (culled) | 7.0 | 7.1 |
| `galactic-low.json` | galactic | no (culled) | 7.0 | 13.8 |

## Honest findings

1. **Every zone sits at the vsync floor** (~7 ms ≈ 144 Hz) on this hardware:
   the scale-zone architecture meets its exit-gate intent — far-scale views
   do NOT pay full inner-GR cost because the DIRECT pass is culled outside
   the INNER zone (grPassActive false in those records), and close-range
   views pay validated-Schwarzschild-class cost only.
2. Galactic has a slightly fatter tail (p95 13.8) from host-particle/jet
   draw at the wider frustum — still within one vsync of the floor.
3. Slower machines / higher tiers remain governed by the global quality
   controller as with every destination; per-zone differentiation below the
   vsync floor is not measurable here (same honest limitation as CA5/CA6).

Reproduce with `npm run bench:quasar-agn -- --zone=<inner|nuclear|galactic>`.
