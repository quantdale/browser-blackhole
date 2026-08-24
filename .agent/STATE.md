# Durable project state

Last update: 2026-08-24 (CA6 CAMPAIGN) — **CA6 TIDAL DISRUPTION IMPLEMENTED
END-TO-END.** Tidal Disruption is the fifth production Cosmic Atlas
destination: registered, deep-linkable at `/atlas/tidal-disruption`, five
production presets, deterministic nonlinear timeline, canonical controls,
generalized destination-control persistence (also fixes the CA5 share-state
debt), 48-test unit/reference corpus, 19-spec browser suite, six visual
goldens (twice-stable), and a phase/tier-aware benchmark. Full Playwright
suite 96/96. All cumulative gates green.

## Current phase

**CA6 COMPLETE. Next: M9 Kerr (dedicated campaign) or CA7 Quasar/AGN per
`docs/cosmic-atlas/ROADMAP.md` — do not start casually; M9 requires its own
research/ADR gate first.**

Commit chain this campaign (after the CA5 closure commit 70eaddf):
```
221d441 feat: add tidal disruption encounter and disruption physics (CA6-01..08 core)
0c9fa36 test: add tidal disruption browser validation and arrival framing (CA6-13)
9dc18de feat: add tidal debris stream shock ring and visual goldens (CA6-06..10, CA6-13)
0a38a7e feat: generalize destination control persistence and add tde benchmark (CA6-14)
<pending> docs/state: close ca6 with cumulative validation evidence
```

## CA6 packet status

| Packet | Status | Evidence |
| --- | --- | --- |
| CA6-01 scope/presets | DONE | `src/phenomena/tidal-disruption/types.ts` (fidelity disclosure; 1 unit = 1 R_sun; BH mass capped ~2x below the Hills regime; stellar/penetration scenario enums; 5 presets in `presets.ts`) |
| CA6-02 encounter | DONE | `trajectory.ts`: closed-form parabolic Kepler via Barker + Cardano inverse; frame convention documented; invariants tested (round trip, periapsis speed sqrt(2mu/q), monotone radius, finite over extreme sweeps) |
| CA6-03 deformation | DONE | `deformation.ts`: xi=(rt/r)^3, bounded stretch (cap 2.6), EXACT volume preservation, axis = star->BH; ordering/bounds/NaN tests |
| CA6-04 disruption | DONE | `disruption.ts`: beta bands (full >=1, partial >=0.75, fly-by) + explicit direct-capture verdict (never silent); reason strings; parameter-ordering tests |
| CA6-05 debris spawn | DONE | `debris.ts`: deterministic spherical-Fibonacci plan (no RNG for positions), seeded lattice rotation, velocities derived from energy offsets; bounded tier populations; accents via ParticleService |
| CA6-06 stream | DONE | `stream.ts` + RibbonService: Kepler-family spines (bisect+Newton elliptic, Newton hyperbolic), clustered energy sampling, disclosed crops (f>=1/30, r<=12 rp); continuity/speed-bound tests |
| CA6-07 bound/unbound | DONE | energy-sign classification; deterministic fractions (1024-element reference plan) in debug snapshot; ~0.5/0.5 near-parabolic symmetry tested |
| CA6-08 winding/intersection | DONE | differential Kepler winding (no GR precession — disclosed); deterministic shock trigger = first periapsis return of most-bound element (= fallbackSeconds) |
| CA6-09 shock volume | DONE | VolumeService equatorial TORUS at Rc=2rp (WGSL smoothstep edge contract documented in-graph); phase-gated; gain separated from geometry; half-res path |
| CA6-10 nascent disk | DONE | procedural annulus, radial falloff, gain ramp after several fallback times; streams/accents retired; disclosed as NOT a disk simulation |
| CA6-11 LOD | DONE | phase-gated resources (approach/deformation pay zero debris cost; volume only in shock; accents retire at disk); angular-size accent gate; debug exposes volumeVisible/populationScale/accentAngularGate; single global governor (no local controller) |
| CA6-12 timeline | DONE | `timeline.ts`: 7 phases anchored on Barker timing + model fallback; exact forward/inverse round trips tested; scrub/reset determinism verified in browser (rewind/play identical state) |
| CA6-13 validation/goldens | DONE | `tests/unit/tidalDisruptionPhysics.test.ts` (48 tests) + `tests/browser/tidal-disruption.spec.ts` (19 specs incl. 25-switch torture BH->TDE->CM->SN->NS x5); 6 TDE goldens twice-stable |
| CA6-14 benchmark/disposal | DONE | `scripts/bench-tidal-disruption.mjs` (+`bench:tidal-disruption`); per-phase + low/high/ultra/1080p records in `benchmarks/results/2026-08-24-ca6/`; all resources tracked in the prepare scope (geometry/materials/RT/storage buffers), disposal exercised by the torture suite |
| CA6-15 checkpoint | DONE | this state file + README/GOLDEN_IMAGES/PHENOMENA/STATE_AND_ROUTES/RESEARCH_REFERENCES updates |

## Cross-cutting: destination control persistence (generalized, CA5 debt closed)

- host keeps a per-destination, preset-scoped state cache written through
  from `serializeShareState`/`setDestinationControl` and merged back over
  the registry preset at `resolveTarget` — revisits and back/forward
  restore supported controls; preset switches reset to preset defaults.
- share links gain `dc=` (JSON of the active destination's normalized
  state) — `serializeForUrl`/`parseFromUrl` codec unit-tested; the app
  applies dc at boot through the canonical `setDestinationControl` channel
  with application verified against serialized state (bounded polling).
- Module normalizers remain the ONLY validation authority; no UI-to-uniform
  bypass. Works for Compact Merger AND Tidal Disruption (browser-tested).

## CA6 scientific fidelity (disclosed)

- encounter trajectory: DIRECT reduced Newtonian model (parabolic Kepler,
  Barker closed form). NOT a relativistic geodesic; no pericenter
  precession; supported presets keep rp >= ~40 rg.
- deformation/disruption/debris/streams: PROCEDURAL_SCIENTIFIC reduced
  proxies with disclosed constants (tidal-tensor energy spread with
  coefficient 1, partial-stripping fraction 0.35, deformation gain/cap).
- fallback/shock trigger derived from the model's own bound-orbit family
  (canonical ~116 d first fallback for the solar/1e6 MSUN preset —
  physically plausible, not fitted).
- display exaggeration: stellar disc radius = max(R*, min(0.12 rt, 20
  units)) — pure presentation, stated in presets and module disclosure.
- NOT claimed: SPH, GRMHD, numerical relativity, radiative transfer,
  stream self-gravity, predictive disk evolution. Sources recorded in
  `docs/cosmic-atlas/RESEARCH_REFERENCES.md` (TDE section).

## Validation evidence (this campaign, final state)

| Gate | Result |
| --- | --- |
| npm run check | PASS — prettier/eslint/tsc clean, vitest **351/351**, build OK |
| Playwright FULL suite | **96/96 PASS** (19 TDE specs + 2 new CM/TDE persistence specs included) |
| Goldens | 24/24, established then verified twice-stable; 18 pre-existing goldens unchanged except ATLAS_HYPERSPACE_BH_NS (documented transition-timing jitter re-baseline, GOLDEN_IMAGES.md) |
| TDE benchmark | per-phase + low/high/ultra/1080p records committed under `benchmarks/results/2026-08-24-ca6/` |

Environment: Windows 11, Node v22.23.2, Edge 151 (msedge), hardware WebGPU
(amd rdna-2). All frame numbers are rAF CPU-side deltas.

## Benchmark findings (CA6-14)

All TDE phases measure ~7 ms median / ~7.1 ms p95 — the 144 Hz vsync
interval — at medium tier (778x581 internal) AND at low/high/ultra tiers
and 1600x1007 internal. The destination renders comfortably inside one
frame everywhere on this hardware, so per-phase cost differences sit below
the vsync floor (same honest conclusion as CA5). The PHASE-AWARE evidence
lives in each record's `phaseResources`: volume visible ONLY at shock,
disk ONLY at nascent-disk, populationScale 0 at deformation, accents
retired at nascent-disk. GPU timestamping remains unavailable/unclaimed.

## Known debt / limitations (updated)

1. (Carried) M8 items: gFactorRelativeErrorMax placeholder; captured-class
   LUT columns routed to the numerical oracle; no disk Doppler asymmetry
   (golden-pinned baseline); eager LUT loading.
2. CA6: stream ribbons render only the near-BH portion (r <= 12 rp) — the
   distant stream is cropped by construction (disclosed); at late phases
   most of the family is legitimately beyond the crop, so streams fade
   from view before the shock stage.
3. CA6: per-phase/tier frame cost is vsync-bound on this hardware; a
   slower machine or higher resolution would be needed for meaningful
   per-phase differentiation.
4. CA6: the nascent disk is a procedural presentation (no viscous
   evolution); inner radius is presentational (>= 2 ISCO).
5. CA5 stretch items NOT done in this campaign (capacity went to CA6
   completion): jet readability polish, low/high/ultra CM benchmarks
   (TDE's harness now demonstrates the pattern), low-tier kilonova shell
   sampling.

## Next actions

1. M9 Kerr: dedicated campaign (research/ADR gate first — do not start
   casually). See `docs/KERR_RESEARCH_PLAN.md`.
2. CA7 Quasar/AGN per ROADMAP (scale-zone architecture).
3. Opportunistic CA5 polish (jet readability; CM tier benchmarks using the
   TDE harness pattern; low-tier kilonova shell sampling).
