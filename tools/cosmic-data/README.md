# cosmic-data — Black-Hole Merger offline pipeline (CA8)

Reproducible reduction of the pinned SXS numerical-relativity source into
the small runtime asset consumed by the `black-hole-merger` destination.

Provenance and scientific contracts live in
`docs/cosmic-atlas/DATA_SOURCES_BBH_MERGER.md` (decision CA-ADR-021).

## Reproduction gate (DATA_PIPELINE §14)

A clean environment can reproduce the committed runtime artifact exactly:

```bash
python -m pip install -r tools/cosmic-data/requirements.txt
python tools/cosmic-data/fetch_sxs_record.py      # pinned Zenodo record, MD5-checked
python tools/cosmic-data/reduce_bbh_merger.py     # deterministic reduction
```

Running the reducer twice on the same source files must produce a
byte-identical binary (`runtime.checksumSha256` in the manifest/report is
stable). The committed outputs are:

- `public/data/black-hole-merger/sxs-bbh-0001-lev5-bbm1-v1.bin`
- `public/data/black-hole-merger/manifest.json` (provenance + checksum)
- `public/data/black-hole-merger/reduction-report.json` (error evidence)
- `tests/unit/fixtures/bbm-parity.json` (source-vs-runtime anchors)

Raw source products are cached under `scratch/` (gitignored) and are never
committed. No SXS/sxs code or dependency reaches the browser bundle.

## Layout

| File | Packet | Purpose |
| --- | --- | --- |
| `fetch_sxs_record.py` | CA8-03 | Pinned-record fetcher with checksum verification |
| `reduce_bbh_merger.py` | CA8-04..08 | Extract → align → resample → error report → BBM1 binary |
| `scratch/` | — | Local cache for raw source files (not committed) |

## Binary schema (BBM1, version 1)

Little-endian; fixed 160-byte header followed by `sampleCount × 9` float32
values per row (`timeM`, `bhA.xyz`, `bhB.xyz`, `h22Re`, `h22Im`).
Header fields are documented in `reduce_bbh_merger.py`; the decoder
(`src/phenomena/black-hole-merger/dataset.ts`) fails closed on any magic,
version, byte-length, finiteness, monotonic-time or range violation.
