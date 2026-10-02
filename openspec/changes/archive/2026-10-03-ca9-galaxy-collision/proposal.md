# Proposal: CA9 Galaxy Collision

Change ID: `ca9-galaxy-collision`
Priority: **NEXT FEATURE AFTER M12**
Depends on:

- `m12-neutron-star-surface-lensing` closed or explicitly contained with owner-accepted truthful downgrade;
- `m12-repository-integrity` closed;
- exact primary-source parameter lock completed before production data/runtime implementation.

## Why

CA0–CA8 are implemented and CA9 Galaxy Collision is the next roadmap destination. The existing CA9 prework correctly refuses to turn exercise parameters into production data because the exact Toomre & Toomre (1972) reconstruction parameters had not been source-locked.

The previous source-access blocker is now stale: a public scan is available through NASA GISS and a public NTRS reprint record exists. The next step is not to guess values; it is to extract, cite, normalize and validate the exact facts required for one reproducible reduced collision model.

Primary-source discovery targets:

- NASA GISS: `https://pubs.giss.nasa.gov/abs/to01000a.html`
- NASA NTRS: `https://ntrs.nasa.gov/citations/19720056411`
- Toomre & Toomre (1972), “Galactic Bridges and Tails”, DOI `10.1086/151823`

## What changes

### Source lock

- Retrieve/read the primary-source scan for research, without committing it unless redistribution rights are explicitly established.
- Transcribe only the model parameters/facts required for the selected scenario, with page/section/figure/table provenance.
- Freeze units, frame conventions, mass ratio, encounter geometry, time normalization, disk/tracer initialization and other parameters actually supported by the source.
- Record ambiguities explicitly; block dependent work if a required number cannot be established.

### Offline scientific data pipeline

- Convert the existing restricted-three-body prework from exercise-only behavior to a source-locked production configuration.
- Preserve deterministic integration and self-checks.
- Generate a reduced, versioned runtime trajectory/keyframe artifact with manifest, schema/version, source provenance and checksum.
- Keep raw/high-volume generation data and downloaded paper artifacts out of runtime/source control unless policy explicitly says otherwise.

### Runtime destination

- Add the Galaxy Collision phenomenon/module/presets/route only after source/data validation gates pass.
- Render stars/tracers from the precomputed trajectory/keyframe artifact; do not run an O(N^2) galaxy simulation in the browser.
- Use GPU interpolation/particle rendering suitable for the existing renderer kernel/resource lifecycle.
- Keep cinematic embellishments separate from data-driven tracer motion and label them honestly.
- Add timeline phases, camera behavior, diagnostics, deterministic test hooks and fallback behavior consistent with Cosmic Atlas conventions.

### Validation/release

- Add unit tests for parser/schema/interpolation/source invariants.
- Add browser tests for route/presets/timeline/resource/fallback behavior.
- Add scientific reference tests comparing runtime interpolation against offline data at pinned samples.
- Add visual goldens only after scientific data/interpolation checks pass.
- Add benchmark evidence and update roadmap/fidelity/provenance docs.

## Non-goals

- live N-body self-gravity in the browser;
- hydrodynamics/star formation/dark-matter cosmological simulation;
- claiming the selected reduced restricted-three-body reconstruction is a modern full-fidelity galaxy merger simulation;
- using `ParticleService` cinematic Euler drift as the scientific trajectory solver;
- committing a third-party paper PDF merely because it is publicly downloadable;
- filling missing source parameters with plausible values.

## Hard source stop

If the public primary source does not establish enough information to reproduce the selected model without material guesswork, mark CA9 `BLOCKED_SOURCE`, document exactly what is missing, and stop production data/runtime tasks. A blocked scientifically honest CA9 is preferable to an unsupported production visualization.

## Success criteria

CA9 is complete only when:

- every production source parameter is traceable to a primary/accepted source location or a clearly labeled derived quantity;
- the offline generator is deterministic and rejects missing/unverified production configuration;
- the committed runtime artifact is versioned/checksummed/reproducible from documented tooling;
- runtime interpolation matches pinned offline reference samples within tolerance;
- no runtime network/raw-source dependency is required;
- visual/cinematic layers do not misrepresent the data-driven trajectory model;
- browser/resource/performance/golden gates pass;
- documentation states exactly what the model represents and omits.
