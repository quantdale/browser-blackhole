# Durable project state

Last update: 2026-08-24 (CA7 QUASAR/AGN CAMPAIGN) — **CA7 IMPLEMENTED
END-TO-END.** Quasar/AGN is the sixth production Cosmic Atlas destination:
scale-zone architecture (INNER/NUCLEAR/GALACTIC dioramas with a hysteresis
zone machine), DIRECT inner-GR reuse of the validated lensing backend with
an exclusive-visibility cost guard, procedural corona/torus/jets/host at
documented AGN scales, blazar orientation model, presets, unit+browser
validation, 4 goldens, per-zone benchmarks. Full Playwright suite **120/120**;
vitest **420/420**; all cumulative gates green; existing destinations and
goldens unchanged.

## Current phase

**CA7 COMPLETE (all packets CA7-01..CA7-15).**
Next: CA8 Black-Hole Merger (data-driven; source survey/license first) or
M10 observer modes — see "Next actions".

## CA7 packet status

| Packet | Status | Evidence |
| --- | --- | --- |
| CA7-01 scale/unit architecture | DONE | `quasar-agn/types.ts`: ZONE_UNIT_RG {1, 1e3, 1e7} r_g table, agnScaleReadout (AU/pc/kpc conversions), r_g-native content constants; mass drives readouts only (normalized-mode philosophy); unit-tested |
| CA7-02 scale-zone state machine | DONE | resolveAgnZone(zoom01,current) hysteresis (enter/exit bands 0.06 wide), ZONE_JUMP_ZOOM discrete targets, totality sweep + flicker-band tests |
| CA7-03 central BH adapter | DONE | LensingService.createBlackHoleLensingPass reuse in the INNER group; grPassActive false outside INNER (unit+browser asserted) |
| CA7-04 outer disk transition | DONE | emissive annulus mesh (200–8000 r_g band, soft edges) in NUCLEAR; bridges to the inner disk without double rendering (exclusive zones) |
| CA7-05 corona volume | DONE | VolumeService sphere proxy (12 r_g) hot falloff, half-res; INNER-gated |
| CA7-06 dusty torus | DONE | VolumeService oblate equatorial skirt (2e4–1e5 r_g, height ratio 0.5), torusVisible toggle through the normalizer |
| CA7-07 inner jet | DONE | bipolar cone pairs (+core/+sheath) along ±Y with PER-LOBE live gain uniforms (continuous blazar ratio) |
| CA7-08 extended jet LOD | DONE | GALACTIC extended pair (6e8 r_g reach) + static seeded knot particles whose population scale IS jetTracerDensity |
| CA7-09 host galaxy | DONE | ParticleService bulge+disc star field (tier-budgeted counts), hostVisible toggle |
| CA7-10 blazar observer preset | DONE | blazar-view preset (~3 deg off-axis); jetLobeBrightnessRatio fixed-Gamma kappa=3 approximation, constant-sum display gains; browser asserts ratio>100 reported |
| CA7-11 camera-scale transitions | DONE | agnCameraDistance zoom law per zone; distance driven ONLY on zoom/zone input changes (user orbit preserved); preset-coherence contract pinned by tests |
| CA7-12 double-render/cost guards | DONE | exactly-one-visible-group guard surfaced as snapshot.doubleRenderGuard and asserted 'ok' in every browser row; GR pass culled outside INNER |
| CA7-13 validation/goldens | DONE | tests/unit/quasarAgnPhysics.test.ts (15) + tests/browser/quasar-agn.spec.ts (7) + goldens AGN_INNER_ENGINE / AGN_NUCLEAR / AGN_RADIO_GALAXY / AGN_BLAZAR_VIEW (twice-stable) |
| CA7-14 benchmark | DONE | scripts/bench-quasar-agn.mjs (`npm run bench:quasar-agn`) honesty gate on active zone; records under `benchmarks/results/2026-08-24-ca7/` |
| CA7-15 checkpoint | DONE | this state file + README alignment; head recorded below |

## Commit chain this campaign

```
329aef0 feat: quasar/AGN destination core (CA7-01..CA7-12)
fbb9e87 test: AGN browser validation + goldens + per-zone benchmark (CA7-13/14)
<pending final state closure commit>
```

## Validation evidence

| Gate | Result |
| --- | --- |
| npm run check components | prettier clean; eslint clean; tsc clean; build PASS |
| vitest | **420/420** across 26 files (405 pre-existing + 15 new AGN tests) |
| Playwright FULL suite | **120/120 PASS** (109 pre-existing incl. Kerr/Schwarzschild/goldens/torture + 7 new AGN specs + 4 new AGN goldens rows) |
| Visual goldens | **31/31 twice-stable**: 27 prior UNCHANGED + 4 new AGN rows |

Environment exercised: Windows 11 (10.0.26200), Node v22.23.2, Edge 151,
hardware WebGPU (amd rdna-2). Zone benchmarks all sit AT the vsync floor
(~7 ms median at low tier / 583×436 internal) with the DIRECT pass verifiably
culled outside INNER — the CA7 exit-gate intent ("far-scale views do not pay
full inner-GR cost") is met by construction and measured. frameGpuMs stays
null everywhere (no GPU timestamps; CPU-side rAF deltas honestly labeled).

## Known debt / limitations (updated)

1. (Carried M8 items unchanged.) 2. (Carried M9 items unchanged: Kerr perf
headroom, pole-passage failure class, axis tilt unsupported.)
3. CA7 large-scale morphology is PROCEDURAL_SCIENTIFIC by design (disclosed
   per-preset and in snapshots); no unified-model simulation is claimed.
4. Blazar beaming uses a FIXED disclosed Gamma=8/kappa=3 approximation;
   display gains are constant-sum normalized so raw ratios only redistribute
   lobe brightness.
5. Zone dioramas are separate scales by architecture (documented conversion
   layer); continuous geometric zoom ACROSS zone boundaries is a crossfade
   of dioramas, not one continuous space — matches PHENOMENA §7 design.
6. Failure-count telemetry into bench records still open (carried).

## Critical/High defects remaining

Zero known. (The two High candidates found during M9 were root-caused,
fixed, and pinned there.)

## Next actions

1. CA8 Black-Hole Merger per WORK_PACKETS (source survey/license decision
   FIRST — data pipeline docs are ready).
2. OR M10 observer modes (Kerr-Schild migration decision recorded).
3. Opportunistic: AGN control-panel UI wiring for the catalog's physical/
   visual controls beyond the canonical channel defaults (zoom/zone jump
   buttons) if product wants visible sliders before CA11 polish.
