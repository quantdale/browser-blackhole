# Durable project state

Last update: 2026-08-25 (CA9 GALAXY COLLISION CAMPAIGN). **CA9-01/02
research LOCKED; CA9-03 engine LANDED (parameter transcription still
pending — needs a legitimately obtained paper copy, see blocker below).**
Galaxy Collision is the eighth production Cosmic Atlas destination and the
second DATA_DRIVEN one. Decision: no third-party particle dataset is pinned
(none carried a verifiable explicit redistribution license at decision
time); the destination instead pins the classic Toomre & Toomre 1972
restricted three-body experiments (ApJ 178, 623, DOI 10.1086/151823) and
regenerates trajectories offline with repository-owned deterministic
tooling. Provenance: `docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION.md`;
decision: CA-ADR-022.

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
| CA9-03 offline fetch/normalization | PARTIAL | DONE: `tools/cosmic-data/restricted_three_body.py` (Barker-exact parabolic primaries; velocity-Verlet tracers; seeded disk sampling evaluated at window start; per-particle nucleus-guard quarantine with segment-based tunneling detection); 7 analytic self-checks all PASS (`reports/ca9-integrator-selfcheck.json`, sha256 9f84df4a…f0ee8a, byte-stable across reruns); gated by `tests/unit/ca9Integrator.test.ts` (6 tests). REMAINING: transcribe published encounter parameters from the paper (closed access — requires legitimately obtained copy; report stays `placeholder-exercise-config` until then, guarded by test). |
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
ae8a1f1 state: record CA9 research head
f8c5d79 feat: add deterministic restricted three-body engine with analytic self-checks (CA9-03 core)
```

## Validation evidence

| Gate | Result |
| --- | --- |
| npm run check | PASS — prettier clean; eslint clean; tsc clean; vitest **460/460** (454 prior + 6 new CA9 gates); build PASS |
| CA9 engine self-check | PASS — 7/7 analytic checks incl. Barker finite-difference (3.5e-10 ≤ 1e-8), conic invariants (6.3e-16 ≤ 1e-12), time-reversal (0.0), mirror+time-reversal symmetry (0.0), Kepler frequency (1.4e-5 ≤ 1e-4), frozen-potential drift (0.0 ≤ 5e-6), quarantine fail-closed (count=1, finite) |
| Determinism | Report sha256 `9f84df4a79c61ec5d2fa0c2be2a4b569c7fb9a0aa0a63c2cdf716d6b28f0ee8a` identical across reruns; IC resample hash identical |
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
   until that lands, no numeric claims about the pinned experiment exist
   beyond the bibliographic record. BLOCKER (external input): the paper is
   CLOSED access and no legitimate copy is reachable from this environment;
   transcription requires a user-provided/library copy. Engine work proceeds
   on exercise configs only.

## Critical/High defects remaining

Zero known.

## Next actions

1. Unblock parameter transcription: obtain a legitimate copy of Toomre &
   Toomre (1972) — USER INPUT NEEDED (library/PDF); then transcribe
   published encounter parameters with paper/page citations, flip
   `parametersStatus`, add published-parameter anchor tests.
2. CA9-04: reduction representation experiment on top of the engine
   (keyframe subset sizes vs interpolation error budget).
3. CA9-05: center/trajectory validation harness.
4. Opportunistic: extend launch-catalog beta-flag policy tests when first
   beta destination ships (CA12-07 hook already in place).
