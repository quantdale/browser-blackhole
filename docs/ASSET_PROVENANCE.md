# Asset, source, provenance, licensing, and security policy

This project may use scientific papers, reference implementations, star catalogs, textures, LUTs, and procedural assets. Every external input must be traceable and legally/technically reviewable.

## 1. Categories

Track separately:

- source-code dependency;
- code adapted/copied from reference implementation;
- scientific formula/reference only;
- binary LUT derived from project generator;
- image/HDR environment texture;
- astronomical catalog/data;
- font/icon/UI asset;
- benchmark/test fixture from external source.

## 2. Provenance record

For every nontrivial external asset/adaptation record:

```text
Name:
Type:
Source URL:
Author/organization:
Version/date/commit:
License:
License URL/file:
How used:
Modified/derived?:
Redistribution allowed?:
Attribution required?:
Verification/checksum:
Reviewer/date:
```

Keep this in a machine/human-readable manifest or NOTICE structure by M11.

## 3. Scientific references vs code

Reading a paper and implementing equations independently is different from copying its source code. Document which occurred.

If adapting Bruneton's BSD-3-Clause implementation, preserve required copyright/license notices and identify adapted files/ideas as appropriate.

### 3.1 Provenance register (M8 LUT backend)

```text
Name: Real-time High-Quality Rendering of Non-Rotating Black Holes
Type: scientific paper (method reference only)
Source URL: https://arxiv.org/abs/2010.08735
Author/organization: Eric Bruneton
Version/date/commit: arXiv preprint, published 2020-10-17 (v1); DOI 10.48550/arXiv.2010.08735
License: arXiv non-exclusive distribution; paper text remains copyrighted by the author.
  No paper text is redistributed in this repository — only cited.
License URL/file: https://arxiv.org/licenses/nonexclusive-distrib/1.0/
How used: M8-01 review of the precomputed-table method (beam parameterization,
  constant-time deflection/disc-intersection lookups, critical-region axis
  remapping, star-filtering motivation). Design decisions recorded in
  docs/LUT_BACKEND_ADR.md.
Modified/derived?: N/A (citation only)
Redistribution allowed?: Not redistributed
Attribution required?: Cited above and in the ADR
Verification/checksum: N/A
Reviewer/date: integrator agent / 2026-08-22
```

```text
Name: black_hole_shader (reference implementation)
Type: source-code reference (concepts only; NO code copied)
Source URL: https://github.com/ebruneton/black_hole_shader
Author/organization: Eric Bruneton
Version/date/commit: master as of 2026-08-22 review
License: BSD-3-Clause "New" or "Revised" License
License URL/file: https://github.com/ebruneton/black_hole_shader/blob/master/LICENSE
How used: structural understanding of the two-texture scheme
  (512x512 ray-deflection texture, 64x32 ray-inverse-radius texture,
  u(e^2)=1/(1+6e^2) critical-region remap, mod-pi trajectory symmetry for
  disc crossings, FilteredPulse disc-edge anti-aliasing). The repository's
  own generator, tables, manifest schema, and TSL runtime sampler are
  INDEPENDENT implementations from this repository's CPU reference solver;
  no GLSL/C++ lines were copied or mechanically translated.
Modified/derived?: No copied code; concepts adapted with attribution here
Redistribution allowed?: N/A (nothing redistributed)
Attribution required?: BSD-3-Clause requires license notice IF code were used;
  none is used, attribution kept voluntarily above
Verification/checksum: N/A
Reviewer/date: integrator agent / 2026-08-22
```

Generated LUT assets derived from these references inherit this lineage per
section 7 below; every shipped family records generator commit/version plus
checksums so the lineage stays auditable.

## 4. Dependencies

Package manager lockfile is the dependency inventory. Before adding a package:

- confirm license compatible with project goals;
- check maintenance/current version;
- verify browser/bundle impact;
- avoid package for trivial utility;
- no remote CDN dependency in production when bundling is practical.

## 5. Textures/HDR images

Do not pull random web images into `public/`. Require clear license/redistribution rights.

Prefer:
- project-generated procedural environment;
- public-domain/government data with verified terms;
- permissively licensed assets with attribution file.

Store color space, projection (equirect/cubemap), dynamic range, and orientation metadata.

## 6. Star catalogs

If later using Gaia/Tycho or other astronomical datasets:

- review data terms/citation requirements;
- preprocess offline;
- record source release/version;
- keep generation script reproducible;
- avoid shipping unnecessary huge raw catalog;
- validate coordinate epoch/frame assumptions.

## 7. Generated LUTs

Project-generated LUT assets must include:

- generator commit/version;
- physics convention;
- dimensions/format;
- checksum;
- validation error summary.

If generator algorithm/code is adapted from external work, LUT provenance must reflect that lineage.

## 8. Binary assets

Avoid opaque binaries without regeneration instructions. Where large generated assets are committed or released, provide checksum and generator command.

## 9. Security: untrusted state

Shared URL/preset data is untrusted input.

- parse as data only;
- enforce size limit;
- schema validate;
- finite/range clamp numbers;
- do not evaluate JS, shader code, expressions, or URLs from preset;
- reject unknown object prototypes/keys if parser/schema requires;
- fall back safely.

## 10. Security: shader/source injection

Never build shader source from arbitrary user-entered text. UI parameters become typed numeric/boolean/enumerated uniforms/state only.

Debug features may select precompiled modes, not execute user shader snippets.

## 11. Security: external fetches

Production should not require runtime third-party fetches for core rendering. This improves reliability, privacy, CSP posture, and provenance.

If remote resources are later introduced, define allowlist, integrity/caching/error behavior, and privacy impact.

## 12. Cross-origin isolation

SharedArrayBuffer requires cross-origin isolation in normal web deployment. Do not enable COOP/COEP casually because it affects embedded/cross-origin resources. Only add when a measured Worker/WASM design needs it; document deployment headers and compatibility.

## 13. Privacy

Default project needs no account, analytics, or server telemetry. GPU/browser diagnostic information remains local unless the user explicitly exports or future telemetry policy is approved.

Do not transmit adapter strings, benchmark data, or state automatically.

## 14. Diagnostics privacy

Exported diagnostic bundle contains only what the user asks to export and should avoid:

- IP/location;
- unrelated browser history;
- full user-agent fingerprint fields not needed;
- cookies/storage content;
- arbitrary page URLs.

## 15. Secrets

No API key should be required for the core app. CI/deployment secrets must never enter the client bundle. Add secret scanning/config review if hosting later introduces credentials.

## 16. Content Security Policy

Production deployment should be compatible with a restrictive CSP: bundled scripts/styles/assets, no `eval`, no inline remote code where avoidable. Verify current Vite/Three.js production behavior before freezing directives.

## 17. License audit gate

M11 release audit checks:

- dependency licenses;
- copied/adapted code notices;
- asset licenses;
- scientific/data citations;
- generated asset lineage;
- repository LICENSE/NOTICE completeness.

Any unknown-provenance asset is removed or replaced before release.