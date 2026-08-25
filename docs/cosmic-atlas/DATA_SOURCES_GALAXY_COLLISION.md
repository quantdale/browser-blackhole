# Galaxy Collision — data source decision (CA9-01/02)

Status: LOCKED for CA9. Recorded 2026-08-25 against catalog/site state as of
that date. Any change requires a new ADR and re-running the reduction +
validation chain.

## 1. Survey (CA9-01)

Candidates evaluated for the second production DATA_DRIVEN destination:

| Candidate | Access | License evidence | Verdict |
| --- | --- | --- | --- |
| Illustris/IllustrisTNG (tng-project.org) | Web portal with account-gated bulk downloads | Terms-of-use pages were unreachable from the decision environment at decision time (transport errors on `/data`, `/data/info`); no verifiable machine-readable redistribution grant was obtainable | Rejected as pinned source |
| EAGLE / Millennium databases | Registration-gated web databases with per-project usage terms | No explicit redistribution grant verifiable at decision time | Rejected |
| FIRE simulations | Access granted per collaboration request | Grant is individual, not a standing redistribution license | Rejected |
| GALMER merger virtual observatory (Observatoire de Paris) | Site unreachable from the decision environment at decision time | License status unverifiable | Not selected |
| Zenodo sweeps (`galaxy collision simulation`, `"galaxy merger" simulation`, `restricted three-body galaxies Toomre`, `Antennae N-body`) | Open records | No time-series galaxy-collision particle dataset carrying an explicit license surfaced; hits were talks/posters, observed-merger candidate catalogs, or unrelated three-body literature | None suitable |
| Phantom galaxy-merger **initial conditions**, Zenodo record 13162815 (Wurster & Price; explicit `cc-by-4.0`; per-file MD5) | Direct download (44 MB + 234 MB files) | Genuine open record — BUT it contains INITIAL CONDITIONS for SPH codes, no evolved trajectories. Evolving them here requires an SPH/Gadget-class code this project neither bundles nor validates; resulting dynamics would be neither ours-by-method nor theirs-by-computation | Rejected as trajectory source; noted as possible structural-setup reference |
| **Toomre & Toomre (1972), restricted three-body experiments** | Published paper; orbital parameters are scientific facts | Regenerating trajectories from published parameters with our own tooling redistributes NO third-party data; obligation is citation/attribution only | **SELECTED** (see §2) |

License conclusion: identical principle to CA8 — "publicly accessible" is NOT
"redistribution-permitted". Unlike CA8, where NR waveforms cannot be
regenerated credibly outside the source code, here the canonical published
method (restricted three-body test particles) is small enough to re-implement
exactly, deterministically, and honestly. The committed runtime asset is
therefore OUR OWN derived work product, computed by repository-owned offline
tooling from pinned published parameters, with full citation obligations and
zero third-party particle data redistributed. This satisfies Gate G by
construction instead of by grant.

## 2. Pinned reference experiment (authoritative provenance block)

```text
experiment          "Galactic Bridges and Tails" restricted three-body
                    test-particle experiments (galactic bridges/tails from
                    close parabolic encounters of two disk galaxies)
authors             Alar Toomre & Juri Toomre
publication         The Astrophysical Journal, vol. 178, p. 623 (1972)
DOI                 10.1086/151823            bibcode 1972ApJ...178..623T
method              massless disk test particles moving in the time-dependent
                    field of two point-mass galactic nuclei on prescribed
                    Keplerian encounter orbits; disks are kinematic tracers
physical scope      NO disk self-gravity, NO gas/hydrodynamics, NO dark-matter
                    halos, NO star formation or feedback
parameter pinning   exact encounter parameters (mass ratios, pericenter
                    separations, inclinations, spin orientations) are
                    transcribed from the published tables/figures during
                    CA9-03 implementation and recorded beside the fetch/
                    reduction tooling with paper-and-page citations
validation          regenerated macro morphology (bridges/tails/antennae at
                    reference phases) is compared against the published
                    configurations in the CA9-16 gate
attribution         Toomre & Toomre 1972 carried in the runtime manifest, this
                    document set, and the destination About/Fidelity panel
runtime asset       versioned binary of REGENERATED trajectories produced by
                    tools/cosmic-data (repository-owned, deterministic,
                    seeded); sha256 recorded in its manifest
```

Notes:

- Re-implementing a documented classical method from published parameters is
  standard scientific practice; it is not "copying assets" and needs no
  license beyond honest citation. What IS forbidden (START_HERE hard
  constraints) is copying anyone's code or data dumps without provenance —
  none enters this destination.
- The paper itself remains CLOSED-access (verified via Semantic Scholar API).
  We cite it and use its published parameter values as facts; we neither
  redistribute its figures/text nor claim access-derived numbers we cannot
  transcribe and cite precisely. Parameter transcription happens once, in
  CA9-03, against a legitimately obtained copy, and lands in the repo as
  cited constants.
- Determinism contract (DATA_PIPELINE §14): a clean environment must be able
  to regenerate the runtime artifact byte-identically from the pinned
  parameters using the committed tooling alone.

## 3. Representation decision preview (feeds CA9-04..06)

- Disk stars/bulge: keyframed massless-tracer populations sampled from
  equilibrium disk distributions at t0, integrated through the encounter
  (DATA_PIPELINE §6 "keyframed particle subset" option).
- Gas/dust and starburst: PROCEDURAL_SCIENTIFIC proxies driven by tracer
  statistics, never presented as hydrodynamics.
- Timeline: nonlinear mapping over encounter phases (approach → pericenter(s)
  → coalescence/remnant) with data-derived phase anchors.

## 4. What users must NOT infer

- that this is an N-body or SPH merger simulation (it is not);
- that tidal tails are self-gravitating structures (they are kinematic
  responses of massless tracers);
- that gas, dust, or star-formation visuals carry hydrodynamic physics;
- that any specific real galaxy pair (e.g., the Antennae NGC 4038/4039) is
  reproduced quantitatively rather than morphologically at class level.

## 5. Fidelity classification (destination-level, mixed)

| Content | Class |
| --- | --- |
| Encounter orbit + tracer trajectories (regenerated, validated vs published morphology) | DATA_DRIVEN (restricted three-body model, disclosed) |
| Phase anchors / nonlinear timeline boundaries | DATA_DRIVEN (derived from regenerated dynamics) |
| Disk/bulge visual treatment of tracers | PROCEDURAL_SCIENTIFIC |
| Gas/dust/starburst presentation | PROCEDURAL_SCIENTIFIC (labeled proxies) |
| Remnant/coalescence presentation | PROCEDURAL_SCIENTIFIC |

Required disclosure sentence pattern (SCIENTIFIC_FIDELITY §9), surfaced in
About/presets/snapshot: "Galaxy trajectories follow the classic restricted
three-body experiments of Toomre & Toomre (1972), regenerated from their
published parameters. Gas, dust, and starburst visuals are illustrative
proxies; no self-gravity or hydrodynamics is simulated."
