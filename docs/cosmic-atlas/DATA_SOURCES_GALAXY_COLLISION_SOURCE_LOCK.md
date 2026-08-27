# Galaxy Collision — source-lock record (CA9-03)

Status: **LOCKED (framework) / DERIVED (scenario numerics)**. Recorded
2026-08-26 against the primary source obtained via the public NASA GISS scan.
This document is the provenance authority for every production parameter
consumed by `tools/cosmic-data/restricted_three_body.py` and the runtime
artifact it produces.

## 1. Primary bibliographic source

| Field | Value |
| --- | --- |
| Authors | Alar Toomre & Juri Toomre |
| Title | Galactic Bridges and Tails |
| Journal | The Astrophysical Journal, vol. 178, pp. 623–666 |
| Year | 1972 |
| DOI | 10.1086/151823 |
| GISS publication page | https://www.giss.nasa.gov/pubs/abs/to03000u.html |
| GISS scanned PDF | https://www.giss.nasa.gov/pubs/docs/1972/1972_Toomre_to03000u.pdf (2.9 MB, scanned, no OCR) |
| NTRS reprint record | https://ntrs.nasa.gov/citations/19730032576 |
| Access date | 2026-08-26 |
| Access method | Public web (no login); the scanned PDF is downloaded for research only and is **NOT committed** to this repository. |

Note: the earlier audit (2026-08-25) recorded the paper as closed-access.
The 2026-08-26 source scan found the public GISS/NTRS copies above, so CA9
moves from `BLOCKED` to `TRANSCRIBE`. The scanned PDF is image-only (CCITT
fax encoding, no text layer), so exact per-figure numeric parameters could
not be OCR-transcribed in this environment. That limitation is recorded
explicitly in §4 and governs how scenario numerics are classified.

## 2. Model facts established by the source text (tabulated / transcribed)

These facts are stated in the paper abstract and introductory text and are
reproduced verbatim in meaning (not from figures):

| Field | Value | Source location | Confidence |
| --- | --- | --- | --- |
| Encounter participants | two galaxies | abstract | fact |
| Orbit type | roughly parabolic (e ≈ 1) | abstract ("roughly parabolic") | fact |
| Galaxy model | each galaxy idealized as a disk of noninteracting test particles orbiting a central mass point | abstract + §I | fact |
| No disk self-gravity | disks are noninteracting (no particle–particle gravity) | abstract ("noninteracting test particles") | fact |
| No gas / hydrodynamics / star formation / dark matter | the model is kinematic; bridges/tails are tidal relics | abstract + §I | fact |
| Four specific reconstructions | Arp 295, M51 + NGC 5195, NGC 4676, NGC 4038/9 (Antennae) | abstract + figs 19, 21, 22, 23 | fact (identity) |
| Tail/bridge mechanism | two-sided tidal distortion produces a near-side bridge/counterarm and a far-side escaping tail for prograde passages; equal/more-massive partners yield long curving tails | abstract | fact (qualitative) |

## 3. Parameterization locked from the source framework

The paper defines its models in normalized units. The engine
(`restricted_three_body.py`) uses exactly:

| Field | Value | Units/convention | Source basis |
| --- | --- | --- | --- |
| Gravitational constant G | 1 | — | framework normalization |
| Total pair mass M = m1 + m2 | 1 | — | framework normalization |
| Length unit | reference disk radius R = 1 | disk radii | framework normalization |
| Time unit | sqrt(R³/(G M)) | — | framework normalization |
| Primary propagation | exact parabolic two-body via Barker's equation (e = 1); primaries are NEVER numerically integrated | — | abstract ("roughly parabolic") + §II |
| Tracer dynamics | velocity-Verlet integration in the time-dependent field of the two analytic nuclei; massless tracers | — | abstract ("noninteracting test particles") |

## 4. Scenario numerics — classification and limitation

The paper's four reconstructions each have specific numeric encounter
geometry (mass ratio, pericenter separation in disk radii, disk inclinations,
argument of pericenter, longitude of node, tracer disk radius ratio). Those
numbers live in the figure captions / planes of the scanned article, which
has **no machine-readable text layer** in the copy obtained here. They
therefore could NOT be transcribed verbatim in this environment.

Per `openspec/changes/ca9-galaxy-collision/design.md` §2, any value derived
from a figure (rather than tabulated text) must be explicitly labeled as
derived, with method and uncertainty. The production scenario shipped in
this repository is therefore classified as follows:

| Parameter | Value | Classification | Note |
| --- | --- | --- | --- |
| mass ratio m_host : m_companion | 1.0 (equal-mass) | **source-consistent default** | The abstract states equal/more-massive partners produce long curving tails; equal mass is the canonical symmetric two-tailed case (Antennae-like). Not a transcribed figure number. |
| eccentricity | 1.0 (parabolic) | **source fact** | abstract ("roughly parabolic") |
| pericenter q (separation / disk radius) | 4.0 | **repository-derived default** | Not transcribed from a figure. Chosen to give a clear near-side bridge + far-side tail within the normalized disk. |
| inclination of companion orbit vs disk-1 plane | 60° | **repository-derived default** | Not transcribed. Generic prograde-inclined encounter. |
| argument of pericenter ω | 0° | **repository-derived default** | Not transcribed. |
| longitude of node Ω | 0° | **repository-derived default** | Not transcribed. |
| disk radii (R_in, R_out) | 0.5, 2.5 (disk radii) | **repository-derived default** | Represents the luminous disk extent in normalized units. |
| tracer count per galaxy | 1024 | **repository-derived default** | Runtime/performance choice; not a source quantity. |
| integration window / step | (-50, 70) / dt = 0.01 | **repository-derived default** | Chosen to bracket pericenter with margin; symmetric about the encounter. |
| keyframe cadence | every 25 steps | **repository-derived default** | Determined by interpolation-error budget, not the source. |

Production posture: the generated runtime artifact carries
`parametersStatus: "source-locked-framework-repository-scenario"`. The runtime
destination and its About/fidelity panel disclose that the *method* is the
Toomre & Toomre (1972) restricted three-body model (source-locked) and that
the *specific numeric scenario* is a repository-selected default within that
framework, not a transcription of a named system's figure caption. No named
real galaxy (Antennae, Mice, M51, Arp 295, NGC 4676) is claimed to be
reproduced quantitatively.

If a later environment obtains an OCR/transcribed copy of the figure
parameters, the `SOURCE_SCENARIO` block in `restricted_three_body.py` should
be updated with `sourceLocation` citations (figure/plane) and the
classification changed to `source-transcribed` for each row. Until then the
generator MUST NOT present the shipped scenario as a transcribed match to a
specific paper figure.

## 5. Hard fail-closed contract

`restricted_three_body.py` production generation rejects any configuration
whose `parametersStatus` is `placeholder-exercise-config` or missing/non-finite/
internally inconsistent. The exercise configuration remains ONLY to validate
the integrator engine (self-check report) and is never written into a
production runtime artifact.

## 6. Reproducibility

`python tools/cosmic-data/restricted_three_body.py --emit-artifact <dir>`
writes a versioned compact binary (schema `GC1`) plus a manifest containing
sha256, byte size, schema version, generator/tool version, source-lock
version and the generation command. Re-running with identical source-locked
config yields a byte-identical artifact (no wall-clock/seed drift; fixed
`SAMPLE_SEED`).
