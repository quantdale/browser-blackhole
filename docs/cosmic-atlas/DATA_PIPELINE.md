# Scientific data and asset pipeline

## 1. Principle

Use the browser for interactive visualization, not for reproducing the expensive offline simulation that generated scientific data.

Cosmic Atlas therefore has two execution domains:

```text
OFFLINE TOOLING
research/scientific data
→ fetch
→ normalize
→ validate
→ reduce/resample
→ compress
→ manifest/checksum

RUNTIME BROWSER
manifest
→ lazy fetch
→ decode
→ GPU upload/interpolation
→ interactive rendering
```

## 2. Proposed tooling layout

```text
tools/cosmic-data/
  fetch/
  normalize/
  validate/
  reduce/
  resample/
  compress/
  manifests/
  schemas/
  reports/
```

Offline tools may use Python, NumPy/SciPy, Rust, HDF5 tooling, or domain-specific scientific libraries. These dependencies do not belong in the production web bundle.

## 3. Data manifest

Every data-driven asset should have a small JSON manifest conceptually containing:

```json
{
  "schemaVersion": 1,
  "id": "bbh-gw150914-reference",
  "phenomenon": "black-hole-merger",
  "source": {
    "organization": "...",
    "url": "...",
    "datasetId": "...",
    "license": "...",
    "retrievedAt": "..."
  },
  "physics": {
    "units": "...",
    "coordinateFrame": "...",
    "timeOrigin": "..."
  },
  "channels": ["..."],
  "runtime": {
    "encoding": "binary-v1",
    "samples": 0,
    "bytes": 0,
    "checksumSha256": "..."
  },
  "reduction": {
    "toolVersion": "...",
    "method": "...",
    "errorReport": "..."
  }
}
```

## 4. Binary format policy

Large numeric arrays use binary `ArrayBuffer` payloads.

The binary format must define:

- magic/version;
- endian convention;
- units;
- channel count;
- scalar type;
- sample count;
- offsets;
- coordinate frame;
- time representation;
- checksum handled by manifest.

Prefer simple, documented, deterministic formats over clever opaque compression.

## 5. Black-Hole Merger pipeline

Candidate sources: SXS catalog and Einstein Toolkit examples, subject to source/license validation.

Offline work:

1. choose reference simulation;
2. record source identifiers and publication/context;
3. extract component physical metadata;
4. choose visualization trajectory representation carefully—coordinate trajectories in numerical relativity can be gauge-dependent, so do not present them as invariant observables;
5. extract/normalize waveform modes or strain representation;
6. define merger time and remnant metadata;
7. resample to compact timeline;
8. quantify interpolation error;
9. emit runtime binary + manifest;
10. compare decoded runtime samples to source extraction.

Runtime must not fetch terabyte-scale raw output.

## 6. Galaxy Collision pipeline

Preferred source: validated simulation data with trajectories/keyframes/phase-space or reduced density/flow fields.

Reduction options:

### Keyframed particle subset

Select representative star/gas particles and resample positions/velocities at fixed normalized phases.

Browser interpolates between keyframes.

### Flow basis / deformation field

Encode a smaller flow representation driving many procedural visual tracers.

### Hybrid

Use scientifically sampled massive/structural particles plus procedural visual tracers around them.

Validation must compare:

- galaxy center trajectories;
- tidal-tail morphology at reference phases;
- spatial distribution statistics;
- interpolation error.

## 7. Future volume data

Scientific 3D volumes may be used for selected destinations later.

Offline process:

```text
raw simulation volume
→ crop scientifically relevant region
→ transform to agreed coordinates
→ resample
→ scalar/channel selection
→ precision analysis
→ quantize only if validated
→ brick/slice/compress
→ runtime manifest
```

Avoid shipping arbitrary raw HDF5/FITS simulation products directly to the browser when a smaller validated representation works.

## 8. Texture asset pipeline

Visual assets:

- HDR/sky;
- dust/noise;
- galaxy sprites;
- star spectra/LUTs;
- masks.

Process:

- retain original provenance;
- preprocess reproducibly;
- KTX2/Basis where appropriate;
- compare visual error;
- record generated output in asset manifest.

## 9. Procedural seeds

Procedural scientific scenes use explicit deterministic seeds.

A preset must not depend on `Math.random()` without seeded control.

Store seed in preset/share state where relevant.

## 10. Runtime loader contract

Loader verifies:

- schema version;
- expected destination;
- expected byte length;
- checksum when practical;
- finite numeric values;
- monotonic time array if required;
- channel ranges;
- capability-dependent format support.

On validation failure:

- do not partially activate corrupted scene;
- surface an error/fallback;
- dispose partially allocated resources.

## 11. Streaming

For large data:

- split into logical chunks/phases/LODs;
- fetch minimum-ready first;
- optional later phases load in background;
- use abort signals;
- no stale target can commit after route generation changes.

Examples:

Galaxy Collision:

```text
metadata
→ low-LOD keyframes
→ high-LOD tracer data
→ optional gas/dust field
```

Quasar:

```text
inner essential
→ host-galaxy assets
→ extended jet detail
```

## 12. Provenance

Every external data/asset needs:

- source URL;
- provider;
- retrieval date/version;
- license/terms;
- transformations;
- attribution requirement;
- checksum/version.

Do not copy visualizations from NASA/ESO/etc. and treat them as arbitrary texture assets without checking permitted use and attribution.

## 13. Repository size policy

Do not commit giant raw scientific datasets into Git history.

Use:

- small curated runtime assets where acceptable;
- releases/object storage/CDN for larger versioned assets;
- reproducible fetch/build tools;
- manifests checked into Git.

## 14. Reproducibility gate

A data-driven destination is not complete until another clean environment can:

1. identify source data;
2. run or audit reduction tooling;
3. regenerate the runtime artifact or verify its exact checksum;
4. validate sample equivalence;
5. understand every channel and unit.