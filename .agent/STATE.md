# Durable project state

Last update: 2026-08-25 (CA8 BLACK-HOLE MERGER CAMPAIGN) — **CA8 IMPLEMENTED
END-TO-END.** Black-Hole Merger is the seventh production Cosmic Atlas
destination and the first DATA_DRIVEN one: pinned SXS numerical-relativity
source (SXS:BBH:0001 Lev5, Zenodo record 13166927, CC-BY-4.0) reduced by a
reproducible offline pipeline into a versioned ~74 KB BBM1 runtime asset;
deterministic inspiral→merger→ringdown→remnant playback anchored on
data-derived amplitude thresholds; synchronized h22 waveform panel; remnant
rendered with the validated Kerr backend on source-derived mass/spin.
Production destination-selector debt FIXED (registry×launch-catalog chips;
Quasar/AGN now reachable). Full Playwright suite 131/131; vitest 454/454;
goldens 36/36 twice-stable (31 prior UNCHANGED + 5 new BHM rows); all
cumulative gates green.

## Current phase

**CA8 COMPLETE (all packets CA8-01..CA8-20).**
Next: M10 observer modes or CA9 Galaxy Collision — see "Next actions".

## CA8 packet status

| Packet | Status | Evidence |
| --- | --- | --- |
| CA8-01 source survey/license | DONE | `docs/cosmic-atlas/DATA_SOURCES_BBH_MERGER.md` §1; CA-ADR-021. Zenodo record API returns explicit `cc-by-4.0`; per-file MD5 published. v3.0 CaltechDATA records rejected for missing explicit license field. |
| CA8-02 reference event | DONE | SXS:BBH:0001 Lev5: q=1 non-spinning, 28.1 orbits, remnant 0.95160 M / chi=0.68646. Rationale §2 (q=10 and precessing runs deliberately avoided). |
| CA8-03 fetch tool | DONE | `tools/cosmic-data/fetch_sxs_record.py` — pinned-record fetcher, MD5 verification, idempotent scratch cache, no secrets. |
| CA8-04 metadata extraction | DONE | Mass fractions/spins from reference metadata; remnant mass/spin from late-time common-horizon series; all header scalars unit-explicit. |
| CA8-05 trajectory ADR | DONE | DATA_SOURCES_BBH_MERGER.md §4: horizon coordinate centers consumed as gauge-dependent paths, recentered on fitted midpoint; UI labels them "NR coordinate trajectories". |
| CA8-06 waveform extraction | DONE | h22 Re/Im from N=4 extrapolated asymptotic CoM strain; r·h/M dimensionless; t=0 at amplitude peak; memory preserved as published. |
| CA8-07 resampling + error report | DONE | Two-segment scheme (phase-uniform inspiral 70%, time-uniform ringdown 30%), 2048 samples; errors in `public/data/black-hole-merger/reduction-report.json` (traj max 1.4e-3 normalized, h22 max 3.9e-3, peak shift 0 samples); thresholds ASSERTED in tests/unit/bbmSourceParity.test.ts. |
| CA8-08 binary schema | DONE | BBM1 v1: little-endian, 160-byte documented header (13 f64 scalars incl. mergerEndM/ringdownEndM anchors), interleaved f32 rows. Decoder `src/phenomena/black-hole-merger/dataset.ts`. |
| CA8-09 manifest/checksum | DONE | manifest.json carries provenance/license/attribution/channels/samples/bytes/sha256; decoder fails closed on magic/version/length/checksum/finite/monotonic/range violations (17 integrity tests). |
| CA8-10 browser loader | DONE | loader.ts: lazy fetch with AbortSignal at every await, manifest structural validation, checksum enforcement, bounded 2-entry decoded cache. No streaming (74 KB asset; measured trivial). |
| CA8-11 inspiral playback | DONE | Allocation-free binary-search sampler; TimeController PhaseMapping with exact anchor round-trips; scrub/reset/replay determinism unit+browser tested. |
| CA8-12 merger/ringdown state | DONE | INSPIRAL→MERGER→RINGDOWN→REMNANT on data-derived boundaries (mergerEndM=21.5M, ringdownEndM=39.9M at 0.35/0.08 peak fractions); browser test pins the ordered phase sequence. |
| CA8-13 waveform UI sync | DONE | Pure-DOM canvas panel (`src/ui/atlas/waveformPanel.ts`) bound via validated dataset cache; cursor pushed at 4 Hz; NUMERIC synchronization asserted in browser test (readout vs time.snapshot()). |
| CA8-14 remnant state | DONE | Exclusive swap to `createKerrLensingPass` with spin=0.68648/mass=0.95160 from the dataset; illustrative glow proxy disclosed; Kerr physics untouched. |
| CA8-15 illustrative lensing | DONE | Toggleable photon-ring/glow accents labeled ILLUSTRATIVE; fidelity classes separated in snapshot.fidelityBreakdown; honesty sentence asserted by unit test. |
| CA8-16 fidelity disclosure UI | DONE | BBM_DISCLOSURE (SCIENTIFIC_FIDELITY §9 language) in About/presets/snapshot; no fake-precision physical sliders (reference-event presets only). |
| CA8-17 source-vs-runtime validation | DONE | tests/unit/bbmDataset.test.ts (integrity/fail-closed), bbmSourceParity.test.ts (exact fixture rows, native-source tolerance, reduction-error thresholds), timeline determinism suite. |
| CA8-18 goldens + benchmark | DONE | BHM_INSPIRAL/NEAR_MERGER/MERGER_FLASH/RINGDOWN/REMNANT twice-stable; `scripts/bench-black-hole-merger.mjs` with phase honesty gate; records in `benchmarks/results/2026-08-25-ca8/`. |
| CA8-19 transition/disposal | DONE | black-hole-merger.spec.ts: rapid A→BBM→C cancellation loops (pendingPrepares=0), revisit GPU-bytes bounds, reduced-motion path, revisit after churn. |
| CA8-20 checkpoint | DONE | This file + README/docs alignment; head recorded below. |

## Integration-debt fix (campaign §15)

`src/atlas/launchCatalog.ts` is now the single production launch catalog
(order + beta visibility); the app shell derives chips from catalog ×
registry. Quasar/AGN became reachable from normal navigation; Black-Hole
Merger surfaced; `tests/unit/launchCatalog.test.ts` enumerates every
descriptor module in the repo so a future destination cannot be registered
yet silently omitted. Legacy `.atlas-nav{flex-wrap}` neutralized (nowrap +
hidden scrollbar) to keep topbar geometry stable across destination counts.

## Commit chain this campaign

```
5933cf3 research: lock CA8 source, provenance and runtime data contract
94b3371 feat: add reproducible black-hole-merger data reduction pipeline
4564c74 feat: implement black-hole-merger runtime destination and playback
<pending: test/goldens/bench + docs/state closure commits>
```

## Validation evidence

| Gate | Result |
| --- | --- |
| npm run check components | prettier clean; eslint clean; tsc clean; build PASS |
| vitest | **454/454** across 29 files (420 pre-existing + 34 new CA8 gates) |
| Playwright FULL suite | **131/131 PASS** (109 pre-existing incl. all goldens/torture + 11 new BBM specs + ... ) |
| Visual goldens | **36/36 twice-stable**: 31 prior UNCHANGED (byte-identical re-encodes except timing-jitter hyperspace row, restored from HEAD) + 5 new BHM rows |
| Benchmarks | inspiral 7.0 ms median; merger 7.0; waveform-panel 7.0; remnant(Kerr) low 13.9 / medium 41.6 (pinned tiers, CPU rAF deltas) |

Environment exercised: Windows 11 (10.0.26200), Node v22.x, Edge headless,
hardware WebGPU (amd rdna-2). frameGpuMs stays null everywhere (no GPU
timestamps; CPU-side rAF deltas honestly labeled).

Runtime asset (committed): `public/data/black-hole-merger/
sxs-bbh-0001-lev5-bbm1-v1.bin`, 73,888 bytes,
sha256 2e317d4ae155868a463473b68c1bd5aac93d36dd3a92f8d9cc21d72cbe28408e.
Reduction is byte-reproducible (verified identical sha256 across reruns).

## Known debt / limitations (updated)

1. (Carried M8/M9 items unchanged: Kerr perf headroom, pole-passage failure
   class, axis tilt unsupported.)
2. BBM remnant phase costs ~42 ms/frame at pinned medium tier (full GR pass);
   auto-mode dynamic resolution governs real usage — phase-aware activation
   keeps other phases at the frame floor.
3. NR timeline covers peak±(inspiral 10 orbits / ringdown +250 M) plus a
   160 M held-remnant tail; earlier/later source data is intentionally not
   shipped.
4. Waveform shows the dominant h22 mode only; higher modes are in the source
   but not visualized.
5. Failure-count telemetry into bench records still open (carried).
6. v3.0 SXS records may gain explicit licenses later — revisit successor
   simulation (SXS:BBH:2325) then.

## Critical/High defects remaining

Zero known. (Fixed during campaign: Kerr-pass disk-radius validation rejected
degenerate disabled-disk params → prepare failure; waveform panel bound
before dataset cache filled → permanent 'unavailable'; topbar wrap changed
canvas geometry with 7 chips → golden dimension mismatches.)

## Next actions

1. M10 observer modes (Kerr-Schild migration decision recorded) OR CA9
   Galaxy Collision per ROADMAP order.
2. Opportunistic: extend launch catalog beta-flag policy tests when first
   beta destination ships (CA12-07 hook already in place).
3. Opportunistic: wire failure-count telemetry into bench records.
