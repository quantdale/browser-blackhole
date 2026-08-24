# Black-Hole Merger — data source decision (CA8-01/02/05)

Status: LOCKED for CA8. Recorded 2026-08-25 against SXS catalog state as of
that date. Any change requires a new ADR and re-running the full pipeline +
validation chain.

## 1. Survey (CA8-01)

Candidates evaluated for the first production DATA_DRIVEN destination:

| Candidate | Access | License evidence | Verdict |
| --- | --- | --- | --- |
| **SXS catalog** (Simulating eXtreme Spacetimes) | Zenodo/CaltechDATA records, one DOI per simulation (`10.26138/SXS:BBH:NNNN`); `sxs` Python package (pure Python, MIT) for reading; current metadata release tag v3.0.0 (2025-05-12, arXiv:2505.13378) | Zenodo simulation records carry an explicit machine-readable license: verified `cc-by-4.0` on record 13166927 via the record API. Catalog pages additionally request acknowledgement of each simulation's first publication. CaltechDATA v3.0 records currently expose **no explicit license field** through their API. | **SELECTED** (see §2) |
| Einstein Toolkit BBH examples | Gallery/example evolutions, raw simulation products rather than reduced waveforms | No per-dataset redistribution grant suitable for committing derived artifacts | Rejected for runtime use |
| Georgia Tech / RIT catalogs | Public tarballs of NR waveforms | Per-catalog terms not verifiable at decision time to the standard required by QUALITY_GATES Gate G | Not selected |
| LIGO/Virgo detector strain (GW150914 etc.) | gw-openscience.org, simple HDF5/text | Open licenses exist, but detector strain includes noise/instrument response; extracting clean binary dynamics is out of scope for the first contract | Deferred |

License conclusion: "publicly accessible" was NOT treated as
"redistribution-permitted". The pinned source below carries an explicit,
record-level CC-BY-4.0 grant, which permits derived/reduced works (the
committed runtime asset) with attribution. Attribution requirements are
satisfied by this document, the manifest committed beside the runtime asset,
and the destination's About/Fidelity panel.

## 2. Pinned source (authoritative provenance block)

```text
simulation id        SXS:BBH:0001  (q≈1, non-spinning, quasi-circular BBH)
provider             SXS Collaboration (SpEC code)
pinned record        https://zenodo.org/records/13166927
versioned DOI        10.5281/zenodo.13166927   (concept DOI 10.5281/zenodo.13166926)
license              CC-BY-4.0 (explicit on record)
retrieval date       2026-08-25
files used           Lev5:metadata.json  md5 e60290b92aae222f3a7cde9663700156
                     Lev5:Strain_N4.h5   md5 11d3e0ac3628de4bf2c067064d95b4ec
                     Lev5:Strain_N4.json md5 ba8c2e346093db628509a8196e39b611
                     Lev5:Horizons.h5    md5 484ea88842209e64983793159bcc7d7c
attribution          Mroue:2013xna (first publication),
                     Boyle:2019kee (second catalog), SXSCatalogWebsite;
                     code: Ossokine:2013zga et al.; see metadata.json
required tooling     python>=3.10, numpy, h5py, sxs==2025.x (RPDMB decode,
                     MIT) — offline only, never bundled into the web app
```

Notes:

- The record stores waveforms in the RPDMB compressed format
  (`rotating_paired_diff_multishuffle_bzip2`, documented in Appendix C of
  arXiv:2505.13378). Decoding uses the official MIT-licensed `sxs` package as
  offline scientific tooling; the repository ships no RPDMB code.
- The strain includes gravitational-wave memory (nonzero late-time h). This
  is a property of the published data and is preserved, not smoothed away.
- `superseded_by: SXS:BBH:2325`: the catalog recommends the rerun successor.
  The pinned record remains published and non-deprecated, is scientifically
  equivalent in configuration (equal-mass, non-spinning), AND is the variant
  whose repository record carries an explicit machine-readable license plus
  per-file checksums. The successor's CaltechDATA record exposes no explicit
  license field at decision time, so it cannot satisfy Gate G without
  assumptions. Documented, defensible choice; revisit if CaltechDATA records
  gain explicit licenses.

## 3. Reference event selection (CA8-02)

SXS:BBH:0001 Lev5 chosen because it maximizes metadata coverage while
minimizing interpretation complexity for the FIRST production data contract:

- component masses ≈ 0.5 + 0.5 (mass ratio q = 1.000);
- negligible spins (|chi| < 1e-8 at reference time): no precession model to
  disclose or fake;
- reference eccentricity ~2.6e-4 (quasi-circular);
- 28.12 orbits — long enough to present a real inspiral segment;
- merger anchors: common horizon time t=9524.086 M; strain (2,2) peak at
  t≈9530.6 M; remnant Christodoulou mass → 0.95160 M; remnant spin |chi| →
  0.68646 (horizon-converged, matches metadata.json);
- waveform modes ell=2..8 available; runtime extracts the dominant (2,±2).

Deliberately NOT chosen: high-q runs (SXS:BBH:0303 q=10 — extreme mass-ratio
asymmetry complicates the first visualization contract), precessing runs
(spin-precession presentation would be illustrative dressing on the orbital
plane), eccentric runs (merger-time anchoring less clean).

## 4. Trajectory representation decision (CA8-05)

This is a scientific correctness boundary. Coordinate trajectories from NR
are GAUGE-DEPENDENT, not invariant observables.

What the source provides: `Horizons.h5` apparent-horizon coordinate centers
(`CoordCenterInertial.dat`, t + x/y/z in the asymptotically inertial
simulation frame, total-mass geometric units). These are coordinates of the
apparent horizons in one specific gauge/coordinate system chosen by SpEC.

What the pipeline does with them:

1. subtracts the common-horizon center so the remnant sits at the origin
   (a rigid translation; no rotation/rescaling beyond the unit statement);
2. keeps the inertial-frame axes as-is (no co-rotating frame);
3. resamples both trajectories onto the shared reduced timeline;
4. encodes them in the runtime binary as an explicitly labeled channel pair
   (`bhA.xyz`, `bhB.xyz`) with `frame = "source-inertial-com-center"`,
   units `M` (total ADM-ish geometric mass scale), documented as
   COORDINATE PATHS.

What the browser displays: two horizon-scaled markers following these
coordinate paths. The UI labels them "NR coordinate trajectories
(gauge-dependent)" — never "orbits" as measured observables.

What users must NOT infer:

- that the drawn path is a gauge-invariant worldline;
- that coordinate separation equals a physical observable distance;
- that horizon shapes/tidal deformations shown are resolved physics (they
  are illustrative proxies — see fidelity classes).

## 5. Waveform representation decision (CA8-06)

- Quantity: strain mode **h22 = h(ell=2, m=+2)** from the extrapolated
  (N=4) asymptotic geometric-units CoM-corrected file — real and imaginary
  parts stored separately, spin weight −2.
- Time coordinate: source retarded time u/M (geometric units), aligned in
  the runtime timeline so that **t=0 is the (2,2) amplitude peak** (merger
  anchor); inspiral samples carry negative times.
- Normalization: dimensionless strain r·h/M exactly as published (r and M
  scaled out); no additional scaling.
- Ringdown alignment: the same peak anchor drives the RINGDOWN phase
  boundary; no synthetic quasi-normal-mode patching is applied — ringdown
  shows the published data.

## 6. Fidelity classification (destination-level, mixed)

| Content | Class |
| --- | --- |
| Orbital progression (reduced NR coordinate trajectories) | DATA_DRIVEN |
| Waveform (h22 reduced samples + timing) | DATA_DRIVEN |
| Component/remnant metadata readouts | DATA_DRIVEN |
| Horizon-scale markers' visual treatment | PROCEDURAL_SCIENTIFIC |
| Illustrative lensing/warping visuals | PROCEDURAL_SCIENTIFIC (labeled) |
| Merger flash/ringdown glow presentation | CINEMATIC accents over DATA_DRIVEN timing |

Required disclosure sentence (SCIENTIFIC_FIDELITY §9), surfaced in the
About panel and preset notes: "Orbital motion and waveform are derived from
numerical-relativity data. The live lensing visualization is illustrative
and does not ray trace the full dynamical spacetime."
