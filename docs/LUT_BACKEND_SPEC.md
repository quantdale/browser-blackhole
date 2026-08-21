# Optimized Schwarzschild LUT backend specification

The LUT backend is an optimization of a validated Schwarzschild renderer, not an independent source of truth. Its role is to replace expensive per-pixel numerical trajectory integration with precomputed mappings while keeping controlled error.

## 1. Entry gate

Do not implement the production LUT backend until:

- M2 numerical Schwarzschild renderer passes reference tests;
- M3 disk geometry is validated;
- selected-pixel probe tooling exists;
- benchmark harness can compare backends;
- external reference/license review is documented.

Research/prototyping may occur earlier on an isolated branch/work packet.

## 2. Primary reference

Study Eric Bruneton, “Real-time High-Quality Rendering of Non-Rotating Black Holes” (arXiv:2010.08735) and its BSD-3-Clause reference implementation. The paper describes precomputed beam mappings enabling constant-time scene intersection per beam/pixel with specialized filtering.

Do not copy implementation code until license/provenance handling is recorded in `ASSET_PROVENANCE.md` or equivalent notice files.

## 3. Architectural role

```text
canonical camera/state
      |
      +--> numerical Schwarzschild backend (truth/comparison)
      |
      +--> LUT Schwarzschild backend (optimized production)
                 |
           versioned LUT assets
```

Both produce the same logical `TraceResult`/radiance contract where feasible.

## 4. Precomputation ownership

LUT generation is offline/build tooling, not normal application startup.

Suggested path:

```text
tools/generate-luts/
  generate.ts or native/reference tooling
  schema.ts
  validate.ts
public/luts/<version>/
  manifest.json
  ...binary/texture assets
```

Generation command must be deterministic for fixed inputs.

## 5. Manifest requirements

Every LUT family stores:

- schema version;
- generator version/commit;
- source physics convention (`M=1`, coordinate choices);
- domain/range of each axis;
- dimensions;
- texture encoding/format;
- interpolation assumptions;
- checksum per asset;
- maximum/RMS errors from validation corpus;
- date/reference solver version;
- provenance/license metadata if derived/adapted.

The runtime rejects incompatible manifests.

## 6. Domain design

Choose table coordinates based on the paper/research and measured interpolation behavior, not raw UI values. Candidate dimensions may parameterize observer radius, ray impact/angle, closest approach/trajectory state, or beam quantities.

Before freezing an encoding:

1. map the physically reachable domain from product presets;
2. sample densely near critical regions;
3. quantify interpolation error;
4. inspect texture hardware filtering behavior;
5. verify WebGL2-compatible formats if fallback parity is desired.

## 7. Critical-region handling

The photon critical curve is sensitive. Uniform parameter sampling may waste resolution far away and undersample near criticality.

Potential strategies:

- nonlinear coordinate transform concentrating samples near critical impact parameter;
- separate critical-region table;
- numerical fallback for a narrow difficult region;
- higher-precision encoding where justified.

Select using measured error/performance.

## 8. Texture formats

Prefer smallest format that satisfies error bounds and browser support. Evaluate:

- 16-bit floating formats;
- 32-bit float only where required;
- normalized integer encoding for bounded angles/parameters;
- packed representation with explicit decode tests.

Memory bandwidth matters because LUT optimization trades ALU/integration for texture sampling.

## 9. Runtime sampling

LUT sampling functions must:

- validate domain before lookup;
- clamp only when physically intended;
- distinguish out-of-domain from ordinary boundary value;
- apply the interpolation scheme used in validation;
- return explicit fallback classification when data cannot represent the ray.

Out-of-domain rays may route to numerical backend if hybrid operation is implemented.

## 10. Beam footprint/filtering

High-quality background/star rendering may require more than center-ray lookup because strong lensing changes beam footprint/magnification. Review Bruneton's filtering approach before implementing star/environment sampling. A center-only direction lookup can alias or miss tiny bright stars under magnification.

Treat beam footprint as a separate correctness/quality problem from trajectory mapping.

## 11. Disk intersections

LUT backend must reproduce direct and higher-order disk image geometry within acceptance tolerance. Validate hit order, radius, and apparent boundary against numerical rays.

Do not optimize only background lensing then assume disk mapping is equivalent.

## 12. Equivalence corpus

Compare at least:

- radial capture/escape;
- weak field;
- near critical both sides;
- face-on disk;
- inclined direct disk;
- higher-order disk images;
- grazing disk edges;
- multiple camera radii/FOVs;
- scale-invariant mass presets.

## 13. Image comparison

For deterministic preset pairs report:

- classification mismatch rate;
- selected-ray angular/hit errors;
- pixel absolute/RMS/perceptual difference;
- photon-ring edge displacement;
- disk edge displacement;
- star aliasing behavior;
- frame-time improvement.

## 14. Performance acceptance

The backend should deliver a meaningful speed gain after accounting for:

- texture sampling;
- extra memory bandwidth;
- beam filtering;
- post-processing unchanged between backends;
- loading/decode cost amortization.

If speed gain is small on representative hardware, keep numerical backend rather than adding permanent complexity merely because LUTs are theoretically faster.

## 15. Fallback strategy

Potential runtime policy:

- `auto`: use validated LUT backend when assets/capabilities match; otherwise numerical;
- `numerical`: force reference-like production backend;
- `lut`: request optimized backend, with visible fallback if unavailable.

Never silently switch to a different physical model.

## 16. Cache/versioning

LUT URLs include immutable version/hash so deployment caches cannot pair old tables with new decode logic. Manifest and asset checksums protect against partial/stale deployment.

## 17. Build/release gate

A change to:

- generator;
- table domain;
- format;
- interpolation;
- decode;
- physics convention

requires LUT regeneration/version bump and equivalence report. Do not hand-edit binary tables.

## 18. WebGPU compute question

Runtime compute is not required for LUT lookup. Compute may help offline/in-browser developer generation experiments, tile classification, or preprocessing, but production tables should normally ship precomputed.

## 19. Hybrid backend research

Optional later optimization:

- LUT for ordinary rays;
- numerical solver for out-of-domain/critical special cases;
- shared final shading.

Any hybrid classifier must avoid visible seams and must be validated around the switching boundary.

## 20. Completion criteria

M8 is complete only when optimized LUT rendering is quantitatively equivalent within documented bounds and faster on representative hardware. “Looks similar” is insufficient.