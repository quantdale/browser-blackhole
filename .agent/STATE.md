# Durable project state

Last update: 2026-08-25 (CA9 GALAXY COLLISION CAMPAIGN START). **CA9-01/02
research LOCKED.** Galaxy Collision is the eighth production Cosmic Atlas
destination and the second DATA_DRIVEN one. Decision: no third-party
particle dataset is pinned (none carried a verifiable explicit redistribution
license at decision time); the destination instead pins the classic Toomre &
Toomre 1972 restricted three-body experiments (ApJ 178, 623,
DOI 10.1086/151823) and regenerates trajectories offline with repository-owned
deterministic tooling. Provenance: `docs/cosmic-atlas/
DATA_SOURCES_GALAXY_COLLISION.md`; decision: CA-ADR-022.

## Current phase

**CA9 in progress (packets CA9-01..CA9-19).**
Next: CA9-03 offline fetch/normalization incl. published-parameter
transcription.

## CA9 packet status

| Packet | Status | Evidence |
| --- | --- | --- |
| CA9-01 source survey/license | DONE | `docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION.md` §1. Zenodo sweeps found no licensed time-series collision dataset; IllustrisTNG/EAGLE/FIRE/GALMER rejected (registration-gated / unreachable / unverifiable terms at decision time); Phantom merger ICs
(Zenodo record 13162815, CC-BY-4.0) rejected as trajectory source (ICs only,
SPH evolution required). Gate G satisfied by regeneration instead of grant. |
| CA9-02 dataset selection | DONE | Pinned reference experiment recorded §2 + CA-ADR-022: Toomre & Toomre 1972 restricted three-body test-particle experiments; exact encounter parameters to be transcribed from the paper during CA9-03 with citations; morphology validated against published configurations at CA9-16. |
| CA9-03 offline fetch/normalization | PENDING | Parameter transcription + deterministic IC sampling + integrator skeleton. |
| CA9-04..CA9-19 | NOT STARTED | See docs/cosmic-atlas/WORK_PACKETS.md §CA9. |
| State hygiene | DONE | Head recorded post-commit (this entry); tree clean between packets. |

## CA8 closure (carried context)

CA8 Black-Hole Merger shipped complete end-to-end (SXS:BBH:0001 Lev5 pinned;
BBM1 runtime asset 73,888 bytes, sha256 2e317d4a…28408e; all 20 packets DONE;
closure commit 0139e65). Full suite at closure: vitest 454/454, Playwright
136/136, goldens 36/36 twice-stable. See git history and
`DATA_SOURCES_BBH_MERGER.md`.

## Commit chain this campaign

```
996bad7 research: lock CA9 galaxy-collision source decision and provenance survey
```

## Validation evidence

| Gate | Result |
| --- | --- |
| Docs-only packet | No code/tests/assets touched this cycle; build/test gates not re-run (unchanged tree except docs/state) |
| License verification method | Live Zenodo record API sweeps + Semantic Scholar API (T&T metadata confirmed: ApJ 178, 623, 1972, DOI 10.1086/151823, CLOSED access); tng-project.org/galmer.obspm.fr unreachable from decision environment — recorded as evidence, not assumed |

Environment exercised: Windows 11 (10.0.26200), Node v22.x. Websearch backend
was down this session; provider APIs used directly instead.

## Known debt / limitations (updated)

1. Carried M8/M9 items unchanged: Kerr perf headroom, pole-passage failure
   class, axis tilt unsupported.
2. Carried CA8 items: BBM remnant ~42 ms/frame at pinned medium tier;
   waveform shows h22 only; failure-count telemetry into bench records open;
   revisit SXS successor (SXS:BBH:2325) if CaltechDATA records gain explicit
   licenses.
3. CA9 fidelity boundary: restricted three-body has NO disk self-gravity, NO
   hydrodynamics, NO halos, NO star formation — must be disclosed wherever
   dynamics are shown (CA-ADR-022 consequence).
4. Exact T&T encounter parameters are NOT yet transcribed into the repo;
   until CA9-03 lands, no numeric claims about the pinned experiment exist
   beyond the bibliographic record.

## Critical/High defects remaining

Zero known.

## Next actions

1. CA9-03: transcribe published encounter parameters (with paper/page
   citations), implement deterministic IC sampling + fixed-step symplectic
   integrator skeleton in `tools/cosmic-data/`, CPU parity tests.
2. CA9-04: reduction representation experiment (keyframed subset sizes vs
   interpolation error budget).
3. CA9-05: center/trajectory validation harness.
